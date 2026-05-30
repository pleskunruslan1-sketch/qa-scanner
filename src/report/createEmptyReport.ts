import type { FindingSeverity, FindingStatus, ScanReport } from "../types/index.js";

export function createEmptyReport(): ScanReport {
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      totalFindings: 0,
      byStatus: createStatusCounts(),
      bySeverity: createSeverityCounts()
    },
    findings: []
  };
}

function createStatusCounts(): Record<FindingStatus, number> {
  return {
    Pass: 0,
    Warn: 0,
    Fail: 0,
    Skipped: 0
  };
}

function createSeverityCounts(): Record<FindingSeverity, number> {
  return {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Info: 0
  };
}
