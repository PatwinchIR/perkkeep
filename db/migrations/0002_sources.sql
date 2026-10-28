-- Phase 1 data layer: every account (not only cards), append-only transactions, balance snapshots,
-- per-account coverage, source connections with encrypted secrets, CSV import records, and a
-- holdings table (schema only). Same ownership model as 0001: app.current_owner() and forced RLS.

create table public.source_connections (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 source text not null check (source in ('simplefin','plaid')),
 label text not null default '' check (length(label) <= 100),
 -- AES-256-GCM ciphertext of the access URL or token; the key lives only in the server environment.
 encrypted_secret text not null check (encrypted_secret ~ '^v1\.'),
 status text not null default 'active' check (status in ('active','error','revoked')),
 last_attempted_at timestamptz, last_success_at timestamptz,
 last_error text check (length(last_error) <= 500),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_user_id,id)
);
create table public.accounts (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 source text not null check (source in ('simplefin','plaid','csv','manual')),
 connection_id uuid,
 -- HMAC of the source's account identifier; the raw identifier is never stored.
 external_ref text not null check (external_ref ~ '^[a-f0-9]{64}$'),
 institution text not null default '' check (length(institution) <= 200),
 name text not null check (length(name) between 1 and 200),
 mask text check (mask ~ '^[0-9]{4}$'),
 kind text not null default 'unknown' check (kind in ('credit','depository','investment','loan','other','unknown')),
 currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
 -- Mapping to a card is proposed by the system and confirmed once by the owner.
 proposed_card_id uuid,
 card_id uuid,
 mapping_status text not null default 'unmapped' check (mapping_status in ('unmapped','proposed','confirmed','rejected')),
 mapping_confirmed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_user_id,id), unique(owner_user_id,source,external_ref),
 foreign key(owner_user_id,connection_id) references public.source_connections(owner_user_id,id),
 foreign key(owner_user_id,proposed_card_id) references public.cards(owner_user_id,id),
 foreign key(owner_user_id,card_id) references public.cards(owner_user_id,id),
 check ((mapping_status='confirmed') = (card_id is not null and mapping_confirmed_at is not null)),
 check (mapping_status<>'proposed' or proposed_card_id is not null)
);
create index accounts_owner on public.accounts(owner_user_id);
create table public.account_coverage (
 account_id uuid primary key,
 owner_user_id uuid not null default app.current_owner(),
 earliest_synced_on date, synced_through date,
 last_attempted_at timestamptz, last_success_at timestamptz,
 last_error text check (length(last_error) <= 500),
 foreign key(owner_user_id,account_id) references public.accounts(owner_user_id,id),
 check (earliest_synced_on is null or synced_through is null or earliest_synced_on <= synced_through)
);
create table public.imports (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 account_id uuid not null,
 format text not null check (length(format) between 1 and 60),
 file_name text not null default '' check (length(file_name) <= 200),
 -- The file hash is the idempotency key; the digest covers the parsed content and target account.
 file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
 content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
 row_count integer not null check (row_count >= 0),
 rows_added integer not null default 0 check (rows_added >= 0),
 coverage_start date, coverage_end date,
 created_at timestamptz not null default now(),
 unique(owner_user_id,id), unique(owner_user_id,file_sha256),
 foreign key(owner_user_id,account_id) references public.accounts(owner_user_id,id),
 check (coverage_start is null or coverage_end is null or coverage_start <= coverage_end)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner(),
 account_id uuid not null,
 source text not null check (source in ('simplefin','plaid','csv','manual')),
 -- HMAC of the source transaction id (aggregators) or of the normalized row (CSV).
 dedup_ref text not null check (dedup_ref ~ '^[a-f0-9]{64}$'),
 -- Each observation with different content is appended as a revision of the previous one.
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 observation text not null default 'observed' check (observation in ('observed','revised','removed')),
 supersedes_transaction_id uuid,
 transacted_on date not null, posted_on date,
 amount_cents bigint not null,
 description text not null default '' check (length(description) <= 500),
 pending boolean not null default false,
 import_id uuid,
 recorded_at timestamptz not null default now(),
 unique(owner_user_id,id), unique(owner_user_id,account_id,id),
 unique(supersedes_transaction_id),
 foreign key(owner_user_id,account_id) references public.accounts(owner_user_id,id),
 foreign key(owner_user_id,account_id,supersedes_transaction_id) references public.transactions(owner_user_id,account_id,id),
 foreign key(owner_user_id,import_id) references public.imports(owner_user_id,id),
 check ((observation='observed') = (supersedes_transaction_id is null))
);
create index transactions_account_date on public.transactions(owner_user_id,account_id,transacted_on desc);
create index transactions_ref on public.transactions(owner_user_id,account_id,dedup_ref);
-- One original observation per source reference; with unique(supersedes_transaction_id) every
-- reference has a single linear revision chain. Content may legitimately repeat along that chain.
create unique index transactions_one_root on public.transactions(owner_user_id,account_id,dedup_ref) where observation='observed';
create table public.balance_snapshots (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner(),
 account_id uuid not null,
 observed_at timestamptz not null,
 balance_cents bigint not null, available_cents bigint,
 source text not null check (source in ('simplefin','plaid','csv','manual')),
 recorded_at timestamptz not null default now(),
 unique(owner_user_id,account_id,observed_at,source),
 foreign key(owner_user_id,account_id) references public.accounts(owner_user_id,id)
);
-- Holdings: schema only until a source provides them (Phase 4).
create table public.holdings (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner(),
 account_id uuid not null,
 observed_at timestamptz not null,
 symbol text check (length(symbol) <= 20), description text not null default '' check (length(description) <= 200),
 quantity numeric, value_cents bigint, cost_basis_cents bigint,
 source text not null check (source in ('simplefin','plaid','csv','manual')),
 foreign key(owner_user_id,account_id) references public.accounts(owner_user_id,id)
);
create table public.source_syncs (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 connection_id uuid not null,
 trigger text not null check (trigger in ('manual','scheduled','claim')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null check (status in ('running','success','partial','failed')),
 accounts_seen integer not null default 0, transactions_added integer not null default 0,
 window_start date, window_end date,
 messages jsonb not null default '[]',
 foreign key(owner_user_id,connection_id) references public.source_connections(owner_user_id,id)
);
create index source_syncs_owner on public.source_syncs(owner_user_id,started_at desc);

do $$ declare t text; begin
 foreach t in array array['source_connections','accounts','account_coverage','imports','transactions','balance_snapshots','holdings','source_syncs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public',t);
 execute format('grant select, insert on public.%I to perkkeep_app',t);
 execute format('create policy owner_select on public.%I for select to perkkeep_app using ((select app.current_owner()) = owner_user_id)',t);
 execute format('create policy owner_insert on public.%I for insert to perkkeep_app with check ((select app.current_owner()) = owner_user_id)',t);
 end loop;
 foreach t in array array['source_connections','accounts','account_coverage','source_syncs'] loop
 execute format('create policy owner_update on public.%I for update to perkkeep_app using ((select app.current_owner()) = owner_user_id) with check ((select app.current_owner()) = owner_user_id)',t);
 end loop;
end $$;
-- Transactions, imports, balances and holdings are append-only: no UPDATE or DELETE grants.
grant update(label,encrypted_secret,status,last_attempted_at,last_success_at,last_error,updated_at) on public.source_connections to perkkeep_app;
grant update(connection_id,institution,name,mask,kind,proposed_card_id,card_id,mapping_status,mapping_confirmed_at,updated_at) on public.accounts to perkkeep_app;
grant update(earliest_synced_on,synced_through,last_attempted_at,last_success_at,last_error) on public.account_coverage to perkkeep_app;
grant update(finished_at,status,accounts_seen,transactions_added,messages) on public.source_syncs to perkkeep_app;

create function private.touch() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
create trigger touch before update on public.source_connections for each row execute function private.touch();
create trigger touch before update on public.accounts for each row execute function private.touch();
do $$ declare t text; begin
 foreach t in array array['accounts','imports'] loop
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
 end loop;
end $$;

-- Appends one batch of source transactions for an account. A repeated observation is a no-op; a
-- changed observation (pending→posted, amount or description change) is appended as a revision
-- linked to the latest row; a source-reported removal is appended as a 'removed' revision.
-- Earlier rows are never updated or deleted.
create function public.ingest_transactions(p_account_id uuid,p_source text,p_rows jsonb,p_import_id uuid default null)
returns table(added integer, revised integer, unchanged integer)
language plpgsql security invoker set search_path='' as $$
declare a public.accounts; r jsonb; latest public.transactions; had boolean; h text; obs text; n_added int=0; n_revised int=0; n_same int=0;
begin
 select * into strict a from public.accounts where id=p_account_id and owner_user_id=app.current_owner();
 if a.source<>p_source then raise exception 'Account belongs to another source'; end if;
 perform pg_advisory_xact_lock(hashtextextended('perkkeep_tx'||a.id::text,0));
 for r in select value from jsonb_array_elements(p_rows) loop
  obs=case when (r->>'removed')::boolean then 'removed' else 'observed' end;
  h=encode(sha256(convert_to(jsonb_build_object('t',r->>'transacted_on','p',r->>'posted_on','a',(r->>'amount_cents')::bigint,
     'd',coalesce(r->>'description',''),'pending',coalesce((r->>'pending')::boolean,false),'removed',obs='removed')::text,'UTF8')),'hex');
  select t.* into latest from public.transactions t where t.owner_user_id=app.current_owner() and t.account_id=a.id and t.dedup_ref=r->>'dedup_ref'
   and not exists(select 1 from public.transactions later where later.supersedes_transaction_id=t.id);
  had=found;
  if had and latest.content_hash=h then n_same=n_same+1; continue; end if;
  if not had and obs='removed' then n_same=n_same+1; continue; end if;
  -- A removal keeps the facts of the row it removes; sources may report only the id.
  if obs='removed' then
   r=r||jsonb_build_object('transacted_on',latest.transacted_on,'posted_on',latest.posted_on,'amount_cents',latest.amount_cents,
     'description',latest.description,'pending',latest.pending);
   h=encode(sha256(convert_to(jsonb_build_object('removed_ref',latest.id)::text,'UTF8')),'hex');
  end if;
  insert into public.transactions(account_id,source,dedup_ref,content_hash,observation,supersedes_transaction_id,transacted_on,posted_on,amount_cents,description,pending,import_id)
  values(a.id,p_source,r->>'dedup_ref',h,case when not had then 'observed' when obs='removed' then 'removed' else 'revised' end,
   case when had then latest.id end,(r->>'transacted_on')::date,(r->>'posted_on')::date,(r->>'amount_cents')::bigint,
   left(coalesce(r->>'description',''),500),coalesce((r->>'pending')::boolean,false),p_import_id);
  if had then n_revised=n_revised+1; else n_added=n_added+1; end if;
 end loop;
 added=n_added; revised=n_revised; unchanged=n_same; return next;
end $$;

-- Coverage only advances on success. A failed attempt records the error and leaves the dates as they were.
create function public.record_account_sync(p_account_id uuid,p_window_start date,p_window_end date,p_error text default null)
returns public.account_coverage language plpgsql security invoker set search_path='' as $$
declare c public.account_coverage;
begin
 perform 1 from public.accounts where id=p_account_id and owner_user_id=app.current_owner();
 if not found then raise exception 'Account unavailable to this owner'; end if;
 insert into public.account_coverage(account_id) values(p_account_id) on conflict(account_id) do nothing;
 if p_error is null then
  update public.account_coverage set last_attempted_at=now(), last_success_at=now(), last_error=null,
   earliest_synced_on=least(coalesce(earliest_synced_on,p_window_start),p_window_start),
   synced_through=greatest(coalesce(synced_through,p_window_end),p_window_end)
  where account_id=p_account_id returning * into c;
 else
  update public.account_coverage set last_attempted_at=now(), last_error=left(p_error,500) where account_id=p_account_id returning * into c;
 end if;
 return c;
end $$;

-- Lets the daily job find connections to sync without reading any other owner data.
create function app.connections_due() returns table(owner_id uuid, connection_id uuid)
language sql security definer set search_path='' as $$
 select owner_user_id, id from public.source_connections where status in ('active','error') order by last_attempted_at nulls first;
$$;

revoke all on function public.ingest_transactions(uuid,text,jsonb,uuid), public.record_account_sync(uuid,date,date,text), app.connections_due(), private.touch() from public;
grant execute on function public.ingest_transactions(uuid,text,jsonb,uuid), public.record_account_sync(uuid,date,date,text), app.connections_due() to perkkeep_app;
