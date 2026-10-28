begin;
create function public.initialize_cards() returns void language sql security invoker set search_path='' as $$
 insert into public.cards(issuer,display_name,product_name)
 select seed.issuer,seed.display_name,seed.product_name
 from (values ('American Express','Gold','American Express Gold'),('Chase','Sapphire Reserve','Chase Sapphire Reserve'),
 ('Chase','Freedom Unlimited','Chase Freedom Unlimited'),('Chase','Freedom Flex','Chase Freedom Flex'),
 ('Chase','Prime Visa','Chase Prime Visa'),('Chase','Identify this card',null),('Discover','Discover it','Discover it'))
 as seed(issuer,display_name,product_name)
 where not exists (select 1 from public.cards c where c.owner_user_id=auth.uid() and c.issuer=seed.issuer and c.display_name=seed.display_name);
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
 select * into strict w from public.period_window(b.cadence,d,coalesce(b.reset_anchor,c.cardmember_anchor_date),b.effective_from,b.effective_to,b.custom_end_exclusive);
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
 select * into strict w from public.period_window(b.cadence,new.period_start,coalesce(b.reset_anchor,c.cardmember_anchor_date),b.effective_from,b.effective_to,b.custom_end_exclusive);
 if new.period_start<>w.period_start or new.period_end_exclusive<>w.period_end_exclusive then raise exception 'Period dates must match reset rules'; end if;
 if new.rule_snapshot is distinct from (to_jsonb(b)||jsonb_build_object('issuer_timezone',c.issuer_timezone,'cardmember_anchor_date',c.cardmember_anchor_date,'partial_rule_window',w.partial_rule_window)) then raise exception 'Invalid rule snapshot'; end if;
 if new.allowance_cents is distinct from (case when not w.partial_rule_window then b.nominal_amount_cents end) or new.allowance_units is distinct from (case when not w.partial_rule_window then b.nominal_units end) then raise exception 'Allowance must match verified terms'; end if;
 return new;
end $$;

-- Superseded rules may end inside a previously generated period. The original snapshot and
-- period stay intact; the old rule no longer contributes to current available totals.
create or replace function private.guard_change() returns trigger language plpgsql security invoker set search_path = '' as $$
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

-- A new rule version and closure of the previous rule are committed atomically.
create function public.version_benefit(p_benefit_id uuid,p_changes jsonb,p_effective_from date) returns public.benefits
language plpgsql security invoker set search_path='' as $$
declare previous public.benefits; next_rule public.benefits;
begin
 select * into strict previous from public.benefits where id=p_benefit_id and owner_user_id=auth.uid() for update;
 if p_effective_from<=previous.effective_from then raise exception 'New version must start after existing rule'; end if;
 update public.benefits set effective_to=p_effective_from where id=previous.id;
 next_rule=jsonb_populate_record(previous,p_changes);
 next_rule.id=gen_random_uuid(); next_rule.owner_user_id=auth.uid(); next_rule.card_id=previous.card_id; next_rule.rule_key=previous.rule_key;
 next_rule.effective_from=p_effective_from; next_rule.effective_to=null; next_rule.created_at=now(); next_rule.updated_at=now();
 insert into public.benefits select next_rule.*;
 return next_rule;
end $$;

alter table public.sync_runs add column request_digest text;
-- Validate claimed complete coverage and preserve timestamps for audit.
create function private.guard_coverage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.coverage_status='complete' and (new.coverage_through is null or new.last_reconciled_at is null) then raise exception 'Complete coverage needs an observation date and timestamp'; end if;
 if new.last_reconciled_at>now()+interval '1 minute' then raise exception 'Observation cannot be in the future'; end if;
 return new;
end $$;
create trigger guard_coverage before insert or update on public.benefit_periods for each row execute function private.guard_coverage();
revoke all on function public.initialize_cards(), public.period_window(text,date,date,date,date,date),public.version_benefit(uuid,jsonb,date) from public, anon;
grant execute on function public.initialize_cards(), public.period_window(text,date,date,date,date,date),public.version_benefit(uuid,jsonb,date) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
commit;
