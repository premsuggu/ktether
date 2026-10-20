# 16. Testing

How testing works in the ktether repository: which test runner is used, how each package runs its tests, why tests
cannot be started from the repository root, the helper libraries (including the fake Kaggle CLI, fake relay and fake
clock that let the Kaggle pipeline be tested without a GPU), recorded HTTP "cassettes", snapshot tests, terminal-UI
renderer tests, browser (Playwright) tests, Windows pitfalls, and a table of "which command do I run for what".

Every statement below was checked against the repository. No pass counts are given on purpose: the number of tests
changes constantly, and I did not run the suite while writing this guide. Where I could not verify something, the
text says "I did not verify this".

ktether (lowercase) is a fork of the MIT-licensed OpenCode project. Related guides: the developer workflow in
[14-development.md](14-development.md), configuration and environment variables in
[15-configuration.md](15-configuration.md), and the Kaggle pipeline that most ktether-specific tests exercise in
[04-kaggle-pipeline.md](04-kaggle-pipeline.md).

## 1. The test runner: `bun test`

Almost every package uses **Bun's built-in test runner**, invoked as `bun test`. It is Jest-compatible in style: you
import `describe`, `test`, `expect`, `beforeEach`, `afterEach` from `bun:test`.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
```

Test files end in `.test.ts` or `.test.tsx` and live in a `test/` folder next to `src/` (core, cli, tui, server, ai,
and others) or sit beside the source file they test (`util`, `ui`, `app/src`, `gui-extensions`, `merman`).

Two other kinds of runner exist, both for browsers:

- **Playwright** (`@playwright/test`) drives a real Chromium browser for the web app: end-to-end tests
  (`packages/app/e2e`) and Storybook-based component tests (`packages/app/component-tests`,
  `packages/session-ui/component-tests`).
- **happy-dom** (a fake browser DOM written in JavaScript) is loaded as a preload by some `bun test` suites that need
  `document` and `window` without a real browser (`packages/app/happydom.ts`).

The repo-specific rules about tests are in `AGENTS.md` and, in much more detail, in four "skills" under
`.ktether/skills/`: `unit-tests`, `tui-tests`, `component-tests` and `app-e2e-tests` (plus an `effect` skill with a short
testing section). `AGENTS.md` says to read the matching skill before writing or changing tests. This guide summarises
them; the skills are the full source.

### The `AGENTS.md` testing rules

- Avoid mocks as much as possible; do not use `globalThis.*` unless it is the only option.
- Test the actual implementation; do not duplicate logic into the test.
- Tests cannot run from the repository root; run them from a package directory such as `packages/core`.

## 2. Why tests cannot run from the repository root

If you type `bun test` or `bun run test` at the root, it will fail on purpose. Two guards cooperate:

1. The root `package.json` script:

   ```json
   "test": "echo 'do not run tests from root' && exit 1"
   ```

2. The root `bunfig.toml`:

   ```toml
   [test]
   root = "./do-not-run-tests-from-root"
   ```

   A bare `bun test` then looks for tests in a folder that does not exist, finds none, and does not run anything.

The reason is that each package needs its own setup, and there is no single configuration that fits them all:

| Difference | Examples |
| --- | --- |
| Different **working directory** | Cassette recorders default to `process.cwd()/test/fixtures/recordings` (`packages/http-recorder/src/cassette/store.ts`), so running from the wrong folder looks in the wrong place. |
| Different **preload files** (code Bun runs before the tests) | `packages/core/bunfig.toml` preloads `./test/preload.ts`; `packages/tui` and `packages/cli` preload `@opentui/solid/preload`; `packages/app` preloads `./happydom.ts`. |
| Different **flags and timeouts** | 30-second timeouts in some packages, 5 seconds in others; `--isolate` and `--conditions` flags in `packages/app`. |
| A **custom runner** | `packages/core` runs `bun run script/test.ts`, which sets up a throwaway home directory and strips secrets from the environment (section 4). |

The one correct way to run several packages from the root is Turborepo, which runs each package's *own* `test` script
in its own directory: `bun turbo test` (CI uses `bun turbo test --affected --concurrency=3`). Turbo discovers every
workspace package that has a `test` script, so a new suite is picked up automatically, but only if you give the
package a `test` script (the `unit-tests` skill says a package with test files and no `test` script "never runs in
CI"). `turbo.json` also has a `transit` task that runs nothing and exists only to include every workspace
dependency in the test cache hash.

## 3. How each package runs its tests

Run these from the package's own directory. The scripts come from each `package.json`.

| Package | `bun run test` runs | Notes |
| --- | --- | --- |
| `core` | `bun run script/test.ts` | Custom runner (section 4); adds `--only-failures --timeout=30000`. Extra arguments are forwarded. |
| `cli` | `bun test --timeout 30000 --only-failures` | Many tests spawn real CLI processes. |
| `tui` | `bun test --timeout 30000 --only-failures` | OpenTUI renderer tests (section 9). |
| `server` | `bun test --only-failures` | Default 5 s timeout. |
| `client` | `bun test --timeout 5000` | Also has `check:generated` (below). |
| `protocol` | `bun test --only-failures` | Also `check:generated` for `openapi.json`. |
| `schema`, `util`, `plugin` | `bun test --only-failures` | Default timeout. |
| `ai` | `bun test --timeout 30000 --only-failures` | Cassette-based provider tests (section 7). `typecheck` also checks `tsconfig.types.json`. |
| `http-recorder` | `bun test --timeout 30000 --only-failures` | Tests of the recorder itself. |
| `httpapi-codegen` | `bun test --timeout 5000 --only-failures` | Code generator for the client. |
| `sdk` | `bun test --timeout 5000` | Also a `verify:package` task that CI runs. |
| `simulation`, `theme`, `latex`, `merman` | `bun test --timeout 30000 --only-failures` | |
| `codemode`, `gui-extensions`, `plugin-browser`, `script` | `bun test` | Default timeout. |
| `desktop` | `bun test --timeout 30000` | Not cached by Turborepo (`@ktether/desktop#test` in `turbo.json`). |
| `ui` | `bun test src --only-failures` | Tests live beside the source under `src/`. |
| `session-ui` | `bun test src --only-failures` | Plus `test:components` (Playwright, section 10). |
| `app` | `bun run test:unit && bun run test:browser` | See below. |
| `storybook` | none (only `build`) | Hosts the component tests of `app` and `session-ui`. |

