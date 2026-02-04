CREATE TABLE idempotency_keys (
  key            TEXT         NOT NULL,
  route          TEXT         NOT NULL,
  request_hash   TEXT         NOT NULL,
  status_code    INT          NOT NULL,
  response_body  JSONB        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (key, route)
);

CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);
