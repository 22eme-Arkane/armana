-- =============================================================================
-- Armana — migration 0042 : une fiche pour chaque compte « association »
-- =============================================================================
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Rejouable sans risque :
-- un compte qui a déjà sa fiche n'est pas touché.
--
-- Constat de Matthieu (14/11/2026) : les membres passés en « association » par
-- la 0041 n'apparaissent pas dans l'annuaire. Normal : l'annuaire liste des
-- FICHES, et changer un type de compte n'en crée aucune. Il n'en existait pas
-- une seule.
--
-- Décision de Matthieu : leur créer une fiche, MINIMALE, publiée d'emblée —
--   · le NOM du compte ;
--   · l'EMPLACEMENT de son dernier événement (de préférence publié), qui range
--     la fiche dans sa région et son département (le trigger recalcule `dept`) ;
--   · sa COMMUNE pour adresse (« Où : Vachères ») — jamais l'adresse complète
--     d'un événement, qui ferait passer une salle de passage pour son siège.
-- La page de la fiche montre déjà les prochains rendez-vous de l'association.
-- Le reste — photo, présentation, domaine — c'est à elle de le remplir : un
-- bandeau l'y invite dans son Profil. Toute retouche de sa part repasse en
-- relecture, comme pour n'importe quelle fiche (trigger de la 0034).
--
-- Un compte qui n'a JAMAIS publié n'a pas d'emplacement connu : pas de fiche
-- ici, le bandeau du Profil l'invite à la créer lui-même.
--
-- Pourquoi rien ne bloque : dans le SQL Editor, `auth.uid()` est nul — le
-- trigger `fiches_avant_ecriture` calcule le département puis laisse passer
-- (contexte serveur), et une fiche publiée ne prévient aucun modérateur
-- (`fiches_apres_creation` ne le fait que pour une fiche en attente).
-- Aucune politique RLS n'est touchée.
-- =============================================================================

insert into public.fiches (owner_id, kind, name, address, location, status, reviewed_at)
select p.id,
       'association',
       left(btrim(p.display_name), 80),
       dernier.commune,
       dernier.location,
       'approved',
       now()
  from public.profiles as p
  cross join lateral (
    select e.location,
           -- La commune choisie à la publication (0035), sinon celle qui suit
           -- le code postal dans l'adresse (« …, 04300 Mane » → « Mane »).
           coalesce(
             nullif(btrim(e.city), ''),
             nullif(btrim(substring(e.address from '\d{5}\s+([^,]+)')), '')
           ) as commune
      from public.events as e
     where e.created_by = p.id
       and e.location is not null
     order by (e.status = 'approved') desc, e.starts_at desc
     limit 1
  ) as dernier
 where p.account_type = 'association'
   and char_length(btrim(coalesce(p.display_name, ''))) >= 2
   and not exists (select 1 from public.fiches as f where f.owner_id = p.id);

-- -----------------------------------------------------------------------------
-- Vérification — une ligne par compte « association »
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
-- `fiche` = approved : la fiche existe et paraît dans l'annuaire, sous le
-- département indiqué. `fiche` = aucune : ce compte n'a jamais publié
-- d'événement — c'est le bandeau du Profil qui l'invitera à la créer.
select p.display_name                                   as association,
       coalesce(f.status, 'aucune')                     as fiche,
       f.dept                                           as departement,
       f.address                                        as commune
  from public.profiles as p
  left join public.fiches as f on f.owner_id = p.id
 where p.account_type = 'association'
 order by f.status nulls last, p.display_name;

-- =============================================================================
-- Fin de migration 0042
-- =============================================================================
