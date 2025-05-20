# event-sourced-bank

Bank account service backed by a Postgres event store, with CQRS read projections, a transfer saga, and a double-entry ledger.

## Run

    docker compose up -d
    cp .env.example .env
    npm install
    npm run dev

## Tour

Open two accounts:

    A=$(curl -s -XPOST 'localhost:3000/accounts?wait=true' -H 'content-type: application/json' \
      -d '{"owner":"Alice","initialDeposit":10000}' | jq -r .accountId)
    B=$(curl -s -XPOST 'localhost:3000/accounts?wait=true' -H 'content-type: application/json' \
      -d '{"owner":"Bob","initialDeposit":0}' | jq -r .accountId)

Transfer:

    T=$(curl -s -XPOST localhost:3000/transfers -H 'content-type: application/json' \
      -d "{\"fromId\":\"$A\",\"toId\":\"$B\",\"amount\":2500}" | jq -r .transferId)
    sleep 1
    curl -s localhost:3000/transfers/$T | jq
    curl -s localhost:3000/accounts/$A | jq
    curl -s localhost:3000/accounts/$B | jq

Rebuild projections from the event log:

    curl -s -XPOST localhost:3000/admin/rebuild-projections | jq
    curl -s localhost:3000/accounts/$A | jq    # same balance, replayed from scratch

Inspect the raw event log:

    curl -s "localhost:3000/admin/events?stream=account-$A" | jq

Inspect the double-entry ledger and prove the books balance:

    curl -s localhost:3000/accounts/$A/ledger | jq
    curl -s localhost:3000/admin/ledger/trial-balance | jq
    curl -s localhost:3000/admin/ledger/invariants | jq

Run the reconciliation checks. 200 if healthy, 500 with the offending rows if
not:

    curl -s "localhost:3000/admin/reconciliation/stuck-transfers?olderThan=300" | jq
    curl -s localhost:3000/admin/reconciliation/replay-check | jq

Retry a mutation safely with an idempotency key. The second call returns
the same response and a header marking it as a replay:

    K=$(uuidgen)
    curl -s -XPOST localhost:3000/accounts -H 'content-type: application/json' \
      -H "Idempotency-Key: $K" -d '{"owner":"Carol","initialDeposit":500}'
    curl -si -XPOST localhost:3000/accounts -H 'content-type: application/json' \
      -H "Idempotency-Key: $K" -d '{"owner":"Carol","initialDeposit":500}' | head -20

## Endpoints

| Method | Path                                | Purpose                  |
|--------|-------------------------------------|--------------------------|
| POST   | /accounts                           | open                     |
| POST   | /accounts/:id/deposits              | deposit                  |
| POST   | /accounts/:id/withdrawals           | withdraw                 |
| POST   | /accounts/:id/close                 | close                    |
| POST   | /transfers                          | request transfer (202)   |
| GET    | /accounts                           | list open accounts       |
| GET    | /accounts/:id                       | one account              |
| GET    | /accounts/:id/transactions          | account history          |
| GET    | /transfers/:id                      | transfer status          |
| GET    | /accounts/:id/ledger                | double-entry ledger      |
| POST   | /admin/rebuild-projections          | wipe and replay          |
| GET    | /admin/events?stream=...&after=...  | raw event log            |
| GET    | /admin/ledger/trial-balance         | debits/credits per acct  |
| GET    | /admin/ledger/invariants            | books-balance health     |
| GET    | /admin/reconciliation/stuck-transfers | sagas stuck past olderThan seconds |
| GET    | /admin/reconciliation/replay-check  | projection vs replay-from-events |

Append `?wait=true` to any mutation to block until the projection has caught up.
Send `Idempotency-Key: <uuid>` on any POST to make it safe to retry.

## Notes

The events table is the source of truth. Projections are derived: drop them and
the polling projector rebuilds them from the log on the next tick. The transfer
saga is an orchestrated process manager riding the same loop. The ledger is a
second projection over the same events, with `cash:in` / `cash:out` /
`transfer-suspense` system accounts as the counterparties for external flows
and in-flight transfers. Every entry group sums to zero, every transfer leaves
the suspense account at zero, and `/admin/ledger/invariants` proves it. Longer
write-up in [ARCHITECTURE.md](ARCHITECTURE.md).
