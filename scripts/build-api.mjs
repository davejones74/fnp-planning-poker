import { build } from "esbuild";
import { mkdirSync } from "node:fs";
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
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: "linked",
  // The Functions runtime provides these from api/node_modules at startup;
  // the local prototype must never depend on them, and SWA installs the
  // api package.json deps when deploying.
  external: ["@azure/functions", "@azure/web-pubsub", "@azure/data-tables"],
  logLevel: "info",
});

console.log("api built -> api/dist/index.js");