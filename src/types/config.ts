export interface RuntimeConfig {
  apiUrl?: string;
  webUrl?: string;
  timeoutMs?: number;
}

export interface AiConfig {
  enabled?: boolean;
  provider?: "offline" | string;
  endpointUrl?: string;
  model?: string;
  apiKeyEnv?: string;
}

export interface ScannerConfig {
  targetProjectPath: string;
  reportPath: string;
  runtime?: RuntimeConfig;
  ai?: AiConfig;
}

export interface LoadedConfig {
  configPath: string;
  configDir: string;
  targetProjectPath: string;
  reportPath: string;
  runtime: RuntimeConfig;
  ai: AiConfig;
}
