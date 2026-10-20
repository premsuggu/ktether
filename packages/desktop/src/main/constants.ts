import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.KTETHER_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.KTETHER_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "ktether Dev",
  beta: "ktether Beta",
  prod: "ktether",
}

const appIDs: Record<string, string> = {
  dev: "ai.ktether.desktop.dev",
  beta: "ai.ktether.desktop.beta",
  prod: "ai.ktether.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "ktether Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.ktether.desktop.dev"
