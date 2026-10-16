-- =============================================================================
-- Armana — Migration 0008 : durcissement suite au Security Advisor
-- =============================================================================
-- Réponses aux 19 warnings + 1 erreur du linter Supabase (captures 2026-07-14) :
--
-- A. « Public Bucket Allows Listing » : la politique SELECT publique sur
--    storage.objects permettait d'ÉNUMÉRER tous les fichiers du bucket.
--    L'affichage des photos passe par les URLs publiques (/object/public/…),
--    qui ne dépendent PAS de cette politique → on la supprime.
-- B. « Public/Signed-in can execute SECURITY DEFINER » : on révoque l'exécution
--    de tout ce qui n'a pas besoin d'être appelable :
--    - fonctions trigger (jamais appelées directement) : plus personne ;
--    - RPC admin : plus les anonymes (les connectés restent — la fonction
--      vérifie elle-même is_admin()) ;
--    - st_estimatedextent (interne PostGIS, jamais utilisée par l'app) : plus
--      personne (si la plateforme le permet).
--    ⚠ is_admin() DOIT rester exécutable par anon + authenticated : les
--    politiques RLS l'évaluent pour chaque requête. Elle ne fuit rien
--    (booléen). Les warnings résiduels sur is_admin sont à ACCEPTER.
-- C. spatial_ref_sys (ERROR « RLS Disabled ») : table appartenant à PostGIS.
--    On retente l'activation RLS ; à défaut on révoque l'accès API ; à défaut
--    l'alerte est à ACCEPTER (référentiel public de coordonnées, zéro donnée
--    personnelle).
-- =============================================================================

-- A) Bucket : suppression de la politique d'énumération publique.
drop policy if exists event_photos_read_public on storage.objects;

-- B) Fonctions trigger : exécution directe interdite à tous.
revoke execute on function public.guard_profile_role() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- RPC admin : retirées aux anonymes (gardées pour les connectés, garde interne).
revoke execute on function public.set_admin_by_email(text, boolean) from public, anon;
revoke execute on function public.list_admins() from public, anon;

-- is_admin : indispensable aux politiques RLS pour anon + authenticated.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- st_estimatedextent (PostGIS, toutes surcharges) : révocation best-effort.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'st_estimatedextent'
  loop
    begin
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
      raise notice 'revoke OK : %', f.sig;
    exception when others then
      raise notice 'revoke impossible sur % (%) — alerte à accepter', f.sig, sqlerrm;
    end;
  end loop;
end $$;

-- C) spatial_ref_sys : RLS si possible, sinon retrait de l'accès API, sinon accepter.
do $$
begin
  execute 'alter table public.spatial_ref_sys enable row level security';
  raise notice 'spatial_ref_sys : RLS activée.';
exception when others then
  begin
    execute 'revoke select on table public.spatial_ref_sys from anon, authenticated';
    raise notice 'spatial_ref_sys : RLS impossible, accès API révoqué.';
  exception when others then
    raise notice 'spatial_ref_sys : non modifiable (%) — alerte à accepter.', sqlerrm;
  end;
end $$;

-- =============================================================================
-- Fin de migration 0008
-- =============================================================================
