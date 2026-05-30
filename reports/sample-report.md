# QA Scanner Report

## Summary

Generated at: 2026-05-30T23:40:48.358Z

Detected stacks:

- Node.js
- TypeScript

Stack confidence: high

Stack detection evidence:

- Node.js: package.json
- TypeScript: tsconfig.json

### Inventory

Files scanned: 11
Inventory truncated: no

Ignored directories:

- node_modules
- dist
- build
- .git
- coverage
- .pnpm-store

QA scan detected Node.js, TypeScript with high confidence. 7 warning(s) and 2 skipped check(s) were reported. Runtime API and Playwright UI checks run only against configured localhost URLs; external AI review is optional and not required for the default sample run.

### Counts By Status

- Pass: 10
- Warn: 7
- Fail: 0
- Skipped: 2

### Counts By Severity

- Critical: 0
- High: 0
- Medium: 0
- Low: 7
- Info: 12

## Findings

### context.stack-detection

- Category: context
- Status: Pass
- Severity: Info
- Finding: Detected stacks: Node.js, TypeScript.
- Recommendation: Use the detected stack evidence to interpret stack-aware checks.
- Evidence:
  - confidence: high
  - Node.js: package.json
  - TypeScript: tsconfig.json

### static.readme

- Category: static
- Status: Pass
- Severity: Info
- Finding: README file is present.
- Recommendation: Keep setup and trade-offs current.
- Evidence:
  - file: README.md

### static.dependency-manifest

- Category: static
- Status: Pass
- Severity: Info
- Finding: Dependency manifest is present.
- Recommendation: Keep dependency metadata aligned with the detected stack.
- Evidence:
  - file: package.json

### static.lockfile

- Category: static
- Status: Warn
- Severity: Low
- Finding: No stack-relevant lockfile was found.
- Recommendation: Commit a lockfile when the package manager supports one.
- Evidence:
  - detectedStack: TypeScript

### static.gitignore

- Category: static
- Status: Pass
- Severity: Info
- Finding: .gitignore is present.
- Recommendation: Keep generated artifacts ignored.
- Evidence:
  - file: .gitignore

### static.ci-config

- Category: static
- Status: Pass
- Severity: Info
- Finding: CI configuration was found.
- Recommendation: Keep CI aligned with local validation commands.
- Evidence:
  - file: .github/workflows/ci.yml

### static.test-signal

- Category: static
- Status: Pass
- Severity: Info
- Finding: Test signal was found.
- Recommendation: Keep tests runnable from CI.
- Evidence:
  - packageScript: test
  - file: src/index.test.ts

### static.lint-format-signal

- Category: static
- Status: Pass
- Severity: Info
- Finding: Lint or formatting signal was found.
- Recommendation: Keep lint and formatting checks wired into local validation or CI.
- Evidence:
  - packageScript: lint or format
  - file: eslint.config.js

### static.stack-scope

- Category: static
- Status: Pass
- Severity: Info
- Finding: Node.js / TypeScript path receives enriched static checks.
- Recommendation: Continue using package scripts and manifests as the main quality signals.
- Evidence:
  - detectedStack: TypeScript

### security.secret-like-assignments

- Category: security
- Status: Warn
- Severity: Low
- Finding: Secret-like assignments were found. Values are redacted and this is a heuristic finding.
- Recommendation: Move real credentials to a secret manager or local environment and rotate any exposed values.
- Evidence:
  - secret-like assignment: .env.example:1
  - secret-like assignment: src/redaction-fixture.ts:2

### security.private-key-patterns

- Category: security
- Status: Pass
- Severity: Info
- Finding: No private key markers were found in scanned text files.
- Recommendation: Keep private keys out of the repository.
- Evidence:
  - None

### security.env-file-presence

- Category: security
- Status: Warn
- Severity: Low
- Finding: .env-like files were found in the scanned target.
- Recommendation: Ensure env files are local-only and do not contain committed credentials.
- Evidence:
  - .env file presence: .env.example:1

### security.dependency-lockfile-risk

- Category: security
- Status: Warn
- Severity: Low
- Finding: No dependency lockfile was found; this is a heuristic dependency risk, not a confirmed vulnerability.
- Recommendation: Commit a lockfile when supported by the package manager to improve reproducibility.
- Evidence:
  - None

### security.risky-dependency-version-patterns

- Category: security
- Status: Warn
- Severity: Low
- Finding: Heuristic dependency risk version patterns were found. This is not a confirmed vulnerability.
- Recommendation: Review the dependency with package-manager audit tooling before treating it as vulnerable.
- Evidence:
  - heuristic dependency risk: package.json:11

### security.install-lifecycle-scripts

- Category: security
- Status: Warn
- Severity: Low
- Finding: Install lifecycle scripts were found in package.json.
- Recommendation: Review these scripts because install-time execution can increase supply-chain risk.
- Evidence:
  - postinstall lifecycle script: package.json:6

### api.runtime-reachability

- Category: api
- Status: Skipped
- Severity: Info
- Finding: Runtime API URL was not reachable.
- Recommendation: Start the local API service or rely on static API fallback evidence until runtime is available.
- Skipped reason: fetch failed
- Evidence:
  - url: http://localhost:3000/health

### api.static-fallback

- Category: api
- Status: Pass
- Severity: Info
- Finding: Static API fallback evidence was found. This is static evidence, not runtime contract validation.
- Recommendation: Use these files to guide API contract checks until the configured runtime API is reachable.
- Evidence:
  - OpenAPI spec evidence: openapi.yaml
  - Node/TypeScript route evidence: src/routes.ts

### ui.runtime-reachability

- Category: ui
- Status: Skipped
- Severity: Info
- Finding: Runtime web URL was not reachable.
- Recommendation: Start the local UI service to enable Playwright checks.
- Skipped reason: fetch failed
- Evidence:
  - url: http://localhost:3000

### ai.test-gap-risk-inference

- Category: ai
- Status: Warn
- Severity: Low
- Finding: Offline AI fallback used deterministic test-gap and quality-risk inference. API specs/routes exist, but runtime API was unavailable in this sample run. 6 warning(s) suggest areas for manual QA review. 2 skipped runtime check(s) limit runtime confidence.
- Recommendation: Use this synthesis as a review prompt; confirm gaps with project owners before treating them as defects.
- Evidence:
  - mode: offline fallback
  - detectedStacks: Node.js, TypeScript
  - readmePresent: true
  - packageScripts: lint, postinstall, test
  - ciSignal: true
  - testSignal: true
  - lintSignal: true
  - apiFallbackEvidence: true
  - previousWarnings: 6
  - previousSkipped: 2

