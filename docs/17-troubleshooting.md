# 17. Troubleshooting

Start with the two commands that tell you the most:

```bash
ktether gpu doctor     # is the Kaggle CLI, your login and the network OK?
ktether gpu status     # what state is the session in, and what is the latest operation doing?
```

## 17.1 Setting up

| Problem | Likely cause | Fix |
| --- | --- | --- |
| `The Kaggle CLI was not found on PATH` | Not installed, or not on PATH | `pip install kaggle`, then open a new terminal. |
| `Kaggle credentials not found at ...` | No `kaggle.json` | Create a token in Kaggle *Settings → API* and save it to `~/.kaggle/kaggle.json` (Windows: `%USERPROFILE%\.kaggle\kaggle.json`), or set `KAGGLE_USERNAME` and `KAGGLE_KEY`. |
| `Invalid kaggle.json: missing 'username' or 'key'` | Wrong file | Download a fresh token. |
| `Kaggle push failed: ... 403` or `401` | Bad or expired token, or the phone is not verified | Rotate the token; verify your phone in Kaggle settings. |
| `gpu doctor` shows `unreachable` for the relay, Hugging Face or Cloudflare | Firewall, proxy or offline | These must be reachable from your machine (relay, Cloudflare) and from Kaggle (Hugging Face, GitHub). |
| `bun install` fails in a postinstall step | Native terminal binding | Use `bun install --ignore-scripts`. |

## 17.2 Starting the GPU

| Symptom | Cause | What to do |
| --- | --- | --- |
| Stuck on `QUEUED` | Kaggle has no free GPU | Wait. After an hour ktether says "Still queued ... Run start again to keep waiting"; run `ktether gpu start` again (it **resumes**, it does not push a second notebook). |
| `A previous ktether kernel is still running. Stopping it first` | An old notebook was still alive | Normal. It is stopped with a signed message, waiting up to 90 s. |
| `Kaggle kernel ended (ERROR) before the tunnel was ready` + a log | The notebook crashed | Read the log tail. Typical causes: out of memory (model too large for the context), a download that failed, a GPU that was not attached. |
| `Kernel started but was not ready within 900s` | Boot hung (slow download, model load) | Run `start` again. Check the notebook on kaggle.com. |
| `Kernel reported an invalid tunnel URL` | A signed `ready` named something other than `https://<words>.trycloudflare.com` | Should not happen with this notebook; treat as a bug and run `gpu clean --yes` then start again. |
| Start prints the model warning "does not call tools reliably" | You chose a Qwen2.5 coder model | Use `qwen3.6-27b` for the agent. |
| `Invalid model 'x'` | Not in the registry | `ktether gpu models`. |
| Nothing happens after Ctrl+C | The launch continues on Kaggle | `ktether gpu start` to resume watching, or `gpu stop`. |
| `An operation is already running` | Another `start`/`stop`/`clean` is in progress | The CLI follows it. If it is wedged, restart the service: `ktether service restart`. The log is in memory and is lost on restart; the saved session is not. |

## 17.3 Using the model

| Symptom | Cause | Fix |
| --- | --- | --- |
| `HTTP 530` or `ECONNRESET` right away | The saved tunnel no longer exists (the notebook stopped, or the tunnel was replaced) | `ktether gpu status`. If `unreachable`, run `ktether gpu reconnect`. If the kernel is `COMPLETE`, run `ktether gpu start`. |
| `request (N tokens) exceeds the available context size` | The prompt is larger than one slot's context | The default is 32,768 tokens per slot, which fits the agent. A custom model entry may have too small a `context`; raise it in `registry.ts` (mind the memory, see [06-models.md](06-models.md)). |
| The agent prints JSON or `<tools>` text instead of acting | The model does not call tools reliably | Use `qwen3.6-27b`. See the evidence in [18-design-decisions.md](18-design-decisions.md). |
| First reply takes a minute or more | Cold prefill of the agent's ~11,000-token instruction prompt (about 170 tokens/s on two T4s) | Expected. Later turns reuse the cache. |
| Replies are slow (12 tokens/s) | Hardware limit of a 27B model on two T4s | Expected. |
| A reply stops being produced for minutes on a hard problem | A thinking model reasoning (capped at 4,096 thinking tokens) | Expected. `--thinking` on `run` shows it. |
| `authentication` error with the `kaggle` provider | No API key: no active session, and no `KTETHER_API_KEY` | Start a session. |
| The requests go to `http://127.0.0.1:8080/v1` | No session file and no `KTETHER_URL` | Start a session. The localhost address is only a fallback for a local `llama-server`. |

## 17.4 Stopping and cleaning

| Symptom | Cause | Fix |
| --- | --- | --- |
| `stop` warns the kernel is `QUEUED` | Kaggle cannot cancel a queued run from the CLI | `ktether gpu clean --yes` deletes the notebook and so leaves the queue. |
| `Could not delete tester/ktether-runner: ...` | Kaggle rejected the delete (still running, or a permissions problem) | Stop it, wait a minute, retry. |
| The notebook stopped by itself | Idle timeout (default 45 minutes) or the 11 h 40 min cap | By design. |
| `status` says the kernel ended and closes the session | The notebook ended while ktether was not watching | Normal reconciliation; the time is added to your usage estimate. |

## 17.5 Tunnel problems

Cloudflare quick tunnels are free and come with no guarantee. If the tunnel drops, the notebook restarts it and
publishes a new address within seconds. Run `ktether gpu reconnect`; it fetches the newest signed address and checks
that it answers. If it keeps failing, the notebook itself may be gone: check `ktether gpu status`.

## 17.6 Reading the notebook's own log

When a notebook ends in `ERROR`, ktether prints its log. You can also see it at
`https://www.kaggle.com/code/<your-username>/ktether-runner`. Useful lines start with `[ktether]` (the supervisor),
`[llama]` (the model server) and `[tunnel]` (cloudflared). Boot stages appear as `stage <name> done at +<seconds>s`.

## 17.7 Resetting everything

```bash
ktether gpu stop
ktether gpu clean --yes             # removes the notebook and its history from Kaggle
ktether service stop                # stops the background server
```

To forget the saved session, delete `~/.local/state/ktether/session.json` (it contains the session's keys; deleting it
does not stop a running notebook, so stop it first).

## 17.8 Asking for help

When you report a problem, include: the output of `ktether gpu doctor` and `ktether gpu status`, the operation log, and
whether it is a Windows, macOS or Linux machine. **Do not paste `session.json`**; it contains secrets.
