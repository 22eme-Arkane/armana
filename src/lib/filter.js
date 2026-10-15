// Armana — état de filtre partagé entre l'Agenda et la Carte.
//
// ⚠ RIEN N'EST CONSERVÉ D'UNE OUVERTURE À L'AUTRE, ET C'EST VOULU.
// Un filtre oublié vide l'agenda sans rien expliquer : quelqu'un coche
// « Théâtre » en septembre, rouvre en novembre, voit trois événements et en
// conclut qu'Armana est morte. Tout repart donc à zéro au lancement.
// LES DÉPARTEMENTS ONT DEUX COUCHES : le choix DURABLE de Profil, enregistré
// dans `mesDepartements.js` (on n'habite pas ailleurs d'un jour sur l'autre),
// et une RETOUCHE temporaire faite depuis le panneau, qui ne l'écrase pas et
// disparaît au prochain lancement comme le reste.
//
// ⚠ UN SEUL ÉTAT, DEUX FAÇONS D'Y TOUCHER : la rangée de styles visible dans
// l'en-tête et le panneau de filtres commandent LE MÊME ensemble. Deux états
// séparés finiraient immanquablement par se contredire, et la rangée
// mentirait sur ce qui est réellement filtré.

import { getMesDepartements } from './mesDepartements.js'
import { dayKey } from './recurrence.js'

/** Styles retenus. Ensemble VIDE = tous les styles, jamais « aucun ». */
let styles = new Set()
/** Tarifs retenus ('gratuit' | 'libre' | 'payant' | 'chapeau'). Vide = tous.
 *  « chapeau » n'est pas un tarif mais un complément (migration 0032) : il
 *  retient les événements au chapeau, quel que soit leur tarif. */
let tarifs = new Set()
/** Fenêtre de dates : 'today' | 'weekend' | null (toutes). */
let quand = null
/** Un jour précis (AAAA-MM-JJ), choisi dans le panneau. Exclusif de `quand`. */
let jourPrecis = null

/**
 * Retouche TEMPORAIRE des départements. `null` = on suit le choix durable
 * fait dans Profil.
 *
 * ⚠ DEUX COUCHES, ET C'EST VOULU. Le choix de Profil est durable — on
 * n'habite pas ailleurs d'un jour sur l'autre. Mais vouloir jeter un œil au 05
 * un soir ne doit pas réécrire ce choix : la retouche faite ici vit le temps
 * de la session et disparaît au prochain lancement, comme les autres filtres.
 */
let deptsTemporaires = null

const subs = new Set()
const notifier = () => {
  for (const fn of subs) fn()
}

export function onFilterChange(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

// --- Styles ------------------------------------------------------------------

export function getStyles() {
  return new Set(styles)
}

export function setStyles(valeurs) {
  styles = new Set([...(valeurs ?? [])].filter(Boolean))
  notifier()
}

/**
 * Geste de la RANGÉE : un appui retient ce style SEUL, un second le relâche.
 * C'est le chemin rapide — une main, un doigt, aucun panneau à ouvrir. Les
 * combinaisons passent par les cases à cocher du panneau.
 */
export function choisirStyleSeul(valeur) {
  if (!valeur) styles = new Set()
  else if (styles.size === 1 && styles.has(valeur)) styles = new Set()
  else styles = new Set([valeur])
  notifier()
}

/** Geste du PANNEAU : ajoute ou retire sans toucher aux autres. */
export function basculerStyle(valeur) {
  if (!valeur) return
  if (styles.has(valeur)) styles.delete(valeur)
  else styles.add(valeur)
  notifier()
}

// --- Tarif -------------------------------------------------------------------

export function getTarifs() {
  return new Set(tarifs)
}

export function basculerTarif(valeur) {
  if (tarifs.has(valeur)) tarifs.delete(valeur)
  else tarifs.add(valeur)
  notifier()
}

// --- Quand -------------------------------------------------------------------

export function getQuand() {
  return quand
}

/**
 * Les jours couverts par la fenêtre « Quand », ou null (tous les jours).
 * Partagé par l'Agenda et la Carte : calculé à deux endroits, le week-end
 * finirait par ne pas tomber les mêmes jours.
 * @returns {Set<string>|null}
 */
export function joursDeQuand() {
  if (jourPrecis) return new Set([jourPrecis])
  if (quand === 'today') return new Set([dayKey(new Date())])
  if (quand === 'weekend') {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    // ⚠ LE DIMANCHE, ON EST DÉJÀ DANS LE WEEK-END. Chercher le PROCHAIN samedi
    // (`(6 - getDay() + 7) % 7` vaut 6 le dimanche) renvoyait au week-end
    // suivant et faisait disparaître la journée en cours. Le samedi étant
    // passé, on ne garde que le jour même — « jusqu'au dimanche soir ».
    if (start.getDay() === 0) return new Set([dayKey(start)])
    const samedi = new Date(start)
    samedi.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7))
    const dimanche = new Date(samedi)
    dimanche.setDate(samedi.getDate() + 1)
    return new Set([dayKey(samedi), dayKey(dimanche)])
  }
  if (quand === 'semaine') {
    // D'aujourd'hui à dimanche soir : la semaine qui RESTE, pas les jours
    // déjà passés.
    const now = new Date()
    const jour = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const out = new Set()
    do {
      out.add(dayKey(jour))
      jour.setDate(jour.getDate() + 1)
    } while (jour.getDay() !== 1) // jusqu'au dimanche inclus
    return out
  }
  return null
}

