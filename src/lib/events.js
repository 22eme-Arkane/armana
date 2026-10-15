// Armana — couche d'accès aux données (événements, photos, favoris).
//
// Toute autorisation est imposée par la RLS côté base ; ce module ne fait que
// formuler les requêtes. On lit les événements via la vue events_geo (lat/lng en
// clair) et on rattache photo + auteur par des requêtes explicites (pas d'embedding
// PostgREST au travers de la vue, qui n'est pas garanti).
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'
import { makePhotoVariants } from './image.js'
import { fichesPubliees } from './fiches.js'
import { foodSurPlace } from './foodTrucks.js'
import { chargerCommunes, villeDeLEvenement } from './communes.js'

export const CATEGORIES = [
  'Musique',
  'Spectacles vivants',
  'Danse',
  'Théâtre',
  'Exposition',
  'Cinéma',
  'Atelier',
  'Festival',
  'Conférence',
  'Marché',
  'Vide-grenier',
  'Autre',
]

/** URL publique d'une photo du bucket Storage 'event-photos'. */
export function publicPhotoUrl(path) {
  if (!path) return null
  return supabase.storage.from('event-photos').getPublicUrl(path).data.publicUrl
}

/**
 * Chemin de la vignette déduit de celui de la photo pleine.
 * Convention : {uid}/{eventId}/photo-{position}.webp → thumb-{position}.webp.
 *
 * ⚠ Le suffixe est FACULTATIF : les événements créés avant la gestion de
 * plusieurs photos utilisent `photo.webp` / `thumb.webp` tout court. Les deux
 * formes doivent continuer d'être reconnues, sinon la suppression et la purge
 * mensuelle laisseraient des fichiers orphelins dans le stockage — ce qui
 * remplit le quota gratuit sans que rien ne le signale.
 */
export function thumbPath(path) {
  if (!path) return null
  return path.replace(/photo(-\d+)?\.webp$/, (m, n) => 'thumb' + (n || '') + '.webp')
}

/**
 * Un événement est-il "à venir" (non terminé) ?
 * Fin effective = ends_at, sinon le début (compté jusqu'à la fin de sa journée).
 */
export function isUpcoming(ev) {
  const now = Date.now()
  if (ev.ends_at) return Date.parse(ev.ends_at) >= now
  const start = new Date(ev.starts_at)
  start.setHours(23, 59, 59, 999)
  return start.getTime() >= now
}

// Filtre PostgREST "à venir" : ends_at >= maintenant, OU (ends_at nul ET starts_at
// >= aujourd'hui). Les mois passés ne s'affichent jamais.
function applyUpcoming(q) {
  const now = new Date().toISOString()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return q.or(`ends_at.gte.${now},and(ends_at.is.null,starts_at.gte.${today.toISOString()})`)
}

