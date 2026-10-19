import { Effect } from "effect"
import { EOL } from "node:os"
import { spawnSync } from "node:child_process"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { readState, getKaggleCredentials } from "./service.js"

export default Runtime.handler(
  Commands.commands.ktether.commands.status,
  Effect.fn("cli.ktether.status")(function* () {
    const state = readState()
    process.stdout.write("=== ktether Session Status ===" + EOL)

    let username: string | undefined
    try {
      const creds = getKaggleCredentials()
      username = creds.username
    } catch {
      // Ignore credentials lookup error if not set
    }

    if (username) {
      const res = spawnSync("kaggle", ["kernels", "status", `${username}/ktether-runner`], {
        encoding: "utf-8",
        shell: true,
      })
      const out = (res.stdout || res.stderr || "").trim()
      const statusText = out.includes("403") || out.includes("404") ? "Not deployed yet" : out || "Unknown"
      process.stdout.write(`Kaggle Kernel: ${statusText}` + EOL)
    }

    if (!state.url) {
      process.stdout.write("Status: STOPPED / NO ACTIVE TUNNEL" + EOL)
      return
    }

    process.stdout.write(`Tunnel URL: ${state.url}` + EOL)
    process.stdout.write(`Active Model: ${state.model ?? "qwen2.5-coder-14b"}` + EOL)

    const healthUrl = `${state.url.replace(/\/+$/, "")}/health`
    const t0 = Date.now()
    try {
      const resp = yield* Effect.promise(() => fetch(healthUrl, { signal: AbortSignal.timeout(4000) }))
      const latency = Date.now() - t0
      if (resp.ok) {
        process.stdout.write(`Health Check: HEALTHY (${latency}ms)` + EOL)
        if (state.sessionStart) {
          const mins = ((Date.now() - state.sessionStart) / 60000).toFixed(1)
          process.stdout.write(`Uptime: ${mins} minutes` + EOL)
        }
      } else {
        process.stdout.write(`Health Check: UNHEALTHY (HTTP ${resp.status})` + EOL)
      }
    } catch {
      process.stdout.write("Health Check: UNREACHABLE / OFFLINE" + EOL)
    }
  }),
)
