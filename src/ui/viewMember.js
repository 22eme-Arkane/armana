// Armana — fiche d'un membre (propriétaire uniquement).
//
// TOUT ce qu'on sait d'un membre, d'un coup d'œil : son type de compte, son
// activité, sa fiche de lieu ou de food truck (à valider d'ici), ses
// publications, sa zone de modération — et, en dernier recours, la suppression
// du compte. Refonte visuelle du 11/11/2026 (ui/gestion.js) : la zone se règle
// désormais dans une feuille, sur la carte de France, avec un bouton pour
// valider — plus dans treize menus dépliés au milieu de la page.
//
// Toutes les autorisations sont imposées en base (member_profile, set_moderator,
// decide_fiche, delete_member : propriétaire) ; les contrôles ci-dessous ne
// font qu'éviter d'afficher un bouton qui échouerait.
import { el } from './components.js'
import { icon } from './icons.js'
import { bloc, depuis, note, pageGestion, pluriel, vide } from './gestion.js'
import { ouvrirZone } from './zoneFeuille.js'
import { navigate, refresh } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, deleteMember, getMemberProfile, listMemberEvents } from '../lib/admins.js'
import { demoActif } from '../lib/demo.js'
import { setModerator } from '../lib/moderation.js'
import { decideFiche } from '../lib/fiches.js'
import { zoneEnClair } from '../lib/departements.js'
import { copyText } from '../lib/share.js'
import { avatarMembre, etiquetteType } from './typeCompte.js'

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
  journal: { backTo: '/journal', backLabel: 'Journal' },
}

const STATUTS_FICHE = {
  pending: { texte: 'Fiche à valider', classe: 'attente' },
  approved: { texte: 'Fiche publiée', classe: 'ok' },
  rejected: { texte: 'Fiche refusée', classe: 'refus' },
}
const STATUTS_EVENEMENT = { pending: 'en attente', approved: 'publié', rejected: 'refusé' }
const CANDIDATURES = { pending: 'en attente', approved: 'acceptée', rejected: 'refusée' }

