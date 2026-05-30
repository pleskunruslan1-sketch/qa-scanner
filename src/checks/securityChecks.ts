import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FileInventoryEntry, Finding, ScanContext } from "../types/index.js";

const MAX_EVIDENCE_ITEMS = 5;
const TEXT_FILE_EXTENSIONS = new Set([
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);
const ENV_FILE_PATTERN = /(^|\/)\.env($|\.)/;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRET_ASSIGNMENT_PATTERN =
  /(?:^|[^A-Za-z0-9])[\w.-]*(api[_-]?key|secret|token|password|passwd|private[_-]?key)[\w.-]*\s*[:=]\s*["']?[^"'\s]+/i;
const RISKY_VERSION_PATTERN = /"\s*(lodash|minimist|serialize-javascript|axios)\s*"\s*:\s*"\s*(\^|~)?(0\.|1\.|2\.|3\.|4\.0\.|4\.1[0-6]\.)/i;
const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"];

interface RedactedMatch {
  relativePath: string;
  lineNumber: number;
  type: string;
}

interface PackageJsonSecuritySummary {
  riskyVersions: RedactedMatch[];
  lifecycleScripts: RedactedMatch[];
}

export async function runSecurityChecks(context: ScanContext): Promise<Finding[]> {
  const envFiles = context.inventory.files.filter((file) => ENV_FILE_PATTERN.test(file.relativePath));
  const textFiles = context.inventory.files.filter(isReadableTextFile);
  const contentMatches = await collectContentMatches(textFiles);
  const packageSummary = await readPackageJsonSecuritySummary(context);

  return [
    createSecretAssignmentFinding(contentMatches.secretAssignments),
    createPrivateKeyFinding(contentMatches.privateKeys),
    createEnvFileFinding(envFiles),
    createLockfileRiskFinding(context),
    createRiskyVersionFinding(packageSummary.riskyVersions),
    createInstallLifecycleFinding(packageSummary.lifecycleScripts)
  ];
}

async function collectContentMatches(files: FileInventoryEntry[]): Promise<{
  secretAssignments: RedactedMatch[];
  privateKeys: RedactedMatch[];
}> {
  const secretAssignments: RedactedMatch[] = [];
  const privateKeys: RedactedMatch[] = [];

  for (const file of files) {
    const contents = await readFile(file.absolutePath, "utf8");
    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (secretAssignments.length < MAX_EVIDENCE_ITEMS && SECRET_ASSIGNMENT_PATTERN.test(line)) {
        secretAssignments.push({
          relativePath: file.relativePath,
          lineNumber: index + 1,
          type: "secret-like assignment"
        });
      }

      if (privateKeys.length < MAX_EVIDENCE_ITEMS && PRIVATE_KEY_PATTERN.test(line)) {
        privateKeys.push({
          relativePath: file.relativePath,
          lineNumber: index + 1,
          type: "private key marker"
        });
      }
    });
  }

  return { secretAssignments, privateKeys };
}

async function readPackageJsonSecuritySummary(
  context: ScanContext
): Promise<PackageJsonSecuritySummary> {
  const packageJson = context.inventory.files.find((file) => file.relativePath === "package.json");
  if (packageJson === undefined) {
    return {
      riskyVersions: [],
      lifecycleScripts: []
    };
  }

  const contents = await readFile(packageJson.absolutePath, "utf8");
  const lines = contents.split(/\r?\n/);
  const riskyVersions: RedactedMatch[] = [];
  const lifecycleScripts: RedactedMatch[] = [];

  lines.forEach((line, index) => {
    if (riskyVersions.length < MAX_EVIDENCE_ITEMS && RISKY_VERSION_PATTERN.test(line)) {
      riskyVersions.push({
        relativePath: packageJson.relativePath,
        lineNumber: index + 1,
        type: "heuristic dependency risk"
      });
    }

    for (const scriptName of INSTALL_LIFECYCLE_SCRIPTS) {
      if (
        lifecycleScripts.length < MAX_EVIDENCE_ITEMS &&
        new RegExp(`"${scriptName}"\\s*:`).test(line)
      ) {
        lifecycleScripts.push({
          relativePath: packageJson.relativePath,
          lineNumber: index + 1,
          type: `${scriptName} lifecycle script`
        });
      }
    }
  });

  return { riskyVersions, lifecycleScripts };
}

