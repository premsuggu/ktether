# 14. Development guide

This guide is for someone who has just cloned the repository and wants to change it. It assumes you have never seen
this codebase and may never have worked in a monorepo (one Git repository that holds many separate packages). Every
claim below was checked against the files in the repository; where something could not be checked, the text says
"I did not verify this".

ktether is a coding agent with a terminal UI, a command line, and web/desktop apps. Its product goal is to run
open-source language models on Kaggle's free dual-T4 GPUs. It is a fork of the MIT-licensed OpenCode project, heavily
trimmed, so you will occasionally meet leftover upstream wording in older files (the last section lists what looks
stale). The Kaggle pipeline itself is documented in [04-kaggle-pipeline.md](04-kaggle-pipeline.md); this guide only
covers the developer workflow.

Related guides: [15-configuration.md](15-configuration.md) (config files, directories, environment variables) and
[16-testing.md](16-testing.md) (how the tests work).

## 1. Prerequisites

| Tool | Why you need it | Version / notes |
| --- | --- | --- |
| Bun | Package manager, script runner, test runner and the runtime the CLI runs on in development | Root `package.json` pins `"packageManager": "bun@1.4.2"`. `CONTRIBUTING.md` still says "Bun 1.3 or newer", which is out of date (see section 11). |
| Git | Source control; the hook and several tests shell out to `git` | Any recent version. On Windows, Git for Windows also gives you Git Bash, which the commands in this guide assume. |
| A POSIX `sh` | The `dev:live` script is a `sh -c '...'` one-liner | On Windows, Git Bash provides it. I did not verify the script under PowerShell or cmd. |
| Python 3 | Only for the Kaggle "kernel" tests, which run the generated Python server script | `python` or `python3` must answer `--version`. If neither exists those tests are skipped, not failed (`describe.skipIf(!python)` in `packages/core/test/ktether/kernel-script.test.ts` and `kernel-behaviour.test.ts`). |
| Kaggle CLI | Only to use the real GPU feature, not to run the tests | `pip install kaggle` (that is the message the code prints when `kaggle` is missing, in `packages/core/src/ktether/kaggle.ts`). Credentials come from `KAGGLE_USERNAME` and `KAGGLE_KEY`, or `~/.kaggle/kaggle.json`. Tests install a fake Kaggle CLI instead, see [16-testing.md](16-testing.md). |
| Playwright browsers | Only for the browser test suites (`packages/app` e2e and component tests) | `bunx playwright install chromium`, run from `packages/app` (documented in `packages/app/README.md`). |

Node.js is not listed above because I did not find anything in the development flow that requires it to be installed
yourself. CI does install Node 24 (`.github/actions/setup-bun/action.yml`) because native-module install scripts use
`node-gyp`, and the CI build job verifies a Node build of the CLI. I did not verify whether a local `bun install`
fails without Node.

Check your Bun version first:

```sh
bun --version
```

The `.husky/pre-push` hook reads `packageManager` from `package.json` and fails the push unless your Bun satisfies
`^1.4.2` (that is, 1.4.2 or any later 1.x). It only warns if your version differs from the pinned one but is still
compatible.

Related to this: `.editorconfig` says files use LF line endings, two-space indentation and a final newline. See
section 10 for how that interacts with Windows.

## 2. Cloning and installing

```sh
git clone https://github.com/premsuggu/ktether.git
cd ktether
bun install
```

(`premsuggu/ktether` is the `origin` remote of the checkout this guide was written from. Substitute your own fork.)

`bun install` is the only install command you need. It installs every package in the monorepo at once, because of the
`workspaces` field in the root `package.json`:

```json
"workspaces": {
  "packages": ["packages/*"],
  "catalog": { "effect": "4.0.1", "typescript": "npm:@typescript/typescript6@6.0.2", "...": "..." }
}
```

Three terms you will meet:

- **Workspace**: each folder under `packages/` with its own `package.json` is a workspace package. Their names start
  with `@ktether/` (for example `@ktether/core` lives in `packages/core`). When package A lists
  `"@ktether/util": "workspace:*"` as a dependency, Bun links it to the local folder instead of downloading it.
- **Catalog**: the `catalog` object pins one version per third-party library. A package then writes
  `"effect": "catalog:"` and gets that version, so all packages agree. To bump a library you edit the catalog once.
- **Lockfile**: `bun.lock` records the exact resolved versions. Commit changes to it when you change dependencies.

### What `bun install` also does

- **`bunfig.toml`** (root) configures Bun itself. Its `[install]` section sets `exact = true` (save exact versions, no
  `^` ranges) and `minimumReleaseAge = 259200`, which is three days in seconds: a newly resolved package version must
  have been published at least three days ago. A long `minimumReleaseAgeExcludes` list names packages that are exempt
  (for example `@opentui/core`, `electron`, `@ktether/sdk`). The `[test]` section sets
  `root = "./do-not-run-tests-from-root"`, which is the guard that stops `bun test` from running at the repository
  root (see section 5 and [16-testing.md](16-testing.md)).
- **`patches/`** holds `.patch` files for third-party packages (for example `patches/vite@8.2.2.patch` and
  `patches/solid-js@1.9.15.patch`). The root `package.json` lists them under `patchedDependencies`, and Bun applies
  them after downloading. If a patched package is upgraded, the patch name and the `patchedDependencies` entry have to
  be updated together. `patches/install-korean-ime-fix.sh` is a loose script, not a `.patch` file; I did not verify
  what uses it.
