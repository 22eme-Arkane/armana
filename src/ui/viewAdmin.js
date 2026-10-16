// Armana — Modération : file des événements en attente, cloisonnée à MA zone.
//
// Les ACTIONS (approuver, rejeter, supprimer) sont cloisonnées en base
// (politiques can_moderate, migration 0020) : hors zone, elles échouent quoi
// qu'affiche l'écran. La LECTURE des pending, elle, reste ouverte à tous les
// modérateurs — assumé (contenu destiné au public, relu par des personnes
// choisies par le propriétaire) ; le filtre ci-dessous est donc un confort
// d'affichage, pas une barrière.
import { el, emptyState } from './components.js'
import './planning.css'
import { posterEventCard } from './posterEventCard.js'
import { studioEventItem, studioHeader } from './studio.js'
import { isAdmin } from '../lib/auth.js'
import { listPendingEvents, setEventStatus } from '../lib/events.js'
import { myModDepts } from '../lib/moderation.js'
import { nomDepartement } from '../lib/departements.js'
import { decideFiche, listFichesEnAttente } from '../lib/fiches.js'
import { etatPlanning, reglages } from '../lib/foodTrucks.js'
import { supabase } from '../lib/supabaseClient.js'

export async function viewAdmin() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Modération', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux modérateurs.'))
    return wrap
  }

  // Ma zone : null = tous les départements (propriétaire).
  let zone = null
  try {
    zone = await myModDepts()
  } catch {
    /* migration pas encore appliquée : on montre tout, comme avant */
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      zone?.length
        ? `Événements en attente dans votre zone (${zone.join(', ')}).`
        : 'Événements en attente de validation.'
    )
  )
  // --- Fiches des lieux et des food trucks (migration 0033) ---------------
  // En tête de page : il y en a peu, et une fiche qui attend bloque une vitrine
  // entière, pas un seul événement.
  await sectionFiches(wrap, zone)
  await sectionFoodTrucks(wrap, zone)

  const list = el('div', 'events-list')
  wrap.appendChild(list)

  let events = await listPendingEvents()
  if (zone?.length) {
    // Un événement sans département (hors territoire, sans coordonnées) reste
    // visible de tous : personne d'autre ne le verrait.
    events = events.filter((ev) => ev.dept == null || zone.includes(ev.dept))
  }

  if (!events.length) {
    list.appendChild(emptyState('Rien à modérer dans votre zone. 👌'))
    return wrap
  }

  for (const ev of events) {
    let item
    // ⚠ Deux boutons seulement. « Supprimer » a été retiré : à côté de
    // « Rejeter », il invitait à effacer définitivement l'événement de
    // quelqu'un d'un geste irréversible, là où rejeter suffit et laisse une
    // trace. La suppression reste possible depuis la fiche de l'événement.
    const approve = el('button', 'btn btn--success btn--sm')
    approve.textContent = 'Approuver'
    const reject = el('button', 'btn btn--ghost btn--sm')
    reject.textContent = 'Rejeter'

    // D'où vient l'événement : précieux dès qu'on modère plusieurs départements.
    const dept = el(
      'span',
      'fb-tag moderation-dept' + (ev.dept ? '' : ' fb-tag--bug'),
      ev.dept ? `${ev.dept} · ${nomDepartement(ev.dept)}` : 'hors territoire'
    )

    const done = () => {
      item.remove()
      if (!list.querySelector('.studio-event-item')) {
        list.appendChild(emptyState('Rien à modérer dans votre zone. 👌'))
      }
    }

    async function moderate(action) {
      ;[approve, reject].forEach((b) => (b.disabled = true))
      try {
        await action()
        done()
      } catch (e) {
        alert('Action impossible : ' + e.message)
        ;[approve, reject].forEach((b) => (b.disabled = false))
      }
    }

    approve.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'approved')))
    reject.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'rejected')))

    // Qui a publié : le modérateur doit le savoir avant d'approuver (Matthieu,
    // 16/10/2026).
    const auteur = el('span', 'fb-tag moderation-auteur', 'Par ' + (ev.author_name || 'un membre'))
    const card = posterEventCard(ev, { showGem: false, index: events.indexOf(ev) })
    item = studioEventItem(card, [auteur, dept, approve, reject], { status: ev.status })
    list.appendChild(item)
  }
  return wrap
}

