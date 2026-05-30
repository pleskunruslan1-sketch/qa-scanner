import type { LoadedConfig, ScanContext } from "../types/index.js";

export function createContext(config: LoadedConfig): ScanContext {
  return {
    config
  };
}
