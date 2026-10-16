-- =============================================================================
-- Armana — Migration 0003 : gestion des administrateurs par e-mail
-- =============================================================================
-- Un admin peut désigner / retirer d'autres admins par e-mail. Les e-mails vivent
-- dans auth.users (privés) → on passe par des fonctions SECURITY DEFINER qui :
--   1) vérifient que l'appelant est admin (is_admin(), basé sur auth.uid()) ;
--   2) recherchent le compte par e-mail dans auth.users (accessible au propriétaire) ;
-- sans jamais exposer les e-mails au client non-admin.
--
-- ⚠ Le PREMIER admin se désigne à la main (voir README) ; ensuite tout se fait ici.
-- =============================================================================

-- Désigner / retirer un admin par e-mail. Renvoie la ligne profil mise à jour.
create or replace function public.set_admin_by_email(target_email text, make_admin boolean)
returns table(id uuid, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
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

  -- Anti-verrouillage : un admin ne peut pas se retirer lui-même son rôle ici.
  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle d''administrateur.';
  end if;

  insert into public.profiles (id, role)
  values (target_id, case when make_admin then 'admin' else 'user' end)
  on conflict (id) do update set role = excluded.role;

  return query
    select p.id, p.display_name, p.role from public.profiles p where p.id = target_id;
end;
$$;

-- Lister les admins (nom + e-mail) — réservé aux admins.
create or replace function public.list_admins()
returns table(id uuid, display_name text, email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  return query
    select p.id, p.display_name, u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'admin'
    order by p.display_name nulls last, u.email;
end;
$$;

grant execute on function public.set_admin_by_email(text, boolean) to authenticated;
grant execute on function public.list_admins() to authenticated;

-- =============================================================================
-- Fin de migration 0003
-- =============================================================================
