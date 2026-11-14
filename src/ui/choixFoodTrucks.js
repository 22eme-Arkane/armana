// Armana — annoncer les food trucks présents sur un événement.
//
// Demande de Matthieu (14/11/2026) : toute la liste des camions s'affichait
// d'un bloc, en pastilles qui débordaient de l'écran, et elle ne pouvait que
// s'allonger. Même geste désormais que pour une commune ou une adresse : on
// tape le début du nom, on touche la proposition. Les camions retenus
// s'affichent au-dessus, chacun retirable.
//
// En prime, les camions dont le PLANNING les place déjà près du lieu, le jour
// de l'événement, sont proposés d'office : l'organisateur ne connaît pas
// toujours leur nom exact.
//
// Toujours aucun champ libre : on ne peut annoncer qu'un camion inscrit et
// validé sur Armana (sinon n'importe quel nom s'écrirait sur la fiche).
import { el } from './components.js'
import { icon } from './icons.js'
import { chercherFoodTrucks, fichesFoodTrucks, foodTrucksPeriode } from '../lib/foodTrucks.js'
import { nomDepartement, regionDuDept } from '../lib/departements.js'
import { haversineMeters } from '../lib/geo.js'

/** Au-delà, l'événement serait surtout une liste de camions. */
const MAX = 6
/** « Près d'ici » : un marché, une place, le parking d'à côté. */
const RAYON_M = 3000

/**
 * @param {object} opts
 * @param {() => (string[]|Promise<string[]>)} [opts.initiaux]  les identifiants déjà
 *        annoncés (modification) — lus au premier `charger()` seulement
 * @param {() => {dept?:string|null, lat?:number|null, lng?:number|null, jours?:string[], eventId?:string|null}} opts.contexte
 *        lu à chaque recherche : département de la commune choisie, point du
 *        lieu, jours de l'événement (AAAA-MM-JJ)
 * @returns {{wrap:HTMLElement, valeurs:()=>string[], pret:()=>boolean,
 *            charger:()=>Promise<void>, suggerer:()=>Promise<void>}}
 */
