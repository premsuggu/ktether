import { prepareStagingBundle, removeStagingBundle } from "./bundle"
import {
  cliVersion,
  deleteKernel,
  getCredentials,
  getKernelStatus,
  kernelRef,
  pushKernel,
  waitForKernelIdle,
} from "./kaggle"
import { syncOpenCodeConfig } from "./opencode-config"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "./registry"
import { latestReady, pollSignaling, sendStopSignal, SessionFailure, type PollOptions, type ReadySignal } from "./session"
import { createStopMessage } from "./signaling"
import { markStopped, readState, recordUsage, saveState, usageHoursLastWeek, type KTetherState } from "./state"

/** Kaggle's weekly free GPU allowance. */
export const WEEKLY_QUOTA_HOURS = 30

export interface Deps {
  readonly out?: (line: string) => void
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  readonly poll?: Pick<PollOptions, "pollIntervalMs" | "statusIntervalMs" | "queueTimeoutSeconds" | "bootTimeoutSeconds">
}

const defaults = (deps: Deps) => ({
  out: deps.out ?? ((line: string) => process.stdout.write(`${line}\n`)),
  doFetch: deps.fetch ?? fetch,
  sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  now: deps.now ?? Date.now,
})

const baseUrl = (url: string): string => url.replace(/\/+$/, "")

export interface Health {
  readonly ok: boolean
  readonly latencyMs?: number
  readonly detail: string
}

