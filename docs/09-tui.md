# 9. The terminal UI

Running `ktether` with no subcommand opens the terminal UI (TUI): a full-screen interface where you chat with the
agent, see the files it reads and edits, approve actions, and manage sessions. This page covers the parts that matter
for ktether's own feature; the UI's internals are in [12-clients-and-ui.md](12-clients-and-ui.md).

## 9.1 Starting it

```bash
ktether                      # in the current directory
ktether /path/to/project     # in another directory
ktether --continue           # continue the last session
ktether --prompt "explain this repo"
```

In a source checkout use `bun run dev ...` (see [02-getting-started.md](02-getting-started.md)); pass the project
directory explicitly, because the root script changes the working directory.

The UI needs a running ktether server. By default it connects to (and starts) the background service; with
`--standalone` it starts a private server for the session.

## 9.2 Choosing the Kaggle model

Open the model picker and choose **`kaggle/qwen3.6-27b`** (provider "ktether (Kaggle GPU)"). The picker lists the
models from the registry; the Qwen2.5 coder models are marked as not tool-capable. Start the GPU first (`ktether gpu
start`, or `/ktether-start` inside the UI), otherwise requests fail because there is no tunnel to talk to.

## 9.3 The GPU dialog and slash commands

Type `/` in the prompt to open the command palette. ktether adds three entries:

| Slash command | Command id | Effect |
| --- | --- | --- |
| `/ktether` | `ktether.gpu.status` | Opens the GPU dialog |
| `/ktether-start` | `ktether.gpu.start` | Starts the GPU, then opens the dialog |
| `/ktether-stop` | `ktether.gpu.stop` | Stops the GPU, then opens the dialog |

The dialog (`packages/tui/src/component/dialog-ktether.tsx`) refreshes every two seconds and shows:

- the state with a coloured dot (ready, starting, unreachable, stopped) and the model,
- Kaggle's notebook status,
- for a ready session: uptime, busy slots out of total, and health latency,
- a hint if the tunnel is unreachable (`ktether gpu reconnect`) or the GPU is stopped (`/ktether-start`),
- your GPU-hour estimate for the last seven days,
- the **latest operation** (start, stop, clean, reconnect) with whether it is running, finished or failed, and its
  last six log lines.

It never shows the tunnel address or any key. If the server cannot be reached it shows the error instead of staying
on "Loading...".

## 9.4 Permissions

The agent asks before it runs commands or edits files, unless you started with `--auto`. Read those prompts: they are
what limits what a model can do on your machine. See [11-core-concepts.md](11-core-concepts.md) for how permissions
work.

## 9.5 How the dialog is built and tested

The dialog is a small Solid component that calls `client.api.ktether.status()` on a timer. The visual part
(`KTetherStatusView`) is separate from the polling so it can be rendered from fixed data. The tests in
`packages/tui/test/component/dialog-ktether.test.tsx` render it at 44 and 100 columns against a fake server that
answers exactly as the real one does (including `null` for absent optional fields), and cover ready, stopped, a long
operation log, a failed operation with an unreachable tunnel, and a server error. The testing rules for terminal UIs
are in [16-testing.md](16-testing.md).
