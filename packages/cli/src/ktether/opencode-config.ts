import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AVAILABLE_MODELS } from "./registry"

/**
 * Registers the ktether provider and its models in the global OpenCode config.
 * The endpoint and API key are deliberately not written here: the provider resolves them at runtime from
 * ktether.json, so they never go stale.
 */
export function syncOpenCodeConfig(modelId: string, configPath = defaultConfigPath()): void {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"))
  } catch {
    cfg = {}
  }

  const providers = (cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {}) as Record<string, unknown>
  providers.ktether = {
    name: "KaggleGPU (ktether)",
    npm: "@opencode/ai/providers/ktether",
    models: Object.fromEntries(Object.values(AVAILABLE_MODELS).map((m) => [m.id, { name: m.displayName }])),
  }
  cfg.provider = providers
  cfg.model = `ktether/${modelId}`

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8")
}

function defaultConfigPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json")
}
