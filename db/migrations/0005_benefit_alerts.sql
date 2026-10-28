-- Phase 2 alerts and progress. Alerts are derived from the ledger on every load and never stored;
-- this migration adds the owner state around them: append-only acknowledgements keyed by a
-- deterministic alert key, owner settings for alert timing, a "terms re-checked, unchanged"
-- timestamp on benefits, and a one-time allowance confirmation for partial rule windows.
-- Same ownership model as 0001: app.current_owner() and forced row-level security.

-- last_reverified_at records that the owner re-read the issuer's terms and found them unchanged.
-- It is owner state, not a term, so it stays editable after periods exist.
alter table public.benefits
 add column last_reverified_at timestamptz,
 add constraint benefits_reverified_after_verified check (last_reverified_at is null or verified_at is null or last_reverified_at >= verified_at);

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
  if tg_op='UPDATE' and exists(select 1 from public.benefit_periods where benefit_id=old.id) and
    (to_jsonb(new)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to','last_reverified_at']) is distinct from
    (to_jsonb(old)-array['updated_at','enabled','eligibility_status','enrollment_status','effective_to','last_reverified_at']) then
    raise exception 'Create a new benefit version to change historical terms';
  end if;
 end if;
 return new;
end $$;

-- A new version starts with fresh terms, so it carries no re-verification from the old one.
create or replace function public.version_benefit(p_benefit_id uuid,p_changes jsonb,p_effective_from date) returns public.benefits
language plpgsql security invoker set search_path='' as $$
declare previous public.benefits; next_rule public.benefits;
begin
 select * into strict previous from public.benefits where id=p_benefit_id and owner_user_id=app.current_owner() for update;
 if p_effective_from<=previous.effective_from then raise exception 'New version must start after existing rule'; end if;
 update public.benefits set effective_to=p_effective_from where id=previous.id;
 next_rule=jsonb_populate_record(previous,p_changes);
 next_rule.id=gen_random_uuid(); next_rule.owner_user_id=app.current_owner(); next_rule.card_id=previous.card_id; next_rule.rule_key=previous.rule_key;
 next_rule.effective_from=p_effective_from; next_rule.effective_to=null; next_rule.created_at=now(); next_rule.updated_at=now();
 next_rule.last_reverified_at=null;
 insert into public.benefits select next_rule.*;
 return next_rule;
end $$;

-- Acknowledgements hide one dismissible alert by key until the key changes. Append-only.
create table public.alert_acknowledgements (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null default app.current_owner() references public.owners(id) on delete restrict,
 alert_key text not null check (length(alert_key) between 1 and 200),
 acknowledged_at timestamptz not null default now(),
 context jsonb not null default '{}' check (jsonb_typeof(context)='object'),
 unique(owner_user_id,alert_key)
);
create index acknowledgements_owner on public.alert_acknowledgements(owner_user_id,acknowledged_at desc);
alter table public.alert_acknowledgements enable row level security;
alter table public.alert_acknowledgements force row level security;
revoke all on public.alert_acknowledgements from public;
grant select, insert on public.alert_acknowledgements to perkkeep_app;
create policy owner_select on public.alert_acknowledgements for select to perkkeep_app using ((select app.current_owner()) = owner_user_id);
create policy owner_insert on public.alert_acknowledgements for insert to perkkeep_app with check ((select app.current_owner()) = owner_user_id);
create trigger audit_change after insert on public.alert_acknowledgements for each row execute function private.audit_change();

-- Owner preferences for alert timing. One row per owner, created on first save.
create table public.user_settings (
 owner_user_id uuid primary key default app.current_owner() references public.owners(id) on delete restrict,
 alert_lead_days integer not null default 7 check (alert_lead_days between 1 and 90),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;
revoke all on public.user_settings from public;
grant select, insert on public.user_settings to perkkeep_app;
grant update(alert_lead_days) on public.user_settings to perkkeep_app;
create policy owner_select on public.user_settings for select to perkkeep_app using ((select app.current_owner()) = owner_user_id);
create policy owner_insert on public.user_settings for insert to perkkeep_app with check ((select app.current_owner()) = owner_user_id);
create policy owner_update on public.user_settings for update to perkkeep_app using ((select app.current_owner()) = owner_user_id) with check ((select app.current_owner()) = owner_user_id);
create trigger touch before update on public.user_settings for each row execute function private.touch();

-- A period created inside a partial rule window has an unknown allowance (never prorated). The
-- owner may confirm it once, with a note, up to the full nominal allowance. Full-window periods
-- stay locked to the verified terms, as guard_period already enforces on insert.
grant update(allowance_cents,allowance_units) on public.benefit_periods to perkkeep_app;
create function private.guard_allowance() returns trigger language plpgsql security invoker set search_path='' as $$
declare nominal_cents integer; nominal_units integer;
begin
 if new.allowance_cents is not distinct from old.allowance_cents and new.allowance_units is not distinct from old.allowance_units then return new; end if;
 if old.allowance_cents is not null or old.allowance_units is not null then raise exception 'Allowance is already established for this period'; end if;
 if coalesce((old.rule_snapshot->>'partial_rule_window')::boolean,false) is not true then raise exception 'Allowance must match verified terms'; end if;
 if (new.allowance_cents is null) = (new.allowance_units is null) then raise exception 'Confirm either an amount or a unit count'; end if;
 nominal_cents=(old.rule_snapshot->>'nominal_amount_cents')::integer; nominal_units=(old.rule_snapshot->>'nominal_units')::integer;
 if new.allowance_cents is not null and nominal_cents is null then raise exception 'Use units for this benefit'; end if;
 if new.allowance_units is not null and nominal_units is null then raise exception 'Use cents for this benefit'; end if;
 if new.allowance_cents>nominal_cents or new.allowance_units>nominal_units then raise exception 'A partial-window allowance cannot exceed the full allowance'; end if;
 if length(trim(new.notes))=0 or new.notes is not distinct from old.notes then raise exception 'Explain how the partial-window allowance was confirmed'; end if;
 return new;
end $$;
create trigger guard_allowance before update of allowance_cents,allowance_units on public.benefit_periods for each row execute function private.guard_allowance();

create function public.confirm_period_allowance(p_period_id uuid,p_amount_cents integer,p_units integer,p_note text) returns public.benefit_periods
language plpgsql security invoker set search_path='' as $$
declare p public.benefit_periods; line text;
begin
 if length(trim(coalesce(p_note,'')))=0 then raise exception 'Explain how the partial-window allowance was confirmed'; end if;
 if (p_amount_cents is null) = (p_units is null) then raise exception 'Confirm either an amount or a unit count'; end if;
 select * into strict p from public.benefit_periods where id=p_period_id and owner_user_id=app.current_owner() for update;
 line='Allowance confirmed by owner: '||trim(p_note);
 update public.benefit_periods set allowance_cents=p_amount_cents,allowance_units=p_units,
  notes=case when length(trim(p.notes))=0 then line else p.notes||E'\n'||line end
 where id=p.id returning * into p;
 return p;
end $$;

revoke all on function private.guard_allowance(), public.confirm_period_allowance(uuid,integer,integer,text) from public;
grant execute on function public.confirm_period_allowance(uuid,integer,integer,text) to perkkeep_app;
