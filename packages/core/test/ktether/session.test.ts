import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { latestReady, pollSignaling, SessionFailure } from "@ktether/core/ktether/session"
import { generateSigningKey } from "@ktether/core/ktether/signaling"
import { createFakeClock, createFakeRelay, installFakeKaggle, uninstallFakeKaggle } from "./helpers"

const KEY = generateSigningKey()
const URL1 = "https://one-two.trycloudflare.com"

beforeEach(() => installFakeKaggle(["RUNNING"]))
afterEach(() => uninstallFakeKaggle())

const poll = (relay: ReturnType<typeof createFakeRelay>, clock = createFakeClock(), extra = {}) =>
  pollSignaling("kt_chan", KEY, {
    username: "tester",
    fetch: relay.fetch,
    sleep: clock.sleep,
    now: clock.now,
    ...extra,
  })

describe("pollSignaling", () => {
  test("returns the signed ready signal with boot timings", async () => {
    const relay = createFakeRelay()
    relay.publish(KEY, { event: "starting", timestamp: 1, gpu: "T4" })
    relay.publish(KEY, { event: "ready", timestamp: 2, tunnel_url: URL1, model: "m", gpu: "T4", timings: { binaries: 20 } })
    const progress: string[] = []
    const ready = await poll(relay, undefined, { onProgress: (e: string) => progress.push(e) })
    expect(ready.tunnel_url).toBe(URL1)
    expect(ready.timings).toEqual({ binaries: 20 })
    expect(progress).toEqual(["starting", "ready"])
  })

  test("ignores messages signed with a different key", async () => {
    const relay = createFakeRelay()
    relay.publish(generateSigningKey(), { event: "ready", timestamp: 1, tunnel_url: "https://evil.trycloudflare.com" })
    relay.publish(KEY, { event: "ready", timestamp: 2, tunnel_url: URL1, model: "m", gpu: "g" })
    expect((await poll(relay)).tunnel_url).toBe(URL1)
  })

  test("refuses a signed ready whose URL is not a trycloudflare https address", async () => {
    const relay = createFakeRelay()
    relay.publish(KEY, { event: "ready", timestamp: 1, tunnel_url: "https://evil.example.com", model: "m", gpu: "g" })
    await expect(poll(relay)).rejects.toBeInstanceOf(SessionFailure)
  })

  test("fails when the kernel reports it stopped", async () => {
    const relay = createFakeRelay()
    relay.publish(KEY, { event: "stopped", timestamp: 1, reason: "error: out of memory" })
    await expect(poll(relay)).rejects.toThrow("out of memory")
  })

  test("fails fast, with the log, when Kaggle ends the kernel before the tunnel is ready", async () => {
    installFakeKaggle(["QUEUED", "RUNNING", "ERROR"])
    const relay = createFakeRelay()
    const statuses: string[] = []
    await expect(poll(relay, undefined, { onStatus: (s: string) => statuses.push(s) })).rejects.toThrow(
      /ended \(ERROR\).*kernel log tail/,
    )
    expect(statuses).toEqual(["QUEUED", "RUNNING", "ERROR"])
  })

  test("survives transient relay failures", async () => {
    const relay = createFakeRelay()
    let failures = 2
    const flaky: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (failures-- > 0) throw new Error("socket hang up")
      return relay.fetch(input, init)
    }) as typeof fetch
    relay.publish(KEY, { event: "ready", timestamp: 1, tunnel_url: URL1, model: "m", gpu: "g" })
    const clock = createFakeClock()
    const ready = await pollSignaling("kt_chan", KEY, { fetch: flaky, sleep: clock.sleep, now: clock.now })
    expect(ready.tunnel_url).toBe(URL1)
  })

  test("gives up waiting in the queue after the queue timeout and explains how to continue", async () => {
    installFakeKaggle(["QUEUED"])
    const relay = createFakeRelay()
    await expect(poll(relay, undefined, { queueTimeoutSeconds: 60 })).rejects.toThrow(/Still queued.*start again/)
  })

  test("gives up if the kernel runs but never becomes ready", async () => {
    installFakeKaggle(["RUNNING"])
    const relay = createFakeRelay()
    await expect(poll(relay, undefined, { bootTimeoutSeconds: 60 })).rejects.toThrow(/not ready within 60s/)
  })

  test("does not count queue time against the boot timeout", async () => {
    installFakeKaggle([...Array(40).fill("QUEUED"), "RUNNING"])
    const relay = createFakeRelay()
    const clock = createFakeClock()
    const began = clock.now()
    let published = false
    // Ten simulated minutes in the queue, far beyond the 120s boot timeout.
    const sleep = async (ms: number) => {
      await clock.sleep(ms)
      if (!published && clock.now() - began >= 600_000) {
        published = true
        relay.publish(KEY, { event: "ready", timestamp: 9, tunnel_url: URL1, model: "m", gpu: "g" })
      }
    }
    const ready = await pollSignaling("kt_chan", KEY, {
      username: "tester",
      fetch: relay.fetch,
      sleep,
      now: clock.now,
      bootTimeoutSeconds: 120,
      queueTimeoutSeconds: 3600,
    })
    expect(ready.tunnel_url).toBe(URL1)
  })
})

describe("latestReady", () => {
  test("returns the most recent signed ready, such as after a tunnel replacement", async () => {
    const relay = createFakeRelay()
    relay.publish(KEY, { event: "ready", timestamp: 10, tunnel_url: URL1, model: "m", gpu: "g" })
    relay.publish(KEY, {
      event: "ready",
      timestamp: 20,
      tunnel_url: "https://three-four.trycloudflare.com",
      model: "m",
      gpu: "g",
      reconnected: true,
    })
    expect((await latestReady("kt_chan", KEY, relay.fetch))?.tunnel_url).toBe("https://three-four.trycloudflare.com")
  })

  test("returns undefined when nothing trustworthy was published", async () => {
    const relay = createFakeRelay()
    relay.publish(generateSigningKey(), { event: "ready", timestamp: 1, tunnel_url: URL1 })
    expect(await latestReady("kt_chan", KEY, relay.fetch)).toBeUndefined()
  })
})
