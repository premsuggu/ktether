# 5. Security model

ktether sends your prompts to a program running on someone else's computer (Kaggle's) through a free public tunnel,
and coordinates it through a free public message board. That sounds alarming, so this page states exactly what is
protected, how, and what is **not** protected. It describes what the code does today, not what would be ideal.

## 5.1 What we are protecting

| Asset | Why it matters |
| --- | --- |
| Your code and prompts | They are the point of using an agent. |
| Your Kaggle account | Its credentials can push, run and delete notebooks. |
| The per-session **API key** | Whoever holds it can use your GPU and read what you send. |
| The per-session **signing key** | Whoever holds it can forge "ready" or "stop" messages. |
| Your GPU quota | A hijacked or runaway session wastes a weekly allowance. |

## 5.2 Who we worry about

| Adversary | Can do |
| --- | --- |
| **Anyone who can read or write the relay topic** | The relay (`ntfy.sh`) is public. A topic is only a name. |
| **Someone on the network path** | Sees traffic metadata; cannot read TLS content. |
| **Someone who learns the tunnel URL** | Can send HTTP requests to it. |
| **Someone with read access to your user profile** | Can read `session.json`. |
| **Someone who compromises your Kaggle account** | Can read the notebook, including the current keys. |

We **trust** Kaggle, Cloudflare, Hugging Face and GitHub to deliver what they serve, and we accept that Kaggle's
machine and Cloudflare's edge handle your prompts (see 5.5).

## 5.3 The controls

### The relay is treated as hostile

- **Nothing secret is ever sent through it.** The API key was generated on your machine and never leaves it except
  as a bearer token to the tunnel. The signing key is never transmitted at all. The relay carries only signed
  progress and the tunnel URL, which is useless without the API key.
- **Unguessable topic names.** `kt_` plus 128 random bits (`generateChannelId` in `signaling.ts`).
- **Every notebook message is signed.** HMAC-SHA256 with the signing key over the exact payload text, compared in
  constant time (`crypto.timingSafeEqual`). A message that fails verification is ignored, so a stranger who finds
  the topic cannot, for example, announce a fake tunnel address that would capture your prompts.
- **Stop commands are signed and fresh.** `STOP:<time>:<HMAC>`, accepted only if valid and within ten minutes,
  which blocks replay. A plain `STOP` or a forged one is ignored; this was checked on a live notebook (a plain
  `STOP` and a malformed signed one were posted, and the server stayed healthy).
- **The announced address is validated.** Even a correctly signed `ready` must name `https://<words>.trycloudflare.com`.

### The tunnel and the server

- `llama-server` listens on `127.0.0.1` only, behind the tunnel program, and is started with `--api-key`. A request
  without the key gets HTTP 401 (checked live).
- The key is `kgp_` plus 128 random bits, new for every launch.

### On your machine

- **`session.json` is written atomically and with mode 0600** on systems that support it, so a crash cannot leave a
  half-written file and other users cannot read it. On Windows, file modes are not enforced the same way, so
  protection there relies on your user profile's permissions.
- **The staging folder is deleted right after the push**, even on failure, because it holds the keys in plain text.
- **The API never returns credentials.** `GET /api/ktether` returns state, model, timings and usage only; a test
  asserts that the response contains no key or `kgp_` text.
- **The default CORS policy trusts only localhost and the desktop shell**, not any remote website.
- **Logging masks the key.** `server.py` replaces the API key with `***` when it logs the server command line.
- **Decoding at the boundary.** The session file and relay messages are decoded through Effect schemas, so malformed
  input becomes "no session" or "ignored", never an exception deep in the code.

### Scope of deletion

`clean` and `stop --delete` can only ever delete the notebook named `<you>/ktether-runner`. The name is a constant
in `kaggle.ts`, and a test asserts it is the only delete issued.

## 5.4 What the notebook can see

The notebook receives your **prompts and the files the agent chooses to include in them**, and returns completions.
It does not receive your repository wholesale; the agent runs tools on your machine and sends the model only the
text it decides to send. Still, treat anything the agent reads as something that may be sent to Kaggle.

## 5.5 Residual risks and gaps (please read)

These are real, and not all are solved:

1. **Kaggle and Cloudflare see your traffic.** The tunnel is TLS up to Cloudflare's edge, which then forwards to the
   notebook. The notebook's output log also records the model server's console output. ktether does not enable
   prompt logging, but I did not audit `llama.cpp`'s logging, so do not send anything you would not be comfortable
   with a cloud provider processing.
2. **Keys live in two places in plain text.** In `session.json` on your machine, and inside the pushed
   `server.py` in your private Kaggle notebook (every version keeps its session's keys). The keys are per session and
   stop working when the session ends, but anyone who can read your active session file or your Kaggle notebook can use
   the active keys. `ktether gpu clean` deletes the notebook and its history.
3. **Downloaded programs are not checksum-verified.** `llama.cpp`, its CUDA runtime and `cloudflared` are fetched from
   GitHub release URLs at pinned versions over HTTPS, and the model from Hugging Face. There is no SHA-256
   verification of those files yet. Pinning limits surprise; hash pinning would remove the dependency on the
   hosting account staying uncompromised. This is a known gap.
4. **Relay metadata is visible to anyone who learns the topic.** That includes the model name, GPU type, boot timings
   and the tunnel URL. The topic is 128 random bits, so learning it requires seeing it, for example in a shared log.
5. **A leaked tunnel URL is not a leaked session**, but it is an invitation to probe. Requests without the key are
   rejected, yet there is no rate limiting in front of the tunnel.
6. **Free-tier infrastructure.** The relay and quick tunnels have no service guarantee. If you need stronger
   guarantees, `KTETHER_NTFY_URL` lets you point at your own ntfy server.
7. **Quota abuse.** A person who could forge a "ready" or "stop" could disturb a session; they cannot without the
   signing key. A runaway session is bounded by the idle timeout (45 minutes) and the session cap (11 h 40 min).
8. **Local server authentication.** The ktether server that the CLI talks to is a local HTTP server. Its own access
   control comes from the underlying agent framework (a generated password for the background service). I did not
   audit that layer for this documentation; see [15-configuration.md](15-configuration.md) and the server package.
9. **Third-party features.** Realtime voice and web search send data to OpenAI, xAI, Exa or Firecrawl if you enable
   them with your own keys. They are unrelated to the Kaggle GPU.
10. **Inherited code.** ktether is a fork; the agent framework's own permission system (which asks before running
    commands or editing files) is what limits the model's actions on your machine. Review those prompts.

## 5.6 If you suspect a leak

1. Run `ktether gpu stop` and `ktether gpu clean --yes`. This ends the session and deletes the notebook and every
   version of the script.
2. Rotate your Kaggle API token (*Settings → API → Create New Token*, which invalidates the old one).
3. Start again; new keys and a new channel are generated automatically.

## 5.7 Responsible use

ktether uses Kaggle's notebooks as an inference server reached through a tunnel. **Check that this is permitted by
Kaggle's terms of use for your account and use case; you are responsible for complying with them.** The project does
not provide a way around Kaggle's quotas or verification, and a session is bounded by them.
