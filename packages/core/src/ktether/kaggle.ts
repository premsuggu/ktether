import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

/** The only Kaggle notebook ktether ever creates, updates or deletes. */
export const KERNEL_SLUG = "ktether-runner"
export const kernelRef = (username: string): string => `${username}/${KERNEL_SLUG}`

export interface CliResult {
  readonly status: number | null
  readonly output: string
  readonly error?: Error
}

export type CliRunner = (args: readonly string[]) => CliResult

const defaultRunner: CliRunner = (args) => {
  const res = spawnSync("kaggle", [...args], {
    encoding: "utf-8",
    // The background service has no console on Windows, so without this every call flashes a terminal window.
    windowsHide: true,
  })
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`
    .split("\n")
    .filter((line) => !/outdated `kaggle` version/.test(line))
    .join("\n")
    .trim()
  return { status: res.status, output, error: res.error }
}

let runner: CliRunner = defaultRunner

/** Replaces the process spawner. For tests only. */
export const setCliRunner = (next: CliRunner | undefined): void => {
  runner = next ?? defaultRunner
}

function run(args: readonly string[]): CliResult {
  const result = runner(args)
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error("The Kaggle CLI was not found on PATH. Install it with `pip install kaggle` and try again.")
  }
  return result
}

export function getCredentials(): { username: string; key: string } {
  if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) {
    return { username: process.env.KAGGLE_USERNAME, key: process.env.KAGGLE_KEY }
  }
  const credsPath = path.join(os.homedir(), ".kaggle", "kaggle.json")
  if (!fs.existsSync(credsPath)) {
    throw new Error(
      `Kaggle credentials not found at ${credsPath}.\n` +
        "Download kaggle.json from https://www.kaggle.com/settings and place it there, " +
        "or set KAGGLE_USERNAME and KAGGLE_KEY.",
    )
  }
  const data = JSON.parse(fs.readFileSync(credsPath, "utf-8"))
  if (!data.username || !data.key) throw new Error("Invalid kaggle.json: missing 'username' or 'key'")
  return { username: data.username, key: data.key }
}

export type KernelStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "ERROR" | "CANCEL_REQUESTED" | "CANCEL_ACKNOWLEDGED" | string

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETE",
  "ERROR",
  "CANCEL_REQUESTED",
  "CANCEL_ACKNOWLEDGED",
])

export function parseKernelStatus(output: string): KernelStatus | undefined {
  return /KernelWorkerStatus\.([A-Z_]+)/.exec(output)?.[1]
}

export const getKernelStatus = (username: string): KernelStatus | undefined =>
  parseKernelStatus(run(["kernels", "status", kernelRef(username)]).output)

export function pushKernel(stagingDir: string): string {
  const res = run(["kernels", "push", "-p", stagingDir, "--accelerator", "NvidiaTeslaT4"])
  if (res.status !== 0) throw new Error(`Kaggle push failed: ${res.output}`)
  return res.output
}

export const getKernelOutput = (username: string): string => run(["kernels", "output", kernelRef(username)]).output

/** Deletes the ktether notebook (and all its versions) from the user's Kaggle account. */
export function deleteKernel(username: string): { deleted: boolean; message: string } {
  const res = run(["kernels", "delete", kernelRef(username), "--yes"])
  return { deleted: res.status === 0, message: res.output }
}

export async function waitForKernelIdle(
  username: string,
  timeoutSeconds: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): Promise<KernelStatus | undefined> {
  const deadline = now() + timeoutSeconds * 1000
  let status = getKernelStatus(username)
  while (status === "RUNNING" && now() < deadline) {
    await sleep(5000)
    status = getKernelStatus(username)
  }
  return status
}

export function cliVersion(): string | undefined {
  const res = run(["--version"])
  return res.status === 0 ? /(\d+\.\d+\.\d+)/.exec(res.output)?.[1] : undefined
}
