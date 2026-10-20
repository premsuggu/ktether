import { Option, Schema } from "effect"

declare const KTETHER_VERSION: string
declare const KTETHER_CHANNEL: string
declare const KTETHER_ARTIFACT: string
declare const KTETHER_RELEASE_HIGHLIGHTS: string

const version = typeof KTETHER_VERSION === "string" ? KTETHER_VERSION : "local"
const channel = typeof KTETHER_CHANNEL === "string" ? KTETHER_CHANNEL : "local"
const artifact = typeof KTETHER_ARTIFACT === "string" ? KTETHER_ARTIFACT : "cli"
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof KTETHER_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(KTETHER_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as KTETHER_VERSION,
  channel as KTETHER_CHANNEL,
  artifact as KTETHER_ARTIFACT,
  highlights as KTETHER_HIGHLIGHTS,
}
export const KTETHER_LOCAL = channel === "local"
