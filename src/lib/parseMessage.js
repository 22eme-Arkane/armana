// Armana — extraction d'un événement depuis un message texte (WhatsApp…).
//
// 100 % LOCAL, gratuit, sans API : chrono-node pour la date (français), + heuristiques
// simples pour titre / prix / catégorie / ville. Best-effort : l'utilisateur corrige
// ensuite dans le formulaire pré-rempli. Rien n'est envoyé nulle part.
import * as chrono from 'chrono-node'

// Villes fréquentes du 04 (repérage d'un lieu approximatif dans le texte).
const CITIES_04 = [
  'Digne-les-Bains', 'Digne', 'Manosque', 'Sisteron', 'Forcalquier',
  'Château-Arnoux', 'Saint-Auban', 'Oraison', 'Riez', 'Barcelonnette',
  'Gréoux-les-Bains', 'Gréoux', 'Les Mées', 'Volx', 'Peyruis', 'Sainte-Tulle',
  'Valensole', 'Banon', 'Villeneuve', 'Malijai', 'Seyne', 'Seyne-les-Alpes',
  'Saint-André-les-Alpes', 'Castellane', 'Moustiers-Sainte-Marie', 'La Motte-du-Caire',
  'Volonne', 'Mane', 'Reillanne', 'Simiane-la-Rotonde', 'Annot', 'Entrevaux',
]

// Mots-clés → catégorie (première correspondance).
// ⚠ L'ORDRE COMPTE. Les tournures précises des Ateliers et de la Vie locale
// (14/11/2026) passent AVANT les règles générales : « stage de chant » est un
// atelier, pas un concert ; « vide-grenier » n'est plus rangé en Marché.
const CAT_RULES = [
  ['Cours de danse', /\b(cours|atelier|stage|initiation) de danse\b/i],
  ['Cours de musique', /\b(cours|atelier|stage) de (musique|guitare|piano|percussions?|violon|batterie)\b/i],
  ['Cours de théâtre', /\b(cours|atelier|stage) (de |d')?(th[eé][aâ]tre|impro)/i],
  ['Chant', /\b(cours|atelier|stage) de chant\b/i],
  ['Peinture', /\b(atelier|stage|cours) (de )?peinture\b|\baquarelle\b/i],
  ['Dessin', /\b(atelier|stage|cours) (de )?dessin\b/i],
  ['Écriture', /\batelier d['’][eé]criture\b/i],
  ['Poterie', /\b(poterie|c[eé]ramique|modelage)\b/i],
  ['Couture', /\b(couture|tricot|broderie)\b/i],
  ['Cuisine', /\b(atelier|cours) (de )?cuisine\b/i],
  ['Photo', /\b(atelier|stage) photo\b/i],
  ['Club de lecture', /\b(club de lecture|arpentage)\b/i],
  ['Yoga', /\byoga\b/i],
  ['Méditation', /\bm[eé]ditation\b/i],
  ['Qi gong', /\b(qi[- ]?gong|ta[iï][- ]?chi)\b/i],
  ['Sophrologie', /\bsophro/i],
  ['Vide-grenier', /\bvide[- ]?greniers?\b/i],
  ['Brocante', /\bbrocante\b/i],
  ['Bourse & troc', /\b(bourse aux|troc)\b/i],
  ['Pétanque', /\b(p[eé]tanque|concours de boules)\b/i],
  ['Fête votive', /\bf[eê]te votive\b/i],
  ['Bal populaire', /\bbal populaire\b/i],
  ['Carnaval', /\bcarnaval\b/i],
  ['Fête & loto', /\bloto\b/i],
  ['Randonnée', /\brandonn[eé]e\b/i],
  ['Commémoration', /\bcomm[eé]moration\b/i],
  ['Portes ouvertes', /\bportes? ouvertes?\b/i],
  ['Musique', /\b(concert|musique|chant|chorale|dj|fanfare|jazz|rock|lyrique|classique|apéro[- ]?concert)\b/i],
  ['Spectacles vivants', /\b(spectacle|cirque|arts de la rue|déambulation)\b/i],
  ['Théâtre', /\b(th[eé][aâ]tre|pi[eè]ce|impro)\b/i],
  ['Danse', /\b(danse|bal|dansant|guinguette)\b/i],
  ['Exposition', /\b(expo|exposition|vernissage|galerie)\b/i],
  ['Cinéma', /\b(cin[eé]ma|film|projection|court[- ]métrage)\b/i],
  ['Atelier', /\b(atelier|stage|initiation)\b/i],
  ['Festival', /\b(festival|f[eê]te de|feria)\b/i],
  ['Conférence', /\b(conf[eé]rence|d[eé]bat|rencontre|caf[eé][- ]philo)\b/i],
  // ⚠ Pas de `\b` après le « é » : pour JavaScript, une lettre accentuée n'est
  // pas une lettre, et « Marché de producteurs » n'était jamais reconnu.
  ['Marché', /\bmarch[eé]s?(?![a-zà-ÿ])/i],
  ['Foire & salon', /\b(foire|salon)\b/i],
]

function detectCategory(text) {
  for (const [cat, re] of CAT_RULES) if (re.test(text)) return cat
  return ''
}

function detectCity(text) {
  const low = text.toLowerCase()
  for (const city of CITIES_04) {
    if (low.includes(city.toLowerCase())) return city
  }
  return ''
}

function detectPrice(text) {
  if (/\b(gratuit|entr[eé]e libre|acc[eè]s libre|prix libre)\b/i.test(text)) {
    return { is_paid: false, price: null }
  }
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/i)
  if (m) return { is_paid: true, price: Number(m[1].replace(',', '.')) }
  return { is_paid: false, price: null }
}

function detectTitle(text) {
  const firstLine = (text.split(/\r?\n/).map((l) => l.trim()).find(Boolean)) || ''
  // Garde une ligne raisonnable ; sinon la 1re phrase.
  if (firstLine.length <= 80) return firstLine
  const sentence = firstLine.split(/[.!?]/)[0]
  return (sentence || firstLine).slice(0, 80).trim()
}

/**
 * Analyse un message → brouillon d'événement (champs best-effort).
 * @returns {{title,description,starts_at,ends_at,is_paid,price,address,category,
 *            matched:{date:boolean,price:boolean,city:boolean,category:boolean}}}
 */
export function parseEventMessage(text) {
  const clean = (text || '').trim()
  const now = new Date()
  const results = clean ? chrono.fr.parse(clean, now, { forwardDate: true }) : []
  const first = results[0]
  const starts = first?.start?.date() ?? null
  const ends = first?.end?.date() ?? null

  const { is_paid, price } = detectPrice(clean)
  // « Participation au chapeau », « passage du chapeau » : un complément du
  // tarif, qui se coche à part dans le formulaire (migration 0032).
  const au_chapeau = /\bchapeau\b/i.test(clean)
  const city = detectCity(clean)
  const category = detectCategory(clean)

  return {
    title: detectTitle(clean),
    description: clean,
    starts_at: starts ? starts.toISOString() : null,
    ends_at: ends ? ends.toISOString() : null,
    is_paid,
    price,
    au_chapeau,
    address: city,
    category,
    matched: {
      date: Boolean(starts),
      price: Boolean(price),
      city: Boolean(city),
      category: Boolean(category),
    },
  }
}
