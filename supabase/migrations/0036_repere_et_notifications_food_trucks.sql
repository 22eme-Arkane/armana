-- =============================================================================
-- Migration 0036 — repère des emplacements, notifications des food trucks
-- =============================================================================
--
-- RETOUR DU QUESTIONNAIRE (Zoumai Thai, 16/10/2026) ET DÉCISIONS DE MATTHIEU :
--
-- 1. EMPLACEMENT PRIVÉ / REPÈRE. Un camion stationne chez un hôte (« Gamm Vert
--    Forcalquier ») ou à un endroit précis (« Place du marché »). La commune
--    reste CHOISIE dans la liste ; s'y ajoute un repère facultatif, court
--    (40 signes), sur les créneaux et les exceptions.
--
-- 2. NOTIFICATIONS PROPRES AUX FOOD TRUCKS, plutôt que des SMS (payants) :
--    - rappel « Votre planning est toujours bon ? » au bout de 30 jours ;
--    - « Votre camion n'apparaît plus sur la carte » au bout de 37 jours ;
--    - « N personnes signalent votre absence » quand le seuil est atteint ;
--    - « Vous êtes annoncé sur … » quand un organisateur rattache le camion.
--    Elles sont PERSONNELLES : la file gagne un destinataire (`user_id`).
--
-- ⚠ SANS DANGER AVANT LE REDÉPLOIEMENT DE LA FONCTION `notify`. L'ancienne
-- fonction envoie une notification de type X à ceux dont la préférence X vaut
-- true. Ces notifications sont de type 'food_truck', et AUCUNE préférence
-- 'food_truck' n'est jamais enregistrée (le réglage est un refus,
-- 'food_truck_off') : l'ancienne fonction ne les envoie donc à personne —
-- jamais à un autre camion. Elles partent une fois la nouvelle déployée :
--     npx supabase functions deploy notify --no-verify-jwt
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Le repère des emplacements
-- -----------------------------------------------------------------------------
alter table public.food_truck_slots
  add column if not exists place_hint text;
alter table public.food_truck_slots drop constraint if exists food_truck_slots_repere_longueur;
alter table public.food_truck_slots
  add constraint food_truck_slots_repere_longueur check (char_length(place_hint) <= 40);

alter table public.food_truck_exceptions
  add column if not exists place_hint text;
alter table public.food_truck_exceptions drop constraint if exists food_truck_exceptions_repere_longueur;
alter table public.food_truck_exceptions
  add constraint food_truck_exceptions_repere_longueur check (char_length(place_hint) <= 40);

comment on column public.food_truck_slots.place_hint is
  'Repère ou hôte facultatif (« Parking Gamm Vert »). La commune, elle, est place_label.';

-- Les deux fonctions de lecture renvoient le repère. ⚠ Le type de retour
-- change : il faut les retirer avant de les recréer.
drop function if exists public.food_trucks_today(double precision, double precision, double precision);
drop function if exists public.food_trucks_periode(date, date);

