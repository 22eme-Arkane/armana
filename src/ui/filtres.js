// Armana — panneau de filtres (feuille qui monte du bas).
//
// ⚠ IL NE DÉTIENT AUCUN ÉTAT. Tout est lu et écrit dans `lib/filter.js`, le
// même que la rangée de styles de l'en-tête. Deux états séparés finiraient par
// se contredire, et la rangée mentirait sur ce qui est réellement filtré.
import { el } from './components.js'
import { ouvrirCalendrier } from './calendrier.js'
import { CATEGORIES } from '../lib/events.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import {
  basculerDepartement,
  basculerStyle,
  basculerTarif,
  getQuand,
  getDepartementsEffectifs,
  getJourPrecis,
  libelleQuand,
  setJourPrecis,
  getStyles,
  getTarifs,
  nbFiltresActifs,
  resetFiltres,
  setQuand,
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

  /** Une section de pastilles à cocher. `estActif` et `basculer` font le lien. */
  const peintres = []
  function section(titre, options, estActif, basculer, aide) {
    corps.appendChild(el('h3', 'feuille__section', titre))
    if (aide) corps.appendChild(el('p', 'feuille__aide', aide))
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
    corps.appendChild(rangee)
    peintres.push(() => {
      for (const { b, cle } of boutons) b.classList.toggle('is-active', estActif(cle))
    })
  }

  section(
    'Styles',
    CATEGORIES.map((c) => ({ cle: c, texte: c })),
    (c) => getStyles().has(c),
    (c) => basculerStyle(c),
    'Plusieurs styles possibles. Aucun coché = tous les styles.'
  )

  section(
    'Tarif',
    TARIFS,
    (t) => getTarifs().has(t),
    (t) => basculerTarif(t),
    null
  )

  section(
    'Quand',
    QUAND,
    (q) => getQuand() === q,
    (q) => setQuand(q),
    null
  )

  // « Choisir une date » : ouvre le calendrier du téléphone, jamais un champ à
  // taper. Une fois choisie, la pastille affiche le jour ; la toucher à
  // nouveau le relâche (même geste que les autres pastilles).
  const rangeeQuand = corps.lastElementChild
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

  // ⚠ ON NE TOUCHE PAS AU CHOIX DURABLE DEPUIS ICI. Regarder le 05 un soir ne
  // doit pas réécrire les départements réglés dans Profil : `basculerDepartement`
  // pose une retouche temporaire, que « Tout afficher » et le prochain
  // lancement effacent. Le texte d'aide le dit, sans quoi on croirait avoir
  // changé son réglage pour de bon.
  section(
    'Départements',
    DEPARTEMENTS.map((d) => ({ cle: d.code, texte: `${d.code} ${d.nom}` })),
    (code) => getDepartementsEffectifs().includes(code),
    (code) => basculerDepartement(code),
    'Votre choix habituel vient de Profil → Mes départements. Une modification ' +
      'faite ici est provisoire : elle ne change pas ce réglage et disparaît à ' +
      'la prochaine ouverture.'
  )

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
