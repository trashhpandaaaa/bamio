-- Checks against fraud in campaigns (src/lib/campaigns/regions.ts, flags.ts).

-- Who a campaign is for (AUDIENCES), and whether clippers must show their audience before clips count.
alter table campaigns
  add column audience text not null default 'worldwide',
  add column audience_proof boolean not null default false;

-- A clipper's proof of their audience for a campaign: screenshots of where their viewers are
-- (storage keys under their own media, so deleting the account deletes them), and an admin's
-- answer. The country their session was in when they joined: a hint for admins, never shown to others.
alter table campaign_members
  add column proof_keys jsonb not null default '[]',
  add column proof_status text not null default 'none' check (proof_status in ('none', 'waiting', 'accepted', 'rejected')),
  add column proof_note text,
  add column proof_at bigint,
  add column proof_reviewed_by text,
  add column country text;

-- Per clip: the country the clipper's session was in when they sent it, likes and comments as
-- the site says (few for the views is a flag), and the last view counts with their times
-- ([[time, views], ...], newest last), to see a sudden jump.
alter table campaign_clips
  add column country text,
  add column likes bigint,
  add column comments bigint,
  add column view_log jsonb not null default '[]';
