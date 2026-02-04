CREATE TABLE events (
  global_seq  BIGINT       PRIMARY KEY,
  stream_id   TEXT         NOT NULL,
  version     INT          NOT NULL,
  type        TEXT         NOT NULL,
  payload     JSONB        NOT NULL,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL,
  UNIQUE (stream_id, version)
);

CREATE INDEX events_stream_idx ON events (stream_id, version);
