import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { cleanSession } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.clean,
  Effect.fn("cli.ktether.clean")(function* (input) {
    yield* Effect.promise(() => cleanSession({ yes: input.yes }))
  }),
)
