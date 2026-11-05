-- Open the music studio from Dash with nothing typed (knightx4/music-pipeline studio-app).
--
-- The studio's functions check a token against public.studio_keys, which holds only each token's
-- sha-256. studio_mint_key makes a fresh token for the computer that asked, stores its hash with a
-- label, and returns the token once. Only the app's owner may call it, signed in: Dash's
-- /dev/studio route calls it on your session and opens the studio with the token in the address's
-- fragment, which the studio keeps on that computer.
--
-- studio_keys was made outside these migrations (music-pipeline records it), so the column is added
-- only where the table exists: the test database has none.

do $mig$
begin
  if to_regclass('public.studio_keys') is not null then
    alter table public.studio_keys add column if not exists label text;
  end if;
end
$mig$;

create or replace function public.studio_mint_key(device text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tok text;
begin
  if auth.uid() is null or auth.uid() is distinct from core.dev_owner_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.studio_keys (key_hash, label)
  values (encode(sha256(convert_to(tok, 'UTF8')), 'hex'),
          left(coalesce(nullif(trim(device), ''), 'Dash'), 120) || ' ' || to_char(now(), 'YYYY-MM-DD'));
  return tok;
end
$$;

revoke all on function public.studio_mint_key(text) from public, anon;
grant execute on function public.studio_mint_key(text) to authenticated;
