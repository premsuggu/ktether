import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.KTETHER_PASSWORD
  const previousLegacyPassword = process.env.KTETHER_SERVER_PASSWORD
  const previousValue = process.env.KTETHER_SESSION_ENV_TEST
  process.env.KTETHER_PASSWORD = "password"
  process.env.KTETHER_SERVER_PASSWORD = "legacy"
  process.env.KTETHER_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.KTETHER_PASSWORD
  else process.env.KTETHER_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.KTETHER_SERVER_PASSWORD
  else process.env.KTETHER_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.KTETHER_SESSION_ENV_TEST
  else process.env.KTETHER_SESSION_ENV_TEST = previousValue

  expect(environment.KTETHER_PASSWORD).toBeUndefined()
  expect(environment.KTETHER_SERVER_PASSWORD).toBeUndefined()
  expect(environment.KTETHER_SESSION_ENV_TEST).toBe("included")
})
