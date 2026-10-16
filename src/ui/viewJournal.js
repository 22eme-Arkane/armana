// Armana — « Journal des administrateurs », réservé au PROPRIÉTAIRE du projet.
//
// Volontairement pas ouvert à tous les admins : ce journal sert justement à
// départager les administrateurs entre eux. La restriction est imposée en base
// (RPC list_admin_actions), le contrôle ci-dessous n'est que du confort.
import { el, emptyState } from './components.js'
import { studioHeader } from './studio.js'
import { isLoggedIn } from '../lib/auth.js'
import { amIOwner, listAdminActions } from '../lib/admins.js'

const QUAND = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const STATUTS = { approved: 'approuvé', rejected: 'rejeté', pending: 'remis en attente' }

/** Une ligne de journal → une phrase française lisible. Réutilisée par
 *  l'écran Modérateurs (ses dernières actions). */
export function raconter(a) {
  const qui = a.actor_name || '(compte supprimé)'
  const quoi = a.target_label || '(sans nom)'
  const d = a.details || {}

  switch (a.action) {
    case 'role_change':
      return d.apres === 'admin'
        ? `${qui} a nommé ${quoi} modérateur.`
        : `${qui} a retiré le rôle de modérateur à ${quoi}.`
    case 'supporter':
      return d.ajoute
        ? `${qui} a ajouté ${quoi} au mur des soutiens.`
        : `${qui} a retiré ${quoi} du mur des soutiens.`
    case 'event_status':
      return `${qui} a ${STATUTS[d.apres] || 'modifié le statut de'} l’événement « ${quoi} ».`
    case 'event_delete':
      return `${qui} a supprimé l’événement « ${quoi} ».`
    case 'member_delete':
      return `${qui} a supprimé le compte de ${quoi}.`
    default:
      return `${qui} — ${a.action} — ${quoi}`
  }
}

/** Actions lourdes de conséquences : mises en évidence. */
export function estSensible(a) {
  return (
    a.action === 'event_delete' ||
    a.action === 'member_delete' ||
    (a.action === 'role_change' && a.details?.apres !== 'admin')
  )
}

export async function viewJournal() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Journal', { backTo: '/admins', backLabel: 'Modérateurs' }))

  if (!isLoggedIn() || !(await amIOwner())) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Tout ce que les modérateurs ont fait des pouvoirs qui leur sont confiés : ' +
        'modération, suppression d’événements et de comptes, changements de rôle, soutiens.'
    )
  )

  let actions = []
  try {
    actions = await listAdminActions(200)
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  if (!actions.length) {
    wrap.appendChild(
      emptyState('Aucune action enregistrée pour l’instant. Le journal démarre à sa mise en service.')
    )
    return wrap
  }

  const box = el('div', 'settings-group')
  for (const a of actions) {
    const item = el('div', 'journal-item')
    if (estSensible(a)) item.classList.add('journal-item--sensible')
    item.appendChild(el('p', 'journal-item__texte', raconter(a)))
    item.appendChild(el('span', 'journal-item__quand', QUAND.format(new Date(a.created_at))))
    box.appendChild(item)
  }
  wrap.appendChild(box)

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      `${actions.length} action${actions.length > 1 ? 's' : ''} affichée${actions.length > 1 ? 's' : ''} ` +
        '(les 200 plus récentes). Le journal ne peut être modifié ni effacé depuis ' +
        'l’application, par personne — pas même par un modérateur.'
    )
  )

  return wrap
}
