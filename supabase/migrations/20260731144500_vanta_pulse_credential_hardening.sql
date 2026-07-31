-- Forward-only hardening for the already-deployed VANTA//PULSE leaderboard.
-- Browser identity is now authenticated by the Edge Function's signed device
-- credential. The requester hash remains an issuance/rate-limit signal, not a
-- brittle network-location authentication factor during replay submission.

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

  if not found or v_ticket.client_id <> p_client_id then
    raise exception using errcode = '22023', message = 'invalid_ticket';
  end if;

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
grant execute on function vanta_pulse_private.begin_submission(uuid, uuid, uuid, text)
  to service_role;

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
  v_best public.vanta_pulse_best_scores%rowtype;
  v_is_personal_best boolean;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vanta-pulse:submission:' || p_submission_id::text, 0)
  );

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

    select best.*
    into v_best
    from public.vanta_pulse_best_scores as best
    where best.board_id = v_existing.board_id
      and best.client_id = p_client_id;

    if not found then
      raise exception using errcode = '22023', message = 'invalid_run';
    end if;

    v_is_personal_best := v_best.run_id = p_submission_id;

    select 1 + count(*)
    into v_rank
    from public.vanta_pulse_best_scores as best
    where best.board_id = v_best.board_id
      and (
        best.score > v_best.score
        or (best.score = v_best.score and best.duration_ms < v_best.duration_ms)
        or (
          best.score = v_best.score
          and best.duration_ms = v_best.duration_ms
          and best.achieved_at < v_best.achieved_at
        )
        or (
          best.score = v_best.score
          and best.duration_ms = v_best.duration_ms
          and best.achieved_at = v_best.achieved_at
          and best.best_score_id < v_best.best_score_id
        )
      );

    return pg_catalog.jsonb_build_object(
      'run_id', v_existing.run_id,
      'board_id', v_existing.board_id,
      'score', v_existing.score,
      'duration_ms', v_existing.duration_ms,
      'is_personal_best', v_is_personal_best,
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

  select best.*
  into v_best
  from public.vanta_pulse_best_scores as best
  where best.board_id = v_ticket.board_id
    and best.client_id = p_client_id;

  if not found then
    raise exception using errcode = '22023', message = 'invalid_run';
  end if;

  v_is_personal_best := v_best.run_id = p_submission_id;

  select 1 + count(*)
  into v_rank
  from public.vanta_pulse_best_scores as best
  where best.board_id = v_best.board_id
    and (
      best.score > v_best.score
      or (best.score = v_best.score and best.duration_ms < v_best.duration_ms)
      or (
        best.score = v_best.score
        and best.duration_ms = v_best.duration_ms
        and best.achieved_at < v_best.achieved_at
      )
      or (
        best.score = v_best.score
        and best.duration_ms = v_best.duration_ms
        and best.achieved_at = v_best.achieved_at
        and best.best_score_id < v_best.best_score_id
      )
    );

  return pg_catalog.jsonb_build_object(
    'run_id', p_submission_id,
    'board_id', v_ticket.board_id,
    'score', p_score,
    'duration_ms', p_duration_ms,
    'is_personal_best', v_is_personal_best,
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
grant execute on function vanta_pulse_private.commit_run(
  uuid, uuid, uuid, text, text, text, bigint, integer, bigint, integer,
  integer, text, text, jsonb
) to service_role;
