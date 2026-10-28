begin;
create or replace function public.ensure_period(p_benefit_id uuid,p_on date default null) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; p public.benefit_periods; w record; d date;
begin
 select * into strict b from public.benefits where id=p_benefit_id and owner_user_id=auth.uid();
 select * into strict c from public.cards where id=b.card_id;
 d=coalesce(p_on,(now() at time zone c.issuer_timezone)::date);
 if not b.enabled or c.status<>'active' or c.identity_verified_at is null then raise exception 'Confirm the active card and benefit first'; end if;
 -- A saved period is returned as-is, even if mutable enrollment details have since changed.
 select * into p from public.benefit_periods where benefit_id=b.id and period_start<=d and period_end_exclusive>d;
 if found then return p; end if;
 select * into strict w from public.period_window(b.cadence,d,case when b.cadence='cardmember_year' then coalesce(b.reset_anchor,c.cardmember_anchor_date) else b.reset_anchor end,b.effective_from,b.effective_to,b.custom_end_exclusive);
 insert into public.benefit_periods(owner_user_id,card_id,benefit_id,period_start,period_end_exclusive,allowance_cents,allowance_units,rule_snapshot)
 values(auth.uid(),b.card_id,b.id,w.period_start,w.period_end_exclusive,case when not w.partial_rule_window then b.nominal_amount_cents end,case when not w.partial_rule_window then b.nominal_units end,
 to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',w.partial_rule_window))
 on conflict(benefit_id,period_start,period_end_exclusive) do nothing;
 select * into strict p from public.benefit_periods where benefit_id=b.id and period_start=w.period_start and period_end_exclusive=w.period_end_exclusive;
 return p;
end $$;
create or replace function private.guard_period() returns trigger language plpgsql security invoker set search_path='' as $$
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

create or replace function public.apply_reconciliation(p_request_key uuid,p_trigger text,p_periods jsonb,p_evidence jsonb,p_summary jsonb)
returns public.sync_runs language plpgsql security invoker set search_path='' as $$
declare run public.sync_runs; item jsonb; rec public.redemption_evidence; n integer; candidates integer=0; confirmations integer=0; digest text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 digest=encode(sha256(convert_to(jsonb_build_object('trigger',p_trigger,'periods',p_periods,'evidence',p_evidence,'summary',p_summary)::text,'UTF8')),'hex');
 -- Request key is an immutable run identity. Failures require a NEW key for an explicit retry.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_key::text,0));
 select * into run from public.sync_runs where owner_user_id=auth.uid() and request_key=p_request_key;
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


create or replace function private.guard_coverage() returns trigger language plpgsql security invoker set search_path='' as $$
declare tz text;
begin
 select issuer_timezone into strict tz from public.cards where id=new.card_id;
 if new.coverage_status='complete' and (new.coverage_through is null or new.last_reconciled_at is null) then raise exception 'Complete coverage needs an observation date and timestamp'; end if;
 if new.last_reconciled_at>now()+interval '1 minute' or new.coverage_through>(now() at time zone tz)::date then raise exception 'Observation cannot be in the future'; end if;
 return new;
end $$;
commit;
