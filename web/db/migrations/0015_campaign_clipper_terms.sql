-- Two more campaign terms, set per campaign (src/lib/campaigns/money.ts): the most one clipper
-- can earn in the campaign (null: no cap), and the views a clipper's approved clips need in all
-- before any of them earn (0: none).
alter table campaigns
  add column max_clipper_cents integer check (max_clipper_cents is null or max_clipper_cents > 0),
  add column min_clipper_views integer not null default 0 check (min_clipper_views >= 0);
