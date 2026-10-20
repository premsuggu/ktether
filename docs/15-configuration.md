# 15. Configuration

Everything you can configure in ktether: which files it reads and where they live, what goes in them, where it keeps
its data on each operating system, and every environment variable the source code reads. All of it was checked
against the code under `packages/*/src`; anything I could not confirm is marked "I did not verify this".

ktether (lowercase) is a fork of the MIT-licensed OpenCode project. A few names inherited from upstream still appear
in the code; they are called out where they matter. For the Kaggle GPU pipeline itself, see
[04-kaggle-pipeline.md](04-kaggle-pipeline.md). For the developer workflow see
[14-development.md](14-development.md), and for tests see [16-testing.md](16-testing.md).

## 1. The big picture

There are four separate kinds of configuration. Keeping them apart avoids most confusion.

| Kind | What it controls | Where it lives | Written by |
| --- | --- | --- | --- |
| **Server config** (`ktether.json` / `ktether.jsonc`) | Models, providers, agents, permissions, MCP servers, skills, instructions, formatters, LSP, and so on | Several places, merged (section 3) | You, by hand. The app edits only the `shell` key. |
| **Client config** (`cli.json`) | Terminal UI preferences: theme, keybinds, scrolling, tabs, mouse, animations | `<config dir>/cli.json` (section 5) | You, and the TUI itself |
| **Service config** (`service.json`) | How the background server runs: host, port, password, remote access, extra environment variables | `<config dir>/service.json` | `ktether service set ...` |
| **Environment variables** | Startup switches, endpoints, debugging and test hooks | Your shell or the service's environment (section 9) | You |

Plus one file that is not configuration but is easy to mistake for it: the **Kaggle session state**
`ktether.json` in the *state* directory (section 8). It holds a tunnel URL, an API key and a signing key. Never edit or
share it.

A very common point of confusion: there are two files named `ktether.json`. The config one lives in the *config*
directory (or in a project) and is meant for you. The state one lives in the *state* directory and belongs to the
program.

## 2. Directories on Linux, macOS and Windows

ktether computes its global directories in `packages/util/src/global-roots.ts`, and `packages/util/src/global.ts`
turns them into the `Global` service. The rule is the same on every operating system: the XDG base directory
variables if set, otherwise a path under the home directory.

```ts
const data = process.env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : undefined)
const cache = process.env.XDG_CACHE_HOME || (home ? path.join(home, ".cache") : undefined)
const config = process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : undefined)
const state = process.env.XDG_STATE_HOME || (home ? path.join(home, ".local", "state") : undefined)
```

Each then gets a `ktether` subfolder. There is no special handling for macOS (`~/Library/...`) or Windows
(`%APPDATA%`, `%LOCALAPPDATA%`): they use the same dot-folders under the home directory. "Home" is `os.homedir()`
(on Windows that is `%USERPROFILE%`), unless `KTETHER_TEST_HOME` is set, which `Global.Path.home` prefers.

| Purpose | Default (Linux, macOS, Windows) | Override |
| --- | --- | --- |
| **config** | `~/.config/ktether` (Windows: `C:\Users\<you>\.config\ktether`) | `XDG_CONFIG_HOME`; or `KTETHER_CONFIG_DIR` for the config directory only |
| **data** | `~/.local/share/ktether` | `XDG_DATA_HOME` |
| **cache** | `~/.cache/ktether` | `XDG_CACHE_HOME` |
| **state** | `~/.local/state/ktether` | `XDG_STATE_HOME` |
| **tmp** | `<os temp dir>/ktether` (from `os.tmpdir()`) | `TMPDIR` (POSIX) or `TEMP`/`TMP` (Windows) |
| **bin** | `<cache>/bin` | follows cache |
| **log** | `<data>/log` | follows data |
| **repos** | `<data>/repos` (cloned reference repositories) | follows data |
| **database** | `<data>/ktether.db` (see below) | `KTETHER_DB` |
| **system config** (managed) | Linux `/etc/ktether`; macOS `/Library/Application Support/ktether`; Windows `%ProgramData%\ktether` (falls back to `C:\ProgramData\ktether`) | none found in env; the code option `system` is for programmatic use |

`KTETHER_CONFIG_DIR` is applied in `packages/cli/src/index.ts` and `packages/cli/src/server-process.ts` through
`Global.layerWith({ config: ... })`. It only moves the *config* directory. Data, cache and state still follow the XDG
rules.

A workerd (Cloudflare Workers) build of `@ktether/util` resolves directories differently
(`packages/util/src/global-roots.workerd.ts`, one tmp-rooted directory). That is not relevant to the CLI.

### Print them all

The quickest way to see the real values on your machine:

```sh
bun run dev debug paths     # from a source checkout
ktether debug paths         # from an installed ktether
ktether debug paths config  # just one value
```

The handler is `packages/cli/src/commands/handlers/debug/paths.ts`; it prints `home`, `data`, `cache`, `config`,
`state`, `tmp`, `bin`, `log`, `repos` and `db`.

### The database file

`databasePath` in `packages/cli/src/database-path.ts` picks the file name, then puts it in the data directory:

- If `KTETHER_DB` is set, that is the file name (relative names resolve inside the data directory; `:memory:` is kept
  as is, which tests use).
