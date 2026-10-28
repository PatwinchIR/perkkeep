begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists btree_gist with schema extensions;

create table public.cards (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
 issuer text not null check (length(issuer) between 1 and 100),
 display_name text not null check (length(display_name) between 1 and 100),
 product_name text, last4 text check (last4 ~ '^[0-9]{4}$'),
 status text not null default 'unknown' check (status in ('active','closed','unknown')),
 identity_verified_at timestamptz, cardmember_anchor_date date,
 issuer_timezone text not null default 'America/New_York',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_user_id,issuer,last4), unique(owner_user_id,id)
);
create table public.benefits (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default auth.uid(),
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
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default auth.uid(),
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
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default auth.uid(),
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
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null default auth.uid(),
 request_key uuid not null default gen_random_uuid(),
 trigger text not null check(trigger in ('manual','scheduled','user_edit')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null check(status in ('running','success','partial','failed')),
 coverage_summary_json jsonb not null default '{}',
 periods_checked integer not null default 0 check(periods_checked>=0),
 candidates_found integer not null default 0 check(candidates_found>=0),
 confirmed_updates integer not null default 0 check(confirmed_updates>=0),
 error_summary text, unique(owner_user_id,request_key),
 foreign key(owner_user_id) references auth.users(id) on delete restrict
);
create index sync_owner_date on public.sync_runs(owner_user_id,started_at desc);
create table public.audit_events (
 id bigint generated always as identity primary key,
 owner_user_id uuid not null references auth.users(id) on delete restrict,
 entity_table text not null, entity_id uuid not null, action text not null,
 old_record jsonb, new_record jsonb, occurred_at timestamptz not null default now()
);
create index audit_owner_date on public.audit_events(owner_user_id,occurred_at desc);

-- Explicit table privileges, RLS and composite foreign keys enforce isolation independently of the UI.
do $$ declare t text; begin
 foreach t in array array['cards','benefits','benefit_periods','redemption_evidence','sync_runs','audit_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = owner_user_id)',t);
 if t <> 'audit_events' then
 execute format('grant insert on public.%I to authenticated',t);
 execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = owner_user_id)',t);
 end if;
 end loop;
end $$;
grant update on public.cards, public.benefits to authenticated;
grant update(coverage_status,coverage_through,last_reconciled_at,notes) on public.benefit_periods to authenticated;
grant update(finished_at,status,coverage_summary_json,periods_checked,candidates_found,confirmed_updates,error_summary) on public.sync_runs to authenticated;
do $$ declare t text; begin
 foreach t in array array['cards','benefits','benefit_periods','sync_runs'] loop
 execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = owner_user_id) with check ((select auth.uid()) = owner_user_id)',t);
 end loop;
