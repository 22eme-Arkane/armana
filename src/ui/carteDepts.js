// Armana — petite carte SVG du territoire, sélection en jaune.
//
// Pas de Leaflet ici : c'est une vignette décorative et informative (« voilà
// ce que vous choisissez »), pas une carte navigable. Un SVG statique construit
// depuis les contours déjà embarqués coûte quelques millisecondes et rien de
// plus, là où une seconde instance Leaflet chargerait des tuiles.
// ⚠ Dessinée depuis les contours ALLÉGÉS de toute la France (71 Ko) : les
// contours complets d'une seule région pèsent davantage, et une vignette n'en
// montre de toute façon pas le détail.
import { CODES_DEPARTEMENTS, loadFranceAllegee } from '../lib/departements.js'

const NS = 'http://www.w3.org/2000/svg'

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  return n
}

/**
 * Construit la vignette. Renvoie l'élément, muni de `.setSelection(codes)`
 * pour repeindre sans tout reconstruire.
 *
 * @param {object} opts
 * @param {string[]} opts.selection  codes allumés au départ
 * @param {(code:string)=>void} [opts.onPick]  clic sur un département
 * @param {string[]} [opts.codes]  départements dessinés (défaut : toute la France)
 * @param {(code:string)=>string} [opts.classe]  classe(s) en plus par
 *        département — la carte de couverture des modérateurs s'en sert pour
 *        colorer « couvert », « chargé », « en attente »
 */
export function carteDepartements({
  selection = [],
  onPick = null,
  codes = CODES_DEPARTEMENTS,
  classe = null,
} = {}) {
  const hote = el()
  let courant = [...selection]

  loadFranceAllegee()
    .then((geojson) => dessiner(hote, geojson, () => courant, onPick, codes, classe))
    .catch(() => {
      // Contours indisponibles (hors ligne au premier lancement) : la vignette
      // disparaît, le reste de l'écran continue de fonctionner. Une carte est
      // un agrément, jamais une condition pour postuler.
      hote.remove()
    })

  hote.setSelection = (codes) => {
    courant = [...codes]
    for (const p of hote.querySelectorAll('[data-code]')) {
      p.classList.toggle('is-active', courant.includes(p.dataset.code))
    }
  }
  return hote
}

function el() {
  const d = document.createElement('div')
  d.className = 'carte-depts'
  return d
}

function dessiner(hote, geojson, getSelection, onPick, codes, classe) {
  // Au-delà d'une région, les numéros se chevaucheraient : la carte seule.
  const avecNumeros = codes.length <= 14
  const traits = []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

  for (const f of geojson.features ?? []) {
    const code = f?.properties?.code
    if (!codes.includes(code)) continue
    const g = f.geometry
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    const morceaux = []
    for (const poly of polys) {
      // Seul l'anneau extérieur : à cette taille, les trous (l'enclave des
      // Papes) ne feraient qu'un pâté d'un pixel.
      const anneau = poly[0]
      if (!anneau?.length) continue
      let d = ''
      for (const [lng, lat] of anneau) {
        // Mercator simplifié : à cette latitude, corriger la longitude par le
        // cosinus suffit pour que le dessin ne paraisse pas écrasé.
        const x = lng * Math.cos((44.3 * Math.PI) / 180)
        const y = -lat
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        d += (d ? 'L' : 'M') + x.toFixed(4) + ' ' + y.toFixed(4)
      }
      if (d) morceaux.push(d + 'Z')
    }
    if (morceaux.length) traits.push({ code, d: morceaux.join('') })
  }
  if (!traits.length) return

  const marge = 0.04
  const w = maxX - minX, h = maxY - minY
  const svg = svgEl('svg', {
    viewBox: `${minX - marge} ${minY - marge} ${w + marge * 2} ${h + marge * 2}`,
    class: 'carte-depts__svg',
    role: 'img',
    'aria-label': 'Carte du territoire couvert par Armana',
  })

  const selection = getSelection()
  for (const t of traits) {
    const p = svgEl('path', { d: t.d, class: 'carte-depts__dept' })
    p.dataset.code = t.code
    if (selection.includes(t.code)) p.classList.add('is-active')
    const enPlus = classe?.(t.code)
    if (enPlus) p.classList.add(...enPlus.split(' ').filter(Boolean))
    if (onPick) {
      p.classList.add('is-clickable')
      p.addEventListener('click', () => onPick(t.code))
    }
    svg.appendChild(p)
    if (!avecNumeros) continue
    // Le numéro au centre du rectangle englobant du département : suffisant
    // pour se repérer, et sans le coût d'un vrai calcul de centroïde.
    const bb = boite(t.d)
    const txt = svgEl('text', {
      x: bb.cx,
      y: bb.cy,
      class: 'carte-depts__num',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    })
    txt.textContent = t.code
    txt.dataset.code = t.code
    svg.appendChild(txt)
  }
  hote.appendChild(svg)
}

function boite(d) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
    const x = Number(m[1]), y = Number(m[2])
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}
