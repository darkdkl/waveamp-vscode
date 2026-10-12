import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { WAVEAMP_VERSION: JSON.stringify(version) },
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./test/vscodeStub.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
