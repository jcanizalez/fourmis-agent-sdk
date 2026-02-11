import { Glob } from "bun";

const glob = new Glob("**/*.ts");
const entries: string[] = [];
for await (const path of glob.scan({ cwd: "src" })) {
  entries.push(`src/${path}`);
}

const result = await Bun.build({
  entrypoints: entries,
  outdir: "dist",
  target: "bun",
  format: "esm",
  root: "src",
  packages: "external",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} files to dist/`);
