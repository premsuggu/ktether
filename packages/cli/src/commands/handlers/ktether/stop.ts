import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import {
  readState,
  saveState,
  sendStopSignal,
  getKaggleCredentials,
  waitForKernelIdle,
  deleteKaggleKernel,
  kernelRef,
} from "./service.js"

export default Runtime.handler(
  Commands.commands.ktether.commands.stop,
  Effect.fn("cli.ktether.stop")(function* (input) {
    const state = readState()
    process.stdout.write("Sending STOP signal to Kaggle GPU backend..." + EOL)

    if (state.channelId) {
      const delivered = yield* Effect.promise(() => sendStopSignal(state.channelId!))
      if (delivered) {
        process.stdout.write("[OK] Remote STOP signal delivered." + EOL)
      } else {
        process.stdout.write("[WARN] Remote stop signal could not be delivered (kernel may already be stopped)." + EOL)
      }
    }

    saveState({
      ...state,
      active: false,
      status: "stopped",
      url: undefined,
      sessionStart: undefined,
    })

    process.stdout.write("[OK] Session closed. Your Kaggle GPU quota is preserved." + EOL)

    if (input.delete) {
      const creds = getKaggleCredentials()
      process.stdout.write("-> Waiting for the kernel to shut down..." + EOL)
      yield* Effect.promise(() => waitForKernelIdle(creds.username, 90))
      const result = deleteKaggleKernel(creds.username)
      process.stdout.write(
        result.deleted
          ? `[OK] Deleted Kaggle notebook ${kernelRef(creds.username)}.` + EOL
          : `[WARN] Could not delete ${kernelRef(creds.username)}: ${result.message}` + EOL,
      )
    }
  }),
)
