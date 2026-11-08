// Contours administratifs officiels des départements couverts par Armana.
// Source : Etalab, contours administratifs (jeu france-geojson).
//
// ⚠ Tous les contours proviennent du MÊME jeu, non simplifié. C'est
// indispensable : deux départements voisins partagent alors exactement les
// mêmes sommets le long de leur frontière commune. Avec des versions
// simplifiées séparément, un liseré de masque apparaîtrait entre eux.
//
// Deux particularités que le code doit absolument gérer :
//  - le 84 est un MultiPolygon : le Vaucluse comprend l'enclave des Papes,
//    autour de Valréas, détachée du reste du département ;
//  - le 26 a un TROU à l'emplacement de cette enclave, qu'il entoure
//    complètement. Sans traiter les trous, Valréas serait attribuée à la Drôme.
// Tout le code ci-dessous raisonne donc en liste de polygones, chacun pouvant
// avoir des trous — jamais en polygone unique et plein.
//
// ⚠ DEPUIS L'OUVERTURE À LA FRANCE (07/11/2026), LES CONTOURS SONT DÉCOUPÉS
// PAR RÉGION : `public/data/contours/<code région>.geojson`. Un appareil ne
// télécharge que les régions qu'il affiche. Une version ALLÉGÉE de toute la
// France (`france-allege.geojson`, 71 Ko compressés) sert à trouver le
// département d'un point n'importe où, et à dessiner les vignettes.
import { REGIONS } from './territoire.js'

export { REGIONS }

/**
 * ⚠ VERSION DANS L'URL — OBLIGATOIRE, À INCRÉMENTER À CHAQUE MODIFICATION DES
 * FICHIERS DE `public/data/contours/` OU `public/data/communes/`.
 *
 * Les fichiers gardent le même nom d'une livraison à l'autre, et le service
 * worker les sert en cache d'abord : sans changer l'URL, un téléphone déjà
 * installé garderait les anciens contours indéfiniment. C'est exactement ce
 * qui est arrivé à l'ouverture de PACA le 30/08/2026.
 */
export const DONNEES_VERSION = '2026-11-07-france'

/** Tous les départements, avec le code de leur région. */
export const DEPARTEMENTS = REGIONS.flatMap((r) => r.depts.map((d) => ({ ...d, region: r.code })))
export const TOUS_DEPARTEMENTS = DEPARTEMENTS
export const CODES_DEPARTEMENTS = DEPARTEMENTS.map((d) => d.code)

/** Provence-Alpes-Côte d'Azur : la région d'origine d'Armana. */
export const PACA = '93'

/**
 * Le territoire d'avant l'ouverture à la France : PACA et la Drôme. C'est ce
 * que voient, sans rien changer, les appareils installés avant (décision de
 * Matthieu du 07/11/2026).
 */
export const TERRITOIRE_HISTORIQUE = ['04', '05', '06', '13', '26', '83', '84']

/**
 * Rectangle englobant la métropole et la Corse, pour borner la recherche
 * d'adresse (voir lib/geo.js).
 */
export const CADRE_RECHERCHE = '-5.3,51.2,9.7,41.3'

export function nomDepartement(code) {
  return DEPARTEMENTS.find((d) => d.code === code)?.nom || code
}

export function estActif(code) {
  return CODES_DEPARTEMENTS.includes(code)
}

/** Code de la région d'un département. */
export function regionDuDept(code) {
  return DEPARTEMENTS.find((d) => d.code === code)?.region ?? null
}

export function nomRegion(code) {
  return REGIONS.find((r) => r.code === code)?.nom ?? code
}

/** Les codes des départements d'une région. */
export function deptsDeRegion(code) {
  return REGIONS.find((r) => r.code === code)?.depts.map((d) => d.code) ?? []
}

/** Les régions (codes) touchées par une liste de départements. */
export function regionsDe(codes) {
  return [...new Set((codes ?? []).map(regionDuDept).filter(Boolean))]
}

/**
 * Résumé lisible d'une liste de départements : les régions complètes par leur
 * nom, les autres départements par leur numéro.
 * « Provence-Alpes-Côte d'Azur, 26 » plutôt que sept numéros.
 */
