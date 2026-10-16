-- =============================================================================
-- Armana — Migration 0007 : corrections Security Advisor Supabase
-- =============================================================================
-- Réponse aux alertes du scan hebdomadaire (« security vulnerabilities detected ») :
--
-- 1. function_search_path_mutable : events_within_radius n'avait pas de
--    search_path figé (risque d'injection de schéma) — les autres fonctions
--    l'avaient déjà. → SET search_path.
-- 2. security_definer_view : events_geo doit être en security_invoker
--    (déjà le cas normalement — re-forcé, idempotent).
-- 3. rls_disabled_in_public sur spatial_ref_sys : table de référence installée
--    par PostGIS sans RLS. On tente de l'activer ; si la plateforme refuse
--    (table appartenant à l'extension), l'alerte est à marquer « accepté » :
--    c'est une table publique de systèmes de coordonnées, sans donnée perso.
--
-- Alerte restante NON corrigeable ici : « extension_in_public » (PostGIS installé
-- dans le schéma public). PostGIS n'est pas déplaçable après installation
-- (non-relocatable) — alerte à marquer « accepté » dans le dashboard.
-- =============================================================================

-- 1) Figer le search_path de la fonction de recherche par rayon.
create or replace function public.events_within_radius(lat float, lng float, radius_m float)
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

-- 2) (Re)forcer la vue en security_invoker — idempotent.
alter view public.events_geo set (security_invoker = on);

-- 3) RLS sur la table de référence PostGIS (ignoré proprement si non permis).
do $$
begin
  execute 'alter table public.spatial_ref_sys enable row level security';
  execute 'drop policy if exists spatial_ref_sys_read on public.spatial_ref_sys';
  execute 'create policy spatial_ref_sys_read on public.spatial_ref_sys for select using (true)';
  raise notice 'spatial_ref_sys : RLS activée.';
exception when others then
  raise notice 'spatial_ref_sys : % — alerte à marquer « accepté » (table de référence PostGIS, aucune donnée personnelle).', sqlerrm;
end $$;

-- =============================================================================
-- Fin de migration 0007
-- =============================================================================