/** Rattache author_name + photo_url (1re photo) à une liste d'événements. */
async function attachRelations(events) {
  const list = events ?? []
  if (!list.length) return []
  const ids = list.map((e) => e.id)
  const creatorIds = [...new Set(list.map((e) => e.created_by))]

  const [photosRes, profilesRes, fiches, food, communes] = await Promise.all([
    supabase
      .from('event_photos')
      .select('event_id, storage_path, position')
      .in('event_id', ids)
      .order('position', { ascending: true }),
    supabase.from('profiles').select('id, display_name').in('id', creatorIds),
    // Les fiches PUBLIÉES des auteurs (lieux, food trucks) : « Publié par »
    // devient un lien vers elles. Ne lève jamais (voir fichesPubliees).
    fichesPubliees(creatorIds),
    // Les food trucks annoncés sur l'événement : badge « Food sur place »
    // (migration 0034). Ne lève jamais.
    foodSurPlace(),
    // La liste des communes, pour donner à CHAQUE événement une ville propre
    // — y compris ceux publiés avant le choix de la commune (migration 0035).
    // En cache après le premier chargement ; sans elle, on retombe sur
    // l'extraction depuis l'adresse.
    chargerCommunes().catch(() => null),
  ])

  // Toutes les photos, rangées par position : la position N correspond au
  // JOUR N+1 d'un événement qui dure plusieurs jours (un festival peut avoir
  // une affiche par journée).
  const parEvenement = new Map()
  // La photo du MENU (restauration sur place) vit à la position 100 : elle ne
  // doit jamais passer pour l'affiche d'un jour.
  const menuParEvenement = new Map()
  for (const p of photosRes.data ?? []) {
    if (p.position >= POSITION_MENU) {
      menuParEvenement.set(p.event_id, p.storage_path)
      continue
    }
    if (!parEvenement.has(p.event_id)) parEvenement.set(p.event_id, [])
    parEvenement.get(p.event_id).push(p.storage_path)
  }
  const nameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.display_name]))

  return list.map((e) => {
    const paths = parEvenement.get(e.id) ?? []
    const photos = paths.map((p) => ({
      photo_url: publicPhotoUrl(p),
      thumb_url: publicPhotoUrl(thumbPath(p)),
    }))
    return {
      ...e,
      author_name: nameById.get(e.created_by) ?? 'Anonyme',
      author_fiche: fiches.get(e.created_by) ?? null,
      food_trucks: food.get(e.id) ?? [],
      ville: villeDeLEvenement(e, communes),
      menu_photo_path: menuParEvenement.get(e.id) ?? null,
      menu_photo_url: menuParEvenement.has(e.id) ? publicPhotoUrl(menuParEvenement.get(e.id)) : null,
      photos,
      // La première reste celle qui représente l'événement (carte, détail).
      photo_url: photos[0]?.photo_url ?? null,
      thumb_url: photos[0]?.thumb_url ?? null,
    }
  })
}

/**
 * Événements visibles à l'agenda (non terminés) : ceux APPROUVÉS (tout le monde) +
 * ses PROPRES événements en attente (pour que l'auteur voie sa soumission, avec un
 * badge « En attente »). Les mois passés ne s'affichent jamais.
 */
export async function listApprovedEvents() {
  const uid = getUser()?.id
  let q = supabase.from('events_geo').select('*')
  if (uid) q = q.or(`status.eq.approved,and(created_by.eq.${uid},status.eq.pending)`)
  else q = q.eq('status', 'approved')
  q = applyUpcoming(q)
  const { data, error } = await q.order('starts_at', { ascending: true })
  if (error) throw error
  return attachRelations(data)
}

/** Les événements PUBLIÉS et à venir d'un auteur — pour la fiche d'un lieu. */
export async function listEventsByAuthor(authorId) {
  let q = supabase.from('events_geo').select('*').eq('status', 'approved').eq('created_by', authorId)
  q = applyUpcoming(q)
  const { data, error } = await q.order('starts_at', { ascending: true }).limit(20)
  if (error) throw error
  return attachRelations(data)
}

/** Visibilité "carte/agenda" : approuvé, OU sa propre soumission en attente. */
function isVisibleToViewer(ev, uid) {
  return ev.status === 'approved' || (uid && ev.created_by === uid && ev.status === 'pending')
}

/** Événements dans un rayon (mètres) — PostGIS ST_DWithin via RPC. */
export async function eventsWithinRadius({ lat, lng, radiusM }) {
  const { data, error } = await supabase.rpc('events_within_radius', {
    lat,
    lng,
    radius_m: radiusM,
  })
  if (error) throw error
  const uid = getUser()?.id
  // La RPC renvoie ce que la RLS autorise : on garde approuvés + sien-en-attente, non terminés.
  return attachRelations((data ?? []).filter((e) => isVisibleToViewer(e, uid) && isUpcoming(e)))
}

/** Un événement par id (via la vue events_geo, RLS appliquée). */
export async function getEventById(id) {
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const [withRel] = await attachRelations([data])
  return withRel
}

/** Événements de l'utilisateur connecté (tous statuts). */
export async function listMyEvents() {
  const uid = getUser()?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('created_by', uid)
    .order('starts_at', { ascending: false })
  if (error) throw error
  return attachRelations(data)
}

/** Événements en attente de modération (admin uniquement, garanti par RLS). */
export async function listPendingEvents() {
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100) // la file se traite par paquets : pas de chargement sans fin
  if (error) throw error
  return attachRelations(data)
}