- **`postinstall`** runs `bun run --cwd packages/core fix-node-pty`. On non-Windows systems that script marks the
  `spawn-helper` binaries inside `node-pty` as executable (`packages/core/script/fix-node-pty.ts`). On Windows it does
  nothing visible.
- **`prepare`** runs `husky`, which installs the Git hooks from `.husky/`. The only hook is `pre-push`: it checks the
  Bun version (section 1) and then runs `bun run check`. So a `git push` runs the full lint and type check first.
- **`trustedDependencies`** in the root `package.json` lists the packages allowed to run install scripts
  (`esbuild`, `node-pty`, `protobufjs`, `electron`).

## 3. A tour of the repository root

```text
ktether/
  AGENTS.md            Rules for contributors and coding agents (summarised in section 6)
  CONTRIBUTING.md      Older, upstream-flavoured contribution notes
  package.json         Root scripts, workspace and catalog, patched dependencies
  bunfig.toml          Bun settings: install policy and the test-from-root guard
  turbo.json           Task graph for Turborepo (`turbo`)
  tsconfig.json        Tiny base TypeScript config
  bun.lock             Exact dependency versions
  .oxlintrc.json       Lint rules for oxlint
  .editorconfig        LF endings, 2-space indent
  .gitattributes       A few generated/LF-only file rules
  .husky/              Git hooks (pre-push)
  .github/             CI workflows, issue and PR templates, composite actions
  .ktether/            ktether's own project config, commands, skills and themes for this repo
  .opencode/           Leftover upstream folder (see section 11)
  packages/            All workspace packages
  patches/             Patches applied to third-party packages
  script/              Repository-level helper scripts (Bun TypeScript)
  perf/                One performance note (stale, see section 11)
  specs/v2/            Written specifications of V2 behaviour
  sdks/vscode/         A VS Code extension, not part of the workspace
```

### `package.json`

Name `ktether`, `"private": true` (never published), `"type": "module"` (ES modules). The interesting part is
`scripts`, explained in section 4.

### `turbo.json`

