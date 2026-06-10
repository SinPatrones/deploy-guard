import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "index.browser": "src/index.browser.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Las built-ins de Node nunca deben terminar en el bundle del navegador.
  external: ["node:os", "node:fs", "node:crypto"],
});
