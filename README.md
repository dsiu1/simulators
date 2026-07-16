# Mortgage Calculator

A single-page mortgage calculator, ported from a Google Sheet, hosted on GitHub
Pages. Everything runs in the browser — no data leaves your machine.

**[Open the calculator →](https://dsiu1.github.io/mortgage_calculator/)**

## How it works

Enter a loan amount, term, and rate, and the calculator produces a monthly
amortization schedule, a balance-descent chart, and summary totals for
payment, interest, and total paid.

**Rate type**

- **Fixed** — one annual rate for the life of the loan.
- **Variable · Ramp** — the rate starts at a base and steps up by a fixed
  amount every _N_ months (this mirrors the source spreadsheet's behavior).
- **Variable · Band** — an expected rate plus a best-case and worst-case
  rate, computed as three separate runs and shown as a shaded band on the
  chart.

**Extra payments**

Add a lump sum against a specific loan year (e.g. "¥2,000,000 in year 5").
Extra payments reduce the balance immediately, which lowers every future
payment — the payoff date doesn't change.

**The core rule (from the source sheet):** the payment is recomputed every
month as `PMT(current monthly rate, months remaining, current balance)`. Since
each payment re-amortizes whatever's left over whatever term remains, the loan
always finishes exactly on schedule — rate changes and extra payments move the
_payment amount_, never the payoff date. Month's interest is simply
`beginning balance × (annual rate / 100 / 12)`.

This math lives in [`src/mortgage.ts`](src/mortgage.ts), is pure/
framework-free, and is unit-tested against the source spreadsheet's real
numbers in [`src/mortgage.test.ts`](src/mortgage.test.ts).

A loan comparison feature (side-by-side scenarios) is planned but not yet
built; the code is structured so it can slot in later.

## Getting started

Requires [Node.js](https://nodejs.org/) 22+ and npm.

```bash
npm install          # install dependencies
npm run dev           # build + watch, served at http://localhost:8000
npm test              # run the test suite (vitest)
npm run typecheck     # tsc --noEmit
```

### Project layout

```
src/mortgage.ts       core amortization math (pure, unit-tested)
src/mortgage.test.ts  vitest suite, reconciled against the source spreadsheet
src/ui.ts             DOM wiring: inputs, chart, schedule table, theme toggle
src/styles.css        styling (light/dark themes)
index.html            entry point
build.mjs             esbuild build/dev-server script
.github/workflows/     CI + GitHub Pages deploy
```

## Build process

Production assets are bundled with [esbuild](https://esbuild.github.io/) via
`npm run build`, which outputs static HTML/CSS/JS into `dist/`. There's no
runtime framework — `src/ui.ts` is bundled directly to `dist/app.js`, and
`index.html` / `src/styles.css` are copied alongside it.

On every push to `main`, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
runs the test suite and type-check, builds `dist/`, and publishes it as a
GitHub Pages artifact. A build that fails tests or type-checking does not
deploy.

## Where it's hosted

The site is deployed automatically to **GitHub Pages** at
[dsiu1.github.io/mortgage_calculator](https://dsiu1.github.io/mortgage_calculator/),
via the Actions workflow above (Pages source: GitHub Actions). Every merge to
`main` re-deploys the live site.
