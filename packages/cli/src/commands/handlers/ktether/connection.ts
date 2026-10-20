import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { ServerConnection } from "../../../services/server-connection"

export type KTetherClient = ReturnType<typeof OpenCode.make>

/** Connects to the background service (or a private server with --standalone), like every API-backed command. */
export const connect = Effect.fn("cli.ktether.connect")(function* (input: {
  readonly server: Option.Option<string>
  readonly standalone: boolean
}) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  return OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
})
