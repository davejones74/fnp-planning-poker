import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFrontend = join(root, "frontend");
const outDir = join(root, "dist", "frontend");

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(sourceFrontend, "src", "app.ts")],
  bundle: true,
  outfile: join(outDir, "app.js"),
  format: "iife",
  sourcemap: "linked",
  target: "es2020",
  logLevel: "info",
});

cpSync(join(sourceFrontend, "index.html"), join(outDir, "index.html"));
cpSync(join(sourceFrontend, "styles"), join(outDir, "styles"), { recursive: true });

const publicDir = join(sourceFrontend, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, outDir, { recursive: true });
}

console.log("frontend built -> dist/frontend");