export interface ModelSpec {
  readonly id: string
  readonly displayName: string
  readonly repo: string
  readonly file: string
  readonly sizeGB: number
  /** Context window per server slot. */
  readonly context: number
  /** Concurrent server slots. OpenCode issues a title request alongside the main one, so 2 avoids head-of-line blocking. */
  readonly parallel: number
  /** Max thinking tokens per request (thinking models only). Bounds runaway reasoning that would stall the tunnel. */
  readonly reasoningBudget?: number
  /** Extra llama-server arguments, appended after the defaults. */
  readonly serverArgs?: readonly string[]
  readonly minVramGB: number
  /** Whether the model reliably emits structured tool calls, which an agent needs. */
  readonly toolCalling: "reliable" | "unreliable"
  readonly description: string
}

export const DEFAULT_MODEL = "qwen3.6-27b"

export const AVAILABLE_MODELS: Record<string, ModelSpec> = {
  "qwen3.6-27b": {
    id: "qwen3.6-27b",
    displayName: "Qwen 3.6 27B (Agentic)",
    repo: "unsloth/Qwen3.6-27B-GGUF",
    file: "Qwen3.6-27B-Q4_K_M.gguf",
    sizeGB: 16.8,
    context: 32768,
    parallel: 2,
    reasoningBudget: 4096,
    serverArgs: ["-fa", "on"],
    minVramGB: 22.0,
    toolCalling: "reliable",
    description: "Qwen3.6 generation with native tool calling. Split across both T4s.",
  },
  "qwen2.5-coder-14b": {
    id: "qwen2.5-coder-14b",
    displayName: "Qwen 2.5 Coder 14B",
    repo: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    file: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    sizeGB: 9.0,
    context: 32768,
    parallel: 2,
    serverArgs: ["-fa", "on"],
    minVramGB: 12.0,
    toolCalling: "unreliable",
    description: "Fast and good at code completion, but does not call tools reliably, so it is a poor agent.",
  },
  "qwen2.5-coder-32b": {
    id: "qwen2.5-coder-32b",
    displayName: "Qwen 2.5 Coder 32B",
    repo: "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
    file: "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
    sizeGB: 19.8,
    context: 16384,
    parallel: 1,
    serverArgs: ["-fa", "on"],
    minVramGB: 24.0,
    toolCalling: "unreliable",
    description: "Strong code model across both T4s. Tool calling is untested and likely unreliable.",
  },
  "qwen2.5-coder-7b": {
    id: "qwen2.5-coder-7b",
    displayName: "Qwen 2.5 Coder 7B",
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q8_0.gguf",
    sizeGB: 7.7,
    context: 32768,
    parallel: 2,
    serverArgs: ["-fa", "on"],
    minVramGB: 10.0,
    toolCalling: "unreliable",
    description: "Ultra-fast code model for quick edits. Not suited to agentic tool use.",
  },
}
