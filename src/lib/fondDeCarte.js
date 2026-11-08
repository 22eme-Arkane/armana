// Armana — le fond de carte maison (07/11/2026).
//
// Matthieu voulait une carte « à nous » : plus simple (ni routes ni relief),
// plus colorée, plus festive, avec les noms des villes et des villages. Les
// tuiles OpenStreetMap habituelles sont des IMAGES toutes faites, impossibles
// à recolorer. On passe donc aux tuiles VECTORIELLES d'OpenFreeMap — gratuites,
// sans clé ni inscription, données OpenStreetMap — dessinées par MapLibre selon
// NOTRE style, ci-dessous.
//
// ⚠ Leaflet reste le moteur de la carte (repères, masque, food trucks…) :
// MapLibre ne fait QUE le fond, via @maplibre/maplibre-gl-leaflet. Toute la
// mécanique existante est intacte.
//
// ⚠ CHARGÉ À LA DEMANDE (import dynamique) : MapLibre pèse ~250 Ko compressés,
// inutile de les imposer à qui ne fait qu'ouvrir l'agenda. Sans WebGL (vieux
// téléphone), on retombe sur les tuiles OpenStreetMap d'avant.

import { departementDuPoint, loadFranceAllegee } from './departements.js'

const NOM = ['coalesce', ['get', 'name:fr'], ['get', 'name']]

const COULEURS = {
  terre: '#fff6dc', // crème chaud, celui de l'application
  ville: '#ffe1bd', // pêche : les zones habitées
  bois: '#c8edb0',
  parc: '#b6e69c',
  eau: '#5db4ff',
  region: '#f04b2f', // corail : les frontières des régions
  pays: '#0b55c5',
  encre: '#062b1d',
  bourg: '#1f6b42',
  village: '#6b3f8f',
  halo: '#ffffff',
}

export const STYLE_ARMANA = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: 'terre', type: 'background', paint: { 'background-color': COULEURS.terre } },
    {
      id: 'habite',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail']]],
      paint: { 'fill-color': COULEURS.ville, 'fill-opacity': 0.8 },
    },
    {
      id: 'bois',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': COULEURS.bois, 'fill-opacity': 0.6 },
    },
    {
      id: 'parc',
      type: 'fill',
      source: 'omt',
      'source-layer': 'park',
      paint: { 'fill-color': COULEURS.parc, 'fill-opacity': 0.55 },
    },
    {
      id: 'eau',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      paint: { 'fill-color': COULEURS.eau },
    },
    {
      id: 'rivieres',
      type: 'line',
      source: 'omt',
      'source-layer': 'waterway',
      minzoom: 8,
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      paint: {
        'line-color': COULEURS.eau,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 3],
      },
    },
    {
      id: 'regions',
      type: 'line',
      source: 'omt',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': COULEURS.region,
        // Trait PLEIN et net (Matthieu, 07/11/2026), sous les noms.
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 12, 2.5],
        'line-opacity': 0.8,
      },
    },
    {
      id: 'pays',
      type: 'line',
      source: 'omt',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': COULEURS.pays, 'line-width': 2.2 },
    },
    {
      id: 'mers',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'water_name',
      layout: {
        'text-field': NOM,
        'text-font': ['Noto Sans Italic'],
        'text-size': 13,
      },
      paint: { 'text-color': '#1c5fae', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1.2 },
    },
    etiquette('hameaux', ['hamlet'], 13, ['Noto Sans Regular'], [13, 10, 16, 13], COULEURS.village),
    etiquette('villages', ['village'], 10, ['Noto Sans Bold'], [10, 10, 15, 15], COULEURS.village),
    etiquette('bourgs', ['town'], 7, ['Noto Sans Bold'], [7, 11, 13, 18], COULEURS.bourg),
    etiquette('villes', ['city'], 4, ['Noto Sans Bold'], [4, 12, 11, 22], COULEURS.encre),
  ],
}