`--only-failures` makes Bun print only the failing tests, which keeps the output of large suites readable.
"Default timeout" means Bun's own 5 000 ms per test; the `unit-tests` skill lists which packages use which.

### `packages/app` in detail

```text
test:unit    bun test --conditions=solid --only-failures --isolate --preload ./happydom.ts ./src
test:browser bun test --conditions=browser --isolate --preload ./happydom.ts ./test-browser
test:components  playwright test --config playwright.components.config.ts
test:e2e         playwright test
test:e2e:built   PLAYWRIGHT_BUILD=1 playwright test
```

`--isolate` runs each test file in a fresh module registry. The `unit-tests` skill explains why only `app` uses it: it
makes the unit run several times slower, and in the other packages state is kept clean in a different way (section 6).
Do not add `--isolate` (or a bare `--parallel`, which implies it) to another package's script.

Other `app` scripts exist for performance and stability checks (`test:stability`, `test:bench`, `test:bench:devex`).

### Generated-file checks

Two packages have a `check:generated` script, which regenerates a file and fails if it differs from what is committed:

- `packages/client`: `bun run generate && git diff --exit-code -- src/promise/generated src/effect/generated src/effect/api`
- `packages/protocol`: `bun run script/generate-openapi.ts --check` (compares `openapi.json`)

CI runs the client's check on Linux only. These are not unit tests, but they fail a pull request if you forgot to
regenerate after changing the API (see the endpoint recipe in [14-development.md](14-development.md)).

## 4. Running core tests: `packages/core/script/test.ts`

Core is the biggest suite and uses a small wrapper instead of plain `bun test`. What it does (read the file; it is
about 60 lines):

1. Creates a fresh temporary directory (`oc-` prefix; a leftover from upstream naming) and, inside it, a `tmp`
   folder.
2. Builds a **cleaned environment** for the child process: it copies `process.env` but removes any variable whose name
   starts with a cloud or provider prefix (`AWS_`, `AZURE_`, `GOOGLE_`, `GCP_`, `GCLOUD_`, `VERTEX_`, `OPENAI_`,
   `ANTHROPIC_`, `GEMINI_`, `XAI_`, `CLOUDFLARE_`, `CF_AIG_`, `SNOWFLAKE_`, `AICORE_`, `GITLAB_`, `NPM_CONFIG_`) and
   any variable whose name ends in `API_KEY`, `AUTHORIZATION`, `TOKEN`, `SECRET`, `PASSWORD` or `CREDENTIAL(S)`.
   (An exception: `OPENAI_API_KEY` is kept when `RECORD=true`.) This means a test cannot accidentally use your real
   keys, and a developer's keys cannot change a test's result.
