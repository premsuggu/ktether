import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { formatStatus } from "./format"

export default Runtime.handler(
  Commands.commands.gpu.commands.status,
  Effect.fn("cli.ktether.status")(function* (input) {
    const client = yield* connect(input)
    const status = yield* Effect.promise(() => client.ktether.status())
    process.stdout.write(formatStatus(status) + EOL)
  }),
)