create function public.food_trucks_today(
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
  place_hint   text,
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
           case when m.location is not null then m.place_hint else s.place_hint end as place_hint,
           null::uuid                               as event_id,
           j.veille                                 as veille
      from public.food_truck_slots s
      join jours j on s.weekday = extract(isodow from j.jour)::int
      left join lateral (
        select e.start_time, e.end_time, e.location, e.place_label, e.place_hint
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
           e.place_hint  as place_hint,
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
         t.slot_id, t.exception_id, t.start_time, t.end_time, t.place_label, t.place_hint,
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

create function public.food_trucks_periode(p_debut date, p_fin date)
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
  place_hint   text,
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
           case when m.location is not null then m.place_hint else s.place_hint end as place_hint,
           null::uuid                               as event_id
      from public.food_truck_slots s
      join jours j on s.weekday = extract(isodow from j.jour)::int
      left join lateral (
        select e.start_time, e.end_time, e.location, e.place_label, e.place_hint
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
           e.place_hint   as place_hint,
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
         t.slot_id, t.exception_id, t.start_time, t.end_time, t.place_label, t.place_hint,
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
-- B. Des notifications PERSONNELLES
-- -----------------------------------------------------------------------------
alter table public.notification_queue
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

create index if not exists notification_queue_user_idx
  on public.notification_queue (user_id) where user_id is not null;

/** Dépose une notification destinée au propriétaire d'un camion. */
create or replace function public.ft_notifier(p_truck uuid, p_titre text, p_corps text, p_url text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification_queue (kind, title, body, url, user_id)
  select 'food_truck', left(p_titre, 120), left(p_corps, 240), p_url, f.owner_id
    from public.fiches f
   where f.id = p_truck and f.kind = 'food_truck';
$$;

revoke execute on function public.ft_notifier(uuid, text, text, text) from public, anon, authenticated;

-- Le réglage : un REFUS (« food_truck_off »), pour que le camion soit prévenu
-- par défaut. Liste blanche de 0015, plus cette clé.
create or replace function public.set_notif_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  propre jsonb := '{}'::jsonb;
  cle    text;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'Préférences invalides';
  end if;
  foreach cle in array array['moderation', 'messages', 'nouveaux_evenements', 'food_truck_off'] loop
    if coalesce((p_prefs ->> cle)::boolean, false) then
      propre := propre || jsonb_build_object(cle, true);
    end if;
  end loop;
  update public.profiles set notif_prefs = propre where id = auth.uid();
  return propre;
end;
$$;

revoke execute on function public.set_notif_prefs(jsonb) from public, anon;
grant execute on function public.set_notif_prefs(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- C. Rappel à 30 jours, masquage à 37 — une fois chacun par confirmation
-- -----------------------------------------------------------------------------
alter table public.fiches
  add column if not exists ft_rappel_at timestamptz,
  add column if not exists ft_masque_signale_at timestamptz;

create or replace function public.ft_rappels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  n integer := 0;
begin
  -- Contexte serveur seulement (tâche planifiée).
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Réservé à la tâche planifiée.';
  end if;

  for f in
    select id, last_confirmed_at, ft_rappel_at, ft_masque_signale_at
      from public.fiches
     where kind = 'food_truck' and status = 'approved'
  loop
    if public.ft_etat(f.last_confirmed_at) = 'stale'
       and (f.ft_masque_signale_at is null or f.ft_masque_signale_at < f.last_confirmed_at)
    then
      perform public.ft_notifier(f.id,
        'Votre camion n’apparaît plus sur la carte',
        'Votre planning n’a pas été confirmé depuis longtemps. Un geste suffit pour revenir.',
        '/#/mon-planning');
      update public.fiches set ft_masque_signale_at = now() where id = f.id;
      n := n + 1;
    elsif public.ft_etat(f.last_confirmed_at) = 'active'
       and f.last_confirmed_at < now() - make_interval(days => public.reglage('ft_rappel_jours', 30))
       and (f.ft_rappel_at is null or f.ft_rappel_at < f.last_confirmed_at)
    then
      perform public.ft_notifier(f.id,
        'Votre planning est toujours bon ?',
        'Confirmez-le en un geste, sinon votre camion quittera bientôt la carte.',
        '/#/mon-planning');
      update public.fiches set ft_rappel_at = now() where id = f.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.ft_rappels() from public, anon;
grant execute on function public.ft_rappels() to authenticated, service_role;

-- Chaque matin à 9 h (heure de Paris en hiver ; 7 h UTC).
select cron.unschedule('armana-food-trucks-rappels') where exists (
  select 1 from cron.job where jobname = 'armana-food-trucks-rappels'
);
select cron.schedule('armana-food-trucks-rappels', '0 7 * * *', 'select public.ft_rappels()');

-- -----------------------------------------------------------------------------
-- D. « On signale votre absence » — au moment où le seuil est atteint
-- -----------------------------------------------------------------------------
-- Corps de la 0034, plus la notification (une seule : quand n atteint le seuil).
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
  lieu   text;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour signaler une absence.';
  end if;
  if (p_slot is null) = (p_exception is null) then
    raise exception 'Indiquez un créneau, ou une présence ponctuelle.';
  end if;

  if p_slot is not null then
    select truck_id, place_label into camion, lieu from public.food_truck_slots where id = p_slot;
  else
    select truck_id, place_label into camion, lieu from public.food_truck_exceptions
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

  if n = public.reglage('ft_seuil_signalements', 2) then
    perform public.ft_notifier(camion,
      n || ' personnes signalent votre absence',
      'À ' || coalesce(lieu, 'votre emplacement') || ' aujourd’hui. Votre camion est masqué sur la carte pour la journée.',
      '/#/mon-planning');
  end if;
  return n;
end;
$$;

revoke execute on function public.signaler_absence(uuid, uuid) from public, anon;
grant execute on function public.signaler_absence(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- E. « Vous êtes annoncé sur … » — quand un organisateur rattache le camion
-- -----------------------------------------------------------------------------
create or replace function public.eft_prevenir_camion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  titre text;
begin
  select e.title into titre from public.events e where e.id = new.event_id;
  -- Le camion qui s'annonce lui-même n'a pas besoin d'être prévenu.
  if not exists (select 1 from public.fiches f where f.id = new.truck_id and f.owner_id = new.added_by) then
    perform public.ft_notifier(new.truck_id,
      'On vous annonce sur un événement',
      '« ' || left(coalesce(titre, 'un événement'), 100) || ' ». Vous pouvez retirer la mention depuis votre planning.',
      '/#/mon-planning');
  end if;
  return null;
end;
$$;

revoke execute on function public.eft_prevenir_camion() from public, anon, authenticated;

drop trigger if exists eft_prevenir_camion_trg on public.event_food_trucks;
create trigger eft_prevenir_camion_trg
  after insert on public.event_food_trucks
  for each row execute function public.eft_prevenir_camion();

-- -----------------------------------------------------------------------------
-- F. Vérification — les huit doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and column_name = 'place_hint'
      and table_name in ('food_truck_slots', 'food_truck_exceptions'))   as repere,
  (select count(*) >= 0 from public.food_trucks_today())                  as fonction_du_jour,
  (select count(*) >= 0 from public.food_trucks_periode(current_date, current_date + 30))
                                                                          as fonction_periode,
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_queue'
      and column_name = 'user_id')                                        as destinataire,
  (select pg_get_functiondef('public.set_notif_prefs'::regproc) like '%food_truck_off%')
                                                                          as reglage_refus,
  (select count(*) = 1 from cron.job where jobname = 'armana-food-trucks-rappels')
                                                                          as rappels_planifies,
  (select count(*) = 1 from pg_trigger
    where tgname = 'eft_prevenir_camion_trg')                             as annonce_prevenue,
  -- ⚠ La garantie de sécurité : personne n'a de préférence 'food_truck' à
  -- true, donc l'ANCIENNE fonction d'envoi ne transmet ces notifications à
  -- personne.
  (select count(*) = 0 from public.profiles
    where (notif_prefs ->> 'food_truck')::boolean is true)                as ancienne_fonction_sans_risque;

-- =============================================================================
-- Fin de migration 0036
-- =============================================================================
