export * as AISDKNative from "./aisdk-native.js"

import { Effect, Option, Schema, Struct } from "effect"
import { Provider } from "./provider.js"

type Overlays = {
  settings?: Provider.Settings
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

type Target<ID extends string> = Overlays & {
  package?: string
  variants?: (Overlays & { id: ID })[]
}

type Context = {
  readonly providerID: string
  readonly canonical?: string
  readonly modelID?: string
  readonly shape?: "responses" | "completions"
}

export function rewrite<ID extends string>(
  target: Target<ID>,
  input: Context & { readonly specifier: string | undefined },
) {
  if (input.specifier === undefined) return
  const plain = resolve(input.specifier, input)
  if (!plain) return
  const settings = decode(target.settings ?? {})
  const replacement = resolve(input.specifier, { ...input, settings }) ?? plain
  const translated = options(replacement, input.modelID, settings)
  if (target.package !== undefined || replacement !== input.specifier) target.package = replacement
  // Without `provider`, the native compatible package reports every AI SDK-mapped host as `openai-compatible`.
  const identity =
    replacement === "@opencode/ai/providers/openai-compatible" && !Provider.builtinPackages.has(input.specifier)
      ? { provider: input.canonical ?? input.providerID }
      : {}
  target.settings = target.settings === undefined ? undefined : { ...translated.settings, ...identity }
  target.headers = Provider.mergeHeaders(translated.headers, target.headers)
  target.body = Provider.mergeOverlay(translated.body, target.body)
  target.variants = target.variants?.map((variant) => {
    const overlay = options(replacement, input.modelID, decode(variant.settings ?? {}))
    const headers = Provider.mergeHeaders(overlay.headers, variant.headers)
    const body = Provider.mergeOverlay(overlay.body, variant.body)
    return {
      id: variant.id,
      ...(variant.settings === undefined ? {} : { settings: overlay.settings }),
      ...(headers === undefined ? {} : { headers }),
      ...(body === undefined ? {} : { body }),
    }
  })
}

// AI SDK package names that config files and the models catalog may still use, and the native package that serves
// each. Anything else is not a ktether provider.
const PACKAGES: Readonly<Record<string, string>> = {
  "@ai-sdk/openai": "@opencode/ai/providers/openai",
  "@ai-sdk/openai-compatible": "@opencode/ai/providers/openai-compatible",
  "@ai-sdk/xai": "@opencode/ai/providers/xai",
}

export function native(npm: string, _context: Context & { readonly settings?: Provider.Settings }): string | undefined {
  return PACKAGES[npm]
}

function resolve(specifier: string, context: Context & { readonly settings?: Provider.Settings }): string | undefined {
  const npm = Provider.packageName(specifier)
  if (Provider.isAISDK(specifier) || npm in PACKAGES) return native(npm, context)
  return Provider.builtinPackages.has(npm) ? npm : undefined
}

type Overlay = {
  readonly settings: Provider.Settings
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

function options(_replacement: string, _modelID: string | undefined, settings: Legacy): Overlay {
  return {
    settings: Struct.omit(settings, ["headers", "extraBody", "useCompletionUrls"]),
    ...(settings.headers === undefined ? {} : { headers: settings.headers }),
    ...(settings.extraBody === undefined ? {} : { body: settings.extraBody }),
  }
}

const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined)))))

const Legacy = Schema.StructWithRest(
  Schema.Struct({
    apiKey: lenient(Schema.String),
    baseURL: lenient(Schema.String),
    headers: lenient(Schema.Record(Schema.String, Schema.String)),
    extraBody: lenient(Schema.Record(Schema.String, Schema.Unknown)),
    useCompletionUrls: lenient(Schema.Boolean),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type Legacy = typeof Legacy.Type
const decode = Schema.decodeUnknownSync(Legacy)
