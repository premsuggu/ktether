# 2. Getting started

This guide takes you from nothing to an agent answering questions on a free Kaggle GPU. Allow about 30 minutes the
first time, most of it waiting for downloads and for Kaggle.

> Commands below use `bun run dev ...`, the root script that runs the CLI from source. There is no packaged release
> yet. On your own machine you can shorten it with a shell alias, for example
> `alias ktether='bun run --cwd /path/to/ktether/packages/cli src/index.ts'`, but then pass directories explicitly
> because `--cwd` changes the working directory.

## 2.1 What you need

| Requirement | How to check | Why |
| --- | --- | --- |
| **Bun** | `bun --version` (the repo pins a version in the root `package.json`, field `packageManager`) | Runs, installs and builds the project |
| **Git** | `git --version` | Checking out the source; the agent's repo tools |
| **Python 3 and pip** | `python --version` | Only to install the Kaggle CLI (and to run some development tests) |
| **A Kaggle account** with a verified phone number | Sign in at kaggle.com | GPU notebooks and internet access need a verified phone |
| **The Kaggle CLI** | `kaggle --version` | ktether uses it to push and manage the notebook |
| **Kaggle API credentials** | file `~/.kaggle/kaggle.json` | Lets the CLI act as you |

## 2.2 Set up Kaggle

1. **Create an account** at <https://www.kaggle.com> and sign in.
2. **Verify your phone number** under *Settings → Phone verification*. Without it Kaggle will not give you a GPU or
   internet inside notebooks, and `ktether gpu start` will fail or queue forever.
3. **Create an API token.** Under *Settings → API*, choose *Create New Token*. Kaggle downloads a file named
   `kaggle.json`.
4. **Put the file where the CLI expects it.**
   - macOS and Linux: `~/.kaggle/kaggle.json`, then `chmod 600 ~/.kaggle/kaggle.json`.
   - Windows: `%USERPROFILE%\.kaggle\kaggle.json`.
5. **Install the Kaggle CLI:** `pip install kaggle`.

Instead of the file you can export `KAGGLE_USERNAME` and `KAGGLE_KEY`; ktether checks those first.

> The Kaggle CLI 2.0.0 was used while developing this project. It prints "you're using an outdated `kaggle`
> version" warnings; they are harmless and ktether hides them. Kaggle has also been introducing a newer style of
> access token; I did not test it, so if the classic `kaggle.json` is available to you, use that.

## 2.3 Install ktether

```bash
git clone https://github.com/premsuggu/ktether.git
cd ktether
bun install --ignore-scripts
```

`--ignore-scripts` is what was used throughout development. The repository's `postinstall` step prepares a native
terminal binding for the in-app terminal pane; I did not verify the default install on a clean machine, so if plain
`bun install` fails for you, use the flag.

## 2.4 Check your setup

```bash
bun run dev gpu doctor
```

You should see something like:

```text
[OK]   Kaggle CLI           version 2.0.0
[OK]   Kaggle credentials   user your-username, notebook COMPLETE
[OK]   Signalling relay     reachable (HTTP 200)
[OK]   Hugging Face         reachable (HTTP 200)
[OK]   Cloudflare           reachable (HTTP 200)
```

Each `[FAIL]` line tells you what is missing. "notebook COMPLETE" or "notebook (nothing)" is normal before your
first start.

## 2.5 Choose a model

```bash
bun run dev gpu models
```

The default, **`qwen3.6-27b`**, is the one to use: it produced structured tool calls on every test. The Qwen2.5
coder models are listed too but are marked "no reliable tool calling", because an agent cannot work without that.
More in [06-models.md](06-models.md).

## 2.6 Start the GPU

```bash
bun run dev gpu start
```

This is the long step. A real run looks like this (identifiers shortened):

```text
User: your-username
Model: Qwen 3.6 27B (Agentic) (16.8 GB)
Hardware: Kaggle Dual Nvidia T4 (32 GB total VRAM)
Idle Timeout: 45 minutes

-> Packaging kernel & pushing to Kaggle GPU...
   Kernel version 8 successfully pushed.  Please check progress at https://www.kaggle.com/code/your-username/ktether-runner
[OK] Kernel successfully queued on Kaggle GPU!
-> Waiting for Kaggle to assign a GPU and start the inference server...
   Kaggle kernel status: QUEUED
   Container online. Hardware: Tesla T4, 15360 MiB; Tesla T4, 15360 MiB
   Downloading qwen3.6-27b into Kaggle RAM disk...
   Kaggle kernel status: RUNNING
   llama-server initialized and Cloudflare tunnel online!
   Boot breakdown: binaries 52s, model_download 94s, server_ready 138s, tunnel 5s

=== ktether is Ready! ===
Public Tunnel: https://example-words-here.trycloudflare.com
Provider ID:   kaggle
Model:         kaggle/qwen3.6-27b
```

