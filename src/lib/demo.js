// Armana — démonstration des food trucks, pour RELIRE l'interface sans rien
// écrire en base.
//
// Activée par `?demo=1` dans l'adresse (désactivée par `?demo=0`), et
// SEULEMENT en local ou sur une préversion Vercel : jamais sur armana.app ni
// sur armana04.vercel.app, où de faux camions tromperaient le public.
// Les données ci-dessous n'existent que dans le navigateur qui les affiche.
const CLE = 'armana-demo'

function hoteAutorise() {
  const h = location.hostname
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    // Préversions : armana-<hash>-22eme-arkane-com.vercel.app
    /^armana-[a-z0-9]+-22eme-arkane-com\.vercel\.app$/.test(h)
  )
}

;(() => {
  try {
    const p = new URLSearchParams(location.search).get('demo')
    if (p === '1') sessionStorage.setItem(CLE, '1')
    if (p === '0') sessionStorage.removeItem(CLE)
  } catch {
    /* stockage indisponible : pas de démonstration */
  }
})()

export function demoActif() {
  if (!hoteAutorise()) return false
  try {
    return sessionStorage.getItem(CLE) === '1'
  } catch {
    return false
  }
}

/** Jour ISO d'aujourd'hui à Paris (lundi = 1). */
function aujourdhui() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  const d = new Date(ymd + 'T12:00:00')
  return ((d.getDay() + 6) % 7) + 1
}

/** Une image de remplacement (SVG) : aplat de couleur, camion, légende. */
function image(fond, texte) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
    <rect width="800" height="500" fill="${fond}"/>
    <g transform="translate(310 130) scale(7.5)" fill="none" stroke="#fff4df" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
      <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
    </g>
    <text x="400" y="440" text-anchor="middle" font-family="sans-serif" font-size="34"
          font-weight="700" fill="#fff4df">${texte}</text>
  </svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const LIEUX = {
  dauphin: { place_label: 'Dauphin', lat: 43.8947, lng: 5.7765 },
  orgues: { place_label: 'Saint-Étienne-les-Orgues', lat: 44.0648, lng: 5.7798 },
  forcalquier: { place_label: 'Forcalquier', lat: 43.9582, lng: 5.7842 },
  manosque: { place_label: 'Manosque', lat: 43.8293, lng: 5.7896 },
  sisteron: { place_label: 'Sisteron', lat: 44.1993, lng: 5.9276 },
  mane: { place_label: 'Mane', lat: 43.9426, lng: 5.7419 },
}

/**
 * Les camions de démonstration. Le premier reprend la fiche de test de
 * Mateo (El Serpiente de Oro), remise au propre : menu plat par plat,
 * planning choisi (lundi Dauphin, mercredi Saint-Étienne-les-Orgues).
 * Chacun a aussi un créneau AUJOURD'HUI, quel que soit le jour, pour que la
 * carte en montre toujours.
 */
