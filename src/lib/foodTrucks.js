// Armana — planning des food trucks (migration 0034).
//
// Un camion saisit UNE FOIS sa semaine (créneaux récurrents), puis ne gère que
// les exceptions : absence, vacances, changement de lieu, présence en plus.
// Toutes les règles (qui écrit quoi, ce qui est public, ce qui compte comme
// confirmation) sont imposées EN BASE ; ce module ne fait qu'appeler.
//
// ⚠ TOLÉRANT À L'ABSENCE DE LA MIGRATION 0034 là où le public passe (carte,
// agenda) : on renvoie `null` ou du vide, jamais une erreur qui casserait
// l'écran. Seul l'espace du camion, qui n'existe que grâce à elle, lève.
import { supabase } from './supabaseClient.js'
import { ecrirePoint, lirePoint } from './point.js'
import { demoActif, demoPlanning, demoPresences, demoPresencesPeriode } from './demo.js'

export const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
export const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** Valeurs de repli si la table `reglages` est illisible. */
const REGLAGES_DEFAUT = {
  ft_rappel_jours: 30,
  ft_masquage_jours: 37,
  ft_archivage_jours: 182,
  ft_seuil_signalements: 2,
}

/** Date du jour à Paris, au format AAAA-MM-JJ. */
export function aujourdhuiParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

/** Jour ISO (lundi = 1) d'une date AAAA-MM-JJ. */
export function jourIso(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  return ((d.getDay() + 6) % 7) + 1
}

