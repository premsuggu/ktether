# ktether

Use this guide as the starting point for work involving ktether itself. It
covers the core concepts needed to configure and customize ktether, extend it
with plugins, and build integrations with the ktether SDK, clients, and API.

Full documentation is available at <https://github.com/premsuggu/ktether/tree/main/docs>. This overview is
only an index of core concepts. Before answering a question about a topic below,
fetch the URL named in that section and use the full page as the source of
truth. Follow links from that page when the question needs more detail. Fetch
<https://github.com/premsuggu/ktether/tree/main/docs> first when you need to discover the relevant
documentation page.

A machine-readable documentation index is available at
<https://github.com/premsuggu/ktether/tree/main/docs>.

## Version policy

Always answer for ktether V2 unless the user explicitly asks about V1,
legacy ktether, or migrating from V1.

Use only <https://github.com/premsuggu/ktether/tree/main/docs> documentation as the source of truth for V2.
Do not use <https://github.com/premsuggu/ktether/tree/main/docs>, which documents V1, and do not use
general web search to resolve a V2 documentation question when the V2 docs or
linked pages cover it. The schema served from
<https://raw.githubusercontent.com/premsuggu/ktether/main/schema/config.json> accepts both V2 fields and deprecated V1
fields. Never recommend a field it marks deprecated. If V2 documentation is
missing or contradictory, state the uncertainty or ask for clarification instead of falling back to V1.

V1 documentation and syntax may be consulted only when the user explicitly
asks about V1 or when needed as migration input. Outputs and recommendations
must still use V2 unless the user specifically requests a V1 result.

## [CLI](https://github.com/premsuggu/ktether/tree/main/docs)