- Otherwise, if the build channel is one of `latest`, `dev`, `beta`, `next` or `prod`, or
  `KTETHER_DISABLE_CHANNEL_DB` is `1` or `true`, the name is `ktether.db`.
- Otherwise the name is `ktether-<channel>.db`. A build run from source has channel `local`, so it uses
  `ktether-local.db`.

So running `bun run dev` from a checkout does not touch the `ktether.db` of an installed release.

### What lives where

| Directory | Contents (verified unless noted) |
| --- | --- |
| config | `ktether.json` / `ktether.jsonc`, `cli.json`, `service.json` (or `service-<channel>.json`), `AGENTS.md` (global instructions), `command(s)/`, `agent(s)/`, `skill(s)/`, `plugin(s)/`, `themes/` (section 4) |
| data | `ktether.db` (or channel variant), `log/ktether-local.log` for a source build (channel `local`) and `log/ktether.log` for every other channel (`file()` in `packages/util/src/observability/logging.ts`), `repos/` |
| state | `session.json` (Kaggle session), `usage.json` (GPU hours used), `service.json` (the running service's registration), `locks/` (file locks used by `cli.json`) |
| cache | `bin/` (downloaded helper binaries), `skills/<hash>/` (downloaded skill indexes) |

Two Kaggle state details (`packages/core/src/ktether/state.ts` and `packages/ai/src/providers/ktether.ts`): both
compute `~/.local/state/ktether` directly from `os.homedir()`. They do **not** honour `XDG_STATE_HOME`, whereas
everything built on the `Global` service does. If you set `XDG_STATE_HOME`, the Kaggle session state therefore stays in
`~/.local/state/ktether` while the service registration and locks move. The files are written with mode `0600`.

## 3. Server config: `ktether.json` and `ktether.jsonc`

### File format

Both names are accepted: `ktether.json` and `ktether.jsonc` (`names` in `packages/core/src/config/discovery.ts`). Both
are parsed as JSONC, so comments and trailing commas are allowed in either one. A file that fails to parse is skipped
with a warning in the log (`rejected malformed JSON or JSONC document`); it does not stop ktether.

### Where ktether looks, lowest to highest priority

`Config.load` in `packages/core/src/config.ts` assembles one ordered list of documents ("lowest to highest priority",
its own comment) in this order:

1. **Managed policies**: only the `policies` key from the system directory and macOS managed preferences. They are
   loaded first on purpose, because policies are evaluated in reverse load order.
2. **Well-known remote config**: organisation-provided configuration fetched from registered sources (the
   `WellKnown` service in `packages/core/src/wellknown.ts`). I did not verify how a source gets registered in a
   ktether install.
3. **Global config directory**: `<config dir>/ktether.json`, then `ktether.jsonc`.
4. **Explicit file**: the path in `KTETHER_CONFIG`.
5. **Direct files**: `ktether.json` / `ktether.jsonc` found in the project directory and its parent directories.
6. **Project `.ktether/` directories**: `ktether.json` / `ktether.jsonc` inside a `.ktether` folder in the project and
   its parents.
7. **Inline content**: the JSON text in `KTETHER_CONFIG_CONTENT`.
8. **Managed settings**: everything else from the system directory (and macOS `ai.ktether.managed` managed
   preferences, which outrank the system directory). These load last, so they override everything.

For two files of the same kind, a later entry wins over an earlier one. Where more than one scalar key is set, the
helper `Config.latest(entries, key)` picks the last document that defines it. How lists and maps (`providers`, `agents`,
`permissions`, and so on) combine across documents is decided by each consumer (for example `providers` is handled in
`packages/core/src/config/plugin/provider.ts`); I did not verify the merge rule for every key, so check the
consumer before relying on a particular overlay behaviour.

Switches that remove sources (from environment variables, section 9):

| Variable | Effect |
| --- | --- |
| `KTETHER_CONFIG_PROJECT_DISABLE` or `KTETHER_DISABLE_PROJECT_CONFIG` | Ignore project config (the upward walk), keeping global config. |
| `KTETHER_DISABLE_CLAUDE_CODE` or `KTETHER_DISABLE_CLAUDE_CODE_SKILLS` | Do not read `~/.claude` and project `.claude` directories (compatibility source for skills). |

ktether also reads `~/.agents` and project `.agents` directories for the same compatibility purpose (`agents` list in
`discover`). The upward walk starts at the project directory; I did not verify where it stops.

### Variable substitution

Inside any config file, two substitutions are applied to the raw text before parsing
(`packages/core/src/config/variable.ts`):

- `{env:NAME}` is replaced with the value of the environment variable `NAME`, or with an empty string if it is unset.
  If the raw value would break the JSON (for example a Windows path with backslashes), it is escaped and retried.
- `{file:path}` is replaced with the trimmed contents of the file. `~/` expands to the home directory; a relative path
  is relative to the config file's own directory. A missing or unreadable file becomes an empty string with a logged
  warning rather than an error. A `{file:...}` on a line that starts with `//` is left alone.

This is the way to keep secrets out of the file:

```jsonc
{
  "providers": {
    "my-server": {
      "headers": { "Authorization": "Bearer {env:MY_SERVER_TOKEN}" }
    }
  }
}
```

### Live reload

ktether watches its config roots and reloads, debounced by 100 ms, when a file changes. `ktether reload` forces it.
Wellknown remote sources are re-fetched every 10 minutes. When the result changes, a `config.updated` event is
published and dependent services rebuild.

### The schema

The authoritative schema is the Effect Schema class `Config.Info` in `packages/schema/src/config.ts`, plus one file
per section in `packages/schema/src/config/`.

**Note:** `packages/core/schema.json` is *not* a config schema. Despite the name, it is the Drizzle database snapshot
(it contains `"dialect": "sqlite"` and the table names `session_inbox`, `credential`, ...). Do not point an editor's
JSON schema at it. There is also no published JSON Schema: the `$schema` URL that appears in `.ktether/ktether.jsonc`
(`https://raw.githubusercontent.com/premsuggu/ktether/main/schema/config.json`) points at a `schema/` folder that does
not exist in this repository. The `$schema` key is accepted and ignored.

Top-level keys of `Config.Info`:

| Key | Type | Meaning (from the schema annotations) |
| --- | --- | --- |
| `$schema` | string | JSON schema reference |
| `shell` | string | Default shell for terminal and shell tool execution (the one key ktether itself edits, via `Config.update`) |
| `model` | `"provider/model"` or `{ providerID, model, variant? }` | Default model when no session or agent model is selected. A short form like `"kaggle/qwen3.6-27b"` or `"provider/model#variant"` is accepted. |
| `default_agent` | string | Default primary agent |
| `update` | `"disable"`, `"notify"`, `"auto"` | Disable updates, notify, or install automatically |
| `share` | `"manual"`, `"auto"`, `"disabled"` | Whether sessions may be shared |
| `enterprise` | `{ url? }` | Enterprise sharing service |
| `username` | string | Name shown in conversations and used for telemetry identity |
| `permissions` | array of `{ action, resource, effect }` | Ordered tool permission rules; `effect` is `allow`, `deny` or `ask` |
| `policies` | array of `{ action, resource, effect }` | Ordered access policies; `action` is `provider.use`, `tool.use` or `integration.use`; `effect` is `allow` or `deny` |
| `agents` | map name to agent | Built-in agent overrides and custom agents (`model`, `request`, `system`, `description`, `mode` = `subagent`/`primary`/`all`, `hidden`, `color` as `#rrggbb`, `steps`, `disabled`, `permissions`) |
| `snapshots` | boolean | Snapshots used for undo and revert |
| `watcher` | `{ ignore?: string[] }` | Filesystem watcher |
| `formatter` | boolean or map | Enable built-in formatters or override them (`disabled`, `command`, `environment`, `extensions`) |
| `lsp` | boolean or map | Language servers (`command`, `extensions`, `disabled`, `env`, `initialization`) |
| `media` | object | Media processing |
| `tool_output` | object | Tool output truncation thresholds |
| `mcp` | `{ timeout?, servers? }` | MCP servers; each is `{ type: "local", command: [...], cwd?, environment?, disabled?, codemode?, timeout?, protocol? }` or `{ type: "remote", url, headers?, oauth?, disabled?, ... }` |
| `compaction` | object | Conversation compaction behaviour |
| `skills` | string[] | Extra paths or URLs to discover skills from |
| `commands` | map name to command | Slash command definitions |
| `instructions` | string[] | Extra paths or URLs supplying ambient instructions |
| `references` | map | Named local directories or Git repositories as external context (a string, `{ repository, branch?, description?, hidden? }` or `{ path, description?, hidden? }`) |
| `websearch` | selection | Web search provider |
| `plugins` | array of string or `{ package, options? }` | Ordered plugin directives |
| `worktree` | object | Directory defaults for worktree creation |
| `warming` | object | Keep recently active sessions warm with transient requests (default: off) |
| `providers` | map provider id to provider | Custom or overridden providers (below) |
| `experimental` | object | Experimental switches |

I listed the leaf fields only where I read them. For `compaction`, `media`, `tool_output`, `websearch`, `worktree`,
`warming` and `experimental`, open the matching file in `packages/schema/src/config/`.

A `providers` entry (`packages/schema/src/config/provider.ts`) has `canonical`, `name`, `env` (array of environment
variable names that hold the API key), `package`, `compatibility`, `settings` (timeouts as numbers or `false`,
`compaction`, `transport`, `encoding`, plus any extra JSON), `headers`, `body`, and `models`, a map of model id to
`{ modelID, family, name, releaseDate, compatibility, package, settings, headers, body, capabilities, variants, cost,
disabled, limit }`.

### Legacy (V1) key names are accepted

`packages/core/src/config/normalize.ts` translates the older OpenCode V1 style into the native one, with warnings in the
log for anything it cannot map. Singular keys such as `provider`, `permission`, `agent`, `command`, `reference`,
`plugin`, plus `autoupdate`, `autoshare`, `snapshot`, `small_model`, `attachment` and V1-style `mcp` entries are
converted. The repository's own `.ktether/ktether.jsonc` uses this older style (`"provider": {}`, `"permission": {}`).
Some V1 keys are explicitly reported as unsupported: `logLevel`, `server`, `subagent_depth`, `layout`, and several
`experimental` and per-provider fields. Prefer the native names (`providers`, `permissions`, `agents`, ...) in new
files.

### What happens when a value is wrong

The file is decoded at the boundary. A document that fails the final validation is rejected as a whole
(`rejected canonical configuration after final validation`) and logged; the other documents still load. Look in the log
file (section 2) if a setting seems ignored.

## 4. Project folders: `.ktether/`

A folder named `.ktether` in a project (or in the global config directory) can hold more than JSON. In this repository
`.ktether/` contains `ktether.jsonc`, `tui.json`, `command/`, `skills/`, `themes/`, `plugins/` and `env.d.ts`. Verified
loaders:

| Subfolder or file | What it does | Where verified |
| --- | --- | --- |
| `command/` or `commands/` containing `**/*.md` | Slash commands defined as Markdown files | `packages/core/src/config/plugin/command.ts` (`{command,commands}/**/*.md`) |
| `agent/`, `agents/`, `mode/`, `modes/` | Agents defined as Markdown | `packages/core/src/config/plugin/agent.ts` (`sourceDirectories`) |
| `skill/` or `skills/` | Skills (a `SKILL.md` per skill folder) | `packages/core/src/config/plugin/skill.ts` |
| `plugin/` or `plugins/` | Plugin source files or folders (`.ts`/`.js` files, or directories) | `packages/core/src/plugin/source-directory.ts` |
| `themes/*.json` | TUI themes, keyed by file name | `packages/tui/src/theme/discovery.ts` |
| `AGENTS.md` | Ambient instructions; the global one lives at `<config dir>/AGENTS.md` and project ones are found walking up from the project | `packages/core/src/config/plugin/instruction.ts` |

The same folder names are also read under `~/.config/ktether` (the global config directory).

`.ktether/tui.json` exists in this repository but I found no code that reads a file with that name; client settings are
read from `cli.json` in the global config directory (next section). Treat the file as unused.

## 5. Client config: `cli.json`

`packages/cli/src/config/config.ts` reads and writes `<config dir>/cli.json` (`path.join(global.config, "cli.json")`).
The file is also JSONC. Its fields come from `Config.Info` in `packages/tui/src/config/index.tsx` plus `$schema`:

`theme`, `keybinds`, `plugins`, `leader`, `scroll`, `attention`, `diffs`, `terminal`, `prompt`, `session`, `tabs`,
`mini`, `debug`, `experimental` (a map of booleans), `animations` (boolean), `highlights` (boolean), `mouse` (boolean)
and `cursor`.

Notes:

- The `Config.update` function in that file lets the app write changes back; it takes a file lock (under
  `<state>/locks`) and writes atomically with mode `0600`. I did not verify which TUI actions call it.
- An inline override exists: `KTETHER_CLI_CONFIG_CONTENT` holds JSON that is merged on top of the file, never written
  to it.
- On first read, `packages/cli/src/config/migrate.ts` migrates older TUI configuration (V1 keybinds and the legacy
  `terminal.copy_on_select` boolean, which becomes `terminal.copy` of `select` or `manual`). The legacy `tabs.enabled`
  boolean becomes `tabs.mode` of `on` or `off`.
- I did not verify the meaning of each leaf option; read `packages/tui/src/config/index.tsx`, whose fields carry
  descriptions.

## 6. Service config: how the background server runs

`ktether` normally talks to a long-lived background server (the "service"). Its settings are managed with
`ktether service get|set|unset` (`packages/cli/src/services/service-config.ts`) and stored in
`<config dir>/service.json` (a build with channel `local` uses `service-local.json`). Keys:

| Key | Meaning |
| --- | --- |
| `disabled` | Turn the service off |
| `remote` | Remote-access settings; the route is generated, never user-set |
| `hostname`, `port` | Where it listens. Default host is `127.0.0.1`. Default port depends on the channel: `0xC0DE` (49374) for release channels and `0xC0DF` (49375) for `local`, moved to `0xB0DE`/`0xB0DF` (45278/45279) on Windows to avoid reserved port ranges. |
| `password` | Fixed server password; if unset the service generates a random one each start |
| `cors` | Additional allowed CORS origins |
| `env` | Extra environment variables injected into the service process |

The `env` key matters for the rest of this guide. The service is a separate process that starts once and stays up, so
exporting a variable in the terminal where you later run `ktether` does **not** change what the service sees. Set it
for the service instead:

```sh
ktether service set env KTETHER_NTFY_URL https://ntfy.example.org
ktether service get env KTETHER_NTFY_URL
ktether service restart
```

`server-process.ts` applies the saved `env` with `Object.assign(process.env, config.env)` before starting the server.
The service's registration (URL, PID, version) is written to `<state>/service.json` (`service-<channel>.json` for
non-release channels).

