/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Logo } from "../../src/component/logo"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function render(width: number, height = 14) {
  const temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Logo />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  // The theme loads asynchronously; give it a few frames to mount the logo.
  for (let frame = 0; frame < 5; frame++) {
    await Bun.sleep(20)
    await app.renderOnce()
  }
  const rows = app
    .captureCharFrame()
    .split("\n")
    .map((row) => row.trimEnd())
    .filter((row) => row !== "")
  app.renderer.destroy()
  await temporary[Symbol.asyncDispose]()
  return rows
}

test("draws the ktether wordmark on one line when there is room", async () => {
  expect(await render(80)).toEqual([
    "▄     ▄         ▄   ▄",
    "█ ▄▀ ▀█▀▀ █▀▀█ ▀█▀▀ █▀▀▄ █▀▀█ █▀▀▀",
    "█▀▄   █   █▀▀▀  █   █  █ █▀▀▀ █",
    "▀  ▀  ▀▀▀ ▀▀▀▀  ▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀",
  ])
})

test("stacks the wordmark when the terminal is narrow", async () => {
  expect(await render(30)).toEqual([
    "█ ▄▀ ▀█▀▀",
    "█▀▄   █",
    "▀  ▀  ▀▀▀",
    "      ▄   ▄",
    "█▀▀█ ▀█▀▀ █▀▀▄ █▀▀█ █▀▀▀",
    "█▀▀▀  █   █  █ █▀▀▀ █",
    "▀▀▀▀  ▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀",
  ])
})

test("falls back to the kt monogram on a very narrow terminal", async () => {
  expect(await render(20)).toEqual(["█ ▄▀ ▀█▀▀", "█▀▄   █", "▀  ▀  ▀▀▀"])
})

test("omits the logo when the terminal is too short", async () => {
  expect(await render(80, 10)).toEqual([])
})
