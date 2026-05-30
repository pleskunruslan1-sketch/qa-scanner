import path from "node:path";
import type { LoadedConfig, ScannerConfig } from "../types/index.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function validateConfig(
  rawConfig: unknown,
  configPath: string
): LoadedConfig {
  if (!isRecord(rawConfig)) {
    throw new ConfigError("Config file must contain a JSON object.");
  }

  const scannerConfig = rawConfig as Partial<ScannerConfig>;
  const configDir = path.dirname(configPath);
  const targetProjectPath = validateRequiredPath(
    scannerConfig.targetProjectPath,
    "targetProjectPath"
  );
  const reportPath = validateRequiredPath(scannerConfig.reportPath, "reportPath");
  const runtime = validateRuntime(scannerConfig.runtime);
  const ai = validateAi(scannerConfig.ai);

  return {
    configPath,
    configDir,
    targetProjectPath: path.resolve(configDir, targetProjectPath),
    reportPath: path.resolve(configDir, reportPath),
    runtime,
    ai
  };
}

function validateRequiredPath(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`Config field "${fieldName}" must be a non-empty string.`);
  }

  return value;
}

function validateRuntime(value: unknown): LoadedConfig["runtime"] {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new ConfigError('Config field "runtime" must be an object when provided.');
  }

  const runtime: LoadedConfig["runtime"] = {};

  if (value.apiUrl !== undefined) {
    runtime.apiUrl = validateLoopbackUrl(value.apiUrl, "runtime.apiUrl");
  }

  if (value.webUrl !== undefined) {
    runtime.webUrl = validateLoopbackUrl(value.webUrl, "runtime.webUrl");
  }

  if (value.timeoutMs !== undefined) {
    if (
      typeof value.timeoutMs !== "number" ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs <= 0
    ) {
      throw new ConfigError('Config field "runtime.timeoutMs" must be a positive integer.');
    }

    runtime.timeoutMs = value.timeoutMs;
  }

  return runtime;
}

function validateAi(value: unknown): LoadedConfig["ai"] {
  if (value === undefined) {
    return {
      enabled: false,
      provider: "offline"
    };
  }

  if (!isRecord(value)) {
    throw new ConfigError('Config field "ai" must be an object when provided.');
  }

  const enabled = value.enabled;
  const provider = value.provider;
  const apiKeyEnv = value.apiKeyEnv;

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new ConfigError('Config field "ai.enabled" must be a boolean when provided.');
  }

  if (provider !== undefined && (typeof provider !== "string" || provider.length === 0)) {
    throw new ConfigError('Config field "ai.provider" must be a non-empty string when provided.');
  }

  if (apiKeyEnv !== undefined && (typeof apiKeyEnv !== "string" || apiKeyEnv.length === 0)) {
    throw new ConfigError('Config field "ai.apiKeyEnv" must be a non-empty string when provided.');
  }

  return {
    enabled,
    provider: provider ?? "offline",
    apiKeyEnv
  };
}

function validateLoopbackUrl(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`Config field "${fieldName}" must be a non-empty string.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new ConfigError(`Config field "${fieldName}" must be a valid URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ConfigError(`Config field "${fieldName}" must use http or https.`);
  }

  if (!isLoopbackHost(parsedUrl.hostname)) {
    throw new ConfigError(
      `Config field "${fieldName}" must point to localhost or a loopback address.`
    );
  }

  return value;
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  return (
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "::1" ||
    normalizedHost === "[::1]"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
