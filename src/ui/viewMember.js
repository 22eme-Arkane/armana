// Armana — fiche d'un membre (propriétaire uniquement).
//
// Refonte du 16/10/2026 (Matthieu) : TOUT ce qu'on sait d'un membre, d'un coup
// d'œil — son type de compte, son activité, sa fiche de lieu ou de food truck
// (à valider d'ici), ses publications, sa zone de modération — et, en dernier
// recours, la suppression du compte.
//
// Toutes les autorisations sont imposées en base (member_profile, set_moderator,
// decide_fiche, delete_member : propriétaire) ; les contrôles ci-dessous ne
// font qu'éviter d'afficher un bouton qui échouerait.
import './admin.css'
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate, refresh } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, deleteMember, getMemberProfile, listMemberEvents } from '../lib/admins.js'
import { setModerator } from '../lib/moderation.js'
import { decideFiche } from '../lib/fiches.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import { copyText } from '../lib/share.js'
import { avatarMembre, etiquetteType } from './typeCompte.js'

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

/**
 * D'où l'on vient, pour que la flèche de retour y ramène.
 *
 * ⚠ LISTE FERMÉE, jamais une route lue telle quelle dans l'adresse : on
 * n'envoie pas l'utilisateur vers n'importe quel chemin qu'on aurait glissé
 * dans un lien. Toute valeur inconnue retombe sur la liste des membres.
 */
const RETOURS = {
  messages: { backTo: '/messages', backLabel: 'Messages' },
  moderateurs: { backTo: '/admins', backLabel: 'Modérateurs' },
}

const STATUTS_FICHE = {
  pending: { texte: 'Fiche à valider', classe: 'attente' },
  approved: { texte: 'Fiche publiée', classe: 'ok' },
  rejected: { texte: 'Fiche refusée', classe: 'refus' },
}
const STATUTS_EVENEMENT = { pending: 'en attente', approved: 'publié', rejected: 'refusé' }
const CANDIDATURES = { pending: 'en attente', approved: 'acceptée', rejected: 'refusée' }

/** « aujourd'hui », « hier », « il y a 12 jours », sinon la date. */
function depuis(dateIso) {
  if (!dateIso) return 'jamais'
  const jours = Math.floor((Date.now() - new Date(dateIso).getTime()) / 86400000)
  if (jours <= 0) return 'aujourd’hui'
  if (jours === 1) return 'hier'
  if (jours < 31) return `il y a ${jours} jours`
  return DATE.format(new Date(dateIso))
}

