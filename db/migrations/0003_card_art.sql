-- Private card art (brief section 8a). Images stay in the owner's database under the same
-- row-level security as the ledger and are served only through an authenticated, no-store route.
create table public.card_art (
 card_id uuid primary key,
 owner_user_id uuid not null default app.current_owner(),
 image bytea not null check (octet_length(image) between 1 and 1500000),
 content_type text not null check (content_type in ('image/webp')),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 origin text not null check (origin in ('issuer','upload')),
 source_url text check (source_url ~ '^https://'),
 -- Cover bands (percent of the face) hide sample names baked into issuer images.
 bands jsonb not null default '[]' check (jsonb_typeof(bands)='array'),
 -- Whether the owner's name and last four are drawn over the image.
 overlay boolean not null default true,
 updated_at timestamptz not null default now(),
 foreign key(owner_user_id,card_id) references public.cards(owner_user_id,id)
);
alter table public.card_art enable row level security;
alter table public.card_art force row level security;
revoke all on public.card_art from public;
grant select, insert, update, delete on public.card_art to perkkeep_app;
create policy owner_all on public.card_art for all to perkkeep_app
 using ((select app.current_owner()) = owner_user_id) with check ((select app.current_owner()) = owner_user_id);
create trigger touch before update on public.card_art for each row execute function private.touch();
