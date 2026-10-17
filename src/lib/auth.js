// Armana — état d'authentification + profil courant.
//
// Source unique de vérité côté client pour « qui est connecté et quel est son rôle ».
// La sécurité réelle reste côté base (RLS) : ce module ne sert QU'À l'affichage.
import { supabase } from './supabaseClient.js'

const state = {
  session: null,
  profile: null, // { id, display_name, role, account_type }
}

/**
 * Les types de compte (migration 0033). ⚠ Ils ne donnent AUCUN droit : ils
 * disent seulement si la personne a une fiche publique (lieu, food truck).
 */
export const TYPES_COMPTE = [
  { cle: 'particulier', texte: 'Particulier' },
  { cle: 'lieu', texte: 'Lieu culturel' },
  { cle: 'food_truck', texte: 'Food truck' },
]
const CLES_TYPE = TYPES_COMPTE.map((t) => t.cle)

const listeners = new Set()

/** S'abonner aux changements d'auth. Renvoie une fonction de désabonnement. */
export function onAuthChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  for (const fn of listeners) fn(state)
}

/** Charge le profil (rôle, nom) de l'utilisateur connecté. */
async function loadProfile() {
  if (!state.session) {
    state.profile = null
    return
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, account_type')
    .eq('id', state.session.user.id)
    .maybeSingle()
  if (error) {
    console.warn('[Armana] Profil non chargé :', error.message)
    state.profile = null
    return
  }
  state.profile = data
  // ⚠ LE TYPE CHOISI À L'INSCRIPTION ARRIVE PAR LES MÉTADONNÉES. Le trigger
  // d'inscription ne recopie que le nom ; et quand l'e-mail doit d'abord être
  // confirmé, il n'y a pas encore de session pour écrire le profil. Le choix
  // voyage donc avec le compte, et s'applique à la première connexion — sur
  // n'importe quel appareil. On ne l'applique qu'une fois, sur un profil resté
  // « particulier » : un changement fait ensuite dans le Profil n'est jamais
  // écrasé.
  const voulu = state.session.user.user_metadata?.account_type
  const fait = state.session.user.user_metadata?.account_type_applique
  if (data && !fait && CLES_TYPE.includes(voulu) && voulu !== 'particulier') {
    // ⚠ HORS du rappel d'authentification (setTimeout) : appeler une méthode
    // d'auth depuis `onAuthStateChange` peut bloquer supabase-js.
    setTimeout(() => appliquerTypeInscription(data, voulu), 0)
  }
}

async function appliquerTypeInscription(profil, voulu) {
  if (profil.account_type === 'particulier') {
    const { error } = await supabase.from('profiles').update({ account_type: voulu }).eq('id', profil.id)
    if (!error && state.profile?.id === profil.id) {
      state.profile = { ...state.profile, account_type: voulu }
      emit()
    }
  }
  const { error } = await supabase.auth.updateUser({ data: { account_type_applique: true } })
  if (error) console.warn('[Armana] Type de compte : marque non posée :', error.message)
}

/** Change le type de compte de la personne connectée (aucun droit associé). */
export async function updateAccountType(type) {
  const uid = state.session?.user?.id
  if (!uid) throw new Error('Vous n’êtes pas connecté.')
  if (!CLES_TYPE.includes(type)) throw new Error('Type de compte inconnu.')
  const { error } = await supabase.from('profiles').update({ account_type: type }).eq('id', uid)
  if (error) throw error
  await refreshProfile()
}

/** Initialise l'état d'auth au démarrage et écoute les changements. */
export async function initAuth() {
  const { data } = await supabase.auth.getSession()
  state.session = data.session
  await loadProfile()
  emit()

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session
    await loadProfile()
    emit()
  })
}

/** Recharge le profil depuis la base et prévient les écrans abonnés. */
export async function refreshProfile() {
  await loadProfile()
  emit()
  return state.profile
}

/** Longueur retenue pour le nom affiché — voir `updateDisplayName`. */
export const NOM_MIN = 2
export const NOM_MAX = 60

