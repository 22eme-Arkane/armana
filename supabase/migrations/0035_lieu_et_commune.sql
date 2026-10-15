-- =============================================================================
-- Migration 0035 — le lieu et la commune d'un événement, séparés ;
--                  restauration sur place, food trucks annoncés, et food
--                  trucks sur une période (la carte au-delà du jour même)
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LA 0034 (elle utilise `ft_proprietaire`).
--
-- CONSTAT DE MATTHIEU (15/10/2026) : sur l'Agenda, la ligne « où » d'une
-- vignette montre tantôt « 04300 », tantôt « Mane », tantôt « Théâtre La
-- Rirette » — chacun écrivait ce qu'il voulait dans le seul champ « Adresse ».
--
-- Désormais le formulaire demande DEUX choses :
--   - le NOM DU LIEU, facultatif, en texte (« Théâtre La Rirette ») ;
--   - la COMMUNE, obligatoire, CHOISIE dans la liste officielle (jamais tapée).
-- `address` reste remplie (« Théâtre La Rirette, 04300 Mane ») : les anciens
-- téléphones, l'itinéraire et le partage continuent de la lire.
--
-- ⚠ À APPLIQUER AVANT DE METTRE EN LIGNE le code qui l'accompagne : il envoie
-- `p_place_name` et `p_city`. (Le code sait se rabattre sur l'ancienne
-- fonction si elle manque, mais sans enregistrer lieu ni commune.)
-- Dans l'autre sens, aucun risque : les deux paramètres ont une valeur par
-- défaut, les téléphones restés sur l'ancienne version publient comme avant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Les colonnes
-- -----------------------------------------------------------------------------
alter table public.events
  add column if not exists place_name text,
  add column if not exists city text;

alter table public.events drop constraint if exists events_place_name_longueur;
alter table public.events
  add constraint events_place_name_longueur check (char_length(place_name) <= 120);
alter table public.events drop constraint if exists events_city_longueur;
alter table public.events
  add constraint events_city_longueur check (char_length(city) <= 80);

comment on column public.events.place_name is
  'Nom du lieu (« Théâtre La Rirette »), facultatif, saisi par l''auteur.';
comment on column public.events.city is
  'Commune, CHOISIE dans la liste officielle par le formulaire. NULL pour les '
  'événements antérieurs à 0035 : l''application la déduit alors de l''adresse '
  'ou du point.';

-- Restauration sur place (Matthieu, 15/10/2026) : l'organisateur peut dire
-- qu'on mange sur place, avec un menu (plat par plat, même format que celui
-- des food trucks) et/ou une photo du menu. La photo est une ligne de
-- `event_photos` à la POSITION 100 : elle suit ainsi toutes les règles des
-- photos d'événement — suppression, purge mensuelle (fichiers d'abord).
alter table public.events
  add column if not exists restauration boolean not null default false,
  add column if not exists restauration_menu text;

alter table public.events drop constraint if exists events_restauration_menu_longueur;
alter table public.events
  add constraint events_restauration_menu_longueur check (char_length(restauration_menu) <= 2000);

-- -----------------------------------------------------------------------------
-- A bis. Les food trucks annoncés PAR L'ORGANISATEUR
-- -----------------------------------------------------------------------------
-- En plus de la « présence en plus » qu'un camion déclare lui-même (0034),
-- l'auteur d'un événement choisit des camions dans la liste des fiches
-- VALIDÉES. Le camion peut retirer cette mention depuis « Mon planning » :
-- personne n'est annoncé quelque part contre son gré.
create table if not exists public.event_food_trucks (
  event_id   uuid not null references public.events(id) on delete cascade,
  truck_id   uuid not null references public.fiches(id) on delete cascade,
  added_by   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, truck_id)
);

create index if not exists event_food_trucks_truck_idx on public.event_food_trucks (truck_id);

alter table public.event_food_trucks enable row level security;

-- Lecture : quand l'événement est visible du lecteur (la RLS des événements
-- s'applique dans la sous-requête) et le camion validé — ou pour le camion
-- lui-même, qui doit voir où on l'annonce.
drop policy if exists eft_select on public.event_food_trucks;
create policy eft_select on public.event_food_trucks for select
  using (
    (exists (select 1 from public.events e where e.id = event_id)
     and exists (select 1 from public.fiches f where f.id = truck_id and f.status = 'approved'))
    or public.ft_proprietaire(truck_id)
    or public.is_admin()
  );

