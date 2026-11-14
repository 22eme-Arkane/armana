// Armana — panneau de filtres (feuille qui monte du bas).
//
// ⚠ IL NE DÉTIENT AUCUN ÉTAT. Tout est lu et écrit dans `lib/filter.js`, le
// même que la rangée de styles de l'en-tête. Deux états séparés finiraient par
// se contredire, et la rangée mentirait sur ce qui est réellement filtré.
import { el } from './components.js'
import { icon } from './icons.js'
import { ouvrirCalendrier } from './calendrier.js'
import { carteDepartements } from './carteDepts.js'
import { UNIVERS, categoriesDe } from '../lib/univers.js'
import { CODES_DEPARTEMENTS, deptsDeRegion, regionDuDept, resumeTerritoire } from '../lib/departements.js'
import { listeParRegion } from './parRegion.js'
import './filtres.css'
import {
  basculerDepartement,
  basculerRegion,
  deptsRetouches,
  garderCommeTerritoire,
  revenirAuTerritoire,
  basculerStyle,
  basculerTarif,
  getQuand,
  getDepartementsEffectifs,
  getJourPrecis,
  libelleQuand,
  setJourPrecis,
  getStyles,
  getTarifs,
  getUnivers,
  nbFiltresActifs,
  resetFiltres,
  setQuand,
  setUnivers,
} from '../lib/filter.js'

const TARIFS = [
  { cle: 'gratuit', texte: 'Gratuit' },
  { cle: 'libre', texte: 'Prix libre' },
  { cle: 'payant', texte: 'Payant' },
  { cle: 'chapeau', texte: 'Au chapeau' },
]

const QUAND = [
  { cle: 'today', texte: 'Aujourd’hui' },
  { cle: 'weekend', texte: 'Ce week-end' },
  { cle: 'semaine', texte: 'Cette semaine' },
]

/**
 * Ouvre le panneau. Se referme au fond, à la croix, ou sur Échap.
 * @param {() => void} onChange  rappelé à chaque modification
 */
