import crypto from "node:crypto"

/**
 * Message authentication for the laptop <-> Kaggle signalling channel.
 *
 * The channel is a pub/sub topic on a relay (ntfy by default) that we do not trust. Secrets are never sent over
 * it. Instead each message carries an HMAC made with a signing key that only exists on this machine and inside the
 * private Kaggle kernel, so a forged "ready" cannot redirect traffic and a forged "stop" cannot end a session.
 */

const STOP_MAX_AGE_SECONDS = 600
const TUNNEL_URL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/

export const generateChannelId = (): string => `kt_${crypto.randomBytes(16).toString("hex")}`
export const generateSigningKey = (): string => crypto.randomBytes(32).toString("hex")
export const generateApiKey = (): string => `kgp_${crypto.randomBytes(16).toString("hex")}`

export const relayBase = (): string => (process.env.KTETHER_NTFY_URL ?? "https://ntfy.sh").replace(/\/+$/, "")

export const sign = (key: string, message: string): string =>
  crypto.createHmac("sha256", key).update(message).digest("hex")

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/** Verifies a `{ p, s }` envelope produced by the kernel and returns the decoded payload, or undefined if forged. */
export function openEnvelope(key: string, raw: string): Record<string, unknown> | undefined {
  try {
    const envelope = JSON.parse(raw) as { p?: unknown; s?: unknown }
    if (typeof envelope.p !== "string" || typeof envelope.s !== "string") return undefined
    if (!safeEqual(envelope.s, sign(key, envelope.p))) return undefined
    const payload = JSON.parse(envelope.p)
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export const createStopMessage = (key: string, nowMs: number = Date.now()): string => {
  const ts = (nowMs / 1000).toFixed(3)
  return `STOP:${ts}:${sign(key, `STOP:${ts}`)}`
}

/** Mirrors the check the kernel performs. Exposed so the two sides can be tested against each other. */
export function isValidStopMessage(key: string, text: string, nowMs: number = Date.now()): boolean {
  const parts = text.trim().split(":")
  if (parts.length !== 3 || parts[0] !== "STOP") return false
  const ts = Number(parts[1])
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > STOP_MAX_AGE_SECONDS) return false
  return safeEqual(parts[2], sign(key, `STOP:${parts[1]}`))
}

export const isTunnelUrl = (value: unknown): value is string => typeof value === "string" && TUNNEL_URL.test(value)
