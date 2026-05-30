import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runApiChecks } from "../src/checks/apiChecks.js";
import { runSecurityChecks } from "../src/checks/securityChecks.js";
import { validateConfig } from "../src/config/validation.js";
import { assertSafeTargetRoot, ensureInsideRoot } from "../src/context/createContext.js";
import { createReport } from "../src/report/createReport.js";
import type { FileInventoryEntry, LoadedConfig, ScanContext } from "../src/types/index.js";

describe("high-risk scanner behavior", () => {
  it("rejects traversal outside targetProjectPath and obvious sensitive directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-scanner-root-"));

    expect(() => ensureInsideRoot(root, path.join(root, "..", "outside.txt"))).toThrow(
      /outside targetProjectPath/
    );
    expect(() => assertSafeTargetRoot(path.join(root, ".ssh"))).toThrow(/sensitive directory/);
  });

  it("rejects non-localhost runtime URLs", () => {
    expect(() =>
      validateConfig(
        {
          targetProjectPath: "./demo",
          reportPath: "./report.md",
          runtime: {
            apiUrl: "https://example.com/health"
          }
        },
        path.join(process.cwd(), "qa-scanner.config.test.json")
      )
    ).toThrow(/localhost or a loopback address/);
  });

  it("reports secret path, line, and type without exposing the value", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-scanner-secret-"));
    const secretFile = path.join(root, "fixture.ts");
    await writeFile(secretFile, 'export const API_KEY = "super-secret-value";\n', "utf8");

    const findings = await runSecurityChecks(
      createContextFixture(root, [{ relativePath: "fixture.ts", absolutePath: secretFile }])
    );
    const secretFinding = findings.find(
      (finding) => finding.checkId === "security.secret-like-assignments"
    );

    expect(secretFinding?.status).toBe("Warn");
    expect(secretFinding?.evidence).toContainEqual({
      label: "secret-like assignment",
      value: "fixture.ts:1"
    });
    expect(JSON.stringify(secretFinding)).not.toContain("super-secret-value");
  });

  it("counts report statuses and severities correctly", () => {
    const report = createReport(
      [
        finding("Pass", "Info"),
        finding("Warn", "Low"),
        finding("Fail", "High"),
        { ...finding("Skipped", "Info"), skippedReason: "not configured" }
      ],
      {
        primary: "Node.js",
        all: ["Node.js"],
        confidence: "medium",
        evidence: [{ stack: "Node.js", marker: "package.json" }]
      },
      {
        rootPath: "/tmp/project",
        files: [],
        ignoredDirectories: [],
        maxFiles: 2_000,
        truncated: false
      }
    );

    expect(report.summary.byStatus).toEqual({ Pass: 1, Warn: 1, Fail: 1, Skipped: 1 });
    expect(report.summary.bySeverity.High).toBe(1);
    expect(report.summary.bySeverity.Info).toBe(2);
  });

  it("skips unavailable runtime API and reports static fallback evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-scanner-api-"));
    const openApiFile = path.join(root, "openapi.yaml");
    await writeFile(openApiFile, "openapi: 3.0.3\n", "utf8");

    const findings = await runApiChecks(
      createContextFixture(root, [{ relativePath: "openapi.yaml", absolutePath: openApiFile }])
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "api.runtime-config",
          status: "Skipped",
          skippedReason: "runtime.apiUrl is missing from config."
        }),
        expect.objectContaining({
          checkId: "api.static-fallback",
          status: "Pass",
          evidence: expect.arrayContaining([
            { label: "OpenAPI spec evidence", value: "openapi.yaml" }
          ])
        })
      ])
    );
  });
});

function createContextFixture(rootPath: string, files: FileInventoryEntry[]): ScanContext {
  const config: LoadedConfig = {
    configPath: path.join(rootPath, "config.json"),
    configDir: rootPath,
    targetProjectPath: rootPath,
    reportPath: path.join(rootPath, "report.md"),
    runtime: {},
    ai: {
      enabled: false,
      provider: "offline"
    }
  };

  return {
    config,
    inventory: {
      rootPath,
      files,
      ignoredDirectories: [],
      maxFiles: 2_000,
      truncated: false
    },
    detectedStack: {
      primary: "Node.js",
      all: ["Node.js"],
      confidence: "medium",
      evidence: [{ stack: "Node.js", marker: "package.json" }]
    }
  };
}

function finding(status: "Pass" | "Warn" | "Fail" | "Skipped", severity: "Info" | "Low" | "High") {
  return {
    checkId: `test.${status.toLowerCase()}`,
    category: "static" as const,
    status,
    severity,
    finding: "Test finding",
    recommendation: "Test recommendation",
    evidence: []
  };
}
