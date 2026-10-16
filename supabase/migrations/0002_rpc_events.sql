-- =============================================================================
-- Armana — Migration 0002 : RPC de création / mise à jour d'événements
-- =============================================================================
-- PostgREST ne sait pas insérer proprement une colonne geography depuis le client.
-- On passe donc par deux fonctions SECURITY INVOKER : la RLS de la table events
-- s'applique toujours (create = insert own/pending, update = own sans auto-approbation).
-- Le point est construit côté base à partir de (lat, lng) → aucun WKT côté navigateur.
-- =============================================================================

create or replace function public.create_event(
  p_title       text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_is_paid     boolean,
  p_price       numeric,
  p_lat         double precision,
  p_lng         double precision,
  p_address     text,
  p_category    text
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_row public.events;
begin
  insert into public.events (
    created_by, title, description, starts_at, ends_at,
    is_paid, price, location, address, category, status
  ) values (
    auth.uid(), p_title, nullif(p_description, ''), p_starts_at, p_ends_at,
    coalesce(p_is_paid, false),
    case when coalesce(p_is_paid, false) then p_price else null end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending'
  )
  returning * into new_row;
  return new_row;
end;
$$;

-- Mise à jour : l'auteur repasse l'événement en 'pending' (re-modération) ;
-- un admin conserve le statut courant.
create or replace function public.update_event(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_is_paid     boolean,
  p_price       numeric,
  p_lat         double precision,
  p_lng         double precision,
  p_address     text,
  p_category    text
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_row public.events;
begin
  update public.events set
    title       = p_title,
    description = nullif(p_description, ''),
    starts_at   = p_starts_at,
    ends_at     = p_ends_at,
    is_paid     = coalesce(p_is_paid, false),
    price       = case when coalesce(p_is_paid, false) then p_price else null end,
    location    = case when p_lat is null or p_lng is null then null
                       else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    address     = nullif(p_address, ''),
    category    = nullif(p_category, ''),
    status      = case when public.is_admin() then status else 'pending' end
  where id = p_id
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Événement introuvable ou non autorisé';
  end if;
  return updated_row;
end;
$$;

-- Accès RPC réservé aux utilisateurs connectés (la RLS insert/update s'applique).
grant execute on function public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric, double precision, double precision, text, text
) to authenticated;

grant execute on function public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric, double precision, double precision, text, text
) to authenticated;

-- =============================================================================
-- Fin de migration 0002
-- =============================================================================
