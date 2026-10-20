# @ktether/ai

The LLM client library behind ktether. It turns an agent request (messages, tool definitions, options) into the HTTP
call a model server understands, and turns the streamed reply back into typed events.

## What it contains

| Directory | Contents |
| --- | --- |
| `src/schema/` | Request, message, tool and event types |
| `src/route/` | Routes: a protocol + an endpoint + authentication, and the request pipeline |
| `src/protocols/` | Wire formats: OpenAI chat and responses, OpenAI-compatible chat and responses, xAI responses, Open Responses, Anthropic Messages, OpenAI images |
| `src/providers/` | Ready-made provider packages (below) |
| `src/experimental/` | The realtime (voice) client for OpenAI and xAI |
| `src/tool-runtime.ts` | Runs tools requested by the model |

## Providers

| Package | Use |
| --- | --- |
| `providers/ktether` | The Kaggle GPU provider. Resolves its address and key from the saved session. |
| `providers/openai-compatible` (+ `/responses`) | Any server that speaks the OpenAI API: llama.cpp, vLLM, Ollama, LM Studio, your own. |
| `providers/openai` | OpenAI (used by realtime voice). |
| `providers/xai` | xAI (used by realtime voice). |

Hosted-vendor providers that earlier versions carried were removed; ktether is for models you run on a GPU you own or
borrow.

## Learn more

- [docs/13-ai-library.md](../../docs/13-ai-library.md): the concepts, a step-by-step walkthrough of one request, and how
  to add a provider or a protocol.
- [docs/04-kaggle-pipeline.md](../../docs/04-kaggle-pipeline.md): how the Kaggle provider gets its address.

## Tests

Run from this directory: `bun test --timeout 30000`, and `bun run typecheck`. Recorded-HTTP tests replay cassettes
from `test/fixtures/recordings`; see [docs/16-testing.md](../../docs/16-testing.md).
