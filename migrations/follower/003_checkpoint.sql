CREATE TABLE projector_checkpoint (
  name      TEXT    PRIMARY KEY,
  last_seq  BIGINT  NOT NULL DEFAULT 0
);

INSERT INTO projector_checkpoint (name) VALUES ('main');
