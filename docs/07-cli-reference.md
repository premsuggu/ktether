# 7. Command-line reference

Everything here was taken from the program's own `--help` output. Run `ktether <command> --help` for the live
version. In a source checkout, replace `ktether` with `bun run dev` (for example `bun run dev gpu status`).

The command tree is defined in one file, `packages/cli/src/commands/commands.ts`, and each command's behaviour lives
in `packages/cli/src/commands/handlers/`.

## 7.1 Options that work almost everywhere

| Option | Meaning |
| --- | --- |
| `--standalone` | Run with a **private server** that lives only for this command, instead of the background service |
| `--server <url>` | Connect to a server at this URL instead of the background service |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show the version |
| `--log-level <level>` | `all`, `trace`, `debug`, `info`, `warn`, `warning`, `error`, `fatal`, `none` |
| `--print-logs` | Print logs to stderr (server logs also need `--standalone`) |
| `--completions <shell>` | Print a shell completion script: `bash`, `zsh`, `fish` or `sh` |
| `--wizard` | Interactive wizard mode for a command |

> **Background service vs `--standalone`.** Most commands talk to a ktether server over HTTP. By default they use a
> long-lived **background service** that is started on demand (`ktether service ...` manages it). `--standalone`
> starts a throwaway server for just that command. Both work; standalone is slower to start but leaves nothing
> running.

## 7.2 The Kaggle GPU group: `ktether gpu`

| Command | What it does |
| --- | --- |
| `gpu doctor` | Checks the Kaggle CLI, your credentials, and network access to the relay, Hugging Face and Cloudflare. Exits non-zero if anything fails. |
| `gpu models` | Lists the curated models with size, context, slots, the default, and a "no reliable tool calling" tag where it applies. |
| `gpu start` | Provisions the GPU and follows progress until it is ready or fails. |
| `gpu status` | Prints the session state, health, uptime, boot stages, slot usage and the local weekly GPU-hour estimate. |
| `gpu reconnect` | Re-attaches to a session whose tunnel the kernel replaced. |
| `gpu stop` | Stops the session. |
| `gpu clean` | Stops the session and deletes the `ktether-runner` notebook from Kaggle. |

### `ktether gpu start`

| Option | Default | Meaning |
| --- | --- | --- |
| `--model`, `-m <id>` | `qwen3.6-27b` | Which curated model to serve (see `gpu models`) |
| `--timeout`, `-t <minutes>` | `45` | Minutes of **idle** time before the notebook stops itself |
| `--standalone`, `--server` | | As above |

Behaviour: if a healthy session exists it says so and does nothing; if a launch is already queued for the same model
it **resumes** it; otherwise it pushes a new notebook. It prints progress lines (queue status, container online,
download, boot breakdown) and ends with the tunnel address and model name. The command keeps running until the
operation finishes; Ctrl+C stops watching but **not** the launch. A failed start sets a non-zero exit status.

```bash
ktether gpu start
ktether gpu start --model qwen2.5-coder-14b --timeout 20
```

### `ktether gpu stop`

| Option | Meaning |
| --- | --- |
| `--delete` | After stopping, wait up to 90 seconds for the notebook to end, then delete it from your Kaggle account |

If the notebook is still `QUEUED`, Kaggle offers no way to cancel it from the command line; `stop` warns you and
suggests `gpu clean --yes`.

### `ktether gpu clean`

| Option | Meaning |
| --- | --- |
| `--yes`, `-y` | Actually delete. Without it, the command only **previews** what it would delete. |

It only ever touches the notebook `<your-username>/ktether-runner`.

### `ktether gpu status`, `reconnect`, `doctor`, `models`

These take only `--standalone` and `--server`. If another GPU operation is already running when you start one, the
CLI tells you ("... is already running") and follows the one in progress instead of failing.

## 7.3 Running the agent

| Command | What it does |
| --- | --- |
| `ktether [directory]` | Open the terminal UI in `directory` (default: the current directory). Options: `--continue`/`-c`, `--session`/`-s <id>`, `--prompt <text>`, `--auto`. |
| `ktether run [message...]` | Send one message and print the result (non-interactive). |
| `ktether mini` | A minimal interactive interface (no full-screen UI). |

### `ktether run`

