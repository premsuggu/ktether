/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@ktether/plugin/tui/context"
import { createStore, produce } from "solid-js/store"
import { SidebarOnboarding, type GpuState } from "../../src/feature-plugins/sidebar/footer"

function context(options?: { dismissed?: boolean; dispatched?: string[] }) {
  const color = RGBA.fromInts(200, 200, 200)
  const [onboarding, setOnboarding] = createStore({ dismissed: options?.dismissed ?? false })
  const location = { directory: "/workspace" }
  return {
    location,
    theme: {
      background: { raised: { high: color } },
      text: { base: color, muted: color },
    },
    storage: {
      store: () => [
        onboarding,
        (mutation: (draft: { dismissed: boolean }) => void) => {
          setOnboarding(produce(mutation))
          return Promise.resolve()
        },
      ],
    },
    keymap: {
      dispatch: (id: string) => options?.dispatched?.push(id),
    },
    ui: {
      format: { path: (value: string) => value },
    },
    data: {
      session: {
        get: () => ({ location }),
      },
      location: {
        vcs: { info: () => undefined },
      },
    },
  } as unknown as Context
}

async function render(input: Context, gpu: GpuState | undefined, height = 22) {
  const app = await testRender(
    () => (
      <box width={38}>
        <SidebarOnboarding context={input} gpu={gpu} />
      </box>
    ),
    { width: 38, height },
  )
  await app.renderOnce()
  return app
}

test("sidebar waits for the GPU status before showing onboarding", async () => {
  const app = await render(context(), undefined)

  try {
    expect(app.captureCharFrame()).not.toContain("Getting started")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar preserves the compact layout when the onboarding card cannot fit", async () => {
  const app = await render(context(), "stopped", 21)

  try {
    expect(app.captureCharFrame()).not.toContain("Getting started")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar offers to start a GPU when none is running", async () => {
  const app = await render(context(), "stopped")

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Getting started")
    expect(frame).toContain("runs open models")
    expect(frame).toContain("free Kaggle GPU")
    expect(frame).toContain("Start GPU")
    expect(frame).toContain("/ktether-start")
    expect(frame).not.toContain("/connect")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar points at the GPU status while one is starting", async () => {
  const app = await render(context(), "pending")

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("is starting")
    expect(frame).toContain("GPU status")
    expect(frame).not.toContain("Start GPU")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar hides onboarding once a GPU is ready or the card is dismissed", async () => {
  const ready = await render(context(), "ready")
  const dismissed = await render(context({ dismissed: true }), "stopped")

  try {
    expect(ready.captureCharFrame()).not.toContain("Getting started")
    expect(dismissed.captureCharFrame()).not.toContain("Getting started")
  } finally {
    ready.renderer.destroy()
    dismissed.renderer.destroy()
  }
})

test("sidebar onboarding starts a GPU and can be dismissed", async () => {
  const dispatched: string[] = []
  const app = await render(context({ dispatched }), "stopped")

  try {
    const action = app.renderer.root.findDescendantById("sidebar.footer.getting-started.action")!
    await app.mockMouse.click(action.x, action.y)
    expect(dispatched).toEqual(["ktether.gpu.start"])

    const dismiss = app.renderer.root.findDescendantById("sidebar.footer.getting-started.dismiss")!
    await app.mockMouse.click(dismiss.x, dismiss.y)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Getting started")
  } finally {
    app.renderer.destroy()
  }
})
