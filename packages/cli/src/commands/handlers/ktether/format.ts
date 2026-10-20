import { EOL } from "node:os"
import type { KTetherClient } from "./connection"

type Status = Awaited<ReturnType<KTetherClient["ktether"]["status"]>>
type Models = Awaited<ReturnType<KTetherClient["ktether"]["models"]>>
type Checks = Awaited<ReturnType<KTetherClient["ktether"]["doctor"]>>

export function formatStatus(status: Status): string {
  const lines = ["=== ktether Session Status ==="]
  if (status.hasCredentials) lines.push(`Kaggle Kernel: ${status.kernel ?? "not deployed yet"}`)
  if (status.closedStaleSession) lines.push(`The kernel ended (${status.closedStaleSession}). Closing the stale session.`)
  lines.push(
    `GPU time used by ktether, last 7 days: ~${status.usage.hoursLastWeek.toFixed(1)}h of ${status.usage.quotaHours}h (local estimate)`,
  )

  if (!status.url) {
    lines.push(
      status.state === "pending"
        ? "Status: LAUNCH PENDING (run `ktether start` to resume waiting)"
        : "Status: STOPPED / NO ACTIVE TUNNEL",
    )
    return lines.join(EOL)
  }

  lines.push(`Tunnel URL: ${status.url}`, `Active Model: ${status.model}`)
  if (status.state === "unreachable") {
    lines.push("Health Check: UNREACHABLE", "Try `ktether reconnect` in case the tunnel was replaced.")
    return lines.join(EOL)
  }
  lines.push(`Health Check: HEALTHY (${status.latencyMs}ms)`)
  if (status.uptimeMinutes != null) lines.push(`Uptime: ${status.uptimeMinutes.toFixed(1)} minutes`)
  if (status.bootStages?.length)
    lines.push(`Boot breakdown: ${status.bootStages.map((item) => `${item.stage} ${item.seconds.toFixed(0)}s`).join(", ")}`)
  if (status.slots) lines.push(`Server slots: ${status.slots.busy} busy / ${status.slots.total}`)
  return lines.join(EOL)
}

export function formatModels(models: Models): string {
  return (
    "Available models for Kaggle GPU (ktether):" +
    EOL +
    EOL +
    models
      .map((model) => {
        const tags = [model.default ? "default" : undefined, model.toolCalling === "unreliable" ? "no reliable tool calling" : undefined]
          .filter(Boolean)
          .join(", ")
        return (
          `- ${model.id.padEnd(20)} ${model.name}${tags ? ` (${tags})` : ""}` +
          EOL +
          `  Size: ${model.sizeGB} GB | Min VRAM: ${model.minVramGB} GB | Context: ${model.context} x ${model.parallel} slots` +
          EOL +
          `  ${model.description}` +
          EOL
        )
      })
      .join(EOL)
  )
}

export function formatChecks(checks: Checks): string {
  return checks
    .map((check) => `${check.ok ? "[OK]  " : "[FAIL]"} ${check.name.padEnd(20)} ${check.detail}`)
    .join(EOL)
}
