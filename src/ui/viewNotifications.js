// Armana — écran « Notifications » (Profil).
//
// Deux réglages distincts, et c'est volontaire :
//   1. CET APPAREIL est abonné ou non — l'autorisation du navigateur ne vaut
//      que pour le téléphone ou l'ordinateur sur lequel on se trouve ;
//   2. CE QUE JE VEUX RECEVOIR — préférences du compte, valables partout.
// Tout est désactivé au départ : rien ne part sans un choix explicite.
import { el, emptyState, loginPrompt, toggleRow } from './components.js'
import { studioHeader } from './studio.js'
import { illustrationNotifications } from './illustrations.js'
import { navigate, refresh } from '../lib/router.js'
import { getProfile, isAdmin, isLoggedIn } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import {
  TYPES,
  deviceState,
  disableOnThisDevice,
  enableOnThisDevice,
  getPrefs,
  setPrefs,
} from '../lib/notifications.js'

/** Explication honnête de l'état de l'appareil, plutôt qu'un bouton mort. */
const ETATS = {
  unsupported: {
    ton: 'warn',
    titre: 'Navigateur incompatible',
    texte:
      'Ce navigateur ne sait pas recevoir de notifications. Sur Android, Chrome les gère ; ' +
      'sur iPhone, il faut Safari et l’application installée sur l’écran d’accueil.',
  },
  'ios-not-installed': {
    ton: 'warn',
    titre: 'Installez d’abord Armana',
    texte:
      'Sur iPhone et iPad, les notifications ne fonctionnent que si l’application est ' +
      'ajoutée à l’écran d’accueil depuis Safari. Une fois installée, revenez ici.',
    lien: { libelle: 'Comment installer', vers: '/installer' },
  },
  'not-configured': {
    ton: 'warn',
    titre: 'Envoi pas encore en service',
    texte:
      'Les notifications ne sont pas encore actives côté serveur. Vous pouvez déjà ' +
      'choisir ce que vous souhaitez recevoir : vos réglages seront appliqués dès la mise en service.',
  },
  denied: {
    ton: 'warn',
    titre: 'Notifications refusées',
    texte:
      'Vous les avez refusées pour ce site, et le navigateur ne redemandera pas. ' +
      'Pour les réautoriser : touchez le cadenas dans la barre d’adresse, puis ' +
      'Notifications → Autoriser. Sur une application installée, passez par les ' +
      'réglages du téléphone.',
  },
}

export async function viewNotifications() {
  const wrap = el('section', 'page page--studio-sub page--studio-blue')
  wrap.appendChild(studioHeader('Notifications', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour régler vos notifications.'))
    return wrap
  }

  wrap.appendChild(illustrationNotifications())
  wrap.appendChild(el('p', 'page__subtitle', 'Tout est désactivé par défaut.'))

  const etat = await deviceState()
  let prefs = {}
  try {
    prefs = await getPrefs()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  // Une seule liste d'interrupteurs, comme la maquette : l'autorisation de
  // l'appareil en tête, puis ce que l'on veut recevoir. L'appareil est à part —
  // c'est une permission du navigateur, pas une préférence de compte — d'où sa
  // ligne en évidence et son explication juste dessous.
  const groupe = el('div', 'settings-group')
  const message = el('p', 'form__hint')

  // --- 1. Cet appareil ------------------------------------------------------
  // Empêché (navigateur incompatible, refus, iPhone non installé) : un
  // interrupteur qui ne s'allumerait jamais serait un mensonge. On explique.
  const empeche = ETATS[etat]
  if (!empeche) {
    groupe.appendChild(
      toggleRow('Cet appareil', {
        detail:
          etat === 'on'
            ? 'Cet appareil reçoit les notifications cochées ci-dessous.'
            : 'À autoriser une fois par appareil.',
        actif: etat === 'on',
        onChange: async (veut) => {
          message.textContent = veut ? 'Autorisation…' : 'Désactivation…'
          if (!veut) {
            await disableOnThisDevice()
            refresh()
            return
          }
          const r = await enableOnThisDevice()
          if (r === 'denied') {
            message.textContent =
              'Autorisation refusée. Réautorisez les notifications pour ce site, puis réessayez.'
            return false
          }
          refresh()
        },
      })
    )
  }

  // --- 2. Ce que je veux recevoir -------------------------------------------
  const admin = isAdmin()
  const owner = admin && (await amIOwner().catch(() => false))
  // Un réglage qui ne produira jamais rien n'a pas à être proposé : le type
  // « messages » n'est routé qu'au propriétaire par la fonction d'envoi.
  // Les réglages des food trucks ne concernent que leurs comptes.
  const camion = getProfile()?.account_type === 'food_truck'
  const visibles = TYPES.filter(
    (t) =>
      (!t.adminSeulement || admin) &&
      (!t.proprietaireSeulement || owner) &&
      (!t.foodTruckSeulement || camion)
  )

  for (const t of visibles) {
    groupe.appendChild(
      toggleRow(t.titre, {
        detail: t.detail,
        // `inverse` : la clé est un refus, l'interrupteur montre l'accord.
        actif: t.inverse ? prefs[t.cle] !== true : prefs[t.cle] === true,
        onChange: async (veut) => {
          const avant = { ...prefs }
          message.textContent = 'Enregistrement…'
          try {
            prefs = await setPrefs({ ...prefs, [t.cle]: t.inverse ? !veut : veut })
            message.textContent = 'Réglages enregistrés.'
            setTimeout(() => (message.textContent = ''), 2500)
          } catch (e) {
            prefs = avant
            message.textContent = 'Enregistrement impossible : ' + e.message
            return false
          }
        },
      })
    )
  }
  wrap.appendChild(groupe)

  if (empeche) {
    const box = el('div', `install-note install-note--${empeche.ton}`)
    box.appendChild(el('p', 'install-note__title', empeche.titre))
    box.appendChild(el('p', 'install-note__text', empeche.texte))
    if (empeche.lien) {
      const a = el('button', 'btn btn--ghost btn--sm')
      a.type = 'button'
      a.textContent = empeche.lien.libelle
      a.addEventListener('click', () => navigate(empeche.lien.vers))
      box.appendChild(a)
    }
    wrap.appendChild(box)
  }
  wrap.appendChild(message)

  if (etat !== 'on') {
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        '⚠ Ces choix sont enregistrés, mais rien n’arrivera sur cet appareil tant qu’il ' +
          'n’est pas activé ci-dessus.'
      )
    )
  }

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Armana n’envoie aucun e-mail et ne transmet votre adresse à personne. ' +
        'Les notifications passent par votre navigateur, et vous pouvez tout couper ici à tout moment.'
    )
  )

  return wrap
}

