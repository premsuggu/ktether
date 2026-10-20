import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { renderKernelScript } from "./bundle"

const python = ["python", "python3"].find((bin) => spawnSync(bin, ["--version"]).status === 0)

const KEY = "ab".repeat(32)

/**
 * Drives the real generated kernel script with fake subprocesses, so the supervision, concurrency and failure
 * paths run here instead of on a billed Kaggle GPU.
 */
describe.skipIf(!python)("kernel server behaviour", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ktether-kernel-behaviour-"))
  const scriptPath = path.join(dir, "server.py")
  const config = {
    channel_id: "kt_test",
    api_key: "kgp_secret",
    signing_key: KEY,
    model_repo: "r/m",
    model_file: "m.gguf",
    model_name: "m",
    idle_timeout_minutes: 45,
  }
  fs.writeFileSync(scriptPath, renderKernelScript(config), "utf-8")

  const driver = `
import importlib.util, json, sys, threading, time
spec = importlib.util.spec_from_file_location("kernel", sys.argv[1])
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)
k.SIGNING_KEY = sys.argv[2]
scenario = sys.argv[3]

signals = []
k.send_signal = lambda channel, event, data: signals.append({"event": event, **data})
real_sleep = time.sleep
k.time.sleep = lambda s: real_sleep(0.001)

class Proc:
    def __init__(self, alive=True, code=None):
        self.alive, self.returncode, self.terminated = alive, code, False
    def poll(self):
        return None if self.alive else self.returncode
    def terminate(self):
        self.terminated = True

def finish(extra=None):
    print(json.dumps({"signals": signals, **(extra or {})}))

if scenario == "tunnel_restart":
    tunnels = []
    def fake_start_tunnel(binary):
        proc = Proc()
        tunnels.append(proc)
        return proc, "https://new-tunnel.trycloudflare.com"
    k.start_tunnel = fake_start_tunnel
    dead = Proc(alive=False, code=1)
    llama = Proc()
    calls = {"n": 0}
    real_poll = dead.poll
    def stop_after_restart():
        while not tunnels:
            time.sleep(0.001)
        k.shutdown_event.set()
    threading.Thread(target=stop_after_restart, daemon=True).start()
    k.supervise("kt_test", llama, dead, "cloudflared", "T4", "m", 10**6)
    finish({"restarts": len(tunnels)})

elif scenario == "llama_died":
    try:
        k.supervise("kt_test", Proc(alive=False, code=137), Proc(), "cloudflared", "T4", "m", 10**6)
        finish({"raised": None})
    except RuntimeError as e:
        finish({"raised": str(e)})

elif scenario == "session_limit":
    k.supervise("kt_test", Proc(), Proc(), "cloudflared", "T4", "m", 0)
    finish({"shutdown": k.shutdown_event.is_set()})

elif scenario == "main_ok" or scenario == "main_download_fails":
    order = []
    def slow_download(repo, filename):
        order.append("download_start")
        time.sleep(0.3)
        if scenario == "main_download_fails":
            raise RuntimeError("HTTP 401 from Hugging Face")
        order.append("download_end")
        return "/tmp/models/" + filename
    def fast_binary(tag):
        order.append("binaries")
        return "/tmp/llama-server"
    k.download_model = slow_download
    k.setup_llama_server = fast_binary
    k.setup_cloudflared = lambda version: "/tmp/cloudflared"
    k.start_llama_server = lambda *a: Proc()
    k.wait_for_health = lambda proc, timeout=600: True
    k.start_tunnel = lambda binary: (Proc(), "https://ok-tunnel.trycloudflare.com")
    k.control_loop = lambda channel: None
    k.idle_watchdog = lambda minutes, channel: None
    def stop_supervise(*args):
        k.shutdown_event.set()
    k.supervise = stop_supervise
    k.EMBEDDED_CONFIG.update(json.loads(sys.argv[4]))
    code = None
    try:
        k.main()
    except SystemExit as e:
        code = e.code
    finish({"order": order, "exit": code, "timings": sorted(k.timings)})
`

  const run = (scenario: string) => {
    const res = spawnSync(python!, ["-I", "-c", driver, scriptPath, KEY, scenario, JSON.stringify(config)], {
      encoding: "utf-8",
      timeout: 30_000,
    })
    expect(res.stderr).toBe("")
    expect(res.status).toBe(0)
    return JSON.parse(res.stdout.trim().split("\n").at(-1)!)
  }

  test("restarts a dropped tunnel and publishes the new URL as a reconnect", () => {
    const out = run("tunnel_restart")
    expect(out.restarts).toBe(1)
    const ready = out.signals.find((s: { event: string }) => s.event === "ready")
    expect(ready).toMatchObject({ tunnel_url: "https://new-tunnel.trycloudflare.com", reconnected: true })
  })

  test("fails fast when llama-server dies", () => {
    expect(run("llama_died").raised).toContain("exited unexpectedly with code 137")
  })

  test("stops itself at the session limit and tells the laptop why", () => {
    const out = run("session_limit")
    expect(out.shutdown).toBe(true)
    expect(out.signals).toContainEqual(expect.objectContaining({ event: "stopped", reason: "session_limit" }))
  })

  test("downloads the model while the binaries are being set up, and reports every boot stage", () => {
    const out = run("main_ok")
    expect(out.order).toEqual(["download_start", "binaries", "download_end"])
    expect(out.timings).toEqual(["binaries", "model_download", "server_ready", "tunnel"])
    const ready = out.signals.find((s: { event: string }) => s.event === "ready")
    expect(ready.timings).toBeDefined()
    expect(JSON.stringify(out.signals)).not.toContain("kgp_secret")
    expect(out.exit).toBe(0)
  })

  test("reports a failed download as a stopped signal with the reason and exits non-zero", () => {
    const out = run("main_download_fails")
    expect(out.signals).toContainEqual(expect.objectContaining({ event: "stopped", reason: "error: HTTP 401 from Hugging Face" }))
    expect(out.signals.some((s: { event: string }) => s.event === "ready")).toBe(false)
    expect(out.exit).toBe(1)
  })
})
