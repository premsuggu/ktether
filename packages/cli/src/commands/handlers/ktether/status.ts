import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { sessionStatus } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.status,
  Effect.fn("cli.ktether.status")(function* () {
    yield* Effect.promise(() => sessionStatus())
  }),
)
