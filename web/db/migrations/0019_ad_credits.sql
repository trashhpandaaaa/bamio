-- AI minutes earned by watching ads (src/lib/ads.ts, src/lib/server/ad-credits.ts). Any
-- signed-in account may earn them and spend them on the AI work a plan otherwise pays for,
-- with no plan and no card (the user's decision, 2026-10-25).

-- The ledger. One signed row per change: earning inserts a positive `sec`, spending a negative
-- one, so the balance is sum(sec) and there is no total to fall out of step. `key` names the
-- event behind the row (the view that earned it, or the usage that spent it), so a claim sent
-- twice or a job that runs again after a crash counts once.
create table ad_credits (
  user_id text not null,
  key text not null,
  sec double precision not null,
  at bigint not null,
  primary key (user_id, key)
);
-- The balance, and today's earnings against the daily cap, are both read by user and time.
create index ad_credits_user_at on ad_credits (user_id, at);

-- An offered ad view, waiting to be claimed. The row is made when a page starts showing an ad
-- and claimed once AD_VIEW_MIN_MS has passed, which is all a server can check: the browser
-- can't prove an ad was shown, so the daily cap in src/lib/ads.ts is the real limit. Claiming
-- sets claimed_at, so a view earns once; unclaimed rows are swept after AD_VIEW_MAX_MS.
create table ad_views (
  id uuid primary key,
  user_id text not null,
  issued_at bigint not null,
  claimed_at bigint
);
create index ad_views_user_issued on ad_views (user_id, issued_at);
