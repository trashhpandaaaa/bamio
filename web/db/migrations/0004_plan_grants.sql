-- Plans given without paying (the owner, testers, partners), for good until taken back.
-- Set with `npm run plan:grant -- <email> <plan>` (scripts/grant-plan.mjs). Where a user also
-- pays for a plan, the better of the two counts (src/lib/server/billing.ts).
create table plan_grants (
  user_id text primary key,
  plan text not null check (plan in ('starter', 'pro', 'team')),
  -- Who it's for, or why (for people reading the table).
  note text,
  created_at bigint not null
);
