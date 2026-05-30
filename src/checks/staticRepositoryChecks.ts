import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, ScanContext, StackName } from "../types/index.js";

const NODE_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];
const PYTHON_LOCKFILES = ["poetry.lock", "Pipfile.lock"];
const JAVA_LOCKFILES = ["gradle.lockfile"];
const GO_LOCKFILES = ["go.sum"];
const README_FILES = ["README.md", "README.txt", "README"];
const LINT_FORMAT_FILES = [
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  "eslint.config.js",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  "biome.json"
];

interface PackageJsonSummary {
  hasTestScript: boolean;
  hasLintOrFormatScript: boolean;
}

export async function runStaticRepositoryChecks(context: ScanContext): Promise<Finding[]> {
  const fileSet = new Set(context.inventory.files.map((file) => normalizePath(file.relativePath)));
  const packageJson = await readPackageJsonSummary(context, fileSet);

  return [
    createStackDetectionFinding(context),
    createReadmeFinding(fileSet),
    createDependencyManifestFinding(context, fileSet),
    createLockfileFinding(context, fileSet),
    createGitignoreFinding(fileSet),
    createCiFinding(fileSet),
    createTestSignalFinding(fileSet, packageJson),
    createLintFormatFinding(fileSet, packageJson),
    createStackScopeFinding(context)
  ];
}

function createStackDetectionFinding(context: ScanContext): Finding {
  const stack = context.detectedStack;
  const evidence = stack.evidence.map((item) => ({
    label: item.stack,
    value: item.marker
  }));

  if (stack.primary === "Unknown") {
    return {
      checkId: "context.stack-detection",
      category: "context",
      status: "Warn",
      severity: "Low",
      finding: "No known stack markers were detected.",
      recommendation: "Add standard manifest files or document the project stack in the README.",
      evidence: [{ label: "confidence", value: stack.confidence }]
    };
  }

  return {
    checkId: "context.stack-detection",
    category: "context",
    status: "Pass",
    severity: "Info",
    finding: `Detected stacks: ${stack.all.join(", ")}.`,
    recommendation: "Use the detected stack evidence to interpret stack-aware checks.",
    evidence: [{ label: "confidence", value: stack.confidence }, ...evidence]
  };
}

function createReadmeFinding(fileSet: Set<string>): Finding {
  const readme = README_FILES.find((file) => fileSet.has(file));

  if (readme !== undefined) {
    return pass("static.readme", "README file is present.", "Keep setup and trade-offs current.", [
      { label: "file", value: readme }
    ]);
  }

  return warn(
    "static.readme",
    "No README file was found at the project root.",
    "Add a README with setup, architecture, and known gaps.",
    []
  );
}

function createDependencyManifestFinding(context: ScanContext, fileSet: Set<string>): Finding {
  const manifests = dependencyManifestMarkers(context.detectedStack.all).filter((file) =>
    fileSet.has(file)
  );

  if (manifests.length > 0) {
    return pass(
      "static.dependency-manifest",
      "Dependency manifest is present.",
      "Keep dependency metadata aligned with the detected stack.",
      manifests.map((file) => ({ label: "file", value: file }))
    );
  }

  return warn(
    "static.dependency-manifest",
    "No known dependency manifest was found.",
    "Add a standard dependency manifest for the project stack.",
    [{ label: "detectedStack", value: context.detectedStack.primary }]
  );
}

function createLockfileFinding(context: ScanContext, fileSet: Set<string>): Finding {
  const lockfiles = lockfileMarkers(context.detectedStack.all).filter((file) => fileSet.has(file));

  if (lockfiles.length > 0) {
    return pass(
      "static.lockfile",
      "Lockfile is present.",
      "Commit lockfiles to keep installs reproducible.",
      lockfiles.map((file) => ({ label: "file", value: file }))
    );
  }

  return warn(
    "static.lockfile",
    "No stack-relevant lockfile was found.",
    "Commit a lockfile when the package manager supports one.",
    [{ label: "detectedStack", value: context.detectedStack.primary }]
  );
}

function createGitignoreFinding(fileSet: Set<string>): Finding {
  if (fileSet.has(".gitignore")) {
    return pass("static.gitignore", ".gitignore is present.", "Keep generated artifacts ignored.", [
      { label: "file", value: ".gitignore" }
    ]);
  }

  return warn(
    "static.gitignore",
    "No .gitignore file was found at the project root.",
    "Add .gitignore entries for dependencies, builds, coverage, and local env files.",
    []
  );
}

function createCiFinding(fileSet: Set<string>): Finding {
  const ciFiles = [...fileSet].filter(
    (file) =>
      file.startsWith(".github/workflows/") ||
      file === ".gitlab-ci.yml" ||
      file === ".circleci/config.yml"
  );

  if (ciFiles.length > 0) {
    return pass(
      "static.ci-config",
      "CI configuration was found.",
      "Keep CI aligned with local validation commands.",
      ciFiles.map((file) => ({ label: "file", value: file }))
    );
  }

  return warn(
    "static.ci-config",
    "No CI configuration was found.",
    "Add CI that runs typecheck, build, and tests.",
    []
  );
}

