"""
ktether kernel server.

Runs inside a Kaggle GPU notebook. Downloads llama.cpp, cloudflared and the model (concurrently), starts
llama-server behind a Cloudflare quick tunnel and reports progress to the laptop over a relay topic.

Every message sent is HMAC-signed and every stop command is verified, because the relay is untrusted. No secret
is ever sent over it: the API key only ever travels laptop -> tunnel as a bearer token.

The generated file starts with `EMBEDDED_CONFIG_JSON = "..."`, injected by the CLI.
"""

import hashlib
import hmac
import json
import os
import re
import signal
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.error
import urllib.request

EMBEDDED_CONFIG = json.loads(globals().get("EMBEDDED_CONFIG_JSON", "{}"))

NTFY_URL = "https://ntfy.sh"
SIGNING_KEY = ""
STOP_MAX_AGE_SECONDS = 600
LLAMA_PORT = 8080
BIN_DIR = "/tmp/llama_bin"
MODEL_DIR = "/tmp/models"

shutdown_event = threading.Event()
active_procs = []
started_at = time.time()
timings = {}


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [ktether] {msg}", flush=True)


def mark(stage):
    """Records how many seconds after kernel start a boot stage finished."""
    timings[stage] = round(time.time() - started_at, 1)
    log(f"stage {stage} done at +{timings[stage]}s")


# --- signalling -------------------------------------------------------------


def sign(message):
    return hmac.new(SIGNING_KEY.encode(), message.encode(), hashlib.sha256).hexdigest()