const NOM_PRIS = 'Ce nom est déjà utilisé par un autre membre. Choisissez-en un autre.'

/**
 * Ce nom est-il libre ? (migration 0038) — la comparaison ignore casse,
 * accents et ponctuation : « Benoît » et « benoit » sont le même nom. Son
 * propre nom est toujours libre pour soi.
 * ⚠ Sans la migration, la fonction manque : on répond « libre » plutôt que de
 * bloquer toute inscription.
 */
export async function nomDisponible(nom) {
  const { data, error } = await supabase.rpc('nom_disponible', { p_nom: nom })
  if (error) {
    console.warn('[Armana] Vérification du nom indisponible :', error.message)
    return true
  }
  return data !== false
}

/**
 * Change le nom affiché de la personne connectée.
 *
 * La politique `profiles_update_self_or_owner` autorise chacun à modifier SA
 * ligne ; le garde-fou `guard_profile_role` ne protège que `is_owner`, `role`,
 * `mod_depts` et `supporter_since`. Seule règle sur le nom depuis la migration
 * 0038 : il doit être LIBRE — deux membres ne portent pas le même.
 *
 * ⚠ LA COLONNE N'A AUCUNE CONTRAINTE DE LONGUEUR en base (`display_name text`).
 * Les bornes ci-dessous sont donc de simple confort de saisie, pas une
 * protection : un appel direct à l'API passerait outre. Rien n'en dépend —
 * le nom n'est qu'affiché, jamais interprété.
 */
export async function updateDisplayName(nom) {
  const uid = state.session?.user?.id
  if (!uid) throw new Error('Vous n’êtes pas connecté.')
  const propre = String(nom ?? '').trim().replace(/\s+/g, ' ')
  if (propre.length < NOM_MIN) throw new Error(`Le nom doit faire au moins ${NOM_MIN} caractères.`)
  if (propre.length > NOM_MAX) throw new Error(`Le nom ne peut pas dépasser ${NOM_MAX} caractères.`)
  if (!(await nomDisponible(propre))) throw new Error(NOM_PRIS)

  const { error } = await supabase.from('profiles').update({ display_name: propre }).eq('id', uid)
  // La base a le dernier mot (migration 0038) : si quelqu'un a pris ce nom
  // entre-temps, son refus remonte tel quel.
  if (error) throw error.code === '23505' ? new Error(NOM_PRIS) : error

  // Les métadonnées d'authentification ne sont lues NULLE PART par
  // l'application : le trigger d'inscription les consomme une fois, et c'est
  // tout. On les aligne quand même — sans cela la console Supabase continuerait
  // d'afficher l'ancien nom, ce qui induit en erreur quand on y cherche
  // quelqu'un. ⚠ L'échec est volontairement ignoré : il ne doit pas faire
  // croire que le changement a raté alors que `profiles` est déjà à jour.
  const { error: metaErr } = await supabase.auth.updateUser({ data: { display_name: propre } })
  if (metaErr) console.warn('[Armana] Métadonnées non alignées :', metaErr.message)

  await refreshProfile()
  return propre
}

export const getSession = () => state.session
export const getUser = () => state.session?.user ?? null
export const getProfile = () => state.profile
export const isLoggedIn = () => Boolean(state.session)
export const isAdmin = () => state.profile?.role === 'admin'

/**
 * Inscription e-mail/mot de passe. `display_name` part en métadonnées pour le
 * trigger du profil ; `account_type` aussi, appliqué à la première connexion
 * (voir loadProfile).
 */
export async function signUp(email, password, displayName, accountType = 'particulier') {
  // Le nom AVANT le compte : une fois le compte créé, il serait trop tard pour
  // en changer (la base ajouterait un numéro, voir la migration 0038).
  if (!(await nomDisponible(displayName))) throw new Error(NOM_PRIS)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, account_type: accountType } },
  })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Envoie l'e-mail de réinitialisation du mot de passe (lien → /nouveau-mdp). */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin,
  })
  if (error) throw error
}

/** Définit un nouveau mot de passe (session de récupération ou connecté). */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
