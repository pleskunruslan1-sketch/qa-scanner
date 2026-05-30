import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, ScanContext } from "../types/index.js";

const SENSITIVE_TEXT_PATTERN =
  /(api[_-]?key|secret|token|password|passwd|private[_-]?key|cookie|authorization)/gi;
const README_EXCERPT_LIMIT = 600;
const FINDING_SUMMARY_LIMIT = 12;

interface SanitizedAiInput {
  detectedStacks: string[];
  inventory: {
    filesScanned: number;
    ignoredDirectories: string[];
    truncated: boolean;
  };
  readmePresent: boolean;
  readmeExcerpt: string;
  packageScriptNames: string[];
  signals: {
    ci: boolean;
    test: boolean;
    lint: boolean;
    apiFallbackEvidence: boolean;
  };
  previousFindings: Array<{
    checkId: string;
    category: string;
    status: string;
    severity: string;
    finding: string;
  }>;
}

export async function runAiChecks(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<Finding[]> {
  const provider = context.config.ai.provider ?? "offline";

  if (context.config.ai.enabled === true && provider === "openai-compatible") {
    return runOpenAiCompatibleCheck(context, previousFindings);
  }

  if (context.config.ai.enabled === true && provider !== "offline") {
    return [
      {
        checkId: "ai.llm-test-gap-risk-inference",
        category: "ai",
        status: "Skipped",
        severity: "Info",
        finding: "External LLM review was configured with an unsupported provider.",
        recommendation: "Use provider=offline or provider=openai-compatible.",
        evidence: [{ label: "provider", value: sanitize(provider) }],
        skippedReason: "Only openai-compatible external provider mode is implemented."
      }
    ];
  }

  const offlineFinding = await createOfflineInferenceFinding(context, previousFindings);

  return [offlineFinding];
}

async function runOpenAiCompatibleCheck(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<Finding[]> {
  const endpointUrl = context.config.ai.endpointUrl;
  const model = context.config.ai.model;
  const apiKeyEnv = context.config.ai.apiKeyEnv;

  if (endpointUrl === undefined || model === undefined || apiKeyEnv === undefined) {
    return [
      createExternalAiSkippedFinding(
        context,
        "External LLM review requires ai.endpointUrl, ai.model, and ai.apiKeyEnv."
      ),
      await createOfflineInferenceFinding(context, previousFindings)
    ];
  }

  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return [
      createExternalAiSkippedFinding(
        context,
        `Environment variable ${apiKeyEnv} is not set.`
      ),
      await createOfflineInferenceFinding(context, previousFindings)
    ];
  }

  try {
    const sanitizedInput = await buildSanitizedAiInput(context, previousFindings);
    const llmText = await callOpenAiCompatibleEndpoint(endpointUrl, model, apiKey, sanitizedInput);

    return [
      {
        checkId: "ai.llm-test-gap-risk-inference",
        category: "ai",
        status: llmText.trim().length > 0 ? "Warn" : "Pass",
        severity: llmText.trim().length > 0 ? "Low" : "Info",
        finding: sanitize(llmText).slice(0, 900),
        recommendation:
          "Use this LLM-derived synthesis as a review prompt; confirm gaps with project owners before treating them as defects.",
        evidence: [
          { label: "provider", value: "openai-compatible" },
          { label: "model", value: sanitize(model) },
          { label: "sanitizedInputSummary", value: summarizeSanitizedInput(sanitizedInput) },
          {
            label: "privacy",
            value: "Only sanitized metadata was sent; no secrets, .env contents, tokens, private keys, auth headers, full source files, or source trees were sent."
          }
        ]
      }
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM request error.";

    return [
      createExternalAiSkippedFinding(context, message),
      await createOfflineInferenceFinding(context, previousFindings)
    ];
  }
}

async function createOfflineInferenceFinding(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<Finding> {
  const sanitizedInput = await buildSanitizedAiInput(context, previousFindings);
  const packageScripts = sanitizedInput.packageScriptNames;
  const warningCount = previousFindings.filter((finding) => finding.status === "Warn").length;
  const skippedCount = previousFindings.filter((finding) => finding.status === "Skipped").length;
  const hasReadme = sanitizedInput.readmePresent;
  const hasCi = sanitizedInput.signals.ci;
  const hasTestSignal = sanitizedInput.signals.test;
  const hasLintSignal = sanitizedInput.signals.lint;

  const inferredRisks = [
    ...(hasReadme ? [] : ["README context is missing for reviewer onboarding."]),
    ...(hasCi ? [] : ["CI signal is missing, so quality checks may not be enforced automatically."]),
    ...(hasTestSignal ? [] : ["Test signal is missing, so regression coverage is unclear."]),
    ...(hasLintSignal ? [] : ["Lint or formatting signal is missing, so consistency checks may be manual."]),
    ...(sanitizedInput.signals.apiFallbackEvidence
      ? ["API specs/routes exist, but runtime API was unavailable in this sample run."]
      : []),
    ...(warningCount > 0
      ? [`${warningCount} warning(s) suggest areas for manual QA review.`]
      : []),
    ...(skippedCount > 0
      ? [`${skippedCount} skipped runtime check(s) limit runtime confidence.`]
      : [])
  ];

  const riskSummary =
    inferredRisks.length === 0
      ? "Offline fallback found no obvious test-gap pattern from sanitized metadata."
      : inferredRisks.slice(0, 4).join(" ");

  return {
    checkId: "ai.test-gap-risk-inference",
    category: "ai",
    status: inferredRisks.length === 0 ? "Pass" : "Warn",
    severity: inferredRisks.length === 0 ? "Info" : "Low",
    finding: `Offline AI fallback used deterministic test-gap and quality-risk inference. ${riskSummary}`,
    recommendation:
      "Use this synthesis as a review prompt; confirm gaps with project owners before treating them as defects.",
    evidence: [
      { label: "mode", value: "offline fallback" },
      { label: "detectedStacks", value: sanitize(context.detectedStack.all.join(", ")) },
      { label: "readmePresent", value: String(hasReadme) },
      { label: "packageScripts", value: sanitize(packageScripts.join(", ") || "none") },
      { label: "ciSignal", value: String(hasCi) },
      { label: "testSignal", value: String(hasTestSignal) },
      { label: "lintSignal", value: String(hasLintSignal) },
      { label: "apiFallbackEvidence", value: String(sanitizedInput.signals.apiFallbackEvidence) },
      { label: "previousWarnings", value: String(warningCount) },
      { label: "previousSkipped", value: String(skippedCount) }
    ]
  };
}

function createExternalAiSkippedFinding(context: ScanContext, skippedReason: string): Finding {
  return {
    checkId: "ai.llm-test-gap-risk-inference",
    category: "ai",
    status: "Skipped",
    severity: "Info",
    finding: "OpenAI-compatible LLM test-gap and quality-risk inference could not run.",
    recommendation:
      "Verify ai.provider, ai.endpointUrl, ai.model, and the configured API key environment variable, or use offline mode.",
    evidence: [
      { label: "provider", value: sanitize(context.config.ai.provider ?? "offline") },
      { label: "model", value: sanitize(context.config.ai.model ?? "not configured") },
      { label: "apiKeyEnv", value: context.config.ai.apiKeyEnv ?? "not configured" }
    ],
    skippedReason
  };
}

async function buildSanitizedAiInput(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<SanitizedAiInput> {
  const fileSet = new Set(context.inventory.files.map((file) => normalizePath(file.relativePath)));
  const packageScriptNames = await readPackageScripts(context);
  const readmeExcerpt = await readReadmeExcerpt(context);

  return {
    detectedStacks: context.detectedStack.all.map(sanitize),
    inventory: {
      filesScanned: context.inventory.files.length,
      ignoredDirectories: context.inventory.ignoredDirectories.map(sanitize),
      truncated: context.inventory.truncated
    },
    readmePresent: readmeExcerpt.length > 0,
    readmeExcerpt,
    packageScriptNames: packageScriptNames.map(sanitize),
    signals: {
      ci: [...fileSet].some((file) => file.startsWith(".github/workflows/")),
      test:
        packageScriptNames.includes("test") ||
        [...fileSet].some((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)),
      lint:
        packageScriptNames.includes("lint") ||
        packageScriptNames.includes("format") ||
        hasAny(fileSet, ["eslint.config.js", "eslint.config.mjs", "biome.json"]),
      apiFallbackEvidence: previousFindings.some(
        (finding) => finding.checkId === "api.static-fallback" && finding.status === "Pass"
      )
    },
    previousFindings: previousFindings.slice(0, FINDING_SUMMARY_LIMIT).map((finding) => ({
      checkId: sanitize(finding.checkId),
      category: finding.category,
      status: finding.status,
      severity: finding.severity,
      finding: sanitize(finding.finding)
    }))
  };
}

async function readReadmeExcerpt(context: ScanContext): Promise<string> {
  const readme = context.inventory.files.find((file) =>
    ["README.md", "README.txt", "README"].includes(file.relativePath)
  );

  if (readme === undefined) {
    return "";
  }

  const contents = await readFile(readme.absolutePath, "utf8");

  return sanitize(contents).slice(0, README_EXCERPT_LIMIT);
}

async function callOpenAiCompatibleEndpoint(
  endpointUrl: string,
  model: string,
  apiKey: string,
  sanitizedInput: SanitizedAiInput
): Promise<string> {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a QA lead. Analyze only the sanitized metadata provided. Do not infer secrets. Return concise QA risk synthesis."
        },
        {
          role: "user",
          content: `Identify probable missing QA coverage, maintainability risks, test strategy gaps, and prioritized next actions from this sanitized scanner summary:\n${JSON.stringify(
            sanitizedInput,
            null,
            2
          )}`
        }
      ],
      temperature: 0.2,
      max_tokens: 350
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("LLM response did not contain message content.");
  }

  return content;
}

function summarizeSanitizedInput(input: SanitizedAiInput): string {
  return `stacks=${input.detectedStacks.join(", ")}; files=${input.inventory.filesScanned}; scripts=${input.packageScriptNames.join(", ") || "none"}; ci=${input.signals.ci}; test=${input.signals.test}; lint=${input.signals.lint}; apiFallback=${input.signals.apiFallbackEvidence}; findings=${input.previousFindings.length}`;
}

async function readPackageScripts(context: ScanContext): Promise<string[]> {
  const packageJson = context.inventory.files.find((file) => file.relativePath === "package.json");
  if (packageJson === undefined) {
    return [];
  }

  const rawPackageJson = await readFile(packageJson.absolutePath, "utf8");
  const parsedPackageJson = JSON.parse(rawPackageJson) as {
    scripts?: Record<string, unknown>;
  };

  return Object.entries(parsedPackageJson.scripts ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([key]) => key)
    .sort();
}

function hasAny(fileSet: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => fileSet.has(candidate));
}

function sanitize(value: string): string {
  return value.replace(SENSITIVE_TEXT_PATTERN, "[redacted-keyword]");
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
