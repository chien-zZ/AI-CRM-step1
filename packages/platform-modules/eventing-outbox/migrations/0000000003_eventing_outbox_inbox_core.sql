create schema if not exists platform_eventing;

create table platform_eventing.outbox_messages (
  message_id uuid primary key, message_kind text not null check (message_kind in ('event','job')),
  message_type varchar(160) not null, message_version integer not null check (message_version between 1 and 1000),
  producer varchar(256) not null, occurred_at timestamptz not null, available_at timestamptz not null,
  correlation_id uuid not null, causation_id uuid, traceparent varchar(55), tracestate varchar(512),
  payload jsonb not null, payload_sha256 varchar(64) not null check (length(payload_sha256)=64),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  status text not null check (status in ('pending','publishing','published','isolated')),
  claim_token uuid, claimed_at timestamptz, published_at timestamptz, isolated_at timestamptz,
  last_error_code varchar(128), created_at timestamptz not null default now(),
  constraint outbox_claim_pair check ((claim_token is null) = (claimed_at is null))
);
create index outbox_dispatch_idx on platform_eventing.outbox_messages (status,available_at,created_at);

create table platform_eventing.inbox_receipts (
  message_id uuid not null, consumer varchar(128) not null, payload_sha256 varchar(64) not null check(length(payload_sha256)=64),
  completed_at timestamptz not null, primary key(message_id,consumer)
);

create table platform_eventing.job_requests (
  job_id uuid primary key, idempotency_key varchar(128) not null unique, fingerprint varchar(64) not null check(length(fingerprint)=64),
  status text not null check(status in ('queued','processing','cancelled','completed','isolated')), envelope jsonb not null,
  cancel_reason varchar(512), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table platform_eventing.isolations (
  isolation_id uuid primary key, message_id uuid not null, consumer varchar(128) not null,
  payload_sha256 varchar(64) not null check(length(payload_sha256)=64), reason_code varchar(64) not null,
  attempt_count integer not null check(attempt_count > 0), isolated_at timestamptz not null,
  released_at timestamptz, replay_message_id uuid,
  unique(message_id,consumer,payload_sha256,reason_code)
);
create index isolations_open_idx on platform_eventing.isolations (isolated_at) where released_at is null;
