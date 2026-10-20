import { describe, expect } from "bun:test"
import { LLM, LanguageModel, Message } from "@ktether/ai"
import { compileRequest } from "@ktether/ai/route/client"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/http"
import { AISDKNative } from "@ktether/core/aisdk-native"
import { Credential } from "@ktether/core/credential"
import { Integration } from "@ktether/core/integration"
import { Compatibility, ID, Info, Model, VariantID } from "@ktether/core/model"
import { Provider } from "@ktether/core/provider"
import { Variant } from "@ktether/core/variant"
import { ModelResolver } from "@ktether/core/model-resolver"
import { AISDK } from "@ktether/core/aisdk"
import { it } from "./lib/effect"

interface ModelOptions {
  readonly providerID?: Provider.ID
  readonly canonical?: Provider.ID
  readonly modelID?: string
  readonly compatibility?: Compatibility
  readonly settings?: Info["settings"]
  readonly headers?: Info["headers"]
  readonly body?: Info["body"]
  readonly variants?: Info["variants"]
  readonly limit?: Info["limit"]
}

function model(packageName: string | undefined, options: ModelOptions = {}) {
  const info: Model.MutableInfo = {
    id: ID.make("test-model"),
    modelID: ID.make(options.modelID ?? "api-test-model"),
    providerID: options.providerID ?? Provider.ID.make("test-provider"),
    canonical: options.canonical,
    name: "Test model",
    compatibility: options.compatibility,
    package: packageName,
    settings: options.settings ?? {},
    headers: options.headers ?? { "x-test": "header" },
    body: options.body ?? { custom_extension: { enabled: true } },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: structuredClone(options.variants ?? []) as Model.MutableInfo["variants"],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: options.limit ?? { context: 100, output: 20 },
  }
  AISDKNative.rewrite(info, {
    specifier: packageName,
    providerID: info.providerID,
    canonical: info.canonical,
    modelID: info.modelID,
  })
  return Info.make(info)
}

function withEnv<A, E, R>(variables: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
      Object.entries(variables).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

function withConfigEnv<A, E, R>(env: Record<string, string>, effect: () => Effect.Effect<A, E, R>) {
  return effect().pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))))
}

