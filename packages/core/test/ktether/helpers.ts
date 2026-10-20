import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { setCliRunner, type CliResult } from "@opencode/core/ktether/kaggle"
import { sign } from "@opencode/core/ktether/signaling"
import { readState } from "@opencode/core/ktether/state"

/** Points the home directory at a fresh temp dir so tests never touch real ktether or OpenCode state. */
export function isolateHome(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ktether-test-home-"))
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  const kaggle = { KAGGLE_USERNAME: process.env.KAGGLE_USERNAME, KAGGLE_KEY: process.env.KAGGLE_KEY }
  process.env.USERPROFILE = dir
  process.env.HOME = dir
  process.env.KAGGLE_USERNAME = "tester"
  process.env.KAGGLE_KEY = "not-a-real-key"
  return {
    dir,
    restore: () => {
      for (const [key, value] of Object.entries({ ...saved, ...kaggle })) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export interface FakeKaggle {
  /** Every argument list the CLI was invoked with. */
  readonly calls: string[][]
  /** Sequence of statuses returned by `kernels status`; the last one repeats. */
  statuses: string[]
  pushResult: CliResult
  deleteResult: CliResult
  stagingSeen: string[]
}

export function installFakeKaggle(statuses: string[] = ["RUNNING"]): FakeKaggle {
  const fake: FakeKaggle = {
    calls: [],
    statuses: [...statuses],
    pushResult: { status: 0, output: "Kernel version 1 successfully pushed." },
    deleteResult: { status: 0, output: "Kernel deleted." },
    stagingSeen: [],
  }
  setCliRunner((args) => {
    fake.calls.push([...args])
    const [group, verb] = args
    if (group === "--version") return { status: 0, output: "Kaggle CLI 2.2.2" }
    if (verb === "status") {
      const status = fake.statuses.length > 1 ? fake.statuses.shift()! : fake.statuses[0]
      return { status: 0, output: `tester/ktether-runner has status "KernelWorkerStatus.${status}"` }
    }
    if (verb === "push") {
      const dir = args[args.indexOf("-p") + 1]
      fake.stagingSeen.push(dir)
      return fake.pushResult
    }
    if (verb === "delete") return fake.deleteResult
    if (verb === "output") return { status: 0, output: "kernel log tail" }
    return { status: 1, output: `unexpected: ${args.join(" ")}` }
  })
  return fake
}

export const uninstallFakeKaggle = (): void => setCliRunner(undefined)

export const envelope = (key: string, payload: Record<string, unknown>): string => {
  const p = JSON.stringify(payload)
  return JSON.stringify({ p, s: sign(key, p) })
}

export interface FakeRelay {
  fetch: typeof fetch
  /** Bodies POSTed to control topics. */
  posted: { url: string; body: string }[]
  /** Signed messages the "kernel" has published, in order. */
  publish: (signingKey: string, payload: Record<string, unknown>) => void
  /** Hosts that answer health checks successfully. */
  healthy: Set<string>
  /** When set, relay polls fail with this error. */
  failPolls?: Error
}

export function createFakeRelay(): FakeRelay {
  const messages: string[] = []
  const relay: FakeRelay = {
    posted: [],
    healthy: new Set(),
    publish: (key, payload) => {
      messages.push(JSON.stringify({ event: "message", message: envelope(key, payload) }))
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") {
        relay.posted.push({ url, body: String(init.body) })
        return new Response("ok")
      }
      if (url.includes("/json?poll=1")) {
        if (relay.failPolls) throw relay.failPolls
        return new Response(messages.join("\n"))
      }
      if (url.endsWith("/health")) {
        const host = new URL(url).host
        return relay.healthy.has(host) ? new Response('{"status":"ok"}') : new Response("down", { status: 503 })
      }
      if (url.endsWith("/slots")) return new Response(JSON.stringify([{ is_processing: true }, { is_processing: false }]))
      return new Response("", { status: 404 })
    }) as typeof fetch,
  }
  return relay
}

/** A clock that only moves when the code under test sleeps. */
export function createFakeClock(start = 1_800_000_000_000) {
  let current = start
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms
    },
    advance: (ms: number) => {
      current += ms
    },
  }
}

/**
 * A sleep that doubles as the fake kernel: once the code under test has pushed a launch and saved its pending
 * session, the next sleep makes the kernel publish a signed "ready" with the given tunnel URL.
 */
export function answeringKernel(
  relay: FakeRelay,
  clock: ReturnType<typeof createFakeClock>,
  tunnelURL: string,
  extra: Record<string, unknown> = {},
) {
  let published = false
  return async (ms: number) => {
    await clock.sleep(ms)
    const state = readState()
    if (published || state.status !== "pending" || !state.signingKey) return
    published = true
    relay.publish(state.signingKey, { event: "starting", timestamp: 1, gpu: "2x T4", model: "m" })
    relay.publish(state.signingKey, {
      event: "ready",
      timestamp: 2,
      tunnel_url: tunnelURL,
      model: "m",
      gpu: "2x T4",
      timings: { binaries: 30, model_download: 120, server_ready: 200, tunnel: 205 },
      ...extra,
    })
  }
}
