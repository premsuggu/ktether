import { Plugin } from "@ktether/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { FilePath } from "../../ui/file-path"
import { useWorkingDirectoryActions } from "../../ui/working-directory-actions"
import { usePromptMove } from "../../component/prompt/move"
import { useClient } from "../../context/client"

export type GpuState = "stopped" | "pending" | "ready" | "unreachable"

export function SidebarOnboarding(props: { context: Plugin.Context; gpu: GpuState | undefined }) {
  const dimensions = useTerminalDimensions()
  const [onboarding, updateOnboarding] = props.context.storage.store("getting-started", {
    initial: { dismissed: false },
  })
  // Shown until a GPU is ready; an unknown state (status not loaded yet) stays hidden to avoid a flash.
  const showOnboarding = createMemo(() => {
    if (dimensions().height < 22) return false
    return !onboarding.dismissed && props.gpu !== undefined && props.gpu !== "ready"
  })
  const starting = () => props.gpu === "pending"

  return (
    <Show when={showOnboarding()}>
      <box
        id="sidebar.footer.getting-started"
        backgroundColor={props.context.theme.background.raised.high}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
      >
        <text flexShrink={0} fg={props.context.theme.text.base}>
          ⬖
        </text>
        <box flexGrow={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={props.context.theme.text.base}>
              <b>Getting started</b>
            </text>
            <text
              id="sidebar.footer.getting-started.dismiss"
              fg={props.context.theme.text.muted}
              onMouseUp={() => {
                void updateOnboarding((draft) => {
                  draft.dismissed = true
                }).catch((error) => console.error("Failed to dismiss sidebar onboarding", error))
              }}
            >
              ✕
            </text>
          </box>
          <text fg={props.context.theme.text.muted}>
            {starting()
              ? "Your Kaggle GPU is starting. The first start takes about 5 to 6 minutes."
              : "ktether runs open models on a free Kaggle GPU."}
          </text>
          <Show when={!starting()}>
            <text fg={props.context.theme.text.muted}>Start one, then chat as usual.</text>
          </Show>
          <box
            id="sidebar.footer.getting-started.action"
            flexDirection="row"
            gap={1}
            justifyContent="space-between"
            onMouseUp={() => props.context.keymap.dispatch(starting() ? "ktether.gpu.status" : "ktether.gpu.start")}
          >
            <text fg={props.context.theme.text.base}>{starting() ? "GPU status" : "Start GPU"}</text>
            <text fg={props.context.theme.text.muted}>{starting() ? "/ktether" : "/ktether-start"}</text>
          </box>
        </box>
      </box>
    </Show>
  )
}

const GPU_POLL_MILLIS = 10_000

function SidebarFooter(props: { context: Plugin.Context; sessionID: string }) {
  const client = useClient()
  const [gpu, setGpu] = createSignal<GpuState>()
  onMount(() => {
    const refresh = () =>
      client.api.ktether.status().then(
        (status) => setGpu(status.state),
        () => setGpu(undefined),
      )
    void refresh()
    const timer = setInterval(() => void refresh(), GPU_POLL_MILLIS)
    onCleanup(() => clearInterval(timer))
  })
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const move = usePromptMove({
    projectID: () => session()?.projectID,
    sessionID: () => props.sessionID,
  })
  const actions = useWorkingDirectoryActions({
    directory: () => props.context.location?.directory,
    onMove: () => void move.open(),
  })
  const directory = createMemo(() => {
    if (!props.context.location) return undefined
    const value = props.context.ui.format.path(props.context.location.directory)
    const branch = props.context.data.location.vcs.info(props.context.location)?.branch.current
    return branch ? `${value}:${branch}` : value
  })
  return (
    <box gap={1}>
      <SidebarOnboarding context={props.context} gpu={gpu()} />
      <Show when={directory()}>
        {(value) => (
          <box
            id="sidebar.footer.location"
            onMouseOver={actions.onMouseOver}
            onMouseOut={actions.onMouseOut}
            onMouseUp={actions.onMouseUp}
          >
            <FilePath
              value={value()}
              maxWidth={38}
              fg={actions.hovered() ? props.context.theme.text.base : props.context.theme.text.muted}
            />
          </box>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "ktether.sidebar.footer",
  setup(context) {
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({
      append: "sidebar.footer",
      render: (props) => <SidebarFooter context={context} sessionID={props.sessionID} />,
    })
  },
})
