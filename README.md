# event-sourced-bank

Bank account service backed by a Postgres event store, with CQRS read projections, a transfer saga, and a double-entry ledger.

## Run

    docker compose up -d
    cp .env.example .env
    npm install
    npm run dev

## Try it

    curl -XPOST localhost:3000/accounts \
      -H 'content-type: application/json' \
      -d '{"owner":"Alice","initialDeposit":10000}'
