import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { startSession } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.start,
  Effect.fn("cli.ktether.start")(function* (input) {
    yield* Effect.promise(() => startSession({ model: input.model, timeoutMinutes: input.timeout }))
  }),
)