Commands that need the server use `--server <url>` to connect to a specific one or `--standalone` to run a private
server for the one command. A server started manually reads its password from `KTETHER_PASSWORD` (the older name
`KTETHER_SERVER_PASSWORD` still works) and the clients connecting to it send the same.

## 7. Provider and credentials configuration

- **The Kaggle provider** (`kaggle`, shown as "ktether (Kaggle GPU)") needs no entry in `ktether.jsonc`. Its endpoint and
  key come from, in order: values given in code, then `KTETHER_URL` / `KTETHER_API_KEY`, then the saved session state
  file (section 2). The base URL is normalised to end in `/v1`; the fallback when nothing is set is
  `http://127.0.0.1:8080/v1` (`packages/ai/src/providers/ktether.ts`). `ktether gpu start` writes the state file, so
  normally you set nothing. Setting `KTETHER_URL` to a server of your own (for example your own llama.cpp) is how you
  point the same provider at it.
- **Kaggle credentials** are read by `packages/core/src/ktether/kaggle.ts`: `KAGGLE_USERNAME` plus `KAGGLE_KEY`, else
  `~/.kaggle/kaggle.json`. These belong to Kaggle's own CLI convention, not to ktether.
- **Other providers** are configured through the `providers` key (section 3). `env` lists the variable names that
  hold the API key; the model-call layer reads each as a redacted `Config` value (`packages/ai/src/route/auth.ts`).
