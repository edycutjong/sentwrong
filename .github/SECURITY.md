# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## The boundary this project enforces — and tests
The only secret is the Nansen API key. It lives in the CLI process or the Next.js server, and **never reaches anything a
browser or a reader sees**:

- the verdict JSON, the NDJSON provenance stream (`/api/verdict`), the page HTML (`/`, `/judge`, `/q/<address>`),
  the OG image route and the client JS bundles carry no key-shaped string — asserted by
  `e2e/key-boundary.spec.ts` against the built app running **with no key at all**;
- the verdict object, the provenance rows, error messages and the recorded fixtures carry no key — asserted by
  `packages/core/test/boundary.test.ts`; an upstream error body that echoed the key would be redacted before it is
  recorded (`packages/core/src/client.ts`);
- the key is sent only as the `apikey` request header, never in a URL or body;
- without `NANSEN_API_KEY` the server refuses to build a client — there is no default or anonymous key;
- every malformed address is rejected **before any network call** (zero requests, zero credits), on the CLI, the API route
  and the share page.

Two scanners back this up: `gitleaks` over the full git history and TruffleHog (verified secrets only) in CI, and the
readiness check greps the tree for key-shaped strings on every run.

**The key cannot be drained through the public route** (`apps/web/lib/guard.ts`, `packages/core/test/guard.test.ts`):
6 requests per minute per address (**429** + `Retry-After`) and 3,000 live credits per UTC day counted from each
verdict's own total, after which the route answers an honest **503** before any Nansen call. Counters are per
instance — a ceiling, not accounting. Tunable with `GUARD_IP_PER_MIN` / `GUARD_DAILY_CREDITS`.

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead,
report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.