-- Ajout : par l'AUTEUR de l'événement, pour un camion validé, à son nom.
drop policy if exists eft_insert on public.event_food_trucks;
create policy eft_insert on public.event_food_trucks for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and e.created_by = auth.uid())
    and exists (select 1 from public.fiches f
                 where f.id = truck_id and f.kind = 'food_truck' and f.status = 'approved')
  );

-- Retrait : l'auteur de l'événement, le camion lui-même, ou un modérateur.
drop policy if exists eft_delete on public.event_food_trucks;
create policy eft_delete on public.event_food_trucks for delete to authenticated
  using (
    exists (select 1 from public.events e where e.id = event_id and e.created_by = auth.uid())
    or public.ft_proprietaire(truck_id)
    or public.is_admin()
  );

grant select on public.event_food_trucks to anon, authenticated;
grant insert, delete on public.event_food_trucks to authenticated;

-- Six camions au plus par événement : au-delà, ce n'est plus une annonce.
create or replace function public.eft_limite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.event_food_trucks where event_id = new.event_id) >= 6 then
    raise exception 'Six food trucks au plus par événement.';
  end if;
  return new;
end;
$$;

revoke execute on function public.eft_limite() from public, anon, authenticated;

drop trigger if exists eft_limite_trg on public.event_food_trucks;
create trigger eft_limite_trg
  before insert on public.event_food_trucks
  for each row execute function public.eft_limite();

