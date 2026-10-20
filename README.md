# ktether

**Run a coding agent on a free Kaggle GPU.**

ktether is a terminal-first AI coding agent that reads and edits your code, runs commands, and talks to an
open-source language model that is hosted on **Kaggle's free dual Tesla T4 GPUs** instead of a paid API. Your
repository never leaves your machine; only prompts and completions travel, over an authenticated, encrypted tunnel.

```text
 Your machine                                   Kaggle (free GPU)
┌───────────────────────────┐   HTTPS tunnel   ┌─────────────────────────────────────┐
│  ktether agent (TUI / CLI)│ ───────────────► │  llama.cpp server                   │
│  reads/edits files, runs  │ ◄─────────────── │  Qwen3.6-27B (or another model)     │
│  git, tests, builds       │   prompts and    │  2 × Tesla T4 = 30 GB of GPU memory │
└───────────────────────────┘   completions    └─────────────────────────────────────┘
```

> **Status: early but working.** The Kaggle pipeline, the CLI, the terminal UI and the HTTP API are implemented and
> tested, and the whole path has been exercised end to end on real Kaggle GPUs. The web and desktop apps are kept in
> the repository but have **not** been adapted to the Kaggle workflow yet. See [Limitations](#limitations).

ktether is a fork of [OpenCode](https://github.com/sst/opencode) (MIT licensed), trimmed down to one purpose:
running open models on GPUs you own or borrow. See [License](#license).

## Why

Strong coding models need 16–32 GB of GPU memory to run well. Most laptops have far less, and hosted agents cost
$20–$50 a month or more. Kaggle gives every verified account roughly **30 free GPU hours per week**, including a
machine with two T4 GPUs (30 GB combined). That quota usually goes unused. ktether turns it into a private,
on-demand inference server and wires it into a full agent.

## What you get

- **A model on a free GPU.** One command provisions a Kaggle notebook, installs `llama.cpp`, downloads the model,
  starts a server, and opens a tunnel. The default model is **Qwen3.6-27B** (4-bit), which fits across both T4s and
  calls tools reliably.
- **A real agent.** Read, edit, search, shell, web fetch, sessions, permissions, skills, MCP servers and plugins,
  from a terminal UI or a scriptable CLI.
- **Your own hardware works too.** Point the agent at Ollama, LM Studio, vLLM, or any OpenAI-compatible server.
- **Careful quota use.** The GPU stops itself after 45 idle minutes, stops before Kaggle's 12-hour session cap, and
  `ktether gpu status` shows an estimate of the GPU hours you have used this week.
- **Secure by design.** No secret is ever sent through the signalling relay, every control message is signed, and
  the tunnel is protected by a per-session API key. Details in [docs/05-security.md](docs/05-security.md).
- **Controllable from anywhere.** The same operations are available from the CLI, the terminal UI (`/ktether`),
  and the HTTP API, so future apps can use them.

## How it works, in one minute

1. `ktether gpu start` writes a small Python program and pushes it to Kaggle as a private notebook with a GPU.
2. The notebook downloads `llama.cpp`, `cloudflared` and the model, then starts `llama-server` and a Cloudflare
   quick tunnel. Nothing needs to be opened on your network.
3. The notebook tells your machine the tunnel address through a public message relay. The message is signed with a
   key that only you and the notebook know, so a stranger cannot forge it.
4. Your machine saves the session. The agent's `kaggle` provider reads the saved address and API key whenever it
   makes a request.
5. `ktether gpu stop` sends a signed stop command; the notebook shuts down and your quota stops draining.

The full story, with diagrams, is in [docs/03-architecture.md](docs/03-architecture.md) and
[docs/04-kaggle-pipeline.md](docs/04-kaggle-pipeline.md).

## Requirements

| Need | Why |
| --- | --- |
| [Bun](https://bun.sh) (the version pinned in `package.json`) | Runs and builds the project |
| Git | Source checkout, and the agent's repository tools |
| A Kaggle account with a **verified phone number** | GPU notebooks require verification |
| The Kaggle CLI (`pip install kaggle`) and `~/.kaggle/kaggle.json` | ktether pushes the notebook with it |
| Internet access to `ntfy.sh`, `huggingface.co`, GitHub and Cloudflare | Signalling, model download, tunnel |

`ktether gpu doctor` checks all of this and tells you what is missing.

## Quick start

```bash
git clone https://github.com/premsuggu/ktether.git
cd ktether
bun install

# 1. Check your setup
bun run dev gpu doctor

# 2. Start the free GPU (takes about 5 minutes once Kaggle gives you a machine)
bun run dev gpu start

# 3. Open the agent in a project folder and talk to it
bun run dev
#    then pick the model  kaggle/qwen3.6-27b  in the model picker

# 4. When you are done, stop the GPU so the quota is not wasted
bun run dev gpu stop
```

Prefer a one-shot, scriptable run?

```bash
bun run dev run --model kaggle/qwen3.6-27b "Explain what packages/core/src/ktether/registry.ts does"
```

Step-by-step instructions with troubleshooting are in [docs/02-getting-started.md](docs/02-getting-started.md).

## Everyday commands

| Command | What it does |
| --- | --- |
| `ktether gpu doctor` | Check the Kaggle CLI, credentials and network |
| `ktether gpu models` | List the curated models, with sizes and whether they call tools reliably |
| `ktether gpu start [--model <id>]` | Provision the GPU; resumes a launch that is already queued |
| `ktether gpu status` | State, endpoint health, boot stages, slot usage, weekly GPU-hour estimate |
| `ktether gpu reconnect` | Re-attach after the tunnel was replaced |
| `ktether gpu stop [--delete]` | Stop the session (optionally delete the notebook too) |
| `ktether gpu clean --yes` | Delete the `ktether-runner` notebook from Kaggle (previews without `--yes`) |
| `ktether` | Open the terminal UI |
| `ktether run "<prompt>"` | Run the agent once from a script |

Inside the terminal UI, `/ktether` shows the GPU dialog and `/ktether-start` and `/ktether-stop` control it.
The full reference is in [docs/07-cli-reference.md](docs/07-cli-reference.md).

> `bun run dev` is the root script that runs the CLI from source. A packaged `ktether` binary is built by the
> `packages/cli` build script, but there is no release channel yet.

## Models

| Model | Size | Agent-ready? | Notes |
| --- | --- | --- | --- |
| **`qwen3.6-27b`** (default) | 16.8 GB | **Yes** | Structured tool calls on every test; split across both T4s |
| `qwen2.5-coder-14b` | 9 GB | No | Fast, good at code, but echoes tool schemas instead of calling tools |
| `qwen2.5-coder-32b` | 19.8 GB | Untested, likely no | Larger Qwen2.5 coder |
| `qwen2.5-coder-7b` | 7.7 GB | No | Very fast, not for tool use |

Why these, how they are configured, and how to add another: [docs/06-models.md](docs/06-models.md).

## Limitations

Please read these before relying on ktether:

- **Speed.** On two T4s, Qwen3.6-27B generates about 12 tokens per second. The first turn of a session processes
  a large prompt cold (about 70 seconds for ~11,000 tokens); later turns reuse the cache and are fast.
- **Start-up time.** A start takes roughly 4.5–5 minutes once Kaggle assigns a GPU, plus any queue time.
- **Quota and limits.** Kaggle's weekly GPU quota and its 12-hour session cap apply. Kaggle does not expose the
  remaining quota to its CLI, so ktether shows its own usage estimate. **You are responsible for following
  Kaggle's terms of use**; check that your usage is permitted.
- **The tunnel is a free quick tunnel.** It has no uptime guarantee. ktether restarts it and tells you the new
  address (`ktether gpu reconnect`), but a long outage can interrupt a session.
- **Apps are not adapted.** `packages/app` and `packages/desktop` are retained as future clients, but their provider
  screens still contain dormant logic inherited from upstream's hosted services.
- **No release channel yet.** Run from source. `ktether upgrade` tells you so rather than contacting anyone.
- **Windows.** The project is developed on Windows too. A handful of upstream tests that depend on global
  configuration discovery fail on Windows; see [docs/16-testing.md](docs/16-testing.md).
- **Optional features need third-party keys.** Realtime voice needs an OpenAI or xAI key, and web search needs an
  Exa or Firecrawl key. They are unrelated to the Kaggle GPU.

## Project layout

```text
packages/
  schema/ util/ protocol/    shared types, helpers and the HTTP API definition
  core/                      the agent engine, plus the Kaggle pipeline in src/ktether/
  server/                    the HTTP API server
  client/ sdk/               generated API client and the embeddable SDK
  ai/                        the LLM client library (routes, protocols, providers)
  cli/ tui/                  the command line and the terminal UI
  app/ desktop/ ui/ ...      web and desktop clients (retained, not adapted yet)
docs/                        the documentation (start at docs/README.md)
```

A guided tour of every package is in [docs/10-repo-map.md](docs/10-repo-map.md).

## Documentation

Start at **[docs/README.md](docs/README.md)**. It is written for newcomers and explains the product, the Kaggle
pipeline, the security model, every package, and how to develop and test.

## Contributing

Read [docs/14-development.md](docs/14-development.md) and `AGENTS.md`. Use conventional commit titles
(`type(scope): summary`), run `bun typecheck` in the package you changed, and run tests from the package directory,
never from the repository root.

## License

MIT. ktether is a fork of OpenCode, Copyright (c) 2025 opencode, and keeps the original license and notice in
[LICENSE](LICENSE). Changes made by this project are released under the same license.