/** Libellé court de la période retenue, pour une pastille ou un compteur. */
export function libelleQuand() {
  if (jourPrecis) {
    return new Date(jourPrecis + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  }
  return { today: 'Aujourd’hui', weekend: 'Ce week-end', semaine: 'Cette semaine' }[quand] ?? null
}

/** Re-choisir la même fenêtre la relâche : même geste que sur les styles. */
export function setQuand(valeur) {
  quand = quand === valeur ? null : valeur || null
  if (quand) jourPrecis = null
  notifier()
}

export function getJourPrecis() {
  return jourPrecis
}

/** Un jour précis remplace « Aujourd'hui » / « Ce week-end » (et inversement). */
export function setJourPrecis(ymd) {
  jourPrecis = ymd || null
  if (jourPrecis) quand = null
  notifier()
}

// --- Départements ------------------------------------------------------------

/** Les départements RÉELLEMENT appliqués : la retouche si elle existe, sinon
 *  le choix durable de Profil. C'est cette liste que lisent l'agenda et la
 *  carte — jamais `getMesDepartements()` directement. */
export function getDepartementsEffectifs() {
  return deptsTemporaires ? [...deptsTemporaires] : getMesDepartements()
}

/** Vrai si l'on regarde autre chose que son choix durable. */
export function deptsRetouches() {
  return deptsTemporaires !== null
}

export function basculerDepartement(code) {
  const actuels = getDepartementsEffectifs()
  const prochain = actuels.includes(code)
    ? actuels.filter((c) => c !== code)
    : [...actuels, code]
  // Tout décocher n'a pas de sens : on retombe sur le choix durable plutôt que
  // de vider l'agenda sans rien expliquer.
  deptsTemporaires = prochain.length ? prochain : null
  // Revenir exactement au choix durable, c'est ne plus rien retoucher.
  if (deptsTemporaires && memeListe(deptsTemporaires, getMesDepartements())) {
    deptsTemporaires = null
  }
  notifier()
}

function memeListe(a, b) {
  return a.length === b.length && a.every((c) => b.includes(c))
}

// --- Ensemble ----------------------------------------------------------------

/** Nombre de filtres actifs, pour la pastille du bouton « Filtres ». */
export function nbFiltresActifs() {
  return styles.size + tarifs.size + (quand || jourPrecis ? 1 : 0) + (deptsTemporaires ? 1 : 0)
}

export function resetFiltres() {
  styles = new Set()
  tarifs = new Set()
  quand = null
  jourPrecis = null
  // La retouche disparaît : on revient au choix durable de Profil, pas à
  // « tous les départements ».
  deptsTemporaires = null
  notifier()
}

// --- Application aux événements ----------------------------------------------

/**
 * Filtres portant sur l'ÉVÉNEMENT lui-même (style, tarif). Les filtres de
 * DATE ne sont pas ici : ils s'appliquent aux occurrences, jour par jour, et
 * un événement récurrent n'a pas une date mais plusieurs.
 *
 * @param {object[]} events
 * @param {(ev:object)=>string} tarifDe  lecture du tarif (composant d'UI)
 */
export function appliquerFiltres(events, tarifDe) {
  let out = events
  if (styles.size) out = out.filter((e) => styles.has(e.category))
  // Les cases cochées s'ADDITIONNENT, comme partout dans le panneau :
  // « Gratuit » + « Au chapeau » montre les deux.
  if (tarifs.size && tarifDe) {
    out = out.filter((e) => tarifs.has(tarifDe(e)) || (tarifs.has('chapeau') && e.au_chapeau))
  }
  return out
}

// --- Compatibilité -----------------------------------------------------------
// La Carte raisonne encore en style UNIQUE. Ces deux fonctions lui donnent une
// vue à l'ancienne sur le nouvel ensemble, sans la réécrire : elle montre le
// style retenu quand il n'y en a qu'un, « tous » sinon.

export function getCategory() {
  return styles.size === 1 ? [...styles][0] : null
}

export function setCategory(c) {
  choisirStyleSeul(c || null)
}

export function onCategoryChange(fn) {
  return onFilterChange(() => fn(getCategory()))
}