-- -----------------------------------------------------------------------------
-- A ter. Les food trucks sur une PÉRIODE (Matthieu, 15/10/2026)
-- -----------------------------------------------------------------------------
-- La carte ne se limite plus au jour même : par défaut le mois qui vient,
-- sinon la période choisie (aujourd'hui, ce week-end, cette semaine, un jour).
-- Même calcul que `food_trucks_today` (0034), jour par jour :
--   créneaux du jour de la semaine, dans leur saison
--   − fermetures ± déplacements + présences en plus.
-- Les signalements « pas là » ne valent que pour AUJOURD'HUI.
-- Période bornée à 31 jours et jamais dans le passé.
create or replace function public.food_trucks_periode(p_debut date, p_fin date)
returns table (
  jour         date,
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
    select (now() at time zone 'Europe/Paris')::date as d
  ),
  bornes as (
    select greatest(p_debut, ici.d) as d1,
           least(p_fin, greatest(p_debut, ici.d) + 31) as d2
      from ici
  ),
  jours as (
    select g::date as jour
      from bornes, generate_series(bornes.d1, bornes.d2, interval '1 day') g
  ),
  camions as (
    select f.id, f.name, f.cuisine, f.photo_path
      from public.fiches f
     where f.kind = 'food_truck'
       and f.status = 'approved'
       and public.ft_etat(f.last_confirmed_at) = 'active'
  ),
  recurrents as (
    select j.jour                                   as jour,
           s.truck_id                               as truck_id,
           s.id                                     as slot_id,
           null::uuid                               as exception_id,
           coalesce(m.start_time, s.start_time)     as start_time,
           coalesce(m.end_time, s.end_time)         as end_time,
           coalesce(m.location, s.location)         as location,
           coalesce(m.place_label, s.place_label)   as place_label,
           null::uuid                               as event_id
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
    select j.jour         as jour,
           e.truck_id     as truck_id,
           null::uuid     as slot_id,
           e.id           as exception_id,
           e.start_time   as start_time,
           e.end_time     as end_time,
           e.location     as location,
           e.place_label  as place_label,
           e.event_id     as event_id
      from public.food_truck_exceptions e
      join jours j on j.jour between e.date_start and e.date_end
     where e.kind = 'extra'
  ),
  tous as (
    select * from recurrents
    union all
    select * from ponctuels
  )
  select t.jour, c.id, c.name, c.cuisine, c.photo_path,
         t.slot_id, t.exception_id, t.start_time, t.end_time, t.place_label,
         st_y(t.location::geometry), st_x(t.location::geometry), t.event_id
    from tous t
    join camions c on c.id = t.truck_id
   cross join ici
   where t.jour <> ici.d
      or (select count(*) from public.food_truck_reports r
           where r.report_date = ici.d
             and (r.slot_id = t.slot_id or r.exception_id = t.exception_id))
         < public.reglage('ft_seuil_signalements', 2)
   order by t.jour, c.name, t.start_time;
$$;

grant execute on function public.food_trucks_periode(date, date) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. La vue expose les nouvelles colonnes (même manœuvre qu'en 0032)
-- -----------------------------------------------------------------------------
-- ⚠ `select e.*` FIGE LA LISTE DES COLONNES À LA CRÉATION : sans recréation,
-- les colonnes n'arriveraient jamais jusqu'à l'application.
drop function if exists public.events_within_radius(float, float, float);
drop view if exists public.events_geo;

create view public.events_geo
  with (security_invoker = on)
as
  select
    e.*,
    ST_Y(e.location::geometry) as lat,
    ST_X(e.location::geometry) as lng
  from public.events e;

grant select on public.events_geo to anon, authenticated;

create function public.events_within_radius(lat float, lng float, radius_m float)
returns setof public.events_geo
language sql
stable
set search_path = public
as $$
  select *
  from public.events_geo g
  where g.location is not null
    and ST_DWithin(g.location, ST_MakePoint(lng, lat)::geography, radius_m)
  order by g.starts_at;
$$;

grant execute on function public.events_within_radius(float, float, float)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. Les deux RPC gagnent `p_place_name`, `p_city`, `p_restauration`
--    et `p_restauration_menu`
-- -----------------------------------------------------------------------------
-- Corps de la 0032, aux seules lignes du lieu, de la commune et de la
-- restauration près.
drop function if exists public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text, boolean
);

create function public.create_event(
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_is_paid      boolean,
  p_price        numeric,
  p_lat          double precision,
  p_lng          double precision,
  p_address      text,
  p_category     text,
  p_recur_days   smallint[] default null,
  p_contact      text default null,
  p_recur_dates  date[]     default null,
  p_price_detail text       default null,
  p_price_mode   text       default null,
  p_au_chapeau   boolean    default null,
  p_place_name   text       default null,
  p_city         text       default null,
  p_restauration boolean    default null,
  p_restauration_menu text  default null
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_row public.events;
  recent  int;
  jours   smallint[];
  dates   date[];
  mode    text;
  paid    boolean;
  debut   timestamptz;
  fin     timestamptz;
begin
  select count(*) into recent
  from public.events
  where created_by = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent >= 10 then
    raise exception 'Limite atteinte : 10 événements par heure. Réessayez un peu plus tard.';
  end if;

  jours := nullif(p_recur_days, '{}');
  dates := nullif(p_recur_dates, '{}');

  if dates is not null then
    jours := null;
    select b.debut, b.fin into debut, fin
    from public.serie_bornes(dates, p_starts_at, p_ends_at) b;
  else
    debut := p_starts_at;
    fin   := p_ends_at;
    if jours is not null and fin is null then
      raise exception 'Un événement récurrent doit avoir une date de fin de période.';
    end if;
  end if;

  mode := coalesce(nullif(p_price_mode, ''),
                   case when coalesce(p_is_paid, false) then 'payant' else 'gratuit' end);
  if mode not in ('gratuit', 'libre', 'payant') then
    raise exception 'Tarif inconnu : %', mode;
  end if;
  paid := (mode = 'payant');

  insert into public.events (
    created_by, title, description, starts_at, ends_at,
    is_paid, price, location, address, category, status,
    recur_days, contact, recur_dates, price_detail, price_mode, au_chapeau,
    place_name, city, restauration, restauration_menu
  ) values (
    auth.uid(), p_title, nullif(p_description, ''), debut, fin,
    paid,
    case when mode = 'gratuit' then null else p_price end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending',
    jours, nullif(trim(p_contact), ''),
    dates,
    case when mode = 'payant' then nullif(trim(p_price_detail), '') else null end,
    mode,
    coalesce(p_au_chapeau, false),
    nullif(trim(p_place_name), ''),
    nullif(trim(p_city), ''),
    coalesce(p_restauration, false),
    case when coalesce(p_restauration, false) then nullif(trim(p_restauration_menu), '') else null end
  )
  returning * into new_row;
  return new_row;
end;
$$;

grant execute on function public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text, boolean, text, text, boolean, text
) to authenticated;

drop function if exists public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text, boolean
);

