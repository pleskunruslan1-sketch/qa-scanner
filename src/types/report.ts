export type FindingStatus = "Pass" | "Warn" | "Fail" | "Skipped";

export type FindingSeverity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type FindingCategory =
  | "config"
  | "context"
  | "static"
  | "security"
  | "api"
  | "ui"
  | "ai"
  | "report";

export interface FindingEvidence {
  label: string;
  value: string;
}

export interface Finding {
  checkId: string;
  category: FindingCategory;
  status: FindingStatus;
  severity: FindingSeverity;
  finding: string;
  recommendation: string;
  evidence: FindingEvidence[];
  skippedReason?: string;
}

export interface ReportSummary {
  generatedAt: string;
  totalFindings: number;
  byStatus: Record<FindingStatus, number>;
  bySeverity: Record<FindingSeverity, number>;
}

export interface ScanReport {
  summary: ReportSummary;
  findings: Finding[];
}
