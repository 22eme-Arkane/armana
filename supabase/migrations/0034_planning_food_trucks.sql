-- =============================================================================
-- Migration 0034 — planning des food trucks
-- =============================================================================
--
-- SPEC : armana-food-trucks-spec.md (v1). Un food truck saisit UNE FOIS son
-- planning de la semaine, puis ne gère que les exceptions (absence, vacances,
-- changement de lieu, présence en plus). La Carte montre les camions présents
-- AUJOURD'HUI, calculé en heure de Paris.
--
-- ⚠ LE CAMION, C'EST LA FICHE. Pas de table `food_trucks` en double : la fiche
-- de la migration 0033 (kind = 'food_truck') porte déjà nom, cuisine, photo,
-- contact et validation par un modérateur. Le planning s'y rattache.
--
-- ⚠ PAS DE FICHE FANTÔME, ET PAS DE TÂCHE PLANIFIÉE POUR Y ARRIVER. L'état
-- « actif / masqué / archivé » est CALCULÉ à la lecture depuis la date de
-- dernière confirmation, jamais stocké : il n'existe aucun job dont la panne
-- laisserait un camion périmé sur la carte. Seul le ménage (vieilles
-- exceptions, vieux signalements) passe par une fonction, planifiée chaque
-- nuit avec pg_cron (déjà en service depuis 0016) et rejouée par le bouton
-- « Nettoyer les mois passés ».
--
-- ⚠ LES DÉLAIS ET LE SEUIL SONT EN ATTENTE DU QUESTIONNAIRE AUX FOOD TRUCKS :
-- ils vivent dans la table `reglages`, modifiable sans migration.
--
-- AUCUN RISQUE POUR L'EXISTANT : deux colonnes avec valeur par défaut sur
-- `fiches` (confirmation, galerie de photos), des tables neuves, et le trigger de 0033 réécrit à l'identique
-- plus une règle.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Réglages (en attente du questionnaire)
-- -----------------------------------------------------------------------------
create table if not exists public.reglages (
  cle    text primary key,
  valeur integer not null,
  note   text
);

insert into public.reglages (cle, valeur, note) values
  ('ft_rappel_jours',       30,  'Food trucks : jours sans confirmation avant le rappel « Votre planning est toujours bon ? ».'),
  ('ft_masquage_jours',     37,  'Food trucks : jours sans confirmation avant que le camion disparaisse de la carte.'),
  ('ft_archivage_jours',    182, 'Food trucks : jours sans confirmation avant l''archivage.'),
  ('ft_seuil_signalements', 2,   'Food trucks : signalements « Pas là » distincts qui masquent un créneau pour la journée.')
on conflict (cle) do nothing;

alter table public.reglages enable row level security;

drop policy if exists reglages_select on public.reglages;
create policy reglages_select on public.reglages for select using (true);

-- Seul le propriétaire les règle.
drop policy if exists reglages_ecriture on public.reglages;
create policy reglages_ecriture on public.reglages for all to authenticated
  using (public.am_i_owner()) with check (public.am_i_owner());

grant select on public.reglages to anon, authenticated;
grant insert, update, delete on public.reglages to authenticated;

create or replace function public.reglage(p_cle text, p_defaut integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select valeur from public.reglages where cle = p_cle), p_defaut);
$$;