export async function viewMember({ query } = {}) {
  const wrap = el('section', 'page page--studio-sub page--admin')
  // ⚠ Le retour était FIGÉ sur « Membres ». Ouverte depuis un message, la fiche
  // renvoyait donc dans la liste des inscrits au lieu de la boîte de réception.
  const retour = RETOURS[query?.get?.('retour')] ?? { backTo: '/membres', backLabel: 'Membres' }
  wrap.appendChild(studioHeader('Membre', retour))

  // Même garde que la base (member_profile est réservée au propriétaire).
  if (!isAdmin() || !(await amIOwner().catch(() => false))) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  const id = query?.get?.('id') || null
  if (!id) {
    wrap.appendChild(emptyState('Membre introuvable.'))
    return wrap
  }

  let m
  let evenements = []
  try {
    ;[m, evenements] = await Promise.all([
      getMemberProfile(id),
      listMemberEvents(id).catch(() => []),
    ])
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }
  if (!m) {
    wrap.appendChild(emptyState('Membre introuvable.'))
    return wrap
  }

  const nom = m.display_name || 'Sans nom'
  const type = m.account_type || 'particulier'
  const estAdmin = m.role === 'admin'
  const cestMoi = m.id === getUser()?.id

  // --- Identité -------------------------------------------------------------
  const tete = el('section', 'membre-tete')
  tete.appendChild(avatarMembre(nom, type, 'grand'))
  tete.appendChild(el('h2', 'membre-tete__nom', nom))
  const badges = el('div', 'membre-tete__badges')
  badges.appendChild(etiquetteType(type))
  if (m.is_owner) badges.appendChild(el('span', 'admin-badge admin-badge--role', 'Propriétaire'))
  else if (estAdmin) {
    badges.appendChild(
      el('span', 'admin-badge admin-badge--role', 'Modérateur · ' + (m.mod_depts?.join(' · ') || 'tous'))
    )
  }
  if (m.fiche_status) {
    const s = STATUTS_FICHE[m.fiche_status]
    badges.appendChild(el('span', `admin-badge admin-badge--${s.classe}`, s.texte))
  }
  if (m.supporter_since) badges.appendChild(el('span', 'admin-badge admin-badge--soutien', '💛 Soutien'))
  tete.appendChild(badges)
  wrap.appendChild(tete)

  // --- L'écrire ---------------------------------------------------------------
  // Le lien mailto ne mène nulle part si aucun logiciel de courrier n'est
  // configuré (fréquent sur ordinateur) : on offre toujours la copie.
  const contact = el('section', 'admin-carte membre-contact')
  const mail = el('span', 'membre-contact__mail')
  mail.append(icon('mail'), el('span', null, m.email))
  const ecrire = el('a', 'btn btn--primary btn--sm', 'Écrire')
  ecrire.href = 'mailto:' + m.email
  const copier = el('button', 'btn btn--ghost btn--sm', 'Copier')
  copier.type = 'button'
  copier.addEventListener('click', async () => {
    const ok = await copyText(m.email)
    copier.textContent = ok ? 'Copiée ✓' : 'Copie impossible'
    setTimeout(() => (copier.textContent = 'Copier'), 2500)
  })
  const actionsContact = el('div', 'membre-contact__actions')
  actionsContact.append(ecrire, copier)
  contact.append(mail, actionsContact)
  wrap.appendChild(contact)

  // --- Son activité -------------------------------------------------------------
  const tuiles = el('div', 'membre-tuiles')
  const tuile = (libelle, valeur, detail) => {
    const t = el('div', 'membre-tuile')
    t.appendChild(el('span', 'membre-tuile__libelle', libelle))
    t.appendChild(el('strong', 'membre-tuile__valeur', valeur))
    if (detail) t.appendChild(el('span', 'membre-tuile__detail', detail))
    return t
  }
  tuiles.append(
    tuile('Inscrit', DATE_COURTE.format(new Date(m.created_at)), new Date(m.created_at).getFullYear().toString()),
    tuile(
      'Dernière visite',
      depuis(m.last_seen),
      m.visits_30d != null ? `${m.visits_30d} jour${m.visits_30d > 1 ? 's' : ''} de visite sur 30` : null
    ),
    tuile(
      'Publications',
      String(m.events_total ?? 0),
      [
        m.events_upcoming ? `${m.events_upcoming} à venir` : null,
        m.events_pending ? `${m.events_pending} en attente` : null,
        m.events_rejected ? `${m.events_rejected} refusée${m.events_rejected > 1 ? 's' : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null
    ),
    tuile(
      'Notifications',
      m.notifs_actives == null ? '—' : m.notifs_actives ? 'activées' : 'non activées',
      m.feedback_total ? `${m.feedback_total} message${m.feedback_total > 1 ? 's' : ''} envoyé${m.feedback_total > 1 ? 's' : ''}` : null
    )
  )
  wrap.appendChild(tuiles)
  if (m.candidature_status) {
    wrap.appendChild(
      el('p', 'admin-note', `Candidature de modérateur : ${CANDIDATURES[m.candidature_status] || m.candidature_status}.`)
    )
  }

  // --- Sa fiche (lieu ou food truck) -----------------------------------------------
  if (m.fiche_id) {
    const c = el('section', 'admin-carte')
    c.appendChild(
      el('h3', 'admin-carte__titre', m.fiche_kind === 'food_truck' ? 'Sa fiche food truck' : 'Sa fiche de lieu')
    )
    c.appendChild(el('p', 'admin-carte__fort', m.fiche_name))
    const infos = []
    if (m.fiche_kind === 'food_truck') {
      infos.push(`${m.fiche_slots ?? 0} créneau${(m.fiche_slots ?? 0) > 1 ? 'x' : ''} dans la semaine`)
      if (m.fiche_confirmed_at) infos.push('planning confirmé ' + depuis(m.fiche_confirmed_at))
    }
    if (infos.length) c.appendChild(el('p', 'admin-carte__detail', infos.join(' · ')))
    const boutons = el('div', 'admin-carte__boutons')
    const voir = el('a', 'btn btn--ghost btn--sm', 'Voir la fiche')
    voir.href = '#/fiche?id=' + m.fiche_id
    boutons.appendChild(voir)
    if (m.fiche_status === 'pending') {
      const valider = el('button', 'btn btn--success btn--sm', 'Valider')
      valider.type = 'button'
      const refuser = el('button', 'btn btn--ghost btn--sm', 'Refuser')
      refuser.type = 'button'
      const decider = async (status) => {
        valider.disabled = refuser.disabled = true
        try {
          await decideFiche(m.fiche_id, status)
          refresh()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          valider.disabled = refuser.disabled = false
        }
      }
      valider.addEventListener('click', () => decider('approved'))
      refuser.addEventListener('click', () => decider('rejected'))
      boutons.append(valider, refuser)
    }
    c.appendChild(boutons)
    wrap.appendChild(c)
  }

  // --- Ses publications ------------------------------------------------------------
  if (evenements.length) {
    const c = el('section', 'admin-carte')
    c.appendChild(el('h3', 'admin-carte__titre', 'Ses publications'))
    for (const ev of evenements) {
      const a = el('a', 'membre-publication')
      a.href = '#/evenement?id=' + ev.id
      a.appendChild(el('span', 'membre-publication__titre', ev.title))
      const statut = el(
        'span',
        `membre-publication__statut membre-publication__statut--${ev.status}`,
        `${DATE_COURTE.format(new Date(ev.starts_at))} · ${STATUTS_EVENEMENT[ev.status] || ev.status}`
      )
      a.appendChild(statut)
      c.appendChild(a)
    }
    if ((m.events_total ?? 0) > evenements.length) {
      c.appendChild(el('p', 'admin-carte__detail', `… et ${m.events_total - evenements.length} plus ancienne(s).`))
    }
    wrap.appendChild(c)
  }

  // --- Modération ----------------------------------------------------------------
  const moder = el('section', 'admin-carte')
  moder.appendChild(el('h3', 'admin-carte__titre', 'Modération'))
  if (m.is_owner) {
    moder.appendChild(el('p', 'admin-carte__detail', 'Propriétaire du projet : tous les droits, sur tout le territoire.'))
  } else if (cestMoi) {
    moder.appendChild(el('p', 'admin-carte__detail', 'Vous ne pouvez pas modifier votre propre rôle.'))
  } else {
    if (estAdmin) {
      moder.appendChild(
        el(
          'p',
          'admin-carte__detail',
          `${m.actions_30d ?? 0} décision${(m.actions_30d ?? 0) > 1 ? 's' : ''} en 30 jours · dernière action : ${depuis(m.last_action_at)}`
        )
      )
    }
    moder.appendChild(
      el(
        'p',
        'admin-carte__detail',
        estAdmin
          ? 'Touchez un département pour l’ajouter ou le retirer de sa zone. Tout retirer retire le rôle.'
          : 'Touchez un ou plusieurs départements pour en faire un modérateur.'
      )
    )
    moder.appendChild(zoneModeration(m, nom))
  }
  wrap.appendChild(moder)

  // --- Supprimer le compte ------------------------------------------------------------
  // Ni le propriétaire ni soi-même : la base le refuserait aussi.
  if (!m.is_owner && !cestMoi) wrap.appendChild(blocSuppression(m, nom))

  return wrap
}

/**
 * La zone en pastilles : chaque touche enregistre aussitôt — comme sur
 * l'écran Modérateurs, pas de bouton « Enregistrer » à oublier.
 */
function zoneModeration(m, nom) {
  const box = el('div', 'admin-zone')
  let depts = m.role === 'admin' ? [...(m.mod_depts ?? [])] : []
  const boutons = new Map()
  const msg = el('p', 'form__msg')
  const peindre = () => {
    for (const [code, b] of boutons) b.classList.toggle('is-active', depts.includes(code))
  }
  // ⚠ Pendant l'enregistrement, TOUTES les pastilles sont gelées : deux touches
  // rapprochées partiraient chacune de l'état d'avant l'autre, et la seconde
  // écraserait la première (set_moderator remplace la zone entière).
  const geler = (oui) => {
    for (const b of boutons.values()) b.disabled = oui
  }
  for (const d of DEPARTEMENTS) {
    const b = el('button', 'admin-zone__dept', d.code)
    b.type = 'button'
    b.title = d.nom
    b.setAttribute('aria-label', d.nom)
    b.addEventListener('click', async () => {
      const prochain = depts.includes(d.code) ? depts.filter((c) => c !== d.code) : [...depts, d.code]
      const question = !depts.length
        ? `${nom} : modérateur de ${prochain.join(', ')} ?\n\nIl pourra approuver, modifier et supprimer les événements de cette zone, et verra les statistiques.`
        : !prochain.length
          ? `Plus aucun département : retirer le rôle de modérateur à ${nom} ?`
          : null
      if (question && !confirm(question)) return
      geler(true)
      msg.className = 'form__msg'
      msg.textContent = 'Enregistrement…'
      try {
        const res = await setModerator(m.id, prochain)
        if (res?.role !== 'admin' || !depts.length) {
          refresh() // le rôle change : badges et textes suivent
          return
        }
        depts = [...(res.mod_depts ?? [])]
        peindre()
        msg.textContent = ''
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = e.message
      } finally {
        geler(false)
      }
    })
    boutons.set(d.code, b)
    box.appendChild(b)
  }
  peindre()
  const wrap = el('div')
  wrap.append(box, msg)
  return wrap
}

/**
 * Supprimer le compte — DESTRUCTIF, d'où trois garde-fous : replié par
 * défaut, le nom à retaper, et les photos effacées AVANT le compte (la base
 * refuse sinon). Ses publications, sa fiche et son planning partent avec lui.
 */
function blocSuppression(m, nom) {
  const box = el('section', 'membre-danger')
  const ouvrir = el('button', 'membre-danger__ouvrir')
  ouvrir.type = 'button'
  ouvrir.append(icon('trash'), el('span', null, 'Supprimer ce compte…'))
  box.appendChild(ouvrir)

  const panneau = el('div', 'membre-danger__panneau')
  panneau.hidden = true
  panneau.appendChild(
    el(
      'p',
      'membre-danger__texte',
      `Le compte de ${nom} sera supprimé définitivement : ses publications, ses photos, sa fiche, son planning et ses favoris avec lui. Ses messages restent, sans auteur. C’est irréversible.`
    )
  )
  const champ = el('input', 'form__input')
  champ.type = 'text'
  champ.placeholder = 'Retapez le nom : ' + nom
  champ.setAttribute('aria-label', 'Retapez le nom du membre pour confirmer')
  champ.autocomplete = 'off'
  const supprimer = el('button', 'btn btn--danger btn--block', 'Supprimer définitivement')
  supprimer.type = 'button'
  supprimer.disabled = true
  const msg = el('p', 'form__msg')
  panneau.append(champ, supprimer, msg)
  box.appendChild(panneau)

  ouvrir.addEventListener('click', () => {
    panneau.hidden = !panneau.hidden
    if (!panneau.hidden) champ.focus()
  })
  champ.addEventListener('input', () => {
    supprimer.disabled = champ.value.trim() !== nom.trim()
  })
  supprimer.addEventListener('click', async () => {
    supprimer.disabled = true
    champ.disabled = true
    msg.className = 'form__msg'
    try {
      const n = await deleteMember(m.id, (etape) => (msg.textContent = etape))
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = `Compte supprimé${n ? ` (${n} photo${n > 1 ? 's' : ''} effacée${n > 1 ? 's' : ''})` : ''}.`
      setTimeout(() => navigate('/membres'), 1200)
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Suppression impossible : ' + e.message
      supprimer.disabled = false
      champ.disabled = false
    }
  })
  return box
}
