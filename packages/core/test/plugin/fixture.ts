import { Agent } from "@ktether/core/agent"
import { AISDK } from "@ktether/core/aisdk"
import { Command } from "@ktether/core/command"
import { Config } from "@ktether/core/config"
import { Credential } from "@ktether/core/credential"
import { Database } from "@ktether/core/database/database"
import { FileAccess } from "@ktether/core/file-access"
import { LayerNodePlatform } from "@ktether/util/effect/app-node-platform"
import { AppProcess } from "@ktether/util/process"
import { LayerNode } from "@ktether/util/effect/layer-node"
import { Bus } from "@ktether/core/bus"
import { FileSystem } from "@ktether/core/filesystem"
import { FSUtil } from "@ktether/util/fs-util"
import { Form } from "@ktether/core/form"
import { Generate } from "@ktether/core/generate"
import { Integration } from "@ktether/core/integration"
import { KV } from "@ktether/core/kv"
import { Location } from "@ktether/core/location"
import { ManagedPolicy } from "@ktether/core/managed-policy"
import { Mcp } from "@ktether/core/mcp/index"
import { Model } from "@ktether/core/model"
import { Npm } from "@ktether/util/npm"
import { Plugin } from "@ktether/core/plugin"
import { PluginHooks } from "@ktether/core/plugin/hooks"
import { Provider } from "@ktether/core/provider"
import { Session } from "@ktether/core/session"
import { PersistentPty } from "@ktether/core/persistent-pty"
import { LocationServiceMap } from "@ktether/core/location-service-map"
import { AppNodeBuilder } from "@ktether/core/effect/app-node-builder"
import { Permission } from "@ktether/core/permission"
import { Reference } from "@ktether/core/reference"
import { Rpc } from "@ktether/core/rpc"
import { Skill } from "@ktether/core/skill"
import { SkillDiscovery } from "@ktether/core/skill/discovery"
import { Watcher } from "@ktether/core/filesystem/watcher"
import { Tool } from "@ktether/core/tool"
import { Vcs } from "@ktether/core/vcs"
import { WebSearch } from "@ktether/core/websearch"
import { Worktree } from "@ktether/core/worktree"
import { WorktreeStrategies } from "@ktether/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(Generate.Service, Generate.Service.of({ text: () => Effect.succeed("") }))

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayer = (permission = permissionLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Database.node,
      FileAccess.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      Integration.node,
      KV.node,
      ManagedPolicy.node,
      Mcp.node,
      Session.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generateLayer),
      Permission.node.replace(permission),
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
