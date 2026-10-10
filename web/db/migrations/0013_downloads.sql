-- The downloader (/download, src/lib/server/downloads.ts): a link to a video on another site,
-- fetched by the server and kept for a day so its owner can save the file. The table is its own
-- queue (the workers' downloader claims rows by lease, as the mailer does emails): a download
-- isn't a project, and jobs belong to projects.
create table downloads (
  id uuid primary key,
  user_id text not null,
  -- The video's page, as the site names it.
  url text not null,
  title text not null,
  platform text not null,
  duration_sec double precision not null,
  thumbnail text,
  status text not null default 'queued' check (status in ('queued', 'working', 'ready', 'failed')),
  -- 0 to 1 while it's fetched, when the site says.
  progress real,
  -- Why it failed, for the person who asked.
  error text,
  size_bytes bigint,
  attempts integer not null default 0,
  -- The worker fetching it holds it until then (ms); one that stops renewing loses it.
  lease_until bigint,
  created_at bigint not null,
  finished_at bigint,
  -- When the finished file is deleted (ms).
  expires_at bigint,
  -- Taken off the list (by its owner, or because its day was up) and its file deleted. The row
  -- stays a little longer, so the count of downloads started in a day can't be reset by deleting them.
  removed_at bigint
);

create index downloads_user on downloads (user_id, created_at desc);
-- What the downloader looks through when claiming.
create index downloads_waiting on downloads (created_at) where status in ('queued', 'working') and removed_at is null;