- **Local servers** (Ollama, LM Studio, vLLM) are auto-discovered by plugins; their default origin for vLLM is
  `http://127.0.0.1:8000` (`packages/core/src/plugin/provider/vllm.ts`). I did not verify the Ollama and LM Studio
  defaults.
- **Model catalogue**: ktether lists only the models it ships. A remote catalogue is fetched only if
  `KTETHER_MODELS_URL` is set (`packages/core/src/models-dev.ts`; the built-in placeholder is the unresolvable
  `https://models.invalid`). `KTETHER_DISABLE_MODELS_FETCH` turns fetching off even then.

## 8. A worked example: a minimal config

Create `~/.config/ktether/ktether.jsonc` (on Windows `C:\Users\<you>\.config\ktether\ktether.jsonc`):

```jsonc
{
  // Use the Kaggle GPU model by default.
  "model": "kaggle/qwen3.6-27b",

  // Never auto-install updates.
  "update": "notify",

  // Ask before any file edit, in every project.
  "permissions": [{ "action": "edit", "resource": "*", "effect": "ask" }],

  // One extra MCP server, with its secret read from an environment variable.
  "mcp": {
    "servers": {
      "docs": {
        "type": "remote",
        "url": "https://mcp.example.com/mcp",
        "headers": { "Authorization": "Bearer {env:DOCS_MCP_TOKEN}" }
      }
    }
  },

  // Extra folders the file watcher should not look into.
  "watcher": { "ignore": ["**/.venv/**", "**/data/**"] }
}
```

