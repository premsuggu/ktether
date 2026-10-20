import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { formatChecks } from "./format"

export default Runtime.handler(
  Commands.commands.gpu.commands.doctor,
  Effect.fn("cli.ktether.doctor")(function* (input) {
    const client = yield* connect(input)
    const checks = yield* Effect.promise(() => client.ktether.doctor())
    process.stdout.write(formatChecks(checks) + EOL)
    if (checks.some((check) => !check.ok)) process.exitCode = 1
  }),
)
