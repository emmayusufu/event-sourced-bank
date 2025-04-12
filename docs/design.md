# CQRS + Event Sourcing Bank Demo — Design

## Goal

A small, working bank-account service that demonstrates CQRS, event sourcing,
and a process-managed saga in production-shaped form. The reader should be
able to start the service, exercise it from curl, and read every line in one
sitting. The point is to see the gears.

## Scope

In:

- One bounded context, one Postgres database.
- Two aggregates: `Account`, `Transfer`.
- Four account commands, one transfer command, four queries.
- Two read-model projections (`account_projection`, `transaction_projection`).
- One polling projector running in-process.
- One orchestrated saga (transfer) with compensation on failure.
- HTTP API, JSON, no auth.
- Admin endpoints to inspect the event log and rebuild projections from scratch.

Out:

- Snapshots. Aggregate streams stay short enough not to need them.
- Authentication, authorization, multi-tenancy.
- A separate event store (e.g. EventStoreDB). Postgres is the event store.
- A second bounded context or microservices.
- An external message bus (Kafka, RabbitMQ).
- A separate read database. Projections live in the same Postgres.
- Tests. Excluded by user choice; commit hygiene compensates.

## Architecture

Single Node process. Three logical components inside it:

1. HTTP layer (Express) maps requests to commands or queries.
2. Write path: load aggregate stream, replay to state, run rules, append events.
3. Read path: SELECT from projection tables.

A polling projector loop runs in the same process. Every 200ms it reads
events past its checkpoint and dispatches each to:

- Each registered projection handler.
- The transfer process manager.

The event log is the only source of truth. Projections are derived; they can
be dropped and rebuilt from the log without loss.

```
HTTP → command handler → events table
                              │
                              ▼
                     polling projector
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
        account_projection  transaction_  transfer process
                            projection    manager (issues
                                          new commands)
HTTP → query handler → projection tables
```

Writes never touch projections. Queries never touch events. The projector is
the only bridge.

## Data model

### `events`

```sql
CREATE TABLE events (
  global_seq  BIGSERIAL    PRIMARY KEY,
  stream_id   TEXT         NOT NULL,
  version     INT          NOT NULL,
  type        TEXT         NOT NULL,
  payload     JSONB        NOT NULL,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (stream_id, version)
);

CREATE INDEX events_stream_idx ON events (stream_id, version);
```

`UNIQUE (stream_id, version)` is the optimistic-concurrency primitive. The
write path appends with version = current + 1; concurrent writers race on
the unique constraint and the loser retries.

`global_seq` gives the projector a total order across all streams.

### `account_projection`

```sql
CREATE TABLE account_projection (
  account_id  TEXT         PRIMARY KEY,
  owner       TEXT         NOT NULL,
  balance     BIGINT       NOT NULL,
  status      TEXT         NOT NULL,
  version     INT          NOT NULL,
  opened_at   TIMESTAMPTZ  NOT NULL,
  closed_at   TIMESTAMPTZ
);
```

Money is stored in cents. `version` is copied from the event being projected
so clients can compare write-side and read-side versions to detect lag.

### `transaction_projection`

```sql
CREATE TABLE transaction_projection (
  id              BIGSERIAL    PRIMARY KEY,
  account_id      TEXT         NOT NULL,
  type            TEXT         NOT NULL,
  amount          BIGINT       NOT NULL,
  balance_after   BIGINT       NOT NULL,
  related_account TEXT,
  occurred_at     TIMESTAMPTZ  NOT NULL,
  event_seq       BIGINT       NOT NULL UNIQUE
);

CREATE INDEX txn_account_idx ON transaction_projection (account_id, occurred_at DESC);
```

`event_seq UNIQUE` is the projection's idempotency key. Replaying the same
event is safe; the second insert fails harmlessly.

### `projector_checkpoint`

```sql
CREATE TABLE projector_checkpoint (
  name      TEXT    PRIMARY KEY,
  last_seq  BIGINT  NOT NULL DEFAULT 0
);

INSERT INTO projector_checkpoint (name) VALUES ('main');
```

One row. Updated inside the same transaction as each event's projection
side-effects.

## Event catalog

Account stream (`account-{id}`):

- `AccountOpened { accountId, owner, initialDeposit }`
- `MoneyDeposited { accountId, amount }`
- `MoneyWithdrawn { accountId, amount }`
- `AccountClosed { accountId }`

Transfer stream (`transfer-{id}`):

- `TransferRequested { transferId, fromId, toId, amount }`
- `TransferDebited { transferId }`
- `TransferCredited { transferId }`
- `TransferCompleted { transferId }`
- `TransferFailed { transferId, reason, refunded }`

Metadata on every event: `{ correlation_id, causation_id, transferId? }`.
The transfer id in metadata is how account events get linked back to a
transfer flow during projection.

