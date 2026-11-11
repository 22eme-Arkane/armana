-- =============================================================================
-- Armana — migration 0040 : le journal des actions, lisible et complet
-- =============================================================================
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Rejouable sans risque.
--
-- Trois changements, tous autour de `admin_actions` (migration 0012) :
--
--   A. LECTURE. `list_admin_actions` rendait les 200 dernières lignes, sans
--      identifiant : impossible de remonter plus loin, de ne voir qu'un
--      modérateur, ou d'ouvrir l'événement dont parle une ligne. Elle accepte
--      désormais un curseur (« les actes plus anciens que celui-ci ») et trois
--      filtres appliqués EN BASE — auteur, types d'acte, texte cherché —, et
--      renvoie les identifiants de l'auteur et de la cible.
--      Toujours réservée au propriétaire.
--
--   B. FICHES. Valider ou refuser la fiche d'un lieu ou d'un food truck est une
--      décision de modération comme une autre ; elle n'était pas journalisée.
--
--   C. CANDIDATURES. Accepter laissait déjà une trace (le changement de rôle) ;
--      refuser n'en laissait aucune.
--
-- Rien n'est supprimé. Aucune politique RLS n'est touchée : la table reste
-- sans politique — personne n'y lit ni n'y écrit directement, seuls les
-- triggers et les fonctions ci-dessous (SECURITY DEFINER) y passent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Lecture paginée et filtrée — propriétaire uniquement
-- -----------------------------------------------------------------------------
-- Le type de retour change : il faut retirer l'ancienne avant de recréer.
-- (L'ancienne application, qui n'envoie que `max_rows`, continue de marcher :
-- les autres paramètres ont une valeur par défaut.)
drop function if exists public.list_admin_actions(int);
drop function if exists public.list_admin_actions(int, bigint, uuid, text[], text);

create function public.list_admin_actions(
  max_rows  int    default 100,
  p_before  bigint default null,   -- les actes plus anciens que cet identifiant
  p_actor   uuid   default null,   -- un seul auteur
  p_actions text[] default null,   -- les types d'acte retenus
  p_search  text   default null    -- dans le nom de la cible (sans casse ni accents)
)
returns table (
  id           bigint,
  created_at   timestamptz,
  actor_id     uuid,
  actor_name   text,
  action       text,
  target_kind  text,
  target_id    uuid,
  target_label text,
  details      jsonb
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  cle text := public.nom_cle(p_search);   -- NULL si rien d'utile n'est cherché
begin
  -- Volontairement PAS is_admin() : le journal sert justement à départager les
  -- modérateurs entre eux.
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire du projet';
  end if;

  return query
    select a.id, a.created_at, a.actor_id,
           coalesce(pa.display_name, '(compte supprimé)')::text,
           a.action, a.target_kind, a.target_id, a.target_label, a.details
    from public.admin_actions a
    left join public.profiles pa on pa.id = a.actor_id
    where (p_before is null or a.id < p_before)
      and (p_actor is null or a.actor_id = p_actor)
      and (p_actions is null or a.action = any (p_actions))
      and (cle is null or position(cle in coalesce(public.nom_cle(a.target_label), '')) > 0)
    -- Par identifiant, pas par date : deux actes d'une même transaction ont la
    -- même date à la microseconde, et un curseur sur la date en sauterait un.
    order by a.id desc
    limit greatest(1, least(coalesce(max_rows, 100), 500));
end;
$$;

revoke execute on function public.list_admin_actions(int, bigint, uuid, text[], text) from public, anon;
grant execute on function public.list_admin_actions(int, bigint, uuid, text[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- B. Les décisions sur les fiches entrent au journal
-- -----------------------------------------------------------------------------
-- Même règle que pour les événements (0012) : on ne note que la décision de
-- QUELQU'UN D'AUTRE. Un propriétaire de fiche qui la retouche la renvoie
-- lui-même en relecture (trigger fiches_avant_ecriture) : ce n'est pas un acte
-- de modération, et cela n'encombre pas le journal.
create or replace function public.log_fiche_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- contexte serveur : hors journal
  end if;

  if new.status is distinct from old.status
     and auth.uid() is distinct from new.owner_id then
    insert into public.admin_actions
      (actor_id, action, target_kind, target_id, target_label, details)
    values
      (auth.uid(), 'fiche_status', 'fiche', new.id, new.name,
       jsonb_build_object('avant', old.status, 'apres', new.status, 'kind', new.kind));
  end if;

  return new;
end;
$$;

revoke execute on function public.log_fiche_admin_action() from public, anon, authenticated;

drop trigger if exists log_fiche_admin_action_trg on public.fiches;
create trigger log_fiche_admin_action_trg
  after update on public.fiches
  for each row execute function public.log_fiche_admin_action();

-- -----------------------------------------------------------------------------
-- C. Un refus de candidature laisse une trace
-- -----------------------------------------------------------------------------
-- Identique à la version de la 0020, plus la ligne de journal du refus.
-- (Une acceptation est déjà notée par le trigger des profils : changement de
-- rôle et de zone.)
create or replace function public.decide_moderator_request(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  demande record;
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;

  select * into demande
  from public.moderator_requests
  where id = p_id and status = 'pending'
  for update;
  if demande is null then
    raise exception 'Candidature introuvable ou déjà tranchée.';
  end if;

  if p_accept then
    update public.profiles p
       set role = 'admin',
           mod_depts = (
             select array_agg(distinct d order by d)
             from unnest(coalesce(p.mod_depts, array[]::text[]) || demande.depts) as d
           )
     where p.id = demande.user_id;
  else
    insert into public.admin_actions
      (actor_id, action, target_kind, target_id, target_label, details)
    select auth.uid(), 'request_refused', 'profile', p.id,
           coalesce(p.display_name, '(sans nom)'),
           jsonb_build_object('depts', to_jsonb(demande.depts))
    from public.profiles p
    where p.id = demande.user_id;
  end if;

  update public.moderator_requests
     set status = case when p_accept then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_id;
end;
$$;

revoke execute on function public.decide_moderator_request(uuid, boolean) from public, anon;
grant execute on function public.decide_moderator_request(uuid, boolean) to authenticated;

-- L'API relit la liste des fonctions (la signature de la première a changé).
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Vérification — les cinq premières colonnes doivent être VRAIES
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
select
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'list_admin_actions' and p.pronargs = 5)
                                                                    as journal_pagine,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_admin_actions') = 1
                                                                    as une_seule_version,
  not has_function_privilege('anon',
        'public.list_admin_actions(int, bigint, uuid, text[], text)', 'execute')
                                                                    as ferme_aux_anonymes,
  exists (select 1 from pg_trigger t
           where t.tgname = 'log_fiche_admin_action_trg' and not t.tgisinternal)
                                                                    as fiches_journalisees,
  (select p.prosrc like '%request_refused%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'decide_moderator_request')
                                                                    as refus_journalises,
  (select count(*) from public.admin_actions)                       as actes_au_journal;

-- =============================================================================
-- Fin de migration 0040
-- =============================================================================
