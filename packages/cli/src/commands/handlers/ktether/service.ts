import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"

/** The only Kaggle notebook ktether ever creates, updates or deletes. */
export const KERNEL_SLUG = "ktether-runner"

export const kernelRef = (username: string): string => `${username}/${KERNEL_SLUG}`

export interface ModelSpec {
  readonly id: string
  readonly displayName: string
  readonly repo: string
  readonly file: string
  readonly sizeGB: number
  /** Context window per server slot. */
  readonly context: number
  /** Concurrent server slots. OpenCode issues a title request alongside the main one, so 2 avoids head-of-line blocking. */
  readonly parallel: number
  /** Max thinking tokens per request (thinking models only). Bounds runaway reasoning that would stall the tunnel. */
  readonly reasoningBudget?: number
  readonly minVramGB: number
  readonly description: string
}

export const AVAILABLE_MODELS: Record<string, ModelSpec> = {
  "qwen2.5-coder-14b": {
    id: "qwen2.5-coder-14b",
    displayName: "Qwen 2.5 Coder 14B (Recommended)",
    repo: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    file: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    sizeGB: 9.0,
    context: 32768,
    parallel: 2,
    minVramGB: 12.0,
    description: "Sweet spot for speed and deep reasoning. Fits easily on Dual T4 (32 GB).",
  },
  "qwen2.5-coder-32b": {
    id: "qwen2.5-coder-32b",
    displayName: "Qwen 2.5 Coder 32B (Frontier-Grade)",
    repo: "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
    file: "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
    sizeGB: 19.8,
    context: 16384,
    parallel: 1,
    minVramGB: 24.0,
    description: "Frontier coding performance. Utilizes both T4 GPUs in parallel.",
  },
  "qwen3.6-27b": {
    id: "qwen3.6-27b",
    displayName: "Qwen 3.6 27B (Agentic)",
    repo: "unsloth/Qwen3.6-27B-GGUF",
    file: "Qwen3.6-27B-Q4_K_M.gguf",
    sizeGB: 16.8,
    context: 32768,
    parallel: 2,
    reasoningBudget: 4096,
    minVramGB: 22.0,
    description: "Qwen3.6 generation with native tool calling. Split across both T4s.",
  },
  "qwen2.5-coder-7b": {
    id: "qwen2.5-coder-7b",
    displayName: "Qwen 2.5 Coder 7B (Ultra-Fast)",
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q8_0.gguf",
    sizeGB: 7.7,
    context: 32768,
    parallel: 2,
    minVramGB: 10.0,
    description: "Ultra-fast inference and 32k context for quick refactors.",
  },
}

export interface KTetherState {
  url?: string
  apiKey?: string
  model?: string
  channelId?: string
  sessionStart?: number
  active?: boolean
  status?: "pending" | "ready" | "stopped"
}

export function getStateFilePath(): string {
  const dir = path.join(os.homedir(), ".local", "state", "opencode")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, "ktether.json")
}

export function readState(): KTetherState {
  const file = getStateFilePath()
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch {
      return {}
    }
  }
  return {}
}

export function saveState(state: KTetherState): void {
  const file = getStateFilePath()
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf-8")
}

export function getKaggleCredentials(): { username: string; key: string } {
  if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) {
    return { username: process.env.KAGGLE_USERNAME, key: process.env.KAGGLE_KEY }
  }
  const credsPath = path.join(os.homedir(), ".kaggle", "kaggle.json")
  if (!fs.existsSync(credsPath)) {
    throw new Error(
      `Kaggle credentials not found at ${credsPath}.\n` +
      "Please download kaggle.json from https://www.kaggle.com/settings and place it in ~/.kaggle/kaggle.json",
    )
  }
  const data = JSON.parse(fs.readFileSync(credsPath, "utf-8"))
  if (!data.username || !data.key) {
    throw new Error("Invalid kaggle.json: missing 'username' or 'key'")
  }
  return { username: data.username, key: data.key }
}

