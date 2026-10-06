-- The Clippers page (/clippers, src/lib/server/clippers.ts): users who chose to be shown.
-- A row exists only while its user wants to be listed (their profile's switch); it's public
-- once an admin approves it, and any change they make sends it back to "pending".
create table clipper_profiles (
  user_id text primary key,
  -- What they chose to show: a name, a line about themselves, a link to their channel.
  name text not null,
  bio text not null default '',
  link text,
  -- Their Clerk picture when they last saved (null: their initial is shown).
  image_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  -- The admin (email) who last approved or hid it.
  reviewed_by text,
  approved_at bigint,
  created_at bigint not null,
  updated_at bigint not null
);

create index clipper_profiles_status on clipper_profiles (status, approved_at desc);
