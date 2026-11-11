// Armana — modérateurs par département : zones, candidatures, décisions.
//
// Toute l'autorisation est imposée en base (RPC + RLS de la migration 0020) ;
// ce module ne fait que formuler les appels. Vocabulaire : en base le rôle
// s'appelle toujours `admin` (identifiant technique intouché), mais partout
// dans l'interface ce sont des MODÉRATEURS — le seul administrateur est le
// propriétaire.
import { supabase } from './supabaseClient.js'
import { demoActif, demoGestion } from './demo.js'

/** Ma zone de modération : liste de codes, ou null = tous (propriétaire). */
export async function myModDepts() {
  if (demoActif()) return null
  const { data, error } = await supabase.rpc('my_mod_depts')
  if (error) throw error
  return data ?? null
}

/**
 * Ce que JE peux modérer : le compteur du badge « Modération ».
 * L'ancien compteur comptait tous les événements en attente — il aurait menti
 * à un modérateur cloisonné à son département.
 */
export async function myPendingCount() {
  if (demoActif()) return (await demoGestion()).myPendingCount()
  const { data, error } = await supabase.rpc('my_pending_count')
  if (error) throw error
  return data ?? 0
}

/**
 * Désigne un modérateur avec sa zone, ou la modifie.
 * `depts` vide ou null = retirer le rôle. Propriétaire uniquement.
 */
export async function setModerator(id, depts) {
  if (demoActif()) return (await demoGestion()).setModerator(id, depts)
  const { data, error } = await supabase.rpc('set_moderator', {
    p_target: id,
    p_depts: depts?.length ? depts : null,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Nombre de modérateurs par région (migration 0039) : Map code région → n.
 * Le propriétaire n'est pas compté. Aucune identité, seulement des nombres.
 */
export async function moderateursParRegion() {
  const { data, error } = await supabase.rpc('moderateurs_par_region')
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.region, r.n]))
}

/** Postuler (ou, pour un modérateur, demander des départements en plus). */
export async function applyModerator(depts, message) {
  const { data, error } = await supabase.rpc('apply_moderator', {
    p_depts: depts,
    p_message: message || null,
  })
  if (error) throw error
  return data
}

/** Ma candidature la plus récente, avec son état. */
export async function myModeratorRequest() {
  const { data, error } = await supabase.rpc('my_moderator_request')
  if (error) throw error
  return data?.[0] ?? null
}

/** Toutes les candidatures (propriétaire) : en attente d'abord. */
export async function listModeratorRequests() {
  if (demoActif()) return (await demoGestion()).listModeratorRequests()
  const { data, error } = await supabase.rpc('list_moderator_requests')
  if (error) throw error
  return data ?? []
}

/** Accepter ou refuser une candidature (propriétaire). */
export async function decideModeratorRequest(id, accept) {
  if (demoActif()) return (await demoGestion()).decideModeratorRequest(id, accept)
  const { error } = await supabase.rpc('decide_moderator_request', {
    p_id: id,
    p_accept: accept,
  })
  if (error) throw error
}

/**
 * Puis-je modérer CET événement ? Confort d'affichage uniquement — la base
 * revérifie de toute façon (can_moderate dans les politiques RLS).
 * `depts` : ma zone (myModDepts) ; null = tous.
 */
export function canModerateEvent(ev, { isAdmin, isOwner, depts }) {
  if (isOwner) return true
  if (!isAdmin) return false
  if (depts == null) return true
  return ev?.dept == null || depts.includes(ev.dept)
}
