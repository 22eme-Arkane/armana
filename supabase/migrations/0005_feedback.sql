-- =============================================================================
-- Armana — Migration 0005 : messages « Nous contacter » (bug / avis)
-- =============================================================================
-- Les utilisateurs connectés envoient un message (signalement de bug ou avis) ;
-- seuls les admins peuvent les lire et les supprimer (boîte dans l'app).
-- =============================================================================

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  type       text not null check (type in ('bug', 'avis')),
  message    text not null check (length(message) between 3 and 4000),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy feedback_insert_auth
  on public.feedback for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy feedback_select_admin
  on public.feedback for select
  using (public.is_admin());

create policy feedback_delete_admin
  on public.feedback for delete
  using (public.is_admin());

grant select, insert, delete on public.feedback to authenticated;

-- =============================================================================
-- Fin de migration 0005
-- =============================================================================
