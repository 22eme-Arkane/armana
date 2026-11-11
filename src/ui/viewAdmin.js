// Armana — Modération : ce qui attend une décision, cloisonné à MA zone.
//
// Refonte du 11/11/2026 (Matthieu). Trois onglets au lieu d'un empilement :
//   · Événements — la file à valider ;
//   · Fiches — les lieux et food trucks qui demandent à être publiés ;
//   · Food trucks — le SUIVI des camions déjà publiés.
// ⚠ Un compteur n'apparaît que là où il y a QUELQUE CHOSE À DÉCIDER (les deux
// premiers onglets). L'ancien « Food trucks (5) » affichait le nombre de
// camions publiés : un chiffre qui ne retombait jamais à zéro et se lisait
// comme une notification permanente. Le suivi n'en porte donc aucun.
//
// Les ACTIONS (approuver, rejeter) sont cloisonnées en base (politiques
// can_moderate, migration 0020) : hors zone, elles échouent quoi qu'affiche
// l'écran. La LECTURE des pending, elle, reste ouverte à tous les modérateurs —
// assumé (contenu destiné au public, relu par des personnes choisies par le
// propriétaire) ; le filtre par zone ci-dessous est donc un confort
// d'affichage, pas une barrière.
import { el } from './components.js'
import { icon } from './icons.js'
import { posterEventCard } from './posterEventCard.js'
import { studioEventItem } from './studio.js'
import { bloc, note, onglets, pageGestion, pastilles, pluriel, vide } from './gestion.js'
import { isAdmin } from '../lib/auth.js'
import { demoActif } from '../lib/demo.js'
import { listPendingEvents, setEventStatus } from '../lib/events.js'
import { myModDepts } from '../lib/moderation.js'
import { nomDepartement, nomRegion, regionDuDept, resumeTerritoire } from '../lib/departements.js'
import { decideFiche, listFichesEnAttente } from '../lib/fiches.js'
import { etatPlanning, reglages, suiviFoodTrucks } from '../lib/foodTrucks.js'
import { typeVisuel } from './typeCompte.js'

// L'onglet survit à un aller-retour vers une fiche ou un événement.
const memoire = { onglet: null }

const ETATS_TRUCK = {
  actif: 'à jour',
  rappel: 'à relancer',
  masque: 'masqué, faute de confirmation',
  archive: 'archivé',
}

