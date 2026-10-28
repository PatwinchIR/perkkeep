-- Public starter catalog: no personal card digits. Existing rows are preserved.
begin;
create or replace function public.initialize_cards() returns void language plpgsql security invoker set search_path='' as $$
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
 ('Discover','Discover it','Discover it','discover-it')
 ) as seed(issuer,display_name,product_name,catalog_key)
 where not exists (
 select 1 from public.cards c where c.owner_user_id=auth.uid() and c.issuer=seed.issuer
 and (c.catalog_key=seed.catalog_key or c.display_name=seed.display_name or c.product_name=seed.product_name)
 ) on conflict do nothing;
 perform public.add_ink_cards();
end $$;
commit;
