#!/usr/bin/env node

import { loadConfig, ConfigError } from "./config/index.js";
import { createContext } from "./context/index.js";
import { runApiChecks, runSecurityChecks, runStaticRepositoryChecks } from "./checks/index.js";
import { createReport, writeMarkdownReport } from "./report/index.js";

async function main(): Promise<void> {
  const configPath = parseConfigPath(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const context = await createContext(config);
  const findings = [
    ...(await runStaticRepositoryChecks(context)),
    ...(await runSecurityChecks(context)),
    ...(await runApiChecks(context))
  ];
  const report = createReport(findings, context.detectedStack, context.inventory);

  await writeMarkdownReport(report, context.config.reportPath);

  console.log("QA scanner scan completed.");
  console.log(`Config: ${context.config.configPath}`);
  console.log(`Target project: ${context.config.targetProjectPath}`);
  console.log(`Report path: ${context.config.reportPath}`);
  console.log(`Detected stacks: ${context.detectedStack.all.join(", ")}`);
  console.log(`Findings written: ${report.summary.totalFindings}`);
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
