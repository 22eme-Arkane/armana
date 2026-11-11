// Armana — écran « Modérateurs » (propriétaire uniquement).
//
// Refonte du 11/11/2026 (Matthieu : « pas pratique, c'est le bazar »). L'écran
// empilait cinq sections — couverture, candidatures, modérateurs, nomination,
// journal —, et depuis l'ouverture à la France chacune dépliait treize menus
// de régions. Il tient désormais en TROIS ONGLETS, chacun pour une question :
//   · Équipe       — qui modère, où, et est-il actif ? (+ nommer quelqu'un)
//   · Candidatures — qui demande à l'être ?
//   · Couverture   — où manque-t-il quelqu'un ? (la carte de France)
// La zone d'un modérateur se règle dans une FEUILLE (ui/zoneFeuille.js), sur
// la carte, avec un bouton pour valider. Le journal a son écran (/journal).
//
// Le rôle s'appelle toujours `admin` en base (identifiant technique) ; dans
// l'interface, ce sont des modérateurs. Tout est réservé au propriétaire et
// imposé en base (migrations 0020, 0037).
import { el } from './components.js'
import { icon } from './icons.js'
import { bloc, chiffres, depuis, joursDepuis, note, onglets, pageGestion, pluriel, vide } from './gestion.js'
import { feuilleGestion, ouvrirZone } from './zoneFeuille.js'
import { carteDepartements } from './carteDepts.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, getUser } from '../lib/auth.js'
import { amIOwner, listAdmins, listMembers, moderationCoverage, setAdminByEmail } from '../lib/admins.js'
import { demoActif } from '../lib/demo.js'
import { decideModeratorRequest, listModeratorRequests, setModerator } from '../lib/moderation.js'
import { CODES_DEPARTEMENTS, nomDepartement, resumeTerritoire, zoneEnClair } from '../lib/departements.js'
import { avatarMembre, etiquetteType } from './typeCompte.js'
import { normaliser } from './viewMembers.js'

/** Au-delà, un modérateur sans aucune action est signalé comme inactif. */
const JOURS_INACTIF = 30
/** À partir de là, un département est dit « chargé ». */
const SEUIL_CHARGE = 5

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

// L'onglet survit à un aller-retour vers une fiche membre.
const memoire = { onglet: null }

