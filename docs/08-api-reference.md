# 8. HTTP API: the `ktether` routes

The ktether server exposes the Kaggle GPU controls over HTTP. The CLI, the terminal UI and any future app use these
same routes. They are defined in `packages/protocol/src/groups/ktether.ts`, implemented in
`packages/server/src/handlers/ktether.ts`, and a typed client is generated from the definition
(`packages/client`, property `ktether`). The OpenAPI description of the whole API is in `schema/openapi.json`.

These routes drive one machine-wide resource (your Kaggle session), so unlike project routes they take **no
`location` parameter**.

## 8.1 Calling them

The easiest way is the CLI's `api` command, which handles connecting and authentication for you:

```bash
ktether api ktether.status
ktether api POST /api/ktether/start --data '{"model":"qwen3.6-27b"}'
```

From code, use the generated client:

```ts
import { KTether } from "@ktether/client"

const client = KTether.make({ baseUrl: server.endpoint.url, headers })
const status = await client.ktether.status()
await client.ktether.start({ model: "qwen3.6-27b" })
```

The promise client returns the contents of the response's `data` field directly. The server itself requires
authentication; see [15-configuration.md](15-configuration.md) and `packages/cli/src/services/server-connection.ts`.

> **Absent optional fields are sent as JSON `null`.** For example `finishedAt` is `null` while an operation runs.
> Check with `!= null` when reading raw JSON.

## 8.2 Routes

| Operation id | Method and path | Purpose |
| --- | --- | --- |
| `ktether.status` | `GET /api/ktether` | Session state, health, timings, slots, usage and the latest operation |
| `ktether.models` | `GET /api/ktether/models` | The curated models |
| `ktether.doctor` | `GET /api/ktether/doctor` | Prerequisite checks |
| `ktether.start` | `POST /api/ktether/start` | Begin provisioning (returns immediately) |
| `ktether.stop` | `POST /api/ktether/stop` | Stop the session |
| `ktether.clean` | `POST /api/ktether/clean` | Delete the notebook (preview unless confirmed) |
| `ktether.reconnect` | `POST /api/ktether/reconnect` | Re-attach to a replaced tunnel |

### Long-running operations

`start`, `stop`, `clean` and `reconnect` **do not wait**. They begin the work in the background and return an
`Operation` at once; poll `GET /api/ktether` and read `operation` for the progress log and the result. Only one
operation runs at a time: a second request while one is running gets **409** with a `ConflictError` whose message
says what is running. The CLI turns that into "following its progress".

## 8.3 Schemas

**Status** (`GET /api/ktether`)

| Field | Type | Meaning |
| --- | --- | --- |
| `state` | `stopped`, `pending`, `ready`, `unreachable` | See [03-architecture.md](03-architecture.md#34-the-session-state-machine) |
| `hasCredentials` | boolean | Whether Kaggle credentials were found |
| `kernel` | string, optional | Kaggle's status for the notebook (`QUEUED`, `RUNNING`, `COMPLETE`, ...) |
| `closedStaleSession` | string, optional | Set when this check closed a session whose notebook had already ended |
| `model` | string, optional | Active model id |
| `url` | string, optional | The tunnel address (**no key is ever included**) |
| `latencyMs`, `uptimeMinutes` | number, optional | Health latency; minutes since the session became ready |
| `bootStages` | array of `{stage, seconds}`, optional | How long each boot stage took |
| `slots` | `{busy, total}`, optional | Server slots in use |
| `usage` | `{hoursLastWeek, quotaHours}` | ktether's own GPU-hour estimate; `quotaHours` is 30 |
| `operation` | `Operation`, optional | The most recent operation |

**Operation**

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `start`, `stop`, `clean`, `reconnect` | Which operation |
| `startedAt`, `finishedAt` | number (ms), `finishedAt` optional | Wall-clock times; `finishedAt` is absent while running |
| `error` | string, optional | Present when the operation failed |
| `log` | array of strings | The latest progress lines (at most 200), oldest first. Kept in the server's memory, lost on restart. |

**Model** (`GET /api/ktether/models`): `id`, `name`, `default`, `sizeGB`, `context` (tokens per slot), `parallel`,
`minVramGB`, `toolCalling` (`reliable` or `unreliable`), `description`.

**Doctor check**: `name`, `ok`, `detail`.

## 8.4 Request bodies

| Route | Body (all fields optional) |
| --- | --- |
| `start` | `model` (default `qwen3.6-27b`), `idleTimeoutMinutes` (default 45) |
| `stop` | `delete` (also delete the notebook) |
| `clean` | `confirm` (without it, only a preview is produced in the log) |
| `reconnect` | none |

## 8.5 Errors

| Status | Error | When |
| --- | --- | --- |
| 400 | `InvalidRequestError` (`field: "model"`) | `start` with a model that is not in the registry |
| 409 | `ConflictError` | Another operation is already running |

Failures of the operation itself (a failed push, a crashed notebook) are **not** HTTP errors: the request succeeded,
and the failure is reported in `operation.error` and the log.

## 8.6 What the routes never do

- They never return the API key, the signing key, the channel id or the Kaggle credentials. A server test asserts
  that the status response contains no `kgp_`, `signingKey` or `apiKey`.
- `clean` can only ever delete the one notebook named `<you>/ktether-runner`.

## 8.7 Adding or changing a route

Follow the recipe in [14-development.md](14-development.md): edit the group in `packages/protocol`, register it in
`api.ts` and `client.ts`, implement it in `packages/server`, run `bun run generate` in `packages/client` (never edit the
generated files), then use it from the CLI or UI.
