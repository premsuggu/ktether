import { Effect } from "effect"
import { EOL } from "node:os"
import type { KTetherClient } from "./connection"

/**
 * Prints the latest operation's progress as it arrives and returns once it has finished.
 *
 * The server runs start, stop, clean and reconnect in the background (starting a GPU takes minutes), so the CLI
 * polls the status for new log lines. A failed operation sets a non-zero exit code.
 */
export const follow = Effect.fn("cli.ktether.follow")(function* (client: KTetherClient, intervalMillis = 2000) {
  let printed = 0
  while (true) {
    const status = yield* Effect.promise(() => client.ktether.status())
    const operation = status.operation
    if (operation) {
      for (const line of operation.log.slice(printed)) process.stdout.write(line + EOL)
      printed = operation.log.length
      if (operation.finishedAt != null) {
        if (operation.error != null) process.exitCode = 1
        return operation
      }
    }
    yield* Effect.sleep(intervalMillis)
  }
})

/**
 * Begins an operation. Returns whether there is progress to follow: true when it started or one is already running,
 * false after printing why it could not start.
 */
export const begin = Effect.fn("cli.ktether.begin")(function* (start: () => Promise<unknown>) {
  const failure = yield* Effect.tryPromise({ try: start, catch: (error) => error }).pipe(
    Effect.as(undefined),
    Effect.catch((error) => Effect.succeed(error)),
  )
  if (failure === undefined) return true
  const message = failure instanceof Error ? failure.message : String((failure as { message?: unknown }).message ?? failure)
  if (message.includes("already running")) {
    process.stdout.write(`${message}. Following its progress...${EOL}`)
    return true
  }
  process.stderr.write(`Error: ${message}${EOL}`)
  process.exitCode = 1
  return false
})
