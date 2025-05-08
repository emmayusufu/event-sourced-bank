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
| POST   | /admin/rebuild-projections          | wipe and replay          |
| GET    | /admin/events?stream=...&after=...  | raw event log            |

Append `?wait=true` to any mutation to block until the projection has caught up.
