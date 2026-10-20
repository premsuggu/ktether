export * as KTether from "./ktether.js"

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { ProviderID, type ModelID } from "../schema/index.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("kaggle")

function readPersistedEndpoint(): { url?: string; apiKey?: string } {
  const statePath = path.join(os.homedir(), ".local", "state", "ktether", "session.json")
  if (fs.existsSync(statePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(statePath, "utf-8"))
      return { url: data.url, apiKey: data.apiKey }
    } catch {
      return {}
    }
  }
  return {}
}

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL?: string
    readonly apiKey?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
    readonly provider?: string
  }

export const routes = [OpenAICompatibleChat.route]

export const configure = (input: LanguageModelOptions = {}) => {
  const provider = input.provider ?? "kaggle"
  const persisted = readPersistedEndpoint()
  const rawBaseURL = input.baseURL ?? process.env.KTETHER_URL ?? persisted.url ?? "http://127.0.0.1:8080/v1"
  const trimmedBaseURL = rawBaseURL.replace(/\/+$/, "")
  const baseURL = trimmedBaseURL.endsWith("/v1") ? trimmedBaseURL : `${trimmedBaseURL}/v1`
  const apiKey = input.apiKey ?? process.env.KTETHER_API_KEY ?? persisted.apiKey

  const { provider: _, baseURL: _b, apiKey: _apiKey, auth: _auth, ...rest } = input
  const auth = input.auth ?? AuthOptions.bearer(apiKey !== undefined ? { apiKey } : {}, "KTETHER_API_KEY")
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth,
  })

  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) =>
      route.model<OpenAIProviderOptionsInput>({
        id: modelID,
        provider: ProviderID.make(provider),
        compatibility: { maxTokensField: "max_tokens", supportsStore: false },
      }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, provider: providerName, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    provider: providerName,
    providerOptions,
  }).model(modelID)