export function getKaggleServerScript(kernelConfig: Record<string, unknown> = {}): string {
  const configJson = JSON.stringify(JSON.stringify(kernelConfig))
  return `"""
KaggleGPU Autonomous Server
Runs on Kaggle GPU. Sets up llama-server, downloads the coding LLM,
establishes a Cloudflare tunnel, and signals connection info via ntfy.sh.
"""

import os, sys, json, time, re, signal, subprocess, threading, urllib.request, urllib.error, tarfile, traceback

CONFIG_FILE = "kernel_config.json"
EMBEDDED_CONFIG = json.loads(${configJson})
shutdown_event = threading.Event()
active_procs = []

def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [ktether] {msg}", flush=True)

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                loaded = json.load(f)
                if loaded:
                    return loaded
        except Exception as e:
            log(f"Config load error: {e}")
    return EMBEDDED_CONFIG

def send_signal(channel_id, event_type, data):
    url = f"https://ntfy.sh/{channel_id}"
    payload = {"event": event_type, "timestamp": time.time(), **data}
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Title": f"ktether: {event_type}"}
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log(f"Failed to signal {event_type}: {e}")

def get_gpu_info():
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, check=True
        )
        return "; ".join([line.strip() for line in res.stdout.strip().split("\\n") if line.strip()])
    except Exception as e:
        return f"GPU query error: {e}"

def download_file(url, dest):
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    res = subprocess.run(["curl", "-fSL", "--retry", "5", "-o", dest, url])
    if res.returncode != 0:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(dest, "wb") as out_f:
            while chunk := resp.read(1024 * 1024):
                out_f.write(chunk)

def setup_llama_server(tag="b11647"):
    bin_dir = "/tmp/llama_bin"
    server_bin = os.path.join(bin_dir, "llama-server")
    if os.path.exists(server_bin) and os.access(server_bin, os.X_OK):
        return server_bin

    os.makedirs(bin_dir, exist_ok=True)
    archives = [
        f"llama-{tag}-bin-ubuntu-cuda-12.8-x64.tar.gz",
        f"cudart-llama-{tag}-bin-ubuntu-cuda-12.8-x64.tar.gz"
    ]
    for archive in archives:
        url = f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{archive}"
        archive_path = f"/tmp/{archive}"
        download_file(url, archive_path)
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(path=bin_dir)

    for root, dirs, files in os.walk(bin_dir):
        if "llama-server" in files:
            found = os.path.join(root, "llama-server")
            os.chmod(found, 0o755)
            return found
    raise RuntimeError("llama-server binary not found")

def setup_cloudflared():
    dest = "/tmp/cloudflared"
    if os.path.exists(dest) and os.access(dest, os.X_OK):
        return dest
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    download_file(url, dest)
    os.chmod(dest, 0o755)
    return dest

def download_model(repo, filename):
    model_dir = "/tmp/models"
    os.makedirs(model_dir, exist_ok=True)
    dest = os.path.join(model_dir, filename)
    if os.path.exists(dest) and os.path.getsize(dest) > 1024 * 1024:
        log(f"Model already present: {dest}")
        return dest
    log(f"Downloading model {repo}/{filename} to {dest}...")
    res = subprocess.run(["huggingface-cli", "download", repo, filename, "--local-dir", model_dir])
    if res.returncode == 0 and os.path.exists(dest):
        log(f"Downloaded via huggingface-cli: {dest}")
        return dest
    url = f"https://huggingface.co/{repo}/resolve/main/{filename}"
    log(f"Downloading model via curl from {url}...")
    download_file(url, dest)
    log(f"Downloaded via curl: {dest} ({os.path.getsize(dest)} bytes)")
    return dest

def start_llama_server(bin_path, model_path, api_key, context_size, parallel, reasoning_budget):
    env = os.environ.copy()
    lib_dirs = [root for root, _, _ in os.walk("/tmp/llama_bin")]
    env["LD_LIBRARY_PATH"] = f"{':'.join(lib_dirs)}:{env.get('LD_LIBRARY_PATH', '')}"
    cmd = [
        bin_path,
        "-m", model_path,
        "--host", "127.0.0.1",
        "--port", "8080",
        "--api-key", api_key,
        "-ngl", "99",
        "-c", str(context_size),
        "-np", str(parallel),
        "--split-mode", "layer",
        "--jinja",
        "-fa", "on",
        "--reasoning-budget", str(reasoning_budget)
    ]
    log(f"Starting llama-server: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True, bufsize=1)
    active_procs.append(proc)
    threading.Thread(target=lambda: [print(f"[llama] {line.strip()}", flush=True) for line in proc.stdout if line], daemon=True).start()
    return proc

def wait_for_health(proc, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        if shutdown_event.is_set():
            return False
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server terminated prematurely with code {proc.returncode}")
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False

def start_tunnel(cloudflared_bin):
    proc = subprocess.Popen([cloudflared_bin, "tunnel", "--url", "http://127.0.0.1:8080", "--no-autoupdate"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    active_procs.append(proc)
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com")
    start = time.time()
    tunnel_url = None
    while time.time() - start < 60:
        if proc.poll() is not None:
            raise RuntimeError(f"cloudflared exited prematurely with code {proc.returncode}")
        line = proc.stdout.readline()
        if line:
            print(f"[tunnel] {line.strip()}", flush=True)
            m = url_pattern.search(line)
            if m:
                tunnel_url = m.group(0)
                break
        time.sleep(0.1)
    if not tunnel_url:
        raise RuntimeError("Cloudflare tunnel failed to start")
    threading.Thread(target=lambda: [print(f"[tunnel] {l.strip()}", flush=True) for l in proc.stdout if l], daemon=True).start()
    return tunnel_url

def control_loop(channel_id):
    url = f"https://ntfy.sh/{channel_id}_ctrl/json"
    while not shutdown_event.is_set():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ktether"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                for line in resp:
                    if shutdown_event.is_set():
                        return
                    if line:
                        msg = json.loads(line.decode("utf-8"))
                        if msg.get("event") == "message" and "STOP" in msg.get("message", "").upper():
                            log("STOP signal received! Terminating...")
                            shutdown_event.set()
                            return
        except Exception:
            time.sleep(3)

def idle_watchdog(idle_minutes, channel_id):
    limit_sec = idle_minutes * 60
    last_act = time.time()
    last_tokens = 0
    while not shutdown_event.is_set():
        time.sleep(30)
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/slots", timeout=5) as resp:
                slots = json.loads(resp.read().decode("utf-8"))
                tokens = sum(s.get("n_past", 0) for s in slots)
                busy = any(s.get("is_processing", False) for s in slots)
                if busy or tokens > last_tokens:
                    last_act = time.time()
                    last_tokens = tokens
                elif (time.time() - last_act) >= limit_sec:
                    log(f"Idle for {idle_minutes}m. Auto-stopping to save GPU quota.")
                    send_signal(channel_id, "stopped", {"reason": "idle_timeout"})
                    shutdown_event.set()
                    return
        except Exception:
            pass

def main():
    cfg = load_config()
    channel_id = cfg.get("channel_id", "ktether_default")
    api_key = cfg.get("api_key", "sec_default")
    model_name = cfg.get("model_name", "qwen2.5-coder-14b")
    idle_minutes = cfg.get("idle_timeout_minutes", 45)

    signal.signal(signal.SIGINT, lambda s, f: shutdown_event.set())
    signal.signal(signal.SIGTERM, lambda s, f: shutdown_event.set())

    gpu = get_gpu_info()
    log(f"GPU Hardware: {gpu}")
    send_signal(channel_id, "starting", {"gpu": gpu, "model": model_name})

    try:
        bin_path = setup_llama_server()
        cloudflared = setup_cloudflared()
        send_signal(channel_id, "downloading_model", {"model": model_name})
        model_path = download_model(cfg["model_repo"], cfg["model_file"])

        proc = start_llama_server(bin_path, model_path, api_key, cfg.get("context_size", 16384), cfg.get("parallel", 1), cfg.get("reasoning_budget", -1))
        if not wait_for_health(proc):
            raise RuntimeError("llama-server failed to report healthy")

        tunnel_url = start_tunnel(cloudflared)
        send_signal(channel_id, "ready", {
            "tunnel_url": tunnel_url,
            "api_key": api_key,
            "model": model_name,
            "gpu": gpu
        })
        log(f"ktether online: {tunnel_url}")

        threading.Thread(target=control_loop, args=(channel_id,), daemon=True).start()
        threading.Thread(target=idle_watchdog, args=(idle_minutes, channel_id), daemon=True).start()

        while not shutdown_event.is_set():
            time.sleep(1)
    except Exception as e:
        err_msg = f"{e}\\n{traceback.format_exc()}"
        log(f"FATAL ERROR: {err_msg}")
        send_signal(channel_id, "stopped", {"reason": f"error: {e}"})
        raise
    finally:
        for p in active_procs:
            try:
                p.terminate()
            except Exception:
                pass
        if shutdown_event.is_set():
            send_signal(channel_id, "stopped", {"reason": "session_finished"})
        sys.exit(0)

if __name__ == "__main__":
    main()
`
}