/** Une couche de noms de lieux : classe, zoom d'apparition, taille, couleur. */
function etiquette(id, classes, minzoom, police, [z1, t1, z2, t2], couleur) {
  return {
    id,
    type: 'symbol',
    source: 'omt',
    'source-layer': 'place',
    minzoom,
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: {
      'text-field': NOM,
      'text-font': police,
      'text-size': ['interpolate', ['linear'], ['zoom'], z1, t1, z2, t2],
      'text-max-width': 8,
      // Les plus grandes d'abord quand la place manque.
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: {
      'text-color': couleur,
      'text-halo-color': COULEURS.halo,
      'text-halo-width': 2,
      'text-halo-blur': 0.5,
    },
  }
}

function webglDisponible() {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Attend que la carte MapLibre ait chargé son style. */
function quandPret(ml) {
  return ml.isStyleLoaded() ? Promise.resolve() : new Promise((ok) => ml.once('load', ok))
}

/**
 * Le motif du dehors : fond bleu Armana et deux logos inclinés — le même que
 * l'ancien masque SVG, sans les « éclairs » (retirés à la demande de Matthieu).
 * Dessiné une fois sur un canevas, puis donné à MapLibre comme motif.
 */
async function ajouterMotif(ml) {
  if (ml.hasImage('motif-armana')) return
  const logo = new Image()
  logo.src = '/icons/armana-logo.png'
  await logo.decode().catch(() => null)
  const r = 2 // densité : net sur les écrans fins
  const c = document.createElement('canvas')
  c.width = 132 * r
  c.height = 118 * r
  const g = c.getContext('2d')
  g.scale(r, r)
  g.fillStyle = '#0b55c5'
  g.fillRect(0, 0, 132, 118)
  const poser = (x, y, t, angle, alpha) => {
    if (!logo.naturalWidth) return
    g.save()
    g.globalAlpha = alpha
    g.translate(x + t / 2, y + t / 2)
    g.rotate((angle * Math.PI) / 180)
    g.drawImage(logo, -t / 2, -t / 2, t, t)
    g.restore()
  }
  poser(8, 8, 46, -9, 0.9)
  poser(74, 61, 39, 11, 0.72)
  ml.addImage('motif-armana', g.getImageData(0, 0, c.width, c.height), { pixelRatio: r })
}

/** Largeur (px) de la bande de bleu UNI qui borde le territoire : les logos du
 *  motif collés au bord gênaient la lecture (Matthieu, 07/11/2026). */
const BANDE_PX = 34
/** Logos Armana sur le bleu du dehors : retirés le 07/11/2026 (trop chargé). */
const AVEC_MOTIF = false
const COUCHES_NOMS = ['mers', 'hameaux', 'villages', 'bourgs', 'villes']

/** Oriente un anneau [lng, lat] : sens trigonométrique si `direct`. */
function orienter(anneau, direct) {
  let aire = 0
  for (let i = 0; i < anneau.length - 1; i++) {
    aire += anneau[i][0] * anneau[i + 1][1] - anneau[i + 1][0] * anneau[i][1]
  }
  // ⚠ Parenthèses indispensables : `aire > 0 === direct` se lit
  // `aire > (0 === direct)` et ignorait `direct` — les trous n'étaient
  // jamais retournés.
  return (aire > 0) === direct ? anneau : [...anneau].reverse()
}

/**
 * Le POURTOUR du territoire, sans les frontières intérieures.
 *
 * Tous les contours viennent du même jeu Etalab : deux départements voisins
 * partagent EXACTEMENT les mêmes sommets. Les anneaux extérieurs orientés dans
 * le sens direct (et les trous dans l'autre), une frontière commune apparaît
 * deux fois, en sens inverse — on l'annule. Ce qui reste est le pourtour,
 * toujours orienté territoire à gauche : la bande peut donc être décalée
 * vers l'EXTÉRIEUR seulement. L'enclave des Papes (84 dans la Drôme) est
 * traitée par les trous.
 */
function pourtour(geojson) {
  const segments = new Map()
  const cle = (a, b) => `${a[0]},${a[1]};${b[0]},${b[1]}`
  for (const f of geojson.features) {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
    for (const poly of polys) {
      poly.forEach((anneau, i) => {
        const r = orienter(anneau, i === 0)
        for (let j = 0; j < r.length - 1; j++) {
          const a = r[j]
          const b = r[j + 1]
          if (a[0] === b[0] && a[1] === b[1]) continue
          const inverse = cle(b, a)
          if (segments.has(inverse)) segments.delete(inverse)
          else segments.set(cle(a, b), [a, b])
        }
      })
    }
  }
  // On renoue les segments en lignes continues : décalés un à un, ils
  // laisseraient des encoches à chaque angle.
  const parDepart = new Map()
  for (const s of segments.values()) {
    const k = s[0].join(',')
    if (!parDepart.has(k)) parDepart.set(k, [])
    parDepart.get(k).push(s)
  }
  const vus = new Set()
  const lignes = []
  for (const s of segments.values()) {
    if (vus.has(s)) continue
    vus.add(s)
    const ligne = [s[0], s[1]]
    for (;;) {
      const suite = (parDepart.get(ligne[ligne.length - 1].join(',')) ?? []).find((x) => !vus.has(x))
      if (!suite) break
      vus.add(suite)
      ligne.push(suite[1])
    }
    lignes.push(ligne)
  }
  return lignes
}

/** Logos sur le bleu du dehors : taille, écart entre eux, distance au bord. */
const LOGO_PX = 58
const LOGO_PAS_PX = 170
const LOGO_MARGE_PX = 64

/**
 * Quelques logos Armana sur le bleu, PLUS GRANDS, PLUS RARES, et jamais
 * coupés par le territoire (Matthieu, 07/11/2026 : le motif répété
 * surchargeait, l'absence de logo manquait).
 *
 * Ce ne sont plus un motif mais des POINTS : une grille ancrée au monde (les
 * logos ne glissent pas quand on déplace la carte), recalculée à chaque arrêt.
 * Un point n'est gardé que si lui ET huit points tout autour, à
 * LOGO_MARGE_PX, sont hors du territoire : le logo entier tient sur le bleu.
 */
async function poserLogos(ml, allege) {
  if (!ml.hasImage('logo-armana')) {
    const img = new Image()
    img.src = '/icons/armana-logo.png'
    await img.decode().catch(() => null)
    if (!img.naturalWidth) return
    ml.addImage('logo-armana', img)
    ml.__tailleLogo = img.naturalWidth
  }
  // ⚠ ANNEAUX EXTÉRIEURS SEULEMENT. Les trous des contours officiels sont des
  // plans d'eau (l'étang de Berre, dans le 13) : la carte les montre en eau,
  // pas sous le masque. Les compter comme « dehors » posait un logo en plein
  // étang, à côté de Martigues (vu par Matthieu le 08/11/2026).
  const zone = {
    features: allege.features.map((f) => ({
      ...f,
      geometry: {
        type: 'MultiPolygon',
        coordinates: (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).map(
          (p) => [p[0]]
        ),
      },
    })),
  }
  const W = (z) => 512 * 2 ** z
  const versMonde = ([lng, lat], z) => {
    const s = Math.sin((lat * Math.PI) / 180)
    return [((lng + 180) / 360) * W(z), (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W(z)]
  }
  const versGeo = ([x, y], z) => [
    (x / W(z)) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / W(z)))) * 180) / Math.PI,
  ]
  const dedans = ([lng, lat]) => departementDuPoint({ lat, lng }, zone) !== null

  const recalculer = () => {
    const z = ml.getZoom()
    const b = ml.getBounds()
    const [x0, y0] = versMonde([b.getWest(), b.getNorth()], z)
    const [x1, y1] = versMonde([b.getEast(), b.getSouth()], z)
    const points = []
    let ligne = Math.floor(y0 / LOGO_PAS_PX)
    for (let y = ligne * LOGO_PAS_PX; y <= y1 + LOGO_PAS_PX; y += LOGO_PAS_PX, ligne++) {
      // Une rangée sur deux décalée d'un demi-pas : un semis, pas un damier.
      const decale = ligne % 2 ? LOGO_PAS_PX / 2 : 0
      for (let x = Math.floor(x0 / LOGO_PAS_PX) * LOGO_PAS_PX - LOGO_PAS_PX + decale; x <= x1 + LOGO_PAS_PX; x += LOGO_PAS_PX) {
        const tour = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
        const libre = tour.every(([dx, dy]) => !dedans(versGeo([x + dx * LOGO_MARGE_PX, y + dy * LOGO_MARGE_PX], z)))
        if (!libre) continue
        points.push({
          type: 'Feature',
          // Inclinaison stable pour un même point : -10° ou +10°.
          properties: { angle: (Math.round(x / LOGO_PAS_PX) + ligne) % 2 ? 10 : -10 },
          geometry: { type: 'Point', coordinates: versGeo([x, y], z) },
        })
      }
    }
    const donnees = { type: 'FeatureCollection', features: points }
    if (ml.getSource('logos')) ml.getSource('logos').setData(donnees)
    else {
      ml.addSource('logos', { type: 'geojson', data: donnees })
      ml.addLayer(
        {
          id: 'logos',
          type: 'symbol',
          source: 'logos',
          layout: {
            'icon-image': 'logo-armana',
            'icon-size': LOGO_PX / (ml.__tailleLogo || 192),
            'icon-rotate': ['get', 'angle'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-opacity': 0.9 },
        },
        'mers'
      )
    }
  }
  if (ml.__recalculerLogos) ml.off('moveend', ml.__recalculerLogos)
  ml.__recalculerLogos = recalculer
  ml.on('moveend', recalculer)
  recalculer()
}

/**
 * Masque le dehors DANS la carte, SOUS les noms de lieux : une ville proche de
 * la frontière garde son nom entier, même s'il déborde sur le bleu. Le bord
 * est celui des départements, net (demande de Matthieu du 07/11/2026). Seuls
 * les lieux DU territoire gardent leur nom : Lyon ou Genève n'ont rien à faire
 * sur une carte de PACA.
 * @param {object} contours   contours COMPLETS des départements affichés
 * @param {object} allege     les mêmes, allégés : pour trier les noms
 */
async function masquerDehors(ml, contours, allege) {
  await quandPret(ml)
  if (AVEC_MOTIF) await ajouterMotif(ml)
  // ⚠ LE MONDE DANS LE SENS HORAIRE, LES TROUS DANS L'AUTRE. MapLibre range
  // les anneaux d'après leur sens : un trou orienté comme le contour devient
  // un nouveau polygone, REMPLI — des pans entiers du territoire passaient
  // ainsi sous le bleu. Les trous sont le POURTOUR (sens direct), pas les
  // départements un à un : des trous qui se touchent se triangulent mal.
  const monde = [[-180, -85], [-180, 85], [180, 85], [180, -85], [-180, -85]]
  const lignes = pourtour(contours)
  // ⚠ SEULS LES BORDS EXTÉRIEURS percent le masque. Le pourtour contient aussi
  // les TROUS des départements — l'étang de Berre dans le 13 —, orientés dans
  // l'autre sens. Un trou dans le trou se triangulait mal : un grand triangle
  // bleu recouvrait Miramas et Salon (bug signalé par Matthieu, 08/11/2026).
  // Sans eux, l'étang s'affiche simplement en eau, comme il se doit.
  const aire = (l) => {
    let s = 0
    for (let i = 0; i < l.length - 1; i++) s += l[i][0] * l[i + 1][1] - l[i + 1][0] * l[i][1]
    return s
  }
  const trous = lignes
    .map((l) => {
      const a = l[0]
      const z = l[l.length - 1]
      return a[0] === z[0] && a[1] === z[1] ? l : [...l, a]
    })
    .filter((l) => aire(l) > 0)
  const dehors = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [monde, ...trous] } }
  const bord = { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lignes } }

  if (ml.getSource('dehors')) {
    ml.getSource('dehors').setData(dehors)
    ml.getSource('bord').setData(bord)
  } else {
    ml.addSource('dehors', { type: 'geojson', data: dehors })
    ml.addSource('bord', { type: 'geojson', data: bord })
    // Juste AVANT la première couche de noms : tout ce qui est écrit passe dessus.
    // ⚠ BLEU UNI depuis le 07/11/2026 : les logos du motif « surchargeaient
    // l'espace » (Matthieu). Le motif et la bande restent dans le code, mais
    // la bande n'est posée qu'avec le motif — sur du bleu uni, elle ne sert à rien.
    ml.addLayer(
      {
        id: 'dehors',
        type: 'fill',
        source: 'dehors',
        paint: AVEC_MOTIF ? { 'fill-pattern': 'motif-armana' } : { 'fill-color': '#0b55c5' },
      },
      'mers'
    )
    if (AVEC_MOTIF) ml.addLayer(
      {
        id: 'bande',
        type: 'line',
        source: 'bord',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        // ⚠ DÉCALAGE NÉGATIF = vers l'EXTÉRIEUR, vérifié à l'écran : l'axe
        // vertical de l'écran est inversé, le territoire (à gauche du trait en
        // coordonnées géographiques) y passe à DROITE.
        paint: { 'line-color': '#0b55c5', 'line-width': BANDE_PX, 'line-offset': -BANDE_PX / 2 },
      },
      'mers'
    )
  }

  await poserLogos(ml, allege)

  // Les noms : seulement ceux des lieux situés dans le territoire.
  const zone = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: allege.features.flatMap((f) =>
        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
      ),
    },
  }
  for (const id of COUCHES_NOMS) {
    const base = STYLE_ARMANA.layers.find((l) => l.id === id)?.filter
    ml.setFilter(id, base ? ['all', base, ['within', zone]] : ['within', zone])
  }
}

