import path from "node:path"

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined

export function selfCommand(execArgv: readonly string[] = process.execArgv) {
  const runtime = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase()
  if (runtime !== "bun" && runtime !== "node" && runtime !== "nodejs") return [process.execPath]
  if (!entrypoint) throw new Error("Failed to resolve CLI entrypoint")
  if (runtime === "node" || runtime === "nodejs") return [process.execPath, ...nodeFlags(), entrypoint]
  return [process.execPath, ...bunFlags(execArgv), entrypoint]
}

// Bun reads JSX preloads from the bunfig.toml in the working directory, which only the CLI package has. A preload
// passed on the command line (as the `ktether` shim does) must reach the server too, or it crashes when started
// from any other directory.
function bunFlags(execArgv: readonly string[]) {
  return execArgv.flatMap((arg, index) => {
    if (arg.startsWith("--preload=")) return [arg]
    if (arg === "--preload" && execArgv[index + 1]) return [arg, execArgv[index + 1]]
    return []
  })
}

function nodeFlags() {
  return process.execArgv.flatMap((arg, index, args) => {
    if (index > 0 && args[index - 1] === "--conditions") return []
    if (arg === "--conditions") return args[index + 1] ? [arg, args[index + 1]] : []
    if (arg.startsWith("--conditions=")) return [arg]
    if (
      arg === "--experimental-ffi" ||
      arg === "--use-system-ca" ||
      arg === "--enable-source-maps" ||
      arg === "--no-addons"
    )
      return [arg]
    if (arg === "--no-warnings" || arg.startsWith("--disable-warning=")) return [arg]
    return []
  })
}
