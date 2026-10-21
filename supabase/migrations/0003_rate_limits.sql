-- Fixed-window rate limiting for auth endpoints (PRODUCTION-BRIEF §3.1).
-- Called only by the server with the service role.

create table if not exists public.rate_limits (
  key          text primary key,
  hits         int not null,
  window_start timestamptz not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Returns true while the caller is within p_max hits per p_window_seconds.
create or replace function public.consume_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as rl (key, hits, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    hits = case when rl.window_start <= now() - make_interval(secs => p_window_seconds)
                then 1 else rl.hits + 1 end,
    window_start = case when rl.window_start <= now() - make_interval(secs => p_window_seconds)
                then now() else rl.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

revoke execute on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;
