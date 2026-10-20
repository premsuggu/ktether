import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "../errors.js"

export const KTetherModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  default: Schema.Boolean,
  sizeGB: Schema.Number,
  /** Context window per server slot, in tokens. */
  context: Schema.Number,
  parallel: Schema.Number,
  minVramGB: Schema.Number,
  /** Whether the model reliably emits structured tool calls, which an agent needs. */
  toolCalling: Schema.Literals(["reliable", "unreliable"]),
  description: Schema.String,
}).annotate({ identifier: "KTetherModel" })

export const KTetherOperation = Schema.Struct({
  kind: Schema.Literals(["start", "stop", "clean", "reconnect"]),
  startedAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
  /** Set when the operation failed. */
  error: Schema.optional(Schema.String),
  /** The most recent progress lines, oldest first. */
  log: Schema.Array(Schema.String),
}).annotate({ identifier: "KTetherOperation" })

export const KTetherStatus = Schema.Struct({
  state: Schema.Literals(["stopped", "pending", "ready", "unreachable"]),
  /** Kaggle's view of the notebook, when Kaggle credentials are available. */
  kernel: Schema.optional(Schema.String),
  hasCredentials: Schema.Boolean,
  /** Set when a session whose kernel already ended was closed during this check. */
  closedStaleSession: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  latencyMs: Schema.optional(Schema.Number),
  uptimeMinutes: Schema.optional(Schema.Number),
  /** How long each boot stage of the current session took, in the order they ran. */
  bootStages: Schema.optional(Schema.Array(Schema.Struct({ stage: Schema.String, seconds: Schema.Number }))),
  slots: Schema.optional(Schema.Struct({ busy: Schema.Number, total: Schema.Number })),
  usage: Schema.Struct({
    /** GPU hours ktether itself used in the last 7 days. Kaggle does not expose the real remaining quota. */
    hoursLastWeek: Schema.Number,
    quotaHours: Schema.Number,
  }),
  /** The most recent start, stop, clean or reconnect, including its progress log. */
  operation: Schema.optional(KTetherOperation),
}).annotate({ identifier: "KTetherStatus" })

export const KTetherDoctorCheck = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
}).annotate({ identifier: "KTetherDoctorCheck" })

const operationResponse = (identifier: string) =>
  Schema.Struct({ data: KTetherOperation }).annotate({ identifier })

export const KTetherGroup = HttpApiGroup.make("server.ktether")
  .add(
    HttpApiEndpoint.get("ktether.status", "/api/ktether", {
      success: Schema.Struct({ data: KTetherStatus }).annotate({ identifier: "KTetherStatusResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.status",
        summary: "Get ktether status",
        description:
          "Return the Kaggle GPU session: its state, endpoint health, boot timings, slot usage, and the latest operation with its progress log.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("ktether.models", "/api/ktether/models", {
      success: Schema.Struct({ data: Schema.Array(KTetherModel) }).annotate({ identifier: "KTetherModelsResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.models",
        summary: "List ktether models",
        description: "Return the curated models that can be served on the Kaggle GPU.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("ktether.doctor", "/api/ktether/doctor", {
      success: Schema.Struct({ data: Schema.Array(KTetherDoctorCheck) }).annotate({
        identifier: "KTetherDoctorResponse",
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.doctor",
        summary: "Check ktether prerequisites",
        description: "Check the Kaggle CLI, Kaggle credentials and network access that ktether needs.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ktether.start", "/api/ktether/start", {
      payload: Schema.Struct({
        model: Schema.optional(Schema.String),
        idleTimeoutMinutes: Schema.optional(Schema.Number),
      }),
      success: operationResponse("KTetherStartResponse"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.start",
        summary: "Start the Kaggle GPU",
        description:
          "Begin provisioning a Kaggle GPU and return immediately. Poll ktether.status for the progress log and the result. Resumes a launch that is already queued instead of pushing a second kernel.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ktether.stop", "/api/ktether/stop", {
      payload: Schema.Struct({ delete: Schema.optional(Schema.Boolean) }),
      success: operationResponse("KTetherStopResponse"),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.stop",
        summary: "Stop the Kaggle GPU",
        description: "Send an authenticated stop to the kernel and close the session. Optionally delete the notebook too.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ktether.clean", "/api/ktether/clean", {
      payload: Schema.Struct({ confirm: Schema.optional(Schema.Boolean) }),
      success: operationResponse("KTetherCleanResponse"),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.clean",
        summary: "Delete the ktether notebook",
        description:
          "Stop any session and delete the ktether-runner notebook from the Kaggle account. Without confirm this only previews. No other notebook is ever touched.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ktether.reconnect", "/api/ktether/reconnect", {
      success: operationResponse("KTetherReconnectResponse"),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ktether.reconnect",
        summary: "Reconnect to a replaced tunnel",
        description: "Re-attach to a running session whose tunnel the kernel replaced after a drop.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "ktether",
      description: "Control the free Kaggle GPU that serves the ktether models.",
    }),
  )
