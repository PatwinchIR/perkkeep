-- Removing a card archives it: it leaves current views and totals and generates no
-- new periods, while its periods, evidence and audit history remain readable.
-- art_design records which official issuer design the owner chose to display.
begin;
alter table public.cards add column archived_at timestamptz;
alter table public.cards add column art_design text check (art_design ~ '^[a-z0-9-]{1,40}$');

create or replace function public.ensure_period(p_benefit_id uuid,p_on date default null) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; p public.benefit_periods; w record; d date;
begin
 select * into strict b from public.benefits where id=p_benefit_id and owner_user_id=auth.uid();
 select * into strict c from public.cards where id=b.card_id;
 d=coalesce(p_on,(now() at time zone c.issuer_timezone)::date);
 if c.archived_at is not null then raise exception 'This card was removed. Restore it to track new periods'; end if;
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

create or replace view public.period_balances with(security_invoker=true) as
 select p.*, b.name as benefit_name,b.cadence,b.enrollment_required,b.enrollment_status,b.eligibility_status,b.enabled,
 c.display_name as card_name,c.last4,c.issuer,c.issuer_timezone,c.status as card_status,
 c.identity_verified_at,
 coalesce(t.confirmed_cents,0)::bigint as confirmed_cents,coalesce(t.candidate_cents,0)::bigint as candidate_cents,
 coalesce(t.confirmed_units,0)::bigint as confirmed_units,coalesce(t.candidate_units,0)::bigint as candidate_units,
 case when p.allowance_cents is not null then greatest(p.allowance_cents-coalesce(t.confirmed_cents,0),0) end as remaining_cents,
 case when p.allowance_units is not null then greatest(p.allowance_units-coalesce(t.confirmed_units,0),0) end as remaining_units,
 coalesce(t.unresolved_count,0)::integer as unresolved_count,
 coalesce(t.negative_balance,false) as negative_balance,
 c.archived_at as card_archived_at
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
commit;
