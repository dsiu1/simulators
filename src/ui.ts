import {
  calculate,
  type AmortizationResult,
  type CalculationResult,
  type ExtraPayment,
  type LoanInput,
  type ScheduleRow,
} from "./mortgage";

/* ── DOM helpers ──────────────────────────────────────────── */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/* ── Currency / formatting ────────────────────────────────── */
interface Currency {
  symbol: string;
  locale: string;
}

function currentCurrency(): Currency {
  const [symbol, locale] = ($("currency") as HTMLSelectElement).value.split("|");
  return { symbol: symbol === "none" ? "" : symbol, locale: locale || "en-US" };
}

function money(n: number, cur: Currency, decimals = 0): string {
  const num = new Intl.NumberFormat(cur.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.round(n * 10 ** decimals) / 10 ** decimals);
  return cur.symbol ? `${cur.symbol}${num}` : num;
}

function moneyCompact(n: number, cur: Currency): string {
  const num = new Intl.NumberFormat(cur.locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
  return cur.symbol ? `${cur.symbol}${num}` : num;
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function termLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (m === 0) return `${y} year${y === 1 ? "" : "s"}`;
  return `${y}y ${m}m`;
}

/* ── Segmented controls ───────────────────────────────────── */
function segmentValue(id: string): string {
  const active = $(id).querySelector<HTMLButtonElement>(".is-active");
  return active?.dataset.value ?? "";
}

function wireSegment(id: string, onChange: () => void): void {
  const group = $(id);
  group.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".segmented__btn",
    );
    if (!btn || btn.classList.contains("is-active")) return;
    group
      .querySelectorAll(".segmented__btn")
      .forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    onChange();
  });
}

/* ── Extra payments ───────────────────────────────────────── */
function makeExtraRow(): HTMLElement {
  // A Pico `role="group"` fieldset joins its direct-child controls into a
  // single seamless control, so the amount/year/remove inputs must be
  // siblings (not nested) for the border-joining CSS to apply.
  const row = document.createElement("fieldset");
  row.setAttribute("role", "group");
  row.className = "extra";
  row.innerHTML = `
    <input class="extra__amount figure" type="text" inputmode="numeric" placeholder="Amount" aria-label="Extra payment amount" />
    <input class="extra__year figure" type="number" min="1" step="1" value="1" placeholder="Year" aria-label="Loan year" />
    <button type="button" class="extra__remove outline contrast" aria-label="Remove extra payment">×</button>
  `;
  row.querySelector(".extra__remove")!.addEventListener("click", () => {
    row.remove();
    render();
  });
  return row;
}

function readExtras(): ExtraPayment[] {
  const out: ExtraPayment[] = [];
  $("extraList")
    .querySelectorAll<HTMLElement>(".extra")
    .forEach((row) => {
      const amount = parseNumber(
        row.querySelector<HTMLInputElement>(".extra__amount")!.value,
      );
      const loanYear = Math.max(
        1,
        Math.round(
          parseNumber(row.querySelector<HTMLInputElement>(".extra__year")!.value),
        ),
      );
      if (amount > 0) out.push({ amount, loanYear });
    });
  return out;
}

/* ── Read state from the form ─────────────────────────────── */
function readInput(): LoanInput {
  const rateType = segmentValue("rateType") as "fixed" | "variable";
  const variableStyle = segmentValue("variableStyle") as "ramp" | "band";
  const num = (id: string) => parseNumber(($(id) as HTMLInputElement).value);

  return {
    principal: num("principal"),
    termYears: Math.max(1, Math.round(num("termYears"))),
    rateType,
    fixedRatePct: num("fixedRatePct"),
    variableStyle,
    baseRatePct: variableStyle === "ramp" ? num("baseRateRamp") : num("baseRateBand"),
    rampStepPct: num("rampStepPct"),
    rampEveryMonths: Math.max(1, Math.round(num("rampEveryMonths"))),
    minRatePct: num("minRatePct"),
    maxRatePct: num("maxRatePct"),
    extraPayments: readExtras(),
  };
}

