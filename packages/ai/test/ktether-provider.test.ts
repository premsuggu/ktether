import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Headers } from "effect/http"
import { LLM } from "../src/index.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { noSessionAuth } from "../src/providers/ktether.js"
import { LanguageModel } from "../src/schema/index.js"
import { it } from "./lib/effect.js"

describe("ktether provider", () => {
  it.effect("tells the user to start a GPU when there is no key and no saved session", () =>
    Effect.gen(function* () {
      const error = yield* noSessionAuth
        .apply({
          request: LLM.request({
            id: "req_ktether",
            model: LanguageModel.make({ id: "qwen3.6-27b", provider: "kaggle", route: OpenAIChat.route }),
            prompt: "hi",
          }),
          method: "POST",
          url: "https://example.test/v1/chat/completions",
          body: "{}",
          headers: Headers.empty,
        })
        .pipe(Effect.flip)

      expect(error.message).toContain("ktether gpu start")
      expect(error.message).not.toBe("KTETHER_API_KEY is not set")
    }),
  )
})
