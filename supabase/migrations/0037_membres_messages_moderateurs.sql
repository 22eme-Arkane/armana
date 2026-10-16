-- =============================================================================
-- Migration 0037 — refonte des écrans Membres, Messages et Modérateurs
-- =============================================================================
--
-- DEMANDE DE MATTHIEU (16/10/2026) : plus de clarté et de possibilités sur les
-- trois écrans d'administration.
--
--   * MEMBRES : savoir d'un coup d'œil qui est particulier, lieu culturel ou
--     food truck ; filtrer, trier ; une fiche membre complète ; et pouvoir
--     SUPPRIMER un compte (propriétaire seul).
--   * MESSAGES : « à traiter » / « traités » au lieu de tout effacer ; pour un
--     bug, l'appareil et la version de l'app, notés à l'envoi.
--   * MODÉRATEURS : qui couvre quel département, ce qui attend dans chacun,
--     l'activité de chaque modérateur, le contexte des candidatures.
--
-- (Pas de réponse dans l'app pour l'instant : décision de Matthieu.)
--
-- LES FRONTIÈRES NE BOUGENT PAS :
--   * la LISTE des membres reste ouverte aux modérateurs, SANS e-mail — et la
--     dernière visite n'y figure que pour le propriétaire ;
--   * la FICHE (e-mail, activité détaillée), les messages, les modérateurs et
--     la suppression d'un compte restent au PROPRIÉTAIRE.
--
-- ⚠ À appliquer après la 0036. Plusieurs fonctions changent de type de
-- retour : elles sont retirées puis recréées.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La liste des membres (modérateurs et propriétaire)
-- -----------------------------------------------------------------------------
drop function if exists public.list_members();
create function public.list_members()
returns table (
  id uuid, display_name text, role text, created_at timestamptz, is_owner boolean,
  account_type text, mod_depts text[], is_supporter boolean,
  fiche_id uuid, fiche_kind text, fiche_name text, fiche_status text,
  events_total int, last_seen date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  proprio boolean := public.am_i_owner();
begin
  if not public.is_admin() then
    raise exception 'Réservé aux modérateurs';
  end if;
  return query
    select p.id, p.display_name, p.role, p.created_at, p.is_owner,
           p.account_type, p.mod_depts, (p.supporter_since is not null),
           f.id, f.kind, f.name, f.status,
           (select count(*)::int from public.events e where e.created_by = p.id),
           -- La dernière visite est une donnée d'activité personnelle : au
           -- propriétaire seul, comme la fiche.
           case when proprio
                then (select max(v.day) from public.app_visits v where v.user_id = p.id)
           end
      from public.profiles p
      left join public.fiches f on f.owner_id = p.id
     order by p.created_at desc;
end;
$$;

revoke execute on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

-- -----------------------------------------------------------------------------
-- B. La fiche d'un membre (propriétaire) — tout ce qui manquait
-- -----------------------------------------------------------------------------
drop function if exists public.member_profile(uuid);
create function public.member_profile(p_id uuid)
returns table (
  id uuid, display_name text, email text, role text, is_owner boolean,
  mod_depts text[],
  created_at timestamptz, supporter_since timestamptz,
  events_total int, events_pending int, last_seen date,
  account_type text,
  visits_30d int,
  events_upcoming int,
  events_rejected int,
  notifs_actives boolean,
  feedback_total int,
  fiche_id uuid, fiche_kind text, fiche_name text, fiche_status text,
  fiche_confirmed_at timestamptz, fiche_slots int,
  actions_30d int, last_action_at timestamptz,
  candidature_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  if p_id is null or not exists (select 1 from public.profiles p where p.id = p_id) then
    raise exception 'Membre introuvable.';
  end if;
  return query
    select
      p.id, p.display_name, u.email::text, p.role, p.is_owner,
      p.mod_depts,
      p.created_at, p.supporter_since,
      (select count(*)::int from public.events e where e.created_by = p.id),
      (select count(*)::int from public.events e
        where e.created_by = p.id and e.status = 'pending'),
      (select max(v.day) from public.app_visits v where v.user_id = p.id),
      p.account_type,
      (select count(*)::int from public.app_visits v
        where v.user_id = p.id and v.day >= current_date - 30),
      (select count(*)::int from public.events e
        where e.created_by = p.id and coalesce(e.ends_at, e.starts_at) >= now()),
      (select count(*)::int from public.events e
        where e.created_by = p.id and e.status = 'rejected'),
      exists (select 1 from public.push_subscriptions s where s.user_id = p.id),
      (select count(*)::int from public.feedback fb where fb.created_by = p.id),
      f.id, f.kind, f.name, f.status,
      f.last_confirmed_at,
      (select count(*)::int from public.food_truck_slots s where s.truck_id = f.id),
      (select count(*)::int from public.admin_actions a
        where a.actor_id = p.id and a.created_at >= now() - interval '30 days'),
      (select max(a.created_at) from public.admin_actions a where a.actor_id = p.id),
      (select r.status from public.moderator_requests r
        where r.user_id = p.id order by r.created_at desc limit 1)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.fiches f on f.owner_id = p.id
    where p.id = p_id;
end;
$$;

revoke execute on function public.member_profile(uuid) from public, anon;
grant execute on function public.member_profile(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- C. Supprimer un compte (propriétaire) — LES PHOTOS D'ABORD
-- -----------------------------------------------------------------------------
-- RÈGLE DE STOCKAGE : supprimer un compte en SQL ne libère pas le Storage. Le
-- client efface donc d'abord les fichiers du dossier `{id}/` par l'API Storage
-- (le propriétaire en a le droit, 0020), puis appelle `delete_member`, qui
-- REFUSE tant qu'un fichier reste : l'ordre ne peut pas être inversé.

/** Les fichiers d'un membre dans le bucket, pour les effacer avant le compte. */
create or replace function public.member_storage_paths(p_id uuid)
returns table (name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select o.name::text
      from storage.objects o
     where o.bucket_id = 'event-photos'
       and o.name like p_id::text || '/%';
end;
$$;

revoke execute on function public.member_storage_paths(uuid) from public, anon;
grant execute on function public.member_storage_paths(uuid) to authenticated;

create or replace function public.delete_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cible record;
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  if p_id = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte d''ici.';
  end if;
  select p.id, p.display_name, p.is_owner, p.account_type into cible
    from public.profiles p where p.id = p_id;
  if not found then
    raise exception 'Membre introuvable.';
  end if;
  if cible.is_owner then
    raise exception 'Le compte propriétaire ne peut pas être supprimé.';
  end if;
  if exists (select 1 from storage.objects o
              where o.bucket_id = 'event-photos' and o.name like p_id::text || '/%') then
    raise exception 'Des photos de ce compte restent à effacer : réessayez.';
  end if;

  -- Trace au journal, AVANT la suppression : le libellé est figé.
  insert into public.admin_actions (actor_id, action, target_kind, target_id, target_label, details)
  values (auth.uid(), 'member_delete', 'profile', p_id,
          coalesce(cible.display_name, '(sans nom)'),
          jsonb_build_object('type', cible.account_type));

  -- Le profil, ses événements, sa fiche, son planning, ses favoris… partent
  -- en cascade avec le compte.
  delete from auth.users where id = p_id;
end;
$$;

revoke execute on function public.delete_member(uuid) from public, anon;
grant execute on function public.delete_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- D. Messages : « traité », appareil et version
-- -----------------------------------------------------------------------------
alter table public.feedback
  add column if not exists handled_at timestamptz,
  add column if not exists app_version text,
  add column if not exists appareil text;

alter table public.feedback drop constraint if exists feedback_app_version_longueur;
alter table public.feedback
  add constraint feedback_app_version_longueur check (char_length(app_version) <= 40);
alter table public.feedback drop constraint if exists feedback_appareil_longueur;
alter table public.feedback
  add constraint feedback_appareil_longueur check (char_length(appareil) <= 120);

-- ⚠ PAR UNE FONCTION, comme mark_feedback_read (0030) : `feedback` n'a aucune
-- politique UPDATE, et en ouvrir une permettrait de réécrire un message.
create or replace function public.set_feedback_handled(p_id uuid, p_handled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  update public.feedback
     set handled_at = case when p_handled then now() else null end,
         read_at = coalesce(read_at, now())
   where id = p_id;
end;
$$;

revoke execute on function public.set_feedback_handled(uuid, boolean) from public, anon;
grant execute on function public.set_feedback_handled(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- E. Modérateurs : activité, couverture, candidatures en contexte
-- -----------------------------------------------------------------------------
drop function if exists public.list_admins();
create function public.list_admins()
returns table(
  id uuid, display_name text, email text, is_owner boolean, mod_depts text[],
  account_type text, member_since timestamptz, role_since timestamptz,
  actions_30d int, last_action_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select p.id, p.display_name, u.email::text, p.is_owner, p.mod_depts,
           p.account_type, p.created_at,
           (select max(a.created_at) from public.admin_actions a
             where a.target_id = p.id and a.action = 'role_change'
               and a.details ->> 'apres' = 'admin'),
           (select count(*)::int from public.admin_actions a
             where a.actor_id = p.id and a.created_at >= now() - interval '30 days'),
           (select max(a.created_at) from public.admin_actions a where a.actor_id = p.id)
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role = 'admin' or p.is_owner
     order by p.is_owner desc, p.display_name nulls last, u.email;
end;
$$;

revoke execute on function public.list_admins() from public, anon;
grant execute on function public.list_admins() to authenticated;

/** Ce qui attend, département par département (événements et fiches). */
create or replace function public.moderation_coverage()
returns table (dept text, events_pending int, fiches_pending int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    with ev as (
      select coalesce(e.dept, 'hors') as d, count(*)::int as n
        from public.events e where e.status = 'pending' group by 1
    ),
    fi as (
      select coalesce(f.dept, 'hors') as d, count(*)::int as n
        from public.fiches f where f.status = 'pending' group by 1
    )
    select coalesce(ev.d, fi.d), coalesce(ev.n, 0), coalesce(fi.n, 0)
      from ev full join fi on fi.d = ev.d;
end;
$$;

revoke execute on function public.moderation_coverage() from public, anon;
grant execute on function public.moderation_coverage() to authenticated;

drop function if exists public.list_moderator_requests();
create function public.list_moderator_requests()
returns table (
  id uuid, user_id uuid, display_name text, email text,
  depts text[], message text, status text,
  created_at timestamptz, decided_at timestamptz,
  role_actuel text, depts_actuels text[],
  account_type text, member_since timestamptz, events_total int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select r.id, r.user_id,
           coalesce(p.display_name, '(sans nom)'), u.email::text,
           r.depts, r.message, r.status, r.created_at, r.decided_at,
           p.role, p.mod_depts,
           p.account_type, p.created_at,
           (select count(*)::int from public.events e where e.created_by = p.id)
      from public.moderator_requests r
      join public.profiles p on p.id = r.user_id
      join auth.users u on u.id = r.user_id
     order by (r.status = 'pending') desc, r.created_at desc
     limit 100;
end;
$$;

revoke execute on function public.list_moderator_requests() from public, anon;
grant execute on function public.list_moderator_requests() to authenticated;

-- -----------------------------------------------------------------------------
-- F. Vérification — les huit doivent être vrais
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
select
  (select pg_get_functiondef('public.list_members'::regproc) like '%account_type%')
                                                                   as liste_avec_type,
  (select pg_get_functiondef('public.list_members'::regproc) not like '%email%')
                                                                   as liste_toujours_sans_email,
  (select pg_get_functiondef('public.member_profile'::regproc) like '%am_i_owner%')
                                                                   as fiche_au_proprietaire,
  (select pg_get_functiondef('public.delete_member'::regproc) like '%storage.objects%')
                                                                   as suppression_photos_d_abord,
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback'
      and column_name in ('handled_at', 'app_version', 'appareil'))  as messages_enrichis,
  (select pg_get_functiondef('public.list_admins'::regproc) like '%actions_30d%'
       or pg_get_functiondef('public.list_admins'::regproc) like '%interval%')
                                                                   as moderateurs_activite,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_coverage')  as couverture,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_moderator_requests') as candidatures;

-- =============================================================================
-- Fin de migration 0037
-- =============================================================================
