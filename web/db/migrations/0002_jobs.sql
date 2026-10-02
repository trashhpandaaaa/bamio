-- Background work (imports, analysis, exports, followed streams) as rows that any worker
-- process can claim: durable across restarts, shared by several workers (src/lib/server/queue.ts).
create table jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('import', 'analyze', 'retranscribe', 'export', 'follow', 'finish-follow')),
  user_id text not null,
  project_id uuid not null references projects (id) on delete cascade,
  -- Exports: the clip.
  clip_id text,
  payload jsonb not null default '{}',
  -- Higher first (plans with priority processing).
  priority integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  -- Not before (ms): retries wait here.
  run_after bigint not null,
  -- The worker holding it, until when (ms). A worker that stops renewing loses it, and another resumes the job.
  lease_owner text,
  lease_until bigint,
  -- Asked of the worker running it: stop everything (cancel), or end a recording early and keep it (stop).
  cancel_requested boolean not null default false,
  stop_requested boolean not null default false,
  last_error text,
  created_at bigint not null,
  updated_at bigint not null,
  finished_at bigint
);

-- One live job per project and kind (per clip for exports): asking again finds the first.
create unique index jobs_one_active on jobs (project_id, kind, coalesce(clip_id, '')) where status in ('queued', 'running');
-- What workers look through when claiming.
create index jobs_claimable on jobs (priority desc, run_after, id) where status in ('queued', 'running');
create index jobs_user_running on jobs (user_id) where status = 'running';
create index jobs_project on jobs (project_id);
