-- PerkKeep ledger for plain PostgreSQL (Neon). Ports supabase/migrations/2026102*.sql.
-- Identity comes from a transaction-local setting (app.owner_id) that the server sets only after
-- verifying the session. The migration owner (BYPASSRLS on Neon) never serves user queries; the
-- application connects as perkkeep_app, which has no BYPASSRLS and owns nothing.
create extension if not exists btree_gist;
do $$ begin
 if not exists (select 1 from pg_roles where rolname='perkkeep_app') then
  create role perkkeep_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
end $$;
create schema if not exists app;
create schema if not exists private;
revoke all on schema app, private from public;
revoke create on schema public from public;
grant usage on schema public, app to perkkeep_app;

create table public.owners (
 id uuid primary key default gen_random_uuid(),
 auth_provider text not null check (auth_provider in ('neon','test')),
 auth_subject text not null check (length(auth_subject) between 1 and 200),
 email text not null check (length(email) between 3 and 320),
 created_at timestamptz not null default now(),
 unique(auth_provider,auth_subject)
);

-- NULL when the server has not set an identity: every policy then matches no rows.
create function app.current_owner() returns uuid language sql stable set search_path='' as $$
 select nullif(pg_catalog.current_setting('app.owner_id', true), '')::uuid;
$$;