function camions() {
  const j = aujourdhui()
  return [
    {
      id: 'demo-serpiente',
      kind: 'food_truck',
      status: 'approved',
      owner_id: 'demo',
      name: 'El Serpiente de Oro',
      cuisine: 'Souris grillées',
      description: 'Des souris de toute la région. Des bons produits, uniques au goût.',
      website: 'https://22eme-arkane.com',
      contact: null,
      address: 'Forcalquier',
      menu: 'Souris Farsi — 14 €\nSouris fraîche — 8 €\nSouris des villes — 2 €\nSouris des champs — 8 €',
      photo_url: image('#1d3b2a', 'El Serpiente de Oro'),
      product_photo_url: image('#7a5a12', 'Le menu du jour'),
      gallery_urls: [image('#26784c', 'Le camion'), image('#0b55c5', 'Au marché'), image('#f04b2f', 'Le comptoir')],
      creneaux: [
        { weekday: 1, start_time: '11:30:00', end_time: '14:00:00', ...LIEUX.dauphin },
        { weekday: 3, start_time: '18:30:00', end_time: '22:00:00', ...LIEUX.orgues },
        ...(j === 1 || j === 3
          ? []
          : [{ weekday: j, start_time: '18:30:00', end_time: '22:30:00', ...LIEUX.forcalquier }]),
      ],
    },
    {
      id: 'demo-crepes',
      kind: 'food_truck',
      status: 'approved',
      owner_id: 'demo',
      name: 'La Roulotte à Crêpes',
      cuisine: 'Crêpes et galettes',
      description: 'Galettes au sarrasin bio et crêpes de toujours.',
      website: null,
      contact: null,
      address: 'Manosque',
      menu: 'Galette complète — 9 €\nGalette chèvre miel — 10 €\nCrêpe sucre — 3,50 €\nCrêpe caramel beurre salé — 5 €',
      photo_url: image('#b0462f', 'La Roulotte à Crêpes'),
      product_photo_url: null,
      gallery_urls: [image('#c98a1b', 'La roulotte')],
      creneaux: [
        { weekday: j, start_time: '11:30:00', end_time: '14:00:00', ...LIEUX.manosque },
        { weekday: (j % 7) + 1, start_time: '17:00:00', end_time: '21:00:00', ...LIEUX.mane },
      ],
    },
    {
      id: 'demo-pizza',
      kind: 'food_truck',
      status: 'approved',
      owner_id: 'demo',
      name: 'Pizza du Lure',
      cuisine: 'Pizzas au feu de bois',
      description: 'Pâte maison, four à bois, produits du coin.',
      website: null,
      contact: null,
      address: 'Sisteron',
      menu: 'Margherita — 10 €\nReine — 12 €\nQuatre fromages — 13 €\nCalzone — 13 €',
      photo_url: image('#8a2b1f', 'Pizza du Lure'),
      product_photo_url: null,
      gallery_urls: [],
      creneaux: [{ weekday: j, start_time: '18:00:00', end_time: '21:30:00', ...LIEUX.sisteron }],
    },
  ]
}

/** Une fiche de démonstration, ou null (identifiant réel, ou démo coupée). */
export function demoFiche(id) {
  if (!demoActif() || !String(id).startsWith('demo-')) return null
  const c = camions().find((x) => x.id === id)
  if (!c) return null
  const { creneaux, ...fiche } = c
  return { ...fiche, gallery_paths: [] }
}

/** Le planning public d'un camion de démonstration. */
export function demoPlanning(id) {
  const c = demoActif() && camions().find((x) => x.id === id)
  if (!c) return null
  return {
    creneaux: c.creneaux.map((s, i) => ({ id: `${id}-${i}`, truck_id: id, ...s })),
    exceptions: [],
  }
}

/** Les présences du jour, au format de `food_trucks_today`. */
export function demoPresences() {
  if (!demoActif()) return []
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  return demoPresencesPeriode(ymd, ymd)
}

/** Les présences entre deux dates, au format de `food_trucks_periode`. */
export function demoPresencesPeriode(debut, fin) {
  if (!demoActif()) return []
  const out = []
  const d = new Date(debut + 'T12:00:00')
  const f = new Date(fin + 'T12:00:00')
  for (let n = 0; d <= f && n < 32; n++, d.setDate(d.getDate() + 1)) {
    const ymd = d.toLocaleDateString('en-CA')
    const j = ((d.getDay() + 6) % 7) + 1
    for (const c of camions()) {
      c.creneaux.forEach((s, i) => {
        if (s.weekday !== j) return
        out.push({
          jour: ymd,
          ...presence(c, s, i),
        })
      })
    }
  }
  return out
}

function presence(c, s, i) {
  return {
    truck_id: c.id,
    name: c.name,
    cuisine: c.cuisine,
    photo_url: c.photo_url,
    slot_id: `${c.id}-${i}`,
    exception_id: null,
    start_time: s.start_time,
    end_time: s.end_time,
    place_label: s.place_label,
    lat: s.lat,
    lng: s.lng,
    event_id: null,
  }
}
