import type { KTetherClient, KTetherEvent } from "@ktether/client"
import { createClientConnection, createPersistentPtyClient } from "@ktether/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"

type ManagedService = {
  reconnect: (signal: AbortSignal) => Promise<{ api: KTetherClient; url?: string }>
  restart: () => Promise<void>
}

type ClientEventMap = { [Type in KTetherEvent["type"]]: Extract<KTetherEvent, { type: Type }> }

export const { use: useClient, provider: ClientProvider } = createSimpleContext({
  name: "Client",
  init: (props: { api: KTetherClient; url?: string; service?: ManagedService }) => {
    const log = useLog({ component: "client" })
    const service = props.service
    const events = createGlobalEmitter<ClientEventMap>()
    let api = props.api
    let url = props.url
    let persistentPty = url ? createPersistentPtyClient(api, { url }) : undefined

    const connection = createClientConnection(api, {
      reconnect: service
        ? async (signal) => {
            const next = await service.reconnect(signal)
            api = next.api
            if (next.url) url = next.url
            if (url) persistentPty = createPersistentPtyClient(api, { url })
            return api
          }
        : undefined,
      onEvent(event) {
        events.emit(event.type, event)
      },
      log,
    })

    onCleanup(() => {
      events.clear()
    })

    return {
      get api() {
        return api
      },
      get persistentPty() {
        if (!persistentPty) throw new Error("Persistent terminal server endpoint is unavailable")
        return persistentPty
      },
      event: {
        on: events.on,
        listen: events.listen,
      },
      connection,
      restart: service?.restart,
    }
  },
})