| Option | Meaning |
| --- | --- |
| `--model`, `-m <provider/model#variant>` | Model to use, for example `kaggle/qwen3.6-27b` |
| `--agent <name>` | Which agent to use |
| `--continue`, `-c` / `--session`, `-s <id>` / `--fork` | Continue or fork an existing session |
| `--file`, `-f <path>` | Attach a file to the message |
| `--title <text>` | Name the session |
| `--format default\|json` | Output format |
| `--thinking` | Show the model's thinking blocks |
| `--auto` | Auto-approve permission requests that are not explicitly denied |

`--auto` lets the agent run commands and edit files without asking. Use it only in folders where that is safe.

### `ktether mini`

Options: `--continue`/`-c`, `--session`/`-s`, `--fork`, `--replay` (restore history; `--no-replay` to disable),
`--replay-limit <n>` (default 200), `--model`/`-m`, `--agent`, `--prompt`.

## 7.4 Models, sessions and statistics

| Command | What it does |
| --- | --- |
| `ktether models` | Lists every available model as `provider/model` across all configured providers. (Distinct from `gpu models`, which lists the curated Kaggle models.) |
| `ktether session list` | Top-level sessions in the current project, newest first |
| `ktether session delete <id>` | Delete a session and its child sessions |
| `ktether session export` / `import` | Export a session as JSON; import from a file or URL |
| `ktether stats` | Usage statistics. Options: `--days <n>` (0 = today), `--year <n>`, `--all`, `--project <id\|.>`, `--models`, `--tools`, `--cost`, `--full`, `--limit <n>`, `--json` |

## 7.5 Configuration, integrations and extensions

| Command | What it does |
| --- | --- |
| `ktether auth list \| login \| logout \| export \| import \| switch` | Manage credentials for integrations (for example API keys for web search or voice) |
| `ktether mcp list \| add \| auth \| logout` | Manage MCP (Model Context Protocol) tool servers |
| `ktether plugin list \| add \| check \| update \| remove` | Manage plugins |
| `ktether reload` | Reload configuration in the running server |
| `ktether debug agents \| config \| paths` | List agents, list configuration sources, show the data, config, cache and state directories |

## 7.6 Server and service

| Command | What it does |
| --- | --- |
| `ktether service start \| restart \| status \| stop` | Manage the background server. `status` prints its address, or `stopped`. |
| `ktether service get \| set \| unset` | Read and change service configuration |
| `ktether serve` | Run the API and web server in the foreground. Options: `--hostname`, `--port`, `--cors <origin>` (repeatable), `--service`, `--stdio`. |
| `ktether api <operation \| METHOD /path>` | Make a request to the running server. Options: `--data`/`-d`, `--header`/`-H name:value`, `--param key=value`. Handy for the routes in [08-api-reference.md](08-api-reference.md). |
| `ktether pair` | Print one-time links to connect a browser or app to the server. `--remote` goes through a third-party tunnel service (OpenTunnel) and **exposes the server to the internet**, so it asks for confirmation (`--yes`). It is unrelated to the Kaggle tunnel. |
| `ktether acp` | Start an Agent Client Protocol server (for editors that speak ACP). `--login` runs `auth login` instead. |

## 7.7 Maintenance

| Command | What it does |
| --- | --- |
| `ktether upgrade [target]` | Not available yet: ktether has no release channel, so this reports that nothing is configured. (`--method` chooses an installation method such as `npm`, `brew`, `curl`.) The update server address is read from `KTETHER_UPDATE_URL` if one is ever set. |
| `ktether uninstall` | Remove the installed program but keep sessions, configuration and state. `--dry-run` previews; `--force`/`-f` skips prompts. |

## 7.8 Exit codes and scripting

- `0` success; non-zero on failure. `gpu doctor` exits non-zero if any check fails, and `gpu start`, `stop`, `clean`
  and `reconnect` exit non-zero when the operation they followed ended in an error.
- Progress goes to standard output, errors to standard error.
- The operations are also available over HTTP, so scripts can use `ktether api` or any HTTP client against
  `/api/ktether/...` ([08-api-reference.md](08-api-reference.md)).

## 7.9 Terminal UI commands

Type a `/` in the prompt to see the full list. The ktether additions are:

| Slash command | Effect |
| --- | --- |
| `/ktether` | Open the Kaggle GPU dialog |
| `/ktether-start` | Start the GPU |
| `/ktether-stop` | Stop the GPU |

See [09-tui.md](09-tui.md).
