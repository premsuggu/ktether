// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { KTether } from "./client.js"

export * from "./generated/index"
export { KTether } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@ktether/schema/agent"
export { Command } from "@ktether/schema/command"
export { Config } from "@ktether/schema/config"
export { Credential } from "@ktether/schema/credential"
export { Event } from "@ktether/schema/event"
export { EventLog } from "@ktether/schema/event-log"
export { FileSystem } from "@ktether/schema/filesystem"
export { Form } from "@ktether/schema/form"
export { Integration } from "@ktether/schema/integration"
export { Location } from "@ktether/schema/location"
export { Model } from "@ktether/schema/model"
export { Permission } from "@ktether/schema/permission"
export { PermissionSaved } from "@ktether/schema/permission-saved"
export { Project } from "@ktether/schema/project"
export { Worktree } from "@ktether/schema/worktree"
export { Vcs } from "@ktether/schema/vcs"
export { Provider } from "@ktether/schema/provider"
export { Pty } from "@ktether/schema/pty"
export { Question } from "@ktether/schema/question"
export { Reference } from "@ktether/schema/reference"
export { WebSearch } from "@ktether/schema/websearch"
export { AbsolutePath, RelativePath } from "@ktether/schema/schema"
export { Session } from "@ktether/schema/session"
export { SessionInbox } from "@ktether/schema/session-inbox"
export { SessionMessage } from "@ktether/schema/session-message"
export { Skill } from "@ktether/schema/skill"
export { Prompt } from "@ktether/schema/prompt"
export { PromptInput } from "@ktether/schema/prompt-input"
export type { KTetherEvent } from "@ktether/protocol/groups/event"
export type KTetherClient = Effect.Success<ReturnType<typeof KTether.make>>
