import { DynamicProviderPlugin } from "./provider/dynamic.js"
import { KTetherPlugin } from "./provider/ktether.js"
import { LMStudioPlugin } from "./provider/lmstudio.js"
import { OllamaPlugin } from "./provider/ollama.js"
import { OpenAIPlugin } from "./provider/openai.js"
import { PromptCacheKeyPlugin } from "./provider/prompt-cache-key.js"
import { VLLMPlugin } from "./provider/vllm.js"
import { XAIPlugin } from "./provider/xai.js"
import type { PluginInternal } from "./internal.js"

// ktether serves its own models through the Kaggle provider and any OpenAI-compatible or local endpoint. OpenAI and
// xAI stay only because realtime voice sessions need their credentials.
export const ProviderPlugins: PluginInternal.InternalPlugin[] = [
  KTetherPlugin,
  LMStudioPlugin,
  OllamaPlugin,
  OpenAIPlugin,
  PromptCacheKeyPlugin,
  VLLMPlugin,
  XAIPlugin,
  DynamicProviderPlugin,
]
