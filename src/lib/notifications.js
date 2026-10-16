// Armana — notifications push (norme Web Push, clés VAPID).
//
// Entièrement gratuit : aucun service tiers, le navigateur fait le transport.
// TOUT EST DÉSACTIVÉ PAR DÉFAUT — il faut à la fois l'autorisation du
// navigateur ET un choix explicite dans l'écran Profil → Notifications.
//
// Deux notions séparées :
//   * l'APPAREIL est abonné ou non (autorisation + abonnement enregistré) ;
//   * les PRÉFÉRENCES disent ce qu'on veut recevoir, et suivent le compte.
import { supabase } from './supabaseClient.js'

/** Clé publique VAPID — publique par nature, elle voyage dans le navigateur. */
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

export const TYPES = [
  {
    cle: 'moderation',
    titre: 'Événements à valider',
    detail: 'Quand un événement de votre zone attend d’être relu.',
    adminSeulement: true,
  },
  {
    cle: 'messages',
    titre: 'Messages reçus',
    detail: 'Courriers, signalements et candidatures.',
    adminSeulement: true,
    // La fonction d'envoi ne route ce type qu'au propriétaire : proposer
    // l'interrupteur à un modérateur serait un réglage sans aucun effet.
    proprietaireSeulement: true,
  },
  {
    cle: 'nouveaux_evenements',
    titre: 'Nouveaux événements',
    detail: 'Quand un événement est publié dans l’agenda.',
    adminSeulement: false,
  },
  {
    // Migration 0036 : notifications PERSONNELLES des food trucks. ⚠ La clé
    // enregistrée est un REFUS (« food_truck_off ») : le camion est prévenu
    // par défaut, l'interrupteur affiche donc l'inverse de la clé.
    cle: 'food_truck_off',
    inverse: true,
    titre: 'Mon food truck',
    detail: 'Rappel de confirmer votre planning, signalements « pas là », annonces sur un événement.',
    adminSeulement: false,
    foodTruckSeulement: true,
  },
]

// --- Capacités de l'appareil -------------------------------------------------

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** iOS n'autorise les notifications que si l'app est sur l'écran d'accueil. */
export function iosNeedsInstall() {
  const ua = navigator.userAgent || ''
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!ios) return false
  const installee =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  return !installee
}

export function vapidConfigured() {
  return VAPID_PUBLIC.length > 20
}

/**
 * État de CET appareil.
 * @returns {Promise<'unsupported'|'ios-not-installed'|'not-configured'|'denied'|'off'|'on'>}
 */
export async function deviceState() {
  if (!pushSupported()) return iosNeedsInstall() ? 'ios-not-installed' : 'unsupported'
  if (iosNeedsInstall()) return 'ios-not-installed'
  if (!vapidConfigured()) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await currentSubscription()
  return sub ? 'on' : 'off'
}

async function currentSubscription() {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager.getSubscription()) || null
  } catch {
    return null
  }
}

// --- Abonnement de l'appareil ------------------------------------------------

/** La clé VAPID voyage en base64url ; l'API la veut en octets bruts. */
function base64UrlToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const brut = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...brut].map((c) => c.charCodeAt(0)))
}

/**
 * Demande l'autorisation puis enregistre cet appareil.
 * @returns {Promise<'on'|'denied'|'error'>}
 */
export async function enableOnThisDevice() {
  if (!pushSupported() || !vapidConfigured()) return 'error'

  // ⚠ Doit être appelé depuis un vrai geste de l'utilisateur, sinon les
  // navigateurs refusent la demande sans même l'afficher.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // impose que chaque push affiche quelque chose
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) {
    // L'abonnement navigateur existe mais la base ne le connaît pas : inutile
    // de le garder, il ne servirait jamais.
    await sub.unsubscribe().catch(() => {})
    throw error
  }
  return 'on'
}

/** Retire cet appareil (les préférences du compte, elles, sont conservées). */
export async function disableOnThisDevice() {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

// --- Préférences du compte ---------------------------------------------------

export async function getPrefs() {
  const { data, error } = await supabase.rpc('my_notif_prefs')
  if (error) throw error
  return data || {}
}

export async function setPrefs(prefs) {
  const { data, error } = await supabase.rpc('set_notif_prefs', { p_prefs: prefs })
  if (error) throw error
  return data || {}
}
