-- VANTA//PULSE verified leaderboard
--
-- Public clients never write these tables directly. A public Edge Function
-- validates and replays each run, then invokes the service-role-only RPCs.

create schema if not exists vanta_pulse_private;

revoke all on schema vanta_pulse_private from public, anon, authenticated;

create table public.vanta_pulse_run_tickets (
  ticket_id uuid primary key,
  client_id uuid not null,
  requester_hash text not null,
  board_id text not null,
  mode text not null,
  level_id text not null,
  seed bigint not null,
  simulation_version integer not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  verification_attempts smallint not null default 0,
  last_attempt_at timestamptz,
  consumed_at timestamptz,
  consumed_run_id uuid,
  constraint vanta_pulse_run_tickets_requester_hash_check
    check (requester_hash ~ '^[0-9a-f]{64}$'),
  constraint vanta_pulse_run_tickets_board_id_check
    check (board_id ~ '^[a-z0-9][a-z0-9:_-]{0,63}$'),
  constraint vanta_pulse_run_tickets_mode_check
    check (mode in ('campaign', 'daily', 'endless')),
  constraint vanta_pulse_run_tickets_level_id_check
    check (level_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint vanta_pulse_run_tickets_seed_check
    check (seed between 0 and 4294967295),
  constraint vanta_pulse_run_tickets_simulation_version_check
    check (simulation_version between 1 and 1000000),
  constraint vanta_pulse_run_tickets_verification_attempts_check
    check (verification_attempts between 0 and 3),
  constraint vanta_pulse_run_tickets_expiry_check
    check (
      expires_at > issued_at
      and expires_at <= issued_at + interval '5 minutes'
    ),
  constraint vanta_pulse_run_tickets_consumption_check
    check ((consumed_at is null) = (consumed_run_id is null))
);

create table public.vanta_pulse_runs (
  run_id uuid primary key,
  ticket_id uuid not null unique
    references public.vanta_pulse_run_tickets (ticket_id),
  client_id uuid not null,
  callsign text not null,
  board_id text not null,
  mode text not null,
  level_id text not null,
  seed bigint not null,
  simulation_version integer not null,
  score bigint not null,
  duration_ms integer not null,
  completion_ticks integer not null,
  simulation_checksum text not null,
  replay_hash text not null,
  replay jsonb not null,
  submitted_at timestamptz not null,
  constraint vanta_pulse_runs_callsign_check
    check (callsign ~ '^[A-Z0-9_]{3,12}$'),
  constraint vanta_pulse_runs_board_id_check
    check (board_id ~ '^[a-z0-9][a-z0-9:_-]{0,63}$'),
  constraint vanta_pulse_runs_mode_check
    check (mode in ('campaign', 'daily', 'endless')),
  constraint vanta_pulse_runs_level_id_check
    check (level_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint vanta_pulse_runs_seed_check
    check (seed between 0 and 4294967295),
  constraint vanta_pulse_runs_simulation_version_check
    check (simulation_version between 1 and 1000000),
  constraint vanta_pulse_runs_score_check
    check (score between 0 and 1000000000000),
  constraint vanta_pulse_runs_duration_check
    check (duration_ms between 0 and 21600000),
  constraint vanta_pulse_runs_completion_ticks_check
    check (completion_ticks between 0 and 2592000),
  constraint vanta_pulse_runs_simulation_checksum_check
    check (simulation_checksum ~ '^[0-9a-f]{8,128}$'),
  constraint vanta_pulse_runs_replay_hash_check
    check (replay_hash ~ '^[0-9a-f]{64}$'),
  constraint vanta_pulse_runs_replay_shape_check
    check (jsonb_typeof(replay) = 'object'),
  constraint vanta_pulse_runs_replay_size_check
    check (pg_column_size(replay) <= 131072)
);

alter table public.vanta_pulse_run_tickets
  add constraint vanta_pulse_run_tickets_consumed_run_id_fkey
  foreign key (consumed_run_id)
  references public.vanta_pulse_runs (run_id);

create table public.vanta_pulse_best_scores (
  best_score_id bigint generated always as identity primary key,
  board_id text not null,
  client_id uuid not null,
  callsign text not null,
  run_id uuid not null unique
    references public.vanta_pulse_runs (run_id),
  score bigint not null,
  duration_ms integer not null,
  achieved_at timestamptz not null,
  constraint vanta_pulse_best_scores_board_client_key
    unique (board_id, client_id),
  constraint vanta_pulse_best_scores_board_id_check
    check (board_id ~ '^[a-z0-9][a-z0-9:_-]{0,63}$'),
  constraint vanta_pulse_best_scores_callsign_check
    check (callsign ~ '^[A-Z0-9_]{3,12}$'),
  constraint vanta_pulse_best_scores_score_check
    check (score between 0 and 1000000000000),
  constraint vanta_pulse_best_scores_duration_check
    check (duration_ms between 0 and 21600000)
);

-- Rate-limit lookups are equality + recent-time range scans.
create index vanta_pulse_run_tickets_requester_issued_idx
  on public.vanta_pulse_run_tickets (requester_hash, issued_at desc);

create index vanta_pulse_run_tickets_client_issued_idx
  on public.vanta_pulse_run_tickets (client_id, issued_at desc);

create index vanta_pulse_run_tickets_unconsumed_expiry_idx
  on public.vanta_pulse_run_tickets (expires_at)
  where consumed_at is null;

create index vanta_pulse_runs_client_submitted_idx
  on public.vanta_pulse_runs (client_id, submitted_at desc);

create index vanta_pulse_runs_board_submitted_idx
  on public.vanta_pulse_runs (board_id, submitted_at desc);

-- Matches the leaderboard's deterministic ordering and covers its projection.
create index vanta_pulse_best_scores_rank_idx
  on public.vanta_pulse_best_scores (
    board_id,
    score desc,
    duration_ms asc,
    achieved_at asc,
    best_score_id asc
  )
  include (callsign, client_id, run_id);

alter table public.vanta_pulse_run_tickets enable row level security;
alter table public.vanta_pulse_run_tickets force row level security;
alter table public.vanta_pulse_runs enable row level security;
alter table public.vanta_pulse_runs force row level security;
alter table public.vanta_pulse_best_scores enable row level security;
alter table public.vanta_pulse_best_scores force row level security;

-- There are deliberately no client policies. The Edge Function is the only API.
revoke all on table public.vanta_pulse_run_tickets from public, anon, authenticated;
revoke all on table public.vanta_pulse_runs from public, anon, authenticated;
revoke all on table public.vanta_pulse_best_scores from public, anon, authenticated;
-- Even the Edge service key writes through the audited RPCs, never tables.
revoke all on table public.vanta_pulse_run_tickets from service_role;
revoke all on table public.vanta_pulse_runs from service_role;
revoke all on table public.vanta_pulse_best_scores from service_role;
revoke all on sequence public.vanta_pulse_best_scores_best_score_id_seq
  from public, anon, authenticated, service_role;

create or replace function vanta_pulse_private.reject_run_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'vanta_pulse_runs is append-only';
end;
$$;

revoke execute on function vanta_pulse_private.reject_run_mutation()
  from public, anon, authenticated;

create trigger vanta_pulse_runs_reject_mutation
before update or delete on public.vanta_pulse_runs
for each row execute function vanta_pulse_private.reject_run_mutation();

create or replace function vanta_pulse_private.issue_ticket(
  p_ticket_id uuid,
  p_client_id uuid,
  p_requester_hash text,
  p_board_id text,
  p_mode text,
  p_level_id text,
  p_seed bigint,
  p_simulation_version integer,
  p_ttl_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
begin
  if p_ticket_id is null
    or p_client_id is null
    or p_requester_hash is null
    or p_requester_hash !~ '^[0-9a-f]{64}$'
    or p_board_id is null
    or p_board_id !~ '^[a-z0-9][a-z0-9:_-]{0,63}$'
    or p_mode is null
    or p_mode not in ('campaign', 'daily', 'endless')
    or p_level_id is null
    or p_level_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_seed is null
    or p_seed not between 0 and 4294967295
    or p_simulation_version is null
    or p_simulation_version not between 1 and 1000000
    or p_ttl_seconds is null
    or p_ttl_seconds not between 60 and 300
  then
    raise exception using errcode = '22023', message = 'invalid_ticket';
  end if;

  -- Serialize each requester's counter so simultaneous calls cannot race past it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vanta-pulse:ip:' || p_requester_hash, 0)
  );

  if (
    select count(*)
    from public.vanta_pulse_run_tickets as ticket
    where ticket.requester_hash = p_requester_hash
      and ticket.issued_at >= v_now - interval '1 minute'
  ) >= 8
  or (
    select count(*)
    from public.vanta_pulse_run_tickets as ticket
    where ticket.requester_hash = p_requester_hash
      and ticket.issued_at >= v_now - interval '1 hour'
  ) >= 80
  then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vanta-pulse:client:' || p_client_id::text, 0)
  );

  if (
    select count(*)
    from public.vanta_pulse_run_tickets as ticket
    where ticket.client_id = p_client_id
      and ticket.issued_at >= v_now - interval '1 minute'
  ) >= 6
  or (
    select count(*)
    from public.vanta_pulse_run_tickets as ticket
    where ticket.client_id = p_client_id
      and ticket.issued_at >= v_now - interval '1 hour'
  ) >= 60
  then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  v_expires_at := v_now + pg_catalog.make_interval(secs => p_ttl_seconds);

  insert into public.vanta_pulse_run_tickets (
    ticket_id,
    client_id,
    requester_hash,
    board_id,
    mode,
    level_id,
    seed,
    simulation_version,
    issued_at,
    expires_at
  ) values (
    p_ticket_id,
    p_client_id,
    p_requester_hash,
    p_board_id,
    p_mode,
    p_level_id,
    p_seed,
    p_simulation_version,
    v_now,
    v_expires_at
  );

  return pg_catalog.jsonb_build_object(
    'ticket_id', p_ticket_id,
    'expires_at', v_expires_at
  );
