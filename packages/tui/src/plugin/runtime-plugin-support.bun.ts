import { ensurePluginRuntime, provides } from "@ktether/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@ktether/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@ktether/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
