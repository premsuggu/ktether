import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { reconnectSession } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.reconnect,
  Effect.fn("cli.ktether.reconnect")(function* () {
    yield* Effect.promise(() => reconnectSession())
  }),
)
