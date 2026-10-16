-- =============================================================================
-- Armana — Migration 0004 : correctif du garde-fou de rôle
-- =============================================================================
-- Le trigger anti-escalade (0001) bloquait TOUT changement de rôle quand
-- l'appelant n'est pas admin — y compris depuis le SQL Editor (aucun utilisateur
-- authentifié → auth.uid() est NULL), rendant impossible la désignation du
-- PREMIER administrateur.
--
-- Correctif : le garde ne s'applique qu'aux requêtes CLIENT authentifiées
-- (auth.uid() non NULL). Les contextes serveur (SQL Editor, service_role,
-- Edge Functions) passent. Les clients anonymes restent bloqués par la RLS
-- (aucune politique UPDATE ne matche sans auth.uid()).
-- =============================================================================

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Changement de rôle interdit';
  end if;
  return new;
end;
$$;

-- =============================================================================
-- Fin de migration 0004
-- =============================================================================
