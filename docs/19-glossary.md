# 19. Glossary

Plain-language definitions of the terms used across the documentation, alphabetically.

| Term | Meaning |
| --- | --- |
| **Agent** | The loop around a model: send a prompt, receive a request to use a tool, run it, send the result back, repeat. In ktether it also means a named configuration (prompt, tools, permissions) the loop runs with. |
| **API key (`kgp_...`)** | The random secret that protects the tunnel. Generated on your machine for each launch; sent only as a bearer token to the tunnel. |
| **Background service** | A long-lived ktether server the CLI starts on demand and reuses. Managed with `ktether service`. |
| **Bearer token** | A secret sent in an HTTP header (`Authorization: Bearer ...`) that proves you may use a service. |
| **Boot stage** | A milestone of the notebook's start-up: `binaries`, `model_download`, `server_ready`, `tunnel`. |
| **Bun** | The JavaScript runtime and package manager this repository uses. |
| **Bundle (staging folder)** | The temporary folder holding the notebook's code and metadata for one push. Deleted right after. |
| **Cassette** | A recorded HTTP exchange replayed in tests so they need no network. |
| **Channel (id)** | The name of the relay topic for one launch: `kt_` plus 128 random bits. |
| **Cloudflare quick tunnel** | A free, account-less way to give a local program a public `https://...trycloudflare.com` address. |
| **cloudflared** | Cloudflare's tunnel program, run inside the notebook. |
| **Context window** | The number of tokens a model can consider in one request. |
| **Controller** | The ktether code that runs start/stop/clean/reconnect in the background and keeps a progress log. |
| **CORS** | A browser rule limiting which websites may call a server. ktether trusts only local origins by default. |
| **CRLF** | Windows line endings; this checkout converts to them via Git's `autocrlf`. |
| **Effect** | The TypeScript library the engine is built on for typed errors, dependency injection and concurrency. |
| **Event / projection** | A recorded fact about a session and the database rows derived from it. |
| **Flash attention (`-fa`)** | A memory-efficient way to compute attention; enabled on the server. |
| **GGUF** | The single-file model format `llama.cpp` loads. |
| **GPU** | A graphics card used as a fast number cruncher. Kaggle offers machines with two Tesla T4s. |
| **Generation** | The model writing its reply, one token at a time (about 12 tokens/s for the default model on two T4s). |
| **HMAC / signature** | A short code computed from a message and a secret, proving the sender knew the secret. |
| **Idle timeout** | Minutes of inactivity after which the notebook stops itself (default 45). |
| **Integration** | A third-party service with stored credentials (for example a web search provider). |
| **Jinja chat template** | The model's own recipe for turning messages and tool definitions into the text it expects. `--jinja` makes the server use it; tool calling needs it. |
| **Kaggle** | A data-science website owned by Google that offers free notebooks with GPUs. |
| **KV cache** | Memory in which the model remembers the conversation so far; grows with context. |
| **Kernel / notebook** | A program running on Kaggle's machine. ktether pushes one, privately, named `ktether-runner`. |
| **llama.cpp / llama-server** | The program that loads a GGUF model and serves it over an OpenAI-compatible HTTP API. |
| **Location** | A project directory (and optional workspace) the engine works in. |
| **MCP** | Model Context Protocol: a standard for plugging external tool servers into an agent. |
| **Mermaid** | The text format used for the diagrams in these docs. |
| **Model picker** | The UI list from which you choose the model, written as `provider/model`. |
| **Monorepo / workspace** | One repository holding many packages that depend on each other. |
| **ntfy.sh** | The public publish/subscribe service used as the relay. |
| **OpenAI-compatible** | An HTTP API shaped like OpenAI's chat completions; many servers, including `llama-server`, speak it. |
| **Operation** | One background job (`start`, `stop`, `clean`, `reconnect`) with a log and a result. |
| **Package scope (`@ktether/*`)** | The prefix of the workspace packages' names. |
| **Permission** | The agent's request for your approval before it runs a command or edits a file. |
| **Plugin** | An extension (internal or external) that adds providers, tools, commands or behaviour. |
| **Prefill** | The model reading the whole prompt before it starts answering. |
| **Prompt cache** | The server reusing the processed start of a prompt, making repeat turns fast. |
| **Protocol (in `packages/ai`)** | The wire format of one kind of model API (for example OpenAI chat). |
| **Provider** | A source of models. ktether's own is `kaggle`. |
| **Quantization (Q4_K_M)** | Storing a model's numbers with fewer bits so it is smaller, at a small quality cost. |
| **Queue (QUEUED)** | Kaggle's state while it has not yet assigned a machine to your notebook. |
| **Reasoning budget** | The cap on a thinking model's "thinking" tokens per request. |
| **Registry** | The curated model list in `packages/core/src/ktether/registry.ts`. |
| **Relay** | The public message board used only to announce the tunnel address and progress. |
| **Route (in `packages/ai`)** | The pairing of a protocol, an endpoint and authentication that sends a request. |
| **Schema (Effect)** | A description of a data shape used to validate and decode untrusted input. |
| **Session (agent)** | A conversation with the agent: its messages, steps and state. |
| **Session (GPU)** | One launch of the Kaggle GPU, saved in `session.json`. |
| **Signing key** | The random 256-bit secret used to sign relay messages; never transmitted. |
| **Skill** | A reusable instruction file the agent can load for a task. |
| **Slot** | One simultaneous request the model server can work on. |
| **SSE (server-sent events)** | The streaming format used to deliver tokens as they are produced. |
| **Step / turn** | One logical model call / the whole span from a prompt until the session idles. |
| **Thinking model** | A model that reasons in text before answering (Qwen3.6 is one). |
| **Token** | A chunk of text, about three quarters of a word. |
| **Tool** | A function the agent can run for the model: read, edit, search, shell, and so on. |
| **Tool calling** | The model asking for a tool in a structured, machine-readable way. |
| **Tunnel** | See Cloudflare quick tunnel. |
| **TUI** | Terminal user interface: the full-screen text UI. |
| **VRAM** | The GPU's memory. The model must fit in it to run quickly. |
