import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { cleanSession, getStatus, reconnectSession, runDoctor, startSession, stopSession } from "@opencode/core/ktether/lifecycle"
import { isValidStopMessage } from "@opencode/core/ktether/signaling"
import { readState, saveState, usageHoursLastWeek } from "@opencode/core/ktether/state"
import {
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
let lines: string[]

beforeEach(() => {
  home = isolateHome()
  kaggle = installFakeKaggle(["RUNNING"])
  relay = createFakeRelay()
  lines = []
})

afterEach(() => {
  uninstallFakeKaggle()
  home.restore()
})

const deps = (clock = createFakeClock()) => ({
  out: (line: string) => lines.push(line),
  fetch: relay.fetch,
  sleep: clock.sleep,
  now: clock.now,
})

/** Makes the fake kernel answer as soon as the CLI has pushed and saved its pending session. */
function kernelBecomesReady(extra: Record<string, unknown> = {}) {
  const clock = createFakeClock()
  const base = deps(clock)
  let published = false
  return {
    ...base,
    sleep: async (ms: number) => {
      await clock.sleep(ms)
      const state = readState()
      if (!published && state.status === "pending" && state.signingKey) {
        published = true
        relay.publish(state.signingKey, { event: "starting", timestamp: 1, gpu: "2x T4", model: "m" })
        relay.publish(state.signingKey, {
          event: "ready",
          timestamp: 2,
          tunnel_url: TUNNEL,
          model: "m",
          gpu: "2x T4",
          timings: { binaries: 30, model_download: 120, server_ready: 200, tunnel: 205 },
          ...extra,
        })
      }
    },
  }
}

describe("startSession", () => {
  // A fresh launch starts from an idle kernel, which Kaggle then reports as running.
  beforeEach(() => {
    kaggle = installFakeKaggle(["COMPLETE", "RUNNING"])
  })

  test("pushes, saves a pending session immediately, then records the ready endpoint", async () => {
    const ready = await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, kernelBecomesReady())
    expect(ready?.tunnel_url).toBe(TUNNEL)

    const state = readState()
    expect(state).toMatchObject({ url: TUNNEL, status: "ready", active: true, model: "qwen3.6-27b" })
    expect(state.apiKey).toMatch(/^kgp_[0-9a-f]{32}$/)
    expect(state.signingKey).toMatch(/^[0-9a-f]{64}$/)
    expect(state.timings?.model_download).toBe(120)
    expect(lines.join("\n")).toContain("Boot breakdown: binaries 30s, model_download 90s")
  })

  test("never leaves the staging directory, which contains secrets, on disk", async () => {
    await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, kernelBecomesReady())
    expect(kaggle.stagingSeen).toHaveLength(1)
    expect(fs.existsSync(kaggle.stagingSeen[0])).toBe(false)
  })

  test("removes the staging directory even when the push fails", async () => {
    kaggle.pushResult = { status: 1, output: "403 Forbidden" }
    await expect(startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, deps())).rejects.toThrow("403 Forbidden")
    expect(fs.existsSync(kaggle.stagingSeen[0])).toBe(false)
    expect(readState().status).toBeUndefined()
  })

  test("rejects an unknown model before touching Kaggle", async () => {
    await expect(startSession({ model: "gpt-9", timeoutMinutes: 45 }, deps())).rejects.toThrow("Invalid model")
    expect(kaggle.calls).toHaveLength(0)
  })

  test("warns when the model cannot call tools reliably", async () => {
    await startSession({ model: "qwen2.5-coder-14b", timeoutMinutes: 45 }, kernelBecomesReady())
    expect(lines.join("\n")).toContain("does not call tools reliably")
  })

  test("resumes a pending launch instead of pushing a second kernel", async () => {
    saveState({ model: "qwen3.6-27b", channelId: "kt_x", apiKey: "kgp_a", signingKey: "k".repeat(64), status: "pending" })
    kaggle = installFakeKaggle(["QUEUED"])
    relay.publish("k".repeat(64), { event: "ready", timestamp: 1, tunnel_url: TUNNEL, model: "m", gpu: "g" })

    await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, deps())
    expect(kaggle.calls.some((c) => c[1] === "push")).toBe(false)
    expect(lines.join("\n")).toContain("Resuming previous launch")
    expect(readState()).toMatchObject({ url: TUNNEL, status: "ready", apiKey: "kgp_a" })
  })

  test("does not resume a launch for a different model", async () => {
    saveState({ model: "qwen2.5-coder-14b", channelId: "kt_x", apiKey: "kgp_a", signingKey: "k".repeat(64), status: "pending" })
    kaggle = installFakeKaggle(["COMPLETE", "RUNNING"])
    await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, kernelBecomesReady())
    expect(kaggle.calls.some((c) => c[1] === "push")).toBe(true)
  })

  test("is a no-op when the session is already healthy", async () => {
    saveState({ url: TUNNEL, status: "ready", active: true, model: "qwen3.6-27b" })
    relay.healthy.add("alpha-beta.trycloudflare.com")
    expect(await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, deps())).toBeUndefined()
    expect(kaggle.calls).toHaveLength(0)
    expect(lines.join("\n")).toContain("already active and healthy")
  })

  test("re-attaches to a replaced tunnel rather than launching a new kernel", async () => {
    const key = "k".repeat(64)
    saveState({ url: TUNNEL, status: "ready", active: true, channelId: "kt_x", signingKey: key, apiKey: "kgp_a", model: "qwen3.6-27b" })
    const fresh = "https://gamma-delta.trycloudflare.com"
    relay.healthy.add("gamma-delta.trycloudflare.com")
    relay.publish(key, { event: "ready", timestamp: 5, tunnel_url: fresh, model: "m", gpu: "g", reconnected: true })

    const ready = await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, deps())
    expect(ready?.tunnel_url).toBe(fresh)
    expect(readState().url).toBe(fresh)
    expect(kaggle.calls.some((c) => c[1] === "push")).toBe(false)
  })

  test("stops a still-running old kernel before pushing a new one", async () => {
    saveState({ status: "stopped", channelId: "kt_old", signingKey: "o".repeat(64) })
    kaggle = installFakeKaggle(["RUNNING", "RUNNING", "COMPLETE", "RUNNING"])
    await startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, kernelBecomesReady())
    expect(relay.posted.some((p) => p.url.endsWith("kt_old_ctrl"))).toBe(true)
    expect(lines.join("\n")).toContain("still running. Stopping it first")
  })

  test("does not leave a pending record behind when the kernel dies", async () => {
    const clock = createFakeClock()
    const base = deps(clock)
    const failing = {
      ...base,
      sleep: async (ms: number) => {
        await clock.sleep(ms)
        const key = readState().signingKey
        if (key) relay.publish(key, { event: "stopped", timestamp: 3, reason: "error: CUDA out of memory" })
      },
    }
    await expect(startSession({ model: "qwen3.6-27b", timeoutMinutes: 45 }, failing)).rejects.toThrow("CUDA out of memory")
    expect(readState().status).toBe("stopped")
  })
})

