# ktether documentation

These pages explain ktether from scratch. They assume you are a smart beginner: no prior knowledge of AI coding
agents, GPUs, tunnels, monorepos or the libraries used. Each page defines its terms and points to the code.

New here? Read **1, 2 and 3**, then follow whatever you need.

## Using ktether

| # | Page | You will learn |
| --- | --- | --- |
| 1 | [Overview](01-overview.md) | What ktether is, the problem it solves, and the vocabulary |
| 2 | [Getting started](02-getting-started.md) | Set up Kaggle, install, start a GPU, use the agent, stop it |
| 6 | [Models](06-models.md) | The model list, the evidence behind the default, adding a model |
| 7 | [CLI reference](07-cli-reference.md) | Every command and option |
| 9 | [Terminal UI](09-tui.md) | The UI, the GPU dialog and the slash commands |
| 17 | [Troubleshooting](17-troubleshooting.md) | Symptoms, causes and fixes |

## How it works

| # | Page | You will learn |
| --- | --- | --- |
| 3 | [Architecture](03-architecture.md) | The processes, the data flow, the state machine |
| 4 | [The Kaggle pipeline](04-kaggle-pipeline.md) | What happens, step by step, from `gpu start` to a working model |
| 5 | [Security model](05-security.md) | What is protected, how, and the known gaps |
| 8 | [HTTP API](08-api-reference.md) | The `ktether` routes |
| 18 | [Design decisions](18-design-decisions.md) | Why it is built this way, with the evidence and the mistakes |

## Understanding the repository

| # | Page | You will learn |
| --- | --- | --- |
| 10 | [Repository map](10-repo-map.md) | Every package: purpose, contents, dependencies |
| 11 | [Core concepts](11-core-concepts.md) | Sessions, tools, permissions, plugins, providers, config, events, the API layers |
| 12 | [Clients and UI](12-clients-and-ui.md) | The CLI, terminal UI, apps and the supporting UI packages |
| 13 | [The AI library](13-ai-library.md) | How a request becomes an HTTP call to a model, and how to add a provider |

## Working on it

| # | Page | You will learn |
| --- | --- | --- |
| 14 | [Development guide](14-development.md) | Setup, scripts, conventions, step-by-step recipes |
| 15 | [Configuration](15-configuration.md) | Config files, directories, environment variables |
| 16 | [Testing](16-testing.md) | The test setup, helpers, fakes, and which command to run |
| 19 | [Glossary](19-glossary.md) | Every term in one place |

## A note on accuracy

The pages were written from the code and checked against real runs on Kaggle's GPUs, and several were reviewed
against the source by separate readers. Where something could not be verified the page says so ("I did not verify
this"). Pages 10 to 16 describe a large inherited codebase (ktether is a fork of OpenCode) and flag, near their ends,
leftovers from upstream that are dormant or stale. If a page and the code disagree, trust the code and please fix the
page.

## Conventions

- `ktether ...` is the installed command. In a source checkout, run it as `bun run dev ...`.
- Paths are relative to the repository root unless they start with `~` (your home directory).
- Diagrams use [Mermaid](https://mermaid.js.org); GitHub renders them.
