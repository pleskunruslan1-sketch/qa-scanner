import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, ScanContext } from "../types/index.js";

const SENSITIVE_TEXT_PATTERN =
  /(api[_-]?key|secret|token|password|passwd|private[_-]?key|cookie|authorization)/gi;

export async function runAiChecks(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<Finding[]> {
  const provider = context.config.ai.provider ?? "offline";

  if (context.config.ai.enabled === true && provider !== "offline") {
    const apiKeyEnv = context.config.ai.apiKeyEnv;
    if (apiKeyEnv === undefined || process.env[apiKeyEnv] === undefined) {
      return [
        {
          checkId: "ai.test-gap-risk-inference",
          category: "ai",
          status: "Skipped",
          severity: "Info",
          finding: "External AI review was configured but could not run.",
          recommendation:
            "Set the configured AI API key environment variable or use the default offline provider.",
          evidence: [
            { label: "provider", value: sanitize(provider) },
            { label: "apiKeyEnv", value: apiKeyEnv ?? "not configured" }
          ],
          skippedReason: "External AI provider integration is not enabled without a configured API key."
        }
      ];
    }
  }

  const offlineFinding = await createOfflineInferenceFinding(context, previousFindings);

  return [offlineFinding];
}

async function createOfflineInferenceFinding(
  context: ScanContext,
  previousFindings: Finding[]
): Promise<Finding> {
  const fileSet = new Set(context.inventory.files.map((file) => normalizePath(file.relativePath)));
  const packageScripts = await readPackageScripts(context);
  const warningCount = previousFindings.filter((finding) => finding.status === "Warn").length;
  const skippedCount = previousFindings.filter((finding) => finding.status === "Skipped").length;
  const apiEvidenceCount = previousFindings.filter(
    (finding) => finding.checkId === "api.static-fallback" && finding.status === "Pass"
  ).length;
  const hasReadme = hasAny(fileSet, ["README.md", "README.txt", "README"]);
  const hasCi = [...fileSet].some((file) => file.startsWith(".github/workflows/"));
  const hasTestSignal =
    packageScripts.includes("test") ||
    [...fileSet].some((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  const hasLintSignal =
    packageScripts.includes("lint") ||
    packageScripts.includes("format") ||
    hasAny(fileSet, ["eslint.config.js", "eslint.config.mjs", "biome.json"]);

  const inferredRisks = [
    ...(hasReadme ? [] : ["README context is missing for reviewer onboarding."]),
    ...(hasCi ? [] : ["CI signal is missing, so quality checks may not be enforced automatically."]),
    ...(hasTestSignal ? [] : ["Test signal is missing, so regression coverage is unclear."]),
    ...(hasLintSignal ? [] : ["Lint or formatting signal is missing, so consistency checks may be manual."]),
    ...(apiEvidenceCount > 0
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
      { label: "apiFallbackEvidence", value: String(apiEvidenceCount > 0) },
      { label: "previousWarnings", value: String(warningCount) },
      { label: "previousSkipped", value: String(skippedCount) }
    ]
  };
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