[Turborepo](https://turborepo.com) (the `turbo` command, installed as a dev dependency) runs a script in every
package in dependency order and caches the results. You do not normally call `turbo` yourself; the root scripts
`typecheck` and CI do. What the file encodes:

- `typecheck` is a task with no dependencies of its own, but `@ktether/cli`, `@ktether/sdk`, `@ktether/server`,
  `@ktether/simulation` and `@ktether/tui` each declare `dependsOn: ["@ktether/core#typecheck"]`, so core is checked
  first.
- `test` depends on a `transit` task. The file's own comment explains it: no package has a `transit` script, it runs
  nothing, and it exists only to fold every workspace dependency into the test cache hash. Workspace packages export
  their TypeScript sources directly, so tests never wait for a build.
- `build` outputs `dist/**`. `test:components` has caching turned off, and `@ktether/desktop#test` is also uncached.
- `globalDependencies` lists files that invalidate every cache when they change: `patches/**`, `bunfig.toml`, `.npmrc`,
  `.github/actions/setup-bun/**`, `.github/workflows/test.yml` and `package.json`. (No `.npmrc` exists in this
  checkout.) `globalEnv` and `globalPassThroughEnv` carry `CI` and `KTETHER_DISABLE_SHARE`.

### `tsconfig.json`

```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": { "types": ["bun"] }
}
```

Each package has its own `tsconfig.json` that does the real work. The root file is only a base.

### `script/`

| File or folder | What it is |
| --- | --- |
| `format.ts` | Runs `bun run prettier --ignore-unknown --write .` (formats the whole repo). Prettier settings are in the root `package.json`: no semicolons, line width 120. |
| `generate.ts` | Meant to regenerate OpenAPI and docs, then format. It runs `bun run generate` in `packages/protocol` and in `services/www`, but `services/www` does not exist here. See section 11. |
| `lint-changed.ts` | Runs oxlint (including warn-level "anti-slop" rules) on GUI package files a branch touched. Used by CI on pull requests. |
| `sdk-docs.ts` | Checks that the GUI extension SDK in `packages/gui-extensions/src/sdk` has doc comments and that code blocks in its README match their sources. It is part of `bun run lint`. |
| `ast-grep/` | [ast-grep](https://ast-grep.github.io) rules (structural code search/lint), plus their tests. Three configs: `sgconfig.yml` (Effect patterns), `effect-simplifications/` and `gui-extensions/`. |
| `oxlint/anti-slop/` | Custom oxlint plugins loaded by `.oxlintrc.json`. |
| `profile-typecheck.ts`, `profile-typecheck-packages.ts` | Time the type check, for the `typecheck:profile*` scripts. |
| `upgrade-opentui.ts` | Helper for the `upgrade-opentui` script, which bumps the OpenTUI terminal-UI libraries. |
| `release.ts`, `version.ts`, `publish.ts`, `publish-winget.ts`, `update-artifact.ts`, `sign-windows.ps1` | Release and publishing helpers inherited from upstream. I did not verify which of them still work for ktether. |
| `drive/` | Helpers for the "drive" simulation harness (`KTETHER_DRIVE`, see [15-configuration.md](15-configuration.md)). |
| `hooks` | A shell script (not a directory) that writes a `.git/hooks/pre-push` running `bun run typecheck`. Nothing in `package.json` or `.husky/` calls it; the real hook is `.husky/pre-push`. Treat it as legacy. |

### `.github/workflows/`

| Workflow | Triggers | What it runs |
| --- | --- | --- |
| `check.yml` | push and pull request on `dev`; manual | `bun run check` (lint plus type check). On pull requests it also runs `bun run lint:changed HEAD^1`. |
| `test.yml` | push on `main`, any pull request, manual | `affected` job (which packages changed), `unit` job on Linux and Windows (`bun turbo test --affected --concurrency=3`, plus the ast-grep rule tests and the client's `check:generated`), `build` job (compiled CLI smoke tests, library builds), and `e2e` jobs (Playwright against a production build, session-UI and app component tests). |
| `storybook.yml` | push and pull request on `dev`, filtered by path | Builds Storybook (`bun --cwd packages/storybook build`). |

The workflows run on GitHub's standard runners (`ubuntu-latest`, `windows-latest`) and trigger on `main`.

### `perf/` and `specs/`

- `perf/test-suite.md` is a note about speeding up the old `packages/ktether` test suite using scripts called
  `bench:test` and `profile:test`. Neither the folder nor the scripts exist any more (section 11).
- `specs/v2/` holds written specifications (`session.md`, `tools.md`, `event-stream-architecture.md`,
  `provider-policy.md`, `catalog-config-plugin-lifecycle.md`). Its `README.md` says they explain behaviour that is hard
  to recover from one source file and that the protocol endpoint definitions, schema package, and core package remain
  the authority for their own concerns. Read the session spec before touching the session code.

### The packages

All of these live under `packages/`. Roles that I inferred from folder contents rather than from a description field
are marked (inferred); almost no `package.json` here has a `description`.

| Package | Role |
| --- | --- |
| `schema` | Shared data shapes written as Effect Schemas (config, sessions, events, permissions, models). Depends on nothing else in the workspace. |
| `util` | Shared helpers: global directories, file locks, logging, process spawning (inferred from `src/` names). |
| `core` | The engine: sessions, tools, providers, config loading, database, MCP, and the whole `src/ktether/` Kaggle pipeline. |
| `ai` | The model-call layer: protocols and provider packages (OpenAI-compatible chat, Anthropic messages, and so on), plus the ktether provider at `src/providers/ktether.ts`. |
| `protocol` | The public HTTP API definition (`HttpApi` groups in `src/groups/`), plus the generated `openapi.json`. |
| `server` | The HTTP server: handlers that implement the protocol using core. |
| `client` | The generated typed client (promise, Effect and Solid flavours) that the CLI, TUI and apps use to talk to the server. |
| `cli` | The `ktether` command. Entry point `src/index.ts`. |
| `tui` | The terminal user interface (OpenTUI, Solid). |
| `app`, `ui`, `session-ui`, `desktop`, `gui-extensions`, `storybook` | The web app, shared UI components, session UI components, the Electron desktop shell, the extension SDK for the GUI, and the Storybook that hosts component tests. |
| `sdk` | A package that composes client, core and server (per `AGENTS.md`). |
| `plugin`, `plugin-browser` | The plugin API and a desktop browser plugin. |
| `http-recorder`, `httpapi-codegen` | Test tooling (record/replay HTTP) and the code generator for the client. |
| `simulation` | A simulated backend and "drive" harness (inferred; it reads `KTETHER_SIMULATE` / `KTETHER_DRIVE`). |
| `codemode`, `merman`, `latex`, `theme`, `script` | Confined code execution; diagram rendering (inferred); LaTeX (inferred); theme tokens; release version helpers. |
| `effect-drizzle-sqlite` | A folder with an `examples/` directory but no `package.json`, so it is not a workspace package. See section 11. |

### The dependency rule

From `AGENTS.md`: runtime dependencies point one way. Schema flows into Core and Protocol, and Core and Protocol flow
into Server. Client runtime code may depend on Schema and Protocol but never on Core or Server. `sdk` composes
Client, Core and Server. If you find yourself importing `@ktether/core` from `packages/client`, stop: the layering is
being violated.

## 4. The root scripts, one by one

Run all of these from the repository root.

| Script | Command it runs | What it does |
| --- | --- | --- |
| `bun run dev` | `bun run --cwd packages/cli src/index.ts` | Runs the CLI from source with no build step. With no arguments it starts the terminal UI. Extra arguments pass through, for example `bun run dev gpu status`. Because of `--cwd packages/cli`, pass a directory argument (`bun run dev /path/to/project`) to point it at a project; I did not verify how the default directory is resolved. |
| `bun run dev:live` | `KTETHER_TUI_CHANNEL=dev KTETHER_PASSWORD="$(ktether service get password)" exec bun run dev "$@" --server "$(ktether service status)"` | Runs your working tree's TUI against the background `ktether` server that is already running on your machine. It needs an installed `ktether` on `PATH`. It asks that binary for the server URL (`service status`) and the private password (`service get password`), and sets `KTETHER_TUI_CHANNEL=dev` so tab and other client-local state use the `dev` storage channel. |
| `bun run dev:vite` | `bun run --cwd packages/cli --conditions=browser dev/vite.ts` | Runs the CLI dev harness in `packages/cli/dev/` (hot-reload for the TUI). `dev:vite:live` is the same with the `dev:live` server wiring. I did not verify these two in detail. |
| `bun run dev:desktop` | `bun --cwd packages/desktop dev` | Starts the Electron desktop app in development. |
| `bun run dev:web` | `bun --cwd packages/app dev` | Starts the Vite dev server for the web app. |
| `bun run dev:storybook` | `bun --cwd packages/storybook storybook` | Starts Storybook. |
| `bun run bench:devex` | `bun run --cwd packages/app test:bench:devex` | App developer-experience benchmark (`test:bench:devex` in `packages/app/package.json`: a Bun test plus a Playwright config under `e2e/performance/devex/`). |
| `bun run typecheck` | `bun turbo typecheck --concurrency=3` | Type-checks every package through Turborepo, three at a time. |
| `bun run check` | `bun run lint && bun run typecheck` | The canonical full verification. This is also what the pre-push hook and `check.yml` run. |
| `bun run lint` | `oxlint && ast-grep scan -c script/ast-grep/gui-extensions/sgconfig.yml && bun script/sdk-docs.ts` | Three linters in a row: oxlint (fast JS/TS linter), the GUI-extension ast-grep rules, and the SDK doc-comment check. |
| `bun run lint:changed` | `bun script/lint-changed.ts` | Stricter lint on GUI package files you added or edited since a base ref (default: merge base with `upstream/main`, `origin/main` or `main`). |
| `bun run lint:effect-patterns` | `ast-grep scan -c script/ast-grep/sgconfig.yml packages/util/src packages/core/src packages/server/src packages/protocol/src packages/cli/src` | Effect code-style rules over the backend packages. Not part of `lint`. |
| `bun run lint:effect-simplifications` | `ast-grep scan -c script/ast-grep/effect-simplifications/sgconfig.yml --off=unused-suppression packages` | Suggestions for simplifying Effect code. CI runs it in the unit job. |
| `bun run test:lint-rules` and `bun run test:effect-simplification-rules` | `ast-grep test -c ...` | Tests for the ast-grep rules themselves. |
| `bun run typecheck:profile` and `typecheck:profile:packages` | `bun script/profile-typecheck*.ts` | Timing tools for type checks. |
| `bun run upgrade-opentui` | `bun run script/upgrade-opentui.ts` | Upgrades the OpenTUI libraries pinned in the catalog. |
| `bun run test` | `echo 'do not run tests from root' && exit 1` | A deliberate failure. Tests run per package; see below. |

Why does `test` fail on purpose? There are two layers. The script above prints a message and exits 1. And
`bunfig.toml` points Bun's test root at a folder that does not exist, so a bare `bun test` at the root also finds
nothing. Both exist because each package needs its own working directory, preload file and flags. To run tests:

```sh
cd packages/core
bun run test
```

Full details, per-package commands and a "which command for what" table are in [16-testing.md](16-testing.md).

### Type checking one package

`AGENTS.md` says: during focused iteration run `bun typecheck` from the affected package directory, and never run
`tsc` directly. The reason is that each package's `typecheck` script knows its own `tsc` mode (`tsc -b`,
`tsc --noEmit`, or several project files; `packages/core` checks `tsconfig.json` and `tsconfig.tests.json`).

```sh
cd packages/core
bun typecheck
```

## 5. A first day: run it and check it

```sh
bun install                # once
bun run dev                # the terminal UI from source
bun run dev gpu doctor     # a CLI subcommand from source
bun run check              # lint + type check, takes a while
cd packages/core && bun run test   # that package's tests
```

`ktether gpu doctor` checks the Kaggle CLI, credentials and network and is the quickest way to see the Kaggle
integration respond. A successful run needs real Kaggle credentials; the tests do not.

Two commands help you find where things live:

```sh
bun run dev debug paths    # prints home, data, cache, config, state, tmp, bin, log, repos and db paths
bun run dev debug config   # prints the resolved config (secrets redacted); needs the background server
```

## 6. The conventions in `AGENTS.md`

`AGENTS.md` at the repository root is the rulebook. Humans and coding agents are expected to follow it. This section
summarises it faithfully; when in doubt, the file wins.

### Workflow rules

- After changing the public Protocol or the Server `HttpApi`, run `bun run generate` from `packages/client`. Never
  edit the generated client files by hand.
- Keep the runtime dependency direction described in section 3.
- This repository does not use Changesets. Do not add `.changeset` files; follow the existing release workflow.
- The default branch is `main`. Base branches and worktrees on `origin/main`, target pull requests at `main`, and diff
  against `origin/main` unless told otherwise.

### Live TUI testing

`bun run dev:live` (section 4) tests a worktree's TUI against the elected background server and live sessions. Pass a
directory after it when needed. Prefer it over plain `bun run dev` for that workflow, because a plain run may
implicitly replace the live server when the worktree client's version differs; an explicit `--server` warns and
continues without replacing it.

### TUI stories

When asked for a "TUI story", add a fixture-driven story under `packages/tui/src/feature-plugins/system/storybook` and
register it in that folder's `index.tsx`. Render the real production component, keep side effects local to the story,
expose state dimensions through story keybindings, list them in `StoryFooter`, and add a reset command when
combinations can confuse the fixture. Run one with `KTETHER_STORY=<story-id> bun run dev:live` and try narrow and wide
terminals.

### TUI theme tokens

Choose theme tokens by semantic role, not by colour. Never use raw `theme.hue` values or borrow an unrelated token.
`text.feedback` and `background.feedback` are only for outcome or status feedback (errors, warnings, success, info);
use `formfield` states for form controls and `action` states for actions. If no token fits, extend the theme schema,
defaults, resolution and types first. When you change the public token surface, check the built-in light and dark
defaults and the custom-theme fallback.

### Branch names

At most three words separated by hyphens, no slashes, no `feat/` or `fix/` prefixes. Examples from the file:
`session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

### Commits and pull-request titles

Conventional-commit style: `type(scope): summary`. Valid types are `feat`, `fix`, `docs`, `chore`, `refactor` and
`test`. The scope is optional; use the affected area (for example `core`, `ktether`, `tui`, `app`, `desktop`, `sdk`,
`plugin`). Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`,
`chore(sdk): regenerate types`.

### Style guide

General principles:

- Keep things in one function unless the code is composable or reusable.
- Validate unknown values once, at the boundary that owns them, then pass typed values inward. Do not re-check what a
  schema or constructor already guarantees.
- Do not create single-use helpers up front. Inline unless it is reused, hides a genuinely complex boundary, or has a
  clear independent name.
- Before adding complexity for a speculative or very unlikely race or security edge case, explain the failure mode,
  likelihood and complexity cost to the user and get their agreement.
- Avoid `try`/`catch` and avoid `any`. Prefer Bun APIs such as `Bun.file()`. Rely on type inference. Prefer functional
  array methods (`flatMap`, `filter`, `map`) over `for` loops, with type guards on `filter`.
- In `src/config`, follow the self-export pattern at the top of a module, for example
  `export * as ConfigAgent from "./agent.js"`.
- In Effect generators, bind services to named variables before calling methods; no nested
  `yield* (yield* Foo.Service).bar()`.
- Reduce variable count by inlining values used once:

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()
```

- Destructuring: avoid it; use dot notation (`obj.a`) to preserve context.
- Imports: never alias (`import { foo as bar }` is out), never use star imports, and never use type-position
  `import("...")`. If you need a namespace, import the module's own exported namespace by name
  (`import { Project } from "@ktether/core/project"`, then `Project.ID`). An aliased type import is a last resort when
  two names genuinely collide. Prefer dynamic `import()` for heavy, startup-sensitive modules, with destructured
  bindings near the top of the narrowest scope, and not inline chains like
  `(await import("./x")).value()`.
- Variables: prefer `const`; use ternaries or early returns instead of reassignment.
- Control flow: avoid `else`; prefer early returns.
- Complex logic: make the main function read as the happy path and move supporting detail into small helpers below it,
  such as `requireConfig` or `readMetadata`. Do not return `Effect` from helpers that do no effectful work. Prefer
  `Schema.UnknownFromJsonString` with `Schema.decodeUnknownOption` over `JSON.parse` wrapped in `Effect.try`. Comment
  non-obvious constraints, not obvious assignments.
- Drizzle schemas: use snake_case field names so column names need not be restated as strings.

```ts
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

### Testing rules

- Avoid mocks as much as possible; do not use `globalThis.*` unless it is the only option.
- Test the actual implementation; do not duplicate logic into tests.
- Tests cannot run from the repository root (guard `do-not-run-tests-from-root`); run from package directories such as
  `packages/core`.
- Before writing or changing tests, read the matching skill in `.ktether/skills`: `unit-tests` (bun test),
  `tui-tests` (OpenTUI renderer tests), `app-e2e-tests` (Playwright in `packages/app/e2e`) or `component-tests`
  (Storybook Playwright). See [16-testing.md](16-testing.md).

### Checks

- Run `bun run check` from the repository root as the full lint and type-check verification.
- During focused iteration, run `bun typecheck` from the affected package. Never run `tsc` directly.

### Session Core

These are architecture rules for the session engine in `packages/core/src/session*`. Summarised from `AGENTS.md`:

- **Durable events are minimal.** Record only irreducible new facts; do not repeat state you could derive by folding
  the ordered history. Put derived or previous state into projections and read models instead.
- **Prompt admission is separate from model execution.** `Session.prompt(...)` publishes `session.inbox.enqueued`;
  its projection inserts one durable `session_inbox` row. Only after that is the advisory
  `SessionExecution.wake(sessionID)` scheduled, unless `resume: false` asks for admit-only. Delivery publishes
  `session.inbox.delivered`; its projection consumes the inbox row and inserts the visible message in the same
  transaction. `session_inbox` stores only unconsumed work.
- **IDs are idempotent.** Reusing a Session ID adopts the existing session. Reusing a user or synthetic inbox item ID is
  idempotent when session and type match: the first admission wins and the retried payload, metadata and delivery
  mode are ignored, whether the item is still pending or already delivered. Cross-session or cross-type reuse fails.
  Control items keep their own conflict behaviour.
- **`SessionExecution` is process-global and keyed by Session ID.** It discovers placement through `SessionStore` plus
  `LocationServiceMap.get(session.location)` only when a drain starts. Interrupting a known but idle or locally
  unowned session is a no-op; the public API rejects an unknown session.
- **Location scoping.** `SessionRunner`, model resolution, the tool registry, permissions and the filesystem are
  Location-scoped. An omitted `Location.workspaceID` means implicit-local placement.
- **One step is one `llm.stream` call** that continues from reloaded history. Do not add an in-memory tool loop.
- **Drains are process-local** until clustering exists. `SessionRunCoordinator` joins explicit same-session resumes,
  coalesces prompt wakeups, and lets different sessions run concurrently. A write-ahead execution claim marks a busy
  period for restart recovery: completion, failure or user interruption releases it; shutdown interruption and
  process death keep it, and startup recovery resumes claimed top-level sessions with durable attempt accounting. It
  is a recovery marker, not clustered ownership or exactly-once.
- **Delivery vocabulary.** Prompts steer by default. At safe step boundaries steered compaction goes first (up to the
  first steered move control); other steers keep enqueue order. At an idle boundary steers take priority; otherwise
  exactly one queued item delivers before the runner re-evaluates. Items may be cancelled or changed between queue
  and steer before delivery. New user input resets the selected agent's step allowance (a batch of steers resets it
  once).
- **Vocabulary for steps and turns.** A step is one logical LLM call, and its durable record covers only the
  model-visible span. Do not write "provider turn" and do not use bare "turn" for a single call: "turn" is reserved for
  the future unit containing all steps from prompt promotion until the session would go idle.
- **Event replay ownership** stays separate from clustered session-execution ownership.

## 7. Recipe: add a CLI command

The CLI is built from a declarative "spec" tree plus lazily loaded handlers. The command list lives in
`packages/cli/src/commands/commands.ts`; handlers live in `packages/cli/src/commands/handlers/`; the registry that
connects them is the `Handlers` object in `packages/cli/src/index.ts`. TypeScript forces them to agree: the
`Handlers<Node>` type in `packages/cli/src/framework/runtime.ts` requires one entry per command, so forgetting to
register a handler is a type error.

The existing `gpu` group is a good model. Say you want `ktether gpu ping`.

1. **Declare it.** In `commands.ts`, inside the `Spec.make("gpu", { commands: [ ... ] })` list, add a spec. Parameters
   use `Flag` and `Argument` from `effect/cli`. Reuse `ServerParams` (the `--standalone` and `--server` flags) for
   anything that talks to the server:

```ts
Spec.make("ping", {
  description: "Check that the Kaggle GPU endpoint answers",
  params: ServerParams,
}),
```

2. **Write the handler.** Create `packages/cli/src/commands/handlers/ktether/ping.ts` (the Kaggle commands live in a
   folder called `ktether/`). The default export is a `Runtime.handler` bound to the spec node. Compare the real
   `status.ts`:

```ts
export default Runtime.handler(
  Commands.commands.gpu.commands.status,
  Effect.fn("cli.ktether.status")(function* (input) {
    const client = yield* connect(input)
    const status = yield* Effect.promise(() => client.ktether.status())
    process.stdout.write(formatStatus(status) + EOL)
  }),
)
```

   `connect` (in `handlers/ktether/connection.ts`) resolves the background service or a `--standalone` server and
   builds the typed client. Commands that do not need the server can skip it; for example `debug paths` reads
   `Global.Service` directly.

3. **Register it.** In `packages/cli/src/index.ts`, add the lazy import in the `Handlers` tree, in the same shape as the
   spec tree:

```ts
gpu: {
  // ...
  ping: () => import("./commands/handlers/ktether/ping"),
},
```

4. **Run it.** `bun run dev gpu ping`. `bun typecheck` in `packages/cli` confirms the spec and registry agree.
5. **Test it.** The CLI package's tests live in `packages/cli/test/` and run with `cd packages/cli && bun run test`.
   Parsing and validation should be tested in-process; each real CLI boot costs real time (see the `unit-tests` skill
   and [16-testing.md](16-testing.md)).

If the command needs a new server operation, continue with the next recipe first.

## 8. Recipe: add an HTTP API endpoint, end to end

The ktether GPU endpoints are the worked example. The path of a request is: **protocol** (the contract) -> **server**
(the handler) -> **core** (the logic), and the typed **client** is generated from the contract. Say you add
`GET /api/ktether/ping`.

1. **Define the endpoint in the protocol.** Groups live in `packages/protocol/src/groups/`. Add the endpoint to an
   existing group or create a new one. The real `packages/protocol/src/groups/ktether.ts` shows the pattern:

```ts
.add(
  HttpApiEndpoint.get("ktether.models", "/api/ktether/models", {
    success: Schema.Struct({ data: Schema.Array(KTetherModel) }).annotate({ identifier: "KTetherModelsResponse" }),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "ktether.models",
      summary: "List ktether models",
      description: "Return the curated models that can be served on the Kaggle GPU.",
    }),
  ),
)
```

   Request and response shapes are Effect Schemas. Use `payload:` for a request body and `error: [...]` with the
   shared error classes in `packages/protocol/src/errors.ts` (for example `InvalidRequestError`, `ConflictError`).
   Give every schema an `identifier` annotation, because the generators use it for names.

2. **Register a new group (skip if you only added an endpoint to an existing group).** In
   `packages/protocol/src/api.ts` a group appears in three places. For `KTetherGroup`: the `import` at the top, the
   `ApiGroups` union (`| typeof KTetherGroup`), and the `.add(KTetherGroup)` call in `makeApiFromGroup`. Groups that need
   a project location are wrapped with `.middleware(locationMiddleware)`; the ktether group is global (the handler
   file says these routes "take no location"), so it is added bare.
   Then, in `packages/protocol/src/client.ts`, add the group to `groupNames`, which maps the HTTP group id to the name
   used on the client: `"server.ktether": "ktether"`.

3. **Implement the handler in the server.** Handlers live in `packages/server/src/handlers/`. Create or extend a file
   following `handlers/ktether.ts`:

```ts
export const KTetherHandler = HttpApiBuilder.group(Api, "server.ktether", (handlers) =>
  Effect.succeed(
    handlers.handle(
      "ktether.status",
      Effect.fn("server.ktether.status")(function* () {
        return { data: yield* Effect.promise(() => controller.status()) }
      }),
    ),
  ),
)
```

   Keep handlers thin (the repo's `effect` skill says so): decode, call a core service, map errors. Put the real logic
   in `packages/core/src/`.

4. **Register the handler layer.** In `packages/server/src/handlers.ts`, import it and add it to the
   `Layer.mergeAll(...)` list, as `KTetherHandler` is.

5. **Regenerate the clients.** This is the step that `AGENTS.md` makes mandatory:

```sh
cd packages/client
bun run generate
```

   It runs `script/build.ts`, which compiles `ClientApi` from the protocol and writes the generated files under
   `packages/client/src/promise/generated`, `src/effect/generated` and `src/effect/api`. Never edit those by hand.
   Separately, `packages/protocol` has its own `bun run generate` that rewrites `packages/protocol/openapi.json`, and
   `bun run check:generated` there compares it. `AGENTS.md` does not mention the protocol step and CI does not run the
   protocol check (CI's "Check generated client" step runs the client's `check:generated`), but the committed
   `openapi.json` goes stale if you skip it. I did not verify whether anything else consumes `openapi.json`.

6. **Use it from the CLI (or TUI).** The generated promise client exposes `client.<group>.<method>()`. In the existing
   code the endpoint `ktether.status` in group `ktether` is called as `client.ktether.status()`. Build the client with
   `KTether.make({ baseUrl, headers })`, which the `connect` helper does for you.

7. **Test it.** `packages/server/test/ktether.test.ts` calls the real handler stack through `ServerFetch.make({ ... })`
   with `new Request("http://ktether.local/api/ktether")`, an isolated home directory and the fake Kaggle CLI. Copy that
   structure. Run with `cd packages/server && bun run test`.

8. **Check.** `bun run check` from the root. CI also runs the client's `check:generated`, which regenerates and then
   fails if `git diff` shows changes under the three generated folders.

## 9. Recipe: add a provider plugin

Providers are plugins in `packages/core/src/plugin/provider/`. The list of built-in ones is `ProviderPlugins` in
`packages/core/src/plugin/provider.ts`: `KTetherPlugin`, `LMStudioPlugin`, `OllamaPlugin`, `OpenAIPlugin`,
`PromptCacheKeyPlugin`, `VLLMPlugin`, `XAIPlugin` and `DynamicProviderPlugin`. A comment there says OpenAI and xAI
remain only because realtime voice sessions need their credentials.

**Case A: a local OpenAI-compatible server** (like vLLM, Ollama, LM Studio). This is the easy case. Copy
`packages/core/src/plugin/provider/vllm.ts`, which is about 30 lines:

```ts
export const make = createLocalProviderPlugin({
  id: "ktether.provider.vllm",
  providerID: "vllm",
  name: "vLLM",
  origin: "http://127.0.0.1:8000",
  discover: (client) => Effect.gen(function* () { /* GET /health, GET /v1/models */ }),
  model: (item) => ({ id: item.id, context: item.max_model_len }),
})
export const VLLMPlugin = make()
```

`createLocalProviderPlugin` lives in `local.ts` and handles polling the server and registering discovered models.

**Case B: a provider with fixed models and its own client package** (like the Kaggle one). `ktether.ts` in that folder
is the example: a plugin built with `define({ id, effect })` from `@ktether/plugin/effect/plugin`, which calls
`ctx.provider.transform(...)` to register the provider (`provider.package = "@ktether/ai/providers/ktether"`) and its
models. The package named there lives in `packages/ai/src/providers/ktether.ts` and resolves the endpoint and API key
at request time.

Steps for either case:

1. Create `packages/core/src/plugin/provider/<name>.ts` and export the plugin.
2. Import it in `packages/core/src/plugin/provider.ts` and add it to the `ProviderPlugins` array.
3. If it needs a new wire protocol or provider package, that belongs in `packages/ai/src/providers/` and
   `packages/ai/src/protocols/` (not in core). `packages/ai/AGENTS.md` lists the principles: accept unknown provider
   values forward-compatibly, keep one canonical model, stay independent of sessions, and reuse protocols with
   `Route.make(...)`.
4. Add a test next to the existing `packages/core/test/plugin/provider-*.test.ts` files. They use
   `testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))` from `packages/core/test/lib/effect.ts` and
   `packages/core/test/plugin/fixture.ts`.
5. Provider plugins can also be configured by users without code, through the `providers` key of the config file;
   see [15-configuration.md](15-configuration.md).

`CONTRIBUTING.md` says new providers should rarely need ktether changes and should be added to models.dev first.
That is upstream advice; ktether now ships its own model list and fetches a remote catalog only when
`KTETHER_MODELS_URL` is set (`packages/core/src/models-dev.ts`).

## 10. Recipe: add a model to the Kaggle registry

The curated list of models that can run on the Kaggle GPU is `AVAILABLE_MODELS` in
`packages/core/src/ktether/registry.ts`. Each entry is a `ModelSpec` (id, display name, Hugging Face repo and file,
size, context per slot, parallel slots, minimum VRAM, whether tool calling is reliable, and so on). The default is
`DEFAULT_MODEL = "qwen3.6-27b"`.

The field meanings, how to size a model for two T4 GPUs, and the checklist for adding one are in
[06-models.md](06-models.md). The Kaggle pipeline that consumes the registry is in
[04-kaggle-pipeline.md](04-kaggle-pipeline.md). Because `KTetherPlugin` iterates `AVAILABLE_MODELS`, a new entry
automatically appears as a model of the `kaggle` provider and in `ktether gpu models` and `GET /api/ktether/models`.

## 11. Line endings, formatting and generated files

This repository is developed on Windows too. On the machine this guide was written on, Git's system config has
`core.autocrlf=true`, so Git converts between LF in the repository and CRLF in your working files automatically.
What that means in practice:

- `.editorconfig` asks editors for LF. If your editor writes CRLF into a new file, Git normalises it on commit and may
  warn "LF will be replaced by CRLF". The warning is harmless.
- `.gitattributes` forces `eol=lf` for a few paths regardless of `autocrlf`: `packages/core/src/**/*.txt` (prompt
  templates and similar) and `packages/httpapi-codegen/test/generated/*.ts`. It also marks migration snapshots,
  `migration.gen.ts` and `models-dev/snapshot.txt` as generated for diff purposes.
- The generated client is verified by `bun run check:generated` in `packages/client`, which regenerates the files and
  runs `git diff --exit-code` over `src/promise/generated`, `src/effect/generated` and `src/effect/api`. If your
  checkout converts line endings differently from how the files were committed, that comparison could in theory show
  noise. I did not verify how `check:generated` behaves with CRLF on Windows; CI only runs it on Linux (the step has
  `if: runner.os == 'Linux'` in `test.yml`).
- Format code with `bun run script/format.ts` (Prettier over the whole repo). `.prettierignore` still lists paths such
  as `packages/client/src/generated/`, which no longer match the generated folders, so Prettier may reformat
  `packages/client/src/promise/generated` unless something else excludes it. I did not verify this; do not hand-format
  generated files, regenerate them instead.
- Shell scripts and anything run by `sh` must stay LF. The `dev:live` script is inline in `package.json`, so this only
  matters for new scripts you add.

## 12. Working with Git here

- Branch names: at most three words, hyphen separated, no prefixes (section 6).
- Commit messages and PR titles: `type(scope): summary`.
- The pull-request template (`.github/pull_request_template.md`) asks for an issue link, type of change, what the PR
  does and how you verified it, with a checklist. It warns that large AI-generated descriptions may be closed.
- Never skip the pre-push hook. If it fails, run `bun run check` and fix what it reports.
- Do not add `.changeset` files; this repository does not use Changesets.

## 13. Things that look stale or wrong

Collected while writing this guide, so you do not trip over them:
  `services/www`, a directory that does not exist. That CI step cannot succeed as written.
- `script/publish.ts` (the inherited release flow, unused so far) still checks out a `dev` branch; adapt it before
  publishing a release.
- `CONTRIBUTING.md` says Bun 1.3 or newer; `package.json` pins 1.4.2 and the pre-push hook enforces `^1.4.2`.
- `package.json` `repository.url` and several `README`/`CONTRIBUTING` links point at `anomalyco/ktether`, the
  upstream organisation, while `origin` is `premsuggu/ktether`.
- `perf/test-suite.md` refers to `packages/ktether` and the scripts `bench:test`, `profile:test`; none exist.
- `.opencode/` still exists on disk beside `.ktether/`, with its own `package.json`, `package-lock.json` and
  `node_modules`. The ktether-named config folder is `.ktether/`.
- `packages/effect-drizzle-sqlite/` has no `package.json`, only an `examples/` folder.
- `packages/app/README.md` still describes deployment with SST to `beta.ktether.ai`; I did not verify any of it still
  applies.
- The `$schema` URL inside `.ktether/ktether.jsonc` and `.ktether/tui.json` points to
  `https://raw.githubusercontent.com/premsuggu/ktether/main/schema/config.json` (and `tui.json`); there is no `schema/`
  folder in this checkout. See [15-configuration.md](15-configuration.md).
- `package.json` has `"description": "AI-powered development tool"`, the generic upstream text.

## 14. Quick reference

| I want to... | Do this |
| --- | --- |
| Install everything | `bun install` (root) |
| Run the TUI from source | `bun run dev` |
| Run a CLI subcommand from source | `bun run dev gpu doctor` |
| Test against my live background server | `bun run dev:live` |
| See where ktether keeps files | `bun run dev debug paths` |
| Lint and type-check everything | `bun run check` |
| Type-check one package | `cd packages/<pkg> && bun typecheck` |
| Run one package's tests | `cd packages/<pkg> && bun run test` |
| Regenerate the API client after a protocol change | `cd packages/client && bun run generate` |
| Refresh the OpenAPI document | `cd packages/protocol && bun run generate` |
| Format everything | `bun run script/format.ts` |
| Add a model to the Kaggle registry | Edit `packages/core/src/ktether/registry.ts`, see [06-models.md](06-models.md) |
