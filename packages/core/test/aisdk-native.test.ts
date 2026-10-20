import { describe, expect, test } from "bun:test"
import { AISDKNative } from "@opencode/core/aisdk-native"

function map(
  packageName: string,
  settings: Readonly<Record<string, unknown>>,
  modelID = "test-model",
  providerID = "test-provider",
) {
  const target: {
    package?: string
    settings?: Record<string, unknown>
    headers?: Record<string, string>
    body?: Record<string, unknown>
  } = {
    package: `aisdk:${packageName}`,
    settings: { ...settings },
  }
  AISDKNative.rewrite(target, { specifier: target.package, providerID, modelID })
  return target.package?.startsWith("aisdk:") ? undefined : target
}

describe("AISDKNative", () => {
  test("maps OpenAI-family packages and request options to native providers", () => {
    expect(
      map("@ai-sdk/openai", {
        apiKey: "secret",
        baseURL: "https://api.meta.ai/v1",
        organization: "org",
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
        truncation: "auto",
      }),
    ).toEqual({
      package: "@opencode/ai/providers/openai",
      settings: {
        apiKey: "secret",
        baseURL: "https://api.meta.ai/v1",
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
        truncation: "auto",
        organization: "org",
      },
    })
    expect(map("@ai-sdk/openai-compatible", { baseURL: "https://example.com/v1", reasoningEffort: "high" })).toEqual({
      package: "@opencode/ai/providers/openai-compatible",
      settings: {
        baseURL: "https://example.com/v1",
        provider: "test-provider",
        reasoningEffort: "high",
      },
    })
  })

  test("maps supported xAI settings", () => {
    expect(
      map("@ai-sdk/xai", {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        reasoningEffort: "custom",
        store: true,
      }),
    ).toEqual({
      package: "@opencode/ai/providers/xai",
      settings: {
        apiKey: "secret",
        baseURL: "https://xai.example/v1",
        reasoningEffort: "custom",
        store: true,
      },
    })
  })

  test("moves headers and extraBody out of settings into request overlays", () => {
    expect(
      map("@ai-sdk/openai-compatible", {
        baseURL: "https://example.com/v1",
        headers: { "X-Team": "ktether" },
        extraBody: { top_k: 20 },
        useCompletionUrls: true,
      }),
    ).toEqual({
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "https://example.com/v1", provider: "test-provider" },
      headers: { "X-Team": "ktether" },
      body: { top_k: 20 },
    })
  })

  test("leaves AI SDK packages ktether does not ship untouched", () => {
    expect(map("@ai-sdk/anthropic", { apiKey: "secret" })).toBeUndefined()
    expect(map("@ai-sdk/amazon-bedrock", { region: "us-east-1" })).toBeUndefined()
  })

  test("passes native package specifiers through without adding a provider identity", () => {
    const target: { package?: string; settings?: Record<string, unknown> } = {
      package: "@opencode/ai/providers/ktether",
      settings: { baseURL: "https://example.trycloudflare.com/v1" },
    }
    AISDKNative.rewrite(target, { specifier: target.package, providerID: "ktether", modelID: "qwen3.6-27b" })
    expect(target).toEqual({
      package: "@opencode/ai/providers/ktether",
      settings: { baseURL: "https://example.trycloudflare.com/v1" },
    })
  })

  test("rewrites variant overlays the same way as the model", () => {
    const target: {
      package?: string
      settings?: Record<string, unknown>
      variants?: { id: string; settings?: Record<string, unknown>; headers?: Record<string, string>; body?: Record<string, unknown> }[]
    } = {
      package: "aisdk:@ai-sdk/openai-compatible",
      settings: { baseURL: "https://example.com/v1" },
      variants: [{ id: "high", settings: { reasoningEffort: "high", extraBody: { top_k: 5 } } }],
    }
    AISDKNative.rewrite(target, { specifier: target.package, providerID: "test-provider", modelID: "m" })
    expect(target.variants).toEqual([{ id: "high", settings: { reasoningEffort: "high" }, body: { top_k: 5 } }])
  })

  test("reports which native package serves an AI SDK package name", () => {
    expect(AISDKNative.native("@ai-sdk/openai-compatible", { providerID: "x" })).toBe(
      "@opencode/ai/providers/openai-compatible",
    )
    expect(AISDKNative.native("@ai-sdk/mistral", { providerID: "x" })).toBeUndefined()
  })
})
