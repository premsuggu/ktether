import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"

type Status = Awaited<ReturnType<ReturnType<typeof useClient>["api"]["ktether"]["status"]>>

const POLL_MILLIS = 2000
const LOG_LINES = 6

export function DialogKTether() {
  const client = useClient()
  const [status, setStatus] = createSignal<Status>()
  const [error, setError] = createSignal<string>()

  const refresh = () =>
    client.api.ktether.status().then(
      (next) => {
        setStatus(next)
        setError(undefined)
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    )

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MILLIS)
    onCleanup(() => clearInterval(timer))
  })

  return <KTetherStatusView status={status()} error={error()} />
}

/** The dialog body, separate from the polling so it can be rendered from fixed data. */
export function KTetherStatusView(props: { status: Status | undefined; error?: string }) {
  const theme = useTheme().surface("dialog")
  const stateColor = (state: Status["state"]) => {
    if (state === "ready") return theme.text.feedback.success.base
    if (state === "unreachable") return theme.text.feedback.error.base
    if (state === "pending") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  return (
    <DialogLayout header={<DialogHeader title="ktether (Kaggle GPU)" />}>
      <Show when={props.error}>{(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}</Show>
      <Show when={props.status} fallback={<text fg={theme.text.muted}>Loading...</text>}>
        {(status) => (
          <box>
            <text fg={theme.text.base} wrapMode="word">
              <span style={{ fg: stateColor(status().state) }}>●</span> <b>{describe(status().state)}</b>
              <Show when={status().model}>
                {(model) => <span style={{ fg: theme.text.muted }}>{`  ${model()}`}</span>}
              </Show>
            </text>
            <Show when={status().kernel}>
              {(kernel) => <text fg={theme.text.muted}>{`Kaggle notebook: ${kernel()}`}</text>}
            </Show>
            <Show when={status().state === "ready" && status()}>
              {(ready) => (
                <box>
                  <Show when={ready().uptimeMinutes != null}>
                    <text fg={theme.text.base}>{`Uptime: ${duration(ready().uptimeMinutes ?? 0)}`}</text>
                  </Show>
                  <Show when={ready().slots}>
                    {(slots) => <text fg={theme.text.base}>{`Slots: ${slots().busy} busy of ${slots().total}`}</text>}
                  </Show>
                  <Show when={ready().latencyMs != null}>
                    <text fg={theme.text.base}>{`Latency: ${ready().latencyMs}ms`}</text>
                  </Show>
                </box>
              )}
            </Show>
            <Show when={status().state === "unreachable"}>
              <text fg={theme.text.muted} wrapMode="word">
                The tunnel does not answer. Run `ktether reconnect` in case the kernel replaced it.
              </text>
            </Show>
            <text fg={theme.text.muted}>
              {`GPU time used (7 days): ~${status().usage.hoursLastWeek.toFixed(1)}h of ${status().usage.quotaHours}h`}
            </text>
            <Show when={status().operation}>
              {(operation) => (
                <box marginTop={1}>
                  <text fg={theme.text.base}>
                    <b>{operation().kind}</b>{" "}
                    <span
                      style={{
                        fg:
                          operation().error != null
                            ? theme.text.feedback.error.base
                            : operation().finishedAt == null
                              ? theme.text.feedback.warning.base
                              : theme.text.muted,
                      }}
                    >
                      {operation().error != null ? "failed" : operation().finishedAt == null ? "running" : "finished"}
                    </span>
                  </text>
                  <For each={operation().log.slice(-LOG_LINES)}>
                    {(line) => (
                      <text fg={theme.text.muted} wrapMode="word">
                        {line}
                      </text>
                    )}
                  </For>
                </box>
              )}
            </Show>
            <Show when={status().state === "stopped"}>
              <text fg={theme.text.muted} wrapMode="word">
                Type /ktether-start to provision a GPU, or run `ktether start` from a terminal.
              </text>
            </Show>
          </box>
        )}
      </Show>
    </DialogLayout>
  )
}

function describe(state: Status["state"]) {
  if (state === "ready") return "Ready"
  if (state === "pending") return "Starting"
  if (state === "unreachable") return "Unreachable"
  return "Stopped"
}

function duration(minutes: number) {
  const whole = Math.floor(minutes)
  return whole >= 60 ? `${Math.floor(whole / 60)}h ${whole % 60}m` : `${whole}m`
}
