// Armana — gestion des administrateurs (réservé aux admins, via RPC).
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'

/** Liste des admins (nom + e-mail). Nécessite d'être admin (garanti côté base). */
export async function listAdmins() {
  const { data, error } = await supabase.rpc('list_admins')
  if (error) throw error
  return data ?? []
}

/** Désigne (ou retire) un admin par e-mail. */
export async function setAdminByEmail(email, makeAdmin) {
  const { data, error } = await supabase.rpc('set_admin_by_email', {
    target_email: email,
    make_admin: makeAdmin,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Désigne (ou retire) un admin par identifiant — utilisé par l'écran Membres.
 * `list_members` ne renvoie volontairement pas les e-mails : l'annuaire complet
 * des inscrits ne doit pas circuler côté client.
 */
export async function setAdminById(id, makeAdmin) {
  const { data, error } = await supabase.rpc('set_admin_by_id', {
    target_id: id,
    make_admin: makeAdmin,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Fiche complète d'un membre, e-mail compris (admin uniquement).
 * L'adresse n'est volontairement PAS incluse dans `listMembers` : elle n'est
 * lue que lorsqu'un administrateur ouvre délibérément une fiche.
 */
export async function getMemberProfile(id) {
  const { data, error } = await supabase.rpc('member_profile', { p_id: id })
  if (error) throw error
  return data?.[0] ?? null
}

// --- Propriétaire du projet ---------------------------------------------------
// Le drapeau `profiles.is_owner` n'est pas lisible directement (aucun GRANT sur
// la colonne) : on passe par une RPC, dont le résultat ne change pas au cours
// d'une session. La garantie reste côté base — cette valeur ne sert qu'à
// afficher ou masquer l'entrée du journal.
let ownerPromise = null

export function amIOwner() {
  if (!ownerPromise) {
    ownerPromise = supabase
      .rpc('am_i_owner')
      .then(({ data, error }) => (error ? false : data === true))
      .catch(() => false)
  }
  return ownerPromise
}

/** À appeler au changement de compte : le cache ci-dessus deviendrait faux. */
export function resetOwnerCache() {
  ownerPromise = null
}

/** Journal des actions d'administration (propriétaire uniquement). */
export async function listAdminActions(max = 200) {
  const { data, error } = await supabase.rpc('list_admin_actions', { max_rows: max })
  if (error) throw error
  return data ?? []
}

/**
 * Tous les membres inscrits (nom, rôle, date d'inscription).
 * Passe par une RPC réservée aux admins : la table profiles n'expose plus que
 * (id, display_name) au public, sinon l'annuaire complet des inscrits était
 * aspirable avec la clé publique présente dans le bundle.
 */
export async function listMembers() {
  const { data, error } = await supabase.rpc('list_members')
  if (error) throw error
  return data ?? []
}

/**
 * Les publications d'un membre, toutes (en attente et refusées comprises) —
 * pour sa fiche. Le propriétaire est modérateur : la RLS les lui montre.
 */
export async function listMemberEvents(id, max = 8) {
  const { data, error } = await supabase
    .from('events_geo')
    .select('id, title, starts_at, ends_at, status')
    .eq('created_by', id)
    .order('starts_at', { ascending: false })
    .limit(max)
  if (error) throw error
  return data ?? []
}

/** Ce qui attend, département par département (migration 0037). */
export async function moderationCoverage() {
  const { data, error } = await supabase.rpc('moderation_coverage')
  if (error) throw error
  return data ?? []
}

/**
 * Supprime un compte (propriétaire) — LES PHOTOS D'ABORD, LE COMPTE ENSUITE.
 *
 * ⚠ RÈGLE DE STOCKAGE : supprimer le compte en base ne libère pas le Storage.
 * On efface donc d'abord tous les fichiers de son dossier `{id}/` par l'API
 * Storage, puis on appelle `delete_member`, qui REFUSE tant qu'il en reste un.
 * Profil, événements, fiche, planning et favoris partent alors en cascade.
 * @param {(etape:string)=>void} [onEtape]
 */
export async function deleteMember(id, onEtape) {
  onEtape?.('Recherche de ses photos…')
  const { data: fichiers, error: e1 } = await supabase.rpc('member_storage_paths', { p_id: id })
  if (e1) throw e1
  const chemins = (fichiers ?? []).map((f) => f.name)
  for (let i = 0; i < chemins.length; i += 100) {
    onEtape?.(`Suppression des photos (${Math.min(i + 100, chemins.length)} / ${chemins.length})…`)
    const { error } = await supabase.storage.from('event-photos').remove(chemins.slice(i, i + 100))
    if (error) throw new Error('Suppression des photos : ' + error.message)
  }
  onEtape?.('Suppression du compte…')
  const { error: e2 } = await supabase.rpc('delete_member', { p_id: id })
  if (e2) throw e2
  return chemins.length
}

/**
 * Enregistre le passage du jour (statistiques de fréquentation).
 * Ne bloque jamais l'utilisateur, mais LAISSE UNE TRACE en cas d'échec.
 *
 * ⚠ Le `try/catch` seul ne servait à rien : supabase-js ne lève pas, il
 * renvoie `{ error }`. Une erreur de droits ou de contrainte passait donc
 * totalement inaperçue, et un comptage défaillant était indiagnostiquable
 * depuis le navigateur.
 */
export async function recordVisit(dept = null) {
  try {
    // `p_dept` : renseigné quand l'appareil n'affiche qu'un seul département —
    // signal faible mais honnête sur la provenance, sans géolocalisation.
    const { error } = await supabase.rpc('record_visit', { p_dept: dept })
    if (error) console.warn('[Armana] Visite non enregistrée :', error.code, error.message)
  } catch (e) {
    console.warn('[Armana] Visite non enregistrée :', e.message)
  }
}

// Identifiant de visiteur non inscrit. Nombre aléatoire tiré par le navigateur,
// sans lien avec une personne : il sert uniquement à ne pas compter dix fois la
// même visite dans la journée. Préfixe `rezo-` comme les autres clés locales.
const VISITEUR_KEY = 'rezo-visitor'

function idVisiteur() {
  try {
    let id = localStorage.getItem(VISITEUR_KEY)
    if (!/^[0-9a-f]{32}$/.test(id || '')) {
      id = (crypto.randomUUID?.() || '').replace(/-/g, '')
      if (!/^[0-9a-f]{32}$/.test(id)) return null
      localStorage.setItem(VISITEUR_KEY, id)
    }
    return id
  } catch {
    // Stockage refusé (navigation privée) : on ne compte pas plutôt que de
    // compter faux à chaque ouverture.
    return null
  }
}

/**
 * Passage d'un visiteur NON connecté. Sans cela, les statistiques ne voyaient
 * que les inscrits — c'est-à-dire une minorité des passages.
 */
export async function recordAnonVisit(dept = null) {
  const id = idVisiteur()
  if (!id) {
    // Navigation privée, ou navigateur sans générateur aléatoire : on préfère
    // ne pas compter plutôt que compter faux. Mais on le dit.
    console.warn('[Armana] Passage anonyme non compté : identifiant indisponible.')
    return
  }
  try {
    const { error } = await supabase.rpc('record_anon_visit', { p_visitor: id, p_dept: dept })
    if (error) console.warn('[Armana] Passage non enregistré :', error.code, error.message)
  } catch (e) {
    console.warn('[Armana] Passage non enregistré :', e.message)
  }
}

/**
 * Complète la ligne de visite du jour avec le département OBSERVÉ — appelé par
 * la carte quand la géolocalisation aboutit. Seul le code du département part
 * en base, jamais la position (choix de Matthieu). Premier arrivé gagne : la
 * base ignore l'appel si la ligne du jour est déjà renseignée.
 */
export async function tagVisitDept(dept) {
  if (!dept) return
  try {
    const { error } = await supabase.rpc('tag_visit_dept', {
      p_dept: dept,
      p_visitor: getUser() ? null : idVisiteur(),
    })
    if (error) console.warn('[Armana] Département non enregistré :', error.code, error.message)
  } catch (e) {
    console.warn('[Armana] Département non enregistré :', e.message)
  }
}

/** Statistiques complètes du tableau de bord (admin uniquement). */
/**
 * Nombre TOTAL de visites depuis le début — la même personne compte autant de
 * fois qu'elle est venue, contrairement aux « visiteurs uniques ».
 *
 * ⚠ Renvoie `null` si la migration 0023 n'est pas encore appliquée : l'écran
 * masque alors simplement la ligne, plutôt que d'afficher un zéro trompeur.
 */
export async function getVisitsTotal() {
  const { data, error } = await supabase.rpc('visits_total')
  if (error) return null
  return data ?? null
}

/**
 * Événements APPROUVÉS et non terminés — ce que le public voit réellement.
 * `admin_stats.evenements.a_venir` compte tous les statuts, rejetés compris :
 * son total ne pouvait donc pas correspondre au graphique par département.
 * Renvoie `null` tant que la migration 0024 n'est pas appliquée.
 */
/**
 * Les VISITES par période — aujourd'hui, hier, cette semaine, ce mois-ci, et
 * le total. Ce sont bien des visites (somme des ouvertures), pas des visiteurs
 * uniques : quelqu'un venu trois fois aujourd'hui compte trois fois.
 * Semaine et mois sont CALENDAIRES (lundi, 1er du mois), pas glissants.
 */
export async function getVisitsSummary() {
  const { data, error } = await supabase.rpc('visits_summary')
  if (error) return null
  return data ?? null
}

/**
 * Fréquentation des 30 derniers jours, par jour et par département, EN VISITES.
 *
 * ⚠ Ne pas revenir aux `par_jour` / `par_departement` d'`admin_stats` : ceux-là
 * comptent des LIGNES, soit un visiteur par jour, donc des VISITEURS. Les avoir
 * affichés à côté de tuiles en visites donnait 59 face à 115 pour le même jour,
 * sans que rien n'explique l'écart.
 * Renvoie `null` tant que la migration 0027 n'est pas appliquée.
 */
export async function getVisitsBreakdown() {
  const { data, error } = await supabase.rpc('visits_breakdown')
  if (error) return null
  return data ?? null
}

/**
 * Événements publiés depuis la création d'Armana. Vient d'un compteur que la
 * purge mensuelle ne touche pas — compter la table `events` donnerait un total
 * qui rétrécit à chaque purge.
 */
export async function getPublishedTotal() {
  const { data, error } = await supabase.rpc('events_published_total')
  if (error) return null
  return data ?? null
}

export async function getUpcomingPublished() {
  const { data, error } = await supabase.rpc('events_upcoming_published')
  if (error) return null
  return data ?? null
}

// (La date de début de mesure n'est plus affichée : les grands chiffres sont
//  désormais des cumuls depuis la création, sans borne à rappeler. La fonction
//  `visits_since()` reste disponible en base si le besoin revenait.)

export async function getAdminStats() {
  const { data, error } = await supabase.rpc('admin_stats')
  if (error) throw error
  return data
}
