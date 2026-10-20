import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@ktether/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@ktether/protocol/client"
import { Agent } from "@ktether/schema/agent"
import { Command } from "@ktether/schema/command"
import { Config } from "@ktether/schema/config"
import { Credential } from "@ktether/schema/credential"
import { Event } from "@ktether/schema/event"
import { EventLog } from "@ktether/schema/event-log"
import { FileDiff } from "@ktether/schema/file-diff"
import { FileSystem } from "@ktether/schema/filesystem"
import { Form } from "@ktether/schema/form"
import { Instruction } from "@ktether/schema/instruction"
import { InstructionEntry } from "@ktether/schema/instruction-entry"
import { Integration } from "@ktether/schema/integration"
import { Location } from "@ktether/schema/location"
import { Mcp } from "@ktether/schema/mcp"
import { Model } from "@ktether/schema/model"
import { Money } from "@ktether/schema/money"
import { Permission } from "@ktether/schema/permission"
import { PermissionSaved } from "@ktether/schema/permission-saved"
import { Plugin } from "@ktether/schema/plugin"
import { Project } from "@ktether/schema/project"
import { Worktree } from "@ktether/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@ktether/schema/prompt"
import { PromptInput } from "@ktether/schema/prompt-input"
import { Provider } from "@ktether/schema/provider"
import { Pty } from "@ktether/schema/pty"
import { PtyTicket } from "@ktether/schema/pty-ticket"
import { Question } from "@ktether/schema/question"
import { Reference } from "@ktether/schema/reference"
import { AbsolutePath, RelativePath } from "@ktether/schema/schema"
import { Session } from "@ktether/schema/session"
import { SessionMessage } from "@ktether/schema/session-message"
import { SessionInbox } from "@ktether/schema/session-inbox"
import { Shell } from "@ktether/schema/shell"
import { Skill } from "@ktether/schema/skill"
import { Snapshot } from "@ktether/schema/snapshot"
import { Vcs } from "@ktether/schema/vcs"
import { WebSearch } from "@ktether/schema/websearch"
import { Workspace } from "@ktether/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@ktether/schema/agent", Agent),
  ...namespaceTypes("Command", "@ktether/schema/command", Command),
  ...namespaceTypes("Config", "@ktether/schema/config", Config),
  ...namespaceTypes("Credential", "@ktether/schema/credential", Credential),
  ...namespaceTypes("Event", "@ktether/schema/event", Event),
  ...namespaceTypes("EventLog", "@ktether/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@ktether/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@ktether/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@ktether/schema/form", Form),
  ...namespaceTypes("Instruction", "@ktether/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@ktether/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@ktether/schema/integration", Integration),
  typeReference("Location.PublicRef", "@ktether/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@ktether/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@ktether/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@ktether/schema/model", Model),
  ...namespaceTypes("Money", "@ktether/schema/money", Money),
  ...namespaceTypes("Permission", "@ktether/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@ktether/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@ktether/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@ktether/schema/project", Project),
  ...namespaceTypes("Worktree", "@ktether/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@ktether/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@ktether/schema/provider", Provider),
  ...namespaceTypes("Pty", "@ktether/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@ktether/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@ktether/schema/question", Question),
  ...namespaceTypes("Reference", "@ktether/schema/reference", Reference),
  ...namespaceTypes("Session", "@ktether/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@ktether/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@ktether/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@ktether/schema/shell", Shell),
  ...namespaceTypes("Skill", "@ktether/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@ktether/schema/snapshot", Snapshot),
  ...namespaceTypes("Vcs", "@ktether/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@ktether/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@ktether/schema/workspace", Workspace),
  typeReference("Prompt", "@ktether/schema/prompt", Prompt),
  typeReference("PromptMention", "@ktether/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@ktether/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@ktether/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@ktether/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@ktether/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "KTetherEvent",
              import: 'import type { KTetherEvent } from "@ktether/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
