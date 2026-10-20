import type { FileSystem } from "@ktether/core/filesystem"
import { Bus } from "@ktether/core/bus"
import { Image } from "@ktether/core/image"
import { LocationServiceMap } from "@ktether/core/location-service-map"
import type { LocationServices } from "@ktether/core/location-services"
import { Plugin } from "@ktether/core/plugin"
import { PluginHooks } from "@ktether/core/plugin/hooks"
import { Skill } from "@ktether/core/skill"
import type { Location } from "@ktether/schema/location"
import { makeGlobalNode } from "@ktether/util/effect/app-node"
import { LayerNode } from "@ktether/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})
