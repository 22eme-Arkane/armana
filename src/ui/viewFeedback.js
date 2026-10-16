// Armana — écran « Messages » (propriétaire) : bugs signalés et avis.
//
// Refonte du 16/10/2026 (Matthieu) : une boîte de réception qu'on TRAITE au
// lieu de la vider. Onglets « À traiter » / « Traités » (un message traité est
// rangé, pas effacé), filtre Bugs / Avis, le type de compte de l'auteur, et —
// pour comprendre un bug — l'appareil et la version de l'app, notés à l'envoi
// (migration 0037). Pas de réponse dans l'app pour l'instant (décision de
// Matthieu) : on écrit à la personne depuis sa fiche.
import './admin.css'
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import {
  deleteFeedback,
  listFeedback,
  markFeedbackRead,
  setFeedbackHandled,
} from '../lib/feedback.js'
import { avatarMembre, typeVisuel } from './typeCompte.js'

const DTF = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const VERSION = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** « il y a 5 min », « il y a 3 h », « hier », sinon la date. */
function ilYA(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  if (h < 48) return 'hier'
  return DTF.format(new Date(iso))
}

/** La version de l'app, lisible : son numéro est l'heure de sa construction. */
function versionLisible(v) {
  if (!v) return null
  if (v === 'dev') return 'version de développement'
  const n = Number(v)
  return Number.isFinite(n) ? 'version du ' + VERSION.format(new Date(n)) : 'version ' + v
}

// L'onglet et le filtre survivent au passage par une fiche membre.
const memoire = { onglet: 'a_traiter', type: 'tous' }

