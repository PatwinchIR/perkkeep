-- Neon platform prelude. Applied once, before the shared ledger migrations in
-- supabase/migrations, so those migrations run unchanged on Neon.
--
-- Supabase provides the `auth` schema, `auth.uid()`, `auth.users` and the
-- `anon`/`authenticated` roles. On Neon the server verifies a Neon Auth session,
-- maps it to an internal UUID in `auth.users`, then runs each request inside a
-- transaction with `SET LOCAL ROLE authenticated` and a transaction-local
-- `perkkeep.user_id`. `authenticated` has no BYPASSRLS, so every ownership policy applies.
begin;
create schema if not exists extensions;
create schema if not exists auth;

do $$ begin
 if not exists (select 1 from pg_catalog.pg_roles where rolname='authenticated') then
  create role authenticated nologin noinherit nobypassrls;
 end if;
 if not exists (select 1 from pg_catalog.pg_roles where rolname='anon') then
  create role anon nologin noinherit nobypassrls;
 end if;
end $$;
-- The server connection may switch to the restricted role; it never needs the reverse.
grant authenticated to current_user;

-- Internal identities. Neon Auth's own user IDs are mapped rather than referenced so
-- the ledger does not depend on the managed neon_auth schema layout.
create table auth.users (
 id uuid primary key default gen_random_uuid(),
 neon_auth_user_id text not null unique check (length(neon_auth_user_id) between 1 and 200),
 email text check (length(email) <= 320),
 created_at timestamptz not null default now()
);
revoke all on auth.users from public, anon, authenticated;

create function auth.uid() returns uuid language sql stable set search_path='' as $$
 select nullif(pg_catalog.current_setting('perkkeep.user_id', true), '')::uuid
$$;
revoke all on schema auth from public, anon;
grant usage on schema auth to authenticated;
revoke all on function auth.uid() from public, anon;
grant execute on function auth.uid() to authenticated;

revoke all on schema public from anon;
grant usage on schema public to authenticated;
commit;
