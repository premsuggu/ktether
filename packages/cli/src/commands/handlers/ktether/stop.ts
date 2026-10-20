import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { begin, follow } from "./follow"

export default Runtime.handler(
  Commands.commands.ktether.commands.stop,
  Effect.fn("cli.ktether.stop")(function* (input) {
    const client = yield* connect(input)
    const started = yield* begin(() => client.ktether.stop({ delete: input.delete }))
    if (started) yield* follow(client)
  }),
)