3. Points `HOME`, `KTETHER_TEST_HOME`, the four `XDG_*` variables, `KTETHER_CONFIG_DIR` and `TMPDIR` (plus
   `USERPROFILE`, `TMP`, `TEMP` on Windows) into the temporary directory, and unsets `KTETHER_CONFIG` and
   `KTETHER_CONFIG_CONTENT`. So tests never read or write your real config, data or state.
4. Runs `bun test --only-failures --timeout=30000 <your arguments>` as a child process, forwarding `SIGINT` and
   `SIGTERM`, and exits with its exit code.

The default 30-second timeout exists because some tests (for example those that install Git packages) exceeded
Bun's 5-second default on Windows CI.

Running a single file or test in core:

```sh
cd packages/core
bun run script/test.ts test/ktether/lifecycle.test.ts
bun run script/test.ts test/ktether -t "stops"        # -t filters by test name (a Bun option)
```

(`bun run test test/ktether/...` also works because Bun forwards arguments to the script, which forwards them to
`bun test`. I did not verify `-t` through this wrapper; it is a standard `bun test` option.)

In addition, `packages/core/bunfig.toml` preloads `packages/core/test/preload.ts`, which sets two environment
variables for every core test:

```ts
process.env.KTETHER_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
```

So the database is in memory unless a test overrides it, and `npm` operations do not run audits.

If you run `bun test` directly in `packages/core` instead of the wrapper, the preload still applies, but the HOME
isolation and secret scrubbing do not. Prefer the wrapper.

## 5. Effect tests: `packages/core/test/lib/effect.ts`

