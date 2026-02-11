import { Glob } from "bun";

const glob = new Glob("**/*.d.ts");
for await (const path of glob.scan({ cwd: "dist" })) {
  const fullPath = `dist/${path}`;
  const content = await Bun.file(fullPath).text();
  const fixed = content.replace(/from\s+"(\.[^"]+)\.ts"/g, 'from "$1.js"');
  if (fixed !== content) {
    await Bun.write(fullPath, fixed);
  }
}
