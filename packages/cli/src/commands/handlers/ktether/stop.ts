import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { stopSession } from "../../../ktether/lifecycle"

export default Runtime.handler(
  Commands.commands.ktether.commands.stop,
  Effect.fn("cli.ktether.stop")(function* (input) {
    yield* Effect.promise(() => stopSession({ delete: input.delete }))
  }),
)
