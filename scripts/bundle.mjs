import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  define: { WAVEAMP_VERSION: JSON.stringify(version) },
  outfile: "dist/extension.js",
  minify: true,
  legalComments: "none",
  logLevel: "info",
});

await build({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  outfile: "dist/webview.js",
  minify: true,
  legalComments: "none",
  logLevel: "info",
});

mkdirSync("dist", { recursive: true });
copyFileSync("vendor/faad2/faad.wasm", "dist/faad.wasm");
