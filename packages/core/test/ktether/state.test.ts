import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { isolateHome } from "./helpers"
import { markStopped, readState, recordUsage, saveState, stateFilePath, usageHoursLastWeek } from "@opencode/core/ktether/state"

let home: ReturnType<typeof isolateHome>
beforeEach(() => {
  home = isolateHome()
})
afterEach(() => home.restore())

const HOUR = 3_600_000
const NOW = 1_800_000_000_000

describe("state", () => {
  test("returns an empty state when nothing was saved or the file is corrupt", () => {
    expect(readState()).toEqual({})
    fs.mkdirSync(stateFilePath().replace(/[\\/][^\\/]+$/, ""), { recursive: true })
    fs.writeFileSync(stateFilePath(), "{not json")
    expect(readState()).toEqual({})
  })

  test("round-trips and leaves no temp files behind", () => {
    saveState({ url: "https://a.trycloudflare.com", apiKey: "kgp_x", status: "ready" })
    expect(readState()).toEqual({ url: "https://a.trycloudflare.com", apiKey: "kgp_x", status: "ready" })
    const leftovers = fs.readdirSync(stateFilePath().replace(/[\\/][^\\/]+$/, "")).filter((f) => f.endsWith(".tmp"))
    expect(leftovers).toEqual([])
  })

  test("markStopped drops the endpoint and credentials but keeps what stop and clean need", () => {
    const stopped = markStopped({
      url: "https://a.trycloudflare.com",
      apiKey: "kgp_x",
      signingKey: "s",
      channelId: "kt_1",
      model: "m",
      sessionStart: 1,
      timings: { a: 1 },
      status: "ready",
      active: true,
    })
    expect(stopped).toEqual({ model: "m", channelId: "kt_1", signingKey: "s", status: "stopped", active: false })
  })
})

describe("usage ledger", () => {
  test("sums session time over the trailing week", () => {
    recordUsage({ start: NOW - 5 * HOUR, end: NOW - 3 * HOUR }, NOW)
    recordUsage({ start: NOW - 2 * HOUR, end: NOW - 1 * HOUR }, NOW)
    expect(usageHoursLastWeek(NOW)).toBeCloseTo(3, 5)
  })

  test("counts only the part of a session that falls inside the window", () => {
    const week = 7 * 24 * HOUR
    // Three hours long, but only its last hour is within the 7 days before NOW.
    recordUsage({ start: NOW - week - 2 * HOUR, end: NOW - week + HOUR }, NOW)
    expect(usageHoursLastWeek(NOW)).toBeCloseTo(1, 5)
  })

  test("forgets sessions older than a week and ignores empty ones", () => {
    const week = 7 * 24 * HOUR
    recordUsage({ start: NOW - week - 10 * HOUR, end: NOW - week - 8 * HOUR }, NOW - week - 8 * HOUR)
    recordUsage({ start: NOW, end: NOW }, NOW)
    recordUsage({ start: NOW - HOUR, end: NOW }, NOW)
    expect(usageHoursLastWeek(NOW)).toBeCloseTo(1, 5)
  })
})