Most of core is written with [Effect](https://effect.website), a TypeScript library for typed, composable programs.
Its tests use the helper in `packages/core/test/lib/effect.ts` (other packages import it by relative path, for
example `../../core/test/lib/effect`; `packages/ai` has its own copy at `packages/ai/test/lib/effect.ts`).

```ts
import { it } from "../lib/effect"

it.effect("does something", () =>
  Effect.gen(function* () {
    // ...
  }),
)
```

What the two entry points do:

| Helper | Clock | Use for |
| --- | --- | --- |
| `it.effect(name, body)` | Effect's `TestClock`: time is virtual and moves only when the test adjusts it | Anything timing-based that you can drive deterministically (timeouts, retries, debounces) |
| `it.live(name, body)` | The real clock | Filesystem, git, child processes, sockets, locks, real time |
| `testEffect(layer)` | Same, with your layer added | Tests that need services. `testEffect(layer).effect` and `.live` work like the above. |

`.only` and `.skip` variants exist on both. Both run the body inside `Effect.scoped`, so resources acquired in the test
are released at the end.

**Offline by construction.** The helper installs a `fetch` replacement that rejects any request to a host other than
loopback (`127.0.0.1`, `localhost`, `[::1]`). Such a request is also recorded, and the test fails with a message
"test attempted network request: GET https://... - provide an explicit HttpClient or disable the fetch", even if the
production code swallowed the error. This is why a unit test cannot silently phone home.

**Gotcha with `TestClock`.** Under `it.effect`, a sleep never finishes unless the test advances the clock, and an
Effect `timeout` around real I/O never fires. The `unit-tests` skill says: fork the effect first, then adjust the
clock; use `it.live` when real processes, sockets or file events drive the result. Helpers in
`packages/core/test/lib/clock.ts` (`advance(condition)` and `drain`) alternate one real 1 ms macrotask with
500 ms virtual adjusts so debounced work can complete.

### Other core helpers and fixtures

Under `packages/core/test/`:

| Path | What it gives you |
| --- | --- |
| `lib/` | `effect.ts` (above), `clock.ts`, `environment-conformance.ts`, `image.ts`, `instructions.ts`, `permission.ts`, `project.ts`, `session-message.ts`, `tool.ts`, `websearch.ts`, `websocket-server.ts` |
| `fixture/tmpdir.ts` | `tmpdir()` (use with `await using`), `tmpdirScoped`, `withTempDir`. On Windows, removal retries up to 30 times on `EBUSY` and forces a garbage collection, because open handles block deletion. |
| `fixture/git.ts` | `initGit` and `initRepo` create repos with the minimum number of `git` processes (each process costs real time on Windows). |
| `fixture/env.ts` | `withEnv` to set environment variables for the duration of a test and restore them. |
| `fixture/` (others) | Fake MCP servers, config nodes, location, models, policy, a Windows PTY helper, and more. |
| `fixtures/recordings/` | Recorded HTTP cassettes for core (for example `session-runner/`), see section 7. |
| `plugin/fixture.ts` | `PluginTestLayer`, used by the provider plugin tests. |

`packages/core/src/config.ts` exports `Config.testLayer(initial)`, an in-memory config service with `setEntries` and
`emitChange`, so tests of config consumers do not need real files.

## 6. Testing the Kaggle pipeline without a GPU: `packages/core/test/ktether/`

The ktether-specific tests live in `packages/core/test/ktether/` and all use one helper file, `helpers.ts`. It
replaces every external thing the pipeline touches with a small fake:

| Helper | What it fakes | How |
| --- | --- | --- |
| `isolateHome()` | The user's home directory | Creates a temporary directory and points `USERPROFILE` and `HOME` at it; also sets `KAGGLE_USERNAME=tester` and `KAGGLE_KEY=not-a-real-key`. Returns `{ dir, restore }`; `restore()` puts every variable back and deletes the directory. |
| `installFakeKaggle(statuses)` | The `kaggle` command-line tool | Calls `setCliRunner(...)` from `packages/core/src/ktether/kaggle.ts`, which swaps the function that spawns `kaggle`. The fake records every argument list in `calls`, answers `--version`, returns the scripted `statuses` for `kernels status` (the last one repeats), and handles `push`, `delete` and `output`. `uninstallFakeKaggle()` restores the real runner. |
| `createFakeRelay()` | The ntfy relay and the llama server | An object whose `fetch` can be passed to the code under test. It records POSTs to control topics in `posted`, serves the published messages for long-poll URLs, answers `/health` according to a `healthy` set of hosts, and `/slots` with a two-slot answer. `publish(key, payload)` makes the "kernel" publish a signed message. `failPolls` makes polling fail. |
| `createFakeClock()` | Real time | `{ now, sleep, advance }`: a clock that only moves when the code sleeps. A test that sleeps for 10 minutes finishes instantly. |
| `answeringKernel(relay, clock, tunnelURL)` | The Python kernel on Kaggle | A `sleep` replacement: after the code has pushed a launch and saved its pending session, the next sleep makes the fake kernel publish a signed `starting` and a signed `ready` message with the given tunnel URL. |
| `envelope(key, payload)` | The signed message format | Wraps a payload as `{ p, s }` where `s` is the HMAC signature from the real `sign` function. |

The key design idea: the production code takes its Kaggle runner, its `fetch`, its clock and its home directory as
injectable values, so the *real* lifecycle code runs in the test with only the outside world replaced. Typical test
setup, from `lifecycle.test.ts`:

```ts
beforeEach(() => {
  home = isolateHome()
  kaggle = installFakeKaggle(["RUNNING"])
  relay = createFakeRelay()
  lines = []
})
```

and a matching `afterEach` that calls `uninstallFakeKaggle()` and `home.restore()`.

The suite files:

| File | What it covers (by name; open the file for detail) |
| --- | --- |
| `lifecycle.test.ts` | Start, stop, clean, reconnect and doctor flows |
| `controller.test.ts` | The in-process controller behind the HTTP routes (operation progress, conflict and unknown-model errors) |
| `session.test.ts`, `state.test.ts` | Session handling and the saved state and usage files |
| `signaling.test.ts` | Signing and verifying messages, stop messages |
| `bundle.test.ts` | Rendering the kernel bundle |
| `kernel-script.test.ts` | Runs the **generated Python kernel script** with Python and checks that what Python signs is what TypeScript verifies, and the reverse |
| `kernel-behaviour.test.ts` | Runs the Python kernel server logic with scenarios |

The two `kernel-*.test.ts` files start `python` (or `python3`) with `-I` (isolated mode, so no stray modules are
imported). If no Python is found they are **skipped**, not failed, through `describe.skipIf(!python)`. Install Python 3
if you want those to run.

Other tests that use the same helpers:

- `packages/server/test/ktether.test.ts` calls the real HTTP handler stack through `ServerFetch.make({ ... })` with
  an isolated home and the fake Kaggle CLI; it checks, for example, that `GET /api/ktether` never leaks secrets.
- `packages/core/test/plugin/provider-ktether.test.ts` and `packages/core/test/tool-ktether.test.ts` cover the
  provider plugin and the ktether tool.
- `packages/tui/test/component/dialog-ktether.test.tsx` covers the GPU dialog in the terminal UI.

**Where the state file goes in tests.** The saved Kaggle session lives at `~/.local/state/ktether/session.json`,
computed from `os.homedir()`. That is why `isolateHome()` changes `HOME` and `USERPROFILE` (what `os.homedir()` reads)
instead of `XDG_STATE_HOME`. If you write a new Kaggle test, use `isolateHome()` or your test will read and write your
real session file. Always restore in `afterEach`.

## 7. Cassettes: recorded HTTP tests (`packages/ai`, `packages/http-recorder`)

Provider code talks to real APIs. To test it without keys or network, ktether records real exchanges once and replays
them afterwards. A recording is called a **cassette** (the idea comes from the Ruby "VCR" library).

- The recorder is the package `@ktether/http-recorder` (`packages/http-recorder`). Its layers (`layerFetch`,
  `layer`, `layerWebSocketConstructor`, `layerSocket`) wrap an HTTP or WebSocket client and either record or replay.
- A cassette is a JSON file: a `version`, `metadata` (model, tags such as `provider:google`, `protocol:openai-chat`,
  `recordedAt`) and an ordered list of `interactions`, each with a `request` (method, URL, headers, body) and a
  `response` (status, headers, body).
- Provider cassettes live in `packages/ai/test/fixtures/recordings/<prefix>/<name>.json`, one file per scenario, for
  example `openai-compatible-chat/togetherai-streams-text.json`. Core has its own under
  `packages/core/test/fixtures/recordings/` (for example `session-runner/`).

### Replay is the default

Replay needs no API keys and no network. The rules, from `packages/http-recorder/src/replay/state.ts`
and the package README:

| Situation | Behaviour |
| --- | --- |
| Cassette exists | Replay it. |
| Cassette missing, `CI` unset | Record it by calling the real service. |
| Cassette missing, `CI` set (not empty, `false` or `0`) | Replay mode, so the test fails because the cassette is missing. CI never records. |

For the `ai` package's own "recorded" test groups (`packages/ai/test/recorded-runner.ts`), the logic is slightly
different: a test whose cassette is missing is **skipped** when not recording, and recording only happens when you ask
for it with `RECORD=true`.

### Recording a cassette

From `packages/ai/AGENTS.md`: unset `CI`, run with `RECORD=true`, and provide the provider's API key. Re-record only
the cassette you are changing, because recordings contain volatile identifiers that create noisy diffs.

```sh
cd packages/ai
# bash: unset CI so the recorder does not refuse; set the key the group requires
unset CI
RECORD=true OPENAI_API_KEY=sk-... bun test test/provider/<file>.test.ts
```

(The exact key variable depends on the group's `requires` list. A test group whose required variables are missing is
skipped while recording. I did not run a recording, so treat the command line as the pattern, not a tested recipe.)

You can narrow which recorded tests run with these environment variables, all read in
`packages/ai/test/recorded-utils.ts`; each takes a comma-separated list:

| Variable | Selects |
| --- | --- |
| `RECORDED_PREFIX` | Test groups by their cassette prefix |
| `RECORDED_PROVIDER` | Tests tagged `provider:<name>` |
| `RECORDED_TAGS` | Tests that carry every listed tag |
| `RECORDED_TEST` | Tests whose name or cassette name contains the text |

Two safety nets protect you from committing secrets. The recorder redacts sensitive headers, and
`packages/http-recorder/src/redaction/secrets.ts` scans what it is about to write for common secret shapes (Bearer
tokens, `sk-` keys, Anthropic keys, Google keys, AWS access keys, GitHub tokens, private keys) and also for the *values*
of environment variables whose names look like secrets (names containing `API`, `AUTH`, `KEY`, `PASSWORD`, `SECRET`,
`TOKEN`, and so on, with a value of at least 12 characters). A finding fails the recording.

The core test `packages/core/test/session-runner-recorded.test.ts` follows the same pattern with a single cassette
(`session-runner/openai-chat-streams-text`), and refuses to record when `CI` is set.

## 8. Snapshot tests

A snapshot test stores the expected output in a file (or inline in the test) and fails when the output changes.

- **Terminal frame snapshots.** `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx` renders a component at a
  fixed size and calls `.toMatchSnapshot()` on the captured frame text. The stored files are in
  `packages/tui/test/cli/tui/__snapshots__/`.
- **Inline snapshots.** `packages/merman/src/sequence/diagram.test.ts` and `.../state/diagram.test.ts` use
  `toMatchInlineSnapshot(...)`, so the expected text lives in the test file.
- **Generated-output checks** (`check:generated`, section 3) act like snapshot tests for generated files.

To accept an intentional change, Bun has an update flag (`bun test --update-snapshots`). I did not run it here. Review
the diff of the snapshot file as carefully as code: a snapshot you did not read proves nothing. Always pass a fixed
`width` and `height` when rendering terminal frames, otherwise the size depends on your terminal (the `tui-tests`
skill: "Always pass `width` and `height`").

## 9. Terminal UI tests (`packages/tui`, `packages/cli`)

These render the real OpenTUI components (the terminal-UI library the TUI is built on) into an in-memory terminal and
make assertions on the text frames. Read `.ktether/skills/tui-tests/SKILL.md` before writing one; the main points:

- **Pick the renderer mode.** For component logic use `testRender(() => <X />, { width, height })` *without*
  `start()`: change state, `await app.renderOnce()`, then assert on `captureCharFrame()`. For the whole app use
  `createAppFixture` (`packages/tui/test/fixture/app.ts`), which starts a renderer with `kittyKeyboard: true`, an
  in-process `Bun.serve` fake server (`createFetch`/`createEventStream` in `fixture/tui-client.ts`), and a temporary
  directory; await `setup.ready` before the first wait.
- **Frame budgets are not time.** `waitForFrame` and friends give up after a number of rendered frames (default 20), not
  after a duration. A started renderer renders at about 30 frames per second in tests (60 in production), so 20 frames
  is about two thirds of a second. Wait on frames only for things a frame produces; for fetches and timers wait on the
  signal itself (a deferred response, or a wall-clock poll with a deadline).
- **Keyboard and mouse.** Use `setup.mockInput` (`pressKey`, `typeText`, `pressEnter`, `pressEscape`, `pressArrow`,
  `pasteBracketedText`). Create renderers with `kittyKeyboard: true`; without it `mockInput` silently sends different
  keys (for example `pressKey("u", { ctrl: true, shift: true })` arrives as `ctrl+u`).
- **Sizes.** Always give `width` and `height`; cover narrow and wide, for example `test.each([100, 44])`. After
  `setup.resize(w, h)`, `await setup.renderOnce()` before asserting.
- **Clocks.** Prefer injecting OpenTUI's `ManualClock` and `renderer.pause()` over fake global timers.
- **Cleanup.** Destroy the renderer and stop the fixture server in `finally` or with `await using`; remove the temporary
  directory last. A timed-out test body keeps running in Bun and can break the next test, so triage the first failure
  in a file.
- **Do not measure speed.** Count mounted rows or rendered lines instead of asserting `performance.now()` thresholds.

The TUI also has a manual "story" mechanism (not an automated test) for exploring components:
`KTETHER_STORY=<story-id> bun run dev:live`; see [14-development.md](14-development.md).

## 10. Browser tests: Playwright

### App end-to-end tests (`packages/app/e2e`)

Documented in `packages/app/README.md` ("E2E Testing") and `.ktether/skills/app-e2e-tests/SKILL.md`. They run the
real web app in Chromium but against an in-memory mock of the server API (`mockKTetherServer` in
`e2e/utils/mock-server.ts`), not against a real backend. A request the mock does not answer fails the test with a 501
and "Unmocked API request".

```sh
cd packages/app
bunx playwright install chromium     # once
bun run test:e2e:local                # dev server, from source
bun run test:e2e:local -- --grep "settings"
bun run test:e2e:built                # production build served statically, like CI
```

Environment options, from the README: `PLAYWRIGHT_BUILD=1` (build and serve `dist`; always on when `CI` is set),
`PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (dev fixture API address, default `127.0.0.1:4096`),
`PLAYWRIGHT_PORT` (managed server port, default `3000`) and `PLAYWRIGHT_BASE_URL` (use an already running app; this
skips server start-up and building). Test directories: `e2e/regression`, `e2e/user-story`, `e2e/reproduction`,
`e2e/service-worker` (its own config), `e2e/performance`, with shared helpers in `e2e/utils`. `packages/app/e2e/AGENTS.md`
defines what to test, locators and assertions.

Key advice from the skill: navigate once per test (each page load is a cold load of the production bundle), do not add
per-file service-worker blocking (it is already blocked suite-wide), wait for state not time, prefer Playwright's
`page.clock` over real waits, and build pages with the helpers (`mockWorkspace`, `openSession`, `setupTimeline`, ...).

### Component tests (Storybook + Playwright)

Documented in `packages/storybook/playwright/README.md` and `.ktether/skills/component-tests/SKILL.md`. A Storybook dev
server (Vite) hosts "stories", which are small isolated renderings of real components with in-page mock data and no
backend. Specs mount a story by id and assert on it.

```sh
cd packages/session-ui
bun run test:components
bun run test:components -- component-tests/session-timeline.spec.ts
bun run test:components:ui            # Playwright's interactive UI

cd ../app
bun run test:components
```

`packages/storybook/playwright/config.ts` starts Storybook on port `6006` (override with `PLAYWRIGHT_STORYBOOK_PORT` or
`PLAYWRIGHT_STORYBOOK_URL`), uses 2 workers and 2 retries in CI, and *reuses* any server already answering on that port
when not in CI, which can serve stale code from another checkout; set the port variable to be sure. A comment in that
config notes that Storybook runs on Node rather than Bun 1.4.2 because of a Bun `node:http` crash (fixed in Bun 1.4.3,
per the comment).

These Playwright suites are separate from each package's default `test` script on purpose (CI runs them in the `e2e`
job in `.github/workflows/test.yml`).

## 11. Windows pitfalls

CI runs the unit job on both Linux and Windows (`blacksmith-4vcpu-windows-2025`), and Windows is the slower and more
failure-prone leg. The `unit-tests` skill collects what has gone wrong. The most useful points for a newcomer:

| Pitfall | What to do |
| --- | --- |
| Process spawns are slow (about 40 ms per Git for Windows process, per the skill's estimate) | Count spawns; use `fixture/git.ts` helpers; keep real-process tests to one or two per behaviour |
| Tests that wait on real time time out only on Windows | Control time (`TestClock`, injected clocks, `jest.useFakeTimers()` from `bun:test` outside Effect) instead of sleeping |
| Never "fix" a sleep with a bigger timeout, `--retry` or `skipIf(win32)` | Remove the wait. Skip on Windows only when the platform lacks the capability (for example symlinks), and say why in a comment |
| `os.tmpdir()` reads `TEMP` on Windows and `TMPDIR` on POSIX | Set both for child processes; compare paths with `fs.realpathSync.native` (expands 8.3 short names like `RUNNER~1`) |
| Open handles block deleting a temp directory (`EBUSY`) | Close watchers, databases and child processes before removing the directory; use the `tmpdir` fixtures |
| Renaming onto a file another process holds open fails | Close handles the test holds |
| SIGTERM cannot be caught: `process.kill` ends the process at once with exit code 1 | Assert per platform (see `packages/client/test/fixture/service-fixture.ts`) |
| Ephemeral ports in 49152+ can be taken by any process, so "bind the freed port again" is flaky | Assert that nothing accepts connections instead; bind port `0` rather than hard-coding ports |
| Wall-clock assertions (`performance.now()` thresholds) fail on slow runners | Count operations or assert only the result |
| `mock.module` leaks between files in non-isolated suites | Provide dependencies through a test layer; do not use it |
| Python-based kernel tests do not run | They skip without `python`/`python3`; on Windows the Microsoft Store stub can answer `--version` without being a real interpreter. I did not verify that case. |
| Line endings | `core.autocrlf` converts files in your working copy. `.gitattributes` forces LF for a few paths such as `packages/core/src/**/*.txt` and `packages/httpapi-codegen/test/generated/*.ts`. I did not verify whether CRLF changes any test result. |

One more thing I noticed (not from the skill): the unit job in `test.yml` sets `KTETHER_EXPERIMENTAL_DISABLE_FILEWATCHER`
on Windows, but the server reads `KTETHER_FILEWATCHER_DISABLE` and `KTETHER_DISABLE_FILEWATCHER`
(see [15-configuration.md](15-configuration.md)); the CLI test helper `isolatedEnv` sets `KTETHER_DISABLE_FILEWATCHER`.

## 12. Spawned CLI tests

The CLI tests start real `bun run src/index.ts` processes. Each boot costs about 1.3 s of CPU per the skill, so most
validation is tested in-process and only one or two subprocess tests exist per file. Spawned processes use the
`isolatedEnv(root)` helper from `packages/cli/test/fixture/environment.ts`, which gives them an isolated home and
XDG directories, a private database, `KTETHER_CONFIG_CONTENT="{}"`, `KTETHER_DISABLE_FILEWATCHER`,
`KTETHER_DISABLE_MODELS_FETCH`, and a shared Bun transpiler cache (so each process does not re-transpile the source):

```ts
HOME: root,
KTETHER_CONFIG_DIR: path.join(root, "config"),
KTETHER_DB: path.join(root, "ktether.db"),
KTETHER_DISABLE_FILEWATCHER: "true",
KTETHER_DISABLE_MODELS_FETCH: "true",
KTETHER_TEST_HOME: root,
```

Compiled-binary and service lifecycle coverage runs separately in CI via `packages/cli/script/service-smoke.ts`
(the `build` job in `test.yml`). Do not copy tests that set only `XDG_CACHE_HOME` without a transpiler cache path (the
skill names `upgrade.test.ts` and `debug-paths.test.ts` as examples to avoid).

## 13. Writing a new test: a checklist

1. Pick the right kind: unit (`bun test`), Effect (`it.effect` or `it.live`), cassette, TUI renderer, Playwright
   e2e, or component test. Read the matching skill in `.ktether/skills/`.
2. Put the file where the package keeps its tests, and make sure the package has a `test` script (so CI runs it).
3. Use fresh temporary directories and restore environment variables and fakes in `afterEach` or scoped finalizers.
   For anything touching Kaggle state, use `isolateHome()`.
4. Control time. Do not add `Bun.sleep`, `setTimeout` or `Date.now() + ...` waits.
5. Do not use `mock.module` or `globalThis` mocks. Use a layer, a parameter the product already has, or a fake like the
   Kaggle helpers.
6. Run the file alone, then repeat it to catch flakiness, using options from the skill: `bun test <file> --rerun-each
   10`, `--randomize`, and `--seed=<n>` to reproduce an ordering failure. In core, go through `script/test.ts`.
7. Run the whole package, then `bun typecheck` in the package, then `bun run check` from the root.

## 14. Which command do I run for what

| I changed / want to check | Run (from the directory shown) |
| --- | --- |
| Core engine, sessions, tools, config | `packages/core`: `bun run test` |
| One core test file | `packages/core`: `bun run script/test.ts test/<path>.test.ts` |
| Kaggle pipeline (lifecycle, controller, signaling) | `packages/core`: `bun run script/test.ts test/ktether` |
| The Python kernel script and its signing | same as above; needs `python` or `python3` |
| HTTP handlers for `/api/ktether/*` | `packages/server`: `bun run test` (or `bun test test/ktether.test.ts`) |
| The protocol or the generated client | `packages/protocol`: `bun run test` and `bun run check:generated`; `packages/client`: `bun run test` and `bun run check:generated` |
| A CLI command | `packages/cli`: `bun run test` |
| Terminal UI components | `packages/tui`: `bun run test` |
| Provider/LLM protocol code | `packages/ai`: `bun run test` (replays cassettes) |
| Re-record one provider cassette | `packages/ai`: unset `CI`, `RECORD=true` plus the key, narrow with `RECORDED_TEST` |
| Web app logic | `packages/app`: `bun run test` (`test:unit` + `test:browser`) |
| Web app flows in a browser | `packages/app`: `bun run test:e2e:local` or `test:e2e:built` |
| Shared UI components in a real browser | `packages/session-ui` or `packages/app`: `bun run test:components` |
| Desktop app | `packages/desktop`: `bun run test` |
| Types for one package | that package: `bun typecheck` |
| Everything lint + types | repo root: `bun run check` |
| Every package's tests, the way CI does | repo root: `bun turbo test` (add `--affected` to limit to changed packages) |
| "Why does `bun test` at the root fail?" | It is supposed to; see section 2 |

## 15. Things that look stale or wrong

- `perf/test-suite.md` describes benchmark scripts (`bench:test`, `profile:test`) for a `packages/ktether` package that
  no longer exists.
- The `unit-tests` skill and some tests still contain upstream names (a core test directory prefix `oc-`, a mention of a
  `function` package that is not in this repository). They are harmless but may confuse a search.
- The `unit-tests` skill quotes timings and flake census numbers from upstream CI history; they describe upstream's
  suite, not necessarily ktether's today.
- `.github/workflows/test.yml` runs a "Check generated documentation" step in `services/www`, which does not exist, so
  that step cannot pass as written.
- `KTETHER_EXPERIMENTAL_DISABLE_FILEWATCHER` in `test.yml` is set on Windows but not read by the server (section 11).
- The `http-recorder` README shows Vitest examples, but the package's own tests run with `bun test`.
