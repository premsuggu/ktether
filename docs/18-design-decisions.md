# 18. Design decisions and the evidence behind them

This page records why ktether is the way it is, including the mistakes that taught us. Each entry says what was
decided, what was observed, and what it means for you. Dates are not given because the order matters more than the
calendar.

## 18.1 Native integration instead of a wrapper script

**Decision.** Make Kaggle a first-class provider inside the agent, with commands, an API and a UI, rather than a
separate script that edits config files.

**Why.** A wrapper outside the editor cannot show progress in the UI, cannot be driven by other clients, and
drifts out of sync with the agent's configuration. A provider plus a controller behind an HTTP API gives the CLI,
the terminal UI and future apps the same behaviour.

## 18.2 Why a relay (ntfy.sh) and a tunnel (Cloudflare)

**Problem.** The notebook has no public address, and Kaggle does not stream a notebook's output while it runs.
**Decision.** Use two free, account-less public services: a **relay** for announcements, and a **quick tunnel** so
the model server is reachable.
**Consequence.** No port forwarding, no domain, no accounts beyond Kaggle. The cost is that both are untrusted and
unguaranteed, which drove the security design in 18.7.

## 18.3 The config must be inside the one uploaded file

**Observed.** An early start timed out after 600 seconds. The notebook's log showed the programs downloaded in under
80 seconds, then a `KeyError` right before the model download.
**Cause.** `kaggle kernels push` uploads only the single code file. The configuration had been written as a second
file that never reached Kaggle, so the script crashed on a missing key and exited silently.
**Decision.** Embed the configuration in `server.py` itself, report any exception to the laptop with its reason, and
make the laptop poll Kaggle's notebook status so a dead notebook is reported in seconds, not after the timeout.

## 18.4 Context, slots and "exceeds the available context size"

**Observed.** With the first working server, every agent request failed with `request (10893 tokens) exceeds the
available context size (8192 tokens)`.
**Cause.** The server ran `-c 16384 -np 2`. `llama-server` divides the context evenly across slots, so each slot had
8,192 tokens, but the agent's instruction prompt plus tool definitions is about 11,000 tokens. The terminal UI did
not display the error, so it looked like a silent failure.
**Decision.** Store the context **per slot** in the registry and multiply by the slot count (32,768 x 2 = `-c 65536`).
Always pass `--jinja` (the model's own chat template), which tool calling needs.

## 18.5 Which model: an experiment, not a preference

| Model | Tool calls (raw test) | Full agent |
| --- | --- | --- |
| Qwen2.5-Coder-14B (Q4) | **0 of 4** structured; echoed `<tools>` text | Printed pseudo-JSON, executed nothing |
| Qwen3.6-27B (Q4_K_M) | **3 of 3** structured `tool_calls` | Called Read, answered correctly, repeatedly |

The server and template were verified fine (tool support reported, tool-call tags present), so the 14B model itself
is the limit. Qwen3.6-27B is the default. A `toolCalling` flag in the registry makes the distinction visible to users.

## 18.6 Two slots and a reasoning budget: a hang that was not a hang

**Observed.** With the 27B model, the agent sometimes produced nothing for minutes and then reset.
**Method.** A logging proxy between the agent and the tunnel, a replay of the exact captured request with curl and with
Bun's `fetch` (both fine), and a replay of the agent's *two concurrent requests*.
**Finding.** The agent sends a small "title" request beside the real one, with no token limit. A thinking model
streamed 448 KB of reasoning for 130 seconds on that title. With one slot, the real request waited behind it with no
bytes flowing, and the tunnel closed the idle connection (about 100 seconds), producing `ECONNRESET`.
**Decision.** Two slots, and `--reasoning-budget 4096` to bound runaway thinking. The proxy runs had succeeded only
because the real request happened to win the race, which is why the failure looked intermittent.
**Lesson.** When a request fails only sometimes, look for a second concurrent request.

## 18.7 Security: the relay is hostile

**Observed risk.** The first design posted the tunnel URL **and the API key** to a public topic named with 48 random
bits. Anyone who learned the topic could read the key, or post a forged "ready" that pointed the agent (and its
prompts and key) at a server they controlled.
**Decision.** (1) Never send the API key: the laptop generated it and already has it. (2) Sign every notebook message
and every stop command with HMAC-SHA256 using a key that exists only on the laptop and in the private notebook.
(3) Use 128-bit topic names. (4) Validate the announced address (`https://*.trycloudflare.com`). (5) Include a
timestamp in stop commands and accept them only within ten minutes.
**Verified on a live notebook.** A plain `STOP` and a malformed signed one were posted; the server stayed healthy. A
signed stop ended it. Unsigned requests to the tunnel got HTTP 401.
Details: [05-security.md](05-security.md).

## 18.8 Do not cache the model; do download it in parallel

**Question.** Is the 17 GB download the slow part of a start?
**Measured.** Not on its own: about 115 MB/s, and it overlaps the installs. After parallelising, a boot is 4.5 to 5
minutes, of which loading the model onto the GPUs (138 to 153 s) is the largest stage.
**Decision.** Run the download in a thread alongside the program installs, and add per-stage timings so the next
question can be answered with data. Do **not** build a Kaggle-dataset cache: it would save under two minutes and
add a resource to manage and clean.

## 18.9 A bigger batch size did not help

`-ub 2048 -b 2048` was tested against the default for prefill speed on the real 11,354-token agent prompt:
156 tokens/s against 169. No gain, so it was reverted. Prefill on two T4s is bounded by the hardware.

## 18.10 The provider id is `kaggle`, not `ktether`

**Observed.** The rename from OpenCode to ktether mapped the upstream hosted provider's id (`opencode`) onto
`ktether`. A pile of inherited logic keyed on that id (free-model ordering, console login and upsell screens, a
protocol special case) would then have applied to **our** provider by accident.
**Decision.** Name our provider `kaggle` (it names the backend) and remove the pieces of inherited logic outside the
app UI. The remaining dormant UI logic keyed on the old ids is now inert because no provider has those ids.
**Lesson.** A mechanical rename can change meaning. The rename was verified by typechecking, running every suite
and comparing against the baseline, and it still needed several semantic repairs (see 18.11).

## 18.11 Things the rename got wrong, and the repairs

| What | Fix |
| --- | --- |
| The external npm package `@opencode-ai/pty` and the vite plugin `@brendonovich/vite-plugin-opencode` were renamed | Restored; they are third-party names |
| A protection token containing the word being replaced was itself corrupted | Token renamed so it cannot match |
| Identifiers (`OpenCode.make`) became lowercase prose forms | Rules made context-aware for code |
| Self-export lines (`export * as OpenCode`) and destructuring lists | Handled explicitly |
| Recorded audio fixtures that really say "OpenCode" | Restored; recordings are data |
| Hand-drawn diagram labels whose box widths depend on text | Restored |
| A default CORS allowance for `*.opencode.ai` became `*.ktether.ai`, a domain we do not own | Removed: no remote origin is trusted by default |
| A "free models" ordering keyed on the old provider id | Removed |

## 18.12 What was deliberately not built

- A Kaggle-dataset model cache (18.8).
- A web/desktop UI for the GPU: the API exists and the terminal UI uses it, but the apps were not adapted.
- A release channel and installer: `ktether upgrade` reports that none is configured.
- Checksum verification of the downloaded programs (a known gap, see [05-security.md](05-security.md)).
- Anything that works around Kaggle's quotas or verification.