export async function viewAdmin() {
  const wrap = pageGestion('Modération')

  if (!isAdmin() && !demoActif()) {
    wrap.appendChild(vide('Accès réservé aux modérateurs.'))
    return wrap
  }

  // Ma zone : null = tous les départements (propriétaire).
  let zone = null
  try {
    zone = await myModDepts()
  } catch {
    /* migration pas encore appliquée : on montre tout, comme avant */
  }
  const dansMaZone = (x) => !zone?.length || x.dept == null || zone.includes(x.dept)

  wrap.appendChild(
    el(
      'p',
      'g-zone-pastille',
      zone?.length ? `Votre zone : ${resumeTerritoire(zone)}` : 'Votre zone : toute la France'
    )
  )

  let events = []
  let erreur = null
  const [evs, fichesBrutes, trucksBruts, r] = await Promise.all([
    listPendingEvents().catch((e) => {
      erreur = e
      return []
    }),
    // Sans les migrations 0033 / 0034 : rien à montrer, pas d'erreur.
    listFichesEnAttente().catch(() => []),
    suiviFoodTrucks().catch(() => []),
    reglages(),
  ])
  // Un événement sans département (hors territoire, sans coordonnées) reste
  // visible de tous : personne d'autre ne le verrait.
  events = evs.filter(dansMaZone)
  let fiches = fichesBrutes.filter(dansMaZone)
  const trucks = trucksBruts.filter(dansMaZone).map((t) => {
    const { etat, jours } = etatPlanning(t.last_confirmed_at, r)
    return { ...t, etat, jours }
  })
  // « À suivre » : un camion qui ne confirme plus, ou signalé absent.
  const aSuivre = trucks.filter((t) => t.etat !== 'actif' || t.signalements > 0)
  const aJour = trucks.filter((t) => t.etat === 'actif' && !t.signalements)

  const liste = [
    { cle: 'evenements', texte: 'Événements', n: events.length },
    { cle: 'fiches', texte: 'Fiches', n: fiches.length },
  ]
  // ⚠ AUCUN COMPTEUR SUR CET ONGLET. C'est un suivi : rien n'y attend de
  // décision, et rien de ce qu'on y ferait ne ferait retomber un chiffre — il
  // se lirait comme une notification qui ne part jamais (le reproche fait à
  // « Food trucks (5) »). Les camions à surveiller sont en tête de l'onglet.
  if (trucks.length) liste.push({ cle: 'trucks', texte: 'Food trucks' })

  const corps = el('div', 'g-pile')
  const depart =
    liste.some((o) => o.cle === memoire.onglet) && memoire.onglet
      ? memoire.onglet
      : !events.length && fiches.length
        ? 'fiches'
        : 'evenements'
  const barre = onglets(liste, {
    actif: depart,
    onChange: (cle) => {
      memoire.onglet = cle
      peindre()
    },
  })
  wrap.append(barre, corps)

  function peindre() {
    corps.innerHTML = ''
    const o = barre.courant()
    if (o === 'evenements') peindreEvenements()
    else if (o === 'fiches') peindreFiches()
    else peindreTrucks()
  }

  // --- Événements ----------------------------------------------------------------
  function peindreEvenements() {
    if (erreur) {
      corps.appendChild(vide('Chargement impossible : ' + erreur.message))
      return
    }
    if (!events.length) {
      corps.appendChild(vide('Aucun événement à valider. 👌'))
      return
    }

    // ⚠ DEPUIS L'OUVERTURE À LA FRANCE : une file venue de plusieurs régions se
    // trie par région, d'un geste, au lieu de défiler tout le pays.
    const parRegion = new Map()
    for (const ev of events) {
      const reg = regionDuDept(ev.dept) ?? ''
      parRegion.set(reg, (parRegion.get(reg) ?? 0) + 1)
    }
    let region = null
    const list = el('div', 'events-list')
    if (parRegion.size > 1) {
      corps.appendChild(
        pastilles(
          [
            { cle: '*', texte: 'Toutes', n: events.length },
            ...[...parRegion]
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => ({ cle: code || '-', texte: code ? nomRegion(code) : 'Hors territoire', n })),
          ],
          {
            actif: '*',
            file: true,
            onChange: (cle) => {
              region = cle === '*' ? null : cle === '-' ? '' : cle
              for (const it of list.children) it.hidden = region != null && it.dataset.region !== region
            },
          }
        )
      )
    }
    corps.appendChild(list)

    events.forEach((ev, index) => {
      let item
      // ⚠ Deux boutons seulement. « Supprimer » a été retiré : à côté de
      // « Rejeter », il invitait à effacer définitivement l'événement de
      // quelqu'un d'un geste irréversible, là où rejeter suffit et laisse une
      // trace. La suppression reste possible depuis la fiche de l'événement.
      const approve = el('button', 'btn btn--success btn--sm', 'Approuver')
      approve.type = 'button'
      const reject = el('button', 'btn btn--ghost btn--sm', 'Rejeter')
      reject.type = 'button'

      // Une ligne : QUI a publié (le modérateur doit le savoir avant
      // d'approuver — Matthieu, 16/10/2026 ; le nom seul, sans « Par ») et D'OÙ
      // vient l'événement, précieux dès qu'on modère plusieurs départements.
      const meta = el('div', 'g-evenement-meta')
      const qui = el('span', 'g-evenement-meta__qui')
      qui.append(icon('user'), el('strong', null, ev.author_name || 'Anonyme'))
      const ou = el('span', 'g-evenement-meta__ou' + (ev.dept ? '' : ' g-evenement-meta__ou--hors'))
      ou.append(icon('pin'), el('span', null, ev.dept ? `${ev.dept} · ${nomDepartement(ev.dept)}` : 'hors territoire'))
      meta.append(qui, ou)

      async function moderate(status) {
        approve.disabled = reject.disabled = true
        try {
          await setEventStatus(ev.id, status)
          events = events.filter((x) => x.id !== ev.id)
          barre.compteur('evenements', events.length)
          item.remove()
          if (!events.length) peindre()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          approve.disabled = reject.disabled = false
        }
      }
      approve.addEventListener('click', () => moderate('approved'))
      reject.addEventListener('click', () => moderate('rejected'))

      // (Pas d'étiquette « En attente » : dans cette file, tout l'est.)
      const card = posterEventCard(ev, { showGem: false, index })
      item = studioEventItem(card, [meta, approve, reject])
      item.dataset.region = regionDuDept(ev.dept) ?? ''
      list.appendChild(item)
    })
  }

  // --- Fiches des lieux et des food trucks (migration 0033) ---------------------------
  function peindreFiches() {
    if (!fiches.length) {
      corps.appendChild(vide('Aucune fiche à valider.'))
      return
    }
    corps.appendChild(note('Un lieu ou un food truck n’apparaît au public qu’une fois sa fiche validée.'))
    for (const f of fiches) {
      const v = typeVisuel(f.kind)
      const carte = el('article', 'g-carte')
      const ligne = el('div', 'g-fiche')
      if (f.photo_url) {
        const img = el('img', 'g-fiche__photo')
        img.src = f.photo_url
        img.alt = ''
        ligne.appendChild(img)
      }
      const c = el('div', 'g-fiche__corps')
      const type = el('span', 'g-fiche__type', v.libelle)
      type.style.color = v.couleur
      c.appendChild(type)
      c.appendChild(el('strong', 'g-fiche__nom', f.name))
      c.appendChild(
        el(
          'span',
          'g-fiche__auteur',
          (f.proprietaire?.display_name || 'Anonyme') + (f.dept ? ` · ${f.dept} ${nomDepartement(f.dept)}` : '')
        )
      )
      ligne.appendChild(c)
      carte.appendChild(ligne)
      if (f.description) {
        carte.appendChild(
          el('p', 'g-texte', f.description.slice(0, 180) + (f.description.length > 180 ? '…' : ''))
        )
      }
      const boutons = el('div', 'g-boutons')
      const voir = el('a', 'btn btn--ghost btn--sm', 'Voir la fiche')
      voir.href = '#/fiche?id=' + f.id
      const valider = el('button', 'btn btn--success btn--sm', 'Valider')
      valider.type = 'button'
      const refuser = el('button', 'btn btn--ghost btn--sm', 'Refuser')
      refuser.type = 'button'
      const decider = async (status) => {
        valider.disabled = refuser.disabled = true
        try {
          await decideFiche(f.id, status)
          fiches = fiches.filter((x) => x.id !== f.id)
          barre.compteur('fiches', fiches.length)
          carte.remove()
          if (!fiches.length) peindre()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          valider.disabled = refuser.disabled = false
        }
      }
      valider.addEventListener('click', () => decider('approved'))
      refuser.addEventListener('click', () => decider('rejected'))
      boutons.append(voir, valider, refuser)
      carte.appendChild(boutons)
      corps.appendChild(carte)
    }
  }

  // --- Suivi des food trucks publiés (migration 0034) -----------------------------------
  function ligneTruck(t) {
    const a = el('a', `g-ligne g-truck g-truck--${t.signalements ? 'signale' : t.etat}`)
    a.href = '#/fiche?id=' + t.id
    const c = el('div', 'g-ligne__corps')
    c.appendChild(el('span', 'g-ligne__nom', t.name))
    const details = [
      t.jours <= 0 ? 'planning confirmé aujourd’hui' : `planning confirmé il y a ${pluriel(t.jours, 'jour')}`,
    ]
    if (t.etat !== 'actif') details.unshift(ETATS_TRUCK[t.etat])
    c.appendChild(el('span', 'g-ligne__detail', details.join(' · ')))
    if (t.signalements) {
      c.appendChild(
        el(
          'span',
          'g-ligne__detail g-ligne__detail--alerte',
          `signalé absent ${t.signalements} fois cette semaine`
        )
      )
    }
    a.append(c, icon('chevronRight'))
    return a
  }

  function peindreTrucks() {
    corps.appendChild(
      note(
        'Rien à valider ici : c’est un suivi. Un camion qui ne confirme plus son planning est ' +
          'relancé, puis masqué de la carte automatiquement.'
      )
    )
    if (aSuivre.length) {
      const b = bloc('À suivre', 'bell', 'rouge', { compte: aSuivre.length, liste: true })
      // Les plus signalés d'abord, puis les plus anciens à confirmer.
      for (const t of [...aSuivre].sort((x, y) => y.signalements - x.signalements || y.jours - x.jours)) {
        b.corps.appendChild(ligneTruck(t))
      }
      corps.appendChild(b.bloc)
    } else {
      corps.appendChild(vide('Tous les camions sont à jour. 👌'))
    }
    if (aJour.length) {
      const b = bloc('À jour', 'check', 'vert', { compte: aJour.length, liste: true })
      const repli = el('details', 'g-repli')
      repli.appendChild(
        el('summary', null, aJour.length > 1 ? `Voir les ${aJour.length} camions` : 'Voir le camion')
      )
      for (const t of aJour) repli.appendChild(ligneTruck(t))
      b.corps.appendChild(repli)
      corps.appendChild(b.bloc)
    }
  }

  peindre()
  return wrap
}
