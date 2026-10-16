// Armana — écran « Modérateurs » (propriétaire uniquement).
//
// Refonte du 16/10/2026 (Matthieu) :
//   * la COUVERTURE du territoire — qui modère chaque département, ceux que
//     personne ne couvre, ce qui attend dans chacun ;
//   * l'ACTIVITÉ de chaque modérateur (décisions sur 30 jours, dernière
//     action), pour repérer celui qui ne modère plus ;
//   * les candidatures avec le contexte du candidat ;
//   * NOMMER en choisissant parmi les membres — l'e-mail reste en dépannage ;
//   * les dernières actions du journal.
//
// Le rôle s'appelle toujours `admin` en base (identifiant technique) ; dans
// l'interface, ce sont des modérateurs. Tout est réservé au propriétaire et
// imposé en base (migrations 0020, 0037).
import './admin.css'
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, getUser } from '../lib/auth.js'
import {
  amIOwner,
  listAdminActions,
  listAdmins,
  listMembers,
  moderationCoverage,
  setAdminByEmail,
} from '../lib/admins.js'
import { decideModeratorRequest, listModeratorRequests, setModerator } from '../lib/moderation.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import { avatarMembre, etiquetteType } from './typeCompte.js'
import { normaliser } from './viewMembers.js'
import { estSensible, raconter } from './viewJournal.js'

const QUAND = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** Au-delà, un modérateur sans aucune action est signalé comme inactif. */
const JOURS_INACTIF = 30

function joursDepuis(iso) {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null
}
function depuis(iso) {
  const j = joursDepuis(iso)
  if (j == null) return 'jamais'
  if (j <= 0) return 'aujourd’hui'
  if (j === 1) return 'hier'
  return `il y a ${j} jours`
}
/** Le prénom, pour les tuiles de couverture où la place manque. */
const prenom = (a) => String(a.display_name || a.email || '?').trim().split(/\s+/)[0]

