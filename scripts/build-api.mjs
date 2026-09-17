import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(root, "api");
const outDir = join(apiDir, "dist");

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(apiDir, "src", "index.azure.ts")],
  bundle: true,
  outfile: join(outDir, "index.js"),
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: "linked",
  // The Functions runtime provides these from api/node_modules at startup;
  // the local prototype must never depend on them, and SWA installs the
  // api package.json deps when deploying.
  external: ["@azure/functions", "@azure/web-pubsub", "@azure/data-tables"],
  logLevel: "info",
});

// SWA managed functions load the entry point with require(), so the deployed
// bundle must be CommonJS even though api/package.json is "type": "module"
// (local dev runs the TypeScript sources as ESM). This nested package.json
// makes Node resolve dist/index.js as CommonJS.
writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

console.log("api built -> api/dist/index.js (commonjs)");