end;
$$;

revoke execute on function vanta_pulse_private.issue_ticket(
  uuid, uuid, text, text, text, text, bigint, integer, integer
) from public, anon, authenticated;

create or replace function vanta_pulse_private.begin_submission(
  p_submission_id uuid,
  p_ticket_id uuid,
  p_client_id uuid,
  p_requester_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.vanta_pulse_run_tickets%rowtype;
begin
  if p_submission_id is null
    or p_ticket_id is null
    or p_client_id is null
    or p_requester_hash is null
    or p_requester_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_ticket';
  end if;

  select ticket.*
  into v_ticket
  from public.vanta_pulse_run_tickets as ticket
  where ticket.ticket_id = p_ticket_id
  for update;

  if not found
    or v_ticket.client_id <> p_client_id
    or v_ticket.requester_hash <> p_requester_hash
  then
    raise exception using errcode = '22023', message = 'invalid_ticket';
  end if;

  -- A completed submission may be replayed by the Edge verifier with the same
  -- submission UUID so a lost response remains safely idempotent.
  if v_ticket.consumed_at is not null then
    if v_ticket.consumed_run_id <> p_submission_id then
      raise exception using errcode = '22023', message = 'ticket_consumed';
    end if;
  elsif v_ticket.expires_at <= v_now then
    raise exception using errcode = '22023', message = 'ticket_expired';
  elsif v_ticket.verification_attempts >= 3 then
    raise exception using errcode = 'P0001', message = 'verification_limited';
  else
    update public.vanta_pulse_run_tickets
    set verification_attempts = verification_attempts + 1,
        last_attempt_at = v_now
    where ticket_id = p_ticket_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'board_id', v_ticket.board_id,
    'mode', v_ticket.mode,
    'level_id', v_ticket.level_id,
    'seed', v_ticket.seed,
    'simulation_version', v_ticket.simulation_version
  );