grant execute on function public.reglage(text, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. La date de confirmation, sur la fiche
-- -----------------------------------------------------------------------------
-- Valeur par défaut : maintenant. Les fiches existantes partent donc
-- « fraîches » au lieu d'être masquées dès l'application de la migration.
alter table public.fiches
  add column if not exists last_confirmed_at timestamptz not null default now();

-- Galerie « En photo » : jusqu'à quatre photos du camion (ou du lieu), en plus
-- de la photo d'en-tête. Mêmes règles que les autres photos de fiche : dossier
-- de l'auteur, WebP compressé côté client, effacées avec la fiche.
alter table public.fiches
  add column if not exists gallery_paths text[] not null default '{}';
alter table public.fiches drop constraint if exists fiches_galerie_max;
alter table public.fiches
  add constraint fiches_galerie_max check (cardinality(gallery_paths) <= 4);

comment on column public.fiches.last_confirmed_at is
  'Food trucks : dernière confirmation du planning (bouton « Mon planning est '
  'toujours bon » ou toute modification du planning).';

/** L'état d'un camion, calculé : 'active' | 'stale' | 'archived'. */
create or replace function public.ft_etat(p_confirme timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_confirme >= now() - make_interval(days => public.reglage('ft_masquage_jours', 37)) then 'active'
    when p_confirme >= now() - make_interval(days => public.reglage('ft_archivage_jours', 182)) then 'stale'
    else 'archived'
  end;
$$;

grant execute on function public.ft_etat(timestamptz) to anon, authenticated;

-- Le garde-fou de 0033, à l'identique (plus la galerie dans les champs qui
-- renvoient en relecture), et UNE règle de plus (repérée par ★) : la
-- date de confirmation ne s'écrit pas à la main. Seules les fonctions de ce
-- fichier la touchent, en posant un drapeau de transaction que le client ne
-- peut pas poser lui-même (set_config n'est pas exposé par l'API).
create or replace function public.fiches_avant_ecriture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  moderateur boolean;
begin
  new.dept := public.dept_of_point(new.location);
  new.updated_at := now();

  if auth.uid() is null then
    return new;
  end if;

  moderateur := public.can_moderate(new.dept);

  if tg_op = 'INSERT' then
    new.last_confirmed_at := now(); -- ★
    if not moderateur then
      new.status := 'pending';
      new.reviewed_at := null;
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'Une fiche ne change pas de propriétaire.';
  end if;

  -- ★ La confirmation passe par « Mon planning », jamais par une écriture directe.
  if new.last_confirmed_at is distinct from old.last_confirmed_at
     and not moderateur
     and coalesce(current_setting('armana.planning', true), '') <> '1'
  then
    raise exception 'La confirmation du planning se fait depuis « Mon planning ».';
  end if;

  if new.status is distinct from old.status then
    if not moderateur then
      raise exception 'Seul un modérateur valide ou refuse une fiche.';
    end if;
    new.reviewed_at := now();
  end if;

  if not moderateur
     and (new.kind, new.name, new.description, new.website, new.contact,
          new.opening_hours, new.address, new.location::text, new.cuisine,
          new.menu, new.photo_path, new.product_photo_path, new.gallery_paths)
         is distinct from
         (old.kind, old.name, old.description, old.website, old.contact,
          old.opening_hours, old.address, old.location::text, old.cuisine,
          old.menu, old.photo_path, old.product_photo_path, old.gallery_paths)
  then
    new.status := 'pending';
    new.reviewed_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.fiches_avant_ecriture() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. Les tables du planning
-- -----------------------------------------------------------------------------
-- Créneaux récurrents : « le mardi, 18 h – 22 h, place du marché ».
create table if not exists public.food_truck_slots (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null references public.fiches(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7), -- ISO : lundi = 1
  start_time  time not null,
  -- end_time < start_time = le créneau passe minuit (22 h – 2 h).
  end_time    time not null check (end_time <> start_time),
  location    geography(Point, 4326) not null,
  place_label text not null check (char_length(place_label) between 2 and 120),
  -- Saisonnalité facultative (planning d'été, d'hiver).
  valid_from  date,
  valid_until date,
  created_at  timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists food_truck_slots_truck_idx on public.food_truck_slots (truck_id);
create index if not exists food_truck_slots_jour_idx on public.food_truck_slots (weekday);
create index if not exists food_truck_slots_location_idx on public.food_truck_slots using gist (location);

-- Exceptions : fermé (un créneau ou tous = vacances), déplacé, présence en plus.
create table if not exists public.food_truck_exceptions (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null references public.fiches(id) on delete cascade,
  slot_id     uuid references public.food_truck_slots(id) on delete cascade,
  kind        text not null check (kind in ('closed', 'moved', 'extra')),
  date_start  date not null,
  date_end    date not null,
  start_time  time,
  end_time    time,
  location    geography(Point, 4326),
  place_label text check (char_length(place_label) between 2 and 120),
  -- Présence en plus sur un événement Armana : c'est ce qui allume le badge
  -- « Food sur place ». L'événement purgé, le lien tombe, la présence reste.
  event_id    uuid references public.events(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (date_end >= date_start),
  check (date_end - date_start <= 366),
  check ((start_time is null) = (end_time is null)),
  check (start_time is null or start_time <> end_time),
  -- Un déplacement vise UN créneau et change au moins le lieu ou l'horaire.
  check (kind <> 'moved' or (slot_id is not null
                             and (start_time is not null or location is not null))),
  -- Un déplacement avec un nouveau lieu porte aussi son libellé.
  check (location is null or place_label is not null),
  -- Une présence en plus est complète : horaire, lieu, libellé, et aucun créneau.
  check (kind <> 'extra' or (slot_id is null and start_time is not null
                             and location is not null)),
  check (kind <> 'closed' or (start_time is null and location is null and event_id is null))
);

create index if not exists food_truck_exceptions_truck_idx on public.food_truck_exceptions (truck_id);
create index if not exists food_truck_exceptions_dates_idx on public.food_truck_exceptions (date_start, date_end);
create index if not exists food_truck_exceptions_event_idx on public.food_truck_exceptions (event_id)
  where event_id is not null;

-- Signalements « Pas là aujourd'hui ». Un par personne, par créneau et par jour.
-- Lus seulement par les modérateurs : le camion voit un NOMBRE (fonction
-- mes_signalements), jamais qui l'a signalé.
create table if not exists public.food_truck_reports (
  id           uuid primary key default gen_random_uuid(),
  truck_id     uuid not null references public.fiches(id) on delete cascade,
  slot_id      uuid references public.food_truck_slots(id) on delete cascade,
  exception_id uuid references public.food_truck_exceptions(id) on delete cascade,
  report_date  date not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check ((slot_id is null) <> (exception_id is null))
);

create unique index if not exists food_truck_reports_slot_uniq
  on public.food_truck_reports (slot_id, report_date, user_id) where slot_id is not null;
create unique index if not exists food_truck_reports_exception_uniq
  on public.food_truck_reports (exception_id, report_date, user_id) where exception_id is not null;
create index if not exists food_truck_reports_date_idx on public.food_truck_reports (report_date);

-- -----------------------------------------------------------------------------
-- D. Qui est quoi pour un camion donné
-- -----------------------------------------------------------------------------
create or replace function public.ft_proprietaire(p_truck uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fiches
                  where id = p_truck and owner_id = auth.uid() and kind = 'food_truck');
$$;

/** Visible du public : validé ET confirmé récemment. */
create or replace function public.ft_public(p_truck uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fiches
                  where id = p_truck and kind = 'food_truck' and status = 'approved'
                    and public.ft_etat(last_confirmed_at) = 'active');
$$;

create or replace function public.ft_moderable(p_truck uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fiches f
                  where f.id = p_truck and public.can_moderate(f.dept));
$$;

grant execute on function public.ft_proprietaire(uuid) to anon, authenticated;
grant execute on function public.ft_public(uuid) to anon, authenticated;
grant execute on function public.ft_moderable(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. Garde-fous du planning
-- -----------------------------------------------------------------------------
create or replace function public.ft_planning_avant_ecriture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if tg_op = 'UPDATE' and new.truck_id is distinct from old.truck_id then
    raise exception 'Un créneau ne change pas de food truck.';
  end if;

  if not exists (select 1 from public.fiches where id = new.truck_id and kind = 'food_truck') then
    raise exception 'Le planning est réservé aux fiches de food truck.';
  end if;

  if tg_table_name = 'food_truck_slots' then
    if tg_op = 'INSERT' then
      select count(*) into n from public.food_truck_slots where truck_id = new.truck_id;
      if n >= 40 then
        raise exception 'Quarante créneaux au plus par food truck.';
      end if;
    end if;
    return new;
  end if;

  -- Exceptions
  if new.slot_id is not null
     and not exists (select 1 from public.food_truck_slots
                      where id = new.slot_id and truck_id = new.truck_id) then
    raise exception 'Ce créneau n''appartient pas à ce food truck.';
  end if;

  if new.event_id is not null
     and not exists (select 1 from public.events where id = new.event_id and status = 'approved') then
    raise exception 'Cet événement n''est pas publié.';
  end if;

  if tg_op = 'INSERT' then
    -- Rien dans le passé : une exception d'hier ne sert plus à rien.
    if new.date_end < (now() at time zone 'Europe/Paris')::date then
      raise exception 'Cette date est déjà passée.';
    end if;
    select count(*) into n from public.food_truck_exceptions where truck_id = new.truck_id;
    if n >= 100 then
      raise exception 'Trop d''exceptions enregistrées : supprimez les anciennes.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.ft_planning_avant_ecriture() from public, anon, authenticated;

drop trigger if exists ft_slots_avant_ecriture_trg on public.food_truck_slots;
create trigger ft_slots_avant_ecriture_trg
  before insert or update on public.food_truck_slots
  for each row execute function public.ft_planning_avant_ecriture();

drop trigger if exists ft_exceptions_avant_ecriture_trg on public.food_truck_exceptions;
create trigger ft_exceptions_avant_ecriture_trg
  before insert or update on public.food_truck_exceptions
  for each row execute function public.ft_planning_avant_ecriture();

-- Toute retouche du planning PAR LE CAMION vaut confirmation (spec §2.2).
create or replace function public.ft_planning_apres_ecriture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  camion uuid;
begin
  if tg_op = 'DELETE' then camion := old.truck_id; else camion := new.truck_id; end if;
  if auth.uid() is not null and public.ft_proprietaire(camion) then
    perform set_config('armana.planning', '1', true);
    update public.fiches set last_confirmed_at = now() where id = camion;
    perform set_config('armana.planning', '', true);
  end if;
  return null;
end;
$$;

revoke execute on function public.ft_planning_apres_ecriture() from public, anon, authenticated;

drop trigger if exists ft_slots_apres_ecriture_trg on public.food_truck_slots;
create trigger ft_slots_apres_ecriture_trg
  after insert or update or delete on public.food_truck_slots
  for each row execute function public.ft_planning_apres_ecriture();

drop trigger if exists ft_exceptions_apres_ecriture_trg on public.food_truck_exceptions;
create trigger ft_exceptions_apres_ecriture_trg
  after insert or update or delete on public.food_truck_exceptions
  for each row execute function public.ft_planning_apres_ecriture();

-- -----------------------------------------------------------------------------
-- F. Sécurité de ligne
-- -----------------------------------------------------------------------------
alter table public.food_truck_slots enable row level security;
alter table public.food_truck_exceptions enable row level security;
alter table public.food_truck_reports enable row level security;

-- Créneaux et exceptions : publics quand le camion l'est ; le camion voit
-- toujours les siens ; les modérateurs voient tout.
drop policy if exists ft_slots_select on public.food_truck_slots;
create policy ft_slots_select on public.food_truck_slots for select
  using (public.ft_public(truck_id) or public.ft_proprietaire(truck_id) or public.is_admin());

drop policy if exists ft_slots_insert on public.food_truck_slots;
create policy ft_slots_insert on public.food_truck_slots for insert to authenticated
  with check (public.ft_proprietaire(truck_id));

drop policy if exists ft_slots_update on public.food_truck_slots;
create policy ft_slots_update on public.food_truck_slots for update to authenticated
  using (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id))
  with check (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id));

drop policy if exists ft_slots_delete on public.food_truck_slots;
create policy ft_slots_delete on public.food_truck_slots for delete to authenticated
  using (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id));

drop policy if exists ft_exceptions_select on public.food_truck_exceptions;
create policy ft_exceptions_select on public.food_truck_exceptions for select
  using (public.ft_public(truck_id) or public.ft_proprietaire(truck_id) or public.is_admin());

drop policy if exists ft_exceptions_insert on public.food_truck_exceptions;
create policy ft_exceptions_insert on public.food_truck_exceptions for insert to authenticated
  with check (public.ft_proprietaire(truck_id));

drop policy if exists ft_exceptions_update on public.food_truck_exceptions;
create policy ft_exceptions_update on public.food_truck_exceptions for update to authenticated
  using (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id))
  with check (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id));

