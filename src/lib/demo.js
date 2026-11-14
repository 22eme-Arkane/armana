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

/**
 * Les fausses données des écrans d'administration (lib/demoGestion.js),
 * chargées à la demande : elles n'entrent pas dans le paquet principal.
 * Usage : `if (demoActif()) return (await demoGestion()).listMembers()`.
 */
export const demoGestion = () => import('./demoGestion.js')

const PICTOS = {
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>' +
    '<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>' +
    '<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
    '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
}

/** Une image de remplacement (SVG) : aplat de couleur, pictogramme, légende. */
export function image(fond, texte, picto = 'truck') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
    <rect width="800" height="500" fill="${fond}"/>
    <g transform="translate(310 130) scale(7.5)" fill="none" stroke="#fff4df" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round">${PICTOS[picto] ?? PICTOS.truck}</g>
    <text x="400" y="440" text-anchor="middle" font-family="sans-serif" font-size="34"
          font-weight="700" fill="#fff4df">${String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  </svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const LIEUX = {
  dauphin: { place_label: 'Dauphin', lat: 43.8947, lng: 5.7765 },
  orgues: { place_label: 'Saint-Étienne-les-Orgues', lat: 44.0648, lng: 5.7798 },
  forcalquier: { place_label: 'Forcalquier', place_hint: 'Parking Gamm Vert', lat: 43.9582, lng: 5.7842 },
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

/** Les camions de démonstration, au format d'une recherche de fiches. */
export function demoCamions() {
  if (!demoActif()) return []
  const depts = { Forcalquier: '04', Manosque: '04', Sisteron: '04' }
  return camions().map((c) => ({ id: c.id, name: c.name, cuisine: c.cuisine, dept: depts[c.address] ?? null }))
}

/**
 * Les associations de démonstration (14/11/2026), pour voir l'annuaire et la
 * fiche avant la migration 0041. Noms inventés.
 */
function associations() {
  const base = { kind: 'association', status: 'approved', owner_id: 'demo', menu: null, cuisine: null, product_photo_url: null, gallery_urls: [] }
  return [
    {
      ...base,
      id: 'demo-asso-yoga',
      name: 'Souffle & Lumière',
      domaine: 'Bien-être',
      description: 'Association de yoga et de méditation : cours collectifs toute l’année, stages en été, ouverts aux débutants.',
      opening_hours: 'Hatha yoga le mardi à 18 h 30 et le jeudi à 9 h 30, salle des fêtes.\nMéditation le dimanche à 10 h.',
      address: 'Salle des fêtes, 04300 Forcalquier',
      website: null,
      contact: '06 00 00 00 00',
      dept: '04',
      lat: 43.9601,
      lng: 5.7808,
      photo_url: image('#0b55c5', 'Souffle & Lumière', 'users'),
    },
    {
      ...base,
      id: 'demo-asso-foot',
      name: 'Union sportive du Luberon',
      domaine: 'Sport',
      description: 'Club de football amateur : école de foot dès 6 ans, équipes seniors et vétérans. Tournoi de printemps chaque année.',
      opening_hours: 'Entraînements le mercredi à 14 h (enfants) et le vendredi à 19 h (adultes), stade municipal.',
      address: 'Stade municipal, 04100 Manosque',
      website: null,
      contact: 'contact@exemple.org',
      dept: '04',
      lat: 43.8341,
      lng: 5.7838,
      photo_url: image('#26784c', 'US Luberon', 'users'),
    },
    {
      ...base,
      id: 'demo-asso-jardin',
      name: 'Les Jardins partagés de Mane',
      domaine: 'Environnement',
      description: 'Un jardin collectif, des ateliers de semis et de compost, une grainothèque. Tout le monde peut venir mettre les mains dans la terre.',
      opening_hours: 'Jardinage collectif le samedi de 9 h à 12 h.',
      address: 'Chemin des Jardins, 04300 Mane',
      website: null,
      contact: null,
      dept: '04',
      lat: 43.9381,
      lng: 5.7466,
      photo_url: image('#062b1d', 'Jardins partagés', 'users'),
    },
    {
      ...base,
      id: 'demo-asso-fetes',
      name: 'Comité des fêtes de Sisteron',
      domaine: 'Loisirs',
      description: 'Bals, lotos, fête votive et marché de Noël : le comité anime le village toute l’année.',
      opening_hours: null,
      address: '04200 Sisteron',
      website: null,
      contact: null,
      dept: '04',
      lat: 44.1953,
      lng: 5.9441,
      photo_url: image('#f04b2f', 'Comité des fêtes', 'users'),
    },
    ...associationsEnNombre(),
  ]
}

/**
 * Une soixantaine d'associations de plus, réparties sur toute la France, pour
 * juger l'annuaire quand il y en a BEAUCOUP (Matthieu : « pas de liste
 * infinie »). Noms génériques, inventés ; aucune n'existe dans la base.
 */
function associationsEnNombre() {
  const villes = [
    ['04', 'Digne-les-Bains'], ['05', 'Gap'], ['05', 'Briançon'], ['06', 'Nice'], ['06', 'Antibes'],
    ['13', 'Marseille'], ['13', 'Aix-en-Provence'], ['13', 'Arles'], ['83', 'Toulon'], ['83', 'Hyères'],
    ['84', 'Avignon'], ['84', 'Apt'], ['26', 'Valence'], ['26', 'Die'], ['69', 'Lyon'], ['38', 'Grenoble'],
    ['75', 'Paris'], ['33', 'Bordeaux'], ['29', 'Brest'], ['67', 'Strasbourg'], ['31', 'Toulouse'], ['44', 'Nantes'],
  ]
  const modeles = [
    ['Sport', 'Football club de {v}'],
    ['Bien-être', 'Yoga et respiration, {v}'],
    ['Culture & arts', 'Atelier théâtre de {v}'],
    ['Solidarité', 'Entraide {v}'],
    ['Environnement', 'Les Amis du jardin de {v}'],
    ['Enfance & jeunesse', 'Ludothèque de {v}'],
    ['Loisirs', 'Club de pétanque de {v}'],
  ]
  const teintes = ['#0b55c5', '#26784c', '#f04b2f', '#062b1d']
  const out = []
  villes.forEach(([dept, ville], i) => {
    for (const k of [i, i + 3, i + 5]) {
      const [domaine, modele] = modeles[k % modeles.length]
      const name = modele.replace('{v}', ville)
      out.push({
        kind: 'association',
        status: 'approved',
        owner_id: 'demo',
        id: `demo-asso-${dept}-${i}-${k}`,
        name,
        domaine,
        description: 'Association de démonstration.',
        opening_hours: null,
        address: ville,
        website: null,
        contact: null,
        dept,
        photo_url: image(teintes[(i + k) % teintes.length], name.split(' ').slice(0, 3).join(' '), 'users'),
        menu: null,
        cuisine: null,
        product_photo_url: null,
        gallery_urls: [],
      })
    }
  })
  return out
}

export function demoAssociations() {
  return demoActif() ? associations() : []
}

/** Une fiche de démonstration, ou null (identifiant réel, ou démo coupée). */
export function demoFiche(id) {
  if (!demoActif() || !String(id).startsWith('demo-')) return null
  const asso = associations().find((x) => x.id === id)
  if (asso) return { ...asso, gallery_paths: [] }
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
    place_hint: s.place_hint ?? null,
    lat: s.lat,
    lng: s.lng,
    event_id: null,
  }
}
