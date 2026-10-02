-- Emails to users (plan changes, payments, videos ready, AI minutes), as an outbox: queued in
-- the same transaction as the change they're about, sent by the workers through Resend
-- (src/lib/server/email.ts). One row per user and key, so an email goes out once however often
-- its cause is seen (a webhook delivered twice, an import retried).
create table emails (
  id bigint generated always as identity primary key,
  user_id text not null,
  key text not null,
  template text not null,
  -- account: plan and payments (always sent); videos, minutes: the user can turn these off.
  category text not null check (category in ('account', 'videos', 'minutes')),
  data jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'previewed', 'skipped', 'failed')),
  attempts integer not null default 0,
  -- Not before (ms): retries wait here.
  run_after bigint not null,
  -- A worker sending it holds it until then (ms); after that another worker may.
  lease_until bigint,
  -- What went out (for support): the address, the subject, Resend's id.
  to_address text,
  subject text,
  provider_id text,
  last_error text,
  created_at bigint not null,
  updated_at bigint not null,
  sent_at bigint,
  unique (user_id, key)
);

create index emails_due on emails (run_after, id) where status in ('queued', 'sending');