## Write side

### Command shapes

```ts
type OpenAccount    = { type: 'OpenAccount';    accountId: string; owner: string; initialDeposit: number };
type Deposit        = { type: 'Deposit';        accountId: string; amount: number; expectedVersion: number };
type Withdraw       = { type: 'Withdraw';       accountId: string; amount: number; expectedVersion: number };
type CloseAccount   = { type: 'CloseAccount';   accountId: string; expectedVersion: number };
type RequestTransfer= { type: 'RequestTransfer';transferId: string; fromId: string; toId: string; amount: number };
```

`expectedVersion` is required on mutations of an existing aggregate. Open and
RequestTransfer create new streams.

### Aggregate

Pure data + pure functions:

```ts
type AccountState = {
  id: string; owner: string; balance: number;
  status: 'open' | 'closed'; version: number;
};

function applyAccountEvent(s: AccountState | null, e: Event): AccountState
function rehydrateAccount(events: Event[]): AccountState | null
```

No I/O, no DB. The handler reads the stream, calls `rehydrateAccount`, runs
rules, appends new events.

### Command flow (uniform)

```
1. read events for stream
2. rehydrate state
3. validate state + command (404 / 422)
4. produce new events
5. appendToStream(streamId, expectedVersion, events) — concurrency check here
```

### Business rules

- `Deposit`: account must exist and be open, amount > 0.
- `Withdraw`: account must exist and be open, amount > 0, balance >= amount.
- `CloseAccount`: account must exist and be open. Closing a non-zero balance
  is allowed; a separate workflow could disburse it later (out of scope).
- `OpenAccount`: account must not exist, initialDeposit >= 0.
- `RequestTransfer`: amount > 0, fromId != toId. Account existence and
  balance are NOT checked synchronously here; the saga's first step is a
  Withdraw against fromId, which performs those checks naturally.

### Optimistic concurrency

`appendToStream` runs inside a transaction and inserts events with
incrementing versions starting at `expectedVersion + 1`. A unique-constraint
violation is mapped to a `ConcurrencyError`. The HTTP layer translates that
to 409. Clients are expected to reload and retry.

## Projector

Single loop, single checkpoint, in-process.

```
every 200ms:
  read up to 100 events where global_seq > checkpoint
  for each event, in a single transaction:
    accountProjector(tx, event)
    transactionProjector(tx, event)
    transferProcessManager(tx, event)
    UPDATE projector_checkpoint SET last_seq = event.global_seq
```

The checkpoint advance and the projection writes commit together. Either
both happen or neither; a crash at any point leaves the system replayable.

Each projector is a switch on `event.type`. Events it doesn't care about
are skipped silently. Adding a new projection later is a new function with
a new switch.

### Rebuild from scratch

A POST to `/admin/rebuild-projections`:

```sql
BEGIN;
  DELETE FROM account_projection;
  DELETE FROM transaction_projection;
  UPDATE projector_checkpoint SET last_seq = 0 WHERE name = 'main';
COMMIT;
```

Next tick replays every event. The endpoint returns once the projector has
caught up to the new tail.

## Read side

Queries SELECT from projections. They contain no domain logic and don't
know events exist.

```ts
getAccount(id)            -> SELECT * FROM account_projection WHERE account_id = $1
listAccounts()            -> SELECT * FROM account_projection WHERE status = 'open' ...
getTransactions(id)       -> SELECT * FROM transaction_projection WHERE account_id = $1 ...
getTransfer(transferId)   -> rebuilt from `transfer-{id}` stream on demand
```

`getTransfer` is the one query that reads events directly. The transfer
stream is short (3-5 events) and we want the freshest view, so we replay
on demand rather than maintaining a transfer projection. This is a
deliberate trade-off and worth calling out: not every query needs a
projection.

## Transfer saga

Orchestrated. The `Transfer-{id}` stream holds the saga's own state. The
process manager reads incoming events from the projector loop and decides
which command to issue next.

### Happy path

```
HTTP POST /transfers
  -> append TransferRequested
  -> 202 Accepted

projector tick observes TransferRequested
  -> process manager sends Withdraw to fromId

handleWithdraw appends MoneyWithdrawn (with metadata.transferId)
projector tick observes MoneyWithdrawn
  -> process manager appends TransferDebited
  -> process manager sends Deposit to toId

handleDeposit appends MoneyDeposited (with metadata.transferId)
projector tick observes MoneyDeposited
  -> process manager appends TransferCredited
  -> process manager appends TransferCompleted
```

### Failure paths

`Withdraw` fails (closed account, insufficient funds):

```
process manager catches ConcurrencyError or BusinessRuleError
  -> append TransferFailed { reason, refunded: false }
```

`Deposit` fails after `Withdraw` succeeded:

