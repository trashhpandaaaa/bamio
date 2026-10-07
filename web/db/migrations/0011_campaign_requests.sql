-- Requests to run a clipping campaign (src/lib/server/campaign-requests.ts): a podcaster,
-- streamer or business fills in the "Run a campaign" form on /clippers; an admin looks at who
-- is promising the money, then makes the campaign from it (Admin, Campaigns) or declines it.
create table campaign_requests (
  id bigint generated always as identity primary key,
  user_id text not null,
  -- Their account's email when they asked, for the admin who answers.
  email text,
  kind text not null check (kind in ('podcaster', 'streamer', 'business')),
  -- Their show, channel or business.
  name text not null,
  source_url text not null,
  brief text not null,
  platforms jsonb not null,
  rate_cents integer not null check (rate_cents > 0),
  budget_cents integer not null check (budget_cents > 0),
  -- How they'll pay clippers, and another way to reach them if they gave one.
  payout text not null,
  contact text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  -- Why it was declined, for the person who asked.
  note text,
  -- The campaign made from it.
  campaign_id uuid references campaigns (id) on delete set null,
  reviewed_by text,
  reviewed_at bigint,
  created_at bigint not null
);

create index campaign_requests_status on campaign_requests (status, created_at);
create index campaign_requests_user on campaign_requests (user_id);
create index campaign_requests_campaign on campaign_requests (campaign_id);
