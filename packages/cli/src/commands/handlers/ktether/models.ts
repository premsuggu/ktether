import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "../../../ktether/registry"

export default Runtime.handler(
  Commands.commands.ktether.commands.models,
  Effect.fn("cli.ktether.models")(function* () {
    process.stdout.write("Available models for Kaggle GPU (ktether):\n\n")
    for (const [key, spec] of Object.entries(AVAILABLE_MODELS)) {
      const tags = [
        key === DEFAULT_MODEL ? "default" : undefined,
        spec.toolCalling === "unreliable" ? "no reliable tool calling" : undefined,
      ].filter(Boolean)
      process.stdout.write(
        `- ${key.padEnd(20)} ${spec.displayName}${tags.length ? ` (${tags.join(", ")})` : ""}\n` +
          `  Size: ${spec.sizeGB} GB | Min VRAM: ${spec.minVramGB} GB | Context: ${spec.context} x ${spec.parallel} slots\n` +
          `  ${spec.description}\n\n`,
      )
    }
  }),
)