export function prepareStagingBundle(
  username: string,
  modelKey: string,
  idleTimeoutMinutes: number,
): { stagingDir: string; channelId: string; apiKey: string } {
  const modelSpec = AVAILABLE_MODELS[modelKey] ?? AVAILABLE_MODELS["qwen2.5-coder-14b"]
  const channelId = `kt_${crypto.randomBytes(6).toString("hex")}`
  const apiKey = `kgp_${crypto.randomBytes(16).toString("hex")}`

  const stagingDir = path.join(os.tmpdir(), "ktether_staging")
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  const kernelConfig = {
    channel_id: channelId,
    api_key: apiKey,
    model_repo: modelSpec.repo,
    model_file: modelSpec.file,
    model_name: modelSpec.id,
    context_size: modelSpec.context * modelSpec.parallel,
    parallel: modelSpec.parallel,
    reasoning_budget: modelSpec.reasoningBudget ?? -1,
    idle_timeout_minutes: idleTimeoutMinutes,
  }

  fs.writeFileSync(path.join(stagingDir, "server.py"), getKaggleServerScript(kernelConfig), "utf-8")
  fs.writeFileSync(path.join(stagingDir, "kernel_config.json"), JSON.stringify(kernelConfig, null, 2), "utf-8")

  const metadata = {
    id: kernelRef(username),
    title: KERNEL_SLUG,
    code_file: "server.py",
    language: "python",
    kernel_type: "script",
    is_private: "true",
    enable_gpu: "true",
    enable_tpu: "false",
    enable_internet: "true",
    accelerator: "NvidiaTeslaT4",
    dataset_sources: [],
    competition_sources: [],
    kernel_sources: [],
    model_sources: [],
  }
  fs.writeFileSync(path.join(stagingDir, "kernel-metadata.json"), JSON.stringify(metadata, null, 2), "utf-8")

  return { stagingDir, channelId, apiKey }
}

