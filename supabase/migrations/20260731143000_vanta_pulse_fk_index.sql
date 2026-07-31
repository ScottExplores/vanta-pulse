-- Covers the reverse foreign-key lookup used when PostgreSQL validates a
-- referenced run mutation. Runs are append-only, but keeping the constraint
-- fully indexed also leaves future archival operations predictable.
create index if not exists vanta_pulse_run_tickets_consumed_run_idx
  on public.vanta_pulse_run_tickets (consumed_run_id)
  where consumed_run_id is not null;