What to expect:

- **QUEUED** means Kaggle has not assigned a machine yet. It can last a few minutes, sometimes much longer. ktether
  waits up to an hour for a GPU and then tells you to run `start` again. **It will not push a second notebook**:
  running `start` again resumes the launch it already made.
- **Boot takes about 4.5 to 5 minutes** after the machine is assigned: installing `llama.cpp` and the tunnel
  program, downloading about 17 GB, and loading it onto the two GPUs. The "Boot breakdown" line shows where the time
  went; the model load is the biggest single stage.
- You can press Ctrl+C at any time. The launch continues on Kaggle; run `start` again to keep watching.

## 2.7 Use the agent

Open the terminal UI in the folder you want to work on:

```bash
bun run dev /path/to/your/project
```

Then open the model picker and choose **`kaggle/qwen3.6-27b`**. Type a task and press Enter.

For a scripted, one-shot run:

```bash
bun run dev run --model kaggle/qwen3.6-27b "List the TypeScript files in src and summarise what each does"
```

**Be patient on the first message.** The agent sends a long instruction prompt (about 11,000 tokens) with the
first request, and the two T4s read it at roughly 170 tokens per second, so the first reply can take over a
minute. Later messages reuse the cached prompt and answer in seconds. Generation then runs at about 12 tokens per
second.

Inside the terminal UI you can type these slash commands:

| Command | Effect |
| --- | --- |
| `/ktether` | Show the GPU dialog: state, model, uptime, slots, usage, latest operation |
| `/ktether-start` | Start the GPU (same as `ktether gpu start`) |
| `/ktether-stop` | Stop the GPU |

## 2.8 Watch your quota

```bash
bun run dev gpu status
```

```text
=== ktether Session Status ===
Kaggle Kernel: RUNNING
GPU time used by ktether, last 7 days: ~0.3h of 30h (local estimate)
Tunnel URL: https://example-words-here.trycloudflare.com
Active Model: qwen3.6-27b
Health Check: HEALTHY (895ms)
Uptime: 2.7 minutes
Boot breakdown: binaries 44s, model_download 77s, server_ready 153s, tunnel 6s
Server slots: 0 busy / 2
```

The GPU-hours figure is **ktether's own estimate**: Kaggle's CLI does not report your remaining quota, so ktether
adds up the sessions it ran in the last seven days. Check kaggle.com for the authoritative number.

## 2.9 Stop the GPU

```bash
bun run dev gpu stop
```

This sends a signed stop message, the notebook shuts down, and the session is closed. If you forget, the notebook
stops itself after 45 idle minutes, and always before Kaggle's 12-hour limit (ktether stops it at 11 hours 40
minutes).

To remove the notebook from your Kaggle account entirely (it is one notebook, `ktether-runner`, that accumulates
versions; nothing else of yours is ever touched):

```bash
bun run dev gpu clean          # previews what would be deleted
bun run dev gpu clean --yes    # does it
# or stop and delete in one go:
bun run dev gpu stop --delete
```

## 2.10 Using your own GPU or another server instead

ktether is not limited to Kaggle. Any server that speaks the OpenAI chat API works.

- **Ollama, LM Studio, vLLM.** If one of them is running on its usual local port, ktether looks for it and lists its
  models. This comes from the code in `packages/core/src/plugin/provider/` and is not exercised against real servers
  by this project's tests.
- **Any OpenAI-compatible endpoint.** Add a provider to your configuration (see
  [15-configuration.md](15-configuration.md) for the file locations):

```jsonc
{
  "providers": {
    "my-server": {
      "name": "My server",
      "package": "@ktether/ai/providers/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:8080/v1", "apiKey": "optional-key" },
      "models": { "my-model": {} }
    }
  }
}
```

This is the same shape the server's own tests use for a configured provider.

## 2.11 If something goes wrong

Start with `bun run dev gpu doctor` and `bun run dev gpu status`, then see
[17-troubleshooting.md](17-troubleshooting.md). The most common problems are a missing Kaggle phone verification,
a long Kaggle queue, and (rarely) the tunnel being replaced, which `ktether gpu reconnect` fixes.
