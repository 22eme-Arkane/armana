-- =============================================================================
-- Migration 0033 — types de compte, et fiches des lieux et des food trucks
-- =============================================================================
--
-- DEMANDE DE MATTHIEU (15/10/2026) : à l'inscription comme dans le Profil, on
-- se déclare PARTICULIER, LIEU CULTUREL ou FOOD TRUCK. Les lieux et les food
-- trucks ont une FICHE publique : photo, site, description, horaires — et,
-- pour les trucks, cuisine, menu en texte et une photo de produit. Chaque
-- fiche est validée par un modérateur avant d'être visible.
--
-- ⚠ LE TYPE DE COMPTE NE DONNE AUCUN DROIT. Il est rangé dans une colonne à
-- part, `account_type`, que chacun modifie librement — et SURTOUT PAS dans
-- `role`, protégé par le garde-fou et réservé aux modérateurs. Se déclarer
-- food truck n'ouvre rien : seule la fiche, une fois validée, se montre.
--
-- ⚠ AUCUN RISQUE POUR L'EXISTANT : une colonne avec valeur par défaut, une
-- table neuve. Aucune fonction ni vue existante n'est modifiée.
--
-- Photos des fiches : même bucket que les événements (`event-photos`), dans le
-- dossier de l'auteur — `{uid}/fiche/photo.webp` et `{uid}/fiche/produit.webp`.
-- Les politiques Storage existantes couvrent déjà ce chemin (écriture limitée
-- au dossier `{uid}/`), et un chemin FIXE fait qu'une nouvelle photo écrase
-- l'ancienne : rien ne s'accumule. La purge mensuelle, qui ne vise que les
-- dossiers d'événements, n'y touche pas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Le type de compte
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists account_type text not null default 'particulier';

alter table public.profiles drop constraint if exists profiles_account_type_valide;
alter table public.profiles
  add constraint profiles_account_type_valide
  check (account_type in ('particulier', 'lieu', 'food_truck'));

comment on column public.profiles.account_type is
  'Particulier, lieu culturel ou food truck. Choisi et modifié par l''utilisateur '
  'lui-même ; ne donne AUCUN droit (les droits sont dans role).';