end $$;

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or new.owner_user_id <> auth.uid() then raise exception 'Authenticated owner required'; end if;
 insert into public.audit_events(owner_user_id,entity_table,entity_id,action,old_record,new_record)
 values(new.owner_user_id,tg_table_name,new.id,tg_op,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
create function private.guard_change() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if tg_op='UPDATE' then
  if new.id <> old.id or new.owner_user_id <> old.owner_user_id or new.created_at <> old.created_at then raise exception 'Identity and creation time are immutable'; end if;
 end if;
 new.updated_at = now();
 if tg_table_name='cards' then
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.issuer_timezone) then raise exception 'Unknown issuer timezone'; end if;
 elsif tg_table_name='benefits' then
  if new.enabled and not exists(select 1 from public.cards where id=new.card_id and identity_verified_at is not null and status='active') then raise exception 'Confirm the card identity before enabling benefits'; end if;
  if tg_op='UPDATE' and exists(select 1 from public.benefit_periods where benefit_id=old.id) and
    (to_jsonb(new)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to']) is distinct from
    (to_jsonb(old)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to']) then
    raise exception 'Create a new benefit version to change historical terms';
  end if;
  if tg_op='UPDATE' and new.effective_to is distinct from old.effective_to and exists(select 1 from public.benefit_periods where benefit_id=old.id and period_end_exclusive>new.effective_to) then
    raise exception 'Cannot end a rule inside a preserved period';
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
create function public.ensure_period(p_benefit_id uuid,p_on date default null) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; p public.benefit_periods; d date; s date; e date; raw_s date; raw_e date; a date;
begin
 select * into strict b from public.benefits where id=p_benefit_id and owner_user_id=auth.uid();
 select * into strict c from public.cards where id=b.card_id;
 d=coalesce(p_on,(now() at time zone c.issuer_timezone)::date);
 if not b.enabled or c.status<>'active' then raise exception 'Benefit is disabled or card is not active'; end if;
 if d<b.effective_from or (b.effective_to is not null and d>=b.effective_to) then raise exception 'Date outside rule effective window'; end if;
 case b.cadence
 when 'monthly' then s=date_trunc('month',d)::date; e=(s+interval '1 month')::date;
 when 'quarterly' then s=date_trunc('quarter',d)::date; e=(s+interval '3 months')::date;
 when 'semiannual' then s=make_date(extract(year from d)::int,case when extract(month from d)<=6 then 1 else 7 end,1); e=(s+interval '6 months')::date;
 when 'calendar_year' then s=date_trunc('year',d)::date; e=(s+interval '1 year')::date;
 when 'cardmember_year' then
  a=coalesce(b.reset_anchor,c.cardmember_anchor_date);
  if a is null then raise exception 'Cardmember anniversary needs confirmation'; end if;
  s=public.anniversary(a,extract(year from d)::int);
  if d<s then s=public.anniversary(a,extract(year from d)::int-1); end if;
  e=public.anniversary(a,extract(year from s)::int+1);
 else
  s=coalesce(b.reset_anchor,b.effective_from); e=b.custom_end_exclusive;
  if e is null or d<s or d>=e then raise exception 'Confirm custom start and end dates'; end if;
 end case;
 raw_s=s; raw_e=e; s=greatest(s,b.effective_from); e=least(e,coalesce(b.effective_to,e));
 insert into public.benefit_periods(owner_user_id,card_id,benefit_id,period_start,period_end_exclusive,allowance_cents,allowance_units,rule_snapshot)
 values(auth.uid(),b.card_id,b.id,s,e,case when s=raw_s and e=raw_e then b.nominal_amount_cents end,case when s=raw_s and e=raw_e then b.nominal_units end,
 to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',s<>raw_s or e<>raw_e))
 on conflict(benefit_id,period_start,period_end_exclusive) do nothing;
 select * into strict p from public.benefit_periods where benefit_id=b.id and period_start=s and period_end_exclusive=e;
 return p;
end $$;

-- Reject forged snapshots/allowances even on direct Data API inserts.
create function private.guard_period() returns trigger language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards;
begin
 select * into strict b from public.benefits where id=new.benefit_id;
 select * into strict c from public.cards where id=b.card_id;
 if new.rule_snapshot is distinct from (to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',coalesce((new.rule_snapshot->>'partial_rule_window')::boolean,false))) then raise exception 'Invalid rule snapshot'; end if;
 if new.allowance_cents is not null and new.allowance_cents is distinct from b.nominal_amount_cents then raise exception 'Allowance must match verified terms'; end if;
 if new.allowance_units is not null and new.allowance_units is distinct from b.nominal_units then raise exception 'Allowance must match verified terms'; end if;
 return new;
end $$;
create trigger guard_period before insert on public.benefit_periods for each row execute function private.guard_period();

create function public.record_evidence(p_record jsonb) returns public.redemption_evidence language plpgsql security invoker set search_path='' as $$
declare n public.redemption_evidence; existing public.redemption_evidence; p public.benefit_periods;
begin
 select * into strict p from public.benefit_periods where id=(p_record->>'benefit_period_id')::uuid and owner_user_id=auth.uid();
 n.id=coalesce((p_record->>'id')::uuid,gen_random_uuid()); n.owner_user_id=auth.uid(); n.card_id=p.card_id; n.benefit_period_id=p.id;
 n.source_type=p_record->>'source_type'; n.source_reference_hash=p_record->>'source_reference_hash';
 n.transaction_date=(p_record->>'transaction_date')::date; n.recorded_at=now(); n.merchant=p_record->>'merchant';
 n.amount_cents=(p_record->>'amount_cents')::integer; n.units=(p_record->>'units')::integer;
 n.eligibility_result=coalesce(p_record->>'eligibility_result','unknown'); n.confirmation_result=coalesce(p_record->>'confirmation_result','unverified');
 n.confidence=p_record->>'confidence'; n.recorded_by=coalesce(p_record->>'recorded_by','user'); n.notes=coalesce(p_record->>'notes','');
 n.supersedes_evidence_id=(p_record->>'supersedes_evidence_id')::uuid;
 -- Serialize imports per period so duplicate detection and correction are one transaction.
 perform 1 from public.benefit_periods where id=p.id for update;
 select * into existing from public.redemption_evidence where owner_user_id=auth.uid() and
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
revoke all on public.period_balances from public, anon;
grant select on public.period_balances to authenticated;

create function public.apply_reconciliation(p_request_key uuid,p_trigger text,p_periods jsonb,p_evidence jsonb,p_summary jsonb)
returns public.sync_runs language plpgsql security invoker set search_path='' as $$
declare run public.sync_runs; item jsonb; rec public.redemption_evidence; n integer; candidates integer=0; confirmations integer=0;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 -- Request key is an immutable run identity. Failures require a NEW key for an explicit retry.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_key::text,0));
 select * into run from public.sync_runs where owner_user_id=auth.uid() and request_key=p_request_key;
 if found then return run; end if;
 insert into public.sync_runs(trigger,status,request_key,coverage_summary_json) values(p_trigger,'running',p_request_key,p_summary) returning * into run;
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
   where id=(item->>'id')::uuid and owner_user_id=auth.uid();
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

-- No PUBLIC/anon RPC permissions. All exposed operations run under the authenticated user's RLS.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.anniversary(date,integer), public.ensure_period(uuid,date),public.record_evidence(jsonb),public.apply_reconciliation(uuid,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.anniversary(date,integer), public.ensure_period(uuid,date),public.record_evidence(jsonb),public.apply_reconciliation(uuid,text,jsonb,jsonb,jsonb) to authenticated;
commit;
