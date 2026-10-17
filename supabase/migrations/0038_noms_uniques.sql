-- =============================================================================
-- Migration 0038 — un nom affiché ne peut être porté que par UN membre
-- =============================================================================
--
-- DEMANDE DE MATTHIEU (17/10/2026) : si un nom est déjà utilisé, une autre
-- personne ne peut pas le prendre — à l'inscription comme dans « Mon profil ».
--
-- LA COMPARAISON IGNORE la casse, les accents, la ponctuation et les espaces
-- en trop : « Benoît », « benoit » et « BENOIT » sont le même nom, comme
-- « Jean-Pierre » et « Jean Pierre ». Sans cela, la règle se contournerait
-- d'une majuscule.
--
-- LES DOUBLONS DÉJÀ PRÉSENTS RESTENT : on ne renomme personne d'autorité. Ils
-- ne bloquent rien — chacun peut garder son nom ou le corriger — mais aucun
-- NOUVEAU doublon ne peut se créer. La dernière ligne les liste.
--
-- ⚠ L'INSCRIPTION NE DOIT JAMAIS ÉCHOUER À CAUSE DU NOM : le compte est créé
-- par Supabase avant le profil, et une erreur ici donnerait un « Database
-- error » incompréhensible. L'écran vérifie donc le nom AVANT d'envoyer ; si
-- deux personnes s'inscrivent au même instant sous le même nom, la base
-- ajoute un numéro (« Marie 2 ») plutôt que de refuser.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La forme comparable d'un nom
-- -----------------------------------------------------------------------------
-- `translate` plutôt que l'extension unaccent : immuable (donc indexable), et
-- sans dépendance. Les lettres hors de cette table (écritures non latines)
-- sont simplement retirées ; un nom qui n'en garde aucune n'est pas comparé.
create or replace function public.nom_cle(p text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(
           translate(lower(coalesce(p, '')),
                     'àáâãäåāçćčèéêëēėęìíîïīįłñńòóôõöøōœùúûüūýÿžźżæ',
                     'aaaaaaaccceeeeeeeiiiiiilnnoooooooouuuuuyyzzza'),
           '[^a-z0-9]+', ' ', 'g')), '');
$$;

grant execute on function public.nom_cle(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. Le garde-fou
-- -----------------------------------------------------------------------------
create or replace function public.profiles_nom_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cle text := public.nom_cle(new.display_name);
begin
  -- Le même nom, retouché (une majuscule, un accent) : toujours permis, même
  -- s'il fait partie d'un doublon ancien.
  if tg_op = 'UPDATE' and cle is not distinct from public.nom_cle(old.display_name) then
    return new;
  end if;
  if cle is not null and exists (
       select 1 from public.profiles p
        where p.id <> new.id and public.nom_cle(p.display_name) = cle
     ) then
    raise exception 'Ce nom est déjà utilisé par un autre membre. Choisissez-en un autre.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_nom_unique() from public, anon, authenticated;

drop trigger if exists profiles_nom_unique_trg on public.profiles;
create trigger profiles_nom_unique_trg
  before insert or update of display_name on public.profiles
  for each row execute function public.profiles_nom_unique();

-- Un index sur la forme comparable : UNIQUE s'il n'existe aucun doublon
-- ancien (la base garantit alors la règle à elle seule), simple sinon (le
-- garde-fou ci-dessus suffit, l'index ne sert qu'à aller vite).
do $$
begin
  if not exists (
       select 1 from public.profiles
        where public.nom_cle(display_name) is not null
        group by public.nom_cle(display_name)
       having count(*) > 1
     ) then
    create unique index if not exists profiles_nom_cle_unique
      on public.profiles (public.nom_cle(display_name));
  else
    create index if not exists profiles_nom_cle_idx
      on public.profiles (public.nom_cle(display_name));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- C. L'inscription : jamais d'échec, un numéro en dernier recours
-- -----------------------------------------------------------------------------
-- Corps de la 0001, plus la recherche d'un nom libre.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := left(
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
             split_part(new.email, '@', 1)),
    56);
  nom text := base;
  n   int  := 2;
begin
  while n < 100
        and public.nom_cle(nom) is not null
        and exists (select 1 from public.profiles p
                     where public.nom_cle(p.display_name) = public.nom_cle(nom)) loop
    nom := base || ' ' || n;
    n := n + 1;
  end loop;
  insert into public.profiles (id, display_name) values (new.id, nom);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- D. « Ce nom est-il libre ? » — avant l'inscription, et dans « Mon profil »
-- -----------------------------------------------------------------------------
-- Les noms affichés sont déjà publics (« Publié par … ») : la réponse ne
-- révèle rien de plus. Son propre nom est toujours libre pour soi.
create or replace function public.nom_disponible(p_nom text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.nom_cle(p_nom) is null
      or not exists (
           select 1 from public.profiles p
            where public.nom_cle(p.display_name) = public.nom_cle(p_nom)
              and p.id is distinct from auth.uid()
         );
$$;

grant execute on function public.nom_disponible(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. Vérification
-- -----------------------------------------------------------------------------
-- Les quatre premières doivent être vraies. La dernière liste les doublons
-- ANCIENS (vide = aucun) : à régler à la main si tu le souhaites, depuis la
-- fiche des membres concernés.
select
  (select public.nom_cle('  Benoît  JEAN-Pierre ') = 'benoit jean pierre')  as comparaison_large,
  (select count(*) = 1 from pg_trigger where tgname = 'profiles_nom_unique_trg') as garde_fou,
  (select pg_get_functiondef('public.handle_new_user'::regproc) like '%nom_cle%') as inscription_sans_echec,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nom_disponible')              as verification_avant_envoi,
  (select coalesce(string_agg(noms, ' | '), 'aucun')
     from (select string_agg(display_name, ' = ') as noms
             from public.profiles
            where public.nom_cle(display_name) is not null
            group by public.nom_cle(display_name)
           having count(*) > 1) d)                                          as doublons_existants;

-- =============================================================================
-- Fin de migration 0038
-- =============================================================================
