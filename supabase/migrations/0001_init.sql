-- =============================================================================
-- Armana — Migration initiale (schéma + PostGIS + RLS)
-- =============================================================================
-- À appliquer sur le projet Supabase DÉDIÉ à Armana (jamais partagé).
-- Principe directeur : ZÉRO confiance côté client. Toute autorisation est
-- imposée par les politiques RLS ci-dessous. La clé "anon" est publique.
-- =============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists postgis;      -- géographie / ST_DWithin
-- gen_random_uuid() est fourni par pgcrypto, présent par défaut sur Supabase.

-- =============================================================================
-- Table : profiles  (1 ligne par utilisateur auth)
-- =============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now()
);

-- =============================================================================
-- Helper : is_admin()
-- Défini APRÈS profiles : une fonction SQL valide son corps à la création, donc
-- la table référencée doit déjà exister (sinon ERROR 42P01).
-- SECURITY DEFINER pour lire profiles sans déclencher la RLS de profiles
-- (évite toute récursion de politique). search_path figé = anti-injection.
-- =============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Création automatique du profil à l'inscription -----------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Empêche un user d'escalader son propre rôle (seul un admin peut changer un rôle).
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Changement de rôle interdit';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role_trg on public.profiles;
create trigger guard_profile_role_trg
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- =============================================================================
-- Table : events
-- =============================================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  is_paid     boolean not null default false,
  price       numeric check (price is null or price >= 0),
  currency    text not null default 'EUR',
  location    geography(Point, 4326),
  address     text,
  category    text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);

create index if not exists events_location_gix on public.events using gist (location);
create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_status_idx    on public.events (status);
create index if not exists events_created_by_idx on public.events (created_by);

-- Vue exposant lat/lng en clair (PostgREST renvoie geography en EWKB illisible).
-- security_invoker = on  => la RLS de public.events s'applique au travers de la vue
-- (un anonyme ne voit que les événements 'approved').
create or replace view public.events_geo
  with (security_invoker = on)
as
  select
    e.*,
    ST_Y(e.location::geometry) as lat,
    ST_X(e.location::geometry) as lng
  from public.events e;

-- =============================================================================
-- Table : event_photos
-- storage_path = chemin dans le bucket Storage 'event-photos'.
-- =============================================================================
create table if not exists public.event_photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  storage_path text not null,
  position     int  not null default 0
);

create index if not exists event_photos_event_idx on public.event_photos (event_id);

-- =============================================================================
-- Table : gems  (favoris — PK composite user+event)
-- =============================================================================
create table if not exists public.gems (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists gems_event_idx on public.gems (event_id);

-- =============================================================================
-- Recherche par rayon (PostGIS ST_DWithin)
-- INVOKER (pas de security definer) => la RLS de events s'applique toujours :
-- un anonyme ne verra que les événements 'approved'.
-- =============================================================================
create or replace function public.events_within_radius(lat float, lng float, radius_m float)
returns setof public.events_geo
language sql
stable
as $$
  select *
  from public.events_geo g
  where g.location is not null
    and ST_DWithin(g.location, ST_MakePoint(lng, lat)::geography, radius_m)
  order by g.starts_at;
$$;

-- =============================================================================
-- RLS — activation
-- =============================================================================
alter table public.profiles     enable row level security;
alter table public.events       enable row level security;
alter table public.event_photos enable row level security;
alter table public.gems         enable row level security;

-- ---------------------------------------------------------------------------
-- Politiques : profiles
-- ---------------------------------------------------------------------------
-- Lecture publique des profils (afficher le nom de l'auteur d'un événement).
create policy profiles_select_public
  on public.profiles for select
  using (true);

-- Un user ne peut créer QUE son propre profil (filet ; normalement via trigger).
create policy profiles_insert_self
  on public.profiles for insert
  with check (id = auth.uid());

-- Mise à jour : sa propre ligne, OU admin sur n'importe qui.
-- (Le trigger guard_profile_role empêche l'auto-escalade de rôle.)
create policy profiles_update_self_or_admin
  on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Politiques : events
-- ---------------------------------------------------------------------------
-- Lecture : le public ne voit que 'approved' ; l'auteur voit les siens ;
-- l'admin voit tout.
create policy events_select_visible
  on public.events for select
  using (
    status = 'approved'
    or created_by = auth.uid()
    or public.is_admin()
  );

-- Création : seulement pour soi, et pas d'auto-approbation (sauf admin).
create policy events_insert_own
  on public.events for insert
  with check (
    created_by = auth.uid()
    and (status = 'pending' or public.is_admin())
  );

-- Mise à jour : l'auteur modifie les siens SANS pouvoir s'auto-approuver ;
-- l'admin modifie tout (y compris le statut de modération).
create policy events_update_own
  on public.events for update
  using (created_by = auth.uid())
  with check (
    created_by = auth.uid()
    and (status in ('pending', 'rejected') or public.is_admin())
  );

create policy events_update_admin
  on public.events for update
  using (public.is_admin())
  with check (public.is_admin());

-- Suppression : auteur OU admin.
create policy events_delete_own_or_admin
  on public.events for delete
  using (created_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Politiques : event_photos  (miroir de la visibilité de l'événement parent)
-- ---------------------------------------------------------------------------
create policy event_photos_select_visible
  on public.event_photos for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.status = 'approved' or e.created_by = auth.uid() or public.is_admin())
    )
  );

-- Écriture (insert/update/delete) : auteur de l'événement OU admin.
create policy event_photos_insert_author
  on public.event_photos for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.is_admin())
    )
  );

create policy event_photos_update_author
  on public.event_photos for update
  using (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.is_admin())
    )
  );

create policy event_photos_delete_author
  on public.event_photos for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.is_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- Politiques : gems  (chaque user ne gère que ses propres favoris)
-- ---------------------------------------------------------------------------
create policy gems_select_own
  on public.gems for select
  using (user_id = auth.uid());

create policy gems_insert_own
  on public.gems for insert
  with check (user_id = auth.uid());

create policy gems_delete_own
  on public.gems for delete
  using (user_id = auth.uid());

-- =============================================================================
-- Storage — bucket 'event-photos'
-- Lecture publique ; écriture réservée à l'auteur, confinée à son dossier
-- ({uid}/...). La 1re composante du chemin doit être l'UID de l'utilisateur.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;

create policy event_photos_read_public
  on storage.objects for select
  using (bucket_id = 'event-photos');

create policy event_photos_upload_own
  on storage.objects for insert
  with check (
    bucket_id = 'event-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy event_photos_update_own
  on storage.objects for update
  using (
    bucket_id = 'event-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy event_photos_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'event-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- GRANTS — accès au niveau TABLE pour les rôles PostgREST (anon / authenticated).
-- La RLS ci-dessus reste seule maîtresse de la visibilité LIGNE à LIGNE ;
-- ces GRANT n'ouvrent que l'accès table, sans lequel PostgREST renvoie 401/403.
-- =============================================================================
grant usage on schema public to anon, authenticated;

-- Lecture (le filtrage réel est fait par la RLS) :
grant select on public.events, public.events_geo, public.profiles, public.event_photos
  to anon, authenticated;

-- Écriture réservée aux utilisateurs connectés :
grant insert, update, delete on public.events        to authenticated;
grant insert, update, delete on public.event_photos  to authenticated;
grant select, insert, delete on public.gems          to authenticated;
grant insert, update         on public.profiles      to authenticated;

-- Fonctions RPC :
grant execute on function public.events_within_radius(float, float, float)
  to anon, authenticated;

-- =============================================================================
-- Fin de migration 0001
-- =============================================================================