function createSecretAssignmentFinding(matches: RedactedMatch[]): Finding {
  if (matches.length === 0) {
    return pass(
      "security.secret-like-assignments",
      "No secret-like assignments were found in scanned text files.",
      "Continue keeping credentials out of source-controlled files.",
      []
    );
  }

  return warn(
    "security.secret-like-assignments",
    "Secret-like assignments were found. Values are redacted and this is a heuristic finding.",
    "Move real credentials to a secret manager or local environment and rotate any exposed values.",
    matches
  );
}

function createPrivateKeyFinding(matches: RedactedMatch[]): Finding {
  if (matches.length === 0) {
    return pass(
      "security.private-key-patterns",
      "No private key markers were found in scanned text files.",
      "Keep private keys out of the repository.",
      []
    );
  }

  return warn(
    "security.private-key-patterns",
    "Private key markers were found. Values are redacted and this is a heuristic finding.",
    "Remove private keys from source control and rotate affected credentials if real.",
    matches
  );
}

function createEnvFileFinding(envFiles: FileInventoryEntry[]): Finding {
  if (envFiles.length === 0) {
    return pass(
      "security.env-file-presence",
      "No .env files were found in the scanned target.",
      "Keep local environment files untracked.",
      []
    );
  }

  return warn(
    "security.env-file-presence",
    ".env-like files were found in the scanned target.",
    "Ensure env files are local-only and do not contain committed credentials.",
    envFiles.slice(0, MAX_EVIDENCE_ITEMS).map((file) => ({
      relativePath: file.relativePath,
      lineNumber: 1,
      type: ".env file presence"
    }))
  );
}

function createLockfileRiskFinding(context: ScanContext): Finding {
  const hasLockfile = context.inventory.files.some((file) =>
    ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "poetry.lock", "Pipfile.lock", "go.sum"].includes(
      file.relativePath
    )
  );

  if (hasLockfile) {
    return pass(
      "security.dependency-lockfile-risk",
      "A dependency lockfile was found, reducing heuristic dependency drift risk.",
      "Keep lockfiles committed and refreshed through trusted update workflows.",
      []
    );
  }

  return warn(
    "security.dependency-lockfile-risk",
    "No dependency lockfile was found; this is a heuristic dependency risk, not a confirmed vulnerability.",
    "Commit a lockfile when supported by the package manager to improve reproducibility.",
    []
  );
}

function createRiskyVersionFinding(matches: RedactedMatch[]): Finding {
  if (matches.length === 0) {
    return pass(
      "security.risky-dependency-version-patterns",
      "No heuristic dependency risk version patterns were found.",
      "Use dedicated dependency audit tooling later to confirm vulnerability status.",
      []
    );
  }

  return warn(
    "security.risky-dependency-version-patterns",
    "Heuristic dependency risk version patterns were found. This is not a confirmed vulnerability.",
    "Review the dependency with package-manager audit tooling before treating it as vulnerable.",
    matches
  );
}

function createInstallLifecycleFinding(matches: RedactedMatch[]): Finding {
  if (matches.length === 0) {
    return pass(
      "security.install-lifecycle-scripts",
      "No install lifecycle scripts were found in package.json.",
      "Review install lifecycle scripts carefully before adding them.",
      []
    );
  }

  return warn(
    "security.install-lifecycle-scripts",
    "Install lifecycle scripts were found in package.json.",
    "Review these scripts because install-time execution can increase supply-chain risk.",
    matches
  );
}

function pass(
  checkId: string,
  finding: string,
  recommendation: string,
  evidence: Finding["evidence"]
): Finding {
  return {
    checkId,
    category: "security",
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
  matches: RedactedMatch[]
): Finding {
  return {
    checkId,
    category: "security",
    status: "Warn",
    severity: "Low",
    finding,
    recommendation,
    evidence: matches.map((match) => ({
      label: match.type,
      value: `${match.relativePath}:${match.lineNumber}`
    }))
  };
}

function isReadableTextFile(file: FileInventoryEntry): boolean {
  const extension = path.extname(file.relativePath);

  return TEXT_FILE_EXTENSIONS.has(extension) || ENV_FILE_PATTERN.test(file.relativePath);
}
