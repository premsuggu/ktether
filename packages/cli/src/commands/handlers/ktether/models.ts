import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { connect } from "./connection"
import { formatModels } from "./format"

export default Runtime.handler(
  Commands.commands.ktether.commands.models,
  Effect.fn("cli.ktether.models")(function* (input) {
    const client = yield* connect(input)
    const models = yield* Effect.promise(() => client.ktether.models())
    process.stdout.write(formatModels(models) + EOL)
  }),
)
