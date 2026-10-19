import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { AVAILABLE_MODELS } from "./service.js"

export default Runtime.handler(
  Commands.commands.ktether.commands.models,
  Effect.fn("cli.ktether.models")(function* () {
    process.stdout.write("Available models for Kaggle GPU (ktether):" + EOL + EOL)
    for (const [key, spec] of Object.entries(AVAILABLE_MODELS)) {
      process.stdout.write(
        `• ${key.padEnd(20)} [${spec.displayName}]` +
          EOL +
          `  Size: ${spec.sizeGB} GB | Min VRAM: ${spec.minVramGB} GB | Context: ${spec.context}` +
          EOL +
          `  ${spec.description}` +
          EOL +
          EOL,
      )
    }
  }),
)