export async function viewAdmins() {
  const wrap = pageGestion('Modérateurs')

  if (!demoActif() && (!isLoggedIn() || !(await amIOwner()))) {
    wrap.appendChild(vide('Réservé au propriétaire du projet.'))
    return wrap
  }

  const tete = el('div', 'g-pile')
  const corps = el('div', 'g-pile')
  wrap.append(tete, corps)

  // Le journal : une ligne, toujours au même endroit, sous les onglets.
  const versJournal = el('div', 'g-groupe')
  const ligneJournal = el('button', 'g-ligne')
  ligneJournal.type = 'button'
  const cj = el('div', 'g-ligne__corps')
  cj.append(
    el('span', 'g-ligne__nom', 'Journal des actions'),
    el('span', 'g-ligne__detail', 'Tout ce que les modérateurs ont décidé, jour par jour.')
  )
  ligneJournal.append(cj, icon('chevronRight'))
  ligneJournal.addEventListener('click', () => navigate('/journal'))
  versJournal.appendChild(ligneJournal)
  wrap.appendChild(versJournal)

  let admins = []
  let demandes = []
  let couverture = null
  let barre = null

  /** Recharge tout et redessine — après chaque décision. */
  async function tout() {
    ;[admins, demandes, couverture] = await Promise.all([
      listAdmins(),
      listModeratorRequests().catch(() => []),
      moderationCoverage().catch(() => null),
    ])
    const moderateurs = admins.filter((a) => !a.is_owner)
    const enAttente = demandes.filter((d) => d.status === 'pending')
    const couverts = new Set(moderateurs.flatMap((a) => a.mod_depts ?? []))
    const aRelire = (couverture ?? []).reduce((s, r) => s + (r.events_pending ?? 0) + (r.fiches_pending ?? 0), 0)

    tete.innerHTML = ''
    tete.appendChild(
      chiffres([
        { valeur: moderateurs.length, libelle: moderateurs.length > 1 ? 'modérateurs' : 'modérateur' },
        { valeur: enAttente.length, libelle: enAttente.length > 1 ? 'candidatures' : 'candidature', alerte: enAttente.length > 0 },
        { valeur: `${couverts.size}/${CODES_DEPARTEMENTS.length}`, libelle: 'départ. couverts' },
        { valeur: aRelire, libelle: 'à relire' },
      ])
    )
    const depart = memoire.onglet ?? (enAttente.length ? 'candidatures' : 'equipe')
    barre = onglets(
      [
        { cle: 'equipe', texte: 'Équipe' },
        { cle: 'candidatures', texte: 'Candidatures', n: enAttente.length },
        { cle: 'couverture', texte: 'Couverture' },
      ],
      {
        actif: depart,
        onChange: (cle) => {
          memoire.onglet = cle
          peindre()
        },
      }
    )
    tete.appendChild(barre)
    peindre()
  }

  function peindre() {
    corps.innerHTML = ''
    const o = barre.courant()
    if (o === 'equipe') peindreEquipe()
    else if (o === 'candidatures') peindreCandidatures()
    else peindreCouverture()
  }

  try {
    await tout()
  } catch (e) {
    corps.appendChild(vide('Chargement impossible : ' + e.message))
  }
  return wrap

  // --- Équipe : qui modère, où, et est-il actif ? ---------------------------------
  function peindreEquipe() {
    const moderateurs = admins.filter((a) => !a.is_owner)
    const myId = getUser()?.id

    const nommer = el('button', 'btn btn--primary btn--block')
    nommer.type = 'button'
    nommer.append(icon('userPlus'), el('span', null, 'Nommer un modérateur'))
    nommer.addEventListener('click', () => ouvrirNomination())
    corps.appendChild(nommer)

    if (!moderateurs.length) {
      corps.appendChild(vide('Personne pour l’instant : vous relisez seul toute la France.'))
      return
    }

    for (const a of moderateurs) {
      const nom = a.display_name || a.email
      const carte = el('article', 'g-carte')
      const haut = el('div', 'g-candidat__tete')
      haut.appendChild(avatarMembre(nom, a.account_type))
      const ident = el('div', 'g-ligne__corps')
      const lien = el('button', 'g-lien', nom + (a.id === myId ? ' (vous)' : ''))
      lien.type = 'button'
      lien.title = 'Voir sa fiche'
      lien.addEventListener('click', () => navigate('/membre?id=' + a.id + '&retour=moderateurs'))
      ident.appendChild(lien)

      // L'activité : ce qui distingue un modérateur présent d'un rôle oublié.
      const sansAction = joursDepuis(a.last_action_at)
      const ancienneteRole = joursDepuis(a.role_since)
      const inactif =
        (sansAction == null && (ancienneteRole == null || ancienneteRole > JOURS_INACTIF)) ||
        (sansAction != null && sansAction > JOURS_INACTIF)
      ident.appendChild(
        el(
          'span',
          'g-ligne__detail' + (inactif ? ' g-ligne__detail--alerte' : ''),
          inactif
            ? a.last_action_at
              ? `Aucune action depuis ${sansAction} jours`
              : 'Aucune action enregistrée'
            : a.last_action_at
              ? `${pluriel(a.actions_30d ?? 0, 'décision')} en 30 jours · dernière ${depuis(a.last_action_at)}`
              : 'Nommé récemment, pas encore d’action'
        )
      )
      haut.appendChild(ident)
      if (inactif) haut.appendChild(el('span', 'g-etiquette g-etiquette--refus', 'inactif'))
      carte.appendChild(haut)

      const depts = [...(a.mod_depts ?? [])]
      const zone = el('p', 'g-candidat__demande')
      zone.appendChild(el('strong', null, depts.length ? zoneEnClair(depts) : 'Toute la France'))
      carte.appendChild(zone)

      const modifier = el('button', 'btn btn--ghost btn--sm', 'Modifier sa zone')
      modifier.type = 'button'
      modifier.addEventListener('click', () =>
        ouvrirZone({
          titre: `Zone de ${nom}`,
          aide: 'Touchez une région pour la confier en entier, ou affinez par département.',
          selection: depts,
          nom,
          onValider: async (codes) => {
            await setModerator(a.id, codes)
            await tout()
          },
          onRetirer: async () => {
            await setModerator(a.id, [])
            await tout()
          },
        })
      )
      const boutons = el('div', 'g-boutons')
      boutons.appendChild(modifier)
      carte.appendChild(boutons)
      corps.appendChild(carte)
    }
  }

  // --- Candidatures, avec le contexte du candidat --------------------------------------
  function peindreCandidatures() {
    const enAttente = demandes.filter((d) => d.status === 'pending')
    const traitees = demandes.filter((d) => d.status !== 'pending')

    if (!enAttente.length) corps.appendChild(vide('Aucune candidature en attente.'))

    for (const d of enAttente) {
      const carte = el('article', 'g-carte g-candidat')
      const haut = el('div', 'g-candidat__tete')
      haut.appendChild(avatarMembre(d.display_name, d.account_type))
      const ident = el('div', 'g-ligne__corps')
      const lien = el('button', 'g-lien', d.display_name)
      lien.type = 'button'
      lien.title = 'Voir sa fiche'
      lien.addEventListener('click', () => navigate('/membre?id=' + d.user_id + '&retour=moderateurs'))
      ident.appendChild(lien)
      const contexte = []
      if (d.member_since) contexte.push('inscrit ' + depuis(d.member_since))
      if (d.events_total != null) contexte.push(pluriel(d.events_total, 'publication'))
      ident.appendChild(el('span', 'g-ligne__detail', contexte.join(' · ')))
      haut.appendChild(ident)
      if (d.account_type && d.account_type !== 'particulier') haut.appendChild(etiquetteType(d.account_type))
      carte.appendChild(haut)

      const demande = el('p', 'g-candidat__demande')
      demande.append(
        document.createTextNode(d.role_actuel === 'admin' ? 'Demande en plus : ' : 'Demande : '),
        el('strong', null, zoneEnClair(d.depts))
      )
      carte.appendChild(demande)
      if (d.role_actuel === 'admin') {
        carte.appendChild(
          el(
            'p',
            'g-texte',
            `Déjà modérateur de : ${d.depts_actuels?.length ? zoneEnClair(d.depts_actuels) : 'toute la France'}.`
          )
        )
      }
      if (d.message) carte.appendChild(el('p', 'g-candidat__message', '« ' + d.message + ' »'))

      const boutons = el('div', 'g-boutons')
      const ok = el('button', 'btn btn--success btn--sm', 'Accepter')
      ok.type = 'button'
      const non = el('button', 'btn btn--ghost btn--sm', 'Refuser')
      non.type = 'button'
      const decider = async (accept) => {
        const q = accept
          ? `Nommer ${d.display_name} modérateur de : ${resumeTerritoire(d.depts)} ?`
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
      carte.appendChild(boutons)
      corps.appendChild(carte)
    }

    if (traitees.length) {
      const b = bloc('Déjà traitées', 'check', 'vert', { compte: traitees.length, liste: true })
      const repli = el('details', 'g-repli')
      repli.appendChild(el('summary', null, 'Voir l’historique'))
      for (const d of traitees) {
        const l = el('div', 'g-ligne')
        const c = el('div', 'g-ligne__corps')
        c.appendChild(el('span', 'g-ligne__nom', d.display_name))
        c.appendChild(
          el(
            'span',
            'g-ligne__detail',
            `${resumeTerritoire(d.depts)} · ${DATE.format(new Date(d.decided_at || d.created_at))}`
          )
        )
        l.appendChild(c)
        l.appendChild(
          el(
            'span',
            'g-etiquette ' + (d.status === 'approved' ? 'g-etiquette--ok' : 'g-etiquette--refus'),
            d.status === 'approved' ? 'acceptée' : 'refusée'
          )
        )
        repli.appendChild(l)
      }
      b.corps.appendChild(repli)
      corps.appendChild(b.bloc)
    }
  }

  // --- Couverture : où manque-t-il quelqu'un ? -----------------------------------------
  function peindreCouverture() {
    const moderateurs = admins.filter((a) => !a.is_owner)
    const quiModere = (code) => moderateurs.filter((a) => (a.mod_depts ?? []).includes(code))
    const attente = new Map(
      (couverture ?? []).map((r) => [r.dept, (r.events_pending ?? 0) + (r.fiches_pending ?? 0)])
    )
    const couverts = CODES_DEPARTEMENTS.filter((c) => quiModere(c).length)

    corps.appendChild(
      note(
        `${pluriel(couverts.length, 'département')} sur ${CODES_DEPARTEMENTS.length} ` +
          `${couverts.length > 1 ? 'ont' : 'a'} un modérateur. Partout ailleurs, vous relisez seul.`
      )
    )

    const info = el('p', 'g-info-dept', 'Touchez un département pour voir qui le modère.')
    const cadre = el('div', 'g-france')
    const carte = carteDepartements({
      // Un état par département — les plus urgents l'emportent.
      classe: (code) => {
        const n = attente.get(code) ?? 0
        if (n >= SEUIL_CHARGE) return 'est-charge'
        if (n > 0 && !quiModere(code).length) return 'est-en-attente'
        return quiModere(code).length ? 'est-couvert' : ''
      },
      onPick: (code) => {
        for (const p of carte.querySelectorAll('[data-code]')) {
          p.classList.toggle('est-choisi', p.dataset.code === code)
        }
        const qui = quiModere(code)
        const n = attente.get(code) ?? 0
        info.innerHTML = ''
        info.append(
          el('strong', null, `${code} ${nomDepartement(code)}`),
          document.createTextNode(
            ' — ' +
              (qui.length ? qui.map((a) => a.display_name || a.email).join(', ') : 'aucun modérateur') +
              ' · ' +
              (n ? `${n} en attente` : 'rien en attente')
          )
        )
      },
    })
    cadre.appendChild(carte)
    corps.appendChild(cadre)

    const legende = el('ul', 'g-legende')
    const item = (couleur, texte) => {
      const li = el('li')
      const i = el('i')
      i.style.background = couleur
      li.append(i, el('span', null, texte))
      return li
    }
    legende.append(
      item('#63d28a', 'un modérateur'),
      item('#ff8a73', 'en attente, sans modérateur'),
      item('#f4ca15', `${SEUIL_CHARGE} en attente ou plus`)
    )
    corps.append(legende, info)

    // Ce qui attend, département par département : le plus chargé d'abord.
    const lignes = [...attente].filter(([code, n]) => n > 0 && code !== 'hors').sort((a, b) => b[1] - a[1])
    if (lignes.length) {
      const b = bloc('En attente', 'clock', 'jaune', { compte: lignes.reduce((s, [, n]) => s + n, 0), liste: true })
      for (const [code, n] of lignes) {
        const qui = quiModere(code)
        const l = el('div', 'g-ligne')
        const c = el('div', 'g-ligne__corps')
        c.appendChild(el('span', 'g-ligne__nom', `${code} ${nomDepartement(code)}`))
        c.appendChild(
          el(
            'span',
            'g-ligne__detail' + (qui.length ? '' : ' g-ligne__detail--alerte'),
            qui.length ? qui.map((a) => a.display_name || a.email).join(', ') : 'aucun modérateur — vous seul'
          )
        )
        l.appendChild(c)
        l.appendChild(el('span', 'g-etiquette g-etiquette--attente', String(n)))
        b.corps.appendChild(l)
      }
      corps.appendChild(b.bloc)
    } else if (couverture) {
      corps.appendChild(vide('Rien n’attend nulle part. 👌'))
    }
    const hors = attente.get('hors') ?? 0
    if (hors) corps.appendChild(note(`${hors} en attente hors territoire (sans département) : vous seul les voyez.`))
  }

  // --- Nommer : parmi les membres, ou par e-mail en dépannage ---------------------------
  function ouvrirNomination() {
    const dejaModos = new Set(admins.map((a) => a.id))
    const { corps: c, pied, fermer } = feuilleGestion('Nommer un modérateur')
    c.appendChild(el('p', 'g-feuille__aide', 'Cherchez le membre par son nom, puis choisissez sa zone.'))

    const champ = el('label', 'g-recherche')
    champ.appendChild(icon('search'))
    const input = el('input')
    input.type = 'search'
    input.placeholder = 'Chercher un membre…'
    input.autocomplete = 'off'
    input.setAttribute('aria-label', 'Chercher un membre à nommer')
    champ.appendChild(input)
    c.appendChild(champ)
    const resultats = el('div', 'g-resultats')
    c.appendChild(resultats)

    /** Deuxième temps : la zone, puis l'enregistrement. */
    const choisirZone = (nom, enregistrer) => {
      fermer()
      ouvrirZone({
        titre: `Nommer ${nom}`,
        aide: 'Touchez une région pour la confier en entier, ou affinez par département.',
        selection: [],
        valider: 'Nommer modérateur',
        onValider: async (codes) => {
          await enregistrer(codes)
          memoire.onglet = 'equipe'
          await tout()
        },
      })
    }

    let membres = null
    input.addEventListener('input', async () => {
      const q = normaliser(input.value)
      resultats.innerHTML = ''
      if (q.length < 2) return
      if (!membres) {
        try {
          membres = (await listMembers()).filter((m) => !dejaModos.has(m.id) && !m.is_owner)
        } catch (e) {
          resultats.appendChild(el('p', 'g-feuille__msg', 'Chargement impossible : ' + e.message))
          return
        }
      }
      const trouves = membres.filter((m) => normaliser(m.display_name).includes(q)).slice(0, 6)
      if (!trouves.length) {
        resultats.appendChild(el('p', 'g-feuille__aide', 'Aucun membre (non modérateur) ne porte ce nom.'))
        return
      }
      for (const m of trouves) {
        const b = el('button', 'g-resultat')
        b.type = 'button'
        b.appendChild(avatarMembre(m.display_name, m.account_type, 'petit'))
        const t = el('span')
        t.append(
          el('strong', null, m.display_name || 'Sans nom'),
          el('span', null, pluriel(m.events_total ?? 0, 'publication'))
        )
        b.appendChild(t)
        b.addEventListener('click', () =>
          choisirZone(m.display_name || 'ce membre', (codes) => setModerator(m.id, codes))
        )
        resultats.appendChild(b)
      }
    })

    // Par e-mail : dépannage, replié (le chemin normal est la recherche
    // ci-dessus, ou les candidatures).
    const details = el('details', 'g-depannage')
    details.appendChild(el('summary', null, 'Par e-mail (dépannage)'))
    const email = el('input', 'form__input')
    email.type = 'email'
    email.placeholder = 'personne@exemple.fr'
    email.setAttribute('aria-label', 'E-mail du compte')
    const msgEmail = el('p', 'g-feuille__msg')
    const go = el('button', 'btn btn--ghost btn--block', 'Choisir sa zone')
    go.type = 'button'
    go.addEventListener('click', () => {
      const adresse = email.value.trim()
      if (!adresse) return (msgEmail.textContent = 'Entrez un e-mail.')
      // Deux temps, à la validation seulement : la RPC par e-mail retrouve le
      // compte et donne le rôle, puis on pose la zone (set_moderator travaille
      // sur un identifiant). Rien n'est écrit tant que la zone n'est pas validée.
      choisirZone(adresse, async (codes) => {
        const res = await setAdminByEmail(adresse, true)
        if (res?.id) await setModerator(res.id, codes)
      })
    })
    details.append(email, go, msgEmail)
    c.appendChild(details)

    const annuler = el('button', 'btn btn--ghost', 'Annuler')
    annuler.type = 'button'
    annuler.addEventListener('click', fermer)
    pied.appendChild(annuler)
    input.focus()
  }
}
