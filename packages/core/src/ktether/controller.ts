import {
  cleanSession,
  getStatus,
  reconnectSession,
  runDoctor,
  startSession,
  stopSession,
  type Deps,
  type DoctorCheck,
  type StatusSnapshot,
} from "./lifecycle.js"
import { AVAILABLE_MODELS, DEFAULT_MODEL, type ModelSpec } from "./registry.js"

export type OperationKind = "start" | "stop" | "clean" | "reconnect"

export interface Operation {
  readonly kind: OperationKind
  readonly startedAt: number
  readonly finishedAt?: number
  /** Set when the operation failed. */
  readonly error?: string
  /** The most recent progress lines, oldest first. */
  readonly log: readonly string[]
}

export interface StatusWithOperation extends StatusSnapshot {
  readonly operation?: Operation
}

export class OperationInProgressError extends Error {
  readonly kind: OperationKind
  constructor(kind: OperationKind) {
    super(`A ${kind} operation is already running`)
    this.kind = kind
  }
}

export class UnknownModelError extends Error {
  readonly model: string
  constructor(model: string) {
    super(`Unknown model '${model}'. Run 'ktether models' for the available models.`)
    this.model = model
  }
}

const MAX_LOG_LINES = 200

/**
 * Runs ktether operations in the background and remembers the latest one.
 *
 * Starting a Kaggle GPU takes minutes, so a client cannot wait on a single request. `start`, `stop`, `clean` and
 * `reconnect` return as soon as the operation has begun and clients poll `status` for the log and the result. One
 * operation runs at a time because they all drive the same notebook and the same session file.
 */
export function createController(base: Deps = {}) {
  let latest: { kind: OperationKind; startedAt: number; finishedAt?: number; error?: string; log: string[] } | undefined

  const view = (): Operation | undefined => (latest ? { ...latest, log: [...latest.log] } : undefined)

  const begin = (kind: OperationKind, task: (deps: Deps) => Promise<unknown>): Operation => {
    if (latest && latest.finishedAt === undefined) throw new OperationInProgressError(latest.kind)
    const operation = { kind, startedAt: Date.now(), finishedAt: undefined as number | undefined, error: undefined as string | undefined, log: [] as string[] }
    latest = operation
    const out = (line: string) => {
      operation.log.push(line)
      if (operation.log.length > MAX_LOG_LINES) operation.log.shift()
    }
    void task({ ...base, out })
      .catch((error: unknown) => {
        operation.error = error instanceof Error ? error.message : String(error)
        out(`Error: ${operation.error}`)
      })
      .finally(() => {
        operation.finishedAt = Date.now()
      })
    return view()!
  }

  return {
    status: async (): Promise<StatusWithOperation> => ({ ...(await getStatus(base)), operation: view() }),

    models: (): readonly ModelSpec[] => Object.values(AVAILABLE_MODELS),

    start: (input: { readonly model?: string; readonly idleTimeoutMinutes?: number } = {}): Operation => {
      const model = input.model ?? DEFAULT_MODEL
      if (!AVAILABLE_MODELS[model]) throw new UnknownModelError(model)
      return begin("start", (deps) => startSession({ model, timeoutMinutes: input.idleTimeoutMinutes ?? 45 }, deps))
    },

    stop: (input: { readonly delete?: boolean } = {}): Operation =>
      begin("stop", (deps) => stopSession({ delete: input.delete ?? false }, deps)),

    /** Without `confirm` this only previews what would be deleted. */
    clean: (input: { readonly confirm?: boolean } = {}): Operation =>
      begin("clean", (deps) => cleanSession({ yes: input.confirm ?? false }, deps)),

    reconnect: (): Operation => begin("reconnect", (deps) => reconnectSession(deps)),

    doctor: (): Promise<DoctorCheck[]> => runDoctor(base),
  }
}

export type Controller = ReturnType<typeof createController>

/** The process-wide controller used by the server. */
export const controller: Controller = createController()
