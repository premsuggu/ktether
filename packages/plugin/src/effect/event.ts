import type { EventApi } from "@ktether/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
