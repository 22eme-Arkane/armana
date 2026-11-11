// Armana — chercher une ADRESSE PRÉCISE (numéro et rue, ou un lieu par son
// nom), pour poser le repère d'un événement exactement là où il a lieu.
//
// Pourquoi (retour d'une utilisatrice, 11/11/2026) : le formulaire ne
// connaissait que la commune. Le repère tombait au centre du village, et il
// fallait le replacer au doigt sur une petite carte — sinon « Y aller »
// conduisait à la mairie, pas à la salle.
//
// Deux services gratuits, sans clé ni compte :
//   1. la Base Adresse Nationale (Géoplateforme de l'IGN) — la référence :
//      toutes les adresses de France, numéro par numéro ;
//   2. Photon (Komoot, données OpenStreetMap) — en secours. La Géoplateforme
//      répond par moments « 504 » pendant des heures (constaté le 11/11/2026) :
//      sans secours, la recherche serait morte ces jours-là. Photon connaît
//      aussi les lieux par leur nom (« Théâtre … »).
// Si les deux échouent, il reste la carte : on y pose le repère à la main.
//
// ⚠ CSP : ces deux hôtes sont dans `connect-src` (vercel.json). En ajouter un
// troisième sans l'y inscrire marcherait en local et casserait en production.

const BAN = 'https://data.geopf.fr/geocodage/search'
const PHOTON = 'https://photon.komoot.io/api/'
/** minLon, minLat, maxLon, maxLat : la métropole et la Corse. */
const CADRE_FRANCE = '-5.3,41.3,9.7,51.2'

/** Après un échec, on n'attend plus la BAN à chaque frappe pendant ce délai. */
const PAUSE_APRES_ECHEC = 120000
let banBoudeeJusqua = 0

const plat = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

/** fetch borné dans le temps, annulable par l'appelant (frappe suivante). */
async function lire(url, delai, signal) {
  const c = new AbortController()
  const annuler = () => c.abort()
  signal?.addEventListener('abort', annuler, { once: true })
  const minuteur = setTimeout(annuler, delai)
  try {
    const res = await fetch(url, { signal: c.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally {
    clearTimeout(minuteur)
    signal?.removeEventListener('abort', annuler)
  }
}

/**
 * @typedef {object} Adresse
 * @property {string} titre  ce qu'on montre en gras (« 12 Rue des Cordeliers »)
 * @property {string} rue    la ligne de rue à garder dans l'adresse ('' si aucune)
 * @property {string} lieu   le nom du lieu, quand c'en est un ('' sinon)
 * @property {string} cp
 * @property {string} ville
 * @property {number} lat
 * @property {number} lng
 */

function depuisBan(json) {
  const sortie = []
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry?.coordinates ?? []
    // Une commune entière n'est pas une adresse : le champ « Commune » s'en charge.
    if (p.type === 'municipality' || !Number.isFinite(lat) || !Number.isFinite(lng) || !p.name) continue
    sortie.push({ titre: p.name, rue: p.name, lieu: '', cp: p.postcode || '', ville: p.city || '', lat, lng })
  }
  return sortie
}

const TROP_LARGE = new Set(['country', 'state', 'county', 'city', 'district'])

function depuisPhoton(json) {
  const sortie = []
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry?.coordinates ?? []
    if (p.countrycode !== 'FR' || TROP_LARGE.has(p.type)) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    // Une rue seule arrive sous `name` ; une maison sous `housenumber` + `street`.
    const rue = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : p.type === 'street' ? p.name || '' : ''
    const lieu = p.name && p.type !== 'street' && p.name !== p.street ? p.name : ''
    const titre = lieu || rue
    if (!titre) continue
    sortie.push({
      titre,
      rue,
      lieu,
      cp: p.postcode || '',
      ville: p.city || p.town || p.village || p.locality || '',
      lat,
      lng,
    })
  }
  return sortie
}

/**
 * Cherche une adresse. Ne lève que si les DEUX services sont muets.
 *
 * @param {string} texte  ce que la personne a tapé
 * @param {object} [o]
 * @param {{nom?:string, lat?:number, lng?:number}|null} [o.pres]  la commune
 *        déjà choisie : ses homonymes lointains passent derrière
 * @param {number} [o.limite=6]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<Adresse[]>}
 */
export async function chercherAdresse(texte, { pres = null, limite = 6, signal } = {}) {
  let q = String(texte || '').trim().replace(/\s+/g, ' ')
  if (q.length < 3) return []
  // « 12 rue de la République » existe dans mille communes : on précise celle
  // qui est choisie, sauf si la personne l'a déjà écrite.
  if (pres?.nom && !plat(q).includes(plat(pres.nom))) q += ' ' + pres.nom
  const ici = Number.isFinite(pres?.lat) && Number.isFinite(pres?.lng)
  const biais = ici ? `&lat=${pres.lat.toFixed(4)}&lon=${pres.lng.toFixed(4)}` : ''
  const requete = encodeURIComponent(q)

  let trouvees = null
  if (Date.now() > banBoudeeJusqua) {
    try {
      trouvees = depuisBan(await lire(`${BAN}?q=${requete}&limit=${limite}&autocomplete=1${biais}`, 2500, signal))
    } catch (e) {
      if (signal?.aborted) throw e
      banBoudeeJusqua = Date.now() + PAUSE_APRES_ECHEC
    }
  }
  if (!trouvees?.length) {
    try {
      const secours = depuisPhoton(
        await lire(`${PHOTON}?q=${requete}&limit=${limite + 2}&lang=fr&bbox=${CADRE_FRANCE}${biais}`, 5000, signal)
      )
      trouvees = secours.length ? secours : (trouvees ?? [])
    } catch (e) {
      if (signal?.aborted || trouvees == null) throw e
    }
  }

  // Les doublons (deux entrées pour le même bâtiment) : une seule ligne.
  const vues = new Set()
  return trouvees
    .filter((a) => {
      const cle = plat(`${a.titre}|${a.rue}|${a.cp}|${a.ville}`)
      if (vues.has(cle)) return false
      vues.add(cle)
      return true
    })
    .slice(0, limite)
}
