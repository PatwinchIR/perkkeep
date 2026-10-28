-- Owner-managed cards. Cards added by hand have no catalog key. Removing a card archives it:
-- the card leaves current views and totals and opens no new periods, while its periods,
-- evidence, links and audit history stay readable and it can be restored.
alter table public.cards add column archived_at timestamptz;

create or replace function public.ensure_period(p_benefit_id uuid,p_on date default null) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare b public.benefits; c public.cards; p public.benefit_periods; w record; d date;
begin
 select * into strict b from public.benefits where id=p_benefit_id and owner_user_id=app.current_owner();
 select * into strict c from public.cards where id=b.card_id;
 d=coalesce(p_on,(now() at time zone c.issuer_timezone)::date);
 if c.archived_at is not null then raise exception 'This card was removed. Restore it to track new periods'; end if;
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
