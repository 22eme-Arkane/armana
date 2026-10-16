// Armana — messages « Nous contacter » (bug / avis).
// Écriture : tout utilisateur connecté. Lecture/suppression : propriétaire (RLS).
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'
import { currentBuild } from './update.js'
import { decrireAppareil } from './appareil.js'

export async function sendFeedback({ type, message }) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  // L'appareil et la version de l'app, joints automatiquement (migration
  // 0037) : face à un bug, c'est la première question qu'on se pose.
  const build = currentBuild()
  const ligne = {
    created_by: uid,
    type,
    message,
    app_version: build === 'dev' ? 'dev' : String(build).slice(0, 40),
    appareil: decrireAppareil().slice(0, 120),
  }
  let { error } = await supabase.from('feedback').insert(ligne)
  // ⚠ Sans la migration 0037, ces deux colonnes manquent et l'envoi entier
  // échouerait : on renvoie alors le message seul, plutôt que de le perdre.
  if (error?.code === '42703' || /app_version|appareil/.test(error?.message || '')) {
    ;({ error } = await supabase.from('feedback').insert({ created_by: uid, type, message }))
  }
  if (error) throw error
}

/** Messages reçus (propriétaire). Rattache le nom et le type de compte de l'auteur. */
export async function listFeedback() {
  // Du plus complet au plus ancien schéma : un écran qui tomberait en panne
  // parce qu'une migration n'est pas encore passée ne servirait à rien.
  const essais = [
    'id, type, message, created_at, created_by, read_at, handled_at, app_version, appareil',
    'id, type, message, created_at, created_by, read_at',
    'id, type, message, created_at, created_by',
  ]
  let data = null
  let error = null
  for (const colonnes of essais) {
    ;({ data, error } = await supabase
      .from('feedback')
      .select(colonnes)
      .order('created_at', { ascending: false }))
    if (!error || error.code !== '42703') break
  }
  if (error) throw error
  const list = data ?? []
  const ids = [...new Set(list.map((f) => f.created_by).filter(Boolean))]
  let profils = new Map()
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, account_type')
      .in('id', ids)
    profils = new Map((profs ?? []).map((p) => [p.id, p]))
  }
  return list.map((f) => ({
    ...f,
    author_name: profils.get(f.created_by)?.display_name ?? 'Anonyme',
    author_type: profils.get(f.created_by)?.account_type ?? null,
  }))
}

/**
 * Nombre de messages NON LUS (0 pour tout autre que le propriétaire, via la RLS).
 *
 * ⚠ Il comptait tous les messages, lus compris : le chiffre ne disait jamais
 * s'il y avait du nouveau. Sans la migration 0030, la colonne manque et la
 * requête échoue — on renvoie alors 0 plutôt qu'un total trompeur.
 */
export async function countFeedback() {
  const { count, error } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

/**
 * Marque comme lus tous les messages encore non lus (propriétaire seul).
 *
 * ⚠ PAR UNE FONCTION, jamais par une mise à jour de la table : `feedback` n'a
 * aucune politique UPDATE, et en ouvrir une permettrait aussi de réécrire le
 * texte d'un message. Voir la migration 0030.
 * Ne bloque jamais l'affichage : un échec laisse simplement les messages
 * « nouveaux » jusqu'à la prochaine visite.
 */
export async function markFeedbackRead() {
  const { data, error } = await supabase.rpc('mark_feedback_read')
  if (error) {
    console.warn('[Armana] Messages non marqués lus :', error.message)
    return 0
  }
  return data ?? 0
}

/** Range un message parmi les traités (ou le remet à traiter) — migration 0037. */
export async function setFeedbackHandled(id, handled) {
  const { error } = await supabase.rpc('set_feedback_handled', { p_id: id, p_handled: handled })
  if (error) throw error
}

export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}
