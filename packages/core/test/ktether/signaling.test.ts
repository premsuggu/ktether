import { describe, expect, test } from "bun:test"
import {
  createStopMessage,
  generateChannelId,
  generateSigningKey,
  isTunnelUrl,
  isValidStopMessage,
  openEnvelope,
  sign,
} from "@opencode/core/ktether/signaling"

const envelope = (key: string, payload: object) => {
  const p = JSON.stringify(payload)
  return JSON.stringify({ p, s: sign(key, p) })
}

describe("ktether signalling", () => {
  const key = generateSigningKey()

  test("generates unguessable identifiers", () => {
    expect(generateChannelId()).toMatch(/^kt_[0-9a-f]{32}$/)
    expect(generateSigningKey()).toMatch(/^[0-9a-f]{64}$/)
    expect(generateChannelId()).not.toBe(generateChannelId())
  })

  test("opens an envelope signed with the shared key", () => {
    const payload = { event: "ready", tunnel_url: "https://a-b.trycloudflare.com" }
    expect(openEnvelope(key, envelope(key, payload))).toEqual(payload)
  })

  test("rejects envelopes signed with another key", () => {
    expect(openEnvelope(key, envelope(generateSigningKey(), { event: "ready" }))).toBeUndefined()
  })

  test("rejects tampered payloads", () => {
    const parsed = JSON.parse(envelope(key, { event: "ready", tunnel_url: "https://good.trycloudflare.com" }))
    parsed.p = parsed.p.replace("good", "evil")
    expect(openEnvelope(key, JSON.stringify(parsed))).toBeUndefined()
  })

  test("rejects malformed input", () => {
    for (const raw of ["", "not json", "{}", '{"p":1,"s":2}', '{"p":"x","s":"y"}']) {
      expect(openEnvelope(key, raw)).toBeUndefined()
    }
  })

  test("accepts a fresh stop message", () => {
    expect(isValidStopMessage(key, createStopMessage(key))).toBe(true)
  })

  test("rejects stop messages with a wrong key, stale timestamp, or bare text", () => {
    const now = 1_800_000_000_000
    expect(isValidStopMessage(key, createStopMessage(generateSigningKey(), now), now)).toBe(false)
    expect(isValidStopMessage(key, createStopMessage(key, now - 11 * 60 * 1000), now)).toBe(false)
    expect(isValidStopMessage(key, "STOP", now)).toBe(false)
  })

  test("only accepts https trycloudflare tunnel urls", () => {
    expect(isTunnelUrl("https://alpha-beta-gamma.trycloudflare.com")).toBe(true)
    for (const bad of [
      "http://alpha.trycloudflare.com",
      "https://alpha.trycloudflare.com.evil.example",
      "https://evil.example/alpha.trycloudflare.com",
      "https://alpha.trycloudflare.com/x",
      undefined,
    ]) {
      expect(isTunnelUrl(bad)).toBe(false)
    }
  })
})
