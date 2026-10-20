import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, LLMRequest, Message, ToolDefinition } from "../../src/index.js"
import { LLMClient, Route } from "../../src/route/client.js"
import { Auth } from "../../src/route/auth.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { OpenAI, XAI, OpenAICompatibleResponses } from "../../src/providers/index.js"
import { testEffect } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
const retained = {
  type: "message",
  role: "user",
  id: "msg_1",
  status: "completed",
  content: [{ type: "input_text", text: "retained" }],
}
const output = [retained, checkpoint]

testEffect(
  dynamicResponse(({ request, text, respond }) =>
    Effect.sync(() => {
      expect(request.headers["x-deployment"]).toBe("fixture")
      expect(request.headers["x-override"]).toBe("request")
      expect(request.headers["x-default"]).toBe("configured")
      expect(request.headers.authorization).toBe("Bearer test")
      expect(new URL(request.url).searchParams.get("api-version")).toBe("fixture")
      expect(new URL(request.url).searchParams.get("trace")).toBe("request")
      if (new URL(request.url).pathname.endsWith("/compact")) {
        expect(JSON.parse(text)).toEqual({
          model: "overlaid",
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
          instructions: "request instructions",
          previous_response_id: "resp_previous",
        })
        return respond(JSON.stringify({ object: "response.compaction", output }))
      }
      return respond(sseEvents({ type: "response.completed", response: { id: "resp_1" } }))
    }),
  ),
).effect("generation and compaction share deployment headers, defaults, auth, query, and middleware", () =>
  Effect.gen(function* () {
    const headers: string[] = []
    const middleware: string[] = []
    const route = Route.make({
      id: "compaction-headers",
      provider: "openai",
      protocol: OpenAIResponses.protocol,
      compact: OpenAIResponses.route.compact,
      transport: OpenAIResponses.httpTransport,
      endpoint: Endpoint.path(({ body }) => `/${body.model}/responses`, {
        baseURL: "https://example.com",
        query: { "api-version": "fixture" },
      }),
      auth: Auth.bearer("test"),
      headers: ({ request }) => {
        expect(request.providerOptions?.store).toBe(false)
        headers.push(String(request.model.id))
        return { "x-deployment": "fixture", "x-override": "route" }
      },
      defaults: {
        headers: { "x-default": "configured", "x-override": "configured" },
        providerOptions: { store: false },
        http: { body: { instructions: "default instructions" } },
      },
    })
    const request = LLM.request({
      model: route.model({ id: "fixture" }),
      prompt: "hello",
      system: "system instructions",
      http: {
        headers: { "x-override": "request" },
        query: { trace: "request" },
        body: {
          model: "overlaid",
          instructions: "request instructions",
          previous_response_id: "resp_previous",
          store: false,
          stream: true,
        },
      },
    })
    const options: Parameters<typeof LLMClient.compact>[1] = {
      http: (request, next) => {
        middleware.push(new URL(request.url).pathname)
        return next(request)
      },
    }
    yield* LLMClient.generate(request, options)
    yield* LLMClient.compact(request, options)
    expect(headers).toEqual(["fixture", "fixture"])
    expect(middleware).toEqual(["/fixture/responses", "/fixture/responses/compact"])
  }),
)

const retainedItems = [
  retained,
  {
    type: "message",
    id: "msg_assistant",
    role: "assistant",
    status: "completed",
    phase: "commentary",
    content: [
      { type: "output_text", text: "First" },
      { type: "output_text", text: "Second" },
    ],
  },
  {
    type: "reasoning",
    id: "rs_1",
    summary: [
      { type: "summary_text", text: "Thinking" },
      { type: "summary_text", text: "More thinking" },
    ],
    encrypted_content: "reasoning-state",
  },
  { type: "reasoning", id: "rs_2", summary: [], encrypted_content: "hidden-reasoning" },
  {
    type: "message",
    id: "msg_media",
    role: "user",
    content: [
      { type: "input_image", image_url: "https://example.com/image.png" },
      { type: "input_file", filename: "report.pdf", file_data: "data:application/pdf;base64,cGRm", detail: "high" },
      { type: "input_file", filename: "other.pdf", file_url: "https://example.com/report.pdf", detail: "low" },
    ],
  },
  checkpoint,
]

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"),
  ...[undefined, "custom"].map((providerMetadataKey) =>
    Route.make({
      id: providerMetadataKey ?? "default-metadata",
      provider: "openai",
      providerMetadataKey,
      protocol: OpenAIResponses.protocol,
      compact: OpenAIResponses.route.compact,
      endpoint: OpenAIResponses.route.endpoint,
      transport: OpenAIResponses.httpTransport,
    }).model({ id: "fixture" }),
  ),
]) {
  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        if (new URL(request.url).pathname.endsWith("/compact"))
          return respond(JSON.stringify({ object: "response.compaction", output: retainedItems }))
        expect(JSON.parse(text).input).toEqual(retainedItems)
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1" } }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    ),
  ).effect(`${model.route.id} retains messages, reasoning, and media through typed conversation parts`, () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model,
        prompt: "hello",
      })
      const compacted = yield* LLMClient.compact(request)
      expect(compacted.replacement.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
        "assistant",
        "user",
        "assistant",
      ])
      expect(compacted.replacement[1]?.content).toEqual([
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ])
      expect(compacted.replacement[2]?.content.map((part) => part.type)).toEqual(["reasoning", "reasoning"])
      expect(compacted.replacement[4]?.content.map((part) => part.type)).toEqual(["media", "media", "media"])
      const codec = Schema.fromJsonString(Schema.Array(Message))
      const messages = Schema.decodeSync(codec)(Schema.encodeSync(codec)(compacted.replacement))
      yield* LLMClient.generate(LLMRequest.update(request, { messages }))
    }),
  )
}