/**
 * Appelle une RPC de publication avec le lieu et la commune (migration 0035).
 * ⚠ Sans la migration, PostgREST ne trouve aucune fonction à ces paramètres
 * et PLUS PERSONNE NE PUBLIERAIT : on retente alors sans eux.
 */
async function rpcAvecLieu(nom, params, p) {
  const complet = {
    ...params,
    p_place_name: p.place_name ?? '',
    p_city: p.city ?? null,
    // Restauration sur place (même migration) ; null = inconnu, le serveur garde.
    p_restauration: typeof p.restauration === 'boolean' ? p.restauration : null,
    p_restauration_menu: p.restauration_menu ?? '',
  }
  let r = await supabase.rpc(nom, complet)
  if (r.error && /p_city|p_place_name|p_restauration|could not find the function/i.test(r.error.message)) {
    console.warn('[Armana] Migration 0035 absente : lieu et commune non enregistrés.')
    r = await supabase.rpc(nom, params)
  }
  if (r.error) throw r.error
  return r.data
}

/** Crée un événement (statut 'pending') via la RPC sécurisée. Renvoie la ligne. */
export async function createEvent(p) {
  return rpcAvecLieu('create_event', {
    p_title: p.title,
    p_description: p.description ?? '',
    p_starts_at: p.starts_at,
    p_ends_at: p.ends_at ?? null,
    p_is_paid: p.is_paid ?? false,
    p_price: p.price ?? null,
    p_lat: p.lat ?? null,
    p_lng: p.lng ?? null,
    p_address: p.address ?? '',
    p_category: p.category ?? '',
    // Récurrence : tableau de jours (getDay) ou null pour un événement ponctuel.
    p_recur_days: p.recur_days?.length ? p.recur_days : null,
    p_contact: p.contact ?? '',
    // Série de dates choisies une à une (migration 0028) : exclusive des jours
    // de la semaine, c'est le serveur qui tranche si les deux arrivent.
    p_recur_dates: p.recur_dates?.length ? p.recur_dates : null,
    p_price_detail: p.price_detail ?? '',
    // ⚠ Le tarif fait autorité sur `p_is_paid`, conservé pour les anciennes
    // versions. Trois valeurs : gratuit, libre, payant.
    p_price_mode: p.price_mode ?? '',
    // « Au chapeau », complément du tarif (migration 0032).
    p_au_chapeau: Boolean(p.au_chapeau),
  }, p)
}

/** Met à jour un événement (repasse en 'pending' si non-admin). */
export async function updateEvent(id, p) {
  return rpcAvecLieu('update_event', {
    p_id: id,
    p_title: p.title,
    p_description: p.description ?? '',
    p_starts_at: p.starts_at,
    p_ends_at: p.ends_at ?? null,
    p_is_paid: p.is_paid ?? false,
    p_price: p.price ?? null,
    p_lat: p.lat ?? null,
    p_lng: p.lng ?? null,
    p_address: p.address ?? '',
    p_category: p.category ?? '',
    // Récurrence : tableau de jours (getDay) ou null pour un événement ponctuel.
    p_recur_days: p.recur_days?.length ? p.recur_days : null,
    p_contact: p.contact ?? '',
    // Série de dates choisies une à une (migration 0028) : exclusive des jours
    // de la semaine, c'est le serveur qui tranche si les deux arrivent.
    p_recur_dates: p.recur_dates?.length ? p.recur_dates : null,
    p_price_detail: p.price_detail ?? '',
    // ⚠ Le tarif fait autorité sur `p_is_paid`, conservé pour les anciennes
    // versions. Trois valeurs : gratuit, libre, payant.
    p_price_mode: p.price_mode ?? '',
    // « Au chapeau » (migration 0032). `null` si l'appelant ne le connaît pas :
    // le serveur garde alors la valeur en place au lieu de l'effacer.
    p_au_chapeau: typeof p.au_chapeau === 'boolean' ? p.au_chapeau : null,
  }, p)
}

