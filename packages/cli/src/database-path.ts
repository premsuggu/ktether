import path from "node:path"
import { KTETHER_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.KTETHER_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(KTETHER_CHANNEL) ||
    process.env.KTETHER_DISABLE_CHANNEL_DB === "1" ||
    process.env.KTETHER_DISABLE_CHANNEL_DB === "true"
      ? "ktether.db"
      : `ktether-${KTETHER_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
