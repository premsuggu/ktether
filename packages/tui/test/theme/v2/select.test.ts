import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@ktether/theme/tui"
import { getKTetherTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getKTetherTheme(), "light")
  const dark = selectTheme(getKTetherTheme(), "dark")
  expect(selectTheme(getKTetherTheme())).toEqual(light)
  expect(light.hue).toEqual(getKTetherTheme().light.hue)
  expect(dark.text).toEqual(getKTetherTheme().base.text)
  expect(dark.hue).toEqual(getKTetherTheme().dark.hue)
  expect(selectThemeMode(getKTetherTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getKTetherTheme().base, light: getKTetherTheme().light } as const
  const darkOnly = { base: getKTetherTheme().base, dark: getKTetherTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getKTetherTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getKTetherTheme(), "dark"), mode: "dark" })
})
