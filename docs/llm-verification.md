# LLM Mode Verification

The default sample run uses offline fallback and costs nothing:

```bash
pnpm run scan -- --config qa-scanner.config.example.json
```

LLM mode is supported but optional. To test the OpenAI-compatible path locally, set an API key in your shell and use the LLM example config:

```bash
export OPENAI_API_KEY=your-local-key
pnpm run scan -- --config qa-scanner.config.llm.example.json
```

Do not commit API keys. Paid API usage may incur cost depending on provider, model, input size, and provider pricing.

If `OPENAI_API_KEY` is not set, the scanner should gracefully skip the LLM call and use fallback behavior. The default sample report intentionally uses offline fallback rather than paid LLM output so reviewers can run it without credentials.

Only sanitized metadata summaries are sent in LLM mode:

- detected stacks
- inventory counts
- short README excerpt
- package script names only
- CI/test/lint signals
- API fallback signal
- prior finding summaries

The scanner must not send:

- `.env` contents
- secrets
- tokens
- private keys
- cookies
- auth headers
- full source files
- full source trees

This file documents how to verify the LLM path. It does not include real LLM output.
