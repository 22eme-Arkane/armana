// Armana — les communes de la région, d'après la liste officielle
// (public/data/communes-paca.json, tirée de geo.api.gouv.fr).
//
// Sert à deux choses :
//  - CHOISIR une commune au lieu de la taper (planning des food trucks,
//    publication d'un événement) — pas de faute, pas de « 04300 » seul ;
//  - RETROUVER la commune des événements publiés avant ce choix, dont
//    l'adresse est un texte libre (code postal, nom, ou point sur la carte).

let promesse = null
let liste = null

/** [{nom, dept, cp, lat, lng, cle}] — chargé une fois, mis en cache. */
export function chargerCommunes() {
  promesse ??= fetch('/data/communes-paca.json')
    .then((r) => {
      if (!r.ok) throw new Error('liste des communes indisponible')
      return r.json()
    })
    .then((brut) => {
      liste = brut.map(([nom, dept, cp, lat, lng]) => ({ nom, dept, cp, lat, lng, cle: normaliser(nom) }))
      return liste
    })
    .catch((e) => {
      promesse = null // on retentera à la prochaine demande
      throw e
    })
  return promesse
}

/** Sans accents, sans tirets ni apostrophes : « st-etienne » trouve « Saint-Étienne ». */
export function normaliser(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Les communes dont le nom commence (puis contient) la saisie. */
export function rechercher(communes, saisie, max = 8) {
  const q = normaliser(saisie)
  if (q.length < 2) return []
  // Le début du nom d'abord, les noms courts en tête : « Forcal » propose
  // Forcalquier avant Forcalqueiret.
  const debut = communes.filter((c) => c.cle.startsWith(q)).sort((a, b) => a.cle.length - b.cle.length)
  const dedans = communes.filter((c) => !c.cle.startsWith(q) && c.cle.includes(q))
  return [...debut, ...dedans].slice(0, max)
}

/** Distance approchée (degrés, corrigée de la latitude) — pour comparer, pas mesurer. */
function ecart(c, lat, lng) {
  const dx = (c.lng - lng) * Math.cos((lat * Math.PI) / 180)
  const dy = c.lat - lat
  return dx * dx + dy * dy
}

/** La commune dont le centre est le plus proche du point, à 15 km au plus. */
export function communeLaPlusProche(communes, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  let meilleure = null
  let min = Infinity
  for (const c of communes) {
    const e = ecart(c, lat, lng)
    if (e < min) {
      min = e
      meilleure = c
    }
  }
  // 0,135° ≈ 15 km : au-delà, le point est hors de la région.
  return min <= 0.135 * 0.135 ? meilleure : null
}

/**
 * La commune citée dans une adresse en texte libre.
 *  1. Un nom de commune présent dans le texte (le plus long l'emporte :
 *     « Saint-Étienne-les-Orgues » plutôt que « Orgues ») ;
 *  2. sinon, le code postal — et s'il en couvre plusieurs (04300 : Forcalquier,
 *     Mane, Dauphin…), la plus proche du point.
 */
export function communeDansLeTexte(communes, texte, lat = null, lng = null) {
  const t = ` ${normaliser(texte)} `
  if (!t.trim()) return null
  // ⚠ PLUSIEURS NOMS PEUVENT APPARAÎTRE : « Route de Manosque, 04300
  // Forcalquier ». Avec un point sur la carte, la plus proche l'emporte ;
  // sans point, le nom le plus long.
  let trouvees = communes.filter((c) => c.cle.length >= 3 && t.includes(` ${c.cle} `))
  // ⚠ UN NOM LOINTAIN EST UN HOMONYME : « 04600 saint auban » désigne
  // Château-Arnoux-Saint-Auban (04), pas la commune de Saint-Auban (06). Avec
  // un point sur la carte, on écarte tout nom à plus de 15 km de lui.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    trouvees = trouvees.filter((c) => ecart(c, lat, lng) <= 0.135 * 0.135)
  }
  if (trouvees.length) {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return trouvees.reduce((a, b) => (ecart(a, lat, lng) <= ecart(b, lat, lng) ? a : b))
    }
    return trouvees.reduce((a, b) => (b.cle.length > a.cle.length ? b : a))
  }
  // Nom composé abrégé : « Saint Auban » pour Château-Arnoux-Saint-Auban,
  // « Saint Etienne » pour Saint-Étienne-les-Orgues. On cherche, PRÈS DU
  // POINT seulement, une commune dont les deux derniers (ou deux premiers)
  // mots figurent dans le texte.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const proches = communes.filter((c) => ecart(c, lat, lng) <= 0.135 * 0.135)
    const abregee = proches.find((c) => {
      const mots = c.cle.split(' ')
      if (mots.length < 3) return false
      return t.includes(` ${mots.slice(-2).join(' ')} `) || t.includes(` ${mots.slice(0, 2).join(' ')} `)
    })
    if (abregee) return abregee
  }
  const cp = String(texte).match(/\b(0[4-6]|13|83|84)\d{3}\b/)?.[0]
  if (!cp) return null
  const memes = communes.filter((c) => c.cp === cp)
  if (memes.length <= 1 || !Number.isFinite(lat)) return memes[0] ?? null
  return memes.reduce((a, b) => (ecart(a, lat, lng) <= ecart(b, lat, lng) ? a : b))
}

/**
 * La commune d'un événement, pour l'affichage : la colonne `city` (migration
 * 0035) si elle est remplie, sinon devinée depuis l'adresse puis le point.
 * @returns {string|null}
 */
export function villeDeLEvenement(ev, communes) {
  if (ev.city) return ev.city
  if (!communes) return null
  const lat = Number(ev.lat)
  const lng = Number(ev.lng)
  return (
    communeDansLeTexte(communes, ev.address, lat, lng)?.nom ??
    communeLaPlusProche(communes, lat, lng)?.nom ??
    null
  )
}