describe("stopSession", () => {
  const live = () =>
    saveState({
      url: TUNNEL,
      status: "ready",
      active: true,
      channelId: "kt_x",
      apiKey: "kgp_a",
      signingKey: "s".repeat(64),
      model: "qwen3.6-27b",
      sessionStart: 1_800_000_000_000 - 2 * 3_600_000,
    })

  test("sends an authenticated stop, closes the session and records GPU usage", async () => {
    live()
    await stopSession({ delete: false }, deps())
    const stop = relay.posted.find((p) => p.url.endsWith("kt_x_ctrl"))
    expect(stop && isValidStopMessage("s".repeat(64), stop.body, 1_800_000_000_000)).toBe(true)
    expect(readState()).toMatchObject({ status: "stopped", active: false })
    expect(readState().url).toBeUndefined()
    expect(readState().apiKey).toBeUndefined()
    expect(usageHoursLastWeek(1_800_000_000_000)).toBeCloseTo(2, 1)
  })

  test("warns that a queued kernel cannot be cancelled", async () => {
    live()
    kaggle = installFakeKaggle(["QUEUED"])
    await stopSession({ delete: false }, deps())
    expect(lines.join("\n")).toContain("still queued")
    expect(lines.join("\n")).toContain("ktether clean --yes")
  })

  test("--delete removes only the ktether notebook, after the kernel has stopped", async () => {
    live()
    kaggle = installFakeKaggle(["RUNNING", "COMPLETE"])
    await stopSession({ delete: true }, deps())
    const deletes = kaggle.calls.filter((c) => c[1] === "delete")
    expect(deletes).toEqual([["kernels", "delete", "tester/ktether-runner", "--yes"]])
  })
})

describe("cleanSession", () => {
  test("only previews without --yes and deletes nothing", async () => {
    expect(await cleanSession({ yes: false }, deps())).toBe(false)
    expect(kaggle.calls.some((c) => c[1] === "delete")).toBe(false)
    expect(lines.join("\n")).toContain("Re-run with --yes")
  })

  test("with --yes deletes exactly the ktether notebook and nothing else", async () => {
    saveState({ status: "ready", channelId: "kt_x", signingKey: "s".repeat(64), url: TUNNEL, active: true })
    kaggle = installFakeKaggle(["RUNNING", "COMPLETE"])
    expect(await cleanSession({ yes: true }, deps())).toBe(true)
    const refs = kaggle.calls.filter((c) => c[1] === "delete").map((c) => c[2])
    expect(refs).toEqual(["tester/ktether-runner"])
    expect(readState().url).toBeUndefined()
  })

  test("reports when there is nothing to delete", async () => {
    uninstallFakeKaggle()
    const { setCliRunner } = await import("@opencode/core/ktether/kaggle")
    setCliRunner(() => ({ status: 1, output: "404 Not Found" }))
    expect(await cleanSession({ yes: true }, deps())).toBe(false)
    expect(lines.join("\n")).toContain("Nothing to clean")
  })

  test("surfaces a failed delete as an error and keeps local state", async () => {
    saveState({ status: "ready", url: TUNNEL, active: true })
    kaggle.deleteResult = { status: 1, output: "403 Forbidden" }
    await expect(cleanSession({ yes: true }, deps())).rejects.toThrow("403 Forbidden")
    expect(readState().url).toBe(TUNNEL)
  })
})

