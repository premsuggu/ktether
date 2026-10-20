import type { KTether } from "./client.js"

export * from "./generated/index.js"
export { KTether } from "./client.js"
export type {
  AgentApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcCallOptions,
  RpcClient,
  RpcEventPayload,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as KTetherEvent } from "./generated/types.js"
export type KTetherClient = ReturnType<typeof KTether.make>
