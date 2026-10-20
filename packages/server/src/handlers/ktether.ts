import {
  controller,
  OperationInProgressError,
  UnknownModelError,
  type Operation,
} from "@opencode/core/ktether/controller"
import { DEFAULT_MODEL } from "@opencode/core/ktether/registry"
import { ConflictError, InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

// These routes drive a process-wide resource (the laptop's Kaggle session), not a project, so they take no location.
const operation = (kind: string, run: () => Operation) =>
  Effect.try({
    try: () => ({ data: run() }),
    catch: (error) => {
      if (error instanceof OperationInProgressError) return new ConflictError({ message: error.message, resource: kind })
      if (error instanceof UnknownModelError) return new InvalidRequestError({ message: error.message, field: "model" })
      throw error
    },
  })

export const KTetherHandler = HttpApiBuilder.group(Api, "server.ktether", (handlers) =>
  Effect.succeed(
    handlers
      .handle(
        "ktether.status",
        Effect.fn("server.ktether.status")(function* () {
          return { data: yield* Effect.promise(() => controller.status()) }
        }),
      )
      .handle(
        "ktether.models",
        Effect.fn("server.ktether.models")(function* () {
          return {
            data: controller.models().map((model) => ({
              id: model.id,
              name: model.displayName,
              default: model.id === DEFAULT_MODEL,
              sizeGB: model.sizeGB,
              context: model.context,
              parallel: model.parallel,
              minVramGB: model.minVramGB,
              toolCalling: model.toolCalling,
              description: model.description,
            })),
          }
        }),
      )
      .handle(
        "ktether.doctor",
        Effect.fn("server.ktether.doctor")(function* () {
          return { data: yield* Effect.promise(() => controller.doctor()) }
        }),
      )
      .handle(
        "ktether.start",
        Effect.fn("server.ktether.start")(function* (request) {
          return yield* operation("start", () => controller.start(request.payload))
        }),
      )
      .handle(
        "ktether.stop",
        Effect.fn("server.ktether.stop")(function* (request) {
          return yield* operation("stop", () => controller.stop(request.payload))
        }),
      )
      .handle(
        "ktether.clean",
        Effect.fn("server.ktether.clean")(function* (request) {
          return yield* operation("clean", () => controller.clean(request.payload))
        }),
      )
      .handle(
        "ktether.reconnect",
        Effect.fn("server.ktether.reconnect")(function* () {
          return yield* operation("reconnect", () => controller.reconnect())
        }),
      ),
  ),
)