/**
 * Pose le fond de carte sur une carte Leaflet.
 * Renvoie `{ maison, masquer(anneaux) }` : `maison` vaut false sur le repli
 * OpenStreetMap, et c'est alors à l'appelant de masquer le dehors lui-même.
 * @param {import('leaflet').Map} map
 * @param {typeof import('leaflet')} L
 */
export async function poserFondDeCarte(map, L) {
  if (webglDisponible()) {
    try {
      await import('maplibre-gl/dist/maplibre-gl.css')
      const module = await import('maplibre-gl')
      const maplibregl = module.default ?? module
      // ⚠ Le « worker » de MapLibre est un fichier À PART : sans lui donner
      // son adresse, Vite ne le sert pas et rien ne s'affiche (« Worker failed
      // to load »). `?url` le fait copier tel quel dans le build.
      const { default: urlWorker } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')
      maplibregl.setWorkerUrl(urlWorker)
      // Le pont cherche `maplibregl` sur window : on le lui donne.
      window.maplibregl = maplibregl
      await import('@maplibre/maplibre-gl-leaflet')
      const couche = L.maplibreGL({ style: STYLE_ARMANA, interactive: false }).addTo(map)
      const ml = couche.getMaplibreMap()
      // ⚠ INVISIBLE TANT QUE LE DEHORS N'EST PAS MASQUÉ. Sinon le monde entier
      // s'affiche un instant (contours à charger, pourtour à calculer) avant
      // d'être recouvert de bleu — vu par Matthieu avec « Toute la France ».
      const conteneur = couche.getContainer()
      conteneur.style.opacity = '0'
      conteneur.style.transition = 'opacity 0.25s ease'
      const montrer = () => (conteneur.style.opacity = '1')
      // Filet de sécurité : contours introuvables (hors ligne), on montre quand même.
      setTimeout(montrer, 8000)
      if (import.meta.env.DEV) window.__armanaFond = ml // inspection en développement
      return {
        maison: true,
        masquer: async (contours, codes) => {
          try {
            const france = await loadFranceAllegee()
            const allege = { features: france.features.filter((f) => codes.includes(f.properties.code)) }
            await masquerDehors(ml, contours, allege)
            // Le temps que le masque soit peint — sans attendre plus d'une
            // seconde et demie les tuiles lentes.
            await Promise.race([
              new Promise((ok) => ml.once('idle', ok)),
              new Promise((ok) => setTimeout(ok, 1500)),
            ])
          } finally {
            // Quoi qu'il arrive, la carte finit par apparaître.
            montrer()
          }
        },
      }
    } catch (e) {
      console.warn('[Armana] Fond de carte maison indisponible, repli OSM :', e?.message)
    }
  }
  // ⚠ PAS de `{s}` : OpenStreetMap a abandonné les sous-domaines a/b/c.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    keepBuffer: 3,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Etalab',
  }).addTo(map)
  return { maison: false, masquer: async () => {} }
}
