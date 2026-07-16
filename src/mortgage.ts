/**
 * Core mortgage math — framework-free and fully unit-tested.
 *
 * Mirrors the reference Google Sheet's conventions:
 *  - Interest for a month = beginning balance * (annualRate% / 100 / 12).
 *  - Payment is RECOMPUTED every month as PMT(currentMonthlyRate, monthsRemaining,
 *    currentBalance). Because each payment re-amortizes the remaining balance over the
 *    remaining term, the loan always pays off exactly at the end of the term, and rate
 *    changes (or extra payments) move the PAYMENT amount rather than the payoff date.
 *  - Ending balance = beginning + interest - payment - extraPayment.
 */

export type RateType = "fixed" | "variable";
export type VariableStyle = "ramp" | "band";

/** A one-off additional payment, applied during a given loan year (1-based). */
export interface ExtraPayment {
  amount: number;
  /** 1-based loan year. Applied at the first month of that year. */
  loanYear: number;
}

export interface LoanInput {
  /** Principal borrowed, in whole currency units. */
  principal: number;
  /** Loan term in whole years. */
  termYears: number;
  rateType: RateType;
  /** Annual rate in percent for a fixed loan (e.g. 4.5 for 4.5%). */
  fixedRatePct?: number;
  variableStyle?: VariableStyle;
  /** Starting annual rate in percent for a variable loan. */
  baseRatePct?: number;
  /** RAMP: percentage-points added every `rampEveryMonths`. */
  rampStepPct?: number;
  /** RAMP: how often (in months) the rate steps up. */
  rampEveryMonths?: number;
  /** BAND: optimistic annual rate in percent. */
  minRatePct?: number;
  /** BAND: pessimistic annual rate in percent. */
  maxRatePct?: number;
  extraPayments?: ExtraPayment[];
}

export interface ScheduleRow {
  /** 1-based loan year. */
  year: number;
  /** 1-based month number over the whole loan. */
  month: number;
  beginningBalance: number;
  interest: number;
  /** Scheduled payment magnitude for this month (positive). */
  payment: number;
  /** Extra payment applied this month (positive). */
  extra: number;
  endingBalance: number;
  /** Annual rate in percent applied this month. */
  ratePct: number;
  /** Running total of interest paid through this month. */
  cumulativeInterest: number;
}

export interface AmortizationResult {
  rows: ScheduleRow[];
  totalInterest: number;
  totalPaid: number;
  totalExtra: number;
  /** 1-based month the balance reaches zero. */
  payoffMonth: number;
  /** First scheduled payment (magnitude). */
  firstPayment: number;
  /** Highest scheduled payment across the loan. */
  maxPayment: number;
  /** Lowest scheduled payment across the loan. */
  minPayment: number;
}

/** A per-scenario rate curve keyed by 1-based month. Returns an annual rate in percent. */
export type RateSchedule = (month: number) => number;

/**
 * Payment magnitude that fully amortizes `pv` over `nper` periods at periodic rate `r`.
 * Positive. Matches spreadsheet PMT (sign flipped to a positive outflow).
 */
export function pmt(r: number, nper: number, pv: number): number {
  if (nper <= 0) return 0;
  if (r === 0) return pv / nper;
  return (r * pv) / (1 - Math.pow(1 + r, -nper));
}

/**
 * Build the annual-rate-percent schedule for a scenario.
 * `overrideConstantPct` forces a flat rate (used for the band's min/base/max runs).
 */
export function buildRateSchedule(
  input: LoanInput,
  overrideConstantPct?: number,
): RateSchedule {
  if (overrideConstantPct !== undefined) {
    return () => overrideConstantPct;
  }
  if (input.rateType === "fixed") {
    const r = input.fixedRatePct ?? 0;
    return () => r;
  }
  // variable
  const base = input.baseRatePct ?? 0;
  if (input.variableStyle === "ramp") {
    const step = input.rampStepPct ?? 0.05;
    const every = Math.max(1, input.rampEveryMonths ?? 6);
    // Mirrors the sheet: rate steps up by `step` after each full `every`-month block.
    // month 1..every => base; month (every+1)..2*every => base+step; etc.
    return (month: number) => base + step * Math.floor(month / every);
  }
  // band without an override resolves to the base (expected) case
  return () => base;
}

