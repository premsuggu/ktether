import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import {
  readState,
  saveState,
  getKaggleCredentials,
  prepareStagingBundle,
  pushKaggleKernel,
  getKernelStatus,
  pollSignaling,
  syncOpenCodeConfig,
  AVAILABLE_MODELS,
} from "./service.js"

export default Runtime.handler(
  Commands.commands.ktether.commands.start,
  Effect.fn("cli.ktether.start")(function* (input) {
    const model = input.model ?? "qwen2.5-coder-14b"
    const timeout = input.timeout ?? 45

    if (!AVAILABLE_MODELS[model]) {
      process.stderr.write(
        `Error: Invalid model '${model}'. Run 'opencode ktether models' for available options.` + EOL,
      )
      return
    }

    const state = readState()
    if (state.url && state.status !== "pending") {
      try {
        const resp = yield* Effect.promise(() =>
          fetch(`${state.url!.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) }),
        )
        if (resp.ok) {
          process.stdout.write(`[OK] ktether is already active and healthy at: ${state.url}` + EOL)
          process.stdout.write(`Active Model: ${state.model ?? model}` + EOL)
          return
        }
      } catch {
        // Continue to fresh start if previous URL is unreachable
      }
    }

    const creds = getKaggleCredentials()
    process.stdout.write(`User: ${creds.username}` + EOL)
    process.stdout.write(`Model: ${AVAILABLE_MODELS[model].displayName} (${AVAILABLE_MODELS[model].sizeGB} GB)` + EOL)
    process.stdout.write(`Hardware: Kaggle Dual Nvidia T4 (32 GB total VRAM)` + EOL)
    process.stdout.write(`Idle Timeout: ${timeout} minutes` + EOL + EOL)

    let channelId: string
    const pending = state.status === "pending" && state.channelId && state.model === model
    const pendingKernel = pending ? getKernelStatus(creds.username) : undefined
    if (pending && (pendingKernel === "QUEUED" || pendingKernel === "RUNNING")) {
      channelId = state.channelId!
      process.stdout.write(`-> Resuming previous launch (Kaggle kernel is ${pendingKernel})...` + EOL)
    } else {
      process.stdout.write("-> Packaging kernel & pushing to Kaggle GPU..." + EOL)
      const bundle = prepareStagingBundle(creds.username, model, timeout)
      channelId = bundle.channelId
      const pushOutput = pushKaggleKernel(bundle.stagingDir)
      process.stdout.write(`   ${pushOutput}` + EOL)
      // Persist right away so an interrupted or timed-out start can be resumed.
      saveState({ model, channelId, apiKey: bundle.apiKey, status: "pending", active: false })
      process.stdout.write("[OK] Kernel successfully queued on Kaggle GPU!" + EOL)
    }
    process.stdout.write("-> Waiting for Kaggle to assign a GPU and start the inference server..." + EOL)

    const onProgress = (event: string, data: Record<string, unknown>) => {
      if (event === "starting") {
        process.stdout.write(`   Container online. Hardware: ${data.gpu || "GPU"}` + EOL)
      } else if (event === "downloading_model") {
        process.stdout.write(`   Downloading ${data.model} into Kaggle RAM disk...` + EOL)
      } else if (event === "ready") {
        process.stdout.write("   llama-server initialized and Cloudflare tunnel online!" + EOL)
      }
    }
    const onStatus = (status: string) => {
      process.stdout.write(`   Kaggle kernel status: ${status}` + EOL)
    }

    const readyData = yield* Effect.promise(() =>
      pollSignaling(channelId, { onProgress, onStatus, username: creds.username }),
    )

    saveState({
      url: readyData.tunnel_url,
      apiKey: readyData.api_key,
      model,
      channelId,
      sessionStart: Date.now(),
      active: true,
      status: "ready",
    })

    syncOpenCodeConfig(model)

    process.stdout.write(EOL + "=== ktether is Ready! ===" + EOL)
    process.stdout.write(`Public Tunnel: ${readyData.tunnel_url}` + EOL)
    process.stdout.write(`Provider ID:   ktether` + EOL)
    process.stdout.write(`Model:         ktether/${model}` + EOL)
    process.stdout.write(EOL + "You can now run:" + EOL)
    process.stdout.write(`  opencode --model ktether/${model}` + EOL + EOL)
  }),
)
