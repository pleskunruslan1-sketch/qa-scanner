import path from "node:path";
import type { FileInventoryEntry, Finding, ScanContext } from "../types/index.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_EVIDENCE_ITEMS = 10;

interface RuntimeAttempt {
  available: boolean;
  findings: Finding[];
}

interface RuntimeApiObservation {
  statusCode: number;
  latencyMs: number;
  contentType: string | null;
  headers: Headers;
  bodyText: string;
}

export async function runApiChecks(context: ScanContext): Promise<Finding[]> {
  const runtimeAttempt = await runRuntimeApiChecks(context);

  if (runtimeAttempt.available) {
    return runtimeAttempt.findings;
  }

  return [...runtimeAttempt.findings, createStaticFallbackFinding(context)];
}

async function runRuntimeApiChecks(context: ScanContext): Promise<RuntimeAttempt> {
  const apiUrl = context.config.runtime.apiUrl;

  if (apiUrl === undefined) {
    return {
      available: false,
      findings: [
        {
          checkId: "api.runtime-config",
          category: "api",
          status: "Skipped",
          severity: "Info",
          finding: "Runtime API URL is not configured.",
          recommendation: "Set runtime.apiUrl to enable safe local API runtime checks.",
          evidence: [],
          skippedReason: "runtime.apiUrl is missing from config."
        }
      ]
    };
  }

  try {
    const observation = await fetchRuntimeApi(apiUrl, context.config.runtime.timeoutMs);

    return {
      available: true,
      findings: [
        createStatusFinding(observation),
        createLatencyFinding(observation, context.config.runtime.timeoutMs),
        createContentTypeFinding(observation),
        createJsonShapeFinding(observation),
        createCorsFinding(observation),
        createTechnologyDisclosureFinding(observation),
        createSecurityHeadersFinding(observation)
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runtime API error.";

    return {
      available: false,
      findings: [
        {
          checkId: "api.runtime-reachability",
          category: "api",
          status: "Skipped",
          severity: "Info",
          finding: "Runtime API URL was not reachable.",
          recommendation:
            "Start the local API service or rely on static API fallback evidence until runtime is available.",
          evidence: [{ label: "url", value: apiUrl }],
          skippedReason: message
        }
      ]
    };
  }
}

async function fetchRuntimeApi(
  apiUrl: string,
  configuredTimeoutMs: number | undefined
): Promise<RuntimeApiObservation> {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual"
    });
    const bodyText = await response.text();

    return {
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      contentType: response.headers.get("content-type"),
      headers: response.headers,
      bodyText
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createStatusFinding(observation: RuntimeApiObservation): Finding {
  const isHealthy = observation.statusCode >= 200 && observation.statusCode < 400;

  return {
    checkId: "api.runtime-status",
    category: "api",
    status: isHealthy ? "Pass" : "Warn",
    severity: isHealthy ? "Info" : "Low",
    finding: `Runtime API responded with HTTP ${observation.statusCode}.`,
    recommendation: isHealthy
      ? "Keep the configured health or smoke endpoint stable."
      : "Review the configured API endpoint and expected status code.",
    evidence: [{ label: "statusCode", value: String(observation.statusCode) }]
  };
}

function createLatencyFinding(
  observation: RuntimeApiObservation,
  configuredTimeoutMs: number | undefined
): Finding {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    checkId: "api.runtime-latency",
    category: "api",
    status: observation.latencyMs <= timeoutMs ? "Pass" : "Warn",
    severity: observation.latencyMs <= timeoutMs ? "Info" : "Low",
    finding: `Runtime API responded in ${observation.latencyMs}ms.`,
    recommendation: "Use this as a basic local latency baseline, not a performance test.",
    evidence: [
      { label: "latencyMs", value: String(observation.latencyMs) },
      { label: "timeoutMs", value: String(timeoutMs) }
    ]
  };
}

function createContentTypeFinding(observation: RuntimeApiObservation): Finding {
  const contentType = observation.contentType ?? "not provided";

  return {
    checkId: "api.runtime-content-type",
    category: "api",
    status: observation.contentType === null ? "Warn" : "Pass",
    severity: observation.contentType === null ? "Low" : "Info",
    finding: `Runtime API content type is ${contentType}.`,
    recommendation: "Return an explicit content type so clients can parse responses reliably.",
    evidence: [{ label: "contentType", value: contentType }]
  };
}

function createJsonShapeFinding(observation: RuntimeApiObservation): Finding {
  if (!isJsonResponse(observation)) {
    return {
      checkId: "api.runtime-json-shape",
      category: "api",
      status: "Skipped",
      severity: "Info",
      finding: "Runtime API response is not JSON.",
      recommendation: "Use JSON on API smoke endpoints when response-shape checks are desired.",
      evidence: [{ label: "contentType", value: observation.contentType ?? "not provided" }],
      skippedReason: "Response content type is not JSON."
    };
  }

  try {
    const parsedBody = JSON.parse(observation.bodyText) as unknown;
    const shape = Array.isArray(parsedBody)
      ? "array"
      : parsedBody !== null && typeof parsedBody === "object"
        ? `object with ${Object.keys(parsedBody).length} top-level key(s)`
        : typeof parsedBody;

    return {
      checkId: "api.runtime-json-shape",
      category: "api",
      status: "Pass",
      severity: "Info",
      finding: `Runtime API returned JSON ${shape}.`,
      recommendation: "Add schema validation later if this endpoint has a stable contract.",
      evidence: [{ label: "shape", value: shape }]
    };
  } catch {
    return {
      checkId: "api.runtime-json-shape",
      category: "api",
      status: "Warn",
      severity: "Low",
      finding: "Runtime API declared JSON but response parsing failed.",
      recommendation: "Verify the endpoint returns valid JSON for the configured API URL.",
      evidence: [{ label: "contentType", value: observation.contentType ?? "not provided" }]
    };
  }
}

function createCorsFinding(observation: RuntimeApiObservation): Finding {
  const corsHeader = observation.headers.get("access-control-allow-origin");
  const isWildcard = corsHeader === "*";

  return {
    checkId: "security.runtime-cors",
    category: "security",
    status: isWildcard ? "Warn" : "Pass",
    severity: isWildcard ? "Low" : "Info",
    finding: isWildcard
      ? "Wildcard CORS was directly observed on the runtime API response."
      : "Wildcard CORS was not observed on the runtime API response.",
    recommendation: isWildcard
      ? "Review whether wildcard CORS is appropriate for the local API endpoint."
      : "Continue validating CORS behavior in environment-specific tests.",
    evidence: [{ label: "access-control-allow-origin", value: corsHeader ?? "not provided" }]
  };
}

function createTechnologyDisclosureFinding(observation: RuntimeApiObservation): Finding {
  const poweredBy = observation.headers.get("x-powered-by");
  const server = observation.headers.get("server");
  const hasDisclosure = poweredBy !== null || isSpecificServerHeader(server);

  return {
    checkId: "security.runtime-technology-disclosure",
    category: "security",
    status: hasDisclosure ? "Warn" : "Pass",
    severity: hasDisclosure ? "Low" : "Info",
    finding: hasDisclosure
      ? "Technology disclosure headers were directly observed on the runtime API response."
      : "No obvious technology disclosure headers were observed on the runtime API response.",
    recommendation:
      "Review whether response headers expose more implementation detail than intended.",
    evidence: [
      { label: "x-powered-by", value: poweredBy ?? "not provided" },
      { label: "server", value: server ?? "not provided" }
    ]
  };
}

function createSecurityHeadersFinding(observation: RuntimeApiObservation): Finding {
  const headerNames = [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options"
  ];
  const missingHeaders = headerNames.filter((headerName) => observation.headers.get(headerName) === null);

  return {
    checkId: "security.runtime-basic-headers",
    category: "security",
    status: missingHeaders.length === 0 ? "Pass" : "Warn",
    severity: missingHeaders.length === 0 ? "Info" : "Low",
    finding:
      missingHeaders.length === 0
        ? "Basic security headers were observed on the runtime API response."
        : "Some basic security headers were not observed on the runtime API response.",
    recommendation:
      "Treat this as a local runtime header observation and confirm expected headers per environment.",
    evidence: headerNames.map((headerName) => ({
      label: headerName,
      value: observation.headers.get(headerName) === null ? "not provided" : "provided"
    }))
  };
}

function createStaticFallbackFinding(context: ScanContext): Finding {
  const evidence = findStaticApiEvidence(context.inventory.files);

  if (evidence.length === 0) {
    return {
      checkId: "api.static-fallback",
      category: "api",
      status: "Skipped",
      severity: "Info",
      finding: "No static API fallback evidence was found.",
      recommendation: "Configure runtime.apiUrl or provide API specs, routes, schemas, or server files.",
      evidence: [],
      skippedReason: "Runtime API unavailable and no static API evidence was detected."
    };
  }

  return {
    checkId: "api.static-fallback",
    category: "api",
    status: "Pass",
    severity: "Info",
    finding:
      "Static API fallback evidence was found. This is static evidence, not runtime contract validation.",
    recommendation:
      "Use these files to guide API contract checks until the configured runtime API is reachable.",
    evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS)
  };
}