/** Map extra payments to the 1-based month they apply (first month of their loan year). */
function extraByMonth(
  extras: ExtraPayment[] | undefined,
  termMonths: number,
): Map<number, number> {
  const map = new Map<number, number>();
  if (!extras) return map;
  for (const e of extras) {
    if (!e || e.amount <= 0) continue;
    const month = (e.loanYear - 1) * 12 + 1;
    if (month < 1 || month > termMonths) continue;
    map.set(month, (map.get(month) ?? 0) + e.amount);
  }
  return map;
}

/**
 * Run the month-by-month amortization for a single rate scenario.
 * Payment is recomputed each month over the remaining term, per the sheet.
 */
export function amortize(
  input: LoanInput,
  schedule: RateSchedule,
): AmortizationResult {
  const termMonths = Math.round(input.termYears * 12);
  const extras = extraByMonth(input.extraPayments, termMonths);
  const rows: ScheduleRow[] = [];

  let balance = input.principal;
  let cumulativeInterest = 0;
  let totalPaid = 0;
  let totalExtra = 0;
  let payoffMonth = termMonths;
  let firstPayment = 0;
  let maxPayment = 0;
  let minPayment = Number.POSITIVE_INFINITY;

  const EPS = 1e-6;

  for (let month = 1; month <= termMonths; month++) {
    if (balance <= EPS) break;

    const ratePct = schedule(month);
    const monthlyRate = ratePct / 100 / 12;
    const interest = balance * monthlyRate;
    const monthsRemaining = termMonths - month + 1;

    let payment = pmt(monthlyRate, monthsRemaining, balance);
    let extra = extras.get(month) ?? 0;

    // Principal reduction this month (payment covers interest first).
    let principalPaid = payment - interest;
    let endBalance = balance - principalPaid - extra;

    // Never overshoot past zero: cap extra, then payment, on the final month(s).
    if (endBalance < 0) {
      // First trim the extra payment, then the scheduled payment.
      const overshoot = -endBalance;
      if (extra >= overshoot) {
        extra -= overshoot;
      } else {
        payment -= overshoot - extra;
        extra = 0;
        principalPaid = payment - interest;
      }
      endBalance = 0;
    }

    if (month === 1) firstPayment = payment;
    if (payment > maxPayment) maxPayment = payment;
    if (payment < minPayment) minPayment = payment;

    cumulativeInterest += interest;
    totalPaid += payment + extra;
    totalExtra += extra;

    rows.push({
      year: Math.ceil(month / 12),
      month,
      beginningBalance: balance,
      interest,
      payment,
      extra,
      endingBalance: endBalance,
      ratePct,
      cumulativeInterest,
    });

    balance = endBalance;
    if (balance <= EPS) {
      payoffMonth = month;
      break;
    }
  }

  if (minPayment === Number.POSITIVE_INFINITY) minPayment = 0;

  return {
    rows,
    totalInterest: cumulativeInterest,
    totalPaid,
    totalExtra,
    payoffMonth,
    firstPayment,
    maxPayment,
    minPayment,
  };
}

export interface CalculationResult {
  /** The primary scenario (fixed rate, variable ramp, or band's base rate). */
  base: AmortizationResult;
  /** Present only for variable "band": optimistic (min) and pessimistic (max) runs. */
  band?: { min: AmortizationResult; max: AmortizationResult };
}

/**
 * Top-level entry: computes the primary scenario and, for a variable band,
 * the best-case (min rate) and worst-case (max rate) scenarios.
 */
export function calculate(input: LoanInput): CalculationResult {
  const base = amortize(input, buildRateSchedule(input));

  if (input.rateType === "variable" && input.variableStyle === "band") {
    const minRun = amortize(
      input,
      buildRateSchedule(input, input.minRatePct ?? input.baseRatePct ?? 0),
    );
    const maxRun = amortize(
      input,
      buildRateSchedule(input, input.maxRatePct ?? input.baseRatePct ?? 0),
    );
    return { base, band: { min: minRun, max: maxRun } };
  }

  return { base };
}
