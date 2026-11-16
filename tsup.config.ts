import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "next/index": "src/next/index.ts",
    "otel/index": "src/otel/index.ts",
    "browser/index": "src/browser/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: ["next", "react", "@vercel/otel"],
  define: { __EPIC_ANALYTICS_VERSION__: JSON.stringify(version) },
});
