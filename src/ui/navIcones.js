// Armana — les quatre icônes de la barre du bas.
//
// Choisies par Matthieu le 12/11/2026 (version 2 des essais, « Trait, puis
// plein »), d'après ses planches de recherche : au TRAIT BLEU tant que l'onglet
// est inactif, PLEINES quand il est actif — sans carré derrière. Trois détails
// leur donnent leur caractère : le soleil dans l'agenda, le repère posé sur la
// carte, l'étincelle du favori.
//
// ⚠ Ce ne sont pas des icônes du jeu Lucide (icons.js) : elles ne suivent pas
// `currentColor`. Un seul tracé par onglet ; ce sont les variables CSS posées
// sur `.navtab` (style.css) qui le font passer du trait au plein :
//   --o-trait   contour et anneaux                (bleu)
//   --o-fond    intérieur des formes              (rien → bleu)
//   --o-detail  traits intérieurs, plis de carte  (bleu → couleur de la barre)
//   --o-accent  soleil et étincelle               (blanc)
//   --o-repere / --o-repere-trait  le repère de la carte
const COEUR =
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'

/** Épaisseur du trait, dans la grille de 24. */
const TRAIT = 2
/**
 * ⚠ LE CŒUR EST CENTRÉ SUR SON LIBELLÉ (retour de Matthieu, 12/11/2026).
 * Au premier jet je l'avais poussé à gauche pour loger l'étincelle dans la
 * grille : il paraissait décalé au-dessus de « Favoris ». Il occupe désormais
 * la même largeur que l'agenda et la carte (3 → 21), et c'est l'ÉTINCELLE qui
 * déborde, en haut à droite, hors de la grille (`overflow: visible`).
 */
const ECHELLE_COEUR = 0.9
const PLACE_COEUR = 'translate(1.2 1.7)'

const FORME = 'fill="var(--o-fond)" stroke="var(--o-trait)"'

const DESSINS = {
  calendar:
    `<rect x="3" y="4.5" width="18" height="16.5" rx="3.5" ${FORME}/>` +
    '<path d="M3 9.5h18" stroke="var(--o-detail)"/>' +
    '<path d="M8 2.5v4M16 2.5v4" stroke="var(--o-trait)"/>' +
    '<circle cx="12" cy="15.3" r="2.3" fill="var(--o-accent)" stroke="none"/>',
  map:
    `<path d="M3 8.6 9 6l6 2.6 6-2.6v12.4L15 21l-6-2.6L3 21Z" ${FORME}/>` +
    '<path d="M9 6v12.4M15 8.6V21" stroke="var(--o-detail)"/>' +
    // Le repère recouvre le coin de la carte : son contour prend la couleur
    // de ce qui l'entoure, pour s'en détacher.
    '<path d="M17.5 11.6s-3.7-3.4-3.7-6.3a3.7 3.7 0 0 1 7.4 0c0 2.9-3.7 6.3-3.7 6.3Z" ' +
    'fill="var(--o-repere)" stroke="var(--o-repere-trait)"/>' +
    '<circle cx="17.5" cy="5.3" r="1.2" fill="var(--o-trait)" stroke="none"/>',
  heart:
    `<g transform="${PLACE_COEUR} scale(${ECHELLE_COEUR})" stroke-width="${(TRAIT / ECHELLE_COEUR).toFixed(2)}">` +
    `<path d="${COEUR}" ${FORME}/></g>` +
    '<path d="M22 0c.27 1.6 1 2.4 2.6 2.6-1.6.27-2.33 1-2.6 2.6-.27-1.6-1-2.4-2.6-2.6 1.6-.27 2.33-1 2.6-2.6Z" ' +
    'fill="var(--o-accent)" stroke="none"/>',
  user:
    `<path d="M5 21.5a1 1 0 0 1-1-1 6.5 6.5 0 0 1 6.5-6.5h3a6.5 6.5 0 0 1 6.5 6.5 1 1 0 0 1-1 1Z" ${FORME}/>` +
    `<circle cx="12" cy="7.5" r="4" ${FORME}/>`,
}

/** L'icône d'un onglet : `calendar`, `map`, `heart` ou `user`. */
export function iconeOnglet(nom) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke-width', String(TRAIT))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = DESSINS[nom] || ''
  return svg
}
