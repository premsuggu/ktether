import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { buildKernelConfig, prepareStagingBundle, removeStagingBundle, renderKernelScript } from "@opencode/core/ktether/bundle"
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@opencode/core/ktether/registry"

const python = ["python", "python3"].find((bin) => spawnSync(bin, ["--version"]).status === 0)
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeStagingBundle(dir)
})

describe("kernel config", () => {
  test("gives each slot the model's full context window", () => {
    const config = buildKernelConfig("qwen3.6-27b", 45)
    expect(config.parallel).toBe(2)
    expect(config.context_size).toBe(AVAILABLE_MODELS["qwen3.6-27b"].context * 2)
  })

  test("falls back to the default model for an unknown key", () => {
    expect(buildKernelConfig("nope", 45).model_name).toBe(DEFAULT_MODEL)
  })

  test("generates fresh credentials every time", () => {
    const [a, b] = [buildKernelConfig(DEFAULT_MODEL, 45), buildKernelConfig(DEFAULT_MODEL, 45)]
    expect(a.api_key).not.toBe(b.api_key)
    expect(a.signing_key).not.toBe(b.signing_key)
    expect(a.channel_id).not.toBe(b.channel_id)
  })

  test("caps the session below Kaggle's 12 hour limit", () => {
    expect(buildKernelConfig(DEFAULT_MODEL, 45).max_runtime_minutes).toBeLessThan(12 * 60)
  })
})

describe("staging bundle", () => {
  test("contains the script and metadata, scoped to the ktether notebook only", () => {
    const bundle = prepareStagingBundle("alice", DEFAULT_MODEL, 30)
    dirs.push(bundle.stagingDir)
    expect(fs.readdirSync(bundle.stagingDir).sort()).toEqual(["kernel-metadata.json", "server.py"])
    const metadata = JSON.parse(fs.readFileSync(path.join(bundle.stagingDir, "kernel-metadata.json"), "utf-8"))
    expect(metadata).toMatchObject({ id: "alice/ktether-runner", enable_gpu: "true", is_private: "true", accelerator: "NvidiaTeslaT4" })
  })

  test("keeps credentials out of the metadata and embeds them only in the private script", () => {
    const bundle = prepareStagingBundle("alice", DEFAULT_MODEL, 30)
    dirs.push(bundle.stagingDir)
    const metadata = fs.readFileSync(path.join(bundle.stagingDir, "kernel-metadata.json"), "utf-8")
    const script = fs.readFileSync(path.join(bundle.stagingDir, "server.py"), "utf-8")
    expect(metadata).not.toContain(bundle.apiKey)
    expect(metadata).not.toContain(bundle.signingKey)
    expect(script).toContain(bundle.apiKey)
    expect(script).toContain(bundle.signingKey)
  })

  test("each launch gets its own directory, and removal deletes it", () => {
    const a = prepareStagingBundle("alice", DEFAULT_MODEL, 30)
    const b = prepareStagingBundle("alice", DEFAULT_MODEL, 30)
    expect(a.stagingDir).not.toBe(b.stagingDir)
    removeStagingBundle(a.stagingDir)
    removeStagingBundle(b.stagingDir)
    expect(fs.existsSync(a.stagingDir) || fs.existsSync(b.stagingDir)).toBe(false)
  })

  test.skipIf(!python)("the uploaded script is valid Python, even with hostile characters in the config", () => {
    const script = renderKernelScript({ channel_id: "kt_1", note: 'quote " backslash \\ newline \n unicode   done' })
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? "/tmp"), "ktether-py-"))
    dirs.push(dir)
    const file = path.join(dir, "server.py")
    fs.writeFileSync(file, script)
    const res = spawnSync(python!, ["-I", "-m", "py_compile", file], { encoding: "utf-8" })
    expect(res.stderr).toBe("")
    expect(res.status).toBe(0)
  })
})
