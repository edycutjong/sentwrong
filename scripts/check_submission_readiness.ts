/**
 * Pre-submission gate: no placeholders left, the README has every section a judge looks for, the stated test and
 * fixture counts match reality, the links resolve. Exit 1 on any failure. Runs in CI (no key, no network for the counts;
 * link checks are skipped when offline).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) fails.push(msg); };
const readme = readFileSync("README.md", "utf8");

// 1. placeholders
for (const p of ["TODO", "TBD", "lorem", "XXX", "<insert", "coming soon", "PLACEHOLDER"]) ok(!readme.toLowerCase().includes(p.toLowerCase()), `README contains placeholder "${p}"`);
// 2. sections
for (const h of ["## 💡 The Problem & Solution", "### The four routes", "## 🏗️ Architecture & Tech Stack", "## 🏆 Nansen Integration", "### Why only Nansen", "## 📊 Engineering Rigor", "### Honest limits (", "## 🚀 Getting Started", "### Runs in under 10 minutes", "## 🧪 Testing & CI", "### Benchmark", "## 📽️ Demo Materials", "## 📄 License"]) ok(readme.includes(h), `README missing section "${h}"`);
// 3. counts match
const testCount = Number(/(\d+) vitest tests/.exec(readme)?.[1] ?? 0);
const real = (() => { try { const out = execSync("npx vitest run --reporter=json 2>/dev/null", { encoding: "utf8" }); const j = JSON.parse(out.slice(out.indexOf("{"))); return j.numTotalTests as number; } catch { return -1; } })();
ok(real === testCount, `README says ${testCount} tests, vitest reports ${real === -1 ? "nothing (could not run vitest --reporter=json)" : real}`);
const fixtures = existsSync("fixtures") ? readdirSync("fixtures").filter((f) => f.endsWith(".json")).length : 0;
ok(readme.includes(`${fixtures} fixtures`) || readme.includes(`${fixtures}/${fixtures}`), `README fixture count does not match ${fixtures} files`);
// 4. screenshots referenced exist
for (const m of readme.matchAll(/docs\/screenshots\/([\w-]+\.png)/g)) ok(existsSync(`docs/screenshots/${m[1]}`), `screenshot ${m[1]} missing`);
// 5. required files
for (const f of ["LICENSE", "DEMO.md", "ARCHITECTURE.md", "docs/SCORING.md", "docs/DX-REPORT.md", ".github/workflows/ci.yml"]) ok(existsSync(f), `${f} missing`);
// 6. no kitchen files, no key
for (const f of ["CLAUDE.md", "AGENTS.md", ".claude", "specs", "PROGRESS.md", "project.json", ".env"]) ok(!existsSync(f), `kitchen file ${f} present in the repo`);
ok(!/nsn_[a-z0-9]{20,}/i.test(execSync("git grep -I -h nsn_ -- . ':!README.md' || true", { encoding: "utf8" })), "an API key-looking string is in the tree");
// 7. links (skipped offline)
const links = [...new Set([...readme.matchAll(/https?:\/\/[^\s)>\]"]+/g)].map((m) => m[0]))].filter((u) => !u.includes("localhost"));
for (const u of links) {
  try { const code = execSync(`curl -s -o /dev/null -m 15 -w "%{http_code}" -L "${u}"`, { encoding: "utf8" }); if (code === "000") continue; // 403 = a bot-gated page (Cloudflare on app.nansen.ai) — reachable, just not by curl; 404 on GitHub = the private repo before the flip
    ok(code.startsWith("2") || code.startsWith("3") || code === "403" || (u.includes("github.com") && code === "404"), `link ${u} → ${code}`); }
  catch { /* offline */ }
}
if (fails.length) { console.error("✖ not ready:\n  " + fails.join("\n  ")); process.exit(1); }
console.log(`✔ submission-ready: ${testCount} tests, ${fixtures} fixtures, ${links.length} links checked`);