for (const overlay of [undefined, { service_tier: "priority", prompt_cache_key: "overridden" }]) {
  testEffect(
    dynamicResponse(({ text, respond }) =>
      Effect.sync(() => {
        expect(JSON.parse(text)).toEqual({
          model: "fixture",
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
          service_tier: overlay?.service_tier ?? "flex",
          reasoning: { effort: "low" },
          text: { verbosity: "low", format: { type: "json_object" } },
          include: ["reasoning.encrypted_content"],
          parallel_tool_calls: false,
          tools: [
            { type: "function", name: "lookup", description: "Lookup", parameters: { type: "object" }, strict: false },
          ],
          prompt_cache_key: overlay?.prompt_cache_key ?? "affinity",
          prompt_cache_retention: "24h",
          prompt_cache_options: { mode: "explicit", ttl: "30m" },
        })
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect(`compact preserves supported request controls${overlay ? " with HTTP overrides" : ""}`, () =>
    LLMClient.compact(
      LLM.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
        prompt: "hello",
        promptCacheKey: "affinity",
        providerOptions: {
          serviceTier: "flex",
          reasoningEffort: "low",
          textVerbosity: "low",
          include: ["reasoning.encrypted_content"],
          parallelToolCalls: false,
        },
        generation: { maxTokens: 100 },
        tools: [{ name: "lookup", description: "Lookup", inputSchema: {} }],
        http: {
          body: {
            stream: true,
            store: false,
            text: { format: { type: "json_object" } },
            prompt_cache_retention: "24h",
            prompt_cache_options: { mode: "explicit", ttl: "30m" },
            ...overlay,
          },
        },
      }),
    ),
  )
}

for (const item of [
  { type: "unknown_provider_item", data: "do not hide in a compaction part" },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_image", image_url: "https://example.com/image.png", detail: 42 }],
  },
  { type: "message", role: "user", content: [] },
  {
    type: "message",
    role: "assistant",
    content: [{ type: "input_image", image_url: "https://example.com/image.png" }],
  },
  { type: "message", role: "user", content: [{ type: "input_file", filename: "missing.pdf" }] },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_file", filename: "bad.pdf", file_url: "https://example.com/report.pdf", detail: 42 }],
  },
  {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_file",
        filename: "both.pdf",
        file_url: "https://example.com/report.pdf",
        file_data: "data:application/pdf;base64,cGRm",
      },
    ],
  },
]) {
  testEffect(fixedResponse(JSON.stringify({ object: "response.compaction", output: [item, checkpoint] }))).effect(
    `rejects unsupported compact output: ${JSON.stringify(item)}`,
    () =>
      Effect.gen(function* () {
        const error = yield* LLMClient.compact(
          LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
        ).pipe(Effect.flip)
        expect(error.reason._tag).toBe("InvalidProviderOutput")
        expect(error.reason.body).toContain(JSON.stringify(item))
        expect(error.reason.http?.status).toBe(200)
      }),
  )
}

testEffect(fixedResponse("must not execute")).effect("xAI rejects automatic compaction options", () =>
  Effect.gen(function* () {
    const request = LLMRequest.update(
      LLM.request({ model: XAI.configure({ apiKey: "test" }).responses("grok-4.6"), prompt: "hello" }),
      { providerOptions: { contextManagement: [{ type: "compaction" }] } },
    )
    const error = yield* LLMClient.generate(request).pipe(Effect.flip)
    expect(error.reason._tag).toBe("UnsupportedOperation")
    expect(error.message).toContain("LLMClient.compact")
    if (error.reason._tag === "UnsupportedOperation") expect(error.reason.operation).toBe("in-band-compaction")
  }),
)

testEffect(
  fixedResponse(JSON.stringify({ object: "response.compaction", output: [retained], debug: "original payload" })),
).effect("invalid explicit compaction preserves the original response and HTTP context", () =>
  Effect.gen(function* () {
    const error = yield* LLMClient.compact(
      LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
    expect(error.reason.body).toContain("original payload")
    expect(error.reason.http?.status).toBe(200)
  }),
)
