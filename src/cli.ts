#!/usr/bin/env node

import { loadConfig, ConfigError } from "./config/index.js";
import { createContext } from "./context/index.js";
import { createEmptyReport } from "./report/index.js";

async function main(): Promise<void> {
  const configPath = parseConfigPath(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const context = createContext(config);
  const report = createEmptyReport();

  console.log("QA scanner scaffold initialized.");
  console.log(`Config: ${context.config.configPath}`);
  console.log(`Target project: ${context.config.targetProjectPath}`);
  console.log(`Report path: ${context.config.reportPath}`);
  console.log(`Findings prepared: ${report.summary.totalFindings}`);
  console.log("No checks are implemented in TODO #1.");
}

function parseConfigPath(args: string[]): string {
  const configFlagIndex = args.indexOf("--config");

  if (configFlagIndex === -1) {
    throw new ConfigError('Missing required "--config" argument.');
  }

  const configPath = args[configFlagIndex + 1];
  if (configPath === undefined || configPath.trim().length === 0) {
    throw new ConfigError('Argument "--config" must be followed by a config file path.');
  }

  return configPath;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`Scanner failed: ${message}`);
  process.exitCode = 1;
});
