-- Clipping campaigns (/clippers, src/lib/server/campaigns.ts) replace the Clippers wall of 0008.
-- A campaign names what to clip, a rate per 1,000 views and a budget. Clippers join, post their
-- clips on their own channels and send the links; Bamio counts the views and what each clipper is
-- owed. No money passes through Bamio: the campaign's owner pays, and an admin records it.
drop table clipper_profiles;

-- Who a user is in campaigns: made the first time they join one.
create table clippers (
  user_id text primary key,
  name text not null,
  -- Their channel (where they post), on a platform Bamio knows.
  link text,
  -- Their Clerk picture when they last saved (null: their initial is shown).
  image_url text,
  -- How they want to be paid (a PayPal address, say). Only admins see it.
  payout text not null default '',
  -- Set by an admin: left out of every leaderboard, earns nothing, can't join or send clips.
  blocked_at bigint,
  created_at bigint not null,
  updated_at bigint not null
);

create table campaigns (
  id uuid primary key,
  -- Its address: /clippers/<slug>. Made from the title, never changed.
  slug text not null unique,
  title text not null,
  -- Whose content it is, and who pays: a creator or a brand.
  brand text not null,
  summary text not null,
  brief text not null,
  -- One rule per line.
  rules text not null default '',
  -- The content to clip (a link), when there is one place to start.
  source_url text,
  -- Where clips may be posted: ["tiktok", "youtube", ...] (CLIP_PLATFORMS).
  platforms jsonb not null,
  -- Paid per 1,000 views, up to the budget.
  rate_cents integer not null check (rate_cents > 0),
  budget_cents integer not null check (budget_cents > 0),
  -- A clip earns once it has this many views, and never more than max_clip_cents (null: no cap).
  min_views integer not null default 0 check (min_views >= 0),
  max_clip_cents integer check (max_clip_cents is null or max_clip_cents > 0),
  -- How and when the owner pays, in their words (public).
  payout text not null default '',
  -- draft: only admins see it. live: open. paused: shown, nothing new taken. ended: finished, counts frozen.
  status text not null default 'draft' check (status in ('draft', 'live', 'paused', 'ended')),
  ends_at bigint,
  -- The admin (email) who made it.
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create index campaigns_status on campaigns (status, created_at desc);

create table campaign_members (
  campaign_id uuid not null references campaigns (id) on delete cascade,
  user_id text not null,
  joined_at bigint not null,
  primary key (campaign_id, user_id)
);

create index campaign_members_user on campaign_members (user_id);

-- A clip a member posted on their own channel and sent in.
create table campaign_clips (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  user_id text not null,
  url text not null,
  -- The platform and the post's id ("tiktok:7345..."), so one post is sent to a campaign once.
  url_key text not null,
  platform text not null,
  -- Only approved clips count, in the order they were approved (reviewed_at).
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Why it was rejected, for its clipper.
  note text,
  -- Views Bamio read from the site (campaign-views.ts), and the number an admin typed, which wins.
  views bigint,
  views_manual bigint,
  views_checked_at bigint,
  views_error text,
  -- The post's title and the account that posted it, as the site says.
  title text,
  author text,
  reviewed_by text,
  reviewed_at bigint,
  created_at bigint not null,
  unique (campaign_id, url_key)
);

create index campaign_clips_campaign on campaign_clips (campaign_id, status);
create index campaign_clips_user on campaign_clips (user_id);
create index campaign_clips_checked on campaign_clips (views_checked_at nulls first) where status <> 'rejected';

-- A payment the campaign's owner made to a clipper, outside Bamio, written down by an admin.
-- user_id is null once that clipper has deleted their account: the amount still counts as spent.
create table campaign_payouts (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  user_id text,
  amount_cents integer not null check (amount_cents > 0),
  note text not null default '',
  paid_by text not null,
  paid_at bigint not null
);

create index campaign_payouts_campaign on campaign_payouts (campaign_id);
create index campaign_payouts_user on campaign_payouts (user_id);