/* ── Reveal the right panes ───────────────────────────────── */
function updatePanes(input: LoanInput): void {
  const showPane = (sel: string, on: boolean) =>
    $("controls")
      .querySelector<HTMLElement>(`[data-pane="${sel}"]`)
      ?.classList.toggle("is-hidden", !on);
  showPane("fixed", input.rateType === "fixed");
  showPane("variable", input.rateType === "variable");
  showPane("ramp", input.rateType === "variable" && input.variableStyle === "ramp");
  showPane("band", input.rateType === "variable" && input.variableStyle === "band");
}

/* ── Readouts ─────────────────────────────────────────────── */
function renderReadouts(input: LoanInput, res: CalculationResult, cur: Currency) {
  const b = res.base;
  const isBand = input.rateType === "variable" && input.variableStyle === "band";
  const isRamp = input.rateType === "variable" && input.variableStyle === "ramp";

  let label = "Monthly payment";
  let paymentSub = `held for ${termLabel(b.payoffMonth)}`;
  if (isRamp) {
    label = "First payment";
    paymentSub = `rises to ${money(b.maxPayment, cur)}`;
  } else if (isBand && res.band) {
    label = "Expected payment";
    paymentSub = `best ${money(res.band.min.firstPayment, cur)} · worst ${money(
      res.band.max.firstPayment,
      cur,
    )}`;
  }

  $("paymentLabel").textContent = label;
  $("paymentValue").textContent = money(b.firstPayment, cur);
  $("paymentSub").textContent = paymentSub;

  $("interestValue").textContent = money(b.totalInterest, cur);
  $("interestSub").textContent =
    isBand && res.band
      ? `${money(res.band.min.totalInterest, cur)} – ${money(
          res.band.max.totalInterest,
          cur,
        )}`
      : `${((b.totalInterest / Math.max(1, input.principal)) * 100).toFixed(0)}% of principal`;

  $("totalValue").textContent = money(b.totalPaid, cur);
  $("payoffSub").textContent = b.totalExtra
    ? `incl. ${money(b.totalExtra, cur)} extra`
    : `paid off in ${termLabel(b.payoffMonth)}`;
}

/* ── Chart (SVG) ──────────────────────────────────────────── */
const W = 800;
const H = 400;
const PAD = { l: 58, r: 14, t: 12, b: 28 };

function balancePoints(res: AmortizationResult, principal: number): [number, number][] {
  const pts: [number, number][] = [[0, principal]];
  for (const r of res.rows) pts.push([r.month, r.endingBalance]);
  return pts;
}

