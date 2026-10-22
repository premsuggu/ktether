import { describe, expect, test } from "bun:test"
import { selfCommand } from "../../src/util/process"

describe("selfCommand", () => {
  test("passes a Bun preload to the server it spawns", () => {
    const command = selfCommand(["--preload", "/app/preload.js", "-e", "ignored"])
    expect(command.slice(1, 3)).toEqual(["--preload", "/app/preload.js"])
    expect(command).not.toContain("-e")
  })

  test("passes a preload given as one argument", () => {
    expect(selfCommand(["--preload=/app/preload.js"])[1]).toBe("--preload=/app/preload.js")
  })

  test("adds no flags when none were given", () => {
    expect(selfCommand([]).length).toBe(2)
  })
})
