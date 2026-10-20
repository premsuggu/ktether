# 6. Models

ktether ships a small, curated list of models that are known to fit on Kaggle's two T4 GPUs. This page explains the
list, the evidence behind the default, how the numbers work, and how to add a model.

The list lives in **one file**, `packages/core/src/ktether/registry.ts`. The CLI (`ktether gpu models`), the HTTP API
(`GET /api/ktether/models`), the model picker (through the `kaggle` provider plugin) and the kernel configuration are
all generated from it, so adding a model there is the only code change needed.

## 6.1 The curated models

| Id | Model | File (Hugging Face) | Size | Context per slot x slots | Reasoning cap | Tool calling |
| --- | --- | --- | --- | --- | --- | --- |
| **`qwen3.6-27b`** (default) | Qwen 3.6 27B | `unsloth/Qwen3.6-27B-GGUF` / `Qwen3.6-27B-Q4_K_M.gguf` | 16.8 GB | 32,768 x 2 | 4,096 tokens | **reliable** |
| `qwen2.5-coder-14b` | Qwen 2.5 Coder 14B | `Qwen/Qwen2.5-Coder-14B-Instruct-GGUF` / `...q4_k_m.gguf` | 9.0 GB | 32,768 x 2 | none | unreliable |
| `qwen2.5-coder-32b` | Qwen 2.5 Coder 32B | `Qwen/Qwen2.5-Coder-32B-Instruct-GGUF` / `...q4_k_m.gguf` | 19.8 GB | 16,384 x 1 | none | unreliable (untested) |
| `qwen2.5-coder-7b` | Qwen 2.5 Coder 7B | `Qwen/Qwen2.5-Coder-7B-Instruct-GGUF` / `...q8_0.gguf` | 7.7 GB | 32,768 x 2 | none | unreliable |

"Reliable" and "unreliable" are about **structured tool calling**, which is what lets the agent act: the model must
reply with a machine-readable "call this tool with these arguments", not just prose. An agent without it cannot read
or edit files. `ktether gpu start` warns if you choose an unreliable model, and the model picker marks it as not
tool-capable.

## 6.2 Why Qwen3.6-27B is the default

This was decided by experiment, not by reputation.

**Qwen2.5-Coder-14B failed.** With the correct server settings (`--jinja`, a context large enough for the agent's
prompt), a request with a standard `tools` definition returned the tool call as **text** instead of a structured
call. The reply was `<tools>{"name": "glob", ...}</tools>`, copying the schema's tag instead of making a call.
It did this on **4 of 4** requests, including with a low temperature. The server and chat template were fine (the
server reported tool support, and the template contains the tool-call tags); the model itself does not do this
reliably at this size and quantization. In the full agent it produced a block of pseudo-JSON that executed nothing.

**Qwen3.6-27B worked.** Under the same test it returned a proper `tool_calls` entry on **3 of 3** requests, and in
the full agent it called its Read tool, received the file and answered correctly, repeatedly, across several launches.