Why this is valid: `model` uses the short `provider/model` form accepted by `ConfigModel.Selection`; `update` is one of
`disable`, `notify`, `auto`; `permissions` is an array of `{ action, resource, effect }` (the action `edit` is the one
the edit, write and patch tools ask for); `mcp.servers.<name>` is a `remote` server with `type` and `url`;
`watcher.ignore` is an array of strings. `{env:DOCS_MCP_TOKEN}` is substituted before parsing.

Then check what ktether resolved:

```sh
ktether debug config      # prints the resolved config entries, secrets redacted
ktether debug paths config
```

`debug config` needs the background server running; it asks the server for the config of the current directory.

A per-project override goes in `<project>/.ktether/ktether.jsonc`, for example to pick a different default model for
one repository:

```jsonc
{ "model": "kaggle/qwen2.5-coder-32b" }
```

(`qwen2.5-coder-32b` is one of the ids in `packages/core/src/ktether/registry.ts`; the models are described in
[06-models.md](06-models.md).)

Setting an environment variable for one command, per shell:

```sh
# bash / Git Bash
KTETHER_NTFY_URL=https://ntfy.example.org ktether gpu start
```

```powershell
# PowerShell
$env:KTETHER_NTFY_URL = "https://ntfy.example.org"; ktether gpu start
```

Remember that `ktether gpu start` talks to the background service, which does the real work; for a variable the
*service* reads, use `ktether service set env ...` (section 6).

## 9. Environment variables

How to read the tables: **Read in** is the file that reads the variable. "Truthy" means the code accepts `1` or `true`
(case-insensitive) in `packages/cli/src/server-process.ts`. "Service" means the variable is read by the server process,
so set it with `ktether service set env NAME VALUE` if you use the background service.

Variables I list under "Not read" or "Internal" are included so you do not waste time on them.

