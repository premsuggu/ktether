import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { begin, follow } from "./follow"

export default Runtime.handler(
  Commands.commands.ktether.commands.reconnect,
  Effect.fn("cli.ktether.reconnect")(function* (input) {
    const client = yield* connect(input)
    const started = yield* begin(() => client.ktether.reconnect())
    if (started) yield* follow(client)
  }),
)