```
process manager catches the error
  -> send compensating Deposit to fromId (refund)
  -> append TransferFailed { reason, refunded: true }
```

The source account's history will show: `MoneyWithdrawn` then
`MoneyDeposited (refund)`. The transfer's history will show: requested,
debited, failed (refunded). Both halves of the story remain visible.

### Concurrency in the saga

`expectedVersion` for the transfer stream is tracked by replaying the
transfer's events when the manager needs to append. Account commands sent
by the manager use the account's current version, looked up via a fresh
read of the account stream right before sending. This avoids stale
`expectedVersion` errors when a user is also operating on the account.

## HTTP API

```
POST   /accounts                     OpenAccount               201 + { accountId, version }
POST   /accounts/:id/deposits        Deposit                   200 + { version }
POST   /accounts/:id/withdrawals     Withdraw                  200 + { version }
POST   /accounts/:id/close           CloseAccount              200 + { version }
POST   /transfers                    RequestTransfer           202 + { transferId, status: 'requested' }

GET    /accounts                     listAccounts              200 + Account[]
GET    /accounts/:id                 getAccount                200 + Account
GET    /accounts/:id/transactions    getTransactions           200 + Transaction[]
GET    /transfers/:id                getTransfer               200 + Transfer

POST   /admin/rebuild-projections    rebuild                   200 + { rebuilt, eventsReplayed }
GET    /admin/events                 raw event log             200 + Event[]
```

Request bodies validated with `zod`. Errors mapped to status codes by a
single error middleware:

| Error class       | Status |
|-------------------|--------|
| ValidationError   | 400    |
| NotFoundError     | 404    |
| ConcurrencyError  | 409    |
| BusinessRuleError | 422    |
| (anything else)   | 500    |

### Eventual consistency, surfaced

Command responses include the new write-side `version`. Account GET
responses include the read-side `version` (copied forward by the
projector). When the projector lags, `read.version < write.version` and
the lag is observable in the response, not papered over.

A `?wait=true` query param on commands optionally polls until the
projection catches up to the new version before returning. Useful for
demos and as a documented production work-around. Default is no wait.

## Project layout

```
cqrs-bank-demo/
  docker-compose.yml
  package.json
  tsconfig.json
  .env.example
  README.md
  migrations/
    001_events.sql
    002_projections.sql
    003_checkpoint.sql
  src/
    index.ts
    infra/
      db.ts
      eventStore.ts
      migrate.ts
    write/
      account/
        events.ts
        state.ts
        commands.ts
        handlers.ts
      transfer/
        events.ts
        state.ts
        commands.ts
        handlers.ts
      commandBus.ts
    read/
      projectors/
        account.ts
        transaction.ts
      queries.ts
    process/
      transfer.ts
    projector/
      loop.ts
    http/
      server.ts
      errorMiddleware.ts
      routes/
        accounts.ts
        transfers.ts
        admin.ts
```

Roughly 12 source files plus three migrations. Estimated 800-1,000 lines
of TypeScript.

## Dependencies

Runtime: `express`, `pg`, `zod`, `uuid`, `dotenv`.
Dev: `typescript`, `ts-node`, `@types/node`, `@types/express`, `@types/pg`,
`@types/uuid`.

No ORM. No test runner. No lint config beyond the TypeScript compiler.

## Boot sequence

`src/index.ts`:

1. Load env (`DATABASE_URL`, `PORT`).
2. Create pg pool.
3. Run migrations.
4. Start the projector loop.
5. Start the HTTP server.
6. On `SIGTERM`: stop accepting requests, drain the projector, close pool, exit.

## Run locally

```
docker compose up -d
cp .env.example .env
npm install
npm run dev
```

Typical curl sequence to feel the design:

```
# open two accounts
curl -XPOST localhost:3000/accounts -H 'content-type: application/json' \
  -d '{"owner":"Alice","initialDeposit":10000}'
curl -XPOST localhost:3000/accounts -H 'content-type: application/json' \
  -d '{"owner":"Bob","initialDeposit":0}'

# transfer
curl -XPOST localhost:3000/transfers -H 'content-type: application/json' \
  -d '{"fromId":"<alice>","toId":"<bob>","amount":2500}'

# poll the transfer
curl localhost:3000/transfers/<id>

# rebuild from events
curl -XPOST localhost:3000/admin/rebuild-projections
```

## Future work (deliberately not in scope)

- Snapshots once aggregate streams grow long.
- A second saga (e.g. close-and-disburse).
- Outbox pattern to publish events to an external bus (Kafka).
- Extracting projections to a separate read DB (Elasticsearch, Redis).
- Replacing the hand-rolled event store with EventStoreDB or Marten.
- Auth, audit metadata (who initiated the command), rate limits.
- Tests. Specifically: pure-function tests for `applyEvent`, integration
  tests for the projector loop, contract tests for the saga.