function findStaticApiEvidence(files: FileInventoryEntry[]): Finding["evidence"] {
  const evidence: Finding["evidence"] = [];

  for (const file of files) {
    const normalizedPath = normalizePath(file.relativePath);
    const basename = path.basename(normalizedPath).toLowerCase();

    if (isOpenApiFile(normalizedPath, basename)) {
      evidence.push({ label: "OpenAPI file", value: normalizedPath });
      continue;
    }

    if (isRouteFile(normalizedPath, basename)) {
      evidence.push({ label: "route file", value: normalizedPath });
      continue;
    }

    if (basename.includes("controller")) {
      evidence.push({ label: "controller file", value: normalizedPath });
      continue;
    }

    if (basename.includes("schema") || basename.endsWith(".graphql")) {
      evidence.push({ label: "schema file", value: normalizedPath });
      continue;
    }

    if (isCommonApiServerFile(normalizedPath, basename)) {
      evidence.push({ label: "common API/server file", value: normalizedPath });
    }
  }

  return evidence;
}

function isOpenApiFile(filePath: string, basename: string): boolean {
  return (
    basename.startsWith("openapi.") ||
    basename.startsWith("swagger.") ||
    filePath.includes("/openapi/") ||
    filePath.includes("/swagger/")
  );
}

function isRouteFile(filePath: string, basename: string): boolean {
  return basename.includes("route") || filePath.includes("/routes/");
}

function isCommonApiServerFile(filePath: string, basename: string): boolean {
  return (
    basename === "server.ts" ||
    basename === "server.js" ||
    basename === "app.ts" ||
    basename === "app.js" ||
    basename === "main.py" ||
    basename === "app.py" ||
    basename === "main.go" ||
    basename === "server.go" ||
    filePath.endsWith("/src/index.ts") ||
    filePath.endsWith("/src/index.js")
  );
}

function isJsonResponse(observation: RuntimeApiObservation): boolean {
  return observation.contentType?.toLowerCase().includes("application/json") === true;
}

function isSpecificServerHeader(server: string | null): boolean {
  return server !== null && /[/\d]/.test(server);
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
