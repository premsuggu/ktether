import { Config } from "effect"
import { Auth } from "../src/route.js"
import type { LanguageModelFactory } from "../src/route/auth-options.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as KTether from "../src/providers/ktether.js"
import * as OpenAI from "../src/providers/openai.js"
import * as OpenAICompatible from "../src/providers/openai-compatible.js"
import * as XAI from "../src/providers/xai.js"

type BaseOptions = {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
}

type LanguageModel = {
  readonly id: string
}

declare const auth: Auth.Definition
declare const optionalAuthModel: LanguageModelFactory<BaseOptions, "optional", LanguageModel>
declare const requiredAuthModel: LanguageModelFactory<BaseOptions, "required", LanguageModel>
const configApiKey = Config.Redacted("OPENAI_API_KEY")

OpenAIChat.route.model({ id: "gpt-4.1-mini" })

// @ts-expect-error route model selection does not configure endpoints.
OpenAIChat.route.model({ id: "gpt-4.1-mini", baseURL: "https://gateway.example.com/v1" })

// @ts-expect-error route model selection does not configure query params.
OpenAIChat.route.model({ id: "gpt-4.1-mini", queryParams: { debug: "1" } })

// @ts-expect-error route model selection does not configure auth.
OpenAIChat.route.model({ id: "gpt-4.1-mini", auth })

// @ts-expect-error route model selection does not configure api keys.
OpenAIChat.route.model({ id: "gpt-4.1-mini", apiKey: "sk-test" })

optionalAuthModel("gpt-4.1-mini")
optionalAuthModel("gpt-4.1-mini", {})
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test" })
optionalAuthModel("gpt-4.1-mini", { apiKey: configApiKey })
optionalAuthModel("gpt-4.1-mini", { auth })
optionalAuthModel("gpt-4.1-mini", { auth, baseURL: "https://gateway.example.com/v1" })
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", headers: { "x-source": "test" } })

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", auth })

requiredAuthModel("custom-model", { apiKey: "key" })
requiredAuthModel("custom-model", { apiKey: configApiKey })
requiredAuthModel("custom-model", { auth })
requiredAuthModel("custom-model", { auth, headers: { "x-tenant-id": "tenant" } })

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model")

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model", {})

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
requiredAuthModel("custom-model", { apiKey: "key", auth })

OpenAI.responses("gpt-4.1-mini")
OpenAI.configure({}).responses("gpt-4.1-mini")
OpenAI.configure({ apiKey: "sk-test" }).responses("gpt-4.1-mini")
OpenAI.configure({ apiKey: configApiKey }).responses("gpt-4.1-mini")
OpenAI.configure({ auth: Auth.bearer("oauth-token") }).responses("gpt-4.1-mini")
OpenAI.configure({
  auth: Auth.headers({ authorization: "Bearer gateway" }),
  baseURL: "https://gateway.example.com/v1",
}).responses("gpt-4.1-mini")
OpenAI.configure({
  generation: { maxTokens: 100 },
  providerOptions: { store: false },
}).responses("gpt-4.1-mini")

// @ts-expect-error OpenAI model selectors only accept model ids.
OpenAI.configure({ apiKey: "sk-test" }).responses("gpt-4.1-mini", {})

// @ts-expect-error apiKey only accepts string, Redacted<string>, or Config<string | Redacted<string>>.
OpenAI.configure({ apiKey: 123 })

// @ts-expect-error provider helpers reject unknown top-level options.
OpenAI.configure({ bogus: true })

// @ts-expect-error common generation options remain typed.
OpenAI.configure({ generation: { maxTokens: "many" } })

// @ts-expect-error provider-native options remain typed.
OpenAI.configure({ providerOptions: { store: "false" } })

// @ts-expect-error auth is an override, so OpenAI rejects apiKey with auth.
OpenAI.configure({ apiKey: "sk-test", auth: Auth.bearer("oauth-token") })

OpenAI.chat("gpt-4.1-mini")
OpenAI.configure({ apiKey: "sk-test" }).chat("gpt-4.1-mini")
OpenAI.configure({ apiKey: configApiKey }).chat("gpt-4.1-mini")
OpenAI.configure({ auth: Auth.bearer("oauth-token") }).chat("gpt-4.1-mini")

// @ts-expect-error OpenAI chat selectors only accept model ids.
OpenAI.configure({ apiKey: "sk-test" }).chat("gpt-4.1-mini", {})

// @ts-expect-error auth is an override, so OpenAI Chat rejects apiKey with auth.
OpenAI.configure({ apiKey: "sk-test", auth: Auth.bearer("oauth-token") })

XAI.configure({ apiKey: "xai-key" }).responses("grok-4")
XAI.configure({ apiKey: "xai-key" }).chat("grok-4")
// @ts-expect-error xAI Responses selectors only accept model ids.
XAI.configure({ apiKey: "xai-key" }).responses("grok-4", {})
// @ts-expect-error xAI Chat selectors only accept model ids.
XAI.configure({ apiKey: "xai-key" }).chat("grok-4", {})

OpenAICompatible.configure({ baseURL: "http://127.0.0.1:8080/v1" }).model("local-model")
OpenAICompatible.configure({ baseURL: "http://127.0.0.1:8080/v1", apiKey: "key", provider: "llama-cpp" }).model("m")
OpenAICompatible.configure({ baseURL: "http://127.0.0.1:8080/v1", auth: Auth.bearer("token") }).model("m")
// @ts-expect-error OpenAI-compatible endpoints need a base URL.
OpenAICompatible.configure({ apiKey: "key" })
// @ts-expect-error OpenAI-compatible selectors only accept model ids.
OpenAICompatible.configure({ baseURL: "http://127.0.0.1:8080/v1" }).model("local-model", {})
// @ts-expect-error auth is an override, so OpenAI-compatible rejects apiKey with auth.
OpenAICompatible.configure({ baseURL: "http://127.0.0.1:8080/v1", apiKey: "key", auth: Auth.bearer("token") })

// The Kaggle provider resolves its tunnel URL and key at runtime, so every option is optional.
KTether.configure().model("qwen3.6-27b")
KTether.configure({ baseURL: "https://example.trycloudflare.com/v1", apiKey: "kgp_test" }).model("qwen3.6-27b")
KTether.configure({ auth: Auth.bearer("kgp_test") }).model("qwen3.6-27b")
// @ts-expect-error ktether model selectors only accept model ids.
KTether.configure().model("qwen3.6-27b", {})
// @ts-expect-error ktether rejects unknown top-level options.
KTether.configure({ bogus: true })
// @ts-expect-error auth is an override, so ktether rejects apiKey with auth.
KTether.configure({ apiKey: "kgp_test", auth: Auth.bearer("kgp_test") })
