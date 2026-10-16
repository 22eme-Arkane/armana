-- =============================================================================
-- Armana — Migration 0006 : correctif « column reference id is ambiguous »
-- =============================================================================
-- Dans set_admin_by_email (0003), les colonnes de sortie (id, display_name, role)
-- entrent en conflit avec les colonnes de la table dans ON CONFLICT (id) →
-- PL/pgSQL lève « column reference "id" is ambiguous ». Le pragma
-- #variable_conflict use_column résout l'ambiguïté en faveur des colonnes.
-- =============================================================================

create or replace function public.set_admin_by_email(target_email text, make_admin boolean)
returns table(id uuid, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  target_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'Aucun compte avec cet e-mail (la personne doit d''abord créer son compte).';
  end if;

  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle d''administrateur.';
  end if;

  -- ON CONFLICT vise la contrainte PAR SON NOM (pas la colonne id) : aucune
  -- ambiguïté possible avec le paramètre de sortie « id ».
  insert into public.profiles as p (id, role)
  values (target_id, case when make_admin then 'admin' else 'user' end)
  on conflict on constraint profiles_pkey do update set role = excluded.role;

  return query
    select p.id, p.display_name, p.role from public.profiles p where p.id = target_id;
end;
$$;

-- =============================================================================
-- Fin de migration 0006
-- =============================================================================
