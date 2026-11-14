-- =============================================================================
-- Armana — migration 0041 : les associations, et le reclassement des univers
-- =============================================================================
-- À exécuter dans Supabase → SQL Editor, d'un seul bloc. Rejouable sans risque.
--
-- Demande de Matthieu (14/11/2026), après deux retours d'utilisateurs : les
-- ateliers de bien-être noyaient l'agenda culturel, et les associations (une
-- asso de yoga, un club de foot) n'y trouvaient pas leur place.
--
--   A. Un 4e TYPE DE COMPTE, « association ». Comme les autres, il ne donne
--      AUCUN droit : il ouvre seulement la possibilité d'une fiche.
--   B. Un 4e TYPE DE FICHE, « association », avec son DOMAINE (sport,
--      bien-être…), choisi dans une liste fermée — jamais tapé.
--   C. Le RECLASSEMENT de neuf événements déjà publiés dans les nouvelles
--      catégories (relevés un par un, titre et description lus).
--   D. Le TYPE DE COMPTE de seize membres (lieux culturels, associations),
--      restés « particulier » — liste de Matthieu.
--
-- Les UNIVERS eux-mêmes (Culture, Ateliers, Vie locale) n'ont besoin de rien
-- en base : l'univers se déduit de la catégorie, côté application
-- (src/lib/univers.js). `events.category` est un texte libre, sans contrainte.
--
-- Rien n'est supprimé. Aucune politique RLS n'est touchée : une fiche
-- d'association suit exactement les règles des autres fiches (en attente à la
-- création, relue par le modérateur de son département, publique une fois
-- validée — trigger `fiches_avant_ecriture` et politiques de la 0033).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Le type de compte « association »
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_account_type_valide;
alter table public.profiles
  add constraint profiles_account_type_valide
  check (account_type in ('particulier', 'lieu', 'food_truck', 'association'));

comment on column public.profiles.account_type is
  'Particulier, lieu culturel, food truck ou association. Choisi et modifié par '
  'l''utilisateur lui-même ; ne donne AUCUN droit (les droits sont dans role).';