export function ouvrirFiltres(onChange) {
  const fond = el('div', 'feuille-fond')
  const feuille = el('div', 'feuille')
  fond.appendChild(feuille)

  const tete = el('div', 'feuille__tete')
  tete.appendChild(el('h2', 'feuille__titre', 'Filtres'))
  // Une croix en texte : il n'existe pas d'icône « fermer » dans icons.js, et
  // en ajouter une pour un seul usage ne se justifiait pas.
  const fermer = el('button', 'feuille__fermer', '×')
  fermer.type = 'button'
  fermer.setAttribute('aria-label', 'Fermer')
  tete.appendChild(fermer)
  feuille.appendChild(tete)

  const corps = el('div', 'feuille__corps')
  feuille.appendChild(corps)

  const majTout = () => {
    peindre()
    onChange?.()
  }

  // ⚠ REFONTE DU 08/11/2026 (Matthieu : « ça manque vraiment de clarté »).
  // Chaque section est un BLOC à bandeau de couleur et icône, au lieu d'un
  // petit titre noir sur blanc. « Où » passe en tête, avec la CARTE de France
  // de Mon territoire : on touche une région au lieu de déplier treize menus.
  const peintres = []

  /** Un bloc : bandeau coloré (icône + titre), puis son contenu. */
  function bloc(titre, picto, couleur, aide) {
    const b = el('section', `filtre-bloc filtre-bloc--${couleur}`)
    const bandeau = el('h3', 'filtre-bloc__bandeau')
    bandeau.append(typeof picto === 'string' ? el('span', 'filtre-bloc__picto', picto) : picto, el('span', null, titre))
    b.appendChild(bandeau)
    const contenu = el('div', 'filtre-bloc__contenu')
    if (aide) contenu.appendChild(el('p', 'feuille__aide', aide))
    b.appendChild(contenu)
    corps.appendChild(b)
    return contenu
  }

  /** Une rangée de pastilles à cocher. `estActif` et `basculer` font le lien. */
  function pastilles(contenu, options, estActif, basculer) {
    const rangee = el('div', 'choix')
    const boutons = options.map((o) => {
      const b = el('button', 'choix__option', o.texte)
      b.type = 'button'
      b.addEventListener('click', () => {
        basculer(o.cle)
        majTout()
      })
      rangee.appendChild(b)
      return { b, cle: o.cle }
    })
    contenu.appendChild(rangee)
    peintres.push(() => {
      for (const { b, cle } of boutons) b.classList.toggle('is-active', estActif(cle))
    })
    return rangee
  }

  // --- Où -------------------------------------------------------------------
  // ⚠ ON NE TOUCHE PAS AU CHOIX DURABLE DEPUIS ICI. Regarder le 05 un soir ne
  // doit pas réécrire Mon territoire : c'est une retouche provisoire, que
  // « Tout afficher » et le prochain lancement effacent — sauf si l'on choisit
  // explicitement de la garder.
  const ou = bloc(
    'Où',
    icon('map'),
    'bleu',
    'Touchez une région pour l’ajouter ou la retirer. Provisoire : votre choix ' +
      'habituel reste celui de Profil → Mon territoire.'
  )
  const carte = carteDepartements({
    selection: getDepartementsEffectifs(),
    onPick: (code) => {
      const siens = deptsDeRegion(regionDuDept(code))
      const effectifs = getDepartementsEffectifs()
      basculerRegion(siens, !siens.every((c) => effectifs.includes(c)))
      majTout()
    },
  })
  carte.classList.add('filtre-carte')
  ou.appendChild(carte)

  // « Mon territoire » : allumé tant qu'on regarde son réglage de Profil ; le
  // toucher abandonne la retouche. « Toute la France » d'un geste. Et une
  // retouche peut être GARDÉE : elle devient le territoire durable.
  const monTerritoire = el('button', 'choix__option', 'Mon territoire')
  monTerritoire.type = 'button'
  monTerritoire.addEventListener('click', () => {
    revenirAuTerritoire()
    majTout()
  })
  const franceEntiere = el('button', 'choix__option filtres__france')
  franceEntiere.type = 'button'
  franceEntiere.addEventListener('click', () => {
    const tout = getDepartementsEffectifs().length === CODES_DEPARTEMENTS.length
    basculerRegion(CODES_DEPARTEMENTS, !tout)
    majTout()
  })
  const rangeeFrance = el('div', 'choix')
  rangeeFrance.append(monTerritoire, franceEntiere)
  ou.appendChild(rangeeFrance)
  const resume = el('p', 'filtre-bloc__resume')
  ou.appendChild(resume)
  const garder = el('button', 'btn btn--link filtres__garder', 'Garder ce choix comme mon territoire')
  garder.type = 'button'
  garder.addEventListener('click', () => {
    garderCommeTerritoire()
    majTout()
  })
  ou.appendChild(garder)

  // Le détail par département, REPLIÉ : on y va pour affiner, pas d'emblée.
  const affiner = el('details', 'filtre-affiner')
  affiner.appendChild(el('summary', null, 'Affiner par département'))
  const boutonsDepts = new Map()
  const regions = listeParRegion({
    pastilles: true,
    selection: getDepartementsEffectifs,
    ouvertes: [],
    rendre: (d) => {
      const b = el('button', 'choix__option', `${d.code} ${d.nom}`)
      b.type = 'button'
      b.addEventListener('click', () => {
        basculerDepartement(d.code)
        majTout()
      })
      boutonsDepts.set(d.code, b)
      return b
    },
  })
  affiner.appendChild(regions)
  ou.appendChild(affiner)

  peintres.push(() => {
    const effectifs = getDepartementsEffectifs()
    const tout = effectifs.length === CODES_DEPARTEMENTS.length
    const retouche = deptsRetouches()
    carte.setSelection(effectifs)
    franceEntiere.classList.toggle('is-active', tout && retouche)
    franceEntiere.textContent = tout && retouche ? 'Toute la France ×' : 'Toute la France'
    monTerritoire.classList.toggle('is-active', !retouche)
    resume.textContent = resumeTerritoire(effectifs)
    // ⚠ `style.display`, pas `hidden` : le `display` de `.btn` l'emporterait.
    garder.style.display = retouche ? '' : 'none'
    for (const [code, b] of boutonsDepts) b.classList.toggle('is-active', effectifs.includes(code))
    regions.repeindre()
  })

  // --- Quand ----------------------------------------------------------------
  const quand = bloc('Quand', icon('calendar'), 'rouge', null)
  const rangeeQuand = pastilles(quand, QUAND, (q) => getQuand() === q, (q) => setQuand(q))
  // « Choisir une date » : ouvre le calendrier d'Armana, jamais un champ à
  // taper. Une fois choisie, la pastille affiche le jour ; la toucher à
  // nouveau le relâche (même geste que les autres pastilles).
  const choisirDate = el('button', 'choix__option', 'Choisir une date')
  choisirDate.type = 'button'
  choisirDate.addEventListener('click', () => {
    if (getJourPrecis()) {
      setJourPrecis(null)
      return majTout()
    }
    ouvrirCalendrier(null, (jour) => {
      setJourPrecis(jour)
      majTout()
    })
  })
  rangeeQuand.appendChild(choisirDate)
  peintres.push(() => {
    const j = getJourPrecis()
    choisirDate.classList.toggle('is-active', Boolean(j))
    choisirDate.textContent = j ? libelleQuand() + ' ×' : 'Choisir une date'
  })

  // --- Univers et styles (14/11/2026) -------------------------------------------
  // L'univers d'abord — c'est aussi d'ici qu'on le change depuis la Carte —,
  // puis les styles de CET univers seulement.
  const blocStyles = bloc('Univers et styles', icon('ticket'), 'jaune', null)
  pastilles(
    blocStyles,
    UNIVERS.map((u) => ({ cle: u.cle, texte: u.nom })),
    (u) => getUnivers() === u,
    (u) => setUnivers(u)
  ).classList.add('choix--univers')
  blocStyles.appendChild(el('p', 'feuille__aide', 'Plusieurs styles possibles. Aucun coché = tous les styles.'))
  const rangeeStyles = el('div')
  blocStyles.appendChild(rangeeStyles)
  let universStyles = null
  peintres.push(() => {
    if (getUnivers() === universStyles) return
    universStyles = getUnivers()
    rangeeStyles.innerHTML = ''
    // Les pastilles se reconstruisent : on retire leur ancien peintre.
    const avant = peintres.length
    pastilles(
      rangeeStyles,
      categoriesDe(universStyles).map((c) => ({ cle: c, texte: c })),
      (c) => getStyles().has(c),
      (c) => basculerStyle(c)
    )
    const nouveau = peintres.splice(avant, 1)[0]
    peintreStyles = nouveau
  })
  let peintreStyles = null
  peintres.push(() => peintreStyles?.())

  // --- Tarif ----------------------------------------------------------------
  pastilles(bloc('Tarif', '€', 'vert', null), TARIFS, (t) => getTarifs().has(t), (t) => basculerTarif(t))

  const pied = el('div', 'feuille__pied')
  const raz = el('button', 'btn btn--ghost', 'Tout afficher')
  raz.type = 'button'
  raz.addEventListener('click', () => {
    resetFiltres()
    majTout()
  })
  const valider = el('button', 'btn btn--primary', 'Voir les événements')
  valider.type = 'button'
  valider.addEventListener('click', () => refermer())
  pied.append(raz, valider)
  feuille.appendChild(pied)

  function peindre() {
    for (const p of peintres) p()
    const n = nbFiltresActifs()
    raz.disabled = n === 0
    valider.textContent = n ? `Voir (${n} filtre${n > 1 ? 's' : ''})` : 'Voir les événements'
  }
  peindre()

  function refermer() {
    document.removeEventListener('keydown', surTouche)
    fond.remove()
  }
  const surTouche = (e) => {
    if (e.key === 'Escape') refermer()
  }
  document.addEventListener('keydown', surTouche)
  // Le fond ferme, mais PAS un clic dans la feuille : sans ce test, cocher une
  // case refermait le panneau aussitôt.
  fond.addEventListener('click', (e) => {
    if (e.target === fond) refermer()
  })
  fermer.addEventListener('click', refermer)

  document.body.appendChild(fond)
  return refermer
}