### 9.1 ktether-specific (the Kaggle GPU feature)

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_URL` | `packages/ai/src/providers/ktether.ts` | Base URL of the OpenAI-compatible endpoint the `kaggle` provider calls. Overrides the URL in the saved session state; `/v1` is appended if missing. Default fallback `http://127.0.0.1:8080/v1`. |
| `KTETHER_API_KEY` | `packages/ai/src/providers/ktether.ts` | Bearer token sent to that endpoint. Overrides the saved session key. |
| `KTETHER_NTFY_URL` | `packages/core/src/ktether/signaling.ts`, `lifecycle.ts` | Base URL of the ntfy-compatible relay used to signal between your machine and the Kaggle kernel. Default `https://ntfy.sh`; trailing slashes are removed. `ktether gpu doctor` prints it as "Signalling relay". Service. |
| `KTETHER_MODELS_URL` | `packages/cli/src/server-process.ts`, `packages/core/src/models-dev.ts` | URL of a remote model catalogue. Setting it also turns catalogue fetching on. Service. |
| `KTETHER_MODELS_PATH` | `packages/cli/src/server-process.ts` | Path to a local catalogue file, passed as `models.file`. I did not verify the file format. Service. |
| `KTETHER_DISABLE_MODELS_FETCH` | `packages/cli/src/server-process.ts` | Truthy value disables catalogue fetching. Service. |
| `KTETHER_UPDATE_URL` | `packages/cli/src/services/updater.ts` | Base URL of a release channel for `ktether upgrade` and automatic updates. With none set the code says "No release channel is published yet, so nothing is contacted" and reports `no-channel`. |
| `KTETHER_DISABLE_AUTOUPDATE` | `packages/cli/src/services/updater.ts` | `1` or `true` disables automatic updates. A `local` (source) build never auto-updates either. |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | `packages/core/src/ktether/kaggle.ts` | Kaggle credentials; if absent, `~/.kaggle/kaggle.json` is read. Not ktether-prefixed, but required for the GPU feature. |

### 9.2 Configuration, data and database

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_CONFIG_DIR` | `packages/cli/src/index.ts`, `server-process.ts`, `packages/tui/src/mini/theme.ts` | Replace the global config directory (default `~/.config/ktether`). |
| `KTETHER_CONFIG` | `server-process.ts` | Path to one extra config file, loaded above the global config and below project config. Service. |
| `KTETHER_CONFIG_CONTENT` | `server-process.ts`, `packages/core/src/config.ts` | Inline config JSON (JSONC); loaded above project config, below managed settings. Service. |
| `KTETHER_CLI_CONFIG_CONTENT` | `packages/cli/src/config/config.ts` | Inline JSON merged on top of `cli.json` (never written back). |
| `KTETHER_CONFIG_PROJECT_DISABLE`, `KTETHER_DISABLE_PROJECT_CONFIG` | `server-process.ts` | Truthy disables project-level config discovery. Either name works; the first set wins. Service. |
| `KTETHER_DISABLE_CLAUDE_CODE`, `KTETHER_DISABLE_CLAUDE_CODE_SKILLS` | `server-process.ts` | Truthy stops reading `.claude` directories. Both gate the same roots. Service. |
| `KTETHER_DB` | `packages/cli/src/database-path.ts` | Database file name (or `:memory:`). |
| `KTETHER_DISABLE_CHANNEL_DB` | `packages/cli/src/database-path.ts` | `1`/`true`: use plain `ktether.db` even for non-release channels. |
| `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` | `packages/util/src/global-roots.ts` (state also in `packages/client/src/service-probe.ts`, `packages/simulation/src/manifest.ts`) | Standard XDG overrides, honoured on every OS (section 2). |
| `KTETHER_TEST_HOME` | `packages/util/src/global.ts` | Replaces the home directory (used by the test harness). |

### 9.3 Server, service and authentication

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_PASSWORD` | `packages/cli/src/env.ts`, `server-process.ts`, `services/server-connection.ts` | Server password. Sent by clients using `--server`, and adopted by a manually run or standalone server. Otherwise a random one is generated. Stripped from the environment of stdio-mode servers so tools do not inherit it. |
| `KTETHER_SERVER_PASSWORD` | `packages/cli/src/env.ts` | Older name for the same thing; honoured as a fallback. |
| `KTETHER_CLIENT` | `server-process.ts`, `commands/handlers/default.ts`, `packages/cli/src/index.ts` | Name this process reports as the client (default is the build artifact name). The ACP handler sets `acp`; desktop sets `desktop`. |
| `KTETHER_TUI_CHANNEL` | `packages/cli/src/commands/handlers/default.ts` | Overrides the channel the TUI uses for client-local storage (`bun run dev:live` sets `dev`). |
| `KTETHER_SIMULATE` | `server-process.ts` | Truthy starts the server with the simulated backend. Service. |
| `KTETHER_PTY_HANDOFF` | `server-process.ts`, `packages/client/src/pty-handoff.ts` | Internal: used to hand a terminal session from one server process to the next. Deleted after reading. |
| `KTETHER_PTY_BIN` | `packages/core/src/persistent-pty/*` | Path to the `ktether-pty` helper binary (default: `ktether-pty` on `PATH`). |
| `KTETHER_BIN_PATH` | `packages/cli/bin/ktether.cjs` | Makes the launcher shim run a specific binary. |

