import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import {
  readState,
  saveState,
  sendStopSignal,
  getKaggleCredentials,
  getKernelStatus,
  waitForKernelIdle,
  deleteKaggleKernel,
  kernelRef,
} from "./service.js"

export default Runtime.handler(
  Commands.commands.ktether.commands.clean,
  Effect.fn("cli.ktether.clean")(function* (input) {
    const creds = getKaggleCredentials()
    const ref = kernelRef(creds.username)
    const status = getKernelStatus(creds.username)

    if (!status) {
      process.stdout.write(`Nothing to clean: no Kaggle notebook ${ref} found.` + EOL)
      return
    }

    process.stdout.write(`Kaggle notebook: ${ref} (status: ${status})` + EOL)
    process.stdout.write("Only this notebook will be deleted. Your other Kaggle notebooks are never touched." + EOL)
    if (!input.yes) {
      process.stdout.write(EOL + "Re-run with --yes to stop any running session and delete it." + EOL)
      return
    }

    const state = readState()
    if (state.channelId && state.signingKey) {
      yield* Effect.promise(() => sendStopSignal(state.channelId!, state.signingKey!))
    }
    if (status === "RUNNING") {
      process.stdout.write("-> Waiting for the kernel to shut down..." + EOL)
      yield* Effect.promise(() => waitForKernelIdle(creds.username, 90))
    }

    const result = deleteKaggleKernel(creds.username)
    if (!result.deleted) {
      process.stderr.write(`Error: could not delete ${ref}: ${result.message}` + EOL)
      return
    }
    saveState({ model: state.model, status: "stopped", active: false })
    process.stdout.write(`[OK] Deleted Kaggle notebook ${ref} and cleared local session state.` + EOL)
  }),
)
