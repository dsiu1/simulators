// Build/dev script — bundles the app with esbuild and copies static assets to dist/.
//   node build.mjs           → one-off production build
//   node build.mjs --serve   → watch + local dev server on http://localhost:8000
import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";
const serve = process.argv.includes("--serve");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** Copy the HTML entry and stylesheet next to the bundled JS. */
async function copyStatic() {
  await cp("index.html", `${outdir}/index.html`);
  await cp("src/styles.css", `${outdir}/styles.css`);
}
await copyStatic();

const options = {
  entryPoints: ["src/ui.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: `${outdir}/app.js`,
  minify: !serve,
  sourcemap: serve,
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // Rebuild static assets on each change too.
  const { host, port } = await ctx.serve({ servedir: outdir, port: 8000 });
  console.log(`Dev server: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
} else {
  await esbuild.build(options);
  console.log(`Built ${outdir}/ — ready for GitHub Pages.`);
}
