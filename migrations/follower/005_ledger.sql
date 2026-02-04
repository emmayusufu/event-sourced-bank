CREATE TABLE ledger_entries (
  id            BIGSERIAL    PRIMARY KEY,
  entry_group   TEXT         NOT NULL,
  account_id    TEXT         NOT NULL,
  direction     TEXT         NOT NULL CHECK (direction IN ('debit','credit')),
  amount        BIGINT       NOT NULL CHECK (amount > 0),
  occurred_at   TIMESTAMPTZ  NOT NULL,
  event_seq     BIGINT       NOT NULL,
  UNIQUE (event_seq, account_id, direction)
);

CREATE INDEX ledger_account_idx ON ledger_entries (account_id, occurred_at DESC);
CREATE INDEX ledger_group_idx   ON ledger_entries (entry_group);
