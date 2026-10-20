import { describe, expect, test } from "bun:test"
import { model } from "@ktether/ai/providers/openai"
import { LLM } from "../src/index.js"
import { Endpoint } from "../src/route/endpoint.js"

const configuration = (provider: string, message: string) =>
  expect.objectContaining({ _tag: "ProviderConfiguration", provider, message })

describe("provider package entrypoints", () => {
  test("maps package settings onto the executable model", () => {
    const selected = model("gpt-5", {
      apiKey: "fixture",
      baseURL: "https://api.openai.test/v1",
      headers: { "x-application": "ktether" },
      body: { service_tier: "priority" },
      unrelatedInheritedSetting: true,
    })

    expect(selected.route.id).toBe("openai-responses")
    expect(selected.route.defaults.headers).toEqual({ "x-application": "ktether" })
    expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
  })

  test("maps OpenAI-compatible Responses settings onto the executable model", async () => {
    const OpenAICompatibleResponses = await import("@ktether/ai/providers/openai-compatible/responses")
    const selected = OpenAICompatibleResponses.model("custom-model", {
      apiKey: "fixture",
      baseURL: "https://responses.example.test/v1",
      provider: "example",
      headers: { "x-application": "ktether" },
      body: { service_tier: "priority" },
      reasoningEffort: "low",
      store: true,
    })

    expect(String(selected.provider)).toBe("example")
    expect(selected.route.id).toBe("openai-compatible-responses")
    expect(selected.route.endpoint).toMatchObject({
      baseURL: "https://responses.example.test/v1",
      path: "/responses",
    })
    expect(selected.route.defaults.headers).toEqual({ "x-application": "ktether" })
    expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(selected.route.defaults.providerOptions).toEqual({
      reasoningEffort: "low",
      store: true,
      include: ["reasoning.encrypted_content"],
    })
  })

  test("maps legacy OpenAI organization and project settings to headers", () => {
    const selected = model("gpt-5", {
      apiKey: "fixture",
      organization: "org_123",
      project: "proj_123",
    })

    expect(selected.route.defaults.headers).toMatchObject({
      "OpenAI-Organization": "org_123",
      "OpenAI-Project": "proj_123",
    })
  })

  test("maps ktether package settings onto the Kaggle-backed model", async () => {
    const KTether = await import("@ktether/ai/providers/ktether")
    const selected = KTether.model("qwen3.6-27b", {
      apiKey: "kgp_fixture",
      baseURL: "https://example.trycloudflare.com",
      headers: { "x-application": "ktether" },
      body: { top_k: 20 },
    })

    expect(String(selected.provider)).toBe("kaggle")
    expect(selected.route.id).toBe("openai-compatible-chat")
    // The saved session stores the bare tunnel URL, so the provider appends the OpenAI-compatible /v1 prefix.
    expect(selected.route.endpoint.baseURL).toBe("https://example.trycloudflare.com/v1")
    expect(selected.route.defaults.headers).toMatchObject({ "x-application": "ktether" })
    expect(selected.route.defaults.http?.body).toEqual({ top_k: 20 })
  })
})