export function choixFoodTrucks({ initiaux = () => [], contexte }) {
  const wrap = el('div', 'ft-choix')
  /** Les camions retenus, dans l'ordre où on les a ajoutés. */
  const choisis = new Map()
  /**
   * Annoncés, mais dont la fiche n'est pas lisible en ce moment (repassée en
   * relecture après une retouche de son propriétaire) : gardés tels quels, en
   * silence — modifier l'événement ne doit pas les en retirer.
   */
  const gardes = new Set()
  let charge = false

  const liste = el('div', 'ft-choix__retenus')
  const suggestions = el('div', 'ft-choix__suggestions')
  const recherche = el('div', 'choix-lieu__recherche')
  const input = el('input', 'form__input')
  input.type = 'search'
  input.placeholder = 'Tapez le nom du food truck'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Rechercher un food truck inscrit sur Armana')
  const resultats = el('div', 'choix-lieu__liste')
  resultats.setAttribute('role', 'listbox')
  recherche.append(input, resultats)
  const plein = el('p', 'form__hint', `${MAX} food trucks au plus : retirez-en un pour en ajouter un autre.`)
  wrap.append(liste, suggestions, recherche, plein)

  /** « Crêpes et galettes · 04 Alpes-de-Haute-Provence » */
  const detail = (t, extra = null) =>
    [t.cuisine, extra, t.dept ? `${t.dept} ${nomDepartement(t.dept)}` : null].filter(Boolean).join(' · ')

  function peindre() {
    liste.innerHTML = ''
    for (const t of choisis.values()) {
      const ligne = el('div', 'choix-lieu__choisie ft-choix__retenu')
      const texte = el('span', 'ft-choix__texte')
      texte.append(el('strong', null, t.name), el('span', null, detail(t)))
      const retirer = el('button', 'btn btn--ghost btn--sm', 'Retirer')
      retirer.type = 'button'
      retirer.setAttribute('aria-label', `Retirer ${t.name}`)
      retirer.addEventListener('click', () => {
        choisis.delete(t.id)
        peindre()
        peindreSuggestions()
      })
      ligne.append(icon('truck'), texte, retirer)
      liste.appendChild(ligne)
    }
    const complet = choisis.size >= MAX
    recherche.hidden = complet
    plein.hidden = !complet
  }

  function ajouter(t) {
    if (choisis.has(t.id) || choisis.size >= MAX) return
    choisis.set(t.id, t)
    input.value = ''
    resultats.innerHTML = ''
    peindre()
    peindreSuggestions()
  }

  // --- La recherche par le nom -------------------------------------------------------
  let attente = null
  let tour = 0
  input.addEventListener('input', () => {
    clearTimeout(attente)
    const saisie = input.value.trim()
    const moi = ++tour
    if (saisie.length < 2) {
      resultats.innerHTML = ''
      return
    }
    attente = setTimeout(async () => {
      let trouves
      try {
        trouves = await chercherFoodTrucks(saisie, { limite: 12 })
      } catch {
        if (moi === tour) message('Recherche indisponible pour l’instant. Réessayez dans un moment.')
        return
      }
      if (moi !== tour) return // une frappe plus récente a déjà répondu
      // Les camions du coin d'abord : même département, puis même région.
      const { dept } = contexte?.() ?? {}
      const region = dept ? regionDuDept(dept) : null
      const rang = (t) => (dept && t.dept === dept ? 0 : region && regionDuDept(t.dept) === region ? 1 : 2)
      trouves = trouves.filter((t) => !choisis.has(t.id)).sort((a, b) => rang(a) - rang(b)).slice(0, 6)
      resultats.innerHTML = ''
      if (!trouves.length) {
        message(
          'Aucun food truck inscrit sur Armana ne porte ce nom. Seuls les camions inscrits et validés peuvent être annoncés.'
        )
        return
      }
      for (const t of trouves) {
        const b = el('button', 'choix-lieu__option choix-lieu__option--adresse')
        b.type = 'button'
        b.setAttribute('role', 'option')
        b.append(el('strong', null, t.name), el('span', null, detail(t)))
        b.addEventListener('click', () => ajouter(t))
        resultats.appendChild(b)
      }
    }, 250)
  })
  // Entrée = la première proposition, jamais l'envoi du formulaire.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    resultats.querySelector('.choix-lieu__option')?.click()
  })
  function message(texte) {
    resultats.innerHTML = ''
    resultats.appendChild(el('p', 'form__hint', texte))
  }

  // --- Les camions annoncés près d'ici, ce jour-là -----------------------------------
  let proches = []
  function peindreSuggestions() {
    suggestions.innerHTML = ''
    const reste = proches.filter((p) => !choisis.has(p.id))
    if (!reste.length || choisis.size >= MAX) return
    suggestions.appendChild(
      el('span', 'ft-choix__titre', reste.length > 1 ? 'Ils ont prévu d’être là ce jour-là' : 'Il a prévu d’être là ce jour-là')
    )
    for (const p of reste) {
      const b = el('button', 'choix-lieu__option choix-lieu__option--adresse ft-choix__suggestion')
      b.type = 'button'
      b.append(
        el('strong', null, p.name),
        el('span', null, detail(p, p.lieu)),
        el('span', 'ft-choix__ajouter', '+ Annoncer ce food truck')
      )
      b.addEventListener('click', () => ajouter(p))
      suggestions.appendChild(b)
    }
  }

  let tourSuggestions = 0
  /** Recalcule les propositions — à appeler quand le lieu ou les dates changent. */
  async function suggerer() {
    const moi = ++tourSuggestions
    const { lat, lng, jours = [], eventId = null } = contexte?.() ?? {}
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !jours.length) {
      proches = []
      return peindreSuggestions()
    }
    const tries = [...jours].sort()
    const presences = await foodTrucksPeriode(tries[0], tries[tries.length - 1]).catch(() => null)
    if (moi !== tourSuggestions) return
    const vus = new Map()
    for (const p of presences ?? []) {
      if (!jours.includes(p.jour) || (eventId && p.event_id === eventId)) continue
      if (!Number.isFinite(p.lat) || haversineMeters({ lat, lng }, p) > RAYON_M) continue
      if (!vus.has(p.truck_id)) vus.set(p.truck_id, { id: p.truck_id, name: p.name, cuisine: p.cuisine, lieu: p.place_label })
    }
    proches = [...vus.values()].slice(0, 4)
    peindreSuggestions()
  }

  /** Charge les camions déjà annoncés (une seule fois). */
  let enCharge = null
  function charger() {
    enCharge ??= chargerUneFois()
    return enCharge
  }
  async function chargerUneFois() {
    const ids = (await initiaux()) ?? []
    if (ids.length) {
      const fiches = await fichesFoodTrucks(ids)
      for (const id of ids) {
        const f = fiches.find((x) => x.id === id)
        if (!f) gardes.add(id)
        else if (!choisis.has(id)) choisis.set(id, f)
      }
    }
    charge = true
    peindre()
  }

  peindre()
  return { wrap, valeurs: () => [...choisis.keys(), ...gardes], pret: () => charge, charger, suggerer }
}