describe("ModelResolver", () => {

  it.effect("uses the API modelID instead of the catalog ID for native OpenAI routes", () =>
    Effect.gen(function* () {
      const catalog = model(Provider.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
        limit: { context: 100, input: 80, output: 20 },
      })
      const resolved = yield* ModelResolver.fromCatalogModel(
        catalog,
        Credential.Key.make({ type: "key", key: "secret" }),
      )

      expect(catalog.id).toBe(ID.make("test-model"))
      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        providerMetadataKey: "openai",
        endpoint: { baseURL: "https://openai.example/v1" },
        defaults: {
          headers: { "x-test": "header" },
          http: { body: { custom_extension: { enabled: true } } },
        },
      })
      const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))
      expect(prepared.body.max_output_tokens).toBeUndefined()
      expect(JSON.stringify(prepared.body)).not.toContain("max_output_tokens")
    }),
  )

  it.effect("keeps catalog apiKey credentials out of provider JSON", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { apiKey: "secret", baseURL: "https://openai.example/v1" },
        }),
      )
      const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(JSON.stringify(prepared.body)).not.toContain("apiKey")
      expect(JSON.stringify(prepared.body)).not.toContain("secret")
    }),
  )

  it.effect("treats an empty configured API key as omitted", () =>
    withConfigEnv({ OPENAI_API_KEY: "environment-key" }, () =>
      Effect.gen(function* () {
        const resolved = yield* ModelResolver.fromCatalogModel(
          model(Provider.aisdk("@ai-sdk/openai"), {
            settings: { apiKey: "", baseURL: "https://openai.example/v1" },
          }),
        )
        const headers = yield* resolved.route.auth.apply({
          request: LLM.request({ model: resolved, prompt: "Hello" }),
          method: "POST",
          url: "https://openai.example/v1/responses",
          body: "{}",
          headers: Headers.empty,
        })

        expect(headers.authorization).toBe("Bearer environment-key")
      }),
    ),
  )

  it.effect("uses merged API settings for OpenAI-compatible auth and request defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai-compatible"), {
          canonical: Provider.ID.make("deepseek"),
          compatibility: {
            reasoningField: "vendor_reasoning",
            requireReasoning: true,
            maxTokensField: "max_completion_tokens",
            requireFinishReason: false,
            requireAssistantAfterTool: true,
          },
          settings: {
            apiKey: "settings-secret",
            baseURL: "https://compatible.example/v1",
            compatibility: "strict",
          },
          headers: {},
          body: {},
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello", generation: { maxTokens: 10 } })
      const prepared = yield* compileRequest(request)
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://compatible.example/v1/chat/completions",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer settings-secret")
      expect(resolved.route.id).toBe("openai-compatible-chat")
      expect(String(resolved.provider)).toBe("deepseek")
      expect(resolved.route.providerMetadataKey).toBe("deepseek")
      expect(resolved.compatibility?.reasoningField).toBe("vendor_reasoning")
      expect(resolved.compatibility?.requireReasoning).toBe(true)
      expect(resolved.compatibility?.maxTokensField).toBe("max_completion_tokens")
      expect(resolved.compatibility?.requireFinishReason).toBe(false)
      expect(resolved.compatibility?.requireAssistantAfterTool).toBe(true)
      expect(prepared.body).toMatchObject({ max_completion_tokens: 10 })
      expect(prepared.body).not.toHaveProperty("max_tokens")
      expect(resolved.route.endpoint.baseURL).toBe("https://compatible.example/v1")
      expect(resolved.route.defaults.http?.body).toEqual({})
    }),
  )

  it.effect("resolves provider URLs from environment without mutating the catalog model", () =>
    withEnv({ ACME_HOST: "api.acme.test" }, () =>
      Effect.gen(function* () {
        const catalog = model(Provider.aisdk("@ai-sdk/openai-compatible"), {
          settings: { baseURL: "https://${ACME_HOST}/v1" },
        })
        const resolved = yield* ModelResolver.fromCatalogModel(catalog)

        expect(resolved.route.endpoint.baseURL).toBe("https://api.acme.test/v1")
        expect(catalog.settings?.baseURL).toBe("https://${ACME_HOST}/v1")
      }),
    ),
  )

  it.effect("rejects unresolved variables in constructed provider routes", () =>
    withEnv({ REQUIRED_HOST: undefined }, () =>
      Effect.gen(function* () {
        const failure = yield* ModelResolver.fromCatalogModel(
          model(Provider.aisdk("@ai-sdk/openai-compatible"), {
            settings: { baseURL: "https://${REQUIRED_HOST}/${REQUIRED_PATH}/v1" },
          }),
        ).pipe(Effect.flip)

        expect(failure).toMatchObject({
          _tag: "SessionRunnerModel.UnresolvedProviderVariablesError",
          providerID: "test-provider",
          modelID: "test-model",
          variables: ["REQUIRED_HOST", "REQUIRED_PATH"],
        })
        expect(failure.message).toBe(
          "Cannot initialize test-provider/test-model: REQUIRED_HOST, REQUIRED_PATH are required to resolve the provider endpoint",
        )
      }),
    ),
  )

  it.effect("overlays selected OpenAI variant settings and bodies", () =>
    Effect.gen(function* () {
      const catalog = model(Provider.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
        variants: [
          {
            id: VariantID.make("xhigh"),
            settings: {
              reasoningEffort: "xhigh",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
            headers: { "x-variant": "high" },
            body: {
              store: false,
              service_tier: "priority",
              temperature: 0.2,
            },
          },
        ],
      })
      const resolved = yield* ModelResolver.resolveModel(
        catalog,
        VariantID.make("xhigh"),
        Credential.Key.make({ type: "key", key: "secret" }),
      )

      expect(resolved.route.defaults.headers).toMatchObject({ "x-test": "header", "x-variant": "high" })
      expect(resolved.route.defaults.http?.body).toEqual({
        custom_extension: { enabled: true },
        store: false,
        service_tier: "priority",
        temperature: 0.2,
      })
      expect(resolved.route.defaults.providerOptions).toEqual({
        store: false,
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
      const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))
      expect(prepared.body).toMatchObject({
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "xhigh", summary: "auto" },
      })
    }),
  )

  it.effect("sends xAI Responses effort variants with reasoning summaries", () =>
    Effect.gen(function* () {
      const base = model("@ktether/ai/providers/xai", { providerID: Provider.ID.make("xai"), modelID: "grok-4.6" })
      const catalog = Info.make({
        ...base,
        variants: Variant.resolve(base, [{ type: "effort", values: ["low", "high"] }]),
      })
      const resolved = yield* ModelResolver.resolveModel(
        catalog,
        VariantID.make("high"),
        Credential.Key.make({ type: "key", key: "secret" }),
      )
      const prepared = yield* compileRequest(LLM.request({ model: resolved, prompt: "Hello" }))

      expect(resolved.route.id).toBe("xai-responses")
      expect(prepared.body).toMatchObject({
        reasoning: { effort: "high", summary: "auto" },
        include: ["reasoning.encrypted_content"],
      })
      expect(prepared.body).not.toHaveProperty("reasoning_effort")
    }),
  )

  it.effect("overlays selected OpenAI-compatible variant bodies", () =>
    Effect.gen(function* () {
      const catalog = model(Provider.aisdk("@ai-sdk/openai-compatible"), {
        settings: { baseURL: "https://compatible.example/v1" },
        variants: [
          {
            id: VariantID.make("high"),
            settings: {},
            headers: {},
            body: { store: false, reasoning_effort: "high" },
          },
        ],
      })
      const resolved = yield* ModelResolver.resolveModel(catalog, VariantID.make("high"))

      expect(resolved.route.defaults.http?.body).toEqual({
        custom_extension: { enabled: true },
        store: false,
        reasoning_effort: "high",
      })
    }),
  )

  it.effect("rejects an explicit unavailable variant during model resolution", () =>
    Effect.gen(function* () {
      const catalog = model(Provider.aisdk("@ai-sdk/openai"), {
        settings: { baseURL: "https://openai.example/v1" },
      })
      const failure = yield* ModelResolver.resolveModel(catalog, VariantID.make("unknown")).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.VariantUnavailableError",
        providerID: "test-provider",
        modelID: "test-model",
        variant: "unknown",
      })
      expect(failure.message).toBe("Variant unavailable for test-provider/test-model: unknown")
    }),
  )

  it.effect("uses resolved credentials for bearer auth", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.Key.make({ type: "key", key: "secret" }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer secret")
    }),
  )

  it.effect("prefers stored credentials over configured auth", () =>
    Effect.gen(function* () {
      const credential = Credential.Key.make({ type: "key", key: "stored-secret" })
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { apiKey: "configured-secret", baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        credential,
      )
      const headers = yield* resolved.route.auth.apply({
        request: LLM.request({ model: resolved, prompt: "Hello" }),
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(headers.authorization).toBe("Bearer stored-secret")
    }),
  )

  it.effect("does not project OAuth account metadata into the request body", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "secret",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { server: "https://console.example", orgID: "org_123" },
        }),
      )

      expect(resolved.route.defaults.http?.body).toEqual({})
    }),
  )

  it.effect("applies plugin-projected OpenAI endpoint and headers", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model("@ktether/ai/providers/openai", {
          settings: { baseURL: "https://chatgpt.com/backend-api/codex" },
          headers: { "chatgpt-account-id": "acct_123" },
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )
      const request = LLM.request({
        model: resolved,
        system: [
          { type: "text", text: "Base instructions." },
          { type: "text", text: "Project instructions." },
        ],
        messages: [Message.user("Hello"), Message.system("Updated instructions.")],
      })
      const prepared = yield* compileRequest(request)
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route).toMatchObject({
        id: "openai-responses",
        endpoint: { baseURL: "https://chatgpt.com/backend-api/codex" },
      })
      expect(resolved.route.defaults.headers).toMatchObject({ "chatgpt-account-id": "acct_123" })
      expect(headers.authorization).toBe("Bearer chatgpt-token")
      expect(prepared.body).toMatchObject({
        instructions: "Base instructions.\nProject instructions.",
        input: [
          { role: "user", content: [{ type: "input_text", text: "Hello" }] },
          { role: "developer", content: "Updated instructions." },
        ],
      })
    }),
  )

  it.effect("does not route native OpenAI-compatible packages to the codex backend", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model("@ktether/ai/providers/openai-compatible", {
          settings: { baseURL: "https://compatible.example/v1" },
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )

      expect(resolved.route.id).toBe("openai-compatible-chat")
      expect(resolved.route.endpoint.baseURL).toBe("https://compatible.example/v1")
    }),
  )

  it.effect("maps legacy OpenAI organization and project settings to headers", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { organization: "org_123", project: "proj_123" },
        }),
      )

      expect(resolved.route.defaults.headers).toMatchObject({
        "OpenAI-Organization": "org_123",
        "OpenAI-Project": "proj_123",
      })
    }),
  )

  it.effect("keeps non-ChatGPT OAuth credentials on the configured endpoint", () =>
    Effect.gen(function* () {
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
          headers: {},
          body: {},
        }),
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "oauth-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      )
      const request = LLM.request({ model: resolved, prompt: "Hello" })
      const headers = yield* resolved.route.auth.apply({
        request,
        method: "POST",
        url: "https://openai.example/v1/responses",
        body: "{}",
        headers: Headers.empty,
      })

      expect(resolved.route.endpoint.baseURL).toBe("https://openai.example/v1")
      expect(headers.authorization).toBe("Bearer oauth-token")
      expect(headers["chatgpt-account-id"]).toBeUndefined()
    }),
  )

  it.effect("loads dynamic native provider packages through the injected package loader", () =>
    Effect.gen(function* () {
      const native = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const resolved = yield* ModelResolver.fromCatalogModel(
        model("@ktether/ai/providers/custom", {
          settings: { region: "test" },
          headers: { "x-package": "header" },
          body: { custom: true },
        }),
        undefined,
        {
          loadPackage: (specifier) => {
            expect(specifier).toBe("@ktether/ai/providers/custom")
            return Effect.succeed({
              model: (modelID, settings) => {
                expect(modelID).toBe("api-test-model")
                expect(settings).toEqual({
                  region: "test",
                  headers: { "x-package": "header" },
                  body: { custom: true },
                })
                return LanguageModel.make({ id: modelID, provider: "package-provider", route: native.route })
              },
            })
          },
        },
      )

      expect(resolved).toMatchObject({ id: "api-test-model", provider: "test-provider" })
    }),
  )

  it.effect("maps OAuth credentials to native provider auth settings", () =>
    Effect.gen(function* () {
      const native = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "oauth-token",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      })
      const packages = [
        ["@ktether/ai/providers/google-vertex", "accessToken"],
        ["@ktether/ai/providers/google-vertex/gemini", "accessToken"],
        ["@ktether/ai/providers/google-vertex/interactions", "accessToken"],
        ["@ktether/ai/providers/google-vertex/chat", "accessToken"],
        ["@ktether/ai/providers/google-vertex/responses", "accessToken"],
        ["@ktether/ai/providers/google-vertex/messages", "accessToken"],
        ["@ktether/ai/providers/anthropic", "authToken"],
        ["@ktether/ai/providers/anthropic-compatible", "authToken"],
      ] as const

      yield* Effect.forEach(packages, ([specifier, key]) =>
        ModelResolver.fromCatalogModel(model(specifier, { settings: { apiKey: "configured-key" } }), credential, {
          loadPackage: () =>
            Effect.succeed({
              model: (modelID, settings) => {
                expect(settings).toMatchObject({ [key]: "oauth-token" })
                expect(settings).not.toHaveProperty("apiKey")
                return LanguageModel.make({ id: modelID, provider: "package-provider", route: native.route })
              },
            }),
        }),
      )
    }),
  )

  it.effect("loads arbitrary AISDK packages through the injected AISDK loader", () =>
    Effect.gen(function* () {
      const native = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      const resolved = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/perplexity"), {
          modelID: "perplexity-api-model",
          settings: { project: "test" },
          headers: { "x-aisdk": "header" },
          body: { custom: true },
        }),
        Credential.Key.make({
          type: "key",
          key: "fallback-secret",
          configuration: { accountId: "account" },
        }),
        {
          loadAISDK: (runtime) =>
            Effect.sync(() => {
              expect(runtime).toMatchObject({
                id: "test-model",
                modelID: "perplexity-api-model",
                providerID: "test-provider",
                package: Provider.aisdk("@ai-sdk/perplexity"),
                settings: { project: "test", apiKey: "fallback-secret", accountId: "account" },
                headers: { "x-aisdk": "header" },
                body: { custom: true },
              })
              return LanguageModel.make({
                id: runtime.modelID ?? runtime.id,
                provider: runtime.providerID,
                route: native.route,
              })
            }),
        },
      )

      expect(resolved).toMatchObject({ id: "perplexity-api-model", provider: "test-provider" })
    }),
  )

  it.effect("rejects unresolved variables before loading opaque AISDK packages", () =>
    withEnv({ REQUIRED_HOST: undefined }, () =>
      Effect.gen(function* () {
        const failure = yield* ModelResolver.fromCatalogModel(
          model(Provider.aisdk("@ai-sdk/perplexity"), {
            settings: { baseURL: "https://${REQUIRED_HOST}/v1" },
          }),
          undefined,
          { loadAISDK: () => Effect.die("AI SDK loader should not be called") },
        ).pipe(Effect.flip)

        expect(failure).toMatchObject({
          _tag: "SessionRunnerModel.UnresolvedProviderVariablesError",
          variables: ["REQUIRED_HOST"],
        })
      }),
    ),
  )

  it.effect("rejects placeholders introduced by environment expansion before loading providers", () =>
    withEnv({ PROVIDER_HOST: "${MISSING_HOST}", MISSING_HOST: undefined }, () =>
      Effect.gen(function* () {
        const failure = yield* ModelResolver.fromCatalogModel(
          model(Provider.aisdk("@ai-sdk/perplexity"), {
            settings: { baseURL: "https://${PROVIDER_HOST}/v1" },
          }),
          undefined,
          { loadAISDK: () => Effect.die("AI SDK loader should not be called") },
        ).pipe(Effect.flip)

        expect(failure).toMatchObject({
          _tag: "SessionRunnerModel.UnresolvedProviderVariablesError",
          variables: ["MISSING_HOST"],
        })
      }),
    ),
  )

  it.effect("rejects AISDK packages without an available loader", () =>
    Effect.gen(function* () {
      const failure = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/perplexity"), {
          settings: { baseURL: "https://perplexity.example/v1" },
        }),
      ).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedPackageError",
        providerID: "test-provider",
        modelID: "test-model",
        package: "aisdk:@ai-sdk/perplexity",
      })
      expect(failure.message).toBe("Unsupported package for test-provider/test-model: aisdk:@ai-sdk/perplexity")
    }),
  )

  it.effect("distinguishes unexpected constructor failures from configuration errors", () =>
    Effect.gen(function* () {
      const failure = yield* ModelResolver.fromCatalogModel(model("@ktether/ai/providers/custom"), undefined, {
        loadPackage: () =>
          Effect.succeed({
            model: () => {
              throw new Error("custom provider crashed")
            },
          }),
      }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.ModelInitializationError",
        phase: "construct",
        detail: "custom provider crashed",
      })
    }),
  )

  it.effect("reports package load and AISDK initialization failures with their causes", () =>
    Effect.gen(function* () {
      const load = yield* ModelResolver.fromCatalogModel(model("@ktether/ai/providers/custom"), undefined, {
        loadPackage: (specifier) =>
          Effect.fail(
            new Provider.LoadError({ package: specifier, cause: new Error(`Provider package ${specifier} is broken`) }),
          ),
      }).pipe(Effect.flip)
      expect(load).toMatchObject({
        _tag: "SessionRunnerModel.ModelInitializationError",
        phase: "load",
        detail: "Provider package @ktether/ai/providers/custom is broken",
      })

      const init = yield* ModelResolver.fromCatalogModel(model(Provider.aisdk("@ai-sdk/perplexity")), undefined, {
        loadAISDK: (runtime) =>
          Effect.fail(
            new AISDK.InitError({ providerID: runtime.providerID, cause: new Error("Perplexity plugin failed") }),
          ),
      }).pipe(Effect.flip)
      expect(init).toMatchObject({
        _tag: "SessionRunnerModel.ModelInitializationError",
        phase: "init",
        detail: "Perplexity plugin failed",
      })
      expect(init.message).toBe("Cannot initialize test-provider/test-model: Perplexity plugin failed")
    }),
  )

  it.effect("drops an empty API key before loading an AISDK package", () =>
    Effect.gen(function* () {
      const native = yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/openai"), {
          settings: { baseURL: "https://openai.example/v1" },
        }),
      )
      yield* ModelResolver.fromCatalogModel(
        model(Provider.aisdk("@ai-sdk/perplexity"), {
          settings: { apiKey: "", baseURL: "https://perplexity.example/v1" },
        }),
        undefined,
        {
          loadAISDK: (runtime) =>
            Effect.sync(() => {
              expect(runtime.settings).not.toHaveProperty("apiKey")
              return native
            }),
        },
      )
    }),
  )

  it.effect("reports whether a catalog model declares a provider package", () =>
    Effect.sync(() => {
      expect(ModelResolver.hasPackage(model(Provider.aisdk("@ai-sdk/openai")))).toBe(true)
      expect(ModelResolver.hasPackage(model("@ktether/ai/providers/custom"))).toBe(true)
      expect(ModelResolver.hasPackage(model(undefined))).toBe(false)
    }),
  )
})
