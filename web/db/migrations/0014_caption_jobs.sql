-- Auto captions in the editor (Pro, src/lib/server/editor-captions.ts): someone asks for
-- captions, and the sound of what their edit uses (only the sound, only those parts) comes up
-- to be transcribed with Bamio's own transcriber. The table is its own queue, like downloads:
-- the workers' captioner claims rows by lease. The sound is deleted once it's transcribed, the
-- words once they've been fetched or after a day.
create table caption_jobs (
  id uuid primary key,
  user_id text not null,
  status text not null default 'queued' check (status in ('queued', 'working', 'ready', 'failed')),
  -- The language asked for, or null to detect it.
  language text,
  duration_sec double precision not null,
  progress real,
  error text,
  -- The words, in the uploaded sound's seconds, and the language heard.
  result jsonb,
  attempts integer not null default 0,
  lease_until bigint,
  created_at bigint not null,
  finished_at bigint
);

create index caption_jobs_user on caption_jobs (user_id, created_at desc);
create index caption_jobs_waiting on caption_jobs (created_at) where status in ('queued', 'working');
