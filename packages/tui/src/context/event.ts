import type { KTetherEvent } from "@ktether/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type KTetherEventMap = { [Type in KTetherEvent["type"]]: Extract<KTetherEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: KTetherEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends KTetherEvent["type"]>(
    type: T,
    handler: (event: KTetherEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory })
    })
  }

  return {
    subscribe,
    on,
  }
}