create function public.update_event(
  p_id           uuid,
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_is_paid      boolean,
  p_price        numeric,
  p_lat          double precision,
  p_lng          double precision,
  p_address      text,
  p_category     text,
  p_recur_days   smallint[] default null,
  p_contact      text default null,
  p_recur_dates  date[]     default null,
  p_price_detail text       default null,
  p_price_mode   text       default null,
  p_au_chapeau   boolean    default null,
  p_place_name   text       default null,
  p_city         text       default null,
  p_restauration boolean    default null,
  p_restauration_menu text  default null
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_row public.events;
  jours       smallint[];
  dates       date[];
  mode        text;
  paid        boolean;
  debut       timestamptz;
  fin         timestamptz;
begin
  jours := nullif(p_recur_days, '{}');
  dates := nullif(p_recur_dates, '{}');

  if dates is not null then
    jours := null;
    select b.debut, b.fin into debut, fin
    from public.serie_bornes(dates, p_starts_at, p_ends_at) b;
  else
    debut := p_starts_at;
    fin   := p_ends_at;
    if jours is not null and fin is null then
      raise exception 'Un événement récurrent doit avoir une date de fin de période.';
    end if;
  end if;

  mode := coalesce(nullif(p_price_mode, ''),
                   case when coalesce(p_is_paid, false) then 'payant' else 'gratuit' end);
  if mode not in ('gratuit', 'libre', 'payant') then
    raise exception 'Tarif inconnu : %', mode;
  end if;
  paid := (mode = 'payant');

  update public.events set
    title        = p_title,
    description  = nullif(p_description, ''),
    starts_at    = debut,
    ends_at      = fin,
    is_paid      = paid,
    price        = case when mode = 'gratuit' then null else p_price end,
    location     = case when p_lat is null or p_lng is null then null
                        else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    address      = nullif(p_address, ''),
    category     = nullif(p_category, ''),
    recur_days   = jours,
    recur_dates  = dates,
    price_detail = case when mode = 'payant' then nullif(trim(p_price_detail), '')
                        else null end,
    price_mode   = mode,
    au_chapeau   = coalesce(p_au_chapeau, au_chapeau),
    -- ⚠ NULL = ancien téléphone, qui ne connaît pas ces champs : on garde ce
    -- qui est en place, comme pour le chapeau. Le nouveau formulaire envoie
    -- toujours la commune, et une chaîne vide pour « pas de nom de lieu ».
    place_name   = case when p_city is null then place_name
                        else nullif(trim(p_place_name), '') end,
    city         = coalesce(nullif(trim(p_city), ''), city),
    -- Même règle : NULL (ancien téléphone) = on garde.
    restauration = coalesce(p_restauration, restauration),
    restauration_menu = case when p_restauration is null then restauration_menu
                             when p_restauration then nullif(trim(p_restauration_menu), '')
                             else null end,
    contact      = nullif(trim(p_contact), ''),
    status       = case when public.is_admin() then status else 'pending' end
  where id = p_id
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Événement introuvable ou non autorisé';
  end if;
  return updated_row;
end;
$$;

grant execute on function public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text, boolean, text, text, boolean, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- D. Vérification — les neuf doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) >= 0 from public.food_trucks_periode(current_date, current_date + 30))
                                                         as periode_food_trucks,
  (select count(*) = 4 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name in ('place_name', 'city', 'restauration', 'restauration_menu'))
                                                         as colonnes_ajoutees,
  -- ⚠ Le vrai piège : la vue fige ses colonnes.
  (select count(*) = 4 from information_schema.columns
    where table_schema = 'public' and table_name = 'events_geo'
      and column_name in ('place_name', 'city', 'restauration', 'restauration_menu'))
                                                         as vue_a_jour,
  (select relrowsecurity from pg_class
    where oid = 'public.event_food_trucks'::regclass)    as rattachements_proteges,
  (select count(*) = 3 from pg_policies
    where schemaname = 'public' and tablename = 'event_food_trucks')
                                                         as trois_politiques,
  (select pg_get_functiondef(p.oid) like '%p_city%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event')
                                                         as creation_a_jour,
  (select pg_get_functiondef(p.oid) like '%coalesce(nullif(trim(p_city)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event')
                                                         as modification_a_jour,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event') = 1
                                                         as une_seule_create_event,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event') = 1
                                                         as une_seule_update_event;

-- =============================================================================
-- Fin de migration 0035
-- =============================================================================