export function pushKaggleKernel(stagingDir: string): string {
  const res = spawnSync("kaggle", ["kernels", "push", "-p", stagingDir, "--accelerator", "NvidiaTeslaT4"], {
    encoding: "utf-8",
    shell: true,
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`Kaggle push failed: ${res.stderr || res.stdout}`)
  return (res.stdout || "").trim()
}

export type KernelStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "ERROR" | "CANCEL_REQUESTED" | "CANCEL_ACKNOWLEDGED" | string

export function getKernelStatus(username: string): KernelStatus | undefined {
  const res = spawnSync("kaggle", ["kernels", "status", kernelRef(username)], {
    encoding: "utf-8",
    shell: true,
  })
  const match = /KernelWorkerStatus\.([A-Z_]+)/.exec(`${res.stdout ?? ""}${res.stderr ?? ""}`)
  return match?.[1]
}

const TERMINAL_STATUSES = new Set(["COMPLETE", "ERROR", "CANCEL_REQUESTED", "CANCEL_ACKNOWLEDGED"])

export interface PollOptions {
  /** Max time to wait for Kaggle to assign a GPU (kernel QUEUED). */
  readonly queueTimeoutSeconds?: number
  /** Max time from the kernel starting to RUNNING until the tunnel is ready. */
  readonly bootTimeoutSeconds?: number
  readonly onProgress?: (event: string, data: Record<string, unknown>) => void
  readonly onStatus?: (status: KernelStatus) => void
  readonly username?: string
}

export async function pollSignaling(
  channelId: string,
  options: PollOptions = {},
): Promise<{ tunnel_url: string; api_key: string; model: string; gpu: string }> {
  const { queueTimeoutSeconds = 3600, bootTimeoutSeconds = 900, onProgress, onStatus, username } = options
  const url = `https://ntfy.sh/${channelId}/json?poll=1&since=all`
  const startTime = Date.now()
  let runningSince: number | undefined
  let lastStatusCheck = 0
  let lastStatus: KernelStatus | undefined
  const seen = new Set<string>()

  while (true) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        for (const line of (await resp.text()).split("\n")) {
          if (!line.trim()) continue
          let payload: Record<string, any>
          try {
            const entry = JSON.parse(line)
            if (entry.event !== "message") continue
            payload = JSON.parse(entry.message)
          } catch {
            continue
          }
          const key = `${payload.event}_${payload.timestamp}`
          if (seen.has(key)) continue
          seen.add(key)
          if (payload.event === "starting" && runningSince === undefined) runningSince = Date.now()
          onProgress?.(payload.event, payload)
          if (payload.event === "ready") return payload as never
          if (payload.event === "stopped") throw new Error(`Kaggle kernel stopped: ${payload.reason}`)
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("Kaggle kernel stopped")) throw e
    }

    if (username && Date.now() - lastStatusCheck >= 15_000) {
      lastStatusCheck = Date.now()
      const status = getKernelStatus(username)
      if (status && status !== lastStatus) {
        lastStatus = status
        onStatus?.(status)
      }
      if (status === "RUNNING" && runningSince === undefined) runningSince = Date.now()
      if (status && TERMINAL_STATUSES.has(status)) {
        const logRes = spawnSync("kaggle", ["kernels", "output", kernelRef(username)], {
          encoding: "utf-8",
          shell: true,
        })
        throw new Error(`Kaggle kernel ended (${status}) before the tunnel was ready. ${logRes.stdout || logRes.stderr}`)
      }
    }

    const now = Date.now()
    if (runningSince === undefined && now - startTime > queueTimeoutSeconds * 1000) {
      throw new Error(`Still queued on Kaggle after ${queueTimeoutSeconds}s waiting for a GPU. Run start again to keep waiting.`)
    }
    if (runningSince !== undefined && now - runningSince > bootTimeoutSeconds * 1000) {
      throw new Error(`Kernel started but was not ready within ${bootTimeoutSeconds}s. Run start again to keep waiting.`)
    }

    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
}

