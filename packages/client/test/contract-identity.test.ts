import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "@ktether/schema/agent"
import { Config } from "@ktether/schema/config"
import { Model } from "@ktether/schema/model"
import { Prompt } from "@ktether/schema/prompt"
import { Session } from "@ktether/schema/session"
import { SessionMessage } from "@ktether/schema/session-message"
import { Vcs } from "@ktether/schema/vcs"

const Client = await import("../src/effect")

test("effect entrypoint exposes canonical Schema contracts", () => {
  expect(Client.Agent).toBe(Agent)
  expect(Client.Config).toBe(Config)
  expect(Client.Model).toBe(Model)
  expect(Client.Session).toBe(Session)
  expect(Client.Vcs.Base).toBe(Vcs.Base)
})

test("generated Effect API names canonical and composed outputs", async () => {
  const source = await Bun.file(new URL("../src/effect/api/api.ts", import.meta.url)).text()

  expect(source).toContain("export type SessionGetOutput = Session.Info")
  expect(source).toContain("export type EventSubscribeOutput = KTetherEvent")
  expect(source).not.toContain("HttpApiClient.ForApi")
})

test("shared DTO schemas construct and decode plain objects", () => {
  const made = Prompt.make({ text: "hello" })
  const decoded = Schema.decodeUnknownSync(Prompt)({ text: "hello" })
  const content = Schema.decodeUnknownSync(SessionMessage.AssistantText)({ type: "text", id: "part_1", text: "hi" })

  expect(Object.getPrototypeOf(made)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
  expect(Prompt.ast.annotations?.identifier).toBe("Prompt")
  expect(SessionMessage.AssistantText.ast.annotations?.identifier).toBe("Session.Message.Assistant.Text")
})