export function resumeTerritoire(codes) {
  const morceaux = []
  for (const r of REGIONS) {
    const siens = r.depts.map((d) => d.code).filter((c) => codes.includes(c))
    if (!siens.length) continue
    if (siens.length === r.depts.length) morceaux.push(r.nom)
    else morceaux.push(...siens)
  }
  return morceaux.join(', ')
}

const parRegion = new Map()

function chargerRegion(code) {
  if (!parRegion.has(code)) {
    const p = fetch(`/data/contours/${code}.geojson?v=${DONNEES_VERSION}`, { cache: 'force-cache' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Contours indisponibles (${res.status})`)
        const geojson = await res.json()
        if (!geojson?.features?.length) throw new Error('Contours invalides')
        return geojson.features
      })
      // Sans cela, un simple passage hors ligne mémorisait l'échec « à vie » :
      // l'onglet Carte restait cassé jusqu'à la fermeture complète de l'app.
      .catch((err) => {
        parRegion.delete(code)
        throw err
      })
    parRegion.set(code, p)
  }
  return parRegion.get(code)
}

/**
 * Contours COMPLETS des départements demandés — en pratique, de toutes les
 * régions qui les contiennent. Sans liste : ceux de PACA.
 */
export async function loadDepartements(codes = null) {
  const regions = codes?.length ? regionsDe(codes) : [PACA]
  const listes = await Promise.all(regions.map(chargerRegion))
  return { type: 'FeatureCollection', features: listes.flat() }
}

let allege = null

/** Contours ALLÉGÉS (~0,8 km) de toute la France : localiser, dessiner. */
export function loadFranceAllegee() {
  allege ??= fetch(`/data/contours/france-allege.geojson?v=${DONNEES_VERSION}`, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`Carte de France indisponible (${res.status})`)
      return res.json()
    })
    .catch((err) => {
      allege = null
      throw err
    })
  return allege
}

/** Polygones des départements demandés (ou de tous), à plat. */
function polygonesDe(geojson, codes = null) {
  const out = []
  for (const f of geojson?.features ?? []) {
    const code = f?.properties?.code
    if (codes && !codes.includes(code)) continue
    const g = f?.geometry
    if (!g) continue
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    for (const p of polys) out.push(p)
  }
  return out
}

/**
 * Anneaux extérieurs, sous la forme attendue par Leaflet [lat, lng].
 * Sert à la fois au tracé du contour et au masque qui cache l'extérieur.
 */
export function anneauxExterieurs(geojson, codes = null) {
  return polygonesDe(geojson, codes).map((polygone) =>
    polygone[0].map(([lng, lat]) => [lat, lng])
  )
}

/**
 * Code du département contenant ce point, ou null s'il n'est dans aucun des
 * contours fournis. Test point-dans-polygone exact : un simple rectangle
 * englobant se tromperait sur toutes les communes frontalières.
 */
export function departementDuPoint({ lat, lng }, geojson) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  for (const f of geojson?.features ?? []) {
    const g = f?.geometry
    if (!g) continue
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    const dedans = polys.some((polygone) => {
      if (!pointDansAnneau(lng, lat, polygone[0])) return false
      // Les anneaux suivants sont des trous (lacs, enclaves).
      return !polygone.slice(1).some((trou) => pointDansAnneau(lng, lat, trou))
    })
    if (dedans) return f.properties?.code ?? null
  }
  return null
}

/** Département d'un point n'importe où en France (contours allégés). */
export async function departementEnFrance(point) {
  return departementDuPoint(point, await loadFranceAllegee())
}

/** Le point est-il dans le territoire couvert (éventuellement restreint) ? */
export function estDansLeTerritoire(point, geojson, codes = null) {
  const code = departementDuPoint(point, geojson)
  if (!code) return false
  return codes ? codes.includes(code) : true
}

function pointDansAnneau(x, y, anneau) {
  let dedans = false
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i]
    const [xj, yj] = anneau[j]
    const traverse = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (traverse) dedans = !dedans
  }
  return dedans
}
