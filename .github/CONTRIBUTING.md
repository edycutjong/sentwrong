# Contributing

Thanks for your interest in improving Sent Wrong! 🎉

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install` (Node 20+)
3. Copy the env template: `cp .env.example .env.local` and put your Nansen key in it (https://app.nansen.ai/api)
4. Try the CLI: `npm run sentwrong -- 0xe460774c849089ee3edf0fb06da14c066caabbef --explain`
5. Start the web app: `npm run dev` → http://localhost:3000

## Before You Open a PR
- `npm run ci` passes — Prettier, ESLint, `tsc` for the engine and the web app, the 214 vitest tests with 100% coverage
  (unit, property-based, boundary), the offline fixture replay (`npm run verify`, 13/13), and the submission-readiness check.
- `npm run e2e` passes (Playwright; builds the web app and runs it **without** a key — nothing spends credits).
- Engine changes: add or update a test in `packages/core/test/`. Name a regression test after the defect it pins
  (`REGRESSION (…): what went wrong → what is now true`). If you change how a verdict is decided, update
  `docs/SCORING.md` and re-run `npm run verify` — a changed decision hash must be intentional (`npm run verify -- --update`
  rebuilds the fixture verdicts from the untouched recorded responses).
- Keep the README's numbers true: `npm run check:submission` fails when the stated test count drifts from the real one.
- Keep commits conventional — `feat:` / `fix:` / `perf:` (release a version), `docs:` / `test:` / `ci:` / `chore:` / `refactor:` (no release).

## Credits
Every live run costs Nansen credits (0–13 per verdict; `--deep` is 100 and never automatic). `npm run bench` costs ~400.
Recorded fixtures under `fixtures/` are byte-for-byte Nansen responses — never edit them by hand; re-record with `npm run seed`.

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include repro steps, expected vs.
actual behavior, and environment details. For a wrong verdict, include the address, the chain, and the decision hash
printed at the bottom of the output.
