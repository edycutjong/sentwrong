/**
 * Pre-submission gate: no placeholders left, the README has every section a judge looks for, the stated test and
 * fixture counts match reality, the links resolve. Exit 1 on any failure. Runs in CI (no key, no network for the counts;
 * link checks are skipped when offline).
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// vitest ≥ 4 no longer guarantees clean JSON on stdout — ask for a file instead (works on every version)
const real = (() => {
  const file = join(tmpdir(), `sentwrong-vitest-${process.pid}.json`);
  try {
    execSync(`npx vitest run --reporter=json --outputFile=${file}`, { encoding: "utf8", stdio: "pipe" });
    const j = JSON.parse(readFileSync(file, "utf8"));
    return j.numTotalTests as number;
  } catch {
    return -1;
  } finally {
    try { unlinkSync(file); } catch { /* not written */ }
  }
})();
ok(real === testCount, `README says ${testCount} tests, vitest reports ${real === -1 ? "nothing (could not run vitest --reporter=json)" : real}`);
const fixtures = existsSync("fixtures") ? readdirSync("fixtures").filter((f) => f.endsWith(".json")).length : 0;
ok(readme.includes(`${fixtures} fixtures`) || readme.includes(`${fixtures}/${fixtures}`), `README fixture count does not match ${fixtures} files`);
// 3b. the property-test case count the README and JUDGE.md publish = NUM_RUNS × properties in the test file
const prop = readFileSync("packages/core/test/classify.property.test.ts", "utf8");
const runs = Number((/NUM_RUNS = ([\d_]+)/.exec(prop)?.[1] ?? "0").replace(/_/g, ""));
const props = (prop.match(/fc\.assert\(/g) ?? []).length;
const cases = (runs * props).toLocaleString("en-US");
ok(runs >= 10_000 && props >= 1, `property test: NUM_RUNS ${runs} × ${props} properties`);
ok(readme.includes(`${cases} generated`), `README does not state the property-test case count ${cases}`);
// 3c. JUDGE.md mirrors /judge and carries the same claim and counts as the README
const judge = readFileSync("JUDGE.md", "utf8");
const claim = /<em>(.+?)<\/em>/.exec(readme)?.[1] ?? "";
ok(claim.length > 20 && judge.includes(claim), "JUDGE.md does not carry the README's one-sentence claim verbatim");
ok(judge.includes(`${testCount} vitest tests`), `JUDGE.md test count differs from the README's ${testCount}`);
ok(judge.includes(`${cases} generated`), `JUDGE.md does not state the property-test case count ${cases}`);
const judgePage = readFileSync("apps/web/app/judge/page.tsx", "utf8");
ok(judgePage.includes(`${testCount} vitest tests`) && judgePage.includes(`${cases} generated`), "/judge page counts differ from the README");
ok(!/NANSEN_OFFLINE/.test(/pre className="cmd">\{`([\s\S]*?)`\}/.exec(judgePage)?.[1] ?? ""), "/judge reproduce command contains the offline flag");
// 4. screenshots referenced exist
for (const m of readme.matchAll(/docs\/screenshots\/([\w-]+\.png)/g)) ok(existsSync(`docs/screenshots/${m[1]}`), `screenshot ${m[1]} missing`);
// 5. required files
for (const f of ["LICENSE", "DEMO.md", "ARCHITECTURE.md", "JUDGE.md", "docs/SCORING.md", "docs/DX-REPORT.md", ".env.example", "playwright.config.ts", "lighthouserc.json", "e2e/judge-route.spec.ts", "e2e/key-boundary.spec.ts", ".github/workflows/ci.yml", ".github/workflows/codeql.yml", ".github/workflows/gitleaks.yml", ".github/workflows/release.yml", ".github/dependabot.yml", ".github/SECURITY.md", ".github/CONTRIBUTING.md", ".github/CODE_OF_CONDUCT.md", ".github/PULL_REQUEST_TEMPLATE.md", ".github/ISSUE_TEMPLATE/bug_report.md", ".github/ISSUE_TEMPLATE/feature_request.md"]) ok(existsSync(f), `${f} missing`);
// 6. no kitchen files, no key
for (const f of ["CLAUDE.md", "AGENTS.md", ".claude", "specs", "PROGRESS.md", "project.json", ".env"]) ok(!existsSync(f), `kitchen file ${f} present in the repo`);
ok(!/nsn_[a-z0-9]{20,}/i.test(execSync("git grep -I -h nsn_ -- . ':!README.md' || true", { encoding: "utf8" })), "an API key-looking string is in the tree");
// 7. links (skipped offline)
const links = [...new Set([...readme.matchAll(/https?:\/\/[^\s)>\]"]+/g)].map((m) => m[0]))].filter((u) => !u.includes("localhost"));
for (const u of links) {
  try { const code = execSync(`curl -s -o /dev/null -m 15 -w "%{http_code}" -L "${u}"`, { encoding: "utf8" }); if (code === "000") continue; // 403 = a bot-gated page (Cloudflare on app.nansen.ai) — reachable, just not by curl; 404 on GitHub = the private repo before the flip
    ok(code.startsWith("2") || code.startsWith("3") || code === "403" || (new URL(u).hostname === "github.com" && code === "404"), `link ${u} → ${code}`); }
  catch { /* offline */ }
}
if (fails.length) { console.error("✖ not ready:\n  " + fails.join("\n  ")); process.exit(1); }
console.log(`✔ submission-ready: ${testCount} tests, ${cases} property cases, ${fixtures} fixtures, ${links.length} links checked`);
