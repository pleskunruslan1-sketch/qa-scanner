# QA Scanner

## Overview

QA Scanner is a local TypeScript CLI that inspects a configured project and produces a Markdown quality report. It is intended for engineers and QA leads who want a fast, reviewable snapshot of repository health, static security signals, local API/runtime observations, and basic browser smoke coverage.

The scanner is intentionally scoped for a take-home assignment. It is not an enterprise vulnerability platform, crawler, fuzzer, or full accessibility audit.

Supported stack handling:

- Node.js and TypeScript receive the richest checks.
- Python, Java, and Go receive lightweight stack detection and recommendations.
- Unknown stacks still receive generic static repository checks.

## Features

Static analysis:

- Stack detection from common project markers.
- Repository checks for README, dependency manifest, lockfile, `.gitignore`, CI, tests, and lint/format signals.
- Security heuristics for secret-like assignments, private key markers, `.env` files, lockfile risk, risky dependency version patterns, and install lifecycle scripts.

Runtime analysis:

- API checks use the configured local `runtime.apiUrl` only.
- API runtime checks observe status, latency, content type, JSON shape, CORS, disclosure headers, and basic security headers.
- Static API fallback discovers OpenAPI specs, route files, controller files, schema files, and common server files when the API is unavailable.
- Browser checks use Playwright against the configured local `runtime.webUrl` only.
- Browser checks cover page load, console errors, broken images, desktop/mobile smoke viewports, and a basic accessibility baseline.
- Browser checks include safe form discovery. The scanner counts forms but does not click buttons, submit forms, or mutate data.

AI review:

- The implemented AI review is test-gap and quality-risk inference from sanitized project metadata and scanner findings.
- AI is optional.
- The default mode is offline.
- The default sample run uses deterministic offline fallback and does not require external AI calls.

## Quick Start

```bash
pnpm install
pnpm run scan -- --config qa-scanner.config.example.json
```

The example config scans `examples/demo-project` and writes `reports/sample-report.md`.

## Example Config

`qa-scanner.config.example.json` contains:

- `targetProjectPath`: the local project to inspect. The example points to `./examples/demo-project`.
- `reportPath`: where the generated Markdown report is written. The example writes `./reports/sample-report.md`.
- `runtime.apiUrl`: optional local API URL for one safe runtime GET check.
- `runtime.webUrl`: optional local web URL for Playwright browser checks.
- `runtime.timeoutMs`: timeout for runtime API and web checks.
- `ai.enabled`: whether external AI review is enabled.
- `ai.provider`: `offline` by default.
- `ai.endpointUrl`: OpenAI-compatible chat completions endpoint used only when external AI mode is enabled.
- `ai.model`: model name used only when external AI mode is enabled.
- `ai.apiKeyEnv`: environment variable name for an optional paid AI provider key.

All target-specific URLs, ports, paths, credentials, report destinations, runtime timeouts, and AI settings come from config or environment variables.

## Architecture

```text
User
  |
  v
cli
  |
  v
config
  |
  v
context
  |
  +--> bounded file inventory
  +--> stack detection
  +--> path safety
  |
  v
checks
  |
  +--> static repository checks
  +--> static security checks
  +--> API runtime checks and static fallback
  +--> Playwright browser checks
  +--> AI test-gap and risk inference
  |
  v
report
  |
  v
reports/sample-report.md
```

Module responsibilities:

- `src/cli.ts`: parses `--config`, builds context, runs checks, and writes the report.
- `src/config`: loads and validates config, including localhost-only runtime URL validation.
- `src/context`: creates the bounded file inventory, rejects unsafe roots/traversal, and detects stacks.
- `src/checks`: contains static repository, security, API, UI, and AI check modules.
- `src/report`: aggregates findings and writes the Markdown report.
- `src/types`: shared config, context, finding, and report types.

Data flow:

1. Load config from `--config`.
2. Validate target paths and runtime URL safety.
3. Build a bounded inventory of the target project without executing target code.
4. Detect stack markers and confidence.
5. Run always-on static repository and security checks.
6. Run runtime API checks if configured and reachable; otherwise run static API fallback.
7. Run Playwright UI checks if configured and reachable; otherwise emit skipped findings.
8. Run AI/offline test-gap and quality-risk inference from sanitized metadata and previous findings.
9. Aggregate findings into a Markdown report.

## Requirement Coverage Matrix

| Requirement | Module | Verification method |
| --- | --- | --- |
| TypeScript implementation | `src/**/*.ts` | `pnpm run typecheck`, `pnpm run build` |
| Playwright browser checks | `src/checks/uiChecks.ts` | UI findings in generated report; Playwright dependency in `package.json` |
| Config-driven target values | `src/config` | `qa-scanner.config.example.json`, config validation tests |
| No hardcoded target URLs/ports/paths/credentials | `src/config`, `src/cli.ts` | Config example and validation |
| Static analysis always runs | `src/checks/staticRepositoryChecks.ts`, `src/checks/securityChecks.ts` | Generated report contains static findings |
| Graceful degradation | `src/checks/apiChecks.ts`, `src/checks/uiChecks.ts` | Skipped runtime findings with `skippedReason` |
| Security checks | `src/checks/securityChecks.ts` | Redaction unit test and report findings |
| API runtime checks | `src/checks/apiChecks.ts` | Runtime findings when local API is reachable |
| Static API fallback | `src/checks/apiChecks.ts` | Demo OpenAPI and route evidence in report |
| Browser runtime checks | `src/checks/uiChecks.ts` | Skipped UI finding when demo UI is not running |
| AI test-gap inference | `src/checks/aiChecks.ts` | AI/offline fallback finding in generated report |
| Report schema and summary | `src/report`, `src/types/report.ts` | Report aggregation unit test and generated report |
| Stack auto-detection bonus | `src/context/createContext.ts` | Demo report shows Node.js and TypeScript evidence |
| Sample report | `reports/sample-report.md` | Generated by scanner using `examples/demo-project` |
| Cursor process evidence | Separate screenshots/screencaps | Supplied separately per checklist |

