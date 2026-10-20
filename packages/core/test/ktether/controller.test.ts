import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  createController,
  OperationInProgressError,
  UnknownModelError,
  type Controller,
} from "@opencode/core/ktether/controller"
import { DEFAULT_MODEL } from "@opencode/core/ktether/registry"
import { readState, saveState } from "@opencode/core/ktether/state"
import {
  answeringKernel,
  createFakeClock,
  createFakeRelay,
  installFakeKaggle,
  isolateHome,
  uninstallFakeKaggle,
  type FakeKaggle,
  type FakeRelay,
} from "./helpers"

const TUNNEL = "https://alpha-beta.trycloudflare.com"

let home: ReturnType<typeof isolateHome>
let kaggle: FakeKaggle
let relay: FakeRelay

beforeEach(() => {
  home = isolateHome()
  kaggle = installFakeKaggle(["COMPLETE", "RUNNING"])
  relay = createFakeRelay()
})

afterEach(() => {
  uninstallFakeKaggle()
  home.restore()
})

/** Operations run in the background, so wait (bounded) until the latest one has finished. */
async function settled(controller: Controller) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const status = await controller.status()
    if (status.operation?.finishedAt !== undefined) return status
    await Bun.sleep(1)
  }
  throw new Error("operation did not finish")
}

describe("ktether controller", () => {
  test("start returns at once, then reports the finished operation and a ready session", async () => {
    const clock = createFakeClock()
    relay.healthy.add("alpha-beta.trycloudflare.com")
    const controller = createController({ fetch: relay.fetch, now: clock.now, sleep: answeringKernel(relay, clock, TUNNEL) })

    const began = controller.start({ model: "qwen3.6-27b" })
    expect(began).toMatchObject({ kind: "start", finishedAt: undefined })

    const status = await settled(controller)
    expect(status.operation?.error).toBeUndefined()
    expect(status.operation?.log.join("\n")).toContain("ktether is Ready!")
    expect(status).toMatchObject({ state: "ready", url: TUNNEL, model: "qwen3.6-27b" })
  })

  test("uses the default model when none is given", async () => {
    const clock = createFakeClock()
    const controller = createController({ fetch: relay.fetch, now: clock.now, sleep: answeringKernel(relay, clock, TUNNEL) })
    controller.start()
    await settled(controller)
    expect(readState().model).toBe(DEFAULT_MODEL)
  })

  test("rejects an unknown model without touching Kaggle", () => {
    const controller = createController({ fetch: relay.fetch })
    expect(() => controller.start({ model: "gpt-9" })).toThrow(UnknownModelError)
    expect(kaggle.calls).toHaveLength(0)
  })

  test("refuses to start a second operation while one is running", async () => {
    kaggle = installFakeKaggle(["COMPLETE", "QUEUED"])
    const clock = createFakeClock()
    const controller = createController({
      fetch: relay.fetch,
      now: clock.now,
      // Yield a real macrotask so the background start does not starve this test while it is still queued.
      sleep: async (ms) => {
        await clock.sleep(ms)
        await Bun.sleep(1)
      },
      poll: { queueTimeoutSeconds: 5 },
    })

    controller.start()
    expect(() => controller.stop()).toThrow(OperationInProgressError)
    expect(() => controller.start()).toThrow(OperationInProgressError)

    const status = await settled(controller)
    expect(status.operation?.error).toContain("Still queued")
    // Once finished, the next operation is accepted again.
    expect(controller.stop().kind).toBe("stop")
  })

  test("stop ends the session and a later status reports it stopped", async () => {
    saveState({ url: TUNNEL, status: "ready", active: true, channelId: "kt_x", signingKey: "s".repeat(64), model: DEFAULT_MODEL })
    const controller = createController({ fetch: relay.fetch })
    controller.stop()
    const status = await settled(controller)
    expect(status.operation).toMatchObject({ kind: "stop", error: undefined })
    expect(status.state).toBe("stopped")
    expect(relay.posted.some((post) => post.url.endsWith("kt_x_ctrl"))).toBe(true)
  })

  test("clean only previews until confirmed", async () => {
    const controller = createController({ fetch: relay.fetch })
    controller.clean()
    const preview = await settled(controller)
    expect(preview.operation?.log.join("\n")).toContain("Re-run with --yes")
    expect(kaggle.calls.some((call) => call[1] === "delete")).toBe(false)

    kaggle = installFakeKaggle(["COMPLETE"])
    controller.clean({ confirm: true })
    await settled(controller)
    expect(kaggle.calls.filter((call) => call[1] === "delete")).toEqual([
      ["kernels", "delete", "tester/ktether-runner", "--yes"],
    ])
  })

  test("records a failed operation with its error and keeps the log", async () => {
    kaggle.pushResult = { status: 1, output: "403 Forbidden" }
    const controller = createController({ fetch: relay.fetch })
    controller.start()
    const status = await settled(controller)
    expect(status.operation?.error).toContain("403 Forbidden")
    expect(status.operation?.log.at(-1)).toContain("403 Forbidden")
  })

  test("lists every model with the default first-class entry", () => {
    const models = createController().models()
    expect(models.map((model) => model.id)).toContain(DEFAULT_MODEL)
    expect(models.find((model) => model.id === DEFAULT_MODEL)?.toolCalling).toBe("reliable")
  })

  test("doctor reports each prerequisite", async () => {
    const checks = await createController({ fetch: relay.fetch }).doctor()
    expect(checks.map((check) => check.name)).toEqual([
      "Kaggle CLI",
      "Kaggle credentials",
      "Signalling relay",
      "Hugging Face",
      "Cloudflare",
    ])
  })
})
