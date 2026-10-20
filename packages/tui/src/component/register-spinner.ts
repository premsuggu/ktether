import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerKTetherSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