drop policy if exists ft_exceptions_delete on public.food_truck_exceptions;
create policy ft_exceptions_delete on public.food_truck_exceptions for delete to authenticated
  using (public.ft_proprietaire(truck_id) or public.ft_moderable(truck_id));

-- Signalements : lecture modérateurs seulement ; écriture par la fonction
-- signaler_absence, jamais en direct (aucune politique d'insertion).
drop policy if exists ft_reports_select on public.food_truck_reports;
create policy ft_reports_select on public.food_truck_reports for select to authenticated
  using (public.is_admin());

drop policy if exists ft_reports_delete on public.food_truck_reports;
create policy ft_reports_delete on public.food_truck_reports for delete to authenticated
  using (public.is_admin());

grant select on public.food_truck_slots, public.food_truck_exceptions to anon, authenticated;
grant insert, update, delete on public.food_truck_slots, public.food_truck_exceptions to authenticated;
grant select, delete on public.food_truck_reports to authenticated;

-- -----------------------------------------------------------------------------
-- G. Les fonctions appelées par l'application
-- -----------------------------------------------------------------------------

-- « Mon planning est toujours bon. »
create or replace function public.confirmer_planning()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  quand timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Vous n''êtes pas connecté.';
  end if;
  perform set_config('armana.planning', '1', true);
  update public.fiches set last_confirmed_at = now()
   where owner_id = auth.uid() and kind = 'food_truck'
  returning last_confirmed_at into quand;
  perform set_config('armana.planning', '', true);
  if quand is null then
    raise exception 'Aucune fiche de food truck sur ce compte.';
  end if;
  return quand;
end;
$$;

revoke execute on function public.confirmer_planning() from public, anon;
grant execute on function public.confirmer_planning() to authenticated;

-- « Pas là aujourd'hui » — renvoie le nombre de signalements du jour.
create or replace function public.signaler_absence(p_slot uuid default null, p_exception uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  camion uuid;
  jour   date := (now() at time zone 'Europe/Paris')::date;
  n      integer;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour signaler une absence.';
  end if;
  if (p_slot is null) = (p_exception is null) then
    raise exception 'Indiquez un créneau, ou une présence ponctuelle.';
  end if;

  if p_slot is not null then
    select truck_id into camion from public.food_truck_slots where id = p_slot;
  else
    select truck_id into camion from public.food_truck_exceptions
     where id = p_exception and kind = 'extra';
  end if;

  if camion is null or not public.ft_public(camion) then
    raise exception 'Ce food truck n''est pas affiché.';
  end if;
  if public.ft_proprietaire(camion) then
    raise exception 'C''est votre food truck : utilisez « Je ne suis pas là » dans votre planning.';
  end if;

  insert into public.food_truck_reports (truck_id, slot_id, exception_id, report_date, user_id)
  values (camion, p_slot, p_exception, jour, auth.uid())
  on conflict do nothing;

  select count(*) into n from public.food_truck_reports
   where report_date = jour
     and (slot_id = p_slot or exception_id = p_exception);
  return n;
end;
$$;

revoke execute on function public.signaler_absence(uuid, uuid) from public, anon;
grant execute on function public.signaler_absence(uuid, uuid) to authenticated;

-- Le camion voit COMBIEN de personnes l'ont signalé absent aujourd'hui, pas qui.
create or replace function public.mes_signalements()
returns table (slot_id uuid, exception_id uuid, nb integer)
language sql
stable
security definer
set search_path = public
as $$
  select r.slot_id, r.exception_id, count(*)::integer
    from public.food_truck_reports r
    join public.fiches f on f.id = r.truck_id
   where f.owner_id = auth.uid()
     and r.report_date = (now() at time zone 'Europe/Paris')::date
   group by r.slot_id, r.exception_id;
$$;

revoke execute on function public.mes_signalements() from public, anon;
grant execute on function public.mes_signalements() to authenticated;

-- Les camions présents AUJOURD'HUI (heure de Paris) :
--   créneaux du jour, dans leur période de validité
--   − fermetures (un créneau, ou tous)
--   ± déplacements (lieu et/ou horaire remplacés)
--   + présences en plus
--   − ce qui a reçu assez de signalements aujourd'hui.
-- Un créneau qui passe minuit (22 h – 2 h) compte encore le lendemain jusqu'à
-- sa fin : à 1 h du matin, le camion de la veille est toujours là.
create or replace function public.food_trucks_today(
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_radius_m double precision default null
)
returns table (
  truck_id     uuid,
  name         text,
  cuisine      text,
  photo_path   text,
  slot_id      uuid,
  exception_id uuid,
  start_time   time,
  end_time     time,
  place_label  text,
  lat          double precision,
  lng          double precision,
  event_id     uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with ici as (
    select (now() at time zone 'Europe/Paris')::date as d,
           (now() at time zone 'Europe/Paris')::time as h
  ),
  jours as (
    select ici.d as jour, false as veille from ici
    union all
    select ici.d - 1, true from ici
  ),
  camions as (
    select f.id, f.name, f.cuisine, f.photo_path
      from public.fiches f
     where f.kind = 'food_truck'
       and f.status = 'approved'
       and public.ft_etat(f.last_confirmed_at) = 'active'
  ),
  recurrents as (
    select s.truck_id                               as truck_id,
           s.id                                     as slot_id,
           null::uuid                               as exception_id,
           coalesce(m.start_time, s.start_time)     as start_time,
           coalesce(m.end_time, s.end_time)         as end_time,
           coalesce(m.location, s.location)         as location,
           coalesce(m.place_label, s.place_label)   as place_label,
           null::uuid                               as event_id,
           j.veille                                 as veille
      from public.food_truck_slots s
      join jours j on s.weekday = extract(isodow from j.jour)::int
      left join lateral (
        select e.start_time, e.end_time, e.location, e.place_label
          from public.food_truck_exceptions e
         where e.slot_id = s.id and e.kind = 'moved'
           and j.jour between e.date_start and e.date_end
         order by e.created_at desc
         limit 1
      ) m on true
     where (s.valid_from is null or s.valid_from <= j.jour)
       and (s.valid_until is null or s.valid_until >= j.jour)
       and not exists (
         select 1 from public.food_truck_exceptions c
          where c.truck_id = s.truck_id and c.kind = 'closed'
            and j.jour between c.date_start and c.date_end
            and (c.slot_id is null or c.slot_id = s.id)
       )
  ),
  ponctuels as (
    select e.truck_id    as truck_id,
           null::uuid    as slot_id,
           e.id          as exception_id,
           e.start_time  as start_time,
           e.end_time    as end_time,
           e.location    as location,
           e.place_label as place_label,
           e.event_id    as event_id,
           j.veille      as veille
      from public.food_truck_exceptions e
      join jours j on j.jour between e.date_start and e.date_end
     where e.kind = 'extra'
  ),
  tous as (
    select * from recurrents
    union all
    select * from ponctuels
  )
  select c.id, c.name, c.cuisine, c.photo_path,
         t.slot_id, t.exception_id, t.start_time, t.end_time, t.place_label,
         st_y(t.location::geometry), st_x(t.location::geometry), t.event_id
    from tous t
    join camions c on c.id = t.truck_id
   cross join ici
   where (not t.veille or (t.end_time < t.start_time and ici.h < t.end_time))
     and (p_lat is null or p_lng is null or p_radius_m is null
          or st_dwithin(t.location, st_makepoint(p_lng, p_lat)::geography, p_radius_m))
     and (select count(*) from public.food_truck_reports r
           where r.report_date = ici.d
             and (r.slot_id = t.slot_id or r.exception_id = t.exception_id))
         < public.reglage('ft_seuil_signalements', 2)
   order by c.name, t.start_time;
$$;

grant execute on function public.food_trucks_today(double precision, double precision, double precision)
  to anon, authenticated;

-- Ménage : exceptions finies depuis plus de 2 jours, signalements de plus de
-- 7 jours. Modérateurs (bouton « Nettoyer ») ou serveur (purge quotidienne).
create or replace function public.nettoyer_food_trucks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  jour date := (now() at time zone 'Europe/Paris')::date;
  a integer;
  b integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Réservé aux modérateurs.';
  end if;
  delete from public.food_truck_exceptions where date_end < jour - 2;
  get diagnostics a = row_count;
  delete from public.food_truck_reports where report_date < jour - 7;
  get diagnostics b = row_count;
  return a + b;
end;
$$;

revoke execute on function public.nettoyer_food_trucks() from public, anon;
grant execute on function public.nettoyer_food_trucks() to authenticated, service_role;

-- Chaque nuit à 3 h 15 (UTC). Rien de lourd : quelques lignes au plus.
select cron.unschedule('armana-food-trucks') where exists (
  select 1 from cron.job where jobname = 'armana-food-trucks'
);
select cron.schedule('armana-food-trucks', '15 3 * * *', 'select public.nettoyer_food_trucks()');

-- -----------------------------------------------------------------------------
-- H. Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
select
  (select count(*) = 4 from public.reglages where cle like 'ft\_%')         as quatre_reglages,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fiches'
      and column_name = 'last_confirmed_at')                                as confirmation,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fiches'
      and column_name = 'gallery_paths')                                    as galerie,
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.food_truck_slots'::regclass,
                  'public.food_truck_exceptions'::regclass,
                  'public.food_truck_reports'::regclass,
                  'public.reglages'::regclass))                             as tables_protegees,
  (select count(*) = 2 from pg_policies
    where schemaname = 'public' and tablename = 'food_truck_reports')       as signalements_fermes,
  (select count(*) = 4 from pg_trigger
    where tgrelid in ('public.food_truck_slots'::regclass,
                      'public.food_truck_exceptions'::regclass)
      and not tgisinternal)                                                 as quatre_triggers,
  (select pg_get_functiondef('public.fiches_avant_ecriture'::regproc)
          like '%armana.planning%')                                         as garde_fou_confirmation,
  (select count(*) >= 0 from public.food_trucks_today())                    as fonction_du_jour,
  (select count(*) = 1 from cron.job where jobname = 'armana-food-trucks')  as menage_planifie;

-- =============================================================================
-- Fin de migration 0034
-- =============================================================================
