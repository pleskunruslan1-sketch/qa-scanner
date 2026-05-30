import { opendir, lstat } from "node:fs/promises";
import path from "node:path";
import type {
  DetectedStack,
  FileInventory,
  FileInventoryEntry,
  LoadedConfig,
  ScanContext,
  StackEvidence,
  StackName
} from "../types/index.js";

const IGNORED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  ".pnpm-store"
];

const MAX_FILES = 2_000;

export async function createContext(config: LoadedConfig): Promise<ScanContext> {
  const inventory = await buildFileInventory(config.targetProjectPath);

  return {
    config,
    inventory,
    detectedStack: detectStack(inventory)
  };
}

async function buildFileInventory(rootPath: string): Promise<FileInventory> {
  const normalizedRoot = path.resolve(rootPath);
  const files: FileInventoryEntry[] = [];
  let truncated = false;

  await visitDirectory(normalizedRoot, normalizedRoot, files, () => {
    truncated = true;
  });

  return {
    rootPath: normalizedRoot,
    files,
    ignoredDirectories: IGNORED_DIRECTORIES,
    maxFiles: MAX_FILES,
    truncated
  };
}

async function visitDirectory(
  rootPath: string,
  currentPath: string,
  files: FileInventoryEntry[],
  markTruncated: () => void
): Promise<void> {
  ensureInsideRoot(rootPath, currentPath);

  if (files.length >= MAX_FILES) {
    markTruncated();
    return;
  }

  const directory = await opendir(currentPath);

  for await (const entry of directory) {
    if (files.length >= MAX_FILES) {
      markTruncated();
      return;
    }

    if (entry.isDirectory() && IGNORED_DIRECTORIES.includes(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    ensureInsideRoot(rootPath, absolutePath);

    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await visitDirectory(rootPath, absolutePath, files, markTruncated);
      continue;
    }

    if (stats.isFile()) {
      files.push({
        relativePath: path.relative(rootPath, absolutePath),
        absolutePath
      });
    }
  }
}

function ensureInsideRoot(rootPath: string, candidatePath: string): void {
  const relativePath = path.relative(rootPath, candidatePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to scan path outside targetProjectPath: ${candidatePath}`);
  }
}

function detectStack(inventory: FileInventory): DetectedStack {
  const fileSet = new Set(inventory.files.map((file) => normalizePath(file.relativePath)));
  const evidence: StackEvidence[] = [];

  addEvidence(fileSet, evidence, "Node.js", ["package.json"]);
  addEvidence(fileSet, evidence, "TypeScript", ["tsconfig.json"]);
  addEvidence(fileSet, evidence, "Python", ["requirements.txt", "pyproject.toml"]);
  addEvidence(fileSet, evidence, "Java", ["pom.xml", "build.gradle", "gradlew"]);
  addEvidence(fileSet, evidence, "Go", ["go.mod"]);

  const all = unique(evidence.map((item) => item.stack));
  if (all.length === 0) {
    return {
      primary: "Unknown",
      all: ["Unknown"],
      confidence: "low",
      evidence: []
    };
  }

  const primary = choosePrimaryStack(all);

  return {
    primary,
    all,
    confidence: evidence.length >= 2 ? "high" : "medium",
    evidence
  };
}

function addEvidence(
  fileSet: Set<string>,
  evidence: StackEvidence[],
  stack: StackName,
  markers: string[]
): void {
  for (const marker of markers) {
    if (fileSet.has(marker)) {
      evidence.push({ stack, marker });
    }
  }
}

function choosePrimaryStack(stacks: StackName[]): StackName {
  if (stacks.includes("TypeScript")) {
    return "TypeScript";
  }

  if (stacks.includes("Node.js")) {
    return "Node.js";
  }

  return stacks[0] ?? "Unknown";
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
