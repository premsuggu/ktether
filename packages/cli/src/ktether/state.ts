import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Persistent ktether session state, shared with the provider in packages/ai (which reads `url` and `apiKey`).
 * The file holds secrets, so it is written atomically and readable only by the current user.
 */
export interface KTetherState {
  url?: string
  apiKey?: string
  /** HMAC key authenticating signalling messages. Never sent over the relay. */
  signingKey?: string
  model?: string
  channelId?: string
  sessionStart?: number
  active?: boolean
  status?: "pending" | "ready" | "stopped"
  /** Seconds after kernel start at which each boot stage finished. */
  timings?: Record<string, number>
}

export interface UsageEntry {
  readonly start: number
  readonly end: number
}

const stateDir = (): string => path.join(os.homedir(), ".local", "state", "opencode")

export const stateFilePath = (): string => path.join(stateDir(), "ktether.json")
export const usageFilePath = (): string => path.join(stateDir(), "ktether-usage.json")

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 })
  fs.renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T
  } catch {
    return fallback
  }
}

export const readState = (): KTetherState => readJson<KTetherState>(stateFilePath(), {})
export const saveState = (state: KTetherState): void => writeJson(stateFilePath(), state)

/** Keeps the identifiers needed to stop or clean later, drops the endpoint and credentials. */
export function markStopped(state: KTetherState): KTetherState {
  return { model: state.model, channelId: state.channelId, signingKey: state.signingKey, status: "stopped", active: false }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Local record of GPU session time. Kaggle does not expose the remaining weekly quota through its API, so this
 * is an estimate of what ktether itself has used over the trailing week.
 */
export function recordUsage(entry: UsageEntry, now: number = Date.now()): void {
  const kept = readJson<UsageEntry[]>(usageFilePath(), []).filter((e) => e.end > now - WEEK_MS)
  if (entry.end > entry.start) kept.push(entry)
  writeJson(usageFilePath(), kept)
}

export function usageHoursLastWeek(now: number = Date.now()): number {
  const entries = readJson<UsageEntry[]>(usageFilePath(), [])
  const ms = entries.reduce((sum, e) => sum + Math.max(0, e.end - Math.max(e.start, now - WEEK_MS)), 0)
  return ms / 3_600_000
}
