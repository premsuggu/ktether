import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { renderKernelScript } from "@ktether/core/ktether/bundle"
import { createStopMessage, generateSigningKey, openEnvelope } from "@ktether/core/ktether/signaling"

const python = ["python", "python3"].find((bin) => spawnSync(bin, ["--version"]).status === 0)

// Drives the real generated kernel script (without starting any server) to prove that what Python signs is what
// TypeScript verifies, and vice versa. Skipped where no Python is available.
describe.skipIf(!python)("generated kernel script", () => {
  const key = generateSigningKey()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ktether-kernel-test-"))
  const scriptPath = path.join(dir, "server.py")
  fs.writeFileSync(scriptPath, renderKernelScript({ channel_id: "kt_test", signing_key: key }), "utf-8")

  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("kernel", sys.argv[1])
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)
kernel.SIGNING_KEY = sys.argv[2]
sent = {}
kernel.urllib.request.urlopen = lambda req, timeout=None: sent.update(url=req.full_url, body=req.data.decode())
kernel.send_signal("kt_test", "ready", {"tunnel_url": "https://a-b.trycloudflare.com", "model": "m"})
print(json.dumps({
  "sent": sent,
  "stop_valid": kernel.is_valid_stop(sys.argv[3]),
  "stop_forged": kernel.is_valid_stop("STOP:" + sys.argv[3].split(":")[1] + ":deadbeef"),
}))
`

  const run = (stopMessage: string) => {
    const res = spawnSync(python!, ["-I", "-c", driver, scriptPath, key, stopMessage], { encoding: "utf-8" })
    expect(res.status).toBe(0)
    return JSON.parse(res.stdout)
  }

  test("signals are verifiable by the TypeScript side and carry no api key", () => {
    const out = run(createStopMessage(key))
    expect(out.sent.url).toBe("https://ntfy.sh/kt_test")
    const payload = openEnvelope(key, out.sent.body)
    expect(payload).toMatchObject({ event: "ready", tunnel_url: "https://a-b.trycloudflare.com" })
    expect(out.sent.body).not.toContain("api_key")
    expect(openEnvelope(generateSigningKey(), out.sent.body)).toBeUndefined()
  })

  test("accepts stop messages created by the TypeScript side and rejects forgeries", () => {
    const out = run(createStopMessage(key))
    expect(out.stop_valid).toBe(true)
    expect(out.stop_forged).toBe(false)
    expect(run(createStopMessage(generateSigningKey())).stop_valid).toBe(false)
  })
})