export async function viewMember({ query } = {}) {
  // ⚠ Le retour était FIGÉ sur « Membres ». Ouverte depuis un message, la fiche
  // renvoyait donc dans la liste des inscrits au lieu de la boîte de réception.
  const retour = RETOURS[query?.get?.('retour')] ?? { backTo: '/membres', backLabel: 'Membres' }
  const wrap = pageGestion('Membre', retour)

  // Même garde que la base (member_profile est réservée au propriétaire).
  if (!demoActif() && (!isAdmin() || !(await amIOwner().catch(() => false)))) {
    wrap.appendChild(vide('Réservé au propriétaire du projet.'))
    return wrap
  }

  const id = query?.get?.('id') || null
  if (!id) {
    wrap.appendChild(vide('Membre introuvable.'))
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
    wrap.appendChild(vide('Chargement impossible : ' + e.message))
    return wrap
  }
  if (!m) {
    wrap.appendChild(vide('Membre introuvable.'))
    return wrap
  }

  const nom = m.display_name || 'Sans nom'
  const type = m.account_type || 'particulier'
  const estAdmin = m.role === 'admin'
  const cestMoi = m.id === getUser()?.id

  // --- Identité -------------------------------------------------------------
  const tete = el('section', 'g-identite')
  tete.appendChild(avatarMembre(nom, type, 'grand'))
  tete.appendChild(el('h2', 'g-identite__nom', nom))
  const badges = el('div', 'g-identite__badges')
  badges.appendChild(etiquetteType(type))
  if (m.is_owner) badges.appendChild(el('span', 'g-etiquette g-etiquette--role', 'Propriétaire'))
  else if (estAdmin) badges.appendChild(el('span', 'g-etiquette g-etiquette--role', 'Modérateur'))
  if (m.fiche_status) {
    const s = STATUTS_FICHE[m.fiche_status]
    badges.appendChild(el('span', `g-etiquette g-etiquette--${s.classe}`, s.texte))
  }
  if (m.supporter_since) badges.appendChild(el('span', 'g-etiquette', '💛 Soutien'))
  tete.appendChild(badges)
  wrap.appendChild(tete)

  // --- L'écrire ---------------------------------------------------------------
  // Le lien mailto ne mène nulle part si aucun logiciel de courrier n'est
  // configuré (fréquent sur ordinateur) : on offre toujours la copie.
  const contact = el('section', 'g-carte g-contact')
  const mail = el('span', 'g-contact__mail')
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
  contact.append(mail, ecrire, copier)
  wrap.appendChild(contact)

  // --- Son activité -------------------------------------------------------------
  const tuiles = el('div', 'g-tuiles')
  const tuile = (libelle, valeur, detail) => {
    const t = el('div', 'g-tuile')
    t.appendChild(el('span', 'g-tuile__libelle', libelle))
    t.appendChild(el('strong', 'g-tuile__valeur', valeur))
    if (detail) t.appendChild(el('span', 'g-tuile__detail', detail))
    return t
  }
  tuiles.append(
    tuile('Inscrit', DATE_COURTE.format(new Date(m.created_at)), new Date(m.created_at).getFullYear().toString()),
    tuile(
      'Dernière visite',
      depuis(m.last_seen),
      m.visits_30d != null ? `${pluriel(m.visits_30d, 'jour')} de visite sur 30` : null
    ),
    tuile(
      'Publications',
      String(m.events_total ?? 0),
      [
        m.events_upcoming ? `${m.events_upcoming} à venir` : null,
        m.events_pending ? `${m.events_pending} en attente` : null,
        m.events_rejected ? pluriel(m.events_rejected, 'refusée') : null,
      ]
        .filter(Boolean)
        .join(' · ') || null
    ),
    tuile(
      'Notifications',
      m.notifs_actives == null ? '—' : m.notifs_actives ? 'activées' : 'non activées',
      m.feedback_total ? `${pluriel(m.feedback_total, 'message')} envoyé${m.feedback_total > 1 ? 's' : ''}` : null
    )
  )
  wrap.appendChild(tuiles)
  if (m.candidature_status) {
    wrap.appendChild(
      note(`Candidature de modérateur : ${CANDIDATURES[m.candidature_status] || m.candidature_status}.`)
    )
  }

  // --- Sa fiche (lieu ou food truck) -----------------------------------------------
  if (m.fiche_id) {
    const estTruck = m.fiche_kind === 'food_truck'
    const b = bloc(estTruck ? 'Sa fiche food truck' : 'Sa fiche de lieu', estTruck ? 'truck' : 'landmark', estTruck ? 'rouge' : 'vert')
    b.corps.appendChild(el('p', 'g-fort', m.fiche_name))
    const infos = []
    if (estTruck) {
      infos.push(`${m.fiche_slots ?? 0} créneau${(m.fiche_slots ?? 0) > 1 ? 'x' : ''} dans la semaine`)
      if (m.fiche_confirmed_at) infos.push('planning confirmé ' + depuis(m.fiche_confirmed_at))
    }
    if (infos.length) b.corps.appendChild(el('p', 'g-texte', infos.join(' · ')))
    const boutons = el('div', 'g-boutons')
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
    b.corps.appendChild(boutons)
    wrap.appendChild(b.bloc)
  }

  // --- Ses publications ------------------------------------------------------------
  if (evenements.length) {
    const b = bloc('Ses publications', 'ticket', 'jaune', { compte: m.events_total ?? evenements.length, liste: true })
    for (const ev of evenements) {
      const a = el('a', 'g-ligne')
      a.href = '#/evenement?id=' + ev.id
      const c = el('div', 'g-ligne__corps')
      c.appendChild(el('span', 'g-ligne__nom', ev.title))
      c.appendChild(
        el(
          'span',
          'g-ligne__detail' +
            (ev.status === 'pending' ? ' g-ligne__detail--attente' : ev.status === 'rejected' ? ' g-ligne__detail--alerte' : ''),
          `${DATE_COURTE.format(new Date(ev.starts_at))} · ${STATUTS_EVENEMENT[ev.status] || ev.status}`
        )
      )
      a.append(c, icon('chevronRight'))
      b.corps.appendChild(a)
    }
    if ((m.events_total ?? 0) > evenements.length) {
      const reste = el('div', 'g-ligne')
      reste.appendChild(
        el('span', 'g-ligne__detail', `… et ${m.events_total - evenements.length} plus ancienne(s).`)
      )
      b.corps.appendChild(reste)
    }
    wrap.appendChild(b.bloc)
  }

  // --- Modération ----------------------------------------------------------------
  const moder = bloc('Modération', 'shield', 'bleu')
  if (m.is_owner) {
    moder.corps.appendChild(el('p', 'g-texte', 'Propriétaire du projet : tous les droits, sur toute la France.'))
  } else if (cestMoi) {
    moder.corps.appendChild(el('p', 'g-texte', 'Vous ne pouvez pas modifier votre propre rôle.'))
  } else {
    const zone = estAdmin ? [...(m.mod_depts ?? [])] : []
    if (estAdmin) {
      // `mod_depts` nul sur un modérateur = toute la France (cas historique).
      moder.corps.appendChild(el('p', 'g-fort', zone.length ? zoneEnClair(zone) : 'Toute la France'))
      moder.corps.appendChild(
        el(
          'p',
          'g-texte',
          (zone.length ? `${pluriel(zone.length, 'département')} · ` : '') +
            `${pluriel(m.actions_30d ?? 0, 'décision')} en 30 jours · ` +
            `dernière action : ${depuis(m.last_action_at)}`
        )
      )
    } else {
      moder.corps.appendChild(
        el(
          'p',
          'g-texte',
          `${nom} n’est pas modérateur. Un modérateur approuve, modifie et supprime les événements de sa zone, et voit les statistiques.`
        )
      )
    }
    const modifier = el('button', 'btn btn--primary btn--block', estAdmin ? 'Modifier sa zone' : 'Nommer modérateur')
    modifier.type = 'button'
    modifier.addEventListener('click', () =>
      ouvrirZone({
        titre: estAdmin ? `Zone de ${nom}` : `Nommer ${nom}`,
        aide: 'Touchez une région pour la confier en entier, ou affinez par département.',
        selection: zone,
        valider: estAdmin ? 'Enregistrer' : 'Nommer modérateur',
        nom,
        onValider: async (codes) => {
          await setModerator(m.id, codes)
          refresh() // le rôle et la zone changent : badges et textes suivent
        },
        onRetirer: estAdmin
          ? async () => {
              await setModerator(m.id, [])
              refresh()
            }
          : null,
      })
    )
    moder.corps.appendChild(modifier)
  }
  wrap.appendChild(moder.bloc)

  // --- Supprimer le compte ------------------------------------------------------------
  // Ni le propriétaire ni soi-même : la base le refuserait aussi.
  if (!m.is_owner && !cestMoi) wrap.appendChild(blocSuppression(m, nom))

  return wrap
}

/**
 * Supprimer le compte — DESTRUCTIF, d'où trois garde-fous : replié par
 * défaut, le nom à retaper, et les photos effacées AVANT le compte (la base
 * refuse sinon). Ses publications, sa fiche et son planning partent avec lui.
 */
function blocSuppression(m, nom) {
  const box = el('section', 'g-danger')
  const ouvrir = el('button', 'g-danger__ouvrir')
  ouvrir.type = 'button'
  ouvrir.append(icon('trash'), el('span', null, 'Supprimer ce compte…'))
  box.appendChild(ouvrir)

  const panneau = el('div', 'g-danger__panneau')
  panneau.hidden = true
  panneau.appendChild(
    el(
      'p',
      'g-danger__texte',
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