create table public.cards (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 issuer text not null check (length(issuer) between 1 and 100),
 display_name text not null check (length(display_name) between 1 and 100),
 product_name text, last4 text check (last4 ~ '^[0-9]{4}$'),
 status text not null default 'unknown' check (status in ('active','closed','unknown')),
 identity_verified_at timestamptz, cardmember_anchor_date date,
 issuer_timezone text not null default 'America/New_York',
 catalog_key text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_user_id,issuer,last4), unique(owner_user_id,id)
);
create unique index cards_owner_catalog_key on public.cards(owner_user_id,catalog_key) where catalog_key is not null;
create table public.benefits (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default app.current_owner(),
 card_id uuid not null, rule_key uuid not null default gen_random_uuid(),
 name text not null check(length(name) between 1 and 150), description text not null default '',
 category text not null default 'Other',
 cadence text not null check(cadence in ('monthly','quarterly','semiannual','calendar_year','cardmember_year','one_time','custom')),
 nominal_amount_cents integer check(nominal_amount_cents >= 0), nominal_units integer check(nominal_units >= 0),
 unit_label text, reset_anchor date, custom_end_exclusive date,
 enrollment_required boolean not null default false,
 enrollment_status text not null default 'unknown' check(enrollment_status in ('unknown','active','inactive','not_required')),
 eligibility_status text not null default 'unknown' check(eligibility_status in ('unknown','eligible','ineligible')),
 manual_verification_required boolean not null default false,
 eligibility_rules_json jsonb not null default '{}',
 effective_from date not null, effective_to date,
 issuer_source_url text check(issuer_source_url ~ '^https://'), verified_at timestamptz,
 enabled boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(owner_user_id,card_id) references public.cards(owner_user_id,id),
 unique(owner_user_id,id), unique(owner_user_id,card_id,id),
 check(effective_to is null or effective_to > effective_from),
 check(nominal_amount_cents is null or nominal_units is null),
 check(not enabled or (verified_at is not null and issuer_source_url is not null)),
 exclude using gist(card_id with =, rule_key with =, daterange(effective_from,effective_to,'[)') with &&)
);
create index benefits_owner_card on public.benefits(owner_user_id,card_id);
create table public.benefit_periods (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default app.current_owner(),
 card_id uuid not null, benefit_id uuid not null,
 period_start date not null, period_end_exclusive date not null,
 allowance_cents integer check(allowance_cents >= 0), allowance_units integer check(allowance_units >= 0),
 rule_snapshot jsonb not null,
 coverage_status text not null default 'unavailable' check(coverage_status in ('complete','partial','unavailable')),
 coverage_through date, last_reconciled_at timestamptz, notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(benefit_id,period_start,period_end_exclusive), unique(owner_user_id,id), unique(owner_user_id,card_id,id),
 foreign key(owner_user_id,card_id,benefit_id) references public.benefits(owner_user_id,card_id,id),
 check(period_end_exclusive > period_start),
 check(allowance_cents is null or allowance_units is null),
 exclude using gist(benefit_id with =, daterange(period_start,period_end_exclusive,'[)') with &&)
);
create index periods_owner_benefit on public.benefit_periods(owner_user_id,benefit_id);
create index periods_card on public.benefit_periods(owner_user_id,card_id);
create table public.redemption_evidence (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default app.current_owner(),
 card_id uuid not null, benefit_period_id uuid not null,
 source_type text not null check(source_type in ('purchase','statement_credit','email_confirmation','issuer_portal','manual','refund','reversal')),
 source_reference_hash text check(source_reference_hash ~ '^[a-f0-9]{64}$'),
 transaction_date date not null, recorded_at timestamptz not null default now(),
 merchant text check(length(merchant) <= 200), amount_cents integer, units integer,
 eligibility_result text not null default 'unknown' check(eligibility_result in ('eligible','unknown','ineligible')),
 confirmation_result text not null default 'unverified',
 confidence text not null check(confidence in ('confirmed','candidate','unknown','rejected')),
 recorded_by text not null default 'user' check(recorded_by in ('user','import','inference')),
 notes text not null default '' check(length(notes) <= 4000),
 supersedes_evidence_id uuid,
 unique(owner_user_id,id), unique(owner_user_id,benefit_period_id,id),
 unique(owner_user_id,card_id,benefit_period_id,source_type,source_reference_hash),
 unique(supersedes_evidence_id),
 foreign key(owner_user_id,card_id,benefit_period_id) references public.benefit_periods(owner_user_id,card_id,id),
 foreign key(owner_user_id,benefit_period_id,supersedes_evidence_id) references public.redemption_evidence(owner_user_id,benefit_period_id,id),
 check(id is distinct from supersedes_evidence_id),
 check(amount_cents is null or units is null),
 check(source_type <> 'purchase' or confidence <> 'confirmed'),
 check(recorded_by <> 'inference' or confidence <> 'confirmed'),
 check(confidence <> 'confirmed' or eligibility_result = 'eligible'),
 check(confidence not in ('confirmed','candidate') or (amount_cents is not null or units is not null)),
 check(source_type in ('refund','reversal') or (coalesce(amount_cents,0)>=0 and coalesce(units,0)>=0)),
 check(source_type not in ('refund','reversal') or (coalesce(amount_cents,0)<=0 and coalesce(units,0)<=0))
);
create index evidence_period on public.redemption_evidence(owner_user_id,benefit_period_id);
create index evidence_card on public.redemption_evidence(owner_user_id,card_id);
create table public.sync_runs (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 request_key uuid not null default gen_random_uuid(),
 trigger text not null check(trigger in ('manual','scheduled','user_edit')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null check(status in ('running','success','partial','failed')),
 coverage_summary_json jsonb not null default '{}',
 periods_checked integer not null default 0 check(periods_checked>=0),
 candidates_found integer not null default 0 check(candidates_found>=0),
 confirmed_updates integer not null default 0 check(confirmed_updates>=0),
 error_summary text, request_digest text, unique(owner_user_id,request_key)
);
create index sync_owner_date on public.sync_runs(owner_user_id,started_at desc);
create table public.audit_events (
 id bigint generated always as identity primary key,
 owner_user_id uuid not null references public.owners(id) on delete restrict,
 entity_table text not null, entity_id uuid not null, action text not null,
 old_record jsonb, new_record jsonb, occurred_at timestamptz not null default now()
);
create index audit_owner_date on public.audit_events(owner_user_id,occurred_at desc);

-- Explicit privileges, RLS and composite foreign keys enforce isolation independently of server code.
alter table public.owners enable row level security;
alter table public.owners force row level security;
revoke all on public.owners from public;
grant select on public.owners to perkkeep_app;
create policy owner_select on public.owners for select to perkkeep_app using (id = (select app.current_owner()));
do $$ declare t text; begin
 foreach t in array array['cards','benefits','benefit_periods','redemption_evidence','sync_runs','audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public',t);
 execute format('grant select on public.%I to perkkeep_app',t);
 execute format('create policy owner_select on public.%I for select to perkkeep_app using ((select app.current_owner()) = owner_user_id)',t);
 if t <> 'audit_events' then
 execute format('grant insert on public.%I to perkkeep_app',t);
 execute format('create policy owner_insert on public.%I for insert to perkkeep_app with check ((select app.current_owner()) = owner_user_id)',t);
 end if;
 end loop;
end $$;
grant update on public.cards, public.benefits to perkkeep_app;
grant update(coverage_status,coverage_through,last_reconciled_at,notes) on public.benefit_periods to perkkeep_app;
grant update(finished_at,status,coverage_summary_json,periods_checked,candidates_found,confirmed_updates,error_summary) on public.sync_runs to perkkeep_app;
do $$ declare t text; begin
 foreach t in array array['cards','benefits','benefit_periods','sync_runs'] loop
 execute format('create policy owner_update on public.%I for update to perkkeep_app using ((select app.current_owner()) = owner_user_id) with check ((select app.current_owner()) = owner_user_id)',t);
 end loop;
end $$;

-- The server calls this only with an identity it verified. It runs as the migration owner so the
-- restricted role never needs INSERT on owners.
create function app.resolve_owner(p_provider text,p_subject text,p_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 insert into public.owners(auth_provider,auth_subject,email) values(p_provider,p_subject,lower(p_email))
 on conflict(auth_provider,auth_subject) do update set email=excluded.email
 returning id into v;
 return v;
end $$;

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if app.current_owner() is null or new.owner_user_id <> app.current_owner() then raise exception 'Authenticated owner required'; end if;
 insert into public.audit_events(owner_user_id,entity_table,entity_id,action,old_record,new_record)
 values(new.owner_user_id,tg_table_name,new.id,tg_op,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
-- Superseded rules may end inside a previously generated period. The original snapshot and
-- period stay intact; the old rule no longer contributes to current available totals.
create function private.guard_change() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if tg_op='UPDATE' then
  if new.id <> old.id or new.owner_user_id <> old.owner_user_id or new.created_at <> old.created_at then raise exception 'Identity and creation time are immutable'; end if;
 end if;
 new.updated_at=now();
 if tg_table_name='cards' then
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.issuer_timezone) then raise exception 'Unknown issuer timezone'; end if;
 elsif tg_table_name='benefits' then
  if new.enabled and not exists(select 1 from public.cards where id=new.card_id and identity_verified_at is not null and status='active') then raise exception 'Confirm the card identity before enabling benefits'; end if;
  if tg_op='UPDATE' and exists(select 1 from public.benefit_periods where benefit_id=old.id) and
    (to_jsonb(new)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to']) is distinct from
    (to_jsonb(old)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to']) then
    raise exception 'Create a new benefit version to change historical terms';
  end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['cards','benefits','benefit_periods'] loop
 execute format('create trigger guard_change before insert or update on public.%I for each row execute function private.guard_change()',t);
 end loop;
 foreach t in array array['cards','benefits','benefit_periods','redemption_evidence','sync_runs'] loop
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
 end loop;
end $$;

create function private.guard_evidence() returns trigger language plpgsql security invoker set search_path = '' as $$
declare p public.benefit_periods; prev public.redemption_evidence;
begin
 select * into strict p from public.benefit_periods where id=new.benefit_period_id;
 if new.source_type='purchase' and (new.transaction_date<p.period_start or new.transaction_date>=p.period_end_exclusive) then raise exception 'Purchase is outside this benefit period'; end if;
 if (p.rule_snapshot->>'nominal_units') is not null and new.amount_cents is not null then raise exception 'Use units for this benefit'; end if;
 if (p.rule_snapshot->>'nominal_amount_cents') is not null and new.units is not null then raise exception 'Use cents for this benefit'; end if;
 if new.confidence='confirmed' and (new.source_type='manual' or new.source_type in ('refund','reversal')) and length(trim(new.notes))=0 then raise exception 'Explain the manual confirmation or entitlement reversal'; end if;
 if new.supersedes_evidence_id is not null then
  select * into strict prev from public.redemption_evidence where id=new.supersedes_evidence_id;
  if prev.recorded_by='user' and new.recorded_by<>'user' then raise exception 'Imports cannot override user evidence'; end if;
 end if;
 return new;
end $$;
create trigger guard_evidence before insert on public.redemption_evidence for each row execute function private.guard_evidence();

-- Anniversary dates clamp February 29 to February 28 in non-leap years.
create function public.anniversary(p_anchor date,p_year integer) returns date language sql immutable set search_path='' as $$
 select (make_date(p_year,extract(month from p_anchor)::int,1) +
   (least(extract(day from p_anchor)::int,extract(day from (make_date(p_year,extract(month from p_anchor)::int,1)+interval '1 month - 1 day'))::int)-1))::date;
$$;
create function public.period_window(p_cadence text,p_on date,p_anchor date,p_effective_from date,p_effective_to date,p_custom_end date)
returns table(period_start date,period_end_exclusive date,partial_rule_window boolean)
language plpgsql immutable set search_path='' as $$
declare s date; e date;
begin
 if p_on<p_effective_from or (p_effective_to is not null and p_on>=p_effective_to) then raise exception 'Date outside rule effective window'; end if;
 case p_cadence
 when 'monthly' then s=date_trunc('month',p_on)::date; e=(s+interval '1 month')::date;
 when 'quarterly' then s=date_trunc('quarter',p_on)::date; e=(s+interval '3 months')::date;
 when 'semiannual' then s=make_date(extract(year from p_on)::int,case when extract(month from p_on)<=6 then 1 else 7 end,1); e=(s+interval '6 months')::date;
 when 'calendar_year' then s=date_trunc('year',p_on)::date; e=(s+interval '1 year')::date;
 when 'cardmember_year' then
  if p_anchor is null then raise exception 'Cardmember anniversary needs confirmation'; end if;
  s=public.anniversary(p_anchor,extract(year from p_on)::int);
  if p_on<s then s=public.anniversary(p_anchor,extract(year from p_on)::int-1); end if;
  e=public.anniversary(p_anchor,extract(year from s)::int+1);
 when 'one_time','custom' then
  s=coalesce(p_anchor,p_effective_from); e=p_custom_end;
  if e is null or p_on<s or p_on>=e then raise exception 'Confirm custom start and end dates'; end if;
 else raise exception 'Unknown cadence';
 end case;
 period_start=greatest(s,p_effective_from);period_end_exclusive=least(e,coalesce(p_effective_to,e));
 partial_rule_window=period_start<>s or period_end_exclusive<>e;
 return next;
end $$;
create function public.ensure_period(p_benefit_id uuid,p_on date default null) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; p public.benefit_periods; w record; d date;
begin
 select * into strict b from public.benefits where id=p_benefit_id and owner_user_id=app.current_owner();
 select * into strict c from public.cards where id=b.card_id;
 d=coalesce(p_on,(now() at time zone c.issuer_timezone)::date);
 if not b.enabled or c.status<>'active' or c.identity_verified_at is null then raise exception 'Confirm the active card and benefit first'; end if;
 -- A saved period is returned as-is, even if mutable enrollment details have since changed.
 select * into p from public.benefit_periods where benefit_id=b.id and period_start<=d and period_end_exclusive>d;
 if found then return p; end if;
 select * into strict w from public.period_window(b.cadence,d,case when b.cadence='cardmember_year' then coalesce(b.reset_anchor,c.cardmember_anchor_date) else b.reset_anchor end,b.effective_from,b.effective_to,b.custom_end_exclusive);
 insert into public.benefit_periods(owner_user_id,card_id,benefit_id,period_start,period_end_exclusive,allowance_cents,allowance_units,rule_snapshot)
 values(app.current_owner(),b.card_id,b.id,w.period_start,w.period_end_exclusive,case when not w.partial_rule_window then b.nominal_amount_cents end,case when not w.partial_rule_window then b.nominal_units end,
 to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',w.partial_rule_window))
 on conflict(benefit_id,period_start,period_end_exclusive) do nothing;
 select * into strict p from public.benefit_periods where benefit_id=b.id and period_start=w.period_start and period_end_exclusive=w.period_end_exclusive;
 return p;
end $$;

-- Reject forged snapshots, boundaries and allowances even on direct inserts.
create function private.guard_period() returns trigger language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; w record;
begin
 select * into strict b from public.benefits where id=new.benefit_id;
 select * into strict c from public.cards where id=b.card_id;
 if not b.enabled or c.identity_verified_at is null or c.status<>'active' then raise exception 'Confirmed card and enabled terms required'; end if;
 select * into strict w from public.period_window(b.cadence,new.period_start,case when b.cadence='cardmember_year' then coalesce(b.reset_anchor,c.cardmember_anchor_date) else b.reset_anchor end,b.effective_from,b.effective_to,b.custom_end_exclusive);
 if new.period_start<>w.period_start or new.period_end_exclusive<>w.period_end_exclusive then raise exception 'Period dates must match reset rules'; end if;
 if new.rule_snapshot is distinct from (to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',w.partial_rule_window)) then raise exception 'Invalid rule snapshot'; end if;
 if new.allowance_cents is distinct from (case when not w.partial_rule_window then b.nominal_amount_cents end) or new.allowance_units is distinct from (case when not w.partial_rule_window then b.nominal_units end) then raise exception 'Allowance must match verified terms'; end if;
 return new;
end $$;
create trigger guard_period before insert on public.benefit_periods for each row execute function private.guard_period();
-- Validate claimed complete coverage and preserve timestamps for audit.
create function private.guard_coverage() returns trigger language plpgsql security invoker set search_path='' as $$
declare tz text;
begin
 select issuer_timezone into strict tz from public.cards where id=new.card_id;
 if new.coverage_status='complete' and (new.coverage_through is null or new.last_reconciled_at is null) then raise exception 'Complete coverage needs an observation date and timestamp'; end if;
 if new.last_reconciled_at>now()+interval '1 minute' or new.coverage_through>(now() at time zone tz)::date then raise exception 'Observation cannot be in the future'; end if;
 return new;
end $$;
create trigger guard_coverage before insert or update on public.benefit_periods for each row execute function private.guard_coverage();

create function public.record_evidence(p_record jsonb) returns public.redemption_evidence language plpgsql security invoker set search_path='' as $$
declare n public.redemption_evidence; existing public.redemption_evidence; p public.benefit_periods;
begin
 select * into strict p from public.benefit_periods where id=(p_record->>'benefit_period_id')::uuid and owner_user_id=app.current_owner();
 n.id=coalesce((p_record->>'id')::uuid,gen_random_uuid()); n.owner_user_id=app.current_owner(); n.card_id=p.card_id; n.benefit_period_id=p.id;
 n.source_type=p_record->>'source_type'; n.source_reference_hash=p_record->>'source_reference_hash';
 n.transaction_date=(p_record->>'transaction_date')::date; n.recorded_at=now(); n.merchant=p_record->>'merchant';
 n.amount_cents=(p_record->>'amount_cents')::integer; n.units=(p_record->>'units')::integer;
 n.eligibility_result=coalesce(p_record->>'eligibility_result','unknown'); n.confirmation_result=coalesce(p_record->>'confirmation_result','unverified');
 n.confidence=p_record->>'confidence'; n.recorded_by=coalesce(p_record->>'recorded_by','user'); n.notes=coalesce(p_record->>'notes','');
 n.supersedes_evidence_id=(p_record->>'supersedes_evidence_id')::uuid;
 -- Serialize imports per period so duplicate detection and correction are one transaction.
 perform 1 from public.benefit_periods where id=p.id for update;
 select * into existing from public.redemption_evidence where owner_user_id=app.current_owner() and
   (id=n.id or (card_id=n.card_id and benefit_period_id=n.benefit_period_id and source_type=n.source_type and source_reference_hash=n.source_reference_hash));
 if found then
  if (to_jsonb(existing)-array['id','recorded_at']) is distinct from (to_jsonb(n)-array['id','recorded_at']) then raise exception 'Idempotency key reused with different evidence; append a correction'; end if;
  return existing;
 end if;
 insert into public.redemption_evidence select n.*;
 return n;
end $$;

create view public.period_balances with(security_invoker=true) as
 select p.*, b.name as benefit_name,b.cadence,b.enrollment_required,b.enrollment_status,b.eligibility_status,b.enabled,
 c.display_name as card_name,c.last4,c.issuer,c.issuer_timezone,c.status as card_status,
 c.identity_verified_at,
 coalesce(t.confirmed_cents,0)::bigint as confirmed_cents,coalesce(t.candidate_cents,0)::bigint as candidate_cents,
 coalesce(t.confirmed_units,0)::bigint as confirmed_units,coalesce(t.candidate_units,0)::bigint as candidate_units,
 case when p.allowance_cents is not null then greatest(p.allowance_cents-coalesce(t.confirmed_cents,0),0) end as remaining_cents,
 case when p.allowance_units is not null then greatest(p.allowance_units-coalesce(t.confirmed_units,0),0) end as remaining_units,
 coalesce(t.unresolved_count,0)::integer as unresolved_count,
 coalesce(t.negative_balance,false) as negative_balance
 from public.benefit_periods p join public.benefits b on b.id=p.benefit_id join public.cards c on c.id=p.card_id
 left join lateral (
  select greatest(coalesce(sum(e.amount_cents) filter(where confidence='confirmed'),0),0) as confirmed_cents,
   greatest(coalesce(sum(e.amount_cents) filter(where confidence='candidate'),0),0) as candidate_cents,
   greatest(coalesce(sum(e.units) filter(where confidence='confirmed'),0),0) as confirmed_units,
   greatest(coalesce(sum(e.units) filter(where confidence='candidate'),0),0) as candidate_units,
   count(*) filter(where confidence='unknown') as unresolved_count,
   (coalesce(sum(e.amount_cents) filter(where confidence='confirmed'),0)<0 or coalesce(sum(e.units) filter(where confidence='confirmed'),0)<0) as negative_balance
  from public.redemption_evidence e where e.benefit_period_id=p.id
   and not exists(select 1 from public.redemption_evidence later where later.supersedes_evidence_id=e.id)
 ) t on true;
revoke all on public.period_balances from public;
grant select on public.period_balances to perkkeep_app;

create function public.apply_reconciliation(p_request_key uuid,p_trigger text,p_periods jsonb,p_evidence jsonb,p_summary jsonb)
returns public.sync_runs language plpgsql security invoker set search_path='' as $$
declare run public.sync_runs; item jsonb; rec public.redemption_evidence; n integer; candidates integer=0; confirmations integer=0; digest text;
begin
 if app.current_owner() is null then raise exception 'Authentication required'; end if;
 digest=encode(sha256(convert_to(jsonb_build_object('trigger',p_trigger,'periods',p_periods,'evidence',p_evidence,'summary',p_summary)::text,'UTF8')),'hex');
 -- Request key is an immutable run identity. Failures require a NEW key for an explicit retry.
 perform pg_advisory_xact_lock(hashtextextended(app.current_owner()::text||p_request_key::text,0));
 select * into run from public.sync_runs where owner_user_id=app.current_owner() and request_key=p_request_key;
 if found then
 if run.request_digest is distinct from digest then raise exception 'Reconciliation key reused with changed inputs; start a new run'; end if;
 return run; end if;
 insert into public.sync_runs(trigger,status,request_key,coverage_summary_json,request_digest) values(p_trigger,'running',p_request_key,p_summary,digest) returning * into run;
 begin
  for item in select value from jsonb_array_elements(p_evidence) loop
   rec=public.record_evidence(item);
   if rec.recorded_at>=run.started_at then
    if rec.confidence='candidate' then candidates=candidates+1; end if;
    if rec.confidence='confirmed' then confirmations=confirmations+1; end if;
   end if;
  end loop;
  for item in select value from jsonb_array_elements(p_periods) loop
   update public.benefit_periods set coverage_status=item->>'coverage_status',coverage_through=(item->>'coverage_through')::date,last_reconciled_at=now()
   where id=(item->>'id')::uuid and owner_user_id=app.current_owner();
   get diagnostics n=row_count;
   if n<>1 then raise exception 'Period unavailable to this owner'; end if;
  end loop;
  update public.sync_runs set status=case when jsonb_array_length(p_periods)>0 and not exists(select 1 from jsonb_array_elements(p_periods) v where v->>'coverage_status' is distinct from 'complete') then 'success' else 'partial' end,
  finished_at=now(),periods_checked=jsonb_array_length(p_periods),candidates_found=candidates,confirmed_updates=confirmations where id=run.id returning * into run;
 exception when others then
  update public.sync_runs set status='failed',finished_at=now(),error_summary=left(sqlerrm,500) where id=run.id returning * into run;
 end;
 return run;
end $$;

-- A new rule version and closure of the previous rule are committed atomically.
create function public.version_benefit(p_benefit_id uuid,p_changes jsonb,p_effective_from date) returns public.benefits
language plpgsql security invoker set search_path='' as $$
declare previous public.benefits; next_rule public.benefits;
begin
 select * into strict previous from public.benefits where id=p_benefit_id and owner_user_id=app.current_owner() for update;
 if p_effective_from<=previous.effective_from then raise exception 'New version must start after existing rule'; end if;
 update public.benefits set effective_to=p_effective_from where id=previous.id;
 next_rule=jsonb_populate_record(previous,p_changes);
 next_rule.id=gen_random_uuid(); next_rule.owner_user_id=app.current_owner(); next_rule.card_id=previous.card_id; next_rule.rule_key=previous.rule_key;
 next_rule.effective_from=p_effective_from; next_rule.effective_to=null; next_rule.created_at=now(); next_rule.updated_at=now();
 insert into public.benefits select next_rule.*;
 return next_rule;
end $$;

-- Public starter catalog: no personal card digits. Existing rows are preserved.
create function public.initialize_cards() returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.cards(issuer,display_name,product_name,catalog_key)
 select seed.issuer,seed.display_name,seed.product_name,seed.catalog_key
 from (values
 ('American Express','Gold','American Express Gold','amex-gold'),
 ('Chase','Sapphire Reserve','Chase Sapphire Reserve','chase-sapphire-reserve'),
 ('Chase','Freedom Unlimited','Chase Freedom Unlimited','chase-freedom-unlimited'),
 ('Chase','Freedom Flex','Chase Freedom Flex','chase-freedom-flex'),
 ('Chase','Prime Visa','Chase Prime Visa','chase-prime-visa'),
 ('Chase','Identify this card',null,'chase-unidentified'),
 ('Discover','Discover it','Discover it','discover-it'),
 ('Chase','Ink Business Cash','Chase Ink Business Cash','chase-ink-business-cash'),
 ('Chase','Ink Business Preferred','Chase Ink Business Preferred','chase-ink-business-preferred')
 ) as seed(issuer,display_name,product_name,catalog_key)
 where not exists (
 select 1 from public.cards c where c.owner_user_id=app.current_owner() and c.issuer=seed.issuer
 and (c.catalog_key=seed.catalog_key or c.display_name=seed.display_name or lower(c.product_name)=lower(seed.product_name))
 ) on conflict do nothing;
end $$;

-- Only perkkeep_app may call exposed functions; private helpers are not callable at all.
revoke all on all functions in schema private from public;
revoke all on all functions in schema app from public;
revoke all on all functions in schema public from public;
grant execute on function app.current_owner(), app.resolve_owner(text,text,text) to perkkeep_app;
grant execute on function public.anniversary(date,integer), public.period_window(text,date,date,date,date,date),
 public.ensure_period(uuid,date), public.record_evidence(jsonb), public.apply_reconciliation(uuid,text,jsonb,jsonb,jsonb),
 public.version_benefit(uuid,jsonb,date), public.initialize_cards() to perkkeep_app;
