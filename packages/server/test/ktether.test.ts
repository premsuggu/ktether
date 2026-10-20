import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { installFakeKaggle, isolateHome, uninstallFakeKaggle } from "../../core/test/ktether/helpers"
import { ServerFetch } from "../src/fetch"

// The routes drive a process-wide resource (the laptop's Kaggle session), so each test gets its own home directory and
// a fake Kaggle CLI. Nothing here reaches the network or the real session file.
const environment = Effect.acquireRelease(
  Effect.sync(() => {
    const home = isolateHome()
    installFakeKaggle(["RUNNING"])
    return home
  }),
  (home) =>
    Effect.sync(() => {
      uninstallFakeKaggle()
      home.restore()
    }),
)

const server = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("ktether-endpoint-")))
  const global = path.join(tmp.path, "global")
  yield* Effect.promise(() => fs.mkdir(global))
  const handler = yield* ServerFetch.make({
    database: { path: ":memory:" },
    config: { directory: global },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  const call = (method: "GET" | "POST", route: string, body?: unknown) =>
    Effect.promise(() =>
      handler(
        new Request(`http://ktether.local${route}`, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  return { call }
})

it.live("routes GET /api/ktether with the session state and no secrets", () =>
  Effect.gen(function* () {
    yield* environment
    const { call } = yield* server
    const response = yield* call("GET", "/api/ktether")
    expect(response.status).toBe(200)
    const text = yield* Effect.promise(() => response.text())
    expect(JSON.parse(text)).toMatchObject({
      data: { state: "stopped", usage: { quotaHours: 30 }, hasCredentials: true },
    })
    expect(text).not.toMatch(/kgp_|signingKey|apiKey/)
  }),
)

it.live("lists the curated models and marks the default", () =>
  Effect.gen(function* () {
    yield* environment
    const { call } = yield* server
    const response = yield* call("GET", "/api/ktether/models")
    expect(response.status).toBe(200)
    const body = (yield* Effect.promise(() => response.json())) as {
      data: { id: string; default: boolean; toolCalling: string }[]
    }
    expect(body.data.filter((model) => model.default).map((model) => model.id)).toEqual(["qwen3.6-27b"])
    expect(body.data.find((model) => model.id === "qwen3.6-27b")?.toolCalling).toBe("reliable")
    expect(body.data.find((model) => model.id === "qwen2.5-coder-14b")?.toolCalling).toBe("unreliable")
  }),
)

it.live("rejects starting an unknown model as a bad request", () =>
  Effect.gen(function* () {
    yield* environment
    const { call } = yield* server
    const response = yield* call("POST", "/api/ktether/start", { model: "gpt-9" })
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "InvalidRequestError", field: "model" })
  }),
)

it.live("runs clean in the background as a preview that deletes nothing, and reports it through status", () =>
  Effect.gen(function* () {
    yield* environment
    const { call } = yield* server
    const started = yield* call("POST", "/api/ktether/clean", {})
    expect(started.status).toBe(200)
    expect(yield* Effect.promise(() => started.json())).toMatchObject({ data: { kind: "clean" } })

    // Absent optional fields travel as JSON null; the generated client decodes them back to undefined.
    type Operation = { finishedAt?: number | null; log: string[]; error?: string | null }
    const deadline = Date.now() + 10_000
    let operation: Operation | undefined
    while (Date.now() < deadline) {
      const response = yield* call("GET", "/api/ktether")
      operation = ((yield* Effect.promise(() => response.json())) as { data: { operation?: Operation } }).data.operation
      if (operation?.finishedAt != null) break
      yield* Effect.promise(() => Bun.sleep(1))
    }
    expect(operation?.finishedAt).not.toBeNull()
    expect(operation?.error ?? undefined).toBeUndefined()
    expect(operation?.log.join("\n")).toContain("Re-run with --yes")
  }),
)
