import { Plugin } from "@ktether/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveKTetherDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "ktether.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveKTetherDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
