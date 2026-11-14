// Armana — les UNIVERS : Culture, Ateliers, Vie locale (14/11/2026).
//
// Deux retours d'utilisateurs rapportés par Matthieu : les ateliers de
// bien-être noyaient l'agenda culturel, et les associations (yoga, club de
// foot) n'y trouvaient pas leur place. Plutôt qu'un nouvel onglet — la barre
// est pleine, et un agenda coupé en trois paraîtrait vide —, l'Agenda et la
// Carte montrent UN univers à la fois, Culture par défaut ; les deux autres
// sont à un appui.
//
// ⚠ L'UNIVERS N'EST PAS STOCKÉ : il se déduit de la catégorie. Aucune colonne,
// aucune migration — et un événement qu'on reclasse change d'univers du même
// coup. Une catégorie inconnue (ancienne, mal saisie) tombe en Culture.
//
// Marché et Vide-grenier passent en Vie locale (décision de Matthieu). Un
// marché qui accueille un concert se range en Culture, sous « Musique » : le
// formulaire de publication le rappelle.
//
// « ATELIERS », ET NON « BIEN-ÊTRE » (Matthieu, 14/11/2026) : le premier nom
// était trop restreint — il y a des ateliers d'autre chose que du bien-être.
// Culture rassemble ce qu'on vient VOIR ou écouter ; Ateliers, ce qu'on vient
// FAIRE soi-même : yoga, méditation, peinture, écriture, stages. D'où la
// catégorie « Atelier », qui quitte Culture pour cet univers — avec elle, sans
// rien changer en base, le Jeu de Peindre ou le stage de crayons de couleur.

export const UNIVERS = [
  {
    cle: 'culture',
    nom: 'Culture',
    categories: [
      'Musique',
      'Spectacles vivants',
      'Danse',
      'Théâtre',
      'Exposition',
      'Cinéma',
      'Festival',
      'Conférence',
      'Autre',
    ],
  },
  // ⚠ DES NOMS COURTS : la catégorie s'écrit en capitales dans la colonne
  // étroite des cartes de l'Agenda, et au-delà d'une douzaine de lettres elle
  // est coupée (« VIE ASSOCI… », premier essai du 14/11/2026).
  {
    cle: 'ateliers',
    nom: 'Ateliers',
    categories: ['Atelier', 'Yoga', 'Méditation', 'Bien-être', 'Stage'],
  },
  {
    cle: 'vie-locale',
    nom: 'Vie locale',
    categories: ['Marché', 'Vide-grenier', 'Sport', 'Fête & loto', 'Nature', 'Solidarité'],
  },
]

export const UNIVERS_PAR_DEFAUT = 'culture'

const parCategorie = new Map(UNIVERS.flatMap((u) => u.categories.map((c) => [c, u.cle])))

/** L'univers d'une catégorie (Culture si elle est inconnue). */
export function universDe(categorie) {
  return parCategorie.get(categorie) ?? UNIVERS_PAR_DEFAUT
}

export function categoriesDe(cle) {
  return UNIVERS.find((u) => u.cle === cle)?.categories ?? []
}

export function nomUnivers(cle) {
  return UNIVERS.find((u) => u.cle === cle)?.nom ?? cle
}

// Sur les CARTES de l'Agenda, la colonne du style ne fait que ~85 px à 360 px :
// « Spectacles vivants » y finissait en « SPECTACLES… ». La carte dit le mot
// court ; le panneau de filtres et la fiche gardent le nom entier.
const LIBELLES_COURTS = { 'Spectacles vivants': 'Spectacles' }

export function libelleCourt(categorie) {
  return LIBELLES_COURTS[categorie] ?? categorie
}

/** Toutes les catégories, univers par univers. */
export const TOUTES_CATEGORIES = UNIVERS.flatMap((u) => u.categories)

/**
 * Le reclassement des événements déjà publiés, relevé le 14/11/2026 sur les
 * vraies données (titre ET description lus). La migration 0041 applique
 * exactement cette liste ; la démonstration (`?demo=1`) l'applique à
 * l'affichage, pour juger avant. Les marchés et vide-greniers n'y sont pas :
 * ils changent d'univers d'eux-mêmes.
 */
export const RECLASSEMENT_0041 = {
  // Ateliers
  '4c907dbe-927f-464d-872b-f8ed47b2d3e2': 'Bien-être', // Atelier de développement personnel
  '6a72281f-c1a6-4a58-86cd-e217936dbad0': 'Méditation', // Soirée Om Chanting
  'c13b29a6-5c8b-44ed-bd07-7f077ceeeeaf': 'Bien-être', // Travailler son ancrage
  '7a89e2ce-41cc-4477-b861-e8353e035aa6': 'Bien-être', // Club de lectures lumineuses
  '8c966220-4741-43a0-9cf7-864640368d00': 'Stage', // Stage « Les arbres du chant »
  '3afc52d3-f388-40e9-adae-1490c3b6c2e8': 'Atelier', // ARPENTAGE (lecture collective, sur inscription)
  // Vie locale
  '756e8b16-28af-44e7-b0eb-2672875d79e9': 'Solidarité', // Journée solidaire La montagne d'Auré
  'c998d708-073b-46a3-8127-820e8f0774c2': 'Nature', // Cueillette de champignons
  'fc500893-b097-4b6c-b44d-d3ae8df56773': 'Fête & loto', // Loto de l'école d'Ongles
}
