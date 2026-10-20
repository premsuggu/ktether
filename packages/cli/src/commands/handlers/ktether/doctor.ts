import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { runDoctor } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.doctor,
  Effect.fn("cli.ktether.doctor")(function* () {
    const checks = yield* Effect.promise(() => runDoctor())
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "[OK]  " : "[FAIL]"} ${check.name.padEnd(20)} ${check.detail}\n`)
    }
    if (checks.some((check) => !check.ok)) process.exitCode = 1
  }),
)
