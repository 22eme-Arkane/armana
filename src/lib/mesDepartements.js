// Armana — départements que l'utilisateur souhaite voir.
//
// Préférence purement locale : elle tient à l'appareil, pas au compte, et n'a
// donc pas à passer par la base. Préfixe `rezo-` comme toutes les autres clés
// de l'application (voir la note dans lib/geo.js).
//
// ⚠ DEPUIS L'OUVERTURE À LA FRANCE (07/11/2026), IL N'Y A PLUS DE « TOUT ».
// Afficher les 96 départements par défaut noierait chacun sous des événements
// à 800 km de chez lui. Un nouvel appareil CHOISIT donc sa région au premier
// lancement (ui/choixRegion.js) ; on retient une liste explicite de codes.
import { CODES_DEPARTEMENTS, TERRITOIRE_HISTORIQUE } from './departements.js'

const CLE = 'rezo-depts'
const abonnes = new Set()

/**
 * L'appareil servait-il Armana AVANT l'ouverture à la France ?
 *
 * ⚠ LU AU CHARGEMENT DU MODULE, et c'est voulu : main.js pose
 * `armana-theme-reset` dès le premier lancement. Évalué ici, avant le corps de
 * main.js, le test voit l'état d'AVANT ce lancement. Toute clé `rezo-`,
 * `armana-` ou de session Supabase (`sb-`) trahit un appareil déjà servi.
 */
const A_CHOISIR = 'rezo-depts-a-choisir'
const ANCIEN_APPAREIL = (() => {
  try {
    // ⚠ Un appareil NEUF qui n'a pas encore choisi porte A_CHOISIR : sans
    // cette marque, il passerait pour ancien dès le lancement suivant (main.js
    // lui a entre-temps posé des clés `armana-`).
    if (localStorage.getItem(A_CHOISIR)) return false
    return Object.keys(localStorage).some((k) => /^(rezo-|armana-|sb-)/.test(k))
  } catch {
    return false
  }
})()

/**
 * Valeurs d'AVANT l'ouverture à la France qui voulaient dire « tout le
 * territoire » : `*`, et les listes complètes de l'époque. Elles valent
 * désormais PACA + la Drôme, exactement ce que ces personnes voyaient.
 */
const ANCIENNES_LISTES_COMPLETES = [
  ['04', '05', '84'], // avant l'ouverture à PACA
  ['04', '05', '06', '13', '83', '84'], // PACA, avant l'ajout de la Drôme
]

function estUneAncienneListeComplete(codes) {
  return ANCIENNES_LISTES_COMPLETES.some(
    (ref) => ref.length === codes.length && ref.every((c) => codes.includes(c))
  )
}

/**
 * Marque « liste au format France » : posée une fois l'ancienne valeur
 * convertie, ou dès qu'on enregistre un choix.
 *
 * ⚠ LA CONVERSION NE SE FAIT QU'UNE FOIS. Relue à chaque lecture, elle prenait
 * un choix NEUF de PACA seule (04 05 06 13 83 84) pour l'ancienne liste
 * « tout le territoire » identique, et lui rajoutait la Drôme d'office (vu
 * le 08/11/2026).
 */
const FORMAT = 'rezo-depts-format'

function convertirUneFois() {
  try {
    if (localStorage.getItem(FORMAT) === 'france') return
    const brut = JSON.parse(localStorage.getItem(CLE) || 'null')
    if (brut === '*' || (Array.isArray(brut) && estUneAncienneListeComplete(brut))) {
      localStorage.setItem(CLE, JSON.stringify(TERRITOIRE_HISTORIQUE))
    }
    localStorage.setItem(FORMAT, 'france')
  } catch {
    /* stockage indisponible */
  }
}
convertirUneFois()

/** La liste enregistrée ; null si aucune. */
function lire() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || 'null')
    if (Array.isArray(brut)) {
      const propre = brut.filter((c) => CODES_DEPARTEMENTS.includes(c))
      if (propre.length) return propre
    }
    return null
  } catch {
    return null
  }
}

// Rien d'enregistré sur un appareil d'avant : il voyait tout le territoire de
// l'époque, il le garde, sans écran de choix (décision de Matthieu). Un
// appareil neuf, lui, reçoit la marque A_CHOISIR jusqu'à son choix.
if (lire() === null) {
  try {
    if (ANCIEN_APPAREIL) localStorage.setItem(CLE, JSON.stringify(TERRITOIRE_HISTORIQUE))
    else localStorage.setItem(A_CHOISIR, '1')
  } catch {
    /* stockage indisponible */
  }
}

/** Vrai quand le territoire a été choisi (ou hérité d'avant la France). */
export function territoireChoisi() {
  return lire() !== null
}

/**
 * Les départements affichés. Tant que rien n'est choisi, PACA et la Drôme —
 * le temps que l'écran de choix de région s'affiche par-dessus.
 */
export function getMesDepartements() {
  return lire() ?? [...TERRITOIRE_HISTORIQUE]
}

export function setMesDepartements(codes) {
  const propre = [...new Set((codes ?? []).filter((c) => CODES_DEPARTEMENTS.includes(c)))]
  // On refuse de tout décocher : l'écran ne le propose pas, mais un appel
  // direct ne doit pas pouvoir laisser l'application vide.
  const retenus = propre.length ? propre : getMesDepartements()
  try {
    localStorage.setItem(CLE, JSON.stringify(retenus))
    localStorage.removeItem(A_CHOISIR)
  } catch {
    /* stockage indisponible : le choix ne survivra pas, sans plus */
  }
  for (const fn of abonnes) fn(retenus)
  return retenus
}

export function onMesDepartementsChange(fn) {
  abonnes.add(fn)
  return () => abonnes.delete(fn)
}