For questions about the terminal interface, command-line invocation, `run`,
`mini`, terminal providers, or other CLI behavior, fetch the
[CLI guide](https://github.com/premsuggu/ktether/tree/main/docs) and the relevant page linked from
that section.

CLI and TUI preferences are separate from ktether's server and project
configuration. They live in the global `~/.config/ktether/cli.json`, or
`$XDG_CONFIG_HOME/ktether/cli.json` when `XDG_CONFIG_HOME` is set. There is no
project-local CLI configuration. Set `KTETHER_CLI_CONFIG_CONTENT` to merge
inline JSON over the global settings. Most preferences can also be changed from
the TUI by pressing `Ctrl+P` and selecting **Open settings**.

### [Settings](https://github.com/premsuggu/ktether/tree/main/docs)

Fetch the full [CLI settings reference](https://github.com/premsuggu/ktether/tree/main/docs)
before editing `cli.json`. It documents every terminal-only setting, accepted
values, and examples, including themes, input, sessions, tabs, diffs, alerts,
Mini, keybindings, terminal plugins, and debugging. Do not put these settings
in `ktether.json(c)`.

### [Keybinds](https://github.com/premsuggu/ktether/tree/main/docs)

Configure keybindings under `keybinds` in `cli.json`. The leader key is the
`keybinds.leader` entry; leader timing is configured separately under
`leader.timeout`. Bindings can use a string, an array of strings, or an object
when event behavior such as `preventDefault` is required. Disable a binding
with `"none"` or `false`.

Never guess a command ID, default binding, or accepted key syntax. Fetch the
full [keybind reference](https://github.com/premsuggu/ktether/tree/main/docs), which lists
the current IDs and defaults, before answering or editing a binding.

## [ktether configuration](https://github.com/premsuggu/ktether/tree/main/docs)

ktether's server and project configuration uses JSON or JSONC. Include the
published schema so the user's editor can validate fields and provide
autocomplete:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/premsuggu/ktether/main/schema/config.json",
}
```

Global configuration lives at `~/.config/ktether/ktether.json(c)` and applies
to every project for that user. Project configuration can live in any directory
as `ktether.json(c)` or `.ktether/ktether.json(c)`, including nested packages
in a monorepo.

During ordinary project discovery, ktether searches the current Location
directory and every ancestor through the filesystem root, including directories
above the detected project or repository root. It merges direct
`ktether.json(c)` files from the farthest ancestor to the current directory,
then does the same for `.ktether/ktether.json(c)` files. This means every
discovered `.ktether` config overrides every discovered direct config. Global
filesystem configuration has lower precedence than these discovered documents.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

This configuration is distinct from `cli.json`. Use the
[CLI settings reference](https://github.com/premsuggu/ktether/tree/main/docs) for terminal
preferences, especially themes and keybindings.

Do not guess field names or shapes. Fetch the V2 configuration guide and its
linked topic guide as the source of truth, and preserve unrelated settings when
editing an existing file. Keep the published `$schema` URL in configuration
examples, but do not fetch it to determine the V2 configuration shape.

See the [full configuration guide](https://github.com/premsuggu/ktether/tree/main/docs) for
every field, examples, config locations, and links to dedicated feature guides.

## [MCP servers](https://github.com/premsuggu/ktether/tree/main/docs)

Configure MCP servers under `mcp.servers`. Prefer the CLI because it preserves
unrelated configuration. Use `--global` when the user asks to set up a service
for themselves without limiting it to the current project; omit it when they
explicitly want project-local configuration.

```sh
ktether mcp add <name> --global --url <remote-url>
ktether mcp list
```

Remote servers use OAuth by default. If `mcp list` reports that a server needs
authentication, tell the user to run `/mcps`, select the server, and sign in.
Do not run `ktether mcp auth` through the shell tool: it starts an interactive
flow whose authorization link can be hidden in background process output.
Use the user-facing MCP interface instead.

Report the server as configured but awaiting sign-in until its connection
status confirms it is connected.

OAuth credentials are stored outside the ktether configuration. Do not ask for or
store an API key when the server supports OAuth. Use header-based credentials
only when OAuth is unavailable or the user explicitly requires them, and use an
environment substitution such as `{env:MCP_API_KEY}` instead of writing a
secret into configuration.

## [V1 to V2 migration](https://github.com/premsuggu/ktether/tree/main/docs)

For any request to migrate ktether configuration, agents, commands, skills,
plugins, integrations, or other behavior from V1 to V2, read the full
[migration guide](https://github.com/premsuggu/ktether/tree/main/docs) before acting. In
the repository, its source is `services/www/src/docs/content/migrate-v1.mdx`.

V1 config files and `.ktether/` definitions are intended to remain compatible.
The only intentional breaking changes are the server API and plugin API. Native
V2 config uses more ergonomic shapes, but conversion is optional. When the user
requests conversion, inspect the complete configuration, preserve behavior and
unrelated settings, and apply only the relevant migrations from the guide. For
plugin migrations, fetch and follow both the migration guide and the full
[plugins guide](https://github.com/premsuggu/ktether/tree/main/docs). If non-API V1
functionality fails in V2, use the `report` skill to file it as a compatibility
bug.

## [Plugins](https://github.com/premsuggu/ktether/tree/main/docs)

For questions about creating, configuring, loading, publishing, or migrating
plugins, fetch the full [plugins guide](https://github.com/premsuggu/ktether/tree/main/docs)
before answering. Refer to this guide when the user wants to build a plugin. It
covers hooks, transforms, tools, plugin context capabilities, and package
entrypoints. Plugins can also extend the TUI; for those, fetch the
[CLI plugin guide](https://github.com/premsuggu/ktether/tree/main/docs).
For custom methods and events shared with other plugins or clients, fetch the
[RPC guide](https://github.com/premsuggu/ktether/tree/main/docs).

## [Service](https://github.com/premsuggu/ktether/tree/main/docs)

ktether uses a client-server architecture. Interfaces such as the TUI connect
to a background ktether service, which owns sessions, configuration, plugins,
permissions, and tool execution.

ktether normally discovers or starts the shared background service
automatically. If the service is stuck or unhealthy, restart it:

```sh
ktether service restart
```

Check its status after restarting:

```sh
ktether service status
```

## [API](https://github.com/premsuggu/ktether/tree/main/docs)

ktether exposes an HTTP API from its server. The API is described by an
OpenAPI document available from the running server at `/openapi.json`.

Use ktether's built-in `api` command for local requests. It uses the same
discovery and authentication flow as the TUI and may start the background
service when no compatible healthy service is available. It accepts either an
HTTP method and path or an OpenAPI operation ID.

Call an endpoint with an HTTP method and path:

```sh
ktether api get /api/info
```

Pass a request body with `--data` or `-d`, and additional headers with
`--header` or `-H`:

```sh
ktether api post /api/example --data '{"key":"value"}'
ktether api get /api/example --header 'X-Example:value'
```

Request bodies default to `Content-Type: application/json`. When ktether is
connected to an explicit server instead of its managed background service, use
the same configured server and authentication context rather than constructing
an unauthenticated request separately.

See the [full API reference](https://github.com/premsuggu/ktether/tree/main/docs) for available
endpoints, parameters, request bodies, and response schemas. The
raw [OpenAPI specification](https://raw.githubusercontent.com/premsuggu/ktether/main/schema/openapi.json) is also
available for code generation and other tooling.

## [Client](https://github.com/premsuggu/ktether/tree/main/docs)

For questions about connecting an application to ktether over the network,
fetch the full [client guide](https://github.com/premsuggu/ktether/tree/main/docs) before
answering.

`@ktether/client` is the generated TypeScript client for the ktether HTTP
API. Its methods and types come from the same contract as the API reference.
The default entrypoint exposes Promise-based resource clients and async
iterables for streaming endpoints. The `@ktether/client/effect` entrypoint
exposes typed Effects, Streams, and decoded ktether schema values. Its
`Service` API can discover, start, stop, and authenticate with the local
background service from a Node application.

## [SDK](https://github.com/premsuggu/ktether/tree/main/docs)

For questions about embedding ktether directly in an application, fetch the
full [SDK guide](https://github.com/premsuggu/ktether/tree/main/docs) before answering. The SDK
hosts ktether in the application without opening an HTTP listener.

Use the [Effect SDK guide](https://github.com/premsuggu/ktether/tree/main/docs) for
Effect applications. For Cloudflare Durable Objects, use the
[Cloudflare SDK guide](https://github.com/premsuggu/ktether/tree/main/docs).

## [Troubleshooting](https://github.com/premsuggu/ktether/tree/main/docs)

ktether runs a client and a background server. Start by determining whether a
problem belongs to the client, the shared server, or one project.

- Check the service with `ktether service status` and verify the API with
  `ktether api get /api/info`.
- Compare with `ktether --standalone`, which runs the TUI with a private
  server, to isolate shared-service issues.
- Inspect `~/.local/share/ktether/log/ktether.log`. Filter `role=cli` for
  client startup and `role=server` for sessions, providers, plugins,
  permissions, and tools.
- Run one reproduction with `KTETHER_LOG_LEVEL=DEBUG` when normal logs are not
  sufficient.
- Do not delete or edit the database, service registration, or service config
  while diagnosing a problem. Back up persistent data before inspecting it
  with external tools.
- Redact API keys, authorization headers, prompts, file contents, and other
  sensitive data before sharing diagnostics.

See the [full troubleshooting guide](https://github.com/premsuggu/ktether/tree/main/docs)
for service lifecycle commands, API inspection, log locations, explicit server
connections, issue-reporting details, and local development paths.
