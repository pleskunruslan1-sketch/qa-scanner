import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScanReport } from "../types/index.js";

export async function writeMarkdownReport(report: ScanReport, reportPath: string): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderMarkdown(report), "utf8");
}

function renderMarkdown(report: ScanReport): string {
  const lines = [
    "# QA Scanner Report",
    "",
    "## Summary",
    "",
    `Generated at: ${report.summary.generatedAt}`,
    "",
    "Detected stacks:",
    "",
    ...report.summary.detectedStack.all.map((stack) => `- ${stack}`),
    "",
    `Stack confidence: ${report.summary.detectedStack.confidence}`,
    "",
    "Stack detection evidence:",
    "",
    ...renderStackEvidence(report),
    "",
    "### Inventory",
    "",
    `Files scanned: ${report.summary.inventory.files.length}`,
    `Inventory truncated: ${report.summary.inventory.truncated ? "yes" : "no"}`,
    "",
    "Ignored directories:",
    "",
    ...report.summary.inventory.ignoredDirectories.map((directory) => `- ${directory}`),
    "",
    report.summary.narrative,
    "",
    "### Counts By Status",
    "",
    ...Object.entries(report.summary.byStatus).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "### Counts By Severity",
    "",
    ...Object.entries(report.summary.bySeverity).map(
      ([severity, count]) => `- ${severity}: ${count}`
    ),
    "",
    "## Findings",
    ""
  ];

  for (const finding of report.findings) {
    lines.push(
      `### ${finding.checkId}`,
      "",
      `- Category: ${finding.category}`,
      `- Status: ${finding.status}`,
      `- Severity: ${finding.severity}`,
      `- Finding: ${finding.finding}`,
      `- Recommendation: ${finding.recommendation}`
    );

    if (finding.skippedReason !== undefined) {
      lines.push(`- Skipped reason: ${finding.skippedReason}`);
    }

    lines.push("- Evidence:");

    if (finding.evidence.length === 0) {
      lines.push("  - None");
    } else {
      for (const evidence of finding.evidence) {
        lines.push(`  - ${evidence.label}: ${evidence.value}`);
      }
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderStackEvidence(report: ScanReport): string[] {
  if (report.summary.detectedStack.evidence.length === 0) {
    return ["- No known stack markers detected"];
  }

  return report.summary.detectedStack.evidence.map(
    (evidence) => `- ${evidence.stack}: ${evidence.marker}`
  );
}
