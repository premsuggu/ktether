/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogKTether } from "../../src/component/dialog-ktether"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// The server sends absent optional fields as JSON null, so the fixtures do too.
const base = {
  kernel: null,
  hasCredentials: true,
  closedStaleSession: null,
  model: null,
  url: null,
  latencyMs: null,
  uptimeMinutes: null,
  bootStages: null,
  slots: null,
  operation: null,
  usage: { hoursLastWeek: 3.25, quotaHours: 30 },
}

const ready = {
  ...base,
  state: "ready",
  kernel: "RUNNING",
  model: "qwen3.6-27b",
  url: "https://alpha-beta.trycloudflare.com",
  latencyMs: 912,
  uptimeMinutes: 90,
  slots: { busy: 1, total: 2 },
}

async function render(width: number, respond: () => Response) {
  const temporary = await tmpdir()
  const api = createApi(
    createFetch((url) => (url.pathname === "/api/ktether" ? respond() : undefined), createEventStream()).fetch,
  )

  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogKTether />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <RouteProvider initialRoute={{ type: "home" }}>
            <ClientProvider api={api}>
              <DataProvider directory={temporary.path}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <Keymap.Provider>
                      <ToastProvider>
                        <DialogProvider>
                          <Open />
                        </DialogProvider>
                      </ToastProvider>
                    </Keymap.Provider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </RouteProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return {
    app,
    dispose: async () => {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

for (const width of [44, 100]) {
  test(`shows a ready session with its uptime, slots and usage at ${width} columns`, async () => {
    const view = await render(width, () => json({ data: ready }))
    try {
      await view.app.waitForFrame((frame) => frame.includes("Ready"))
      const frame = view.app.captureCharFrame()
      expect(frame).toContain("ktether (Kaggle GPU)")
      expect(frame).toContain("qwen3.6-27b")
      expect(frame).toContain("Uptime: 1h 30m")
      expect(frame).toContain("Slots: 1 busy of 2")
      expect(frame).toContain("Latency: 912ms")
      expect(frame).toContain("~3.3h of 30h")
      // Credentials and the endpoint stay out of the dialog.
      expect(frame).not.toContain("trycloudflare")
    } finally {
      await view.dispose()
    }
  })

  test(`tells a stopped session how to start at ${width} columns`, async () => {
    const view = await render(width, () => json({ data: { ...base, state: "stopped" } }))
    try {
      await view.app.waitForFrame((frame) => frame.includes("Stopped"))
      expect(view.app.captureCharFrame()).toContain("/ktether-start")
    } finally {
      await view.dispose()
    }
  })
}

test("shows the latest operation with only the most recent log lines", async () => {
  const log = Array.from({ length: 10 }, (_, index) => `step ${index + 1}`)
  const view = await render(100, () =>
    json({
      data: {
        ...base,
        state: "pending",
        operation: { kind: "start", startedAt: 1, finishedAt: null, error: null, log },
      },
    }),
  )
  try {
    await view.app.waitForFrame((frame) => frame.includes("Starting"))
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("start running")
    expect(frame).toContain("step 10")
    expect(frame).toContain("step 5")
    expect(frame).not.toContain("step 4")
  } finally {
    await view.dispose()
  }
})

test("marks a failed operation and offers reconnect for an unreachable tunnel", async () => {
  const view = await render(100, () =>
    json({
      data: {
        ...ready,
        state: "unreachable",
        operation: { kind: "stop", startedAt: 1, finishedAt: 2, error: "boom", log: ["Error: boom"] },
      },
    }),
  )
  try {
    await view.app.waitForFrame((frame) => frame.includes("Unreachable"))
    const frame = view.app.captureCharFrame()
    // The hint wraps inside the dialog, so compare the text with its line breaks collapsed.
    expect(frame.replace(/\s+/g, " ")).toContain("ktether gpu reconnect")
    expect(frame).toContain("stop failed")
    expect(frame).not.toContain("Uptime")
  } finally {
    await view.dispose()
  }
})

test("shows a server error instead of hanging on Loading", async () => {
  const view = await render(100, () => new Response("Unavailable", { status: 503 }))
  try {
    await view.app.waitForFrame((frame) => frame.includes("503"))
    expect(view.app.captureCharFrame()).toContain("503")
  } finally {
    await view.dispose()
  }
})