-- -----------------------------------------------------------------------------
-- B. La fiche d'association, et son domaine
-- -----------------------------------------------------------------------------
-- La contrainte d'origine (0033) est anonyme dans le script : Postgres l'a
-- nommée lui-même. On la retrouve par son contenu plutôt que par son nom.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.fiches'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
       and pg_get_constraintdef(oid) like '%food_truck%'
  loop
    execute format('alter table public.fiches drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.fiches
  add constraint fiches_kind_valide
  check (kind in ('lieu', 'food_truck', 'association'));

alter table public.fiches add column if not exists domaine text;
alter table public.fiches drop constraint if exists fiches_domaine_valide;
-- La même liste que DOMAINES (src/lib/fiches.js) : une valeur hors liste est
-- refusée, quoi qu'envoie le client.
alter table public.fiches
  add constraint fiches_domaine_valide
  check (domaine is null or domaine in (
    'Sport', 'Bien-être', 'Culture & arts', 'Solidarité',
    'Environnement', 'Enfance & jeunesse', 'Loisirs'
  ));

comment on column public.fiches.domaine is
  'Association seulement : son domaine d''activité, choisi dans une liste fermée.';

-- -----------------------------------------------------------------------------
-- C. Reclassement des événements déjà publiés (relevé du 14/11/2026)
-- -----------------------------------------------------------------------------
-- La même liste que RECLASSEMENT_0041 (src/lib/univers.js). Seule la catégorie
-- change : ni le statut, ni l'auteur, ni les dates. Les marchés et les
-- vide-greniers ne sont pas listés : ils passent en Vie locale d'eux-mêmes.
update public.events as e
   set category = r.categorie
  from (values
    ('4c907dbe-927f-464d-872b-f8ed47b2d3e2'::uuid, 'Bien-être'),   -- Atelier de développement personnel
    ('6a72281f-c1a6-4a58-86cd-e217936dbad0'::uuid, 'Méditation'),  -- Soirée Om Chanting
    ('c13b29a6-5c8b-44ed-bd07-7f077ceeeeaf'::uuid, 'Bien-être'),   -- Travailler son ancrage
    ('7a89e2ce-41cc-4477-b861-e8353e035aa6'::uuid, 'Bien-être'),   -- Club de lectures lumineuses
    ('8c966220-4741-43a0-9cf7-864640368d00'::uuid, 'Stage'),       -- Stage « Les arbres du chant »
    ('3afc52d3-f388-40e9-adae-1490c3b6c2e8'::uuid, 'Atelier'),     -- ARPENTAGE (lecture collective)
    ('756e8b16-28af-44e7-b0eb-2672875d79e9'::uuid, 'Solidarité'),  -- Journée solidaire La montagne d'Auré
    ('c998d708-073b-46a3-8127-820e8f0774c2'::uuid, 'Nature'),      -- Cueillette de champignons
    ('fc500893-b097-4b6c-b44d-d3ae8df56773'::uuid, 'Fête & loto')  -- Loto de l'école d'Ongles
  ) as r(id, categorie)
 where e.id = r.id
   and e.category is distinct from r.categorie;

-- -----------------------------------------------------------------------------
-- D. Le type de compte de seize membres (demande de Matthieu, 14/11/2026)
-- -----------------------------------------------------------------------------
-- Ces comptes publient pour un lieu ou une association, mais étaient restés
-- « particulier ». Identifiants relevés un par un d'après leur nom affiché.
-- Les deux COMITÉS DES FÊTES (CCRC de Digne, CDF de Saint-Michel) passent en
-- association : un comité des fêtes en est une, il n'a pas de salle à lui.
-- Rien d'autre ne change : le type ne donne aucun droit (voir 0033).
update public.profiles as p
   set account_type = r.type
  from (values
    ('8cd85800-5030-4f17-93bf-55098747a7ef'::uuid, 'association'), -- Le Local
    ('39840beb-ed8b-4dee-beeb-f80ff717e7d5'::uuid, 'lieu'),        -- Architectstore
    ('76d62240-ea0e-4231-8dcb-2d4df6ab760e'::uuid, 'association'), -- CCRC - ville de Digne-les-Bains (comité des fêtes)
    ('f64fc273-a7fb-45ca-bc88-7a4244d82c1a'::uuid, 'lieu'),        -- Salagon
    ('fb5e7f96-828e-4f8e-bb00-eaa8ab60632e'::uuid, 'lieu'),        -- Médiathèques DLVA
    ('129e22ba-a5a8-41d3-a7a4-cc2b53516939'::uuid, 'lieu'),        -- LE HANGAR
    ('0d47dbc1-6eee-447f-a6bc-07d3e5d1f433'::uuid, 'lieu'),        -- L'antidote bar
    ('f812b63b-34f7-4cd6-8ee3-14cabef9db89'::uuid, 'lieu'),        -- La Capsule MJC
    ('d7d1b0d1-9aa4-4166-be61-e871176bd726'::uuid, 'lieu'),        -- Centre Astro
    ('c63fa122-8bb0-4f21-800d-74825c5184a0'::uuid, 'association'), -- Association Chrysalis
    ('d3457cb2-e4b0-4f9f-9a83-12c8e6e25884'::uuid, 'association'), -- Association Sowilo
    ('40a98161-5ae2-4e66-b09d-e324c0b0b1cc'::uuid, 'lieu'),        -- La bifurK
    ('2c55a658-9450-4f6b-8d12-5d3606db3305'::uuid, 'lieu'),        -- Montjustin à dos d'éléphant
    ('64304686-11c0-4320-af66-b06378c0f2c7'::uuid, 'association'), -- Made in Vachères
    ('bc8ae54b-4dcd-49dc-b927-135805c152ba'::uuid, 'association'), -- CDF saint Michel Observatoire (comité des fêtes)
    ('db2c5a8b-b82f-45aa-afd4-9078a61c75bd'::uuid, 'association')  -- Perséphonic
  ) as r(id, type)
 where p.id = r.id
   and p.account_type is distinct from r.type;

-- L'API relit le schéma (nouvelle colonne).
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Vérification — les quatre premières colonnes doivent être VRAIES
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
-- `reclasses` : les événements de la liste encore en base (ceux d'un mois
-- révolu ont pu être purgés entre-temps — le chiffre peut être inférieur à 7).
select
  (select pg_get_constraintdef(oid) like '%association%' from pg_constraint
    where conname = 'profiles_account_type_valide')                    as type_association,
  (select pg_get_constraintdef(oid) like '%association%' from pg_constraint
    where conname = 'fiches_kind_valide')                              as fiche_association,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'fiches' and column_name = 'domaine')
                                                                       as colonne_domaine,
  (select count(*) from pg_constraint
    where conrelid = 'public.fiches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
      and pg_get_constraintdef(oid) like '%food_truck%') = 1           as une_seule_regle_de_type,
  (select count(*) from public.events
    where category in ('Bien-être', 'Méditation', 'Stage', 'Solidarité', 'Nature', 'Fête & loto')
       or id = '3afc52d3-f388-40e9-adae-1490c3b6c2e8')                 as reclasses,
  (select count(*) from public.profiles where account_type = 'association') as comptes_association,
  (select count(*) from public.profiles where account_type = 'lieu')        as comptes_lieu;

-- =============================================================================
-- Fin de migration 0041
-- =============================================================================