end;
$$;

revoke execute on function vanta_pulse_private.begin_submission(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function vanta_pulse_private.commit_run(
  p_submission_id uuid,
  p_ticket_id uuid,
  p_client_id uuid,
  p_callsign text,
  p_mode text,
  p_level_id text,
  p_seed bigint,
  p_simulation_version integer,
  p_score bigint,
  p_duration_ms integer,
  p_completion_ticks integer,
  p_simulation_checksum text,
  p_replay_hash text,
  p_replay jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.vanta_pulse_runs%rowtype;
  v_ticket public.vanta_pulse_run_tickets%rowtype;
  v_is_personal_best boolean;
  v_best_score_id bigint;
  v_rank bigint;
begin
  if p_submission_id is null
    or p_ticket_id is null
    or p_client_id is null
    or p_callsign is null
    or p_callsign !~ '^[A-Z0-9_]{3,12}$'
    or p_mode is null
    or p_mode not in ('campaign', 'daily', 'endless')
    or p_level_id is null
    or p_level_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_seed is null
    or p_seed not between 0 and 4294967295
    or p_simulation_version is null
    or p_simulation_version not between 1 and 1000000
    or p_score is null
    or p_score not between 0 and 1000000000000
    or p_duration_ms is null
    or p_duration_ms not between 0 and 21600000
    or p_completion_ticks is null
    or p_completion_ticks not between 0 and 2592000
    or p_simulation_checksum is null
    or p_simulation_checksum !~ '^[0-9a-f]{8,128}$'
    or p_replay_hash is null
    or p_replay_hash !~ '^[0-9a-f]{64}$'
    or p_replay is null
    or pg_catalog.jsonb_typeof(p_replay) <> 'object'
    or pg_catalog.pg_column_size(p_replay) > 131072
  then
    raise exception using errcode = '22023', message = 'invalid_run';
  end if;

  -- Serialize identical idempotency keys. A simultaneous retry waits for the
  -- first transaction, then observes and returns its immutable run.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vanta-pulse:submission:' || p_submission_id::text, 0)
  );

  -- A retry with the same submission UUID is safe and returns the first result.
  select run.*
  into v_existing
  from public.vanta_pulse_runs as run
  where run.run_id = p_submission_id;

  if found then
    if v_existing.ticket_id <> p_ticket_id
      or v_existing.client_id <> p_client_id
      or v_existing.replay_hash <> p_replay_hash
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;

    select best.run_id = p_submission_id, best.best_score_id
    into v_is_personal_best, v_best_score_id
    from public.vanta_pulse_best_scores as best
    where best.board_id = v_existing.board_id
      and best.client_id = p_client_id;

    if v_is_personal_best then
      select 1 + count(*)
      into v_rank
      from public.vanta_pulse_best_scores as best
      where best.board_id = v_existing.board_id
        and (
          best.score > v_existing.score
          or (best.score = v_existing.score and best.duration_ms < v_existing.duration_ms)
          or (
            best.score = v_existing.score
            and best.duration_ms = v_existing.duration_ms
            and best.achieved_at < v_existing.submitted_at
          )
          or (
            best.score = v_existing.score
            and best.duration_ms = v_existing.duration_ms
            and best.achieved_at = v_existing.submitted_at
            and best.best_score_id < v_best_score_id
          )
        );
    end if;

    return pg_catalog.jsonb_build_object(
      'run_id', v_existing.run_id,
      'board_id', v_existing.board_id,
      'score', v_existing.score,
      'duration_ms', v_existing.duration_ms,
      'is_personal_best', coalesce(v_is_personal_best, false),
      'rank', v_rank,
      'idempotent', true,
      'submitted_at', v_existing.submitted_at
    );
  end if;

  select ticket.*
  into v_ticket
  from public.vanta_pulse_run_tickets as ticket
  where ticket.ticket_id = p_ticket_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'invalid_ticket';
  end if;

  if v_ticket.client_id <> p_client_id
    or v_ticket.mode <> p_mode
    or v_ticket.level_id <> p_level_id
    or v_ticket.seed <> p_seed
    or v_ticket.simulation_version <> p_simulation_version
  then
    raise exception using errcode = '22023', message = 'ticket_mismatch';
  end if;

  if v_ticket.consumed_at is not null then
    raise exception using errcode = '22023', message = 'ticket_consumed';
  end if;

  if v_ticket.expires_at <= v_now then
    raise exception using errcode = '22023', message = 'ticket_expired';
  end if;

  insert into public.vanta_pulse_runs (
    run_id,
    ticket_id,
    client_id,
    callsign,
    board_id,
    mode,
    level_id,
    seed,
    simulation_version,
    score,
    duration_ms,
    completion_ticks,
    simulation_checksum,
    replay_hash,
    replay,
    submitted_at
  ) values (
    p_submission_id,
    p_ticket_id,
    p_client_id,
    p_callsign,
    v_ticket.board_id,
    p_mode,
    p_level_id,
    p_seed,
    p_simulation_version,
    p_score,
    p_duration_ms,
    p_completion_ticks,
    p_simulation_checksum,
    p_replay_hash,
    p_replay,
    v_now
  );

  update public.vanta_pulse_run_tickets
  set consumed_at = v_now,
      consumed_run_id = p_submission_id
  where ticket_id = p_ticket_id;

  insert into public.vanta_pulse_best_scores (
    board_id,
    client_id,
    callsign,
    run_id,
    score,
    duration_ms,
    achieved_at
  ) values (
    v_ticket.board_id,
    p_client_id,
    p_callsign,
    p_submission_id,
    p_score,
    p_duration_ms,
    v_now
  )
  on conflict (board_id, client_id) do update
  set callsign = excluded.callsign,
      run_id = excluded.run_id,
      score = excluded.score,
      duration_ms = excluded.duration_ms,
      achieved_at = excluded.achieved_at
  where excluded.score > vanta_pulse_best_scores.score
    or (
      excluded.score = vanta_pulse_best_scores.score
      and excluded.duration_ms < vanta_pulse_best_scores.duration_ms
    );

  select best.run_id = p_submission_id, best.best_score_id
  into v_is_personal_best, v_best_score_id
  from public.vanta_pulse_best_scores as best
  where best.board_id = v_ticket.board_id
    and best.client_id = p_client_id;

  if v_is_personal_best then
    select 1 + count(*)
    into v_rank
    from public.vanta_pulse_best_scores as best
    where best.board_id = v_ticket.board_id
      and (
        best.score > p_score
        or (best.score = p_score and best.duration_ms < p_duration_ms)
        or (
          best.score = p_score
          and best.duration_ms = p_duration_ms
          and best.achieved_at < v_now
        )
        or (
          best.score = p_score
          and best.duration_ms = p_duration_ms
          and best.achieved_at = v_now
          and best.best_score_id < v_best_score_id
        )
      );
  end if;

  return pg_catalog.jsonb_build_object(
    'run_id', p_submission_id,
    'board_id', v_ticket.board_id,
    'score', p_score,
    'duration_ms', p_duration_ms,
    'is_personal_best', coalesce(v_is_personal_best, false),
    'rank', v_rank,
    'idempotent', false,
    'submitted_at', v_now
  );
end;
$$;

revoke execute on function vanta_pulse_private.commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) from public, anon, authenticated;

