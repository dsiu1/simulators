import { describe, expect, test } from "vitest";
import {
  amortize,
  buildRateSchedule,
  calculate,
  pmt,
  type LoanInput,
} from "./mortgage";

const SHEET: LoanInput = {
  principal: 60_000_000,
  termYears: 35,
  rateType: "fixed",
  fixedRatePct: 0.43,
};

describe("pmt", () => {
  test("matches spreadsheet PMT for the sheet's first row", () => {
    // PMT(0.43/12/100, 420, 60,000,000) => 153,902.23 (magnitude)
    const p = pmt(0.43 / 12 / 100, 420, 60_000_000);
    expect(p).toBeCloseTo(153_902.2324, 2);
  });

  test("zero-rate loan splits principal evenly", () => {
    expect(pmt(0, 360, 360_000)).toBeCloseTo(1000, 6);
  });

  test("guards against non-positive term", () => {
    expect(pmt(0.01, 0, 1000)).toBe(0);
  });
});

describe("amortize (fixed rate)", () => {
  const result = amortize(SHEET, buildRateSchedule(SHEET));

  test("month 1 interest equals P * r (sheet D2 = 21,500)", () => {
    expect(result.rows[0].interest).toBeCloseTo(21_500, 2);
  });

  test("first payment matches the sheet (153,902.23)", () => {
    expect(result.firstPayment).toBeCloseTo(153_902.2324, 2);
  });

  test("pays off exactly at the end of the term with ~zero balance", () => {
    expect(result.payoffMonth).toBe(420);
    expect(result.rows.length).toBe(420);
    expect(result.rows[419].endingBalance).toBeCloseTo(0, 4);
  });

  test("payment is level when the rate is constant (re-amortization is stable)", () => {
    expect(result.minPayment).toBeCloseTo(result.maxPayment, 4);
  });

  test("principal is fully repaid (sum of principal + extras = P)", () => {
    const principalPaid = result.rows.reduce(
      (acc, r) => acc + (r.payment - r.interest) + r.extra,
      0,
    );
    expect(principalPaid).toBeCloseTo(SHEET.principal, 2);
  });

  test("total paid = principal + total interest", () => {
    expect(result.totalPaid).toBeCloseTo(
      SHEET.principal + result.totalInterest,
      2,
    );
  });
});

describe("variable — ramp schedule", () => {
  const rampInput: LoanInput = {
    ...SHEET,
    rateType: "variable",
    variableStyle: "ramp",
    baseRatePct: 0.43,
    rampStepPct: 0.05,
    rampEveryMonths: 6,
  };
  const schedule = buildRateSchedule(rampInput);

  test("steps up every 6 months, matching the sheet's MOD(B,6) rule", () => {
    expect(schedule(1)).toBeCloseTo(0.43, 10); // year start
    expect(schedule(5)).toBeCloseTo(0.43, 10);
    expect(schedule(6)).toBeCloseTo(0.48, 10); // first step
    expect(schedule(11)).toBeCloseTo(0.48, 10);
    expect(schedule(12)).toBeCloseTo(0.53, 10); // second step
  });

  test("rising rate makes later payments larger than the first", () => {
    const res = amortize(rampInput, schedule);
    expect(res.maxPayment).toBeGreaterThan(res.firstPayment);
    expect(res.payoffMonth).toBe(420); // still pays off at term end
  });
});

describe("variable — band", () => {
  const bandInput: LoanInput = {
    ...SHEET,
    rateType: "variable",
    variableStyle: "band",
    baseRatePct: 3,
    minRatePct: 2,
    maxRatePct: 5,
  };

  test("min-rate scenario costs less interest than max-rate scenario", () => {
    const { base, band } = calculate(bandInput);
    expect(band).toBeDefined();
    expect(band!.min.totalInterest).toBeLessThan(base.totalInterest);
    expect(band!.max.totalInterest).toBeGreaterThan(base.totalInterest);
  });
});

describe("extra payments (re-amortize, sheet behavior)", () => {
  const withExtra: LoanInput = {
    ...SHEET,
    extraPayments: [{ amount: 10_000_000, loanYear: 3 }],
  };

  test("lowers total interest but keeps the payoff at term end", () => {
    const without = amortize(SHEET, buildRateSchedule(SHEET));
    const withE = amortize(withExtra, buildRateSchedule(withExtra));

    expect(withE.totalInterest).toBeLessThan(without.totalInterest);
    expect(withE.payoffMonth).toBe(420);
    expect(withE.totalExtra).toBeCloseTo(10_000_000, 2);
  });

  test("payment drops after the lump sum is applied", () => {
    const withE = amortize(withExtra, buildRateSchedule(withExtra));
    const paymentBefore = withE.rows[10].payment; // month 11, year 1
    const paymentAfter = withE.rows[30].payment; // month 31, after year-3 lump
    expect(paymentAfter).toBeLessThan(paymentBefore);
  });

  test("principal + extras still sum to the original balance", () => {
    const withE = amortize(withExtra, buildRateSchedule(withExtra));
    const repaid = withE.rows.reduce(
      (acc, r) => acc + (r.payment - r.interest) + r.extra,
      0,
    );
    expect(repaid).toBeCloseTo(SHEET.principal, 2);
  });
});

describe("edge cases", () => {
  test("0% loan repays principal evenly with no interest", () => {
    const zero: LoanInput = {
      principal: 360_000,
      termYears: 30,
      rateType: "fixed",
      fixedRatePct: 0,
    };
    const res = amortize(zero, buildRateSchedule(zero));
    expect(res.totalInterest).toBeCloseTo(0, 6);
    expect(res.firstPayment).toBeCloseTo(1000, 6);
    expect(res.rows[359].endingBalance).toBeCloseTo(0, 4);
  });
});
