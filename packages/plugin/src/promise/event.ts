import type { EventApi } from "@ktether/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
