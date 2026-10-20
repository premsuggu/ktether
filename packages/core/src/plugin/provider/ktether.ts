import { Effect } from "effect"
import { define } from "@ktether/plugin/effect/plugin"
import { AVAILABLE_MODELS } from "../../ktether/registry.js"
import { Model } from "../../model.js"

/**
 * Registers the Kaggle GPU provider and the models ktether can serve on it.
 *
 * No endpoint or key is configured here. The provider package resolves the tunnel URL and API key from the saved
 * session when a request is made, so they are never stale and never written into a config file.
 */
export const KTetherPlugin = define({
  id: "ktether.provider.kaggle",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((providers) => {
      providers.update("kaggle", (provider) => {
        provider.name = "ktether (Kaggle GPU)"
        provider.activation = "enabled"
        provider.package = "@ktether/ai/providers/ktether"
        provider.integrationID = undefined
      })
      for (const spec of Object.values(AVAILABLE_MODELS)) {
        providers.models.update("kaggle", spec.id, (model) => {
          model.modelID = Model.ID.make(spec.id)
          model.name = spec.displayName
          model.capabilities = {
            // A model that cannot call tools reliably cannot drive the agent, so say so rather than offer it as capable.
            tools: spec.toolCalling === "reliable",
            input: ["text"],
            output: ["text"],
          }
          // The server splits its context across slots; one request can use a single slot's share.
          model.limit.context = spec.context
        })
      }
    })
  }),
})
