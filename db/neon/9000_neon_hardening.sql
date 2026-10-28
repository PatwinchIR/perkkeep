-- Applied after the shared ledger migrations. Fails the migration if the restricted
-- role could bypass row-level security or reach identity mappings.
begin;
do $$ begin
 if exists (select 1 from pg_catalog.pg_roles where rolname in ('authenticated','anon') and (rolbypassrls or rolsuper or rolcanlogin)) then
  raise exception 'Restricted roles must not log in, be superusers or bypass RLS';
 end if;
 if pg_catalog.has_table_privilege('authenticated', 'auth.users', 'select') then
  raise exception 'authenticated must not read identity mappings';
 end if;
 if exists (
  select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 ) then
  raise exception 'Every public table must enforce row-level security';
 end if;
end $$;
commit;
