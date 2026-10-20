import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Model } from "@ktether/core/model"
import { Plugin } from "@ktether/core/plugin"
import { PluginHost } from "@ktether/core/plugin/host"
import { KTetherPlugin } from "@ktether/core/plugin/provider/ktether"
import { Provider } from "@ktether/core/provider"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@ktether/core/ktether/registry"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* KTetherPlugin.effect(host)
})

describe("KTetherPlugin", () => {
  it.effect("registers an enabled provider served by the ktether package", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const providers = yield* Provider.Service
      const provider = yield* providers.get(Provider.ID.make("kaggle"))
      expect(provider).toMatchObject({
        name: "ktether (Kaggle GPU)",
        activation: "enabled",
        package: "@ktether/ai/providers/ktether",
      })
      // The endpoint and key come from the saved session at request time, never from configuration.
      expect(provider?.settings).toBeUndefined()
      expect(provider?.integrationID).toBeUndefined()
    }),
  )

  it.effect("offers every curated model, including the default", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const models = yield* Model.Service
      const listed = (yield* models.all()).filter((model) => model.providerID === Provider.ID.make("kaggle"))
      expect(listed.map((model) => String(model.id)).sort()).toEqual(Object.keys(AVAILABLE_MODELS).sort())
      expect(listed.some((model) => String(model.id) === DEFAULT_MODEL)).toBe(true)
    }),
  )

  it.effect("marks only models that call tools reliably as tool capable", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const models = yield* Model.Service
      const agentic = yield* models.get(Provider.ID.make("kaggle"), Model.ID.make("qwen3.6-27b"))
      const coder = yield* models.get(Provider.ID.make("kaggle"), Model.ID.make("qwen2.5-coder-14b"))
      expect(agentic?.capabilities.tools).toBe(true)
      expect(coder?.capabilities.tools).toBe(false)
      expect(agentic?.limit.context).toBe(AVAILABLE_MODELS["qwen3.6-27b"].context)
    }),
  )
})
