// bump-version.cjs <x.y.z> — set the version in the root package.json, every workspace package.json, and the matching
// package-lock.json entries (root "" + each workspace path). Offline, exact; npm ci stays satisfied.
const fs = require("fs"),
  path = require("path");
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || "")) {
  console.error("usage: bump-version.cjs x.y.z");
  process.exit(1);
}
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8")),
  write = (f, j) => fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
const root = read("package.json");
const globs = root.workspaces || [];
const dirs = [""]
  .concat(globs.flatMap((g) => (g.endsWith("/*") ? fs.readdirSync(g.slice(0, -2)).map((d) => path.posix.join(g.slice(0, -2), d)) : [g])))
  .filter((d) => fs.existsSync(path.join(d, "package.json")));
for (const d of dirs) {
  const f = path.join(d, "package.json");
  const j = read(f);
  j.version = v;
  write(f, j);
  console.log(`  ${f} -> ${v}`);
}
if (fs.existsSync("package-lock.json")) {
  const l = read("package-lock.json");
  l.version = v;
  for (const d of dirs) if (l.packages && l.packages[d]) l.packages[d].version = v;
  // lock entries that alias a workspace (node_modules/@scope/name → link:true) carry no version; nothing else to touch
  write("package-lock.json", l);
  console.log(`  package-lock.json -> ${v} (${dirs.length} entries)`);
}