function renderChart(input: LoanInput, res: CalculationResult, cur: Currency): void {
  const host = $("chart");
  const termMonths = input.termYears * 12;
  const yMax = Math.max(input.principal, 1);
  const xMax = Math.max(termMonths, 1);

  const px = (m: number) => PAD.l + (m / xMax) * (W - PAD.l - PAD.r);
  const py = (bal: number) => PAD.t + (1 - bal / yMax) * (H - PAD.t - PAD.b);

  const line = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(" ");

  const basePts = balancePoints(res.base, input.principal);
  const baseLine = line(basePts);
  const baseArea = `${baseLine} L${px(basePts[basePts.length - 1][0]).toFixed(1)} ${py(
    0,
  ).toFixed(1)} L${px(0).toFixed(1)} ${py(0).toFixed(1)} Z`;

  // gridlines + y labels (0, 25, 50, 75, 100%)
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = (yMax * i) / 4;
    const y = py(val).toFixed(1);
    grid += `<line class="chart__gridline" x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" />`;
    grid += `<text class="chart__axis-label" x="${PAD.l - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${moneyCompact(
      val,
      cur,
    )}</text>`;
  }
  // x labels (years)
  const yearStep = input.termYears <= 12 ? 2 : 5;
  for (let yr = 0; yr <= input.termYears; yr += yearStep) {
    const x = px(yr * 12).toFixed(1);
    grid += `<text class="chart__axis-label" x="${x}" y="${H - 8}" text-anchor="middle">${yr}y</text>`;
  }

  // band shading (best/worst)
  let band = "";
  if (input.rateType === "variable" && input.variableStyle === "band" && res.band) {
    const minPts = balancePoints(res.band.min, input.principal);
    const maxPts = balancePoints(res.band.max, input.principal);
    const bandPath = `${line(maxPts)} ${minPts
      .slice()
      .reverse()
      .map((p) => `L${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`)
      .join(" ")} Z`;
    band = `<path class="chart__band" d="${bandPath}" />
      <path class="chart__line-max" d="${line(maxPts)}" />
      <path class="chart__line-min" d="${line(minPts)}" />`;
  }

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Loan balance descending to zero over the term">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${grid}
      <path class="chart__area-base" d="${baseArea}" />
      ${band}
      <path class="chart__line-base" d="${baseLine}" />
      <line class="chart__cursor" id="chartCursor" x1="0" y1="${PAD.t}" x2="0" y2="${
        H - PAD.b
      }" style="opacity:0" />
      <circle class="chart__dot" id="chartDot" r="4" cx="0" cy="0" style="opacity:0" />
      <rect id="chartHit" x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${
        H - PAD.t - PAD.b
      }" fill="transparent" />
    </svg>
    <div class="chart__tip" id="chartTip"></div>
  `;

  renderLegend(input, res);
  wireChartHover(input, res, cur, { px, py, xMax });
}

function renderLegend(input: LoanInput, res: CalculationResult): void {
  const legend = $("chartLegend");
  const key = (color: string, text: string) =>
    `<span class="key"><span class="swatch" style="background:${color}"></span>${text}</span>`;
  if (input.rateType === "variable" && input.variableStyle === "band" && res.band) {
    legend.innerHTML =
      key("var(--accent)", "Expected") +
      key("var(--best)", "Best case") +
      key("var(--worst)", "Worst case");
  } else if (input.rateType === "variable" && input.variableStyle === "ramp") {
    legend.innerHTML = key("var(--accent)", `Balance · rate rising to ${res.base.rows.at(-1)?.ratePct.toFixed(2)}%`);
  } else {
    legend.innerHTML = key("var(--accent)", "Balance");
  }
}

interface Scales {
  px: (m: number) => number;
  py: (bal: number) => number;
  xMax: number;
}

function wireChartHover(
  input: LoanInput,
  res: CalculationResult,
  cur: Currency,
  s: Scales,
): void {
  const svg = $("chart").querySelector("svg")!;
  const hit = $("chartHit") as unknown as SVGRectElement;
  const cursor = $("chartCursor");
  const dot = $("chartDot");
  const tip = $("chartTip");
  const rows = res.base.rows;

  const toLocal = (clientX: number): number => {
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  };

  const move = (clientX: number) => {
    const localX = toLocal(clientX);
    const frac = Math.min(1, Math.max(0, (localX - PAD.l) / (W - PAD.l - PAD.r)));
    const month = Math.round(frac * s.xMax);
    const row = rows[Math.min(rows.length - 1, Math.max(0, month - 1))] as
      | ScheduleRow
      | undefined;
    const bal = month === 0 ? input.principal : row?.endingBalance ?? 0;
    const cx = s.px(month);
    const cy = s.py(bal);
    cursor.setAttribute("x1", String(cx));
    cursor.setAttribute("x2", String(cx));
    cursor.style.opacity = "1";
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.style.opacity = "1";
    const rect = svg.getBoundingClientRect();
    tip.style.left = `${(cx / W) * rect.width}px`;
    tip.style.top = `${(cy / H) * rect.height}px`;
    tip.classList.add("is-on");
    const yr = Math.ceil(Math.max(1, month) / 12);
    tip.innerHTML = `Year ${yr} · ${money(bal, cur)}<br>interest so far ${money(
      row?.cumulativeInterest ?? 0,
      cur,
    )}`;
  };

  const leave = () => {
    cursor.style.opacity = "0";
    dot.style.opacity = "0";
    tip.classList.remove("is-on");
  };

  hit.addEventListener("pointermove", (e) => move(e.clientX));
  hit.addEventListener("pointerleave", leave);
}

/* ── Schedule table ───────────────────────────────────────── */
function renderSchedule(res: CalculationResult, cur: Currency): void {
  const view = segmentValue("scheduleView"); // "year" | "month"
  const table = $("scheduleTable") as HTMLTableElement;
  const thead = table.querySelector("thead")!;
  const tbody = table.querySelector("tbody")!;

  const headCols =
    view === "year"
      ? ["Year", "Rate", "Payments", "Interest", "Extra", "End balance"]
      : ["Month", "Rate", "Payment", "Interest", "Extra", "End balance"];
  thead.innerHTML = `<tr>${headCols.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  const rows = res.base.rows;
  let body = "";

  if (view === "month") {
    for (const r of rows) {
      body += `<tr>
        <td>${r.month}</td>
        <td>${r.ratePct.toFixed(2)}%</td>
        <td>${money(r.payment, cur)}</td>
        <td class="cell-cost">${money(r.interest, cur)}</td>
        <td class="${r.extra ? "cell-extra" : ""}">${r.extra ? money(r.extra, cur) : "—"}</td>
        <td>${money(r.endingBalance, cur)}</td>
      </tr>`;
    }
  } else {
    // aggregate by loan year
    const years = new Map<number, { pay: number; int: number; extra: number; endBal: number; rate: number }>();
    for (const r of rows) {
      const y = years.get(r.year) ?? { pay: 0, int: 0, extra: 0, endBal: 0, rate: 0 };
      y.pay += r.payment;
      y.int += r.interest;
      y.extra += r.extra;
      y.endBal = r.endingBalance;
      y.rate = r.ratePct;
      years.set(r.year, y);
    }
    for (const [year, y] of years) {
      body += `<tr>
        <td>${year}</td>
        <td>${y.rate.toFixed(2)}%</td>
        <td>${money(y.pay, cur)}</td>
        <td class="cell-cost">${money(y.int, cur)}</td>
        <td class="${y.extra ? "cell-extra" : ""}">${y.extra ? money(y.extra, cur) : "—"}</td>
        <td>${money(y.endBal, cur)}</td>
      </tr>`;
    }
  }
  tbody.innerHTML = body;
}