export async function checkHealth(url: string, doFetch: typeof fetch = fetch, timeoutMs = 4000): Promise<Health> {
  const began = Date.now()
  try {
    const resp = await doFetch(`${baseUrl(url)}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: resp.ok, latencyMs: Date.now() - began, detail: resp.ok ? "healthy" : `HTTP ${resp.status}` }
  } catch {
    return { ok: false, detail: "unreachable" }
  }
}

function formatTimings(timings: Readonly<Record<string, number>>): string | undefined {
  const entries = Object.entries(timings)
  if (entries.length === 0) return undefined
  let previous = 0
  return entries
    .map(([stage, at]) => {
      const took = Math.max(0, at - previous)
      previous = at
      return `${stage} ${took.toFixed(0)}s`
    })
    .join(", ")
}

const sessionEnd = (state: KTetherState, now: number): void => {
  if (state.sessionStart) recordUsage({ start: state.sessionStart, end: now }, now)
}

async function stopKernel(state: KTetherState, doFetch: typeof fetch, now: number): Promise<boolean> {
  if (!state.channelId || !state.signingKey) return false
  return sendStopSignal(state.channelId, createStopMessage(state.signingKey, now), doFetch)
}

/**
 * Re-attaches to a session whose tunnel was replaced: the kernel restarts a dropped tunnel and publishes a new
 * signed "ready", which carries the new URL.
 */
export async function reconnectSession(deps: Deps = {}): Promise<ReadySignal | undefined> {
  const { out, doFetch, now } = defaults(deps)
  const state = readState()
  if (!state.channelId || !state.signingKey) {
    out("No ktether session to reconnect to. Run `ktether start`.")
    return undefined
  }
  const ready = await latestReady(state.channelId, state.signingKey, doFetch)
  if (!ready) {
    out("The kernel has not published an endpoint yet.")
    return undefined
  }
  const health = await checkHealth(ready.tunnel_url, doFetch)
  if (!health.ok) {
    out(`Latest endpoint ${ready.tunnel_url} is ${health.detail}.`)
    return undefined
  }
  saveState({
    ...state,
    url: ready.tunnel_url,
    status: "ready",
    active: true,
    sessionStart: state.sessionStart ?? now(),
    timings: ready.timings,
  })
  out(`[OK] Reconnected to ${ready.tunnel_url}`)
  return ready
}

export interface StartInput {
  readonly model: string
  readonly timeoutMinutes: number
}

export async function startSession(input: StartInput, deps: Deps = {}): Promise<ReadySignal | undefined> {
  const { out, doFetch, sleep, now } = defaults(deps)
  const model = input.model || DEFAULT_MODEL
  const spec = AVAILABLE_MODELS[model]
  if (!spec) throw new Error(`Invalid model '${model}'. Run 'opencode ktether models' for available options.`)

  const state = readState()
  if (state.url && state.status === "ready") {
    const health = await checkHealth(state.url, doFetch)
    if (health.ok) {
      out(`[OK] ktether is already active and healthy at: ${state.url}`)
      out(`Active Model: ${state.model ?? model}`)
      return undefined
    }
    // The tunnel may simply have been replaced by the kernel.
    const reattached = await reconnectSession(deps)
    if (reattached) return reattached
  }

  const creds = getCredentials()
  out(`User: ${creds.username}`)
  out(`Model: ${spec.displayName} (${spec.sizeGB} GB)`)
  out("Hardware: Kaggle Dual Nvidia T4 (32 GB total VRAM)")
  out(`Idle Timeout: ${input.timeoutMinutes} minutes`)
  if (spec.toolCalling === "unreliable") {
    out("[WARN] This model does not call tools reliably, so OpenCode's agent features will not work well with it.")
  }
  out("")

  const kernelNow = getKernelStatus(creds.username)
  const resumable =
    state.status === "pending" && state.channelId && state.signingKey && state.apiKey && state.model === model
  let channelId: string
  let signingKey: string
  let apiKey: string

  if (resumable && (kernelNow === "QUEUED" || kernelNow === "RUNNING")) {
    channelId = state.channelId!
    signingKey = state.signingKey!
    apiKey = state.apiKey!
    out(`-> Resuming previous launch (Kaggle kernel is ${kernelNow})...`)
  } else {
    if (kernelNow === "RUNNING") {
      // Pushing over a live kernel would race with it, so end the old session first.
      out("-> A previous ktether kernel is still running. Stopping it first...")
      await stopKernel(state, doFetch, now())
      await waitForKernelIdle(creds.username, 90, sleep, now)
    }
    out("-> Packaging kernel & pushing to Kaggle GPU...")
    const bundle = prepareStagingBundle(creds.username, model, input.timeoutMinutes)
    try {
      out(`   ${pushKernel(bundle.stagingDir)}`)
    } finally {
      removeStagingBundle(bundle.stagingDir)
    }
    channelId = bundle.channelId
    signingKey = bundle.signingKey
    apiKey = bundle.apiKey
    // Persist right away so an interrupted or timed-out start can be resumed.
    saveState({ model, channelId, apiKey, signingKey, status: "pending", active: false })
    out("[OK] Kernel successfully queued on Kaggle GPU!")
  }
  out("-> Waiting for Kaggle to assign a GPU and start the inference server...")

  let ready: ReadySignal
  try {
    ready = await pollSignaling(channelId, signingKey, {
      username: creds.username,
      ...deps.poll,
      fetch: doFetch,
      sleep,
      now,
      onStatus: (status) => out(`   Kaggle kernel status: ${status}`),
      onProgress: (event, data) => {
        if (event === "starting") out(`   Container online. Hardware: ${data.gpu || "GPU"}`)
        else if (event === "downloading_model") out(`   Downloading ${data.model} into Kaggle RAM disk...`)
      },
    })
  } catch (e) {
    // A kernel that ended cannot be resumed, so do not leave a "pending" record behind.
    if (e instanceof SessionFailure) saveState(markStopped(readState()))
    throw e
  }

  saveState({
    url: ready.tunnel_url,
    apiKey,
    signingKey,
    model,
    channelId,
    sessionStart: now(),
    active: true,
    status: "ready",
    timings: ready.timings,
  })
  syncOpenCodeConfig(model)

  out("   llama-server initialized and Cloudflare tunnel online!")
  const breakdown = formatTimings(ready.timings)
  if (breakdown) out(`   Boot breakdown: ${breakdown}`)
  out("")
  out("=== ktether is Ready! ===")
  out(`Public Tunnel: ${ready.tunnel_url}`)
  out("Provider ID:   ktether")
  out(`Model:         ktether/${model}`)
  out("")
  out("You can now run:")
  out(`  opencode --model ktether/${model}`)
  return ready
}

export async function stopSession(input: { delete: boolean }, deps: Deps = {}): Promise<void> {
  const { out, doFetch, sleep, now } = defaults(deps)
  const state = readState()
  out("Sending STOP signal to Kaggle GPU backend...")

  if (await stopKernel(state, doFetch, now())) out("[OK] Remote STOP signal delivered.")
  else if (state.channelId) out("[WARN] Remote stop signal could not be delivered (kernel may already be stopped).")

  const creds = (() => {
    try {
      return getCredentials()
    } catch {
      return undefined
    }
  })()
  if (creds && getKernelStatus(creds.username) === "QUEUED") {
    out("[WARN] The kernel is still queued on Kaggle and cannot be cancelled from here.")
    out("       Run `ktether clean --yes` to delete the notebook, which also removes it from the queue.")
  }

  sessionEnd(state, now())
  saveState(markStopped(state))
  out("[OK] Session closed. Your Kaggle GPU quota is preserved.")

  if (input.delete) {
    const c = getCredentials()
    out("-> Waiting for the kernel to shut down...")
    await waitForKernelIdle(c.username, 90, sleep, now)
    const result = deleteKernel(c.username)
    out(
      result.deleted
        ? `[OK] Deleted Kaggle notebook ${kernelRef(c.username)}.`
        : `[WARN] Could not delete ${kernelRef(c.username)}: ${result.message}`,
    )
  }
}

export async function cleanSession(input: { yes: boolean }, deps: Deps = {}): Promise<boolean> {
  const { out, doFetch, sleep, now } = defaults(deps)
  const creds = getCredentials()
  const ref = kernelRef(creds.username)
  const status = getKernelStatus(creds.username)

  if (!status) {
    out(`Nothing to clean: no Kaggle notebook ${ref} found.`)
    return false
  }
  out(`Kaggle notebook: ${ref} (status: ${status})`)
  out("Only this notebook will be deleted. Your other Kaggle notebooks are never touched.")
  if (!input.yes) {
    out("")
    out("Re-run with --yes to stop any running session and delete it.")
    return false
  }

  const state = readState()
  await stopKernel(state, doFetch, now())
  if (status === "RUNNING") {
    out("-> Waiting for the kernel to shut down...")
    await waitForKernelIdle(creds.username, 90, sleep, now)
  }
  const result = deleteKernel(creds.username)
  if (!result.deleted) throw new Error(`could not delete ${ref}: ${result.message}`)
  sessionEnd(state, now())
  saveState(markStopped(state))
  out(`[OK] Deleted Kaggle notebook ${ref} and cleared local session state.`)
  return true
}

export async function sessionStatus(deps: Deps = {}): Promise<void> {
  const { out, doFetch, now } = defaults(deps)
  let state = readState()
  out("=== ktether Session Status ===")

  let username: string | undefined
  try {
    username = getCredentials().username
  } catch {
    // Credentials are optional for a status check.
  }
  const kernel = username ? getKernelStatus(username) : undefined
  if (username) out(`Kaggle Kernel: ${kernel ?? "not deployed yet"}`)

  // The kernel can end on its own (idle timeout, session limit, Kaggle). Reconcile so state does not lie.
  if (state.active && kernel && ["COMPLETE", "ERROR", "CANCEL_ACKNOWLEDGED", "CANCEL_REQUESTED"].includes(kernel)) {
    out(`The kernel ended (${kernel}). Closing the stale session.`)
    sessionEnd(state, now())
    state = markStopped(state)
    saveState(state)
  }

  const hours = usageHoursLastWeek(now())
  out(`GPU time used by ktether, last 7 days: ~${hours.toFixed(1)}h of ${WEEKLY_QUOTA_HOURS}h (local estimate)`)

  if (!state.url) {
    out(state.status === "pending" ? "Status: LAUNCH PENDING (run `ktether start` to resume waiting)" : "Status: STOPPED / NO ACTIVE TUNNEL")
    return
  }

  out(`Tunnel URL: ${state.url}`)
  out(`Active Model: ${state.model ?? DEFAULT_MODEL}`)
  const health = await checkHealth(state.url, doFetch)
  if (!health.ok) {
    out(`Health Check: ${health.detail.toUpperCase()}`)
    out("Try `ktether reconnect` in case the tunnel was replaced.")
    return
  }
  out(`Health Check: HEALTHY (${health.latencyMs}ms)`)
  if (state.sessionStart) out(`Uptime: ${((now() - state.sessionStart) / 60000).toFixed(1)} minutes`)
  const breakdown = state.timings ? formatTimings(state.timings) : undefined
  if (breakdown) out(`Boot breakdown: ${breakdown}`)

  try {
    const resp = await doFetch(`${baseUrl(state.url)}/slots`, {
      headers: state.apiKey ? { Authorization: `Bearer ${state.apiKey}` } : {},
      signal: AbortSignal.timeout(4000),
    })
    if (resp.ok) {
      const slots = (await resp.json()) as { is_processing?: boolean }[]
      out(`Server slots: ${slots.filter((s) => s.is_processing).length} busy / ${slots.length}`)
    }
  } catch {
    // Slot details are a nicety.
  }
}

export interface DoctorCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export async function runDoctor(deps: Deps = {}): Promise<DoctorCheck[]> {
  const { doFetch } = defaults(deps)
  const checks: DoctorCheck[] = []

  try {
    const version = cliVersion()
    checks.push({ name: "Kaggle CLI", ok: version !== undefined, detail: version ? `version ${version}` : "not working" })
  } catch (e) {
    checks.push({ name: "Kaggle CLI", ok: false, detail: e instanceof Error ? e.message : String(e) })
  }

  try {
    const creds = getCredentials()
    const status = getKernelStatus(creds.username)
    checks.push({ name: "Kaggle credentials", ok: true, detail: `user ${creds.username}${status ? `, notebook ${status}` : ""}` })
  } catch (e) {
    checks.push({ name: "Kaggle credentials", ok: false, detail: e instanceof Error ? e.message : String(e) })
  }

  for (const [name, url] of [
    ["Signalling relay", process.env.KTETHER_NTFY_URL ?? "https://ntfy.sh"],
    ["Hugging Face", "https://huggingface.co"],
    ["Cloudflare", "https://www.cloudflare.com"],
  ] as const) {
    try {
      const resp = await doFetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) })
      checks.push({ name, ok: resp.status < 500, detail: `reachable (HTTP ${resp.status})` })
    } catch {
      checks.push({ name, ok: false, detail: "unreachable" })
    }
  }
  return checks
}
