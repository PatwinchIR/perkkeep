-- Memberships (docs/design-benefits-page.md rule 11). A benefit with neither an amount nor units
-- has nothing to spend down: complimentary subscriptions, lounge access and hotel or airline
-- status. It carries an activation date instead of an allowance. The date starts as an
-- assumption (activation_assumed) until the owner sets it, and it never opens a period.
-- kind, activated_on and activation_assumed are classification and owner state, not terms, so
-- they stay editable after periods exist; a membership never turns back into an allowance.

alter table public.benefits
 add column kind text not null default 'allowance' check (kind in ('allowance','membership')),
 add column activated_on date,
 add column activation_assumed boolean not null default true,
 add constraint benefits_membership_without_allowance check (kind<>'membership' or (nominal_amount_cents is null and nominal_units is null));

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
  if new.last_reverified_at is not null and new.last_reverified_at>now()+interval '1 minute' then raise exception 'Re-verification cannot be in the future'; end if;
  if new.activated_on is not null and new.activated_on>(now()+interval '1 day')::date then raise exception 'Activation cannot be in the future'; end if;
  if tg_op='UPDATE' and old.kind='membership' and new.kind<>'membership' then raise exception 'A membership cannot become an allowance; create a new benefit version'; end if;
  if tg_op='UPDATE' and exists(select 1 from public.benefit_periods where benefit_id=old.id) and
    (to_jsonb(new)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to','last_reverified_at','kind','activated_on','activation_assumed']) is distinct from
    (to_jsonb(old)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to','last_reverified_at','kind','activated_on','activation_assumed']) then
    raise exception 'Create a new benefit version to change historical terms';
  end if;
 end if;
 return new;
end $$;
