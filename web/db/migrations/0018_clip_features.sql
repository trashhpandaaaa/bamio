-- The clip side's paid features (src/lib/clips/features.ts): a brand kit per account, captions
-- translated into another language, and the Team plan's members.

-- The caption look and logo an account's new clips start with (src/lib/server/brand.ts).
-- The logo's bytes live in storage under the account's own prefix, so deleting the account
-- removes them with everything else.
create table brand_kits (
  user_id text primary key,
  data jsonb not null,
  updated_at bigint not null
);

-- A project's transcript translated into another language, for captions in it
-- (src/lib/server/translate.ts). Phrase times are the transcript's own; the words inside a
-- phrase are spread across it by length, because a translation doesn't keep them.
create table clip_translations (
  project_id uuid not null references projects (id) on delete cascade,
  lang text not null,
  data jsonb not null,
  updated_at bigint not null,
  primary key (project_id, lang)
);

-- The Team plan's members: accounts that work in their own projects on the owner's minutes
-- (src/lib/server/teams.ts). A row is made when the owner invites an address and claimed when
-- that person signs in, so an invitation can be sent before they have an account.
create table team_members (
  owner_user_id text not null,
  email text not null,
  member_user_id text,
  invited_at bigint not null,
  joined_at bigint,
  primary key (owner_user_id, email)
);
-- An account belongs to one team at most, so its plan is never ambiguous.
create unique index team_members_member on team_members (member_user_id) where member_user_id is not null;
create index team_members_owner on team_members (owner_user_id);

-- Translating a transcript is background work like the rest. The check on `kind` was written
-- inline in 0002, so Postgres named it; find it rather than trusting the name.
do $$
declare existing text;
begin
  select conname into existing from pg_constraint
   where conrelid = 'jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if existing is not null then execute format('alter table jobs drop constraint %I', existing); end if;
end $$;
alter table jobs add constraint jobs_kind_check
  check (kind in ('import', 'analyze', 'retranscribe', 'export', 'follow', 'finish-follow', 'translate'));
