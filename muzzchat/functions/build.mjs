import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  outfile: "lib/index.js",
  format: "cjs",
  packages: "external",
  sourcemap: true,
  legalComments: "none",
});
