import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import serverScript from "./kernel/server.py" with { type: "text" }
import { KERNEL_SLUG, kernelRef } from "./kaggle.js"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "./registry.js"
import { generateApiKey, generateChannelId, generateSigningKey, relayBase } from "./signaling.js"

export interface Bundle {
  readonly stagingDir: string
  readonly channelId: string
  readonly apiKey: string
  readonly signingKey: string
}

export interface KernelConfig {
  readonly channel_id: string
  readonly api_key: string
  readonly signing_key: string
  readonly ntfy_url: string
  readonly model_repo: string
  readonly model_file: string
  readonly model_name: string
  readonly context_size: number
  readonly parallel: number
  readonly reasoning_budget: number
  readonly server_args: readonly string[]
  readonly idle_timeout_minutes: number
  /** Stop gracefully before Kaggle's 12 hour session cap kills the notebook. */
  readonly max_runtime_minutes: number
}

/** The kernel only receives its config embedded in the script: `kaggle kernels push` uploads a single code file. */
export function renderKernelScript(config: Record<string, unknown>): string {
  return `EMBEDDED_CONFIG_JSON = ${JSON.stringify(JSON.stringify(config))}\n${serverScript}`
}

export function buildKernelConfig(modelKey: string, idleTimeoutMinutes: number): KernelConfig {
  const spec = AVAILABLE_MODELS[modelKey] ?? AVAILABLE_MODELS[DEFAULT_MODEL]
  return {
    channel_id: generateChannelId(),
    api_key: generateApiKey(),
    signing_key: generateSigningKey(),
    ntfy_url: relayBase(),
    model_repo: spec.repo,
    model_file: spec.file,
    model_name: spec.id,
    // llama-server divides --ctx-size evenly between slots.
    context_size: spec.context * spec.parallel,
    parallel: spec.parallel,
    reasoning_budget: spec.reasoningBudget ?? -1,
    server_args: spec.serverArgs ?? [],
    idle_timeout_minutes: idleTimeoutMinutes,
    max_runtime_minutes: 700,
  }
}

export function prepareStagingBundle(username: string, modelKey: string, idleTimeoutMinutes: number): Bundle {
  const config = buildKernelConfig(modelKey, idleTimeoutMinutes)
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "ktether-staging-"))

  fs.writeFileSync(path.join(stagingDir, "server.py"), renderKernelScript({ ...config }), {
    encoding: "utf-8",
    mode: 0o600,
  })
  const metadata = {
    id: kernelRef(username),
    title: KERNEL_SLUG,
    code_file: "server.py",
    language: "python",
    kernel_type: "script",
    is_private: "true",
    enable_gpu: "true",
    enable_tpu: "false",
    enable_internet: "true",
    accelerator: "NvidiaTeslaT4",
    dataset_sources: [],
    competition_sources: [],
    kernel_sources: [],
    model_sources: [],
  }
  fs.writeFileSync(path.join(stagingDir, "kernel-metadata.json"), JSON.stringify(metadata, null, 2), "utf-8")

  return { stagingDir, channelId: config.channel_id, apiKey: config.api_key, signingKey: config.signing_key }
}

/** The staging directory holds the API key and signing key in plain text, so it must not outlive the push. */
export function removeStagingBundle(stagingDir: string): void {
  fs.rmSync(stagingDir, { recursive: true, force: true })
}
