import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateConfig } from "./validation.js";
import type { LoadedConfig } from "../types/index.js";

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const resolvedConfigPath = path.resolve(configPath);
  const fileContents = await readFile(resolvedConfigPath, "utf8");
  const parsedConfig = parseJson(fileContents, resolvedConfigPath);

  return validateConfig(parsedConfig, resolvedConfigPath);
}

function parseJson(fileContents: string, configPath: string): unknown {
  try {
    return JSON.parse(fileContents) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(`Failed to parse config file "${configPath}": ${message}`);
  }
}