/**
 * Supprime un événement ET ses photos.
 * ⚠ ORDRE CRITIQUE : les FICHIERS d'abord, la LIGNE ensuite. Un simple DELETE
 * SQL ne libère pas le Storage : la ligne event_photos partant en cascade, les
 * fichiers deviendraient introuvables et occuperaient le quota pour toujours.
 * Droits : l'auteur (dossier {uid}/) ou un admin (politique ajoutée en 0009).
 */
export async function deleteEvent(id) {
  try {
    const { data: photos } = await supabase
      .from('event_photos')
      .select('storage_path')
      .eq('event_id', id)
    const files = []
    for (const p of photos ?? []) {
      if (!p.storage_path) continue
      files.push(p.storage_path)
      const t = thumbPath(p.storage_path)
      if (t && t !== p.storage_path) files.push(t)
    }
    if (files.length) await supabase.storage.from('event-photos').remove(files)
  } catch (e) {
    // On n'empêche pas la suppression de l'événement pour autant : la purge
    // mensuelle et le nettoyage admin rattraperont un fichier resté en place.
    console.warn('[Armana] Photos non supprimées :', e.message)
  }

  // Même piège que setEventStatus : un DELETE filtré par la RLS répond 204
  // sans rien supprimer. On exige la ligne supprimée en retour. Message
  // neutre : zéro ligne peut vouloir dire « déjà supprimé entre-temps »
  // autant que « hors de la zone du modérateur » — et deleteEvent sert AUSSI
  // à l'auteur, qui n'a pas de zone de modération.
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) {
    throw new Error('événement introuvable — déjà supprimé, ou hors de vos droits.')
  }
}

/** Modération : approuver / rejeter. */
export async function setEventStatus(id, status) {
  // ⚠ Sans `.select()`, un UPDATE que la RLS filtre (modérateur hors de sa
  // zone) répond 204 avec ZÉRO ligne modifiée : on croirait avoir approuvé
  // alors que rien n'a bougé. On exige la ligne en retour.
  const { data, error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data?.length) {
    throw new Error('cet événement est hors de votre zone de modération.')
  }
}

/**
 * Téléverse LES photos d'un événement — RÈGLE DE STOCKAGE (plan gratuit) :
 * compression WebP côté client AVANT envoi (max ~1600px) + vignette ~400px.
 *
 * Un événement sur plusieurs jours peut avoir une affiche par journée : la
 * photo de POSITION N illustre le JOUR N+1. Chemins :
 * {uid}/{eventId}/photo-{position}.webp et thumb-{position}.webp.
 *
 * @param {Array<{file: File, crop?: object, position: number}>} entrees
 */
export async function uploadEventPhotos(eventId, entrees) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const valides = (entrees ?? []).filter((e) => e?.file)
  if (!valides.length) return []

  const base = `${uid}/${eventId}`
  const lignes = []

  for (const { file, crop, position } of valides) {
    // `crop` = cadrage choisi par l'auteur dans l'aperçu ; appliqué à la vignette.
    const { full, thumb, type } = await makePhotoVariants(file, { crop: crop ?? null })
    // ⚠ Le nom de fichier reste `.webp` même quand l'appareil n'a su produire
    // que du JPEG : toute l'application déduit le chemin de la vignette de ce
    // suffixe (listes, suppression, purge mensuelle). C'est le CONTENT-TYPE
    // annoncé ici qui compte pour l'affichage, pas l'extension.
    const opts = { upsert: true, contentType: type }
    const chemin = `${base}/photo-${position}.webp`

    const { error: e1 } = await supabase.storage.from('event-photos').upload(chemin, full, opts)
    if (e1) throw e1
    const { error: e2 } = await supabase.storage
      .from('event-photos')
      .upload(thumbPath(chemin), thumb, opts)
    if (e2) throw e2

    lignes.push({ event_id: eventId, storage_path: chemin, position })
  }

  // On remplace les lignes des positions concernées, sans toucher aux autres :
  // remplacer la photo du jour 2 ne doit pas effacer celle du jour 1.
  await supabase
    .from('event_photos')
    .delete()
    .eq('event_id', eventId)
    .in('position', lignes.map((l) => l.position))
  const { error: insErr } = await supabase.from('event_photos').insert(lignes)
  if (insErr) throw insErr
  return lignes.map((l) => l.storage_path)
}