/** « 18:30:00 » → « 18 h 30 ». */
export function heure(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`
}

export function plageHoraire(debut, fin) {
  return `${heure(debut)} – ${heure(fin)}`
}

/** « Forcalquier · Parking Gamm Vert » : la commune, puis le repère s'il y en a un. */
export function lieuLisible(p) {
  return [p.place_label, p.place_hint].filter(Boolean).join(' · ')
}

/** « 2026-10-17 » → « samedi 17 octobre ». */
export function dateLongue(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function avecPoint(ligne) {
  const p = lirePoint(ligne.location)
  return { ...ligne, lat: p?.lat ?? null, lng: p?.lng ?? null }
}

// --- Réglages -----------------------------------------------------------------

export async function reglages() {
  const { data, error } = await supabase.from('reglages').select('cle, valeur').like('cle', 'ft\\_%')
  if (error) return { ...REGLAGES_DEFAUT }
  const out = { ...REGLAGES_DEFAUT }
  for (const r of data) out[r.cle] = r.valeur
  return out
}

/**
 * L'état du camion, depuis sa dernière confirmation.
 * @returns {{etat:'actif'|'rappel'|'masque'|'archive', jours:number}}
 */
export function etatPlanning(confirmeLe, r) {
  const jours = Math.floor((Date.now() - new Date(confirmeLe).getTime()) / 86400000)
  if (jours >= r.ft_archivage_jours) return { etat: 'archive', jours }
  if (jours >= r.ft_masquage_jours) return { etat: 'masque', jours }
  if (jours >= r.ft_rappel_jours) return { etat: 'rappel', jours }
  return { etat: 'actif', jours }
}

// --- Espace du camion -----------------------------------------------------------

/** Date de dernière confirmation de MA fiche. */
export async function maConfirmation(ficheId) {
  const { data, error } = await supabase
    .from('fiches')
    .select('last_confirmed_at')
    .eq('id', ficheId)
    .single()
  if (error) throw error
  return data.last_confirmed_at
}

export async function confirmerPlanning() {
  const { data, error } = await supabase.rpc('confirmer_planning')
  if (error) throw error
  return data
}

export async function listerCreneaux(truckId) {
  const { data, error } = await supabase
    .from('food_truck_slots')
    .select('id, truck_id, weekday, start_time, end_time, location, place_label, place_hint, valid_from, valid_until')
    .eq('truck_id', truckId)
    .order('weekday')
    .order('start_time')
  if (error) throw error
  return data.map(avecPoint)
}

/** Crée ou modifie un créneau (`id` présent = modification). */
export async function enregistrerCreneau(c) {
  const ligne = {
    truck_id: c.truck_id,
    weekday: c.weekday,
    start_time: c.start_time,
    end_time: c.end_time,
    location: ecrirePoint(c.lat, c.lng),
    place_label: c.place_label.trim(),
    place_hint: c.place_hint?.trim() || null,
    valid_from: c.valid_from || null,
    valid_until: c.valid_until || null,
  }
  const req = c.id
    ? supabase.from('food_truck_slots').update(ligne).eq('id', c.id)
    : supabase.from('food_truck_slots').insert(ligne)
  const { error } = await req
  if (error) throw error
}

export async function supprimerCreneau(id) {
  const { error } = await supabase.from('food_truck_slots').delete().eq('id', id)
  if (error) throw error
}

/** Exceptions à venir (ou en cours) d'un camion. */
export async function listerExceptions(truckId) {
  const { data, error } = await supabase
    .from('food_truck_exceptions')
    .select(
      'id, truck_id, slot_id, kind, date_start, date_end, start_time, end_time, location, place_label, place_hint, event_id, events(title)'
    )
    .eq('truck_id', truckId)
    .gte('date_end', aujourdhuiParis())
    .order('date_start')
  if (error) throw error
  return data.map(avecPoint)
}

/**
 * Ajoute une exception.
 * @param {{truck_id, kind:'closed'|'moved'|'extra', date_start, date_end?, slot_id?,
 *          start_time?, end_time?, lat?, lng?, place_label?, event_id?}} e
 */
export async function ajouterException(e) {
  const ligne = {
    truck_id: e.truck_id,
    kind: e.kind,
    date_start: e.date_start,
    date_end: e.date_end || e.date_start,
    slot_id: e.slot_id || null,
    start_time: e.start_time || null,
    end_time: e.end_time || null,
    location: Number.isFinite(e.lat) && Number.isFinite(e.lng) ? ecrirePoint(e.lat, e.lng) : null,
    place_label: e.place_label?.trim() || null,
    place_hint: e.place_hint?.trim() || null,
    event_id: e.event_id || null,
  }
  const { error } = await supabase.from('food_truck_exceptions').insert(ligne)
  if (error) throw error
}

export async function supprimerException(id) {
  const { error } = await supabase.from('food_truck_exceptions').delete().eq('id', id)
  if (error) throw error
}

/** Combien m'ont signalé absent aujourd'hui, par créneau. */
export async function mesSignalements() {
  const { data, error } = await supabase.rpc('mes_signalements')
  if (error) return []
  return data ?? []
}

// --- Côté public ---------------------------------------------------------------

/**
 * Les camions présents aujourd'hui (heure de Paris).
 * @returns {Promise<object[]|null>} null si la migration 0034 manque.
 */
export async function foodTrucksAujourdhui() {
  const { data, error } = await supabase.rpc('food_trucks_today', {})
  // Démonstration (?demo=1, préversions seulement) : ajoutée aux vrais camions.
  const demo = demoActif() ? demoPresences() : []
  if (error) {
    console.warn('[Armana] Food trucks du jour indisponibles :', error.message)
    return demo.length ? demo : null
  }
  return [...demo, ...(data ?? []).map((t) => ({
    ...t,
    photo_url: t.photo_path
      ? supabase.storage.from('event-photos').getPublicUrl(t.photo_path).data.publicUrl
      : null,
  }))]
}

/**
 * Les présences des camions sur une période (migration 0035), jour par jour.
 * @param {string} debut AAAA-MM-JJ
 * @param {string} fin   AAAA-MM-JJ (31 jours au plus après le début)
 * @returns {Promise<object[]|null>} null si la migration manque.
 */
export async function foodTrucksPeriode(debut, fin) {
  const { data, error } = await supabase.rpc('food_trucks_periode', { p_debut: debut, p_fin: fin })
  const demo = demoActif() ? demoPresencesPeriode(debut, fin) : []
  if (error) {
    console.warn('[Armana] Food trucks de la période indisponibles :', error.message)
    return demo.length ? demo : null
  }
  return [
    ...demo,
    ...(data ?? []).map((t) => ({
      ...t,
      photo_url: t.photo_path
        ? supabase.storage.from('event-photos').getPublicUrl(t.photo_path).data.publicUrl
        : null,
    })),
  ]
}

/** Planning public d'un camion : créneaux de la semaine et exceptions à venir. */
export async function planningPublic(truckId) {
  const demo = demoPlanning(truckId)
  if (demo) return demo
  const [creneaux, exceptions] = await Promise.all([
    listerCreneaux(truckId).catch(() => []),
    listerExceptions(truckId).catch(() => []),
  ])
  return { creneaux, exceptions }
}

/** « Pas là aujourd'hui » — renvoie le nombre de signalements du jour. */
export async function signalerAbsence({ slotId = null, exceptionId = null }) {
  if (String(slotId).startsWith('demo-')) throw new Error('Démonstration : rien n’est enregistré.')
  const { data, error } = await supabase.rpc('signaler_absence', {
    p_slot: slotId,
    p_exception: exceptionId,
  })
  if (error) throw error
  return data
}

/**
 * Les événements où un food truck a annoncé sa venue (badge « Food sur
 * place »). Une seule requête pour tout l'agenda : les présences liées à un
 * événement sont rares, on les prend toutes plutôt que de passer des
 * centaines d'identifiants dans l'adresse.
 * @returns {Promise<Map<string, {id:string, name:string}[]>>}
 */
export async function foodSurPlace() {
  // Deux sources : la « présence en plus » déclarée par le camion (0034) et
  // l'annonce faite par l'organisateur à la publication (0035).
  const [declares, annonces] = await Promise.all([
    supabase
      .from('food_truck_exceptions')
      .select('event_id, truck_id, fiches(id, name)')
      .eq('kind', 'extra')
      .not('event_id', 'is', null)
      .gte('date_end', aujourdhuiParis()),
    supabase.from('event_food_trucks').select('event_id, truck_id, fiches(id, name)'),
  ])
  const out = new Map()
  const lignes = [...(declares.error ? [] : declares.data), ...(annonces.error ? [] : annonces.data)]
  for (const r of lignes) {
    if (!r.fiches) continue
    const liste = out.get(r.event_id) ?? []
    if (!liste.some((t) => t.id === r.fiches.id)) liste.push(r.fiches)
    out.set(r.event_id, liste)
  }
  return out
}

// --- Annonces faites par l'organisateur (migration 0035) ------------------------

/** Les food trucks VALIDÉS, pour le choix à la publication d'un événement. */
export async function foodTrucksValides() {
  const { data, error } = await supabase
    .from('fiches')
    .select('id, name, cuisine, address')
    .eq('kind', 'food_truck')
    .eq('status', 'approved')
    .order('name')
    .limit(300)
  if (error) return []
  return data
}

/** Les camions annoncés par l'organisateur sur un événement. */
export async function foodTrucksAnnonces(eventId) {
  const { data, error } = await supabase.from('event_food_trucks').select('truck_id').eq('event_id', eventId)
  if (error) return []
  return data.map((r) => r.truck_id)
}

/**
 * Met les annonces d'un événement en accord avec le choix de l'organisateur :
 * retire ce qui a été décoché, ajoute ce qui a été coché.
 */
export async function synchroniserFoodTrucks(eventId, ids) {
  const voulus = new Set(ids)
  const actuels = new Set(await foodTrucksAnnonces(eventId))
  const aRetirer = [...actuels].filter((id) => !voulus.has(id))
  const aAjouter = [...voulus].filter((id) => !actuels.has(id))
  if (aRetirer.length) {
    const { error } = await supabase
      .from('event_food_trucks')
      .delete()
      .eq('event_id', eventId)
      .in('truck_id', aRetirer)
    if (error) throw error
  }
  if (aAjouter.length) {
    const { error } = await supabase
      .from('event_food_trucks')
      .insert(aAjouter.map((truck_id) => ({ event_id: eventId, truck_id })))
    if (error) throw error
  }
}

/** Où MON camion est annoncé par des organisateurs (pour « Mon planning »). */
export async function mesAnnonces(truckId) {
  const { data, error } = await supabase
    .from('event_food_trucks')
    .select('event_id, events(id, title, starts_at, address, city)')
    .eq('truck_id', truckId)
  if (error) return []
  return data
    .filter((r) => r.events)
    .map((r) => r.events)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

/** Le camion retire une annonce faite sans lui. */
export async function retirerAnnonce(eventId, truckId) {
  const { error } = await supabase
    .from('event_food_trucks')
    .delete()
    .eq('event_id', eventId)
    .eq('truck_id', truckId)
  if (error) throw error
}