The cost is speed. A 27B model across two T4s generates about **12 tokens per second** and takes about **67 seconds**
to read a cold ~11,000-token agent prompt; see [04-kaggle-pipeline.md](04-kaggle-pipeline.md#410-timing-measured).
A smaller model would be faster but was not usable as an agent.

Qwen3.6 is a *thinking* model: it reasons before answering. That is useful but unbounded, so the registry caps it
(see 6.4).

## 6.3 Will it fit? The memory arithmetic

Two T4s give 2 x 15 GB = 30 GB. The server needs room for:

1. **The weights**: the GGUF file size (16.8 GB for the default).
2. **The KV cache**: memory the model uses to remember the conversation, growing with context length and slots.
   Qwen3.6's hybrid architecture keeps this small.
3. **Compute buffers** for each GPU.

`--split-mode layer` places consecutive layers on each GPU, so the weights divide roughly in half. `minVramGB` in the
registry is a human-readable sanity figure, not something the code enforces; the real check is whether the server
reaches `/health`. If it runs out of memory the notebook sends a signed `stopped` message with the error and
`ktether gpu start` prints the notebook's log.

**Context numbers.** `llama-server` divides its total context across slots. With 2 slots and `-c 65536`, each slot
has 32,768 tokens. The registry stores the per-slot value (`context`) and multiplies by `parallel` when building the
kernel configuration. The 32B coder model uses one slot of 16,384 because its weights leave less room.

## 6.4 Settings that matter

| Setting | Default model | Why |
| --- | --- | --- |
| `parallel: 2` | 2 slots | The agent sends a title request beside the real one. One slot lets a runaway title block the real request until the tunnel drops it. |
| `reasoningBudget: 4096` | 4,096 thinking tokens | Bounds how long a thinking model can reason per request. A larger cap can mean minutes of silence per call at 12 tokens/s; a smaller one may cut off hard problems. |
| `serverArgs: ["-fa", "on"]` | flash attention | Reduces memory use of attention. |
| Quantization `Q4_K_M` | about 4.5 bits per weight | The usual size/quality compromise. |

A larger physical batch size (`-ub 2048 -b 2048`) was tested for faster prefill and gave no improvement, so it is not
used.

## 6.5 How to add a model

1. **Find a GGUF file.** Search Hugging Face for the model's GGUF conversions (for example from `unsloth` or the
   model's own organisation). Pick a quantization whose file is comfortably under about 22 GB for two T4s.
2. **Check that the pinned `llama.cpp` supports its architecture.** The kernel installs release `b11647`
   (`llama_tag` in `kernel/server.py`). Newer architectures may need a newer release; if you change the tag, test a
   launch.
3. **Add an entry** to `AVAILABLE_MODELS` in `registry.ts`, following the existing ones:

```ts
"my-model": {
  id: "my-model",
  displayName: "My Model 8B",
  repo: "someone/My-Model-8B-GGUF",
  file: "My-Model-8B-Q4_K_M.gguf",
  sizeGB: 5.0,
  context: 32768,       // tokens per slot
  parallel: 2,
  serverArgs: ["-fa", "on"],
  minVramGB: 8,
  toolCalling: "unreliable", // until you have tested it, see step 5
  description: "One line for the model list.",
},
```

4. **Run the checks.** From `packages/core`: `bun run typecheck` and `bun test test/ktether`. The plugin test asserts
   that every registry entry is offered as a model, and the server test checks the list and the default.
5. **Test tool calling for real before you mark it `reliable`.** Start it (`ktether gpu start --model my-model`), then
   send a raw request with a `tools` array to the tunnel (the address is shown by `ktether gpu status`; the key is in
   `session.json`; keep it private):

```bash
curl -s "$URL/v1/chat/completions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "model": "x", "temperature": 0.2,
  "messages": [{"role":"user","content":"List the python files here."}],
  "tools": [{"type":"function","function":{"name":"glob","description":"Find files by glob pattern",
    "parameters":{"type":"object","properties":{"pattern":{"type":"string"}},"required":["pattern"]}}}]
}'
```

   Look for a `tool_calls` array in the reply (good) rather than the call written as text inside `content` (bad).
   Repeat several times, then run an agent task such as "read this file and tell me X, using your tools".
6. **Update `toolCalling`** to `reliable` only if it passed, and record the evidence in
   [18-design-decisions.md](18-design-decisions.md).

## 6.6 Ideas not yet tested

- **A mixture-of-experts model** such as Qwen3.6-35B-A3B (a Hugging Face listing exists) only activates about 3
  billion parameters per token and should generate much faster than a dense 27B. I have not verified that it fits,
  that `b11647` runs it, or that its tool calling holds up.
- **Speculative decoding** with a small draft model, or "MTP" model variants, to speed up generation. Unverified.
- **Larger context** for the default, which has not been pushed to its limit.

## 6.7 Using a model that is not on Kaggle

The registry is only about Kaggle. Models served by Ollama, LM Studio, vLLM or any OpenAI-compatible server are
configured separately; see [02-getting-started.md](02-getting-started.md#210-using-your-own-gpu-or-another-server-instead).
