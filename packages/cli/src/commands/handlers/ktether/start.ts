import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { begin, follow } from "./follow"

export default Runtime.handler(
  Commands.commands.gpu.commands.start,
  Effect.fn("cli.ktether.start")(function* (input) {
    const client = yield* connect(input)
    const started = yield* begin(() =>
      client.ktether.start({ model: input.model, idleTimeoutMinutes: input.timeout }),
    )
    if (started) yield* follow(client)
  }),
)
