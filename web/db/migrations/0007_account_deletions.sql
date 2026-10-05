-- Deleting an account (src/lib/server/accounts.ts): a request is a row here, and the workers'
-- sweeper does the work (cancel the Stripe subscription, stop jobs, remove media and rows, then
-- the Clerk user), again after a crash or an error. The row stays once done: it holds only the
-- user's id, as the record that the account was deleted and when.
create table account_deletions (
  user_id text primary key,
  -- "self" (the profile's Delete account), "clerk" (Clerk's user.deleted webhook), "admin".
  reason text not null,
  status text not null default 'queued' check (status in ('queued', 'working', 'done')),
  attempts integer not null default 0,
  -- Not before (ms): an error waits here before the next try.
  run_after bigint not null,
  -- The sweeper working on it, until when (ms): a sweeper that dies loses it to the next.
  lease_until bigint,
  last_error text,
  requested_at bigint not null,
  done_at bigint
);

create index account_deletions_due on account_deletions (run_after) where status <> 'done';
