import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, LLMRequest, Message } from "../../src/index.js"
import { LLMClient } from "../../src/route/client.js"
import { OpenAI, XAI } from "../../src/providers/index.js"
import { testEffect } from "../lib/effect.js"
import { dynamicResponse, fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
const response = sseEvents(
  { type: "response.output_item.done", item: checkpoint },
  {
    type: "response.completed",
    response: { id: "resp_1", output: [checkpoint], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
  },
)

testEffect(fixedResponse(sseEvents({ type: "response.completed", response: { output: [checkpoint] } }))).effect(
  "recovers compaction from the terminal output when item completion is absent",
  () =>
    Effect.gen(function* () {
      const result = yield* LLMClient.generate(
        LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
      )
      expect(result.message.content).toHaveLength(1)
      expect(result.message.content[0]?.type).toBe("compaction")
    }),
)

testEffect(
  fixedResponse(sseEvents({ type: "response.output_item.done", item: { type: "compaction", id: "cmp_bad" } })),
).effect("rejects incomplete compaction payloads without publishing a checkpoint", () =>
  Effect.gen(function* () {
    const error = yield* LLMClient.generate(
      LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"), prompt: "hello" }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
    expect(error.reason.body).toContain("cmp_bad")
  }),
)

const textItem = {
  type: "message",
  id: "msg_after",
  role: "assistant",
  content: [{ type: "output_text", text: "After checkpoint" }],
}

for (const completed of [false, true]) {
  testEffect(
    fixedResponse(
      sseEvents(
        { type: "response.output_item.added", output_index: 0, item: { type: "compaction", id: checkpoint.id } },
        ...(completed ? [{ type: "response.output_item.done", output_index: 0, item: checkpoint }] : []),
        { type: "response.output_item.added", output_index: 1, item: textItem },
        { type: "response.output_text.delta", output_index: 1, item_id: textItem.id, delta: "After checkpoint" },
        { type: "response.output_item.done", output_index: 1, item: textItem },
        { type: "response.completed", response: { id: "resp_1", output: [checkpoint, textItem] } },
      ),
    ),
  ).effect(completed ? "keeps streamed checkpoints before later text" : "rejects order-unsafe terminal recovery", () =>
    Effect.gen(function* () {
      const request = LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("fixture"), prompt: "hello" })
      if (completed) {
        const response = yield* LLMClient.generate(request)
        expect(response.message.content.map((part) => part.type)).toEqual(["compaction", "text"])
        return
      }
      const error = yield* LLMClient.generate(request).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("Cannot recover a compaction checkpoint")
      expect(error.reason.body).toContain("response.completed")
      expect(error.reason.http?.status).toBe(200)
    }),
  )
}

testEffect(
  fixedResponse(
    sseEvents({
      type: "response.completed",
      response: { output: [{ type: "compaction", encrypted_content: "opaque" }] },
    }),
  ),
).effect("mints an id for terminal checkpoints that omit one", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(
      LLM.request({ model: OpenAI.configure({ apiKey: "test" }).responses("fixture"), prompt: "hello" }),
    )
    const part = response.message.content[0]
    expect(part?.type).toBe("compaction")
    if (part?.type !== "compaction") return
    expect(part.id).toMatch(/^cmp_[0-9a-f]{32}$/)
    expect(part.encrypted).toBe("opaque")
  }),
)