## Security Model

Path safety:

- The scanner only inventories files under `targetProjectPath`.
- Traversal outside `targetProjectPath` is rejected.
- Obvious sensitive roots such as user home, `.ssh`, and system roots are rejected.
- High-noise/generated directories are ignored: `node_modules`, `dist`, `build`, `.git`, `coverage`, and `.pnpm-store`.
- Target project code is not executed.

Runtime safety:

- Runtime API and UI URLs must be localhost or loopback.
- The scanner does not crawl.
- The scanner does not perform port scanning.
- API checks use safe GET requests only.
- Browser checks navigate only to configured `runtime.webUrl`.
- Browser routing allows local, `data:`, `blob:`, and `about:blank` resources and aborts non-local HTTP/HTTPS requests where feasible.

Secret handling:

- Secret-like findings never print secret values.
- Evidence includes only relative file path, line number, and secret type.
- `.env` contents are not printed.

AI sanitization:

- External AI providers are optional and currently use the `openai-compatible` chat completions shape.
- Default mode is offline.
- If external AI is enabled, only sanitized metadata should be sent.
- No `.env` contents, tokens, secrets, private keys, cookies, auth headers, or full source trees should be sent.

## AI Component

The implemented AI component is test-gap and quality-risk inference. It is useful for synthesizing mixed signals such as README intent, package scripts, CI presence, route/spec evidence, runtime findings, and missing coverage areas.

Deterministic checks are strong for isolated facts: a lockfile exists, a route file exists, a header is missing, or a test script exists. They are weaker at interpreting whether those facts imply a coherent testing strategy or a meaningful QA gap. That synthesis is where AI can add value.

Current AI posture:

- AI is optional.
- Default mode is offline.
- The default sample run does not require paid AI credentials.
- To enable LLM mode, set `ai.enabled=true`, `ai.provider=openai-compatible`, `ai.endpointUrl`, `ai.model`, and `ai.apiKeyEnv`.
- Enabling external providers may incur cost depending on provider, model, and input size.
- Offline mode always emits an AI-related finding using deterministic synthesis.
- Only sanitized metadata should be sent to external providers.
- No `.env` contents are sent.
- No tokens are sent.
- No secrets are sent.
- No private keys are sent.
- No full source trees are sent.

Offline fallback:

- The scanner produces a useful AI-related finding without a paid provider.
- Non-AI findings remain deterministic and inspectable.
- The offline fallback uses detected stacks, README presence, package scripts, CI/test/lint signals, API fallback evidence, and previous findings.
- The default sample report shows offline fallback rather than paid LLM output so reviewers can run it without credentials.

## Trade-offs

- Node.js and TypeScript receive richer checks because the scanner itself is TypeScript-based and can reliably inspect package scripts, lockfiles, TypeScript config, and common route/spec conventions.
- Python, Java, and Go use lightweight detection to keep the implementation realistic for the assignment timebox.
- Accessibility is a baseline only: title, `html[lang]`, and image `alt` checks are useful smoke signals but not a full WCAG audit.
- Dependency analysis is heuristic. It identifies risk signals such as missing lockfiles, risky-looking version patterns, and install lifecycle scripts, but it does not claim confirmed vulnerabilities.

## Known Gaps

- No deep vulnerability scanning.
- No full accessibility audit.
- No authenticated runtime testing.
- No full API contract validation.
- No crawler, fuzzer, or multi-page browser journey support.
- No form submission automation; only safe form discovery is performed.
- No external AI call in the default sample run.

## Future Improvements

- SARIF output.
- Deeper language-specific analyzers.
- Authenticated runtime checks.
- Richer accessibility support.
- Expanded AI review.
- OpenAPI response schema validation.
- CI threshold mode.

## Validation

Commands used for validation:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run scan -- --config qa-scanner.config.example.json
```

The generated sample report is written to `reports/sample-report.md`.

## How I Would Evaluate This Scanner

The most important findings are those that are actionable and grounded in evidence: missing lockfiles, missing CI/test signals, redacted secret-like patterns, runtime unavailability, missing API specs/routes, and browser smoke failures.

Results should be interpreted as a local quality snapshot. Static security and dependency findings are heuristics and should be reviewed before being treated as confirmed issues. Runtime findings are observations from configured localhost endpoints, not production guarantees.

False positives should be reviewed by checking the reported file path, line number, and evidence type. The report intentionally avoids printing sensitive values, so follow-up review should happen locally in the codebase.

## Cursor-Assisted Development

Cursor was used for:

- Planning the implementation scope.
- Reviewing and tightening the architecture.
- Implementing scoped TODO milestones.
- Validating typecheck, build, tests, and scanner output.

All generated code and architecture decisions were manually reviewed and validated.

## Cursor Evidence Checklist

Screenshots and/or screencaps are supplied separately.

Checklist:

- Planning prompt.
- Architecture review.
- Revised plan.
- Implementation milestones.
- Validation run.
- Sample report generation.