function createTestSignalFinding(
  fileSet: Set<string>,
  packageJson: PackageJsonSummary | undefined
): Finding {
  const testFiles = [...fileSet].filter(
    (file) =>
      /(^|\/)(__tests__|tests?|spec)\//.test(file) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );

  if (packageJson?.hasTestScript === true || testFiles.length > 0) {
    return pass("static.test-signal", "Test signal was found.", "Keep tests runnable from CI.", [
      ...(packageJson?.hasTestScript === true ? [{ label: "packageScript", value: "test" }] : []),
      ...testFiles.slice(0, 5).map((file) => ({ label: "file", value: file }))
    ]);
  }

  return warn(
    "static.test-signal",
    "No obvious test signal was found.",
    "Add tests and expose them through a standard test command.",
    []
  );
}

function createLintFormatFinding(
  fileSet: Set<string>,
  packageJson: PackageJsonSummary | undefined
): Finding {
  const configFiles = LINT_FORMAT_FILES.filter((file) => fileSet.has(file));

  if (packageJson?.hasLintOrFormatScript === true || configFiles.length > 0) {
    return pass(
      "static.lint-format-signal",
      "Lint or formatting signal was found.",
      "Keep lint and formatting checks wired into local validation or CI.",
      [
        ...(packageJson?.hasLintOrFormatScript === true
          ? [{ label: "packageScript", value: "lint or format" }]
          : []),
        ...configFiles.map((file) => ({ label: "file", value: file }))
      ]
    );
  }

  return warn(
    "static.lint-format-signal",
    "No lint or formatting signal was found.",
    "Add lint or formatting configuration and run it in CI.",
    []
  );
}

function createStackScopeFinding(context: ScanContext): Finding {
  const primary = context.detectedStack.primary;

  if (primary === "TypeScript" || primary === "Node.js") {
    return pass(
      "static.stack-scope",
      "Node.js / TypeScript path receives enriched static checks.",
      "Continue using package scripts and manifests as the main quality signals.",
      [{ label: "detectedStack", value: primary }]
    );
  }

  if (primary === "Unknown") {
    return {
      checkId: "static.stack-scope",
      category: "static",
      status: "Warn",
      severity: "Info",
      finding: "Unknown stack receives generic static checks only.",
      recommendation: "Add recognizable stack markers to enable stack-aware recommendations.",
      evidence: [{ label: "detectedStack", value: primary }]
    };
  }

  return {
    checkId: "static.stack-scope",
    category: "static",
    status: "Pass",
    severity: "Info",
    finding: `${primary} receives lightweight stack-aware recommendations.`,
    recommendation: "Use stack-specific manifest and test conventions to improve scanner confidence.",
    evidence: [{ label: "detectedStack", value: primary }]
  };
}

async function readPackageJsonSummary(
  context: ScanContext,
  fileSet: Set<string>
): Promise<PackageJsonSummary | undefined> {
  if (!fileSet.has("package.json")) {
    return undefined;
  }

  const packageJsonPath = path.join(context.inventory.rootPath, "package.json");
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  const parsedPackageJson = JSON.parse(rawPackageJson) as {
    scripts?: Record<string, unknown>;
  };
  const scripts = parsedPackageJson.scripts ?? {};

  return {
    hasTestScript: typeof scripts.test === "string",
    hasLintOrFormatScript: typeof scripts.lint === "string" || typeof scripts.format === "string"
  };
}

function dependencyManifestMarkers(stacks: StackName[]): string[] {
  const markers = new Set<string>();

  if (stacks.includes("Node.js") || stacks.includes("TypeScript")) {
    markers.add("package.json");
  }
  if (stacks.includes("Python")) {
    markers.add("requirements.txt");
    markers.add("pyproject.toml");
  }
  if (stacks.includes("Java")) {
    markers.add("pom.xml");
    markers.add("build.gradle");
  }
  if (stacks.includes("Go")) {
    markers.add("go.mod");
  }
  if (stacks.includes("Unknown")) {
    ["package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "go.mod"].forEach(
      (marker) => markers.add(marker)
    );
  }

  return [...markers];
}

function lockfileMarkers(stacks: StackName[]): string[] {
  const markers = new Set<string>();

  if (stacks.includes("Node.js") || stacks.includes("TypeScript")) {
    NODE_LOCKFILES.forEach((file) => markers.add(file));
  }
  if (stacks.includes("Python")) {
    PYTHON_LOCKFILES.forEach((file) => markers.add(file));
  }
  if (stacks.includes("Java")) {
    JAVA_LOCKFILES.forEach((file) => markers.add(file));
  }
  if (stacks.includes("Go")) {
    GO_LOCKFILES.forEach((file) => markers.add(file));
  }
  if (stacks.includes("Unknown")) {
    [...NODE_LOCKFILES, ...PYTHON_LOCKFILES, ...JAVA_LOCKFILES, ...GO_LOCKFILES].forEach((file) =>
      markers.add(file)
    );
  }

  return [...markers];
}

function pass(
  checkId: string,
  finding: string,
  recommendation: string,
  evidence: Finding["evidence"]
): Finding {
  return {
    checkId,
    category: "static",
    status: "Pass",
    severity: "Info",
    finding,
    recommendation,
    evidence
  };
}

function warn(
  checkId: string,
  finding: string,
  recommendation: string,
  evidence: Finding["evidence"]
): Finding {
  return {
    checkId,
    category: "static",
    status: "Warn",
    severity: "Low",
    finding,
    recommendation,
    evidence
  };
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
