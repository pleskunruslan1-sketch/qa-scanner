import type {
  DetectedStack,
  FileInventory,
  Finding,
  FindingSeverity,
  FindingStatus,
  ScanReport
} from "../types/index.js";

export function createReport(
  findings: Finding[],
  detectedStack: DetectedStack,
  inventory: FileInventory
): ScanReport {
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      totalFindings: findings.length,
      byStatus: countByStatus(findings),
      bySeverity: countBySeverity(findings),
      detectedStack,
      inventory,
      narrative: createNarrative(findings, detectedStack)
    },
    findings
  };
}

function createBaseStatusCounts(): Record<FindingStatus, number> {
  return {
    Pass: 0,
    Warn: 0,
    Fail: 0,
    Skipped: 0
  };
}

function createBaseSeverityCounts(): Record<FindingSeverity, number> {
  return {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Info: 0
  };
}

function countByStatus(findings: Finding[]): Record<FindingStatus, number> {
  const counts = createBaseStatusCounts();

  for (const finding of findings) {
    counts[finding.status] += 1;
  }

  return counts;
}

function countBySeverity(findings: Finding[]): Record<FindingSeverity, number> {
  const counts = createBaseSeverityCounts();

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

function createNarrative(findings: Finding[], detectedStack: DetectedStack): string {
  const warningCount = findings.filter((finding) => finding.status === "Warn").length;
  const skippedCount = findings.filter((finding) => finding.status === "Skipped").length;

  return `QA scan detected ${detectedStack.all.join(", ")} with ${detectedStack.confidence} confidence. ${warningCount} warning(s) and ${skippedCount} skipped check(s) were reported. Runtime API and Playwright UI checks run only against configured localhost URLs; external AI review is optional and not required for the default sample run.`;
}
