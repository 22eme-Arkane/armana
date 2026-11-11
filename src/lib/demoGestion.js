// Armana — démonstration des écrans d'ADMINISTRATION (Modération, Membres,
// Modérateurs, Journal), pour les relire sans se connecter ni rien écrire en
// base. Mêmes règles que lib/demo.js : `?demo=1`, en local ou sur une
// préversion seulement. Chargé à la demande — rien de tout ceci n'entre dans le
// paquet principal.
//
// ⚠ TOUT EST FAUX ICI, et rien ne quitte le navigateur : les « écritures »
// (nommer, approuver, supprimer) ne modifient que les tableaux ci-dessous, le
// temps de la visite.
import { image } from './demo.js'
import { filtrerActes } from './journal.js'

const JOUR = 86400000
const ilYA = (jours, heures = 0) => new Date(Date.now() - jours * JOUR - heures * 3600000).toISOString()
const dans = (jours, h = 20) => {
  const d = new Date(Date.now() + jours * JOUR)
  d.setHours(h, 30, 0, 0)
  return d.toISOString()
}

const MOI = 'demo-m-matthieu'

/** Les membres. `fiche` : sa vitrine de lieu ou de food truck, s'il en a une. */
const membres = [
  { id: MOI, display_name: 'Matthieu Arkane', email: 'matthieu@exemple.fr', role: 'admin', is_owner: true, account_type: 'particulier', mod_depts: null, created_at: ilYA(120), supporter: false, events_total: 14, last_seen: ilYA(0) },
  { id: 'demo-m-ninon', display_name: 'Ninon Baudry', email: 'ninon@exemple.fr', role: 'admin', account_type: 'particulier', mod_depts: ['04', '05'], created_at: ilYA(98), supporter: true, events_total: 9, last_seen: ilYA(1), role_since: ilYA(70), actions_30d: 12, last_action_at: ilYA(1, 3) },
  { id: 'demo-m-paul', display_name: 'Paul Martin', email: 'paul@exemple.fr', role: 'admin', account_type: 'particulier', mod_depts: ['13', '83', '84'], created_at: ilYA(80), supporter: false, events_total: 3, last_seen: ilYA(4), role_since: ilYA(52), actions_30d: 4, last_action_at: ilYA(9) },
  { id: 'demo-m-lea', display_name: 'Léa Roche', email: 'lea@exemple.fr', role: 'admin', account_type: 'lieu', mod_depts: ['22', '29', '35', '56'], created_at: ilYA(60), supporter: false, events_total: 6, last_seen: ilYA(38), role_since: ilYA(45), actions_30d: 0, last_action_at: null, fiche: { id: 'demo-f-rirette', kind: 'lieu', name: 'Théâtre La Rirette', status: 'approved' } },
  { id: 'demo-m-gaspard', display_name: 'Gaspard Vidal', email: 'direction@exemple.org', role: 'user', account_type: 'lieu', created_at: ilYA(99), supporter: false, events_total: 11, last_seen: ilYA(2), fiche: { id: 'demo-f-entracte', kind: 'lieu', name: 'L’Entracte', status: 'pending' } },
  { id: 'demo-m-zoumai', display_name: 'Zoumai Thai', email: 'zoumai@exemple.fr', role: 'user', account_type: 'food_truck', created_at: ilYA(24), supporter: true, events_total: 0, last_seen: ilYA(0), fiche: { id: 'demo-crepes', kind: 'food_truck', name: 'Zoumai Thai', status: 'approved', confirmed_at: ilYA(3), slots: 4 } },
  { id: 'demo-m-serpiente', display_name: 'Mateo Ruiz', email: 'mateo@exemple.fr', role: 'user', account_type: 'food_truck', created_at: ilYA(3), supporter: false, events_total: 0, last_seen: ilYA(1), fiche: { id: 'demo-serpiente', kind: 'food_truck', name: 'El Serpiente de Oro', status: 'pending', confirmed_at: ilYA(3), slots: 2 } },
  { id: 'demo-m-camille', display_name: 'Camille Durand', email: 'camille@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(41), supporter: false, events_total: 5, last_seen: ilYA(0) },
  { id: 'demo-m-hugo', display_name: 'Hugo Lefèvre', email: 'hugo@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(6), supporter: false, events_total: 1, last_seen: ilYA(2) },
  { id: 'demo-m-sita', display_name: 'Sita', email: 'sita@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(88), supporter: true, events_total: 2, last_seen: ilYA(12) },
  { id: 'demo-m-jp', display_name: 'Jean-Pierre Olive', email: 'jp@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(70), supporter: false, events_total: 5, last_seen: ilYA(6) },
  { id: 'demo-m-anais', display_name: 'Anaïs Morel', email: 'anais@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(2), supporter: false, events_total: 0, last_seen: ilYA(2) },
  { id: 'demo-m-bistrot', display_name: 'Élodie Bistrot des Arts', email: 'bistrot@exemple.fr', role: 'user', account_type: 'lieu', created_at: ilYA(15), supporter: false, events_total: 1, last_seen: ilYA(9), fiche: { id: 'demo-f-bistrot', kind: 'lieu', name: 'Bistrot des Arts', status: 'rejected' } },
  { id: 'demo-m-tom', display_name: 'Tom Petit', email: 'tom@exemple.fr', role: 'user', account_type: 'particulier', created_at: ilYA(33), supporter: false, events_total: 0, last_seen: null },
]

let candidatures = [
  { id: 'demo-c-1', user_id: 'demo-m-camille', depts: ['13'], message: 'J’organise des concerts à Marseille depuis dix ans, je connais bien les salles et les associations.', status: 'pending', created_at: ilYA(2) },
  { id: 'demo-c-2', user_id: 'demo-m-hugo', depts: ['31', '81'], message: null, status: 'pending', created_at: ilYA(0, 5) },
  { id: 'demo-c-3', user_id: 'demo-m-paul', depts: ['06'], message: 'Je descends souvent à Nice.', status: 'pending', created_at: ilYA(1) },
  { id: 'demo-c-4', user_id: 'demo-m-ninon', depts: ['04', '05'], message: null, status: 'approved', created_at: ilYA(72), decided_at: ilYA(70) },
  { id: 'demo-c-5', user_id: 'demo-m-tom', depts: ['84'], message: 'Pour voir.', status: 'rejected', created_at: ilYA(30), decided_at: ilYA(29) },
]

let enAttente = [
  { id: 'demo-e-1', title: 'Bal folk des Cordeliers', category: 'Danse', starts_at: dans(3), ends_at: null, ville: 'Forcalquier', city: 'Forcalquier', address: 'Couvent des Cordeliers, 04300 Forcalquier', price_mode: 'libre', is_paid: false, price: 5, dept: '04', created_by: 'demo-m-jp', author_name: 'Jean-Pierre Olive', status: 'pending', thumb_url: image('#7a3b8f', 'Bal folk'), created_at: ilYA(0, 2) },
  { id: 'demo-e-2', title: 'Jazz sur le Vieux-Port', category: 'Musique', starts_at: dans(5), ends_at: null, ville: 'Marseille', city: 'Marseille', address: 'Quai de la Fraternité, 13001 Marseille', price_mode: 'gratuit', is_paid: false, price: null, dept: '13', created_by: 'demo-m-camille', author_name: 'Camille Durand', status: 'pending', thumb_url: image('#0b55c5', 'Jazz'), created_at: ilYA(0, 6) },
  { id: 'demo-e-3', title: 'Fest-noz d’automne', category: 'Festival', starts_at: dans(9), ends_at: null, ville: 'Quimper', city: 'Quimper', address: 'Halles Saint-François, 29000 Quimper', price_mode: 'payant', is_paid: true, price: 8, dept: '29', created_by: 'demo-m-anais', author_name: 'Anaïs Morel', status: 'pending', thumb_url: null, created_at: ilYA(1) },
  { id: 'demo-e-4', title: 'Vide-grenier de la Saint-Martin', category: 'Vide-grenier', starts_at: dans(2, 8), ends_at: null, ville: 'Mane', city: 'Mane', address: 'Place de l’Église, 04300 Mane', price_mode: 'gratuit', is_paid: false, price: null, dept: '04', created_by: 'demo-m-sita', author_name: 'Sita', status: 'pending', thumb_url: image('#26784c', 'Vide-grenier'), created_at: ilYA(1, 4) },
]

let fichesEnAttente = [
  { id: 'demo-f-entracte', kind: 'lieu', name: 'L’Entracte', dept: '04', description: 'Café-concert associatif : concerts, scènes ouvertes, soirées jeux et expositions toute l’année.', photo_url: image('#1d3b2a', 'L’Entracte'), proprietaire: { display_name: 'Gaspard Vidal' } },
  { id: 'demo-serpiente', kind: 'food_truck', name: 'El Serpiente de Oro', dept: '04', description: 'Cuisine de rue d’Amérique latine, produits de la région.', photo_url: image('#7a5a12', 'El Serpiente de Oro'), proprietaire: { display_name: 'Mateo Ruiz' } },
]

const camions = [
  { id: 'demo-crepes', name: 'La Roulotte à Crêpes', dept: '04', last_confirmed_at: ilYA(2), signalements: 0 },
  { id: 'demo-pizza', name: 'Pizza du Lure', dept: '04', last_confirmed_at: ilYA(20), signalements: 2 },
  { id: 'demo-t-3', name: 'Zoumai Thai', dept: '13', last_confirmed_at: ilYA(6), signalements: 0 },
  { id: 'demo-t-4', name: 'Burger des Alpilles', dept: '13', last_confirmed_at: ilYA(34), signalements: 0 },
  { id: 'demo-t-5', name: 'Le Camion qui fume', dept: '84', last_confirmed_at: ilYA(1), signalements: 1 },
  { id: 'demo-t-6', name: 'Le Vieux Fourneau', dept: '84', last_confirmed_at: ilYA(45), signalements: 0 },
]

/** Le journal : une quarantaine d'actes, sur six semaines. */
let journal = (() => {
  const qui = (id) => membres.find((m) => m.id === id)
  const l = []
  let n = 900
  const acte = (jours, heures, acteur, action, kind, cibleId, libelle, details) =>
    l.push({ id: n--, created_at: ilYA(jours, heures), actor_id: acteur, actor_name: qui(acteur)?.display_name ?? '(compte supprimé)', action, target_kind: kind, target_id: cibleId, target_label: libelle, details })
  acte(0, 1, 'demo-m-ninon', 'event_status', 'event', 'demo-x-1', 'Concert de la Sainte-Cécile', { avant: 'pending', apres: 'approved' })
  acte(0, 2, 'demo-m-ninon', 'event_status', 'event', 'demo-x-2', 'Atelier poterie parents-enfants', { avant: 'pending', apres: 'approved' })
  acte(0, 3, MOI, 'fiche_status', 'fiche', 'demo-crepes', 'Zoumai Thai', { avant: 'pending', apres: 'approved', kind: 'food_truck' })
  acte(0, 6, 'demo-m-ninon', 'event_status', 'event', 'demo-x-3', 'Soirée karaoké (doublon)', { avant: 'pending', apres: 'rejected' })
  acte(1, 2, MOI, 'role_change', 'profile', 'demo-m-lea', 'Léa Roche', { avant: 'user', apres: 'admin' })
  acte(1, 2, MOI, 'moderator_depts', 'profile', 'demo-m-lea', 'Léa Roche', { avant: null, apres: ['22', '29', '35', '56'] })
  acte(1, 5, 'demo-m-paul', 'event_status', 'event', 'demo-x-4', 'Marché des créateurs', { avant: 'pending', apres: 'approved' })
  acte(1, 9, MOI, 'supporter', 'profile', 'demo-m-zoumai', 'Zoumai Thai', { ajoute: true })
  acte(2, 1, 'demo-m-paul', 'event_delete', 'event', 'demo-x-5', 'Publicité déguisée', { statut: 'pending' })
  acte(2, 4, MOI, 'moderator_depts', 'profile', 'demo-m-paul', 'Paul Martin', { avant: ['13', '83'], apres: ['13', '83', '84'] })
  acte(3, 3, 'demo-m-ninon', 'event_status', 'event', 'demo-x-6', 'Randonnée contée', { avant: 'pending', apres: 'approved' })
  acte(3, 8, MOI, 'member_delete', 'profile', 'demo-x-7', 'compte-test', { type: 'particulier' })
  acte(4, 2, MOI, 'fiche_status', 'fiche', 'demo-f-bistrot', 'Bistrot des Arts', { avant: 'pending', apres: 'rejected', kind: 'lieu' })
  acte(5, 6, MOI, 'request_refused', 'profile', 'demo-m-tom', 'Tom Petit', { depts: ['84'] })
  const titres = ['Ciné plein air', 'Expo photo « Lumières »', 'Stage de cirque', 'Lecture musicale', 'Bœuf du jeudi', 'Scène ouverte', 'Fête de la soupe', 'Théâtre d’impro', 'Concert de chorales', 'Atelier d’écriture', 'Brocante des enfants', 'Conférence oiseaux']
  titres.forEach((t, i) => {
    const acteur = i % 3 === 0 ? MOI : i % 3 === 1 ? 'demo-m-ninon' : 'demo-m-paul'
    acte(6 + i * 2, (i * 5) % 11, acteur, 'event_status', 'event', 'demo-x-' + (20 + i), t, { avant: 'pending', apres: i % 5 === 4 ? 'rejected' : 'approved' })
  })
  acte(32, 4, MOI, 'supporter', 'profile', 'demo-m-sita', 'Sita', { ajoute: true })
  acte(38, 2, MOI, 'role_change', 'profile', 'demo-x-9', 'Ancien modérateur', { avant: 'admin', apres: 'user' })
  // Comme en base : l'identifiant suit l'ordre du temps (c'est le curseur de
  // la pagination).
  return l.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a, i) => ({ ...a, id: 900 - i }))
})()

const copie = (x) => JSON.parse(JSON.stringify(x))
const nomDe = (id) => membres.find((m) => m.id === id)?.display_name ?? '(sans nom)'

// --- Lectures --------------------------------------------------------------------

export function listMembers() {
  return copie(
    membres
      .map((m) => ({
        id: m.id,
        display_name: m.display_name,
        role: m.role,
        created_at: m.created_at,
        is_owner: Boolean(m.is_owner),
        account_type: m.account_type,
        mod_depts: m.mod_depts ?? null,
        is_supporter: m.supporter,
        fiche_id: m.fiche?.id ?? null,
        fiche_kind: m.fiche?.kind ?? null,
        fiche_name: m.fiche?.name ?? null,
        fiche_status: m.fiche?.status ?? null,
        events_total: m.events_total,
        last_seen: m.last_seen ? m.last_seen.slice(0, 10) : null,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  )
}

export function listAdmins() {
  return copie(
    membres
      .filter((m) => m.role === 'admin' || m.is_owner)
      .map((m) => ({
        id: m.id,
        display_name: m.display_name,
        email: m.email,
        is_owner: Boolean(m.is_owner),
        mod_depts: m.mod_depts ?? null,
        account_type: m.account_type,
        member_since: m.created_at,
        role_since: m.role_since ?? null,
        actions_30d: m.actions_30d ?? 0,
        last_action_at: m.last_action_at ?? null,
      }))
  )
}

export function memberProfile(id) {
  const m = membres.find((x) => x.id === id)
  if (!m) return null
  const c = candidatures.filter((x) => x.user_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return copie({
    id: m.id,
    display_name: m.display_name,
    email: m.email,
    role: m.role,
    is_owner: Boolean(m.is_owner),
    mod_depts: m.mod_depts ?? null,
    created_at: m.created_at,
    supporter_since: m.supporter ? ilYA(20) : null,
    events_total: m.events_total,
    events_pending: enAttente.filter((e) => e.created_by === id).length,
    last_seen: m.last_seen,
    account_type: m.account_type,
    visits_30d: m.last_seen ? 7 : 0,
    events_upcoming: Math.min(2, m.events_total),
    events_rejected: m.events_total > 4 ? 1 : 0,
    notifs_actives: m.events_total > 2,
    feedback_total: m.id === 'demo-m-gaspard' ? 2 : 0,
    fiche_id: m.fiche?.id ?? null,
    fiche_kind: m.fiche?.kind ?? null,
    fiche_name: m.fiche?.name ?? null,
    fiche_status: m.fiche?.status ?? null,
    fiche_confirmed_at: m.fiche?.confirmed_at ?? null,
    fiche_slots: m.fiche?.slots ?? 0,
    actions_30d: m.actions_30d ?? 0,
    last_action_at: m.last_action_at ?? null,
    candidature_status: c?.status ?? null,
  })
}

export function listMemberEvents(id) {
  const m = membres.find((x) => x.id === id)
  const siens = enAttente.filter((e) => e.created_by === id).map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: null, status: 'pending' }))
  const anciens = ['Soirée contes', 'Concert acoustique', 'Projection-débat', 'Atelier cuisine du monde']
    .slice(0, Math.max(0, Math.min(4, (m?.events_total ?? 0) - siens.length)))
    .map((t, i) => ({ id: 'demo-x-a' + i, title: t, starts_at: ilYA(6 + i * 9), ends_at: null, status: i === 2 ? 'rejected' : 'approved' }))
  return [...siens, ...anciens]
}

export function moderationCoverage() {
  const parDept = new Map()
  const compter = (dept, cle) => {
    const k = dept ?? 'hors'
    const r = parDept.get(k) ?? { dept: k, events_pending: 0, fiches_pending: 0 }
    r[cle]++
    parDept.set(k, r)
  }
  for (const e of enAttente) compter(e.dept, 'events_pending')
  for (const f of fichesEnAttente) compter(f.dept, 'fiches_pending')
  // De quoi montrer un département « chargé » (cinq publications ou plus).
  parDept.set('83', { dept: '83', events_pending: 6, fiches_pending: 0 })
  parDept.set('hors', { dept: 'hors', events_pending: 1, fiches_pending: 0 })
  return [...parDept.values()]
}

export function listModeratorRequests() {
  return copie(
    candidatures
      .map((c) => {
        const m = membres.find((x) => x.id === c.user_id)
        return {
          ...c,
          display_name: m?.display_name ?? '(sans nom)',
          email: m?.email,
          role_actuel: m?.role,
          depts_actuels: m?.mod_depts ?? null,
          account_type: m?.account_type,
          member_since: m?.created_at,
          events_total: m?.events_total ?? 0,
        }
      })
      .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.created_at.localeCompare(a.created_at))
  )
}

/** Mêmes paramètres, mêmes filtres que la fonction en base (migration 0040). */
export function listAdminActions({ max = 100, avant = null, acteur = null, actions = null, recherche = '' } = {}) {
  const lignes = filtrerActes(avant ? journal.filter((a) => a.id < avant) : journal, { acteur, actions, recherche })
  return copie(lignes.slice(0, max))
}

export function listPendingEvents() {
  return copie(enAttente)
}

export function listFichesEnAttente() {
  return copie(fichesEnAttente)
}

export function suiviFoodTrucks() {
  return copie(camions)
}

export function myPendingCount() {
  return enAttente.length + fichesEnAttente.length
}

// --- Écritures (en mémoire seulement) ---------------------------------------------

function noter(action, kind, cibleId, libelle, details) {
  journal.unshift({ id: Date.now(), created_at: new Date().toISOString(), actor_id: MOI, actor_name: nomDe(MOI), action, target_kind: kind, target_id: cibleId, target_label: libelle, details })
}

export function setModerator(id, depts) {
  const m = membres.find((x) => x.id === id)
  if (!m) throw new Error('Membre introuvable.')
  const avant = m.mod_depts ?? null
  const propre = [...new Set(depts ?? [])].sort()
  if (!propre.length) {
    if (m.role === 'admin') noter('role_change', 'profile', id, m.display_name, { avant: 'admin', apres: 'user' })
    m.role = 'user'
    m.mod_depts = null
  } else {
    if (m.role !== 'admin') {
      noter('role_change', 'profile', id, m.display_name, { avant: 'user', apres: 'admin' })
      m.role_since = new Date().toISOString()
    }
    noter('moderator_depts', 'profile', id, m.display_name, { avant, apres: propre })
    m.role = 'admin'
    m.mod_depts = propre
  }
  return { id, display_name: m.display_name, role: m.role, mod_depts: m.mod_depts }
}

export function decideModeratorRequest(id, accept) {
  const c = candidatures.find((x) => x.id === id)
  if (!c) throw new Error('Candidature introuvable ou déjà tranchée.')
  c.status = accept ? 'approved' : 'rejected'
  c.decided_at = new Date().toISOString()
  if (accept) {
    const m = membres.find((x) => x.id === c.user_id)
    setModerator(c.user_id, [...(m?.mod_depts ?? []), ...c.depts])
  } else {
    noter('request_refused', 'profile', c.user_id, nomDe(c.user_id), { depts: c.depts })
  }
}

export function setEventStatus(id, status) {
  const e = enAttente.find((x) => x.id === id)
  if (!e) throw new Error('événement introuvable.')
  enAttente = enAttente.filter((x) => x.id !== id)
  noter('event_status', 'event', id, e.title, { avant: 'pending', apres: status })
}

export function decideFiche(id, status) {
  const f = fichesEnAttente.find((x) => x.id === id)
  fichesEnAttente = fichesEnAttente.filter((x) => x.id !== id)
  const m = membres.find((x) => x.fiche?.id === id)
  if (m) m.fiche.status = status
  if (f) noter('fiche_status', 'fiche', id, f.name, { avant: 'pending', apres: status, kind: f.kind })
}

export function deleteMember(id) {
  const i = membres.findIndex((x) => x.id === id)
  if (i < 0) throw new Error('Membre introuvable.')
  noter('member_delete', 'profile', id, membres[i].display_name, { type: membres[i].account_type })
  membres.splice(i, 1)
  candidatures = candidatures.filter((c) => c.user_id !== id)
  return 0
}
