import type { LoadedConfig } from "./config.js";

export type StackName = "Node.js" | "TypeScript" | "Python" | "Java" | "Go" | "Unknown";

export type StackConfidence = "high" | "medium" | "low";

export interface FileInventoryEntry {
  relativePath: string;
  absolutePath: string;
}

export interface FileInventory {
  rootPath: string;
  files: FileInventoryEntry[];
  ignoredDirectories: string[];
  maxFiles: number;
  truncated: boolean;
}

export interface StackEvidence {
  stack: StackName;
  marker: string;
}

export interface DetectedStack {
  primary: StackName;
  all: StackName[];
  confidence: StackConfidence;
  evidence: StackEvidence[];
}

export interface ScanContext {
  config: LoadedConfig;
  inventory: FileInventory;
  detectedStack: DetectedStack;
}
