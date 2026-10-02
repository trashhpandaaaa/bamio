-- Bamio's data: projects, transcripts, billing and usage. Times are milliseconds since 1970
-- (as in the app's JSON), so a row and its document always agree.

-- A project is one JSON document (validated by projectSchema in src/lib/clips/schema.ts on every
-- read and write); the columns beside it are what queries need.
create table projects (
  id uuid primary key,
  user_id text not null,
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null
);
create index projects_user_updated on projects (user_id, updated_at desc);

-- A project's transcript (transcriptSchema): every phrase and word with its time.
create table transcripts (
  project_id uuid primary key references projects (id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null
);

-- The Stripe customer and subscription of a user (src/lib/server/billing.ts).
create table billing_accounts (
  user_id text primary key,
  data jsonb not null,
  customer_id text generated always as (data ->> 'customerId') stored,
  updated_at bigint not null
);
create unique index billing_accounts_customer on billing_accounts (customer_id) where customer_id is not null;

-- AI processing used: one row per import or followed-stream piece; the key makes recording it again a no-op.
create table usage_entries (
  user_id text not null,
  key text not null,
  sec double precision not null check (sec >= 0),
  at bigint not null,
  primary key (user_id, key)
);
create index usage_entries_user_at on usage_entries (user_id, at);
