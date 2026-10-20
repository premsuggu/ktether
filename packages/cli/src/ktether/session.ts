import { getKernelOutput, getKernelStatus, TERMINAL_STATUSES, type KernelStatus } from "./kaggle"
import { isTunnelUrl, openEnvelope, relayBase } from "./signaling"

export interface ReadySignal {
  readonly tunnel_url: string
  readonly model: string
  readonly gpu: string
  /** Seconds after kernel start at which each boot stage finished. */
  readonly timings: Readonly<Record<string, number>>
}

export interface PollOptions {
  /** Max time to wait for Kaggle to assign a GPU (kernel QUEUED). */
  readonly queueTimeoutSeconds?: number
  /** Max time from the kernel starting to RUNNING until the tunnel is ready. */
  readonly bootTimeoutSeconds?: number
  readonly username?: string
  readonly onProgress?: (event: string, data: Record<string, unknown>) => void
  readonly onStatus?: (status: KernelStatus) => void
  readonly pollIntervalMs?: number
  readonly statusIntervalMs?: number
  /** Injectable for tests. */
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/** Raised for failures that retrying cannot fix: the kernel stopped, or reported something we refuse to trust. */
export class SessionFailure extends Error {}

const toReady = (payload: Record<string, unknown>): ReadySignal => {
  if (!isTunnelUrl(payload.tunnel_url)) throw new SessionFailure("Kernel reported an invalid tunnel URL")
  return {
    tunnel_url: payload.tunnel_url,
    model: String(payload.model),
    gpu: String(payload.gpu),
    timings: (payload.timings as Record<string, number> | undefined) ?? {},
  }
}

async function readSignals(
  channelId: string,
  signingKey: string,
  doFetch: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const resp = await doFetch(`${relayBase()}/${channelId}/json?poll=1&since=all`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) return []
  const signals: Record<string, unknown>[] = []
  for (const line of (await resp.text()).split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.event !== "message") continue
      // Anything not signed with our key is ignored: the relay is untrusted.
      const payload = openEnvelope(signingKey, entry.message)
      if (payload) signals.push(payload)
    } catch {
      continue
    }
  }
  return signals
}

/**
 * Returns the most recent signed "ready" signal, or undefined. Used to re-attach to a session whose tunnel
 * was replaced by the kernel after a drop.
 */
export async function latestReady(
  channelId: string,
  signingKey: string,
  doFetch: typeof fetch = fetch,
): Promise<ReadySignal | undefined> {
  const signals = await readSignals(channelId, signingKey, doFetch)
  const ready = signals.filter((s) => s.event === "ready").sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  const last = ready.at(-1)
  return last ? toReady(last) : undefined
}

export async function pollSignaling(channelId: string, signingKey: string, options: PollOptions = {}): Promise<ReadySignal> {
  const {
    queueTimeoutSeconds = 3600,
    bootTimeoutSeconds = 900,
    username,
    onProgress,
    onStatus,
    pollIntervalMs = 3000,
    statusIntervalMs = 15_000,
    fetch: doFetch = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options

  const startTime = now()
  let runningSince: number | undefined
  let lastStatusCheck = Number.NEGATIVE_INFINITY
  let lastStatus: KernelStatus | undefined
  const seen = new Set<string>()

  while (true) {
    try {
      for (const payload of await readSignals(channelId, signingKey, doFetch)) {
        const key = `${payload.event}_${payload.timestamp}`
        if (seen.has(key)) continue
        seen.add(key)
        if (payload.event === "starting" && runningSince === undefined) runningSince = now()
        onProgress?.(String(payload.event), payload)
        if (payload.event === "ready") return toReady(payload)
        if (payload.event === "stopped") throw new SessionFailure(`Kaggle kernel stopped: ${payload.reason}`)
      }
    } catch (e: unknown) {
      if (e instanceof SessionFailure) throw e
      // Transient relay or network trouble: try again on the next tick.
    }

    if (username && now() - lastStatusCheck >= statusIntervalMs) {
      lastStatusCheck = now()
      const status = getKernelStatus(username)
      if (status && status !== lastStatus) {
        lastStatus = status
        onStatus?.(status)
      }
      if (status === "RUNNING" && runningSince === undefined) runningSince = now()
      if (status && TERMINAL_STATUSES.has(status)) {
        throw new SessionFailure(
          `Kaggle kernel ended (${status}) before the tunnel was ready. ${getKernelOutput(username)}`,
        )
      }
    }

    if (runningSince === undefined && now() - startTime > queueTimeoutSeconds * 1000) {
      throw new Error(`Still queued on Kaggle after ${queueTimeoutSeconds}s waiting for a GPU. Run start again to keep waiting.`)
    }
    if (runningSince !== undefined && now() - runningSince > bootTimeoutSeconds * 1000) {
      throw new Error(`Kernel started but was not ready within ${bootTimeoutSeconds}s. Run start again to keep waiting.`)
    }

    await sleep(pollIntervalMs)
  }
}

export async function sendStopSignal(
  channelId: string,
  message: string,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const resp = await doFetch(`${relayBase()}/${channelId}_ctrl`, { method: "POST", body: message })
    return resp.ok
  } catch {
    return false
  }
}
