import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { AIError, LLMEvent, Media, SpeechEvent, TranscriptionEvent } from "../src/index.js"
import { RequestExecutor } from "../src/route.js"
import { AI } from "../src/promise.js"
import { OpenAI } from "../src/providers.js"
import { handlerLayer, json } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })

const chatBody = sseEvents(
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " world" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
)

const executor = (seen: Array<string>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      handlerLayer((input) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
          seen.push(web.url)
          if (web.url.endsWith("/images/generations"))
            return JSON.parse(input.text).stream === true
              ? input.respond(
                  sseEvents(
                    {
                      type: "image_generation.partial_image",
                      b64_json: "AQ==",
                      partial_image_index: 0,
                      output_format: "png",
                    },
                    { type: "image_generation.completed", b64_json: "AQID", output_format: "png" },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }], output_format: "png" }), {
                  headers: { "content-type": "application/json" },
                })
          if (web.url.startsWith("https://replicate.test"))
            return json(input, {
              id: "p_1",
              status: "succeeded",
              output: "https://replicate.test/a.webp",
              urls: { get: "https://replicate.test/p_1", cancel: "https://replicate.test/p_1/cancel" },
            })
          if (web.url.startsWith("https://slow.test"))
            return input.respond(
              new ReadableStream({
                start: (controller) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
                    ),
                  ),
              }),
              { headers: { "content-type": "text/event-stream" } },
            )
          if (web.url.endsWith("/chat/completions"))
            return input.respond(chatBody, { headers: { "content-type": "text/event-stream" } })
          if (web.url.endsWith("/audio/speech"))
            return JSON.parse(input.text).stream_format === "sse"
              ? input.respond(
                  sseEvents(
                    { type: "speech.audio.delta", audio: "AQI=" },
                    { type: "speech.audio.delta", audio: "Aw==" },
                    { type: "speech.audio.done", usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 } },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "audio/pcm" } })
          if (web.url.endsWith("/audio/transcriptions"))
            return input.text.includes('name="stream"')
              ? input.respond(
                  sseEvents(
                    { type: "transcript.text.delta", delta: "Hello" },
                    { type: "transcript.text.delta", delta: " there." },
                    { type: "transcript.text.done", text: "Hello there." },
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                )
              : input.respond(JSON.stringify({ text: "Hello there." }), {
                  headers: { "content-type": "application/json" },
                })
          if (web.url.endsWith("/v2/transcript"))
            return input.respond(JSON.stringify({ id: "tr_1", status: "queued" }), {
              headers: { "content-type": "application/json" },
            })
          if (web.url.endsWith("/v2/transcript/tr_1"))
            return input.respond(JSON.stringify({ id: "tr_1", status: "completed", text: "Hello there." }), {
              headers: { "content-type": "application/json" },
            })
          if (web.url.endsWith("/text_to_video"))
            return input.respond(JSON.stringify({ id: "task_1" }), { headers: { "content-type": "application/json" } })
          if (web.url.endsWith("/tasks/task_1")) {
            const polls = seen.filter((url) => url.endsWith("/tasks/task_1")).length
            return input.respond(
              JSON.stringify(
                polls === 1
                  ? { status: "RUNNING", progress: 0.5 }
                  : { status: "SUCCEEDED", output: ["https://runway.test/out.mp4"], cost: { credits: 5 } },
              ),
              { headers: { "content-type": "application/json" } },
            )
          }
          return input.respond(JSON.stringify({ error: { message: "not found" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
        }),
      ),
    ),
  )

describe("AI promise client", () => {

  test("reads, writes, and decodes assets without leaving promises", async () => {
    const ai = AI.make({ layer: executor([]) })
    const dir = await mkdtemp(join(tmpdir(), "ai-promise-"))
    try {
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
      await Bun.write(join(dir, "source.bin"), png)

      const asset = await ai.file(join(dir, "source.bin"))
      expect(asset.mediaType).toBe("image/png")
      await ai.write(asset, join(dir, "copy.png"))
      expect(await ai.bytes(await ai.file(join(dir, "copy.png")))).toEqual(png)
    } finally {
      await rm(dir, { recursive: true })
      await ai.dispose()
    }
  })

  test("generates and streams speech over the same runtime", async () => {
    const ai = AI.make({ layer: executor([]) })
    const model = openai.speech("gpt-4o-mini-tts")

    const response = await ai.speech.generate({ model, text: "Hello", voice: "coral", format: "pcm" })
    expect(await ai.run(response.audio.bytes())).toEqual(Uint8Array.from([1, 2, 3]))

    const events: Array<SpeechEvent> = []
    for await (const event of ai.speech.stream({ model, text: "Hello", voice: "coral" })) events.push(event)
    expect(events.map((event) => event.type)).toEqual(["audio-delta", "audio-delta", "finish"])
    const finish = events.find(SpeechEvent.is.finish)
    expect(await ai.run(finish!.audio.bytes())).toEqual(Uint8Array.from([1, 2, 3]))
    await ai.dispose()
  })

  test("rethrows AIError unchanged and honors abort signals", async () => {
    const ai = AI.make({ layer: executor([]) })

    const failure = await ai.llm
      .generate(ai.llm.request({ model: openai.responses("gpt-5"), prompt: "Hello" }))
      .then(() => undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AIError)
    expect(failure instanceof AIError && failure.reason.http?.status).toBe(404)

    const invalidLLM = await ai.llm
      // @ts-expect-error Invalid input must reject with AIError instead of throwing synchronously.
      .generate({ model: openai.responses("gpt-5"), messages: [{ role: "bogus" }] })
      .catch((error: unknown) => error)
    expect(invalidLLM instanceof AIError && invalidLLM.reason._tag).toBe("InvalidRequest")

    const invalid = await ai.image
      .generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse", n: 1.5 })
      .catch((error: unknown) => error)
    expect(invalid instanceof AIError && invalid.reason._tag).toBe("InvalidRequest")

    const controller = new AbortController()
    controller.abort()
    const aborted = await ai.llm
      .generate(ai.llm.request({ model: openai.chat("gpt-4o-mini"), prompt: "Hello" }), { signal: controller.signal })
      .then(() => "completed")
      .catch(() => "aborted")
    expect(aborted).toBe("aborted")

    await ai.dispose()
  })

  test("breaking out of an abortable stream cleans up without throwing", async () => {
    const ai = AI.make({ layer: executor([]) })
    const slow = OpenAI.configure({ apiKey: "test", baseURL: "https://slow.test/v1" }).chat("gpt-4o-mini")
    const controller = new AbortController()
    const deltas: Array<string> = []
    for await (const event of ai.llm.stream({ model: slow, prompt: "Hello" }, { signal: controller.signal })) {
      if (!LLMEvent.is.textDelta(event)) continue
      deltas.push(event.text)
      break
    }
    controller.abort()
    expect(deltas).toEqual(["Hello"])
    await ai.dispose()
  })

  test("the default client is created lazily and can be disposed", async () => {
    expect(typeof AI.ai.llm.generate).toBe("function")
    expect(typeof AI.ai.image.generate).toBe("function")
    expect(typeof AI.ai.video.start).toBe("function")
    expect(typeof AI.ai.speech.generate).toBe("function")
    await AI.ai.dispose()
  })
})