/** Position réservée à la photo du menu (restauration sur place, 0035). */
export const POSITION_MENU = 100

/** Envoie (ou remplace) la photo du menu d'un événement. */
export async function envoyerPhotoMenu(eventId, file) {
  return uploadEventPhotos(eventId, [{ file, crop: null, position: POSITION_MENU }])
}

/** Retire la photo du menu : les FICHIERS d'abord, la ligne ensuite. */
export async function retirerPhotoMenu(eventId, chemin) {
  if (!chemin) return
  await supabase.storage.from('event-photos').remove([chemin, thumbPath(chemin)].filter(Boolean))
  const { error } = await supabase
    .from('event_photos')
    .delete()
    .eq('event_id', eventId)
    .eq('position', POSITION_MENU)
  if (error) throw error
}

/** Compatibilité : une seule photo, en première position. */
export async function uploadEventPhoto(eventId, file, crop = null) {
  const [chemin] = await uploadEventPhotos(eventId, [{ file, crop, position: 0 }])
  return chemin ?? null
}

/**
 * Purge des MOIS RÉVOLUS (admin) — règle de rétention : on garde le mois en
 * cours et les mois à venir, on supprime tout ce qui appartient aux mois passés.
 *
 * ⚠ ORDRE CRITIQUE : les FICHIERS d'abord, les LIGNES ensuite. Un simple DELETE
 * SQL ne libère PAS le Storage — les fichiers deviendraient introuvables et
 * occuperaient le quota pour toujours.
 */
export async function purgePastMonths() {
  // Au passage, le ménage des food trucks (exceptions passées, vieux
  // signalements — migration 0034). Planifié chaque nuit en base ; le rejouer
  // ici ne coûte rien. Sans la migration, l'échec est ignoré.
  supabase.rpc('nettoyer_food_trucks').then(() => {}, () => {})
  const { data, error } = await supabase.rpc('expired_events_before_month')
  if (error) throw error
  const rows = data ?? []
  if (!rows.length) return { events: 0, files: 0 }

  const ids = [...new Set(rows.map((r) => r.id))]
  const files = []
  for (const r of rows) {
    if (!r.storage_path) continue
    files.push(r.storage_path)
    // La vignette est déduite du chemin (voir thumbPath).
    const t = thumbPath(r.storage_path)
    if (t && t !== r.storage_path) files.push(t)
  }

  // 1) Fichiers, par paquets (l'API Storage n'aime pas les listes géantes).
  let removed = 0
  for (const batch of chunk(files, 100)) {
    const { data: gone, error: rmErr } = await supabase.storage.from('event-photos').remove(batch)
    if (rmErr) throw new Error('Suppression des photos : ' + rmErr.message)
    removed += gone?.length ?? 0
  }

  // 2) Lignes (event_photos et gems partent en cascade), par paquets aussi :
  //    les identifiants transitent dans l'URL, qui a une longueur limitée.
  for (const batch of chunk(ids, 100)) {
    const { error: delErr } = await supabase.from('events').delete().in('id', batch)
    if (delErr) throw new Error('Suppression des événements : ' + delErr.message)
  }

  return { events: ids.length, files: removed }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// --- Favoris (Gems) --------------------------------------------------------

/** Set des ids d'événements « gemmés » par l'utilisateur connecté. */
export async function listGemEventIds() {
  const uid = getUser()?.id
  if (!uid) return new Set()
  const { data, error } = await supabase.from('gems').select('event_id').eq('user_id', uid)
  if (error) throw error
  return new Set((data ?? []).map((g) => g.event_id))
}

/** Événements favoris (approuvés/visibles) de l'utilisateur. */
export async function listGemmedEvents() {
  const ids = [...(await listGemEventIds())]
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .in('id', ids)
    .order('starts_at', { ascending: true })
  if (error) throw error
  return attachRelations(data)
}

export async function addGem(eventId) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const { error } = await supabase.from('gems').insert({ user_id: uid, event_id: eventId })
  if (error) throw error
}

export async function removeGem(eventId) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const { error } = await supabase
    .from('gems')
    .delete()
    .eq('user_id', uid)
    .eq('event_id', eventId)
  if (error) throw error
}