-- PostgREST exposes public RPCs. These invoker wrappers can only be executed by
-- service_role; the privileged implementation remains in an unexposed schema.
create or replace function public.vanta_pulse_issue_ticket(
  p_ticket_id uuid,
  p_client_id uuid,
  p_requester_hash text,
  p_board_id text,
  p_mode text,
  p_level_id text,
  p_seed bigint,
  p_simulation_version integer,
  p_ttl_seconds integer default 180
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select vanta_pulse_private.issue_ticket(
    p_ticket_id,
    p_client_id,
    p_requester_hash,
    p_board_id,
    p_mode,
    p_level_id,
    p_seed,
    p_simulation_version,
    p_ttl_seconds
  );
$$;

create or replace function public.vanta_pulse_commit_run(
  p_submission_id uuid,
  p_ticket_id uuid,
  p_client_id uuid,
  p_callsign text,
  p_mode text,
  p_level_id text,
  p_seed bigint,
  p_simulation_version integer,
  p_score bigint,
  p_duration_ms integer,
  p_completion_ticks integer,
  p_simulation_checksum text,
  p_replay_hash text,
  p_replay jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select vanta_pulse_private.commit_run(
    p_submission_id,
    p_ticket_id,
    p_client_id,
    p_callsign,
    p_mode,
    p_level_id,
    p_seed,
    p_simulation_version,
    p_score,
    p_duration_ms,
    p_completion_ticks,
    p_simulation_checksum,
    p_replay_hash,
    p_replay
  );
$$;

create or replace function public.vanta_pulse_begin_submission(
  p_submission_id uuid,
  p_ticket_id uuid,
  p_client_id uuid,
  p_requester_hash text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select vanta_pulse_private.begin_submission(
    p_submission_id,
    p_ticket_id,
    p_client_id,
    p_requester_hash
  );
$$;

revoke all on function public.vanta_pulse_issue_ticket(
  uuid, uuid, text, text, text, text, bigint, integer, integer
) from public, anon, authenticated;
revoke all on function public.vanta_pulse_commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.vanta_pulse_begin_submission(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant usage on schema vanta_pulse_private to service_role;
grant execute on function vanta_pulse_private.issue_ticket(
  uuid, uuid, text, text, text, text, bigint, integer, integer
) to service_role;
grant execute on function vanta_pulse_private.commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) to service_role;
grant execute on function vanta_pulse_private.begin_submission(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.vanta_pulse_issue_ticket(
  uuid, uuid, text, text, text, text, bigint, integer, integer
) to service_role;
grant execute on function public.vanta_pulse_commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) to service_role;
grant execute on function public.vanta_pulse_begin_submission(uuid, uuid, uuid, text)
  to service_role;

grant select on table public.vanta_pulse_best_scores to service_role;

comment on table public.vanta_pulse_runs is
  'Append-only, server-verified VANTA//PULSE run ledger.';
comment on table public.vanta_pulse_best_scores is
  'Materialized personal best per client and leaderboard board.';
comment on function public.vanta_pulse_commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) is
  'Service-role-only atomic ticket consumption, immutable run insert, and personal-best update.';
