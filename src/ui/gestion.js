// Armana — les briques communes aux écrans de GESTION (Modération, Membres,
// fiche membre, Modérateurs, Journal) : la page bleue, les chiffres en tête,
// les onglets, les blocs à bandeau. Les styles sont dans gestion.css.
//
// Refonte du 11/11/2026 : ces écrans avaient chacun leur mise en page, et celle
// des Modérateurs empilait cinq sections sans hiérarchie. Une seule grammaire
// désormais — on apprend un écran, on sait lire les autres.
import './admin.css' // pastilles d'avatar et étiquettes de type (typeCompte.js)
import './gestion.css'
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'

/** La page : fond bleu, barre de titre, retour. */
export function pageGestion(titre, retour = { backTo: '/parametres' }) {
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--gestion')
  wrap.appendChild(studioHeader(titre, retour))
  return wrap
}

/**
 * Les chiffres en tête. `alerte` : la tuile passe en jaune plein — réservé à ce
 * qui attend une action (des candidatures, des publications à relire).
 * @param {Array<{valeur:string|number, libelle:string, alerte?:boolean}>} items
 */
export function chiffres(items) {
  const box = el('div', 'g-chiffres' + (items.length === 3 ? ' g-chiffres--3' : ''))
  for (const it of items) {
    const t = el('div', 'g-chiffre' + (it.alerte ? ' g-chiffre--alerte' : ''))
    t.append(el('strong', null, String(it.valeur)), el('span', null, it.libelle))
    box.appendChild(t)
  }
  return box
}

/**
 * Une barre d'onglets. Chaque onglet peut porter un compteur — affiché
 * SEULEMENT s'il est positif : un « 0 » ou un total permanent ressemblait à
 * une notification qui ne partait jamais (le « Food trucks (5) » d'avant).
 * @param {Array<{cle:string, texte:string, n?:number, alerte?:boolean}>} items
 * @param {{actif?:string, onChange:(cle:string)=>void}} opts
 */
export function onglets(items, { actif, onChange }) {
  const barre = el('div', 'g-onglets')
  barre.setAttribute('role', 'tablist')
  const boutons = new Map()
  let courant = actif ?? items[0]?.cle
  for (const it of items) {
    const b = el('button', 'g-onglet')
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.appendChild(el('span', null, it.texte))
    const n = el('span', 'g-onglet__n' + (it.alerte ? ' g-onglet__n--alerte' : ''))
    b.appendChild(n)
    b.addEventListener('click', () => barre.choisir(it.cle))
    boutons.set(it.cle, { b, n })
    barre.appendChild(b)
  }
  barre.compteur = (cle, valeur) => {
    const o = boutons.get(cle)
    if (!o) return
    o.n.hidden = !(valeur > 0)
    o.n.textContent = String(valeur ?? '')
  }
  barre.choisir = (cle, silencieux = false) => {
    courant = cle
    for (const [k, { b }] of boutons) {
      b.classList.toggle('is-active', k === cle)
      b.setAttribute('aria-selected', String(k === cle))
    }
    if (!silencieux) onChange?.(cle)
  }
  barre.courant = () => courant
  for (const it of items) barre.compteur(it.cle, it.n)
  barre.choisir(courant, true)
  return barre
}

/**
 * Un bloc : carte blanche, bandeau de couleur (pictogramme + titre), contenu.
 * @param {string} titre
 * @param {string} nomIcone  nom dans icons.js
 * @param {'bleu'|'rouge'|'vert'|'jaune'|'violet'} couleur
 * @param {{compte?:number|string, liste?:boolean}} [opts]  `liste` : contenu
 *        sans marge, pour des lignes bord à bord
 * @returns {{bloc:HTMLElement, corps:HTMLElement, compte:(v:any)=>void}}
 */
export function bloc(titre, nomIcone, couleur, { compte = null, liste = false } = {}) {
  const b = el('section', `g-bloc g-bloc--${couleur}`)
  const bandeau = el('h3', 'g-bloc__bandeau')
  bandeau.append(icon(nomIcone), el('span', null, titre))
  const c = el('span', 'g-bloc__compte')
  bandeau.appendChild(c)
  b.appendChild(bandeau)
  const corps = el('div', 'g-bloc__corps' + (liste ? ' g-bloc__corps--liste' : ''))
  b.appendChild(corps)
  const majCompte = (v) => {
    c.hidden = v == null || v === ''
    c.textContent = v == null ? '' : String(v)
  }
  majCompte(compte)
  return { bloc: b, corps, compte: majCompte }
}

export const titre = (texte) => el('h2', 'g-titre', texte)
export const note = (texte) => el('p', 'g-note', texte)
export const vide = (texte) => el('p', 'g-vide', texte)

/** Un champ de recherche en pilule. */
export function recherche(invite, libelle) {
  const champ = el('label', 'g-recherche')
  champ.appendChild(icon('search'))
  const input = el('input')
  input.type = 'search'
  input.placeholder = invite
  input.autocomplete = 'off'
  input.setAttribute('aria-label', libelle || invite)
  champ.appendChild(input)
  champ.input = input
  return champ
}

/**
 * Une rangée de pastilles à choix UNIQUE (filtres).
 * @param {Array<{cle:string, texte:string, n?:number}>} items
 * @param {{actif:string, onChange:(cle:string)=>void, file?:boolean}} opts
 *        `file` : une seule ligne qui défile
 */
export function pastilles(items, { actif, onChange, file = false }) {
  const rangee = el('div', 'g-pastilles' + (file ? ' g-pastilles--file' : ''))
  rangee.setAttribute('role', 'radiogroup')
  const boutons = []
  for (const it of items) {
    const b = el('button', 'g-pastille')
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.appendChild(el('span', null, it.texte))
    if (it.n != null) b.appendChild(el('span', 'g-pastille__n', String(it.n)))
    b.addEventListener('click', () => {
      rangee.choisir(it.cle)
      onChange?.(it.cle)
    })
    boutons.push({ b, cle: it.cle })
    rangee.appendChild(b)
  }
  rangee.choisir = (cle) => {
    for (const x of boutons) {
      x.b.classList.toggle('is-active', x.cle === cle)
      x.b.setAttribute('aria-checked', String(x.cle === cle))
    }
  }
  rangee.choisir(actif)
  return rangee
}

const JOUR = 86400000
const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function joursDepuis(iso) {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / JOUR) : null
}

/** « aujourd'hui », « hier », « il y a 12 jours », sinon la date. */
export function depuis(iso) {
  const j = joursDepuis(iso)
  if (j == null) return 'jamais'
  if (j <= 0) return 'aujourd’hui'
  if (j === 1) return 'hier'
  if (j < 31) return `il y a ${j} jours`
  return 'le ' + DATE.format(new Date(iso))
}

export const pluriel = (n, mot, mots = mot + 's') => `${n} ${n > 1 ? mots : mot}`
