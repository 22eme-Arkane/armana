// Armana — le TYPE DE COMPTE, montré pareil partout dans l'administration :
// une pastille de couleur (avec un pictogramme pour les lieux et les food
// trucks), et un libellé. Particulier en bleu, lieu culturel en vert, food
// truck en rouge — les couleurs de leurs repères sur la carte.
import { el } from './components.js'
import { icon } from './icons.js'

export const TYPES_VISUELS = {
  particulier: { libelle: 'Particulier', couleur: '#0b55c5', icone: null },
  lieu: { libelle: 'Lieu culturel', couleur: '#26784c', icone: 'landmark' },
  food_truck: { libelle: 'Food truck', couleur: '#f04b2f', icone: 'truck' },
}

export function typeVisuel(type) {
  return TYPES_VISUELS[type] ?? TYPES_VISUELS.particulier
}

/** Deux lettres pour la pastille : première du prénom, première du nom. */
export function initiales(nom) {
  const mots = String(nom || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!mots.length) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

/**
 * La pastille d'un membre : ses initiales sur la couleur de son type, ou le
 * pictogramme d'un lieu / d'un food truck.
 * @param {'normal'|'grand'|'petit'} taille
 */
export function avatarMembre(nom, type, taille = 'normal') {
  const v = typeVisuel(type)
  const a = el('span', `avatar-membre avatar-membre--${taille}`)
  a.style.background = v.couleur
  if (v.icone) a.appendChild(icon(v.icone))
  else a.textContent = initiales(nom)
  a.setAttribute('aria-hidden', 'true')
  return a
}

/** L'étiquette du type (« Food truck »), sur sa couleur. */
export function etiquetteType(type) {
  const v = typeVisuel(type)
  const t = el('span', 'etiquette-type', v.libelle)
  t.style.background = v.couleur
  return t
}
