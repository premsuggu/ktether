import { Option, Schema } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Persistent ktether session state, shared with the provider in packages/ai (which reads `url` and `apiKey`).
 * The file holds secrets, so it is written atomically and readable only by the current user.
 */
const State = Schema.Struct({
  url: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  /** HMAC key authenticating signalling messages. Never sent over the relay. */
  signingKey: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  channelId: Schema.optional(Schema.String),
  sessionStart: Schema.optional(Schema.Number),
  active: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["pending", "ready", "stopped"])),
  /** Seconds after kernel start at which each boot stage finished. */
  timings: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
})
export type KTetherState = typeof State.Type

const Usage = Schema.Array(Schema.Struct({ start: Schema.Number, end: Schema.Number }))
export type UsageEntry = typeof Usage.Type[number]

const stateDir = (): string => path.join(os.homedir(), ".local", "state", "opencode")

export const stateFilePath = (): string => path.join(stateDir(), "ktether.json")
export const usageFilePath = (): string => path.join(stateDir(), "ktether-usage.json")

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 })
  fs.renameSync(tmp, file)
}

// A missing or corrupt file means "no session", never an error: decoding at this boundary is what lets the rest of
// the code trust the typed value.
function readJson<A, I>(file: string, schema: Schema.Codec<A, I>, fallback: A): A {
  if (!fs.existsSync(file)) return fallback
  return Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(schema))(fs.readFileSync(file, "utf-8")), () => fallback)
}

export const readState = (): KTetherState => readJson(stateFilePath(), State, {})
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
  const kept = readJson(usageFilePath(), Usage, []).filter((e) => e.end > now - WEEK_MS)
  writeJson(usageFilePath(), entry.end > entry.start ? [...kept, entry] : kept)
}

export function usageHoursLastWeek(now: number = Date.now()): number {
  const entries = readJson(usageFilePath(), Usage, [])
  const ms = entries.reduce((sum, e) => sum + Math.max(0, e.end - Math.max(e.start, now - WEEK_MS)), 0)
  return ms / 3_600_000
}