describe("getStatus", () => {
  test("reports health, uptime, boot stages and slot usage for a live session", async () => {
    const clock = createFakeClock()
    saveState({
      url: TUNNEL,
      status: "ready",
      active: true,
      apiKey: "kgp_a",
      model: "qwen3.6-27b",
      sessionStart: clock.now() - 90 * 60_000,
      timings: { binaries: 30, model_download: 150 },
    })
    relay.healthy.add("alpha-beta.trycloudflare.com")
    const status = await getStatus(deps(clock))
    expect(status).toMatchObject({
      state: "ready",
      url: TUNNEL,
      model: "qwen3.6-27b",
      kernel: "RUNNING",
      uptimeMinutes: 90,
      slots: { busy: 1, total: 2 },
      bootStages: [
        { stage: "binaries", seconds: 30 },
        { stage: "model_download", seconds: 120 },
      ],
    })
    expect(status.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test("never exposes credentials", async () => {
    saveState({ url: TUNNEL, status: "ready", active: true, apiKey: "kgp_secret", signingKey: "s".repeat(64) })
    relay.healthy.add("alpha-beta.trycloudflare.com")
    expect(JSON.stringify(await getStatus(deps()))).not.toMatch(/kgp_secret|ssssssss/)
  })

  test("closes a stale session whose kernel ended on its own, and counts the usage", async () => {
    const clock = createFakeClock()
    saveState({ url: TUNNEL, status: "ready", active: true, sessionStart: clock.now() - 3_600_000 })
    kaggle = installFakeKaggle(["COMPLETE"])
    const status = await getStatus(deps(clock))
    expect(status).toMatchObject({ state: "stopped", closedStaleSession: "COMPLETE" })
    expect(readState().status).toBe("stopped")
    expect(usageHoursLastWeek(clock.now())).toBeCloseTo(1, 1)
  })

  test("reports an unreachable tunnel so clients can offer reconnect", async () => {
    saveState({ url: TUNNEL, status: "ready", active: true, model: "qwen3.6-27b" })
    expect(await getStatus(deps())).toMatchObject({ state: "unreachable", url: TUNNEL })
  })

  test("describes a pending launch and a stopped one", async () => {
    saveState({ status: "pending", channelId: "kt_x" })
    expect((await getStatus(deps())).state).toBe("pending")
    saveState({ status: "stopped" })
    expect((await getStatus(deps())).state).toBe("stopped")
  })

  test("tells clients whether Kaggle credentials exist", async () => {
    const saved = { user: process.env.KAGGLE_USERNAME, key: process.env.KAGGLE_KEY }
    delete process.env.KAGGLE_USERNAME
    delete process.env.KAGGLE_KEY
    try {
      expect(await getStatus(deps())).toMatchObject({ hasCredentials: false, state: "stopped" })
    } finally {
      process.env.KAGGLE_USERNAME = saved.user
      process.env.KAGGLE_KEY = saved.key
    }
  })
})

describe("reconnectSession", () => {
  test("refuses without a session", async () => {
    expect(await reconnectSession(deps())).toBeUndefined()
    expect(lines.join("\n")).toContain("No ktether session")
  })

  test("does not adopt an endpoint that fails its health check", async () => {
    const key = "k".repeat(64)
    saveState({ channelId: "kt_x", signingKey: key, status: "ready", url: TUNNEL })
    relay.publish(key, { event: "ready", timestamp: 1, tunnel_url: "https://dead-one.trycloudflare.com", model: "m", gpu: "g" })
    expect(await reconnectSession(deps())).toBeUndefined()
    expect(readState().url).toBe(TUNNEL)
  })
})

describe("runDoctor", () => {
  test("passes when the CLI, credentials and network are available", async () => {
    const checks = await runDoctor({ fetch: relay.fetch })
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(checks.map((c) => c.name)).toContain("Kaggle CLI")
  })

  test("reports a missing Kaggle CLI with install guidance", async () => {
    const { setCliRunner } = await import("@opencode/core/ktether/kaggle")
    setCliRunner(() => ({ status: null, output: "", error: Object.assign(new Error("spawn kaggle ENOENT"), { code: "ENOENT" }) }))
    const checks = await runDoctor({ fetch: relay.fetch })
    expect(checks.find((c) => c.name === "Kaggle CLI")).toMatchObject({ ok: false })
    expect(checks.find((c) => c.name === "Kaggle CLI")?.detail).toContain("pip install kaggle")
  })
})