const LIBELLE_FICHE = { lieu: 'Lieu culturel', food_truck: 'Food truck' }

const LIBELLE_ETAT = {
  actif: 'à jour',
  rappel: 'à relancer',
  masque: 'masqué (pas de confirmation)',
  archive: 'archivé',
}

/**
 * Les food trucks publiés : leur état (calculé depuis la dernière
 * confirmation) et les signalements « Pas là » des sept derniers jours.
 * Silencieux sans la migration 0034.
 */
async function sectionFoodTrucks(wrap, zone) {
  const [trucksRes, reportsRes, r] = await Promise.all([
    supabase
      .from('fiches')
      .select('id, name, dept, last_confirmed_at')
      .eq('kind', 'food_truck')
      .eq('status', 'approved')
      .order('name'),
    supabase.from('food_truck_reports').select('truck_id, report_date'),
    reglages(),
  ])
  if (trucksRes.error) return
  let trucks = trucksRes.data
  if (zone?.length) trucks = trucks.filter((t) => t.dept == null || zone.includes(t.dept))
  if (!trucks.length) return
  const nb = new Map()
  for (const s of reportsRes.data ?? []) nb.set(s.truck_id, (nb.get(s.truck_id) ?? 0) + 1)

  const details = el('details', 'moderation-trucks')
  details.appendChild(el('summary', 'studio-title', `Food trucks (${trucks.length})`))
  for (const t of trucks) {
    const { etat, jours } = etatPlanning(t.last_confirmed_at, r)
    const ligne = el('a', 'moderation-truck moderation-truck--' + etat)
    ligne.href = '#/fiche?id=' + t.id
    ligne.appendChild(el('strong', null, t.name))
    const s = nb.get(t.id)
    ligne.appendChild(
      el(
        'span',
        null,
        `${LIBELLE_ETAT[etat]} · confirmé il y a ${jours} j` +
          (s ? ` · ${s} signalement${s > 1 ? 's' : ''} cette semaine` : '')
      )
    )
    details.appendChild(ligne)
  }
  wrap.appendChild(details)
}

/** Les fiches en attente, chacune avec Voir · Valider · Refuser. */
async function sectionFiches(wrap, zone) {
  let fiches = []
  try {
    fiches = await listFichesEnAttente()
  } catch {
    return // migration 0033 absente : rien à montrer
  }
  if (zone?.length) fiches = fiches.filter((f) => f.dept == null || zone.includes(f.dept))
  if (!fiches.length) return

  wrap.appendChild(el('h3', 'studio-title', `Fiches à valider (${fiches.length})`))
  const liste = el('div', 'moderation-fiches')
  for (const f of fiches) {
    const item = el('article', 'moderation-fiche')
    if (f.photo_url) {
      const img = el('img', 'moderation-fiche__photo')
      img.src = f.photo_url
      img.alt = ''
      item.appendChild(img)
    }
    const corps = el('div', 'moderation-fiche__corps')
    corps.appendChild(el('span', 'moderation-fiche__type', LIBELLE_FICHE[f.kind]))
    corps.appendChild(el('strong', 'moderation-fiche__nom', f.name))
    corps.appendChild(el('span', 'moderation-auteur', 'Par ' + (f.proprietaire?.display_name || 'un membre')))
    if (f.description) corps.appendChild(el('p', 'moderation-fiche__texte', f.description.slice(0, 160) + (f.description.length > 160 ? '…' : '')))
    const boutons = el('div', 'moderation-fiche__boutons')
    const voir = el('a', 'btn btn--ghost btn--sm', 'Voir')
    voir.href = '#/fiche?id=' + f.id
    const valider = el('button', 'btn btn--success btn--sm', 'Valider')
    const refuser = el('button', 'btn btn--ghost btn--sm', 'Refuser')
    const decider = async (status) => {
      valider.disabled = refuser.disabled = true
      try {
        await decideFiche(f.id, status)
        item.remove()
      } catch (e) {
        alert('Action impossible : ' + e.message)
        valider.disabled = refuser.disabled = false
      }
    }
    valider.addEventListener('click', () => decider('approved'))
    refuser.addEventListener('click', () => decider('rejected'))
    boutons.append(voir, valider, refuser)
    corps.appendChild(boutons)
    item.appendChild(corps)
    liste.appendChild(item)
  }
  wrap.appendChild(liste)
  wrap.appendChild(el('h3', 'studio-title', 'Événements'))
}
