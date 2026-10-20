import { registerCustomTheme } from "@pierre/diffs"
import { KTetherTheme } from "./marked-theme"

let registered = false

export function registerKTetherTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("ktether", () => Promise.resolve(KTetherTheme))
}