export async function sendStopSignal(channelId: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://ntfy.sh/${channelId}_ctrl`, {
      method: "POST",
      body: "STOP",
    })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Registers the ktether provider and its models in the global OpenCode config.
 * The endpoint and API key are deliberately not written here: the provider
 * resolves them at runtime from ktether.json, so they never go stale.
 */
export function syncOpenCodeConfig(modelId: string): void {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json")
  let cfg: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch {
      cfg = {}
    }
  }

  const providerMap = (cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {}) as Record<string, unknown>
  providerMap.ktether = {
    name: "KaggleGPU (ktether)",
    npm: "@opencode/ai/providers/ktether",
    models: Object.fromEntries(Object.values(AVAILABLE_MODELS).map((m) => [m.id, { name: m.displayName }])),
  }

  cfg.provider = providerMap
  cfg.model = `ktether/${modelId}`

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8")
}

export async function waitForKernelIdle(username: string, timeoutSeconds: number): Promise<KernelStatus | undefined> {
  const deadline = Date.now() + timeoutSeconds * 1000
  let status = getKernelStatus(username)
  while (status === "RUNNING" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    status = getKernelStatus(username)
  }
  return status
}

/** Deletes the ktether notebook (and all its versions) from the user's Kaggle account. */
export function deleteKaggleKernel(username: string): { deleted: boolean; message: string } {
  const res = spawnSync("kaggle", ["kernels", "delete", kernelRef(username), "--yes"], {
    encoding: "utf-8",
    shell: true,
  })
  const message = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/^Warning:.*outdated.*$/m, "").trim()
  return { deleted: res.status === 0, message }
}
