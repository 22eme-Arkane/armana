// Armana — fiches des lieux culturels et des food trucks (migration 0033).
//
// Une fiche par compte. Elle naît EN ATTENTE et ne devient publique qu'une
// fois validée par un modérateur ; toute retouche de son propriétaire la
// renvoie en relecture. Ces règles sont imposées EN BASE (trigger
// `fiches_avant_ecriture` et politiques RLS) : ce module ne fait qu'appeler.
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'
import { toWebp } from './image.js'
import { ecrirePoint, lirePoint } from './point.js'
import { demoFiche } from './demo.js'

const BUCKET = 'event-photos'
// Calculée ici plutôt qu'importée d'events.js : events.js importe ce module
// (pour « Publié par »), et l'import croisé est un piège à éviter.
const publicPhotoUrl = (chemin) => supabase.storage.from(BUCKET).getPublicUrl(chemin).data.publicUrl

/** Photo de fiche : plus légère que celle d'un événement, car jamais purgée. */
const PHOTO = { maxSize: 1200, quality: 0.8, budget: 700_000 }

/** Longueurs maximales — les mêmes que les contraintes de la migration 0033. */
export const LIMITES = {
  name: 80,
  description: 2000,
  website: 300,
  contact: 300,
  opening_hours: 600,
  address: 300,
  cuisine: 80,
  menu: 2000,
}

/** Ajoute les adresses publiques des photos. */
function enrichir(f) {
  if (!f) return f
  const p = lirePoint(f.location)
  return {
    ...f,
    lat: p?.lat ?? null,
    lng: p?.lng ?? null,
    photo_url: f.photo_path ? publicPhotoUrl(f.photo_path) : null,
    product_photo_url: f.product_photo_path ? publicPhotoUrl(f.product_photo_path) : null,
    gallery_paths: f.gallery_paths ?? [],
    gallery_urls: (f.gallery_paths ?? []).map(publicPhotoUrl),
  }
}

/** Galerie « En photo » : quatre photos au plus (contrainte de la migration 0034). */
export const GALERIE_MAX = 4

const COLONNES_BASE =
  'id, owner_id, kind, name, description, website, contact, opening_hours, address, location, ' +
  'cuisine, menu, photo_path, product_photo_path, dept, status, reviewed_at, created_at, updated_at'

// ⚠ La galerie arrive avec la migration 0034. Tant qu'elle n'est pas
// appliquée, demander la colonne ferait échouer TOUTE lecture de fiche : on
// retente sans, et on s'en souvient pour la suite de la visite.
let avecGalerie = true
const colonnes = () => (avecGalerie ? COLONNES_BASE + ', gallery_paths' : COLONNES_BASE)

async function lireFiche(filtre) {
  let r = await filtre(supabase.from('fiches').select(colonnes())).maybeSingle()
  if (r.error && avecGalerie && /gallery_paths/.test(r.error.message)) {
    avecGalerie = false
    r = await filtre(supabase.from('fiches').select(colonnes())).maybeSingle()
  }
  if (r.error) throw r.error
  return enrichir(r.data)
}

/** La fiche de la personne connectée, ou null. */
export async function getMaFiche() {
  const uid = getUser()?.id
  if (!uid) return null
  return lireFiche((q) => q.eq('owner_id', uid))
}

/** Une fiche par son identifiant (publique, ou la sienne, ou modérateur). */
export async function getFiche(id) {
  const demo = demoFiche(id)
  if (demo) return demo
  return lireFiche((q) => q.eq('id', id))
}

/**
 * Les fiches PUBLIÉES des auteurs donnés, par propriétaire — pour faire de
 * « Publié par … » un lien vers la fiche. Ne lève jamais : sans fiches (table
 * absente, réseau), les événements s'affichent simplement sans lien.
 * @returns {Promise<Map<string, {id:string, kind:string, name:string}>>}
 */