export async function viewFeedback() {
  const wrap = el('section', 'page page--studio-sub page--admin')
  wrap.appendChild(studioHeader('Messages', { backTo: '/parametres' }))

  // Messages « Nous contacter » et signalements : le PROPRIÉTAIRE seul — les
  // modérateurs n'ont que la modération et les statistiques. La base impose
  // déjà cette limite (0020) ; on évite juste un écran d'erreur.
  if (!isAdmin() || !(await amIOwner().catch(() => false))) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  let items = []
  try {
    items = await listFeedback()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  // ⚠ ORDRE : on LIT d'abord, on MARQUE ensuite. Les messages chargés gardent
  // leur `read_at` d'avant la visite, ce qui permet de signaler ceux qui
  // étaient nouveaux. Sans attendre la réponse : l'écran n'en dépend pas.
  if (items.some((f) => 'read_at' in f && !f.read_at)) markFeedbackRead()

  // Sans la migration 0037, pas de « traité » : tout reste « à traiter ».
  const gereTraite = items.some((f) => 'handled_at' in f) || !items.length

  const onglets = el('div', 'admin-segments')
  const filtres = el('div', 'admin-chips')
  const liste = el('div', 'admin-liste')
  wrap.append(onglets, filtres, liste)
  wrap.appendChild(
    el(
      'p',
      'form__hint admin-note',
      'Envoyés depuis « Nous contacter » et les signalements d’événement. Pour répondre, ' +
        'touchez le nom de l’auteur : sa fiche donne son adresse.'
    )
  )

  function peindre() {
    const aTraiter = items.filter((f) => !f.handled_at)
    const traites = items.filter((f) => f.handled_at)

    onglets.innerHTML = ''
    for (const [cle, texte, n] of [
      ['a_traiter', 'À traiter', aTraiter.length],
      ['traites', 'Traités', traites.length],
    ]) {
      if (cle === 'traites' && !gereTraite) continue
      const b = el('button', 'admin-segment', `${texte} · ${n}`)
      b.type = 'button'
      b.classList.toggle('is-active', memoire.onglet === cle)
      b.addEventListener('click', () => {
        memoire.onglet = cle
        peindre()
      })
      onglets.appendChild(b)
    }

    const source = memoire.onglet === 'traites' ? traites : aTraiter
    filtres.innerHTML = ''
    for (const [cle, texte] of [
      ['tous', 'Tous'],
      ['bug', 'Bugs'],
      ['avis', 'Avis'],
    ]) {
      const n = cle === 'tous' ? source.length : source.filter((f) => f.type === cle).length
      const b = el('button', 'admin-chip')
      b.type = 'button'
      b.append(el('span', null, texte), el('span', 'admin-chip__n', String(n)))
      b.classList.toggle('is-active', memoire.type === cle)
      b.addEventListener('click', () => {
        memoire.type = cle
        peindre()
      })
      filtres.appendChild(b)
    }

    const visibles = memoire.type === 'tous' ? source : source.filter((f) => f.type === memoire.type)
    liste.innerHTML = ''
    if (!visibles.length) {
      liste.appendChild(
        emptyState(
          memoire.onglet === 'traites'
            ? 'Aucun message traité.'
            : items.length
              ? 'Rien à traiter. 👌'
              : 'Aucun message pour l’instant.'
        )
      )
      return
    }
    for (const f of visibles) liste.appendChild(carteMessage(f))
  }

  function carteMessage(f) {
    const carte = el('article', `message-carte message-carte--${f.type === 'bug' ? 'bug' : 'avis'}`)
    if ('read_at' in f && !f.read_at) carte.classList.add('message-carte--nouveau')

    // En-tête : l'auteur (vers sa fiche), son type, quand, et la nature.
    const tete = el('div', 'message-carte__tete')
    tete.appendChild(avatarMembre(f.author_name, f.author_type, 'petit'))
    const qui = el('div', 'message-carte__qui')
    // ⚠ Un message sans auteur (compte supprimé depuis) n'a pas de fiche : on
    // laisse alors le nom en simple texte plutôt qu'un lien vers une
    // « fiche introuvable ».
    if (f.created_by) {
      const auteur = el('button', 'message-carte__auteur', f.author_name)
      auteur.type = 'button'
      auteur.title = 'Voir sa fiche pour lui répondre'
      auteur.addEventListener('click', () =>
        navigate(`/membre?id=${encodeURIComponent(f.created_by)}&retour=messages`)
      )
      qui.appendChild(auteur)
    } else {
      qui.appendChild(el('span', 'message-carte__auteur', f.author_name))
    }
    qui.appendChild(
      el(
        'span',
        'message-carte__quand',
        (f.created_by ? typeVisuel(f.author_type).libelle + ' · ' : '') + ilYA(f.created_at)
      )
    )
    tete.appendChild(qui)
    if ('read_at' in f && !f.read_at) tete.appendChild(el('span', 'message-carte__nouveau', 'Nouveau'))
    tete.appendChild(
      el('span', `message-carte__type message-carte__type--${f.type}`, f.type === 'bug' ? 'Bug' : 'Avis')
    )
    carte.appendChild(tete)

    carte.appendChild(el('p', 'message-carte__texte', f.message))

    // L'appareil et la version : notés à l'envoi depuis la migration 0037.
    const technique = [f.appareil, versionLisible(f.app_version)].filter(Boolean).join(' · ')
    if (technique) carte.appendChild(el('p', 'message-carte__technique', technique))

    const actions = el('div', 'message-carte__actions')
    if (gereTraite) {
      const ranger = el('button', 'btn btn--sm ' + (f.handled_at ? 'btn--ghost' : 'btn--primary'))
      ranger.type = 'button'
      ranger.append(icon('check'), el('span', null, f.handled_at ? ' Remettre à traiter' : ' Marquer traité'))
      ranger.addEventListener('click', async () => {
        ranger.disabled = true
        try {
          await setFeedbackHandled(f.id, !f.handled_at)
          f.handled_at = f.handled_at ? null : new Date().toISOString()
          f.read_at = f.read_at || new Date().toISOString()
          peindre()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          ranger.disabled = false
        }
      })
      actions.appendChild(ranger)
    }
    const effacer = el('button', 'btn btn--ghost btn--sm message-carte__effacer')
    effacer.type = 'button'
    effacer.title = 'Effacer définitivement'
    effacer.setAttribute('aria-label', 'Effacer définitivement')
    effacer.appendChild(icon('trash'))
    effacer.addEventListener('click', async () => {
      if (!confirm('Effacer définitivement ce message ?')) return
      effacer.disabled = true
      try {
        await deleteFeedback(f.id)
        items = items.filter((x) => x !== f)
        peindre()
      } catch (e) {
        alert('Suppression impossible : ' + e.message)
        effacer.disabled = false
      }
    })
    actions.appendChild(effacer)
    carte.appendChild(actions)
    return carte
  }

  peindre()
  return wrap
}