-- Lisible par tous, comme le nom : c'est ce qui permet d'afficher qu'un
-- auteur est un lieu ou un food truck.
grant select (account_type) on public.profiles to anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. Les fiches
-- -----------------------------------------------------------------------------
create table if not exists public.fiches (
  id                 uuid primary key default gen_random_uuid(),
  -- UNE fiche par compte : un lieu ou un truck n'a qu'une vitrine.
  owner_id           uuid not null unique references public.profiles(id) on delete cascade,
  kind               text not null check (kind in ('lieu', 'food_truck')),
  name               text not null check (char_length(name) between 2 and 80),
  description        text check (char_length(description) <= 2000),
  website            text check (char_length(website) <= 300),
  contact            text check (char_length(contact) <= 300),
  -- Horaires en texte libre (« Du mardi au samedi, 14 h – 19 h ») : les lieux
  -- ont des horaires trop variés pour une grille. Les food trucks auront en
  -- plus leur planning précis (migration suivante).
  opening_hours      text check (char_length(opening_hours) <= 600),
  address            text check (char_length(address) <= 300),
  location           geography(Point, 4326),
  -- Food trucks seulement.
  cuisine            text check (char_length(cuisine) <= 80),
  menu               text check (char_length(menu) <= 2000),
  photo_path         text,
  product_photo_path text,
  -- Calculé par le trigger depuis location : il borne la zone du modérateur.
  dept               text,
  status             text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected')),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists fiches_status_idx on public.fiches (status);
create index if not exists fiches_location_idx on public.fiches using gist (location);

comment on table public.fiches is
  'Fiche publique d''un lieu culturel ou d''un food truck. Visible du public '
  'seulement une fois validée par un modérateur.';

-- -----------------------------------------------------------------------------
-- C. Le garde-fou, en UN SEUL trigger
-- -----------------------------------------------------------------------------
-- ⚠ UN SEUL trigger BEFORE, et pas trois : les triggers BEFORE s'exécutent par
-- ordre alphabétique de nom, et le contrôle des droits a besoin du département
-- DÉJÀ calculé (piège rencontré en 0031). Ici l'ordre est écrit en clair.
create or replace function public.fiches_avant_ecriture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  moderateur boolean;
begin
  -- 1. Le département, toujours recalculé : une valeur écrite à la main serait
  --    un moyen de choisir son modérateur (même raison qu'en 0019).
  new.dept := public.dept_of_point(new.location);
  new.updated_at := now();

  -- Contexte serveur (tâches, service_role) : aucun contrôle.
  if auth.uid() is null then
    return new;
  end if;

  moderateur := public.can_moderate(new.dept);

  if tg_op = 'INSERT' then
    -- Une fiche naît en attente, quoi qu'envoie le client.
    if not moderateur then
      new.status := 'pending';
      new.reviewed_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Une fiche ne change pas de propriétaire.';
  end if;

  if new.status is distinct from old.status then
    if not moderateur then
      raise exception 'Seul un modérateur valide ou refuse une fiche.';
    end if;
    new.reviewed_at := now();
  end if;

  -- 2. Le propriétaire retouche son contenu : la fiche repasse en relecture,
  --    comme un événement modifié. Un modérateur, lui, garde la main.
  if not moderateur
     and (new.kind, new.name, new.description, new.website, new.contact,
          new.opening_hours, new.address, new.location::text, new.cuisine,
          new.menu, new.photo_path, new.product_photo_path)
         is distinct from
         (old.kind, old.name, old.description, old.website, old.contact,
          old.opening_hours, old.address, old.location::text, old.cuisine,
          old.menu, old.photo_path, old.product_photo_path)
  then
    new.status := 'pending';
    new.reviewed_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.fiches_avant_ecriture() from public, anon, authenticated;

drop trigger if exists fiches_avant_ecriture_trg on public.fiches;
create trigger fiches_avant_ecriture_trg
  before insert or update on public.fiches
  for each row execute function public.fiches_avant_ecriture();

-- -----------------------------------------------------------------------------
-- D. Prévenir les modérateurs — à la CRÉATION seulement, comme les événements
--    depuis la 0031 (une retouche repasse en relecture sans notification).
-- -----------------------------------------------------------------------------
create or replace function public.fiches_apres_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.notification_queue (kind, title, body, url, dept)
    values ('moderation', 'Une fiche à valider', left(new.name, 120), '/#/moderation', new.dept);
  end if;
  return new;
end;
$$;

revoke execute on function public.fiches_apres_creation() from public, anon, authenticated;

drop trigger if exists fiches_apres_creation_trg on public.fiches;
create trigger fiches_apres_creation_trg
  after insert on public.fiches
  for each row execute function public.fiches_apres_creation();

-- -----------------------------------------------------------------------------
-- E. Sécurité de ligne
-- -----------------------------------------------------------------------------
alter table public.fiches enable row level security;

-- Lecture : le public ne voit que les fiches validées ; le propriétaire voit
-- la sienne quel que soit son état ; les modérateurs voient tout (comme les
-- événements en attente, 0020).
drop policy if exists fiches_select on public.fiches;
create policy fiches_select on public.fiches for select
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin());

drop policy if exists fiches_insert_own on public.fiches;
create policy fiches_insert_own on public.fiches for insert to authenticated
  with check (owner_id = auth.uid());

-- Modification : le propriétaire sur la sienne, le modérateur dans sa zone.
-- Le trigger ci-dessus décide de CE qui peut changer.
drop policy if exists fiches_update on public.fiches;
create policy fiches_update on public.fiches for update to authenticated
  using (owner_id = auth.uid() or public.can_moderate(dept))
  with check (owner_id = auth.uid() or public.can_moderate(dept));

drop policy if exists fiches_delete on public.fiches;
create policy fiches_delete on public.fiches for delete to authenticated
  using (owner_id = auth.uid() or public.am_i_owner());

grant select on public.fiches to anon, authenticated;
grant insert, update, delete on public.fiches to authenticated;

-- -----------------------------------------------------------------------------
-- F. Vérification — les six doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'account_type')                        as type_de_compte,
  (select count(*) = 0 from public.profiles
    where account_type is distinct from 'particulier')         as tous_particuliers,
  (select relrowsecurity from pg_class
    where oid = 'public.fiches'::regclass)                     as fiches_protegees,
  (select count(*) = 4 from pg_policies
    where schemaname = 'public' and tablename = 'fiches')      as quatre_politiques,
  (select count(*) = 2 from pg_trigger
    where tgrelid = 'public.fiches'::regclass and not tgisinternal) as deux_triggers,
  -- Le type de compte reste HORS du garde-fou des rôles : le modifier ne doit
  -- jamais demander les droits du propriétaire.
  (select pg_get_functiondef(p.oid) not like '%account_type%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guard_profile_role')
                                                               as type_libre;

-- =============================================================================
-- Fin de migration 0033
-- =============================================================================
