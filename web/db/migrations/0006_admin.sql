-- The admin panel (src/lib/server/admin.ts). Superadmins are named on the server
-- (BAMIO_SUPERADMINS), never here; they add and remove the admins in this table.
create table admins (
  user_id text primary key,
  email text not null,
  added_by text not null,
  created_at bigint not null
);

-- Every change made from the admin panel: who, what, to whom.
create table admin_actions (
  id bigint generated always as identity primary key,
  admin_user_id text not null,
  admin_email text not null,
  action text not null,
  target text,
  details jsonb not null default '{}',
  at bigint not null
);

create index admin_actions_at on admin_actions (at desc);
