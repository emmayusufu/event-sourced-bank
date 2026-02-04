CREATE TABLE account_projection (
  account_id  TEXT         PRIMARY KEY,
  owner       TEXT         NOT NULL,
  balance     BIGINT       NOT NULL,
  status      TEXT         NOT NULL,
  version     INT          NOT NULL,
  opened_at   TIMESTAMPTZ  NOT NULL,
  closed_at   TIMESTAMPTZ
);

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