### 9.4 Logging and telemetry

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_LOG_LEVEL` | `packages/util/src/observability/logging.ts` | `DEBUG`, `INFO`, `WARN` or `ERROR` (case-insensitive); anything else means `INFO`. |
| `KTETHER_PRINT_LOGS` | `logging.ts`, `packages/cli/src/framework/runtime.ts`, `services/standalone.ts` | `1` prints logs to stderr. The `--print-logs` flag sets it. Server logs only print for `--standalone`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | `packages/cli/src/index.ts`, `packages/util/src/observability.ts` | Standard OpenTelemetry exporter settings. |
| `OTEL_RESOURCE_ATTRIBUTES` | `packages/util/src/observability/otlp.ts` | Standard OpenTelemetry resource attributes. |

### 9.5 Files, shell and terminal

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_FILEWATCHER_DISABLE`, `KTETHER_DISABLE_FILEWATCHER` | `server-process.ts` | Truthy turns the filesystem watcher off. Service. |
| `KTETHER_DISABLE_FFF` | `server-process.ts` | Controls the native fast file finder. Unset: on everywhere except Windows. Set: on unless truthy. Service. |
| `KTETHER_GIT_BASH_PATH` | `server-process.ts`, `services/updater.ts` | Windows: path to `bash.exe` for the shell tool (passed as `windows.gitbash`). |
| `KTETHER_REPO_CLONE_GITHUB_BASE_URL` | `packages/core/src/repository.ts` | Replaces `https://github.com/` as the base for cloning GitHub references. |
| `KTETHER_EDITOR_SSE_PORT` | `packages/tui/src/context/editor.ts` | Port of an editor's integration server (`CLAUDE_CODE_SSE_PORT` is read first). |
| `KTETHER_ZED_DB` | `packages/tui/src/editor-zed.ts` | Path to Zed's database for the Zed integration. |
| `SHELL`, `COMSPEC`, `PATH`, `PATHEXT`, `EDITOR`, `VISUAL`, `TERM`, `TERM_PROGRAM`, `COLORTERM`, `NO_COLOR` | `packages/core/src/shell/select.ts`, `util/which.ts`, `tui/src/editor.ts`, `tui/src/util/system.ts`, `cli/src/commands/handlers/stats.ts` | Standard variables used for picking a shell, finding programs, launching an editor, and terminal detection. |

