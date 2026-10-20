import { createReactiveTimelineProjection } from "@ktether/session-ui/timeline/projection"

export { reuseTimelineRows } from "@ktether/session-ui/timeline/projection"

export function createTimelineProjection(input: Parameters<typeof createReactiveTimelineProjection>[0]) {
  return createReactiveTimelineProjection(input)
}