/* ── Theme switcher (Pico's Auto/Light/Dark dropdown pattern) ── */
const THEME_KEY = "mc-theme";
type ThemePreference = "auto" | "light" | "dark";

function preferredScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readSavedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch (e) {
    // storage blocked
  }
  return "auto";
}

function applyPreference(pref: ThemePreference): void {
  document.documentElement.dataset.theme =
    pref === "auto" ? preferredScheme() : pref;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch (e) {
    // storage blocked — theme still applies for this session
  }
}

function initTheme(): void {
  let pref = readSavedPreference();
  applyPreference(pref);

  document
    .querySelectorAll<HTMLAnchorElement>("[data-theme-switcher]")
    .forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        pref = (link.dataset.themeSwitcher as ThemePreference) ?? "auto";
        applyPreference(pref);
        link.closest("details")?.removeAttribute("open");
      });
    });

  // Re-resolve if the system theme changes while "Auto" is selected.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (pref === "auto") applyPreference("auto");
    });
}

/* ── Main render ──────────────────────────────────────────── */
function render(): void {
  const input = readInput();
  updatePanes(input);
  const cur = currentCurrency();
  const res = calculate(input);
  renderReadouts(input, res, cur);
  renderChart(input, res, cur);
  renderSchedule(res, cur);
}

/* ── Wiring ───────────────────────────────────────────────── */
function init(): void {
  // reformat principal with grouping on blur
  const principal = $("principal") as HTMLInputElement;
  principal.addEventListener("blur", () => {
    const n = parseNumber(principal.value);
    principal.value = new Intl.NumberFormat("en-US").format(n);
    render();
  });

  $("controls").addEventListener("input", render);
  $("currency").addEventListener("change", render);

  wireSegment("rateType", render);
  wireSegment("variableStyle", render);
  wireSegment("scheduleView", render);

  initTheme();

  $("addExtra").addEventListener("click", () => {
    const row = makeExtraRow();
    $("extraList").appendChild(row);
    row.querySelector<HTMLInputElement>(".extra__amount")?.focus();
  });

  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
