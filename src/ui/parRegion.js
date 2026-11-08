// Armana — listes de départements rangées par région, en accordéon.
//
// Depuis l'ouverture à la France (07/11/2026), une liste plate de 96
// départements est illisible sur un téléphone. Chaque écran qui en propose
// (Mon territoire, filtres, modération, candidature) les range donc par
// région : un bloc par région, déplié s'il contient déjà un choix.
//
// ⚠ CE COMPOSANT NE DÉTIENT AUCUN ÉTAT. Chaque écran garde sa sélection et
// fournit l'élément d'un département ; le composant ne fait que ranger, compter
// et proposer « Toute la région ».
import { el } from './components.js'
import { REGIONS } from '../lib/departements.js'
import './parRegion.css'

/**
 * @param {object} o
 * @param {(d:{code:string,nom:string,region:string}) => HTMLElement} o.rendre
 * @param {() => string[]} o.selection  codes retenus, relus à chaque peinture
 * @param {string[]} [o.codes]  départements proposés (défaut : tous)
 * @param {(codes:string[], tous:boolean) => void} [o.basculerRegion]
 *        présent = un bouton « Toute la région » / « Aucun » dans l'en-tête
 * @param {string[]} [o.ouvertes]  régions dépliées au départ
 *        (défaut : celles qui contiennent déjà un choix)
 * @param {boolean} [o.pastilles]  départements en pastilles (sinon en lignes)
 * @param {string} [o.classeCorps]  classe ajoutée au corps de chaque région
 * @returns {HTMLElement & {repeindre: () => void}}
 */
export function listeParRegion({
  rendre,
  selection,
  codes = null,
  basculerRegion = null,
  ouvertes = null,
  pastilles = false,
  classeCorps = null,
}) {
  const racine = el('div', 'par-region')
  const blocs = []
  const choisisAuDepart = selection()
  // Les régions déjà suivies EN TÊTE : on y revient bien plus souvent qu'on
  // ne va chercher la Corse. Ordre alphabétique ensuite.
  const nbSuivis = (r) => r.depts.filter((d) => choisisAuDepart.includes(d.code)).length
  const ordre = [
    ...REGIONS.filter((r) => nbSuivis(r)).sort((a, b) => nbSuivis(b) - nbSuivis(a)),
    ...REGIONS.filter((r) => !nbSuivis(r)),
  ]

  for (const r of ordre) {
    const depts = r.depts
      .filter((d) => !codes || codes.includes(d.code))
      .map((d) => ({ ...d, region: r.code }))
    if (!depts.length) continue
    const siens = depts.map((d) => d.code)

    const bloc = el('details', 'par-region__bloc')
    bloc.open = ouvertes ? ouvertes.includes(r.code) : siens.some((c) => choisisAuDepart.includes(c))
    const tete = el('summary', 'par-region__tete')
    tete.appendChild(el('span', 'par-region__nom', r.nom))
    const compte = el('span', 'par-region__compte')
    tete.appendChild(compte)
    let tout = null
    if (basculerRegion) {
      tout = el('button', 'par-region__tout')
      tout.type = 'button'
      tout.addEventListener('click', (e) => {
        // Dans un <summary>, un clic replierait aussi le bloc.
        e.preventDefault()
        e.stopPropagation()
        const sel = selection()
        basculerRegion(siens, !siens.every((c) => sel.includes(c)))
      })
      tete.appendChild(tout)
    }
    bloc.appendChild(tete)

    const corps = el(
      'div',
      ['par-region__corps', pastilles && 'choix', classeCorps].filter(Boolean).join(' ')
    )
    for (const d of depts) corps.appendChild(rendre(d))
    bloc.appendChild(corps)
    racine.appendChild(bloc)
    blocs.push({ bloc, siens, compte, tout })
  }

  racine.repeindre = () => {
    const sel = selection()
    for (const { bloc, siens, compte, tout } of blocs) {
      const n = siens.filter((c) => sel.includes(c)).length
      compte.textContent = n ? (n === siens.length ? 'toute' : `${n} sur ${siens.length}`) : ''
      bloc.classList.toggle('is-choisie', n > 0)
      if (tout) tout.textContent = n === siens.length ? 'Aucun' : 'Toute la région'
    }
  }
  racine.repeindre()
  return racine
}

/**
 * La zone d'un modérateur en pastilles de numéros, rangées par région.
 * `onClic(d, bouton)` fait le reste (enregistrer, confirmer) ; `peindre()`
 * rallume les pastilles d'après `selection()`, `geler(oui)` les bloque
 * pendant un enregistrement.
 */
export function zoneParRegion({ selection, onClic, ouvertes = null }) {
  const boutons = new Map()
  const liste = listeParRegion({
    pastilles: true,
    selection,
    ouvertes,
    rendre: (d) => {
      const b = el('button', 'admin-zone__dept', d.code)
      b.type = 'button'
      b.title = d.nom
      b.setAttribute('aria-label', d.nom)
      b.addEventListener('click', () => onClic(d, b))
      boutons.set(d.code, b)
      return b
    },
  })
  liste.peindre = () => {
    const sel = selection()
    for (const [code, b] of boutons) b.classList.toggle('is-active', sel.includes(code))
    liste.repeindre()
  }
  liste.geler = (oui) => {
    for (const b of boutons.values()) b.disabled = oui
  }
  liste.peindre()
  return liste
}