export async function viewAdmins() {
  const wrap = el('section', 'page page--studio-sub page--admin')
  wrap.appendChild(studioHeader('Modérateurs', { backTo: '/parametres' }))

  if (!isLoggedIn() || !(await amIOwner())) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  const corps = el('div', 'admin-pile')
  wrap.appendChild(corps)

  async function tout() {
    const [admins, demandes, couverture, journal] = await Promise.all([
      listAdmins(),
      listModeratorRequests().catch(() => []),
      moderationCoverage().catch(() => null),
      listAdminActions(5).catch(() => []),
    ])
    corps.innerHTML = ''
    corps.appendChild(blocCouverture(admins, couverture))
    const enAttente = demandes.filter((d) => d.status === 'pending')
    if (enAttente.length) corps.appendChild(blocCandidatures(enAttente))
    corps.appendChild(blocModerateurs(admins))
    corps.appendChild(blocNommer(admins))
    corps.appendChild(blocJournal(journal))
  }

  try {
    await tout()
  } catch (e) {
    corps.appendChild(emptyState('Chargement impossible : ' + e.message))
  }
  return wrap

  // --- 1. Couverture du territoire ---------------------------------------------
  function blocCouverture(admins, couverture) {
    const c = el('section', 'admin-carte')
    c.appendChild(el('h3', 'admin-carte__titre', 'Couverture du territoire'))
    const moderateurs = admins.filter((a) => !a.is_owner)
    const attente = new Map((couverture ?? []).map((r) => [r.dept, (r.events_pending ?? 0) + (r.fiches_pending ?? 0)]))
    const grille = el('div', 'couverture')
    for (const d of DEPARTEMENTS) {
      const qui = moderateurs.filter((a) => (a.mod_depts ?? []).includes(d.code))
      const n = attente.get(d.code) ?? 0
      const t = el('div', 'couverture__dept')
      t.title = d.nom
      t.classList.add(!qui.length ? 'couverture__dept--vide' : n >= 5 ? 'couverture__dept--charge' : 'couverture__dept--ok')
      t.appendChild(el('strong', 'couverture__code', d.code))
      t.appendChild(
        el('span', 'couverture__qui', qui.length ? qui.map(prenom).join(', ') : 'personne')
      )
      if (couverture) t.appendChild(el('span', 'couverture__attente', n ? `${n} en attente` : 'à jour'))
      grille.appendChild(t)
    }
    c.appendChild(grille)
    const hors = attente.get('hors') ?? 0
    c.appendChild(
      el(
        'p',
        'admin-carte__detail',
        'Rouge : aucun modérateur — vous seul relisez ce département. Jaune : 5 publications ou plus attendent.' +
          (hors ? ` ${hors} en attente hors territoire (sans département).` : '')
      )
    )
    return c
  }

  // --- 2. Candidatures, avec le contexte du candidat ------------------------------
  function blocCandidatures(demandes) {
    const c = el('section', 'admin-carte admin-carte--signal')
    c.appendChild(el('h3', 'admin-carte__titre', `Candidatures (${demandes.length})`))
    for (const d of demandes) {
      const item = el('div', 'candidat')
      const tete = el('div', 'candidat__tete')
      tete.appendChild(avatarMembre(d.display_name, d.account_type, 'petit'))
      const ident = el('div', 'candidat__ident')
      const nom = el('button', 'candidat__nom', d.display_name)
      nom.type = 'button'
      nom.title = 'Voir sa fiche'
      nom.addEventListener('click', () => navigate('/membre?id=' + d.user_id + '&retour=moderateurs'))
      ident.appendChild(nom)
      const contexte = []
      if (d.member_since) contexte.push('inscrit ' + depuis(d.member_since).replace('il y a', 'depuis'))
      if (d.events_total != null) contexte.push(`${d.events_total} publication${d.events_total > 1 ? 's' : ''}`)
      ident.appendChild(el('span', 'candidat__contexte', contexte.join(' · ')))
      tete.appendChild(ident)
      if (d.account_type) tete.appendChild(etiquetteType(d.account_type))
      item.appendChild(tete)

      const zone = el('p', 'candidat__zone')
      zone.appendChild(el('span', null, 'Demande : '))
      zone.appendChild(el('strong', null, d.depts.join(' · ')))
      item.appendChild(zone)
      if (d.role_actuel === 'admin') {
        item.appendChild(
          el(
            'p',
            'candidat__note',
            `Déjà modérateur (${(d.depts_actuels ?? []).join(', ') || 'tout'}) — demande une extension.`
          )
        )
      }
      if (d.message) item.appendChild(el('p', 'candidat__message', '« ' + d.message + ' »'))

      const boutons = el('div', 'admin-carte__boutons')
      const ok = el('button', 'btn btn--success btn--sm', 'Accepter')
      ok.type = 'button'
      const non = el('button', 'btn btn--ghost btn--sm', 'Refuser')
      non.type = 'button'
      const decider = async (accept) => {
        const q = accept
          ? `Nommer ${d.display_name} modérateur de : ${d.depts.join(', ')} ?`
          : `Refuser la candidature de ${d.display_name} ?`
        if (!confirm(q)) return
        ok.disabled = non.disabled = true
        try {
          await decideModeratorRequest(d.id, accept)
          await tout()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          ok.disabled = non.disabled = false
        }
      }
      ok.addEventListener('click', () => decider(true))
      non.addEventListener('click', () => decider(false))
      boutons.append(ok, non)
      item.appendChild(boutons)
      c.appendChild(item)
    }
    return c
  }

  // --- 3. Les modérateurs et leur activité ------------------------------------------
  function blocModerateurs(admins) {
    const c = el('section', 'admin-carte')
    const moderateurs = admins.filter((a) => !a.is_owner)
    c.appendChild(
      el('h3', 'admin-carte__titre', `${moderateurs.length} modérateur${moderateurs.length > 1 ? 's' : ''}`)
    )
    if (!moderateurs.length) {
      c.appendChild(
        el('p', 'admin-carte__detail', 'Personne pour l’instant : vous relisez seul tout le territoire.')
      )
      return c
    }
    const myId = getUser()?.id
    for (const a of moderateurs) {
      const item = el('div', 'moder')
      const tete = el('div', 'moder__tete')
      tete.appendChild(avatarMembre(a.display_name || a.email, a.account_type, 'petit'))
      const ident = el('div', 'moder__ident')
      const nom = el('button', 'moder__nom', (a.display_name || a.email) + (a.id === myId ? ' (vous)' : ''))
      nom.type = 'button'
      nom.title = 'Voir sa fiche'
      nom.addEventListener('click', () => navigate('/membre?id=' + a.id + '&retour=moderateurs'))
      ident.appendChild(nom)

      // L'activité : ce qui distingue un modérateur présent d'un rôle oublié.
      const sansAction = joursDepuis(a.last_action_at)
      const ancienneteRole = joursDepuis(a.role_since)
      const inactif =
        (sansAction == null && (ancienneteRole == null || ancienneteRole > JOURS_INACTIF)) ||
        (sansAction != null && sansAction > JOURS_INACTIF)
      const activite = el(
        'span',
        'moder__activite' + (inactif ? ' moder__activite--inactif' : ''),
        inactif
          ? a.last_action_at
            ? `Aucune action depuis ${sansAction} jours`
            : 'Aucune action enregistrée'
          : `${a.actions_30d ?? 0} décision${(a.actions_30d ?? 0) > 1 ? 's' : ''} en 30 j · dernière : ${depuis(a.last_action_at)}`
      )
      ident.appendChild(activite)
      tete.appendChild(ident)

      // La zone : un résumé qui s'ouvre sur les pastilles (chaque touche
      // enregistre aussitôt).
      const bascule = el('button', 'moder__zone-resume')
      bascule.type = 'button'
      tete.appendChild(bascule)
      item.appendChild(tete)

      const zone = el('div', 'admin-zone')
      zone.hidden = true
      let depts = [...(a.mod_depts ?? [])]
      const boutons = new Map()
      const peindre = () => {
        for (const [code, b] of boutons) b.classList.toggle('is-active', depts.includes(code))
        bascule.textContent = depts.length ? depts.join(' · ') : 'aucun'
        bascule.setAttribute('aria-expanded', String(!zone.hidden))
        bascule.title = 'Modifier la zone de ' + (a.display_name || a.email)
      }
      // ⚠ Pendant l'enregistrement, TOUTES les pastilles sont gelées : deux
      // touches rapprochées partiraient chacune de l'état d'avant l'autre, et
      // la seconde écraserait la première (set_moderator remplace la zone).
      const geler = (oui) => {
        for (const b of boutons.values()) b.disabled = oui
      }
      for (const d of DEPARTEMENTS) {
        const b = el('button', 'admin-zone__dept', d.code)
        b.type = 'button'
        b.title = d.nom
        b.setAttribute('aria-label', d.nom)
        b.addEventListener('click', async () => {
          const prochain = depts.includes(d.code) ? depts.filter((x) => x !== d.code) : [...depts, d.code]
          if (
            !prochain.length &&
            !confirm(`Plus aucun département : retirer le rôle de modérateur à ${a.display_name || a.email} ?`)
          ) {
            return
          }
          geler(true)
          try {
            const res = await setModerator(a.id, prochain)
            if (res?.role !== 'admin') {
              await tout() // le rôle est retiré : la carte disparaît
              return
            }
            depts = [...(res.mod_depts ?? [])]
            peindre()
          } catch (e) {
            alert('Modification impossible : ' + e.message)
          } finally {
            geler(false)
          }
        })
        boutons.set(d.code, b)
        zone.appendChild(b)
      }
      bascule.addEventListener('click', () => {
        zone.hidden = !zone.hidden
        peindre()
      })
      peindre()
      item.appendChild(zone)
      c.appendChild(item)
    }
    return c
  }

  // --- 4. Nommer : parmi les membres, ou par e-mail en dépannage ---------------------
  function blocNommer(admins) {
    const c = el('section', 'admin-carte')
    c.appendChild(el('h3', 'admin-carte__titre', 'Nommer un modérateur'))
    const dejaModos = new Set(admins.map((a) => a.id))

    const recherche = el('label', 'admin-recherche')
    recherche.appendChild(icon('search'))
    const champ = el('input')
    champ.type = 'search'
    champ.placeholder = 'Chercher un membre…'
    champ.autocomplete = 'off'
    champ.setAttribute('aria-label', 'Chercher un membre à nommer')
    recherche.appendChild(champ)
    c.appendChild(recherche)

    const resultats = el('div', 'nommer__resultats')
    c.appendChild(resultats)
    const choix = el('div', 'nommer__choix')
    choix.hidden = true
    c.appendChild(choix)

    let membres = null
    let choisi = null
    const depts = new Set()

    champ.addEventListener('input', async () => {
      const q = normaliser(champ.value)
      resultats.innerHTML = ''
      if (q.length < 2) return
      if (!membres) {
        try {
          membres = (await listMembers()).filter((m) => !dejaModos.has(m.id) && !m.is_owner)
        } catch (e) {
          resultats.appendChild(el('p', 'form__hint', 'Chargement impossible : ' + e.message))
          return
        }
      }
      const trouves = membres.filter((m) => normaliser(m.display_name).includes(q)).slice(0, 6)
      if (!trouves.length) {
        resultats.appendChild(el('p', 'form__hint', 'Aucun membre (non modérateur) ne porte ce nom.'))
        return
      }
      for (const m of trouves) {
        const b = el('button', 'admin-membre admin-membre--compact')
        b.type = 'button'
        b.appendChild(avatarMembre(m.display_name, m.account_type, 'petit'))
        const corpsLigne = el('div', 'admin-membre__corps')
        corpsLigne.appendChild(el('span', 'admin-membre__nom', m.display_name || 'Sans nom'))
        corpsLigne.appendChild(
          el('span', 'admin-membre__detail', `${m.events_total ?? 0} publication${(m.events_total ?? 0) > 1 ? 's' : ''}`)
        )
        b.appendChild(corpsLigne)
        b.addEventListener('click', () => {
          choisi = m
          resultats.innerHTML = ''
          champ.value = m.display_name || ''
          peindreChoix()
        })
        resultats.appendChild(b)
      }
    })

    const msg = el('p', 'form__msg')
    function peindreChoix() {
      choix.innerHTML = ''
      choix.hidden = !choisi
      if (!choisi) return
      choix.appendChild(el('p', 'admin-carte__detail', `Zone de ${choisi.display_name} :`))
      const zone = el('div', 'admin-zone')
      for (const d of DEPARTEMENTS) {
        const b = el('button', 'admin-zone__dept', d.code)
        b.type = 'button'
        b.title = d.nom
        b.setAttribute('aria-label', d.nom)
        b.classList.toggle('is-active', depts.has(d.code))
        b.addEventListener('click', () => {
          if (depts.has(d.code)) depts.delete(d.code)
          else depts.add(d.code)
          b.classList.toggle('is-active', depts.has(d.code))
        })
        zone.appendChild(b)
      }
      choix.appendChild(zone)
      const nommer = el('button', 'btn btn--primary btn--block')
      nommer.type = 'button'
      nommer.append(icon('userPlus'), el('span', null, ' Nommer modérateur'))
      nommer.addEventListener('click', async () => {
        if (!depts.size) {
          msg.className = 'form__msg form__msg--err'
          msg.textContent = 'Choisissez au moins un département.'
          return
        }
        const liste = [...depts].sort()
        if (!confirm(`${choisi.display_name} : modérateur de ${liste.join(', ')} ?`)) return
        nommer.disabled = true
        msg.className = 'form__msg'
        msg.textContent = 'Enregistrement…'
        try {
          await setModerator(choisi.id, liste)
          await tout()
        } catch (e) {
          msg.className = 'form__msg form__msg--err'
          msg.textContent = e.message
          nommer.disabled = false
        }
      })
      choix.append(nommer, msg)
    }

    // Par e-mail : dépannage, replié (le chemin normal est la recherche
    // ci-dessus, ou les candidatures).
    const details = el('details', 'nommer__email')
    details.appendChild(el('summary', null, 'Par e-mail (dépannage)'))
    const email = el('input', 'form__input')
    email.type = 'email'
    email.placeholder = 'personne@exemple.fr'
    email.setAttribute('aria-label', 'E-mail du compte')
    const zoneEmail = el('div', 'admin-zone')
    const choisisEmail = new Set()
    for (const d of DEPARTEMENTS) {
      const b = el('button', 'admin-zone__dept', d.code)
      b.type = 'button'
      b.title = d.nom
      b.setAttribute('aria-label', d.nom)
      b.addEventListener('click', () => {
        if (choisisEmail.has(d.code)) choisisEmail.delete(d.code)
        else choisisEmail.add(d.code)
        b.classList.toggle('is-active', choisisEmail.has(d.code))
      })
      zoneEmail.appendChild(b)
    }
    const msgEmail = el('p', 'form__msg')
    const go = el('button', 'btn btn--ghost btn--block', 'Désigner par e-mail')
    go.type = 'button'
    go.addEventListener('click', async () => {
      const adresse = email.value.trim()
      msgEmail.className = 'form__msg form__msg--err'
      if (!adresse) return (msgEmail.textContent = 'Entrez un e-mail.')
      if (!choisisEmail.size) return (msgEmail.textContent = 'Choisissez au moins un département.')
      go.disabled = true
      msgEmail.className = 'form__msg'
      msgEmail.textContent = 'Traitement…'
      try {
        // Deux temps : la RPC par e-mail retrouve le compte et donne le rôle,
        // puis on pose la zone demandée (set_moderator travaille sur un id).
        const res = await setAdminByEmail(adresse, true)
        if (res?.id) await setModerator(res.id, [...choisisEmail].sort())
        await tout()
      } catch (e) {
        msgEmail.className = 'form__msg form__msg--err'
        msgEmail.textContent = e.message
        go.disabled = false
      }
    })
    details.append(email, zoneEmail, go, msgEmail)
    c.appendChild(details)
    return c
  }

  // --- 5. Les dernières actions ------------------------------------------------------
  function blocJournal(journal) {
    const c = el('section', 'admin-carte')
    c.appendChild(el('h3', 'admin-carte__titre', 'Dernières actions'))
    if (!journal.length) {
      c.appendChild(el('p', 'admin-carte__detail', 'Aucune action enregistrée pour l’instant.'))
    }
    for (const a of journal) {
      const ligne = el('div', 'journal-court' + (estSensible(a) ? ' journal-court--sensible' : ''))
      ligne.appendChild(el('span', 'journal-court__texte', raconter(a)))
      ligne.appendChild(el('span', 'journal-court__quand', QUAND.format(new Date(a.created_at))))
      c.appendChild(ligne)
    }
    const lien = el('button', 'btn btn--ghost btn--block', 'Tout le journal')
    lien.type = 'button'
    lien.addEventListener('click', () => navigate('/journal'))
    c.appendChild(lien)
    return c
  }
}