def send_signal(channel_id, event_type, data):
    payload = json.dumps(
        {"event": event_type, "timestamp": time.time(), **data}, sort_keys=True, separators=(",", ":")
    )
    body = json.dumps({"p": payload, "s": sign(payload)})
    try:
        req = urllib.request.Request(
            f"{NTFY_URL}/{channel_id}",
            data=body.encode("utf-8"),
            headers={"Content-Type": "application/json", "Title": f"ktether: {event_type}"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log(f"Failed to signal {event_type}: {e}")


def is_valid_stop(text):
    parts = text.strip().split(":")
    if len(parts) != 3 or parts[0] != "STOP":
        return False
    try:
        ts = float(parts[1])
    except ValueError:
        return False
    if abs(time.time() - ts) > STOP_MAX_AGE_SECONDS:
        return False
    return hmac.compare_digest(parts[2], sign("STOP:" + parts[1]))


def control_loop(channel_id):
    url = f"{NTFY_URL}/{channel_id}_ctrl/json"
    while not shutdown_event.is_set():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ktether"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                for line in resp:
                    if shutdown_event.is_set():
                        return
                    if line:
                        msg = json.loads(line.decode("utf-8"))
                        if msg.get("event") == "message" and is_valid_stop(msg.get("message", "")):
                            log("Authenticated STOP signal received. Terminating...")
                            shutdown_event.set()
                            return
        except Exception:
            time.sleep(3)


# --- provisioning -----------------------------------------------------------


def get_gpu_info():
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=True,
        )
        return "; ".join(line.strip() for line in res.stdout.strip().split("\n") if line.strip())
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


def setup_llama_server(tag):
    server_bin = os.path.join(BIN_DIR, "llama-server")
    if os.path.exists(server_bin) and os.access(server_bin, os.X_OK):
        return server_bin

    os.makedirs(BIN_DIR, exist_ok=True)
    for archive in (
        f"llama-{tag}-bin-ubuntu-cuda-12.8-x64.tar.gz",
        f"cudart-llama-{tag}-bin-ubuntu-cuda-12.8-x64.tar.gz",
    ):
        archive_path = f"/tmp/{archive}"
        download_file(f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{archive}", archive_path)
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(path=BIN_DIR)

    for root, _dirs, files in os.walk(BIN_DIR):
        if "llama-server" in files:
            found = os.path.join(root, "llama-server")
            os.chmod(found, 0o755)
            return found
    raise RuntimeError("llama-server binary not found in release archive")


def setup_cloudflared(version):
    dest = "/tmp/cloudflared"
    if os.path.exists(dest) and os.access(dest, os.X_OK):
        return dest
    download_file(
        f"https://github.com/cloudflare/cloudflared/releases/download/{version}/cloudflared-linux-amd64", dest
    )
    os.chmod(dest, 0o755)
    return dest


def download_model(repo, filename):
    os.makedirs(MODEL_DIR, exist_ok=True)
    dest = os.path.join(MODEL_DIR, filename)
    if os.path.exists(dest) and os.path.getsize(dest) > 1024 * 1024:
        log(f"Model already present: {dest}")
        return dest
    log(f"Downloading model {repo}/{filename}...")
    began = time.time()
    res = subprocess.run(["huggingface-cli", "download", repo, filename, "--local-dir", MODEL_DIR])
    if res.returncode != 0 or not os.path.exists(dest):
        log("huggingface-cli failed, falling back to curl")
        download_file(f"https://huggingface.co/{repo}/resolve/main/{filename}", dest)
    size = os.path.getsize(dest)
    log(f"Model downloaded: {size / 1e9:.1f} GB in {time.time() - began:.0f}s")
    return dest


def start_llama_server(bin_path, model_path, api_key, cfg):
    env = os.environ.copy()
    lib_dirs = [root for root, _, _ in os.walk(BIN_DIR)]
    env["LD_LIBRARY_PATH"] = f"{':'.join(lib_dirs)}:{env.get('LD_LIBRARY_PATH', '')}"
    cmd = [
        bin_path,
        "-m", model_path,
        "--host", "127.0.0.1",
        "--port", str(LLAMA_PORT),
        "--api-key", api_key,
        "-ngl", "99",
        "-c", str(cfg.get("context_size", 16384)),
        "-np", str(cfg.get("parallel", 1)),
        "--split-mode", "layer",
        "--jinja",
        "--reasoning-budget", str(cfg.get("reasoning_budget", -1)),
        *[str(arg) for arg in cfg.get("server_args", [])],
    ]
    log("Starting llama-server: " + " ".join(cmd).replace(api_key, "***"))
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True, bufsize=1
    )
    active_procs.append(proc)
    threading.Thread(
        target=lambda: [print(f"[llama] {line.rstrip()}", flush=True) for line in proc.stdout], daemon=True
    ).start()
    return proc


def wait_for_health(proc, timeout=600):
    start = time.time()
    while time.time() - start < timeout:
        if shutdown_event.is_set():
            return False
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server terminated prematurely with code {proc.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def start_tunnel(cloudflared_bin):
    proc = subprocess.Popen(
        [cloudflared_bin, "tunnel", "--url", f"http://127.0.0.1:{LLAMA_PORT}", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    active_procs.append(proc)
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    start = time.time()
    while time.time() - start < 60:
        if proc.poll() is not None:
            raise RuntimeError(f"cloudflared exited prematurely with code {proc.returncode}")
        line = proc.stdout.readline()
        if line:
            print(f"[tunnel] {line.strip()}", flush=True)
            match = url_pattern.search(line)
            if match:
                threading.Thread(
                    target=lambda: [print(f"[tunnel] {x.strip()}", flush=True) for x in proc.stdout], daemon=True
                ).start()
                return proc, match.group(0)
    proc.terminate()
    raise RuntimeError("Cloudflare tunnel failed to start")


# --- runtime ----------------------------------------------------------------


def idle_watchdog(idle_minutes, channel_id):
    limit_sec = idle_minutes * 60
    last_act = time.time()
    last_tokens = 0
    while not shutdown_event.is_set():
        time.sleep(30)
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{LLAMA_PORT}/slots", timeout=5) as resp:
                slots = json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
        tokens = sum(s.get("n_past", 0) for s in slots)
        busy = any(s.get("is_processing", False) for s in slots)
        if busy or tokens > last_tokens:
            last_act = time.time()
            last_tokens = tokens
        elif time.time() - last_act >= limit_sec:
            log(f"Idle for {idle_minutes}m. Auto-stopping to save GPU quota.")
            send_signal(channel_id, "stopped", {"reason": "idle_timeout"})
            shutdown_event.set()
            return


def supervise(channel_id, llama_proc, tunnel_proc, cloudflared_bin, gpu, model_name, max_runtime_seconds):
    """Keeps the session alive: restarts a dropped tunnel, fails fast if llama-server dies, enforces the time cap."""
    while not shutdown_event.is_set():
        time.sleep(2)
        if llama_proc.poll() is not None:
            raise RuntimeError(f"llama-server exited unexpectedly with code {llama_proc.returncode}")
        if time.time() - started_at >= max_runtime_seconds:
            log("Reached the maximum session length. Stopping before Kaggle ends the session.")
            send_signal(channel_id, "stopped", {"reason": "session_limit"})
            shutdown_event.set()
            return
        if tunnel_proc.poll() is not None:
            log("Tunnel process exited. Restarting it...")
            tunnel_proc, tunnel_url = start_tunnel(cloudflared_bin)
            send_signal(
                channel_id,
                "ready",
                {"tunnel_url": tunnel_url, "model": model_name, "gpu": gpu, "timings": timings, "reconnected": True},
            )
            log(f"Tunnel re-established: {tunnel_url}")


def load_config():
    return EMBEDDED_CONFIG


def main():
    global NTFY_URL, SIGNING_KEY
    cfg = load_config()
    NTFY_URL = cfg.get("ntfy_url", NTFY_URL)
    SIGNING_KEY = cfg.get("signing_key", "")
    channel_id = cfg["channel_id"]
    api_key = cfg["api_key"]
    model_name = cfg.get("model_name", "unknown")

    signal.signal(signal.SIGINT, lambda s, f: shutdown_event.set())
    signal.signal(signal.SIGTERM, lambda s, f: shutdown_event.set())

    gpu = get_gpu_info()
    log(f"GPU Hardware: {gpu}")
    send_signal(channel_id, "starting", {"gpu": gpu, "model": model_name})
    exit_code = 0

    try:
        # The model is the slowest download, so it runs alongside the binaries.
        model_result = {}

        def fetch_model():
            try:
                model_result["path"] = download_model(cfg["model_repo"], cfg["model_file"])
            except Exception as e:
                model_result["error"] = e

        send_signal(channel_id, "downloading_model", {"model": model_name})
        model_thread = threading.Thread(target=fetch_model, daemon=True)
        model_thread.start()

        bin_path = setup_llama_server(cfg.get("llama_tag", "b11647"))
        cloudflared = setup_cloudflared(cfg.get("cloudflared_version", "2026.9.3"))
        mark("binaries")

        model_thread.join()
        if "error" in model_result:
            raise model_result["error"]
        mark("model_download")

        llama_proc = start_llama_server(bin_path, model_result["path"], api_key, cfg)
        if not wait_for_health(llama_proc):
            raise RuntimeError("llama-server failed to report healthy")
        mark("server_ready")

        tunnel_proc, tunnel_url = start_tunnel(cloudflared)
        mark("tunnel")
        send_signal(
            channel_id,
            "ready",
            {"tunnel_url": tunnel_url, "model": model_name, "gpu": gpu, "timings": timings},
        )
        log(f"ktether online: {tunnel_url}")

        threading.Thread(target=control_loop, args=(channel_id,), daemon=True).start()
        threading.Thread(
            target=idle_watchdog, args=(cfg.get("idle_timeout_minutes", 45), channel_id), daemon=True
        ).start()
        supervise(
            channel_id,
            llama_proc,
            tunnel_proc,
            cloudflared,
            gpu,
            model_name,
            cfg.get("max_runtime_minutes", 700) * 60,
        )
    except Exception as e:
        exit_code = 1
        log(f"FATAL ERROR: {e}\n{traceback.format_exc()}")
        send_signal(channel_id, "stopped", {"reason": f"error: {e}"})
    finally:
        for proc in active_procs:
            try:
                proc.terminate()
            except Exception:
                pass
        if exit_code == 0:
            send_signal(channel_id, "stopped", {"reason": "session_finished"})
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