### 9.6 Development, TUI and diagnostics

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_STORY` | `packages/tui/src/app.tsx`, `plugin/builtins.ts` | Opens the TUI storybook. `1` opens the index, any other value opens that story id. |
| `KTETHER_ROUTE` | `packages/tui/src/app.tsx` | JSON for the initial route. |
| `KTETHER_FAST_BOOT` | `packages/tui/src/app.tsx` | Any non-empty value skips the initial loading screen. |
| `KTETHER_DRIVE`, `KTETHER_DRIVE_RENDERER` | `packages/tui/src/app.tsx`, `packages/simulation/src/*` | Enable the "drive" automation harness; `1` uses defaults, another value names an instance registered under `<state>/ktether-drive/instances` (or `DRIVE_REGISTRY_DIR`). |
| `KTETHER_DIRECT_TRACE`, `KTETHER_SHOW_TTFD` | `packages/cli/src/mini-host.ts` | Tracing and time-to-first-draw display for the `mini` host. |
| `KTETHER_SSH_ASKPASS_PORT`, `KTETHER_SSH_ASKPASS_TOKEN`, `SSH_ASKPASS_PROMPT` | `packages/cli/src/index.ts`, `ssh-askpass.ts` | Internal plumbing for answering SSH password prompts. |

### 9.7 Set by ktether (outputs, not settings)

These are placed in the environment of commands ktether runs for you. Do not set them yourself.

| Name | Set in | Meaning |
| --- | --- | --- |
| `KTETHER_TERMINAL` | `packages/core/src/shell.ts`, `pty.ts` | `1` inside ktether-run terminals and shells. |
| `KTETHER_SESSION_ID` | `packages/core/src/tool/plugin/shell.ts` | The current session id, for commands run by the shell tool. |

### 9.8 Build, packaging and release (not for end users)

Read by build scripts or baked in at build time. Included only so you recognise them.

`KTETHER_VERSION`, `KTETHER_CHANNEL`, `KTETHER_ARTIFACT`, `KTETHER_RELEASE_HIGHLIGHTS`: compile-time constants in
`packages/cli/src/version.ts`, defined by `packages/cli/script/build.ts`. A build with none of them is version `local`,
channel `local`, artifact `cli`. `KTETHER_CLI_NAME`, `KTETHER_CLI_DIST`, `KTETHER_CLI_TARGET`, `KTETHER_LIBC`,
`KTETHER_BUMP`, `KTETHER_RELEASE`, `KTETHER_RELEASE_NOTES`, `KTETHER_DESKTOP_DIST`: build and publish scripts.
`KTETHER_NODE_ASSETS_DIR`, `KTETHER_NODE_PTY_PATH`, `KTETHER_PARCEL_WATCHER_PATH`, `KTETHER_PHOTON_WASM_PATH`,
`KTETHER_TREE_SITTER_WASM_PATH`, `KTETHER_TREE_SITTER_BASH_WASM_PATH`, `KTETHER_TREE_SITTER_POWERSHELL_WASM_PATH`,
`KTETHER_FFF_FFI`, `KTETHER_FFF_FFI_PATH`: locations of native or WASM assets, used by the Node build of the CLI
(`packages/cli/vite.node.config.ts`, `packages/core/src/**/*.node.ts`). The web app reads `VITE_KTETHER_SERVER_MODE`,
`VITE_KTETHER_SERVER_HOST` and `VITE_KTETHER_SERVER_PORT` at build time (`packages/app/src/env.d.ts`,
`runtime/platform/web.ts`); the default server port there is `4096`.

### 9.9 Desktop app and tests

| Name | Read in | Meaning |
| --- | --- | --- |
| `KTETHER_DESKTOP_*` (`CLI_DEV`, `ISOLATED_SERVER`, `SERVER_CHANNEL`, `DISABLE_PROTOCOL_REGISTRATION`, `REMOTE_DEBUGGING_PORT`, `TEST_ROOT`, `WSL_CLI_BUILD`, `WSL_CLI_OUTPUT`) | `packages/desktop/src/main/**`, `packages/desktop/scripts/dev.ts` | Desktop development and test switches. I did not verify each. |
| `KTETHER_DISABLE_EMBEDDED_WEB_UI`, `KTETHER_TEST_ONBOARDING` | `packages/desktop/src/main/lifecycle/configure.ts` and others | Desktop startup and test switches. |
| `KTETHER_SERVER_HOST`, `KTETHER_SERVER_PORT`, `KTETHER_TEST_FIXTURES`, `KTETHER_PERFORMANCE` | `packages/app/playwright.config.ts`, `packages/app/vite.config.ts` | Settings for the app's Playwright runs. |
| `KTETHER_TEST_HOME`, `KTETHER_DB`, `KTETHER_CONFIG_DIR` | `packages/core/script/test.ts`, `packages/core/test/preload.ts` | The core test runner points all of these at a throwaway directory (see [16-testing.md](16-testing.md)). |
| `KTETHER_DISABLE_SHARE` | `turbo.json` only | Passed through Turborepo to tasks; I found no code reading it. |

### 9.10 Variables set somewhere but not read by the code (possibly dead)

| Name | Where it appears | Observation |
| --- | --- | --- |
| `KTETHER_EXPERIMENTAL_DISABLE_FILEWATCHER` | `.github/workflows/test.yml` (set to `true` on Windows), `packages/gui-extensions/src/wsl/sidecar.ts` | No code under `packages/*/src` reads it. The server reads `KTETHER_FILEWATCHER_DISABLE` and `KTETHER_DISABLE_FILEWATCHER`. The CI setting on Windows therefore looks ineffective. |
| `KTETHER_EXPERIMENTAL_FILEWATCHER` | `packages/desktop/src/main/lifecycle/environment.ts` | Set to `true`, but not read anywhere I found. |
| `KTETHER_SERVER_USERNAME`, `KTETHER_SERVICE_ENV_TEST`, `KTETHER_SESSION_ENV_TEST` | tests only | Test fixtures. |
| `KTETHER_TOOL_GUIDANCE` | `packages/core/src/session/system-prompt.ts` | Not an environment variable: it is a `${KTETHER_TOOL_GUIDANCE}` placeholder inside prompt text files, replaced in code. |

I did not exhaustively list the variables of the desktop and extension packages (`KTETHER_REMOTE_TARGET`,
`KTETHER_SSH_REGISTRATION_*`, `KTETHER_SSH_STATUS`, `KTETHER_INSTALLER_TEST_ROOT`, ...). They are internal plumbing.

## 10. Troubleshooting configuration

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A setting in `ktether.jsonc` has no effect | The file has a syntax error, or a later source overrides it | Check the log (`<data>/log`) for "configuration normalization diagnostic"; run `ktether debug config` to see the resolved entries |
| `{env:NAME}` turned into nothing | The variable is unset in the **service's** environment | Use `ktether service set env NAME value`, then `ktether service restart` |
| Edits to the Kaggle state file seem ignored or lost | It is rewritten by `ktether gpu start/stop` | Do not edit it; use `ktether gpu status`, `reconnect`, `clean` |
| `XDG_STATE_HOME` set but Kaggle state still in `~/.local/state/ktether` | The Kaggle state path ignores XDG (section 2) | Expected for now; known inconsistency |
| Different data between `ktether` and `bun run dev` | The source build uses channel `local` and a separate `ktether-local.db`, and its own `service-local.json` | Expected; use `bun run dev:live` to share the live server |
| Windows: config not found in `%APPDATA%` | ktether uses `C:\Users\<you>\.config\ktether`, not `%APPDATA%` | Look under your user profile |
| A config key I copied from OpenCode docs is reported unsupported | V1 keys such as `server`, `layout`, `logLevel` are not supported | Remove them or use the native equivalent |

## 11. Things that look stale or inconsistent

- `packages/core/schema.json` is a database snapshot, not a configuration schema; the `$schema` URLs in
  `.ktether/ktether.jsonc` and `.ktether/tui.json` point at a non-existent `schema/` folder.
- `.ktether/tui.json` appears unused (no reader found); the TUI reads `cli.json`.
- `.ktether/ktether.jsonc` uses V1-style singular keys.
- Kaggle state (`packages/core/src/ktether/state.ts`, `packages/ai/src/providers/ktether.ts`) hardcodes
  `~/.local/state/ktether` and ignores `XDG_STATE_HOME` and `KTETHER_TEST_HOME`. Tests work around this by changing
  `HOME` and `USERPROFILE` (`isolateHome` in `packages/core/test/ktether/helpers.ts`).
- Two environment variables used by CI, the WSL sidecar and desktop (`KTETHER_EXPERIMENTAL_*FILEWATCHER`) are set but
  not read.
- The explicit `OTEL_*` handling and the `enterprise`, `share` and `username` keys are inherited from upstream; I did
  not verify that any ktether service consumes them.
