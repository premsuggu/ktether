import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { begin, follow } from "./follow"

export default Runtime.handler(
  Commands.commands.gpu.commands.clean,
  Effect.fn("cli.ktether.clean")(function* (input) {
    const client = yield* connect(input)
    const started = yield* begin(() => client.ktether.clean({ confirm: input.yes }))
    if (started) yield* follow(client)
  }),
)