export async function fichesPubliees(ownerIds) {
  const ids = [...new Set(ownerIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('fiches')
    .select('id, owner_id, kind, name')
    .eq('status', 'approved')
    .in('owner_id', ids)
  if (error) {
    console.warn('[Armana] Fiches non chargées :', error.message)
    return new Map()
  }
  return new Map(data.map((f) => [f.owner_id, f]))
}

/**
 * Les food trucks PUBLIÉS et situés, pour la couche de la Carte.
 *
 * ⚠ PROVISOIRE : en attendant le planning (migration 0034), un camion est posé
 * à l'adresse de sa fiche. La fonction `food_trucks_today` prendra le relais
 * pour le placer là où il est CE JOUR-LÀ.
 * Ne lève jamais : sans fiches, la couche reste simplement vide.
 */
export async function foodTrucksSurCarte() {
  const { data, error } = await supabase
    .from('fiches')
    .select('id, name, cuisine, opening_hours, address, location, photo_path')
    .eq('status', 'approved')
    .eq('kind', 'food_truck')
    .not('location', 'is', null)
    .limit(500)
  if (error) {
    console.warn('[Armana] Food trucks non chargés :', error.message)
    return []
  }
  const out = []
  for (const f of data) {
    const p = lirePoint(f.location)
    if (p) out.push({ ...enrichir(f), ...p })
  }
  return out
}

/**
 * Crée ou met à jour la fiche de la personne connectée.
 * `champs` : les colonnes texte, plus `lat`/`lng` facultatifs (le point sert
 * au département, donc à la zone du modérateur qui la relit).
 */
export async function enregistrerFiche(champs) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Vous n’êtes pas connecté.')
  const ligne = { owner_id: uid }
  for (const cle of ['kind', ...Object.keys(LIMITES)]) {
    if (cle in champs) {
      const v = typeof champs[cle] === 'string' ? champs[cle].trim() : champs[cle]
      ligne[cle] = v === '' ? null : v
    }
  }
  if ('photo_path' in champs) ligne.photo_path = champs.photo_path
  if ('product_photo_path' in champs) ligne.product_photo_path = champs.product_photo_path
  if ('gallery_paths' in champs) ligne.gallery_paths = champs.gallery_paths.slice(0, GALERIE_MAX)
  if (Number.isFinite(champs.lat) && Number.isFinite(champs.lng)) {
    ligne.location = ecrirePoint(champs.lat, champs.lng)
  } else if (champs.lat === null) {
    ligne.location = null
  }
  // ⚠ MISE À JOUR D'ABORD, CRÉATION ENSUITE — pas d'upsert. Un upsert vérifie
  // les colonnes obligatoires (nom, type) de la ligne proposée AVANT de voir
  // qu'elle existe déjà : retirer une seule photo échouait faute de nom.
  const maj = await supabase.from('fiches').update(ligne).eq('owner_id', uid).select(colonnes())
  if (maj.error) throw maj.error
  if (maj.data?.length) return enrichir(maj.data[0])
  const { data, error } = await supabase.from('fiches').insert(ligne).select(colonnes()).single()
  if (error) throw error
  return enrichir(data)
}

/** Les chemins de la galerie, une fois les nouvelles photos envoyées. */
export async function envoyerGalerie(fichiers) {
  const chemins = []
  for (const f of fichiers) chemins.push(await envoyerPhotoFiche(f, 'galerie'))
  return chemins
}

/** Efface des photos de la galerie retirées par leur propriétaire. */
export async function effacerPhotosGalerie(chemins) {
  await effacerFichiers(chemins)
}

/**
 * Envoie une photo de fiche et renvoie son chemin.
 * ⚠ UN NOM NOUVEAU À CHAQUE ENVOI (horodaté), et l'ancien fichier effacé :
 * avec un nom fixe, téléphones et CDN gardaient l'ancienne image en cache.
 * @param {'photo'|'produit'|'galerie'} quoi
 * @param {string|null} ancien chemin à effacer une fois le nouveau en place
 */
export async function envoyerPhotoFiche(file, quoi, ancien = null) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Vous n’êtes pas connecté.')
  const blob = await toWebp(file, PHOTO)
  const chemin = `${uid}/fiche/${quoi}-${Date.now()}.webp`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(chemin, blob, { contentType: blob.type || 'image/webp', upsert: true })
  if (error) throw error
  if (ancien && ancien !== chemin) await effacerFichiers([ancien])
  return chemin
}

async function effacerFichiers(chemins) {
  const liste = chemins.filter(Boolean)
  if (!liste.length) return
  const { error } = await supabase.storage.from(BUCKET).remove(liste)
  if (error) console.warn('[Armana] Photo de fiche non effacée :', error.message)
}

/** Supprime la fiche de la personne connectée — ses photos D'ABORD. */
export async function supprimerMaFiche(fiche) {
  await effacerFichiers([fiche.photo_path, fiche.product_photo_path, ...(fiche.gallery_paths ?? [])])
  const { error } = await supabase.from('fiches').delete().eq('id', fiche.id)
  if (error) throw error
}

/** Retire la photo de produit (food truck). */
export async function retirerPhotoProduit(fiche) {
  await effacerFichiers([fiche.product_photo_path])
  return enregistrerFiche({ product_photo_path: null })
}

// --- Modération --------------------------------------------------------------

/** Fiches en attente (modérateurs). */
export async function listFichesEnAttente() {
  const { data, error } = await supabase
    .from('fiches')
    // Le nom de la personne qui a créé la fiche, pour le modérateur (Matthieu,
    // 16/10/2026) : savoir QUI demande la publication.
    .select(COLONNES_BASE + ', proprietaire:profiles(display_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return data.map(enrichir)
}

/** Valide ou refuse une fiche. La base vérifie la zone du modérateur. */
export async function decideFiche(id, status) {
  const { data, error } = await supabase.from('fiches').update({ status }).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('cette fiche est hors de votre zone de modération.')
}
