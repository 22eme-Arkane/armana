// Armana — fiche publique d'un lieu culturel ou d'un food truck (migration 0033).
//
// Même allure que la fiche d'un événement (fond bleu, encart crème sous la
// photo, tout centré) : elle en reprend les styles, ficheEvenement.css.
// On y arrive par « Publié par … » sur un événement, et bientôt par la carte.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { posterEventCard } from './posterEventCard.js'
import { blocDescription } from './ficheEvenement.js'
import { getFiche } from '../lib/fiches.js'
import { listEventsByAuthor } from '../lib/events.js'
import { lireContact } from '../lib/contact.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import { getUser, isLoggedIn } from '../lib/auth.js'
import { navigate } from '../lib/router.js'
import {
  JOURS,
  aujourdhuiParis,
  dateLongue,
  foodTrucksAujourdhui,
  jourIso,
  lieuLisible,
  plageHoraire,
  planningPublic,
  signalerAbsence,
} from '../lib/foodTrucks.js'
import './planning.css'
import { formatPrix, lireMenu } from '../lib/menu.js'

const LIBELLE = { lieu: 'Lieu culturel', food_truck: 'Food truck' }
const ICONE_CONTACT = { web: 'globe', tel: 'phone', mail: 'mail' }

export async function viewFiche({ query } = {}) {
  const wrap = el('section', 'page page--studio-sub page--studio-blue fiche')
  const id = query?.get('id')
  const f = id ? await getFiche(id).catch(() => null) : null
  // Le titre dit ce qu'on regarde : « Food truck » pour un camion (Matthieu,
  // 15/10/2026), « À découvrir » pour un lieu.
  wrap.appendChild(
    studioHeader(f?.kind === 'food_truck' ? 'Food truck' : 'À découvrir', {
      backLabel: 'Retour',
      onBack: () => history.back(),
    })
  )
  if (!f) {
    wrap.appendChild(emptyState('Cette fiche n’existe pas ou n’est pas encore publiée.'))
    return wrap
  }

  // Le propriétaire voit sa fiche avant validation : on le lui rappelle.
  if (f.status !== 'approved' && f.owner_id === getUser()?.id) {
    wrap.appendChild(
      el('p', 'fiche-termine', f.status === 'pending' ? 'En attente de validation' : 'Refusée par un modérateur')
    )
  }

  // --- Photo et encart --------------------------------------------------------
  if (f.photo_url) wrap.appendChild(photo(f.photo_url, f.name))
  const entete = el('section', 'fiche-entete' + (f.photo_url ? '' : ' fiche-entete--seule'))
  const haut = el('div', 'fiche-entete__haut')
  // Le titre de page dit déjà « Food truck » : inutile de le répéter.
  if (f.kind !== 'food_truck') haut.appendChild(el('span', 'fiche-categorie', LIBELLE[f.kind]))
  haut.appendChild(el('h2', 'fiche-titre', f.name))
  const sous = f.kind === 'food_truck' ? f.cuisine : f.address ? villeDeLAdresse(f.address) : null
  if (sous) haut.appendChild(el('p', 'fiche-entete__sous', sous))
  entete.appendChild(haut)
  wrap.appendChild(entete)

  // --- Boutons : le site en grand, le reste en pastilles ----------------------
  const site = lireContact(f.website).actions.find((a) => a.type === 'web')
  const contact = lireContact(f.contact)
  const actions = [site, ...contact.actions].filter(Boolean)
  const [principal, ...autres] = actions
  if (principal) wrap.appendChild(cta(principal))
  const ronds = el('div', 'fiche-ronds')
  for (const a of autres) ronds.appendChild(rond(a.href, ICONE_CONTACT[a.type], a.type === 'web' ? 'Site' : a.label))
  // Un camion bouge : « Y aller » vers sa commune de rattachement tromperait.
  // L'itinéraire du jour est dans l'encart « Aujourd'hui ».
  if (f.address && f.kind !== 'food_truck') {
    ronds.appendChild(
      rond('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(f.address), 'navigation', 'Y aller')
    )
  }
  if (ronds.children.length) wrap.appendChild(ronds)

  // --- Food truck : où le trouver (migration 0034) ------------------------------
  // Chargés ensemble ; sans la migration, les deux restent vides et les
  // cartes ne s'affichent pas.
  const estTruck = f.kind === 'food_truck'
  const [planning, presences] = estTruck
    ? await Promise.all([
        planningPublic(f.id),
        foodTrucksAujourdhui().then((l) => (l ?? []).filter((t) => t.truck_id === f.id)),
      ])
    : [null, []]
  if (estTruck && f.status === 'approved') ajouterCarte(wrap, 'Aujourd’hui', blocAujourdhui(presences, f))

  // --- Cartes --------------------------------------------------------------------
  ajouterCarte(wrap, 'À propos', blocDescription(f.description))
  // Le menu, plat par plat, et sa photo (ardoise, carte) DANS la même carte.
  if (estTruck) ajouterCarte(wrap, 'Au menu', blocMenu(f.menu, f.product_photo_url, f.name))
  if (estTruck) ajouterCarte(wrap, 'Sa semaine', blocSemaine(planning))
  // « En photo » : la galerie du camion ou du lieu (migration 0034).
  ajouterCarte(wrap, 'En photo', blocGalerie(f.gallery_urls, f.name))
  // Un food truck n'a pas d'horaires en texte libre : « Sa semaine » (le
  // planning, plus haut) les donne, jour par jour et commune par commune.
  if (!estTruck) ajouterCarte(wrap, 'Horaires d’ouverture', texte(f.opening_hours))

  // Infos pratiques : l'adresse et ce qui reste du contact (le nom d'une
  // personne, par exemple), les liens étant devenus des boutons plus haut.
  const infos = el('div', 'fiche-infos')
  if (f.address) infos.appendChild(info('pin', estTruck ? 'Basé à' : 'Adresse', f.address))
  if (contact.reste) infos.appendChild(info('message', 'Contact', contact.reste))
  if (infos.children.length) ajouterCarte(wrap, 'Infos pratiques', infos)

  // --- Ce qu'il publie sur Armana ---------------------------------------------
  const evs = await listEventsByAuthor(f.owner_id).catch(() => [])
  if (evs.length) {
    wrap.appendChild(el('h3', 'fiche-section-bleue', f.kind === 'food_truck' ? 'Ses prochains rendez-vous' : 'À l’affiche ici'))
    const liste = el('div', 'events-list fiche-evenements')
    evs.forEach((ev, i) => liste.appendChild(posterEventCard(ev, { index: i })))
    wrap.appendChild(liste)
  }

  return wrap
}

function photo(src, alt) {
  const cadre = el('div', 'fiche-photo')
  const flou = el('img', 'fiche-photo__flou')
  flou.src = src
  flou.alt = ''
  flou.setAttribute('aria-hidden', 'true')
  const img = el('img', 'fiche-photo__img')
  img.src = src
  img.alt = alt
  cadre.append(flou, img)
  return cadre
}

function lien(href, classe) {
  const a = el('a', classe)
  a.href = href
  if (/^https?:/i.test(href)) {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  return a
}

function cta(a) {
  const n = lien(a.href, 'fiche-cta')
  n.appendChild(icon(ICONE_CONTACT[a.type]))
  const t = el('span', 'fiche-cta__texte')
  t.appendChild(el('span', null, a.type === 'web' ? (a.label === 'Site web' ? 'Voir le site' : a.label) : a.label))
  t.appendChild(el('small', null, a.detail))
  n.appendChild(t)
  return n
}

function rond(href, nomIcone, texte) {
  const n = lien(href, 'fiche-rond')
  const p = el('span', 'fiche-rond__pastille')
  p.appendChild(icon(nomIcone))
  n.append(p, el('span', 'fiche-rond__texte', texte))
  return n
}

function texte(t) {
  const s = String(t || '').trim()
  return s ? el('p', 'fiche-texte__p fiche-texte__p--centre', s) : null
}

/**
 * Le menu, TOUJOURS plat par plat avec le prix à droite — y compris un menu
 * tapé d'un seul tenant avant l'éditeur structuré (voir lib/menu.js). Puis
 * la photo du menu, dans la même carte.
 */
function blocMenu(menu, photoMenu, nom) {
  const plats = lireMenu(menu)
  if (!plats.length && !photoMenu) return null
  const box = el('div', 'fiche-menu-bloc')
  if (plats.length) {
    const ul = el('ul', 'fiche-menu')
    for (const p of plats) {
      const li = el('li', 'fiche-menu__ligne')
      li.appendChild(el('span', 'fiche-menu__plat', p.plat))
      if (p.prix != null) li.appendChild(el('span', 'fiche-menu__prix', formatPrix(p.prix)))
      ul.appendChild(li)
    }
    box.appendChild(ul)
  }
  if (photoMenu) {
    const cadre = el('div', 'fiche-produit')
    const img = el('img')
    img.src = photoMenu
    img.alt = 'Le menu de ' + nom
    img.loading = 'lazy'
    cadre.appendChild(img)
    box.appendChild(cadre)
  }
  return box
}

/** La galerie « En photo » : une à quatre photos, en mosaïque. */
function blocGalerie(urls, nom) {
  if (!urls?.length) return null
  const g = el('div', 'fiche-galerie fiche-galerie--' + Math.min(urls.length, 4))
  urls.forEach((u, i) => {
    const img = el('img', 'fiche-galerie__img')
    img.src = u
    img.alt = `${nom}, photo ${i + 1}`
    img.loading = 'lazy'
    g.appendChild(img)
  })
  return g
}

/**
 * Où est le camion aujourd'hui, et le bouton « Pas là aujourd'hui » : celui
 * qui s'est déplacé pour rien le dit, et au deuxième signalement le créneau
 * quitte la carte pour la journée (seuil réglable, migration 0034).
 */
function blocAujourdhui(presences, f) {
  const box = el('div', 'fiche-aujourdhui')
  if (!presences.length) {
    box.appendChild(el('p', 'fiche-aujourdhui__ligne', 'Pas de présence prévue aujourd’hui.'))
    return box
  }
  const moi = getUser()?.id === f.owner_id
  for (const p of presences) {
    box.appendChild(
      el('p', 'fiche-aujourdhui__ligne', `${plageHoraire(p.start_time, p.end_time)} · ${lieuLisible(p)}`)
    )
    // L'itinéraire vers l'emplacement DU JOUR, pas vers la commune de base.
    if (Number.isFinite(p.lat)) {
      const y = el('a', 'btn btn--primary btn--sm', 'Y aller')
      y.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
      y.target = '_blank'
      y.rel = 'noopener noreferrer'
      box.appendChild(y)
    }
    if (moi) continue
    const b = el('button', 'btn btn--ghost btn--sm fiche-pas-la', 'Il n’est pas là ? Signalez-le')
    b.type = 'button'
    b.addEventListener('click', async () => {
      if (!isLoggedIn()) return navigate('/connexion')
      if (!confirm(`Vous êtes sur place et ${f.name} n’y est pas ?`)) return
      b.disabled = true
      try {
        await signalerAbsence({ slotId: p.slot_id, exceptionId: p.exception_id })
        b.textContent = 'Merci, c’est noté.'
      } catch (e) {
        b.textContent = e.message
      }
    })
    box.appendChild(b)
  }
  return box
}

/** La semaine type, jour par jour, et les absences à venir. */
function blocSemaine(planning) {
  if (!planning?.creneaux.length) return null
  const auj = aujourdhuiParis()
  const box = el('div', 'fiche-planning')
  for (let j = 1; j <= 7; j++) {
    const du = planning.creneaux.filter(
      (c) => c.weekday === j && (!c.valid_until || c.valid_until >= auj)
    )
    if (!du.length) continue
    const ligne = el('div', 'fiche-planning__jour')
    ligne.appendChild(
      el('span', 'fiche-planning__nom' + (jourIso(auj) === j ? ' is-today' : ''), JOURS[j - 1])
    )
    const liste = el('div', 'fiche-planning__creneaux')
    for (const c of du) liste.appendChild(el('span', null, `${plageHoraire(c.start_time, c.end_time)} · ${lieuLisible(c)}`))
    ligne.appendChild(liste)
    box.appendChild(ligne)
  }
  const vacances = planning.exceptions.filter((e) => e.kind === 'closed' && !e.slot_id)
  for (const v of vacances.slice(0, 2)) {
    box.appendChild(
      el(
        'p',
        'fiche-planning__note',
        v.date_start === v.date_end
          ? `Fermé le ${dateLongue(v.date_start)}.`
          : `En congé du ${dateLongue(v.date_start)} au ${dateLongue(v.date_end)}.`
      )
    )
  }
  return box
}

function info(nomIcone, intitule, valeur) {
  const ligne = el('div', 'fiche-info')
  const pastille = el('span', 'fiche-info__icone')
  pastille.appendChild(icon(nomIcone))
  ligne.append(pastille, el('span', 'fiche-info__intitule', intitule), el('span', 'fiche-info__valeur', valeur))
  return ligne
}

function ajouterCarte(parent, titre, contenu) {
  if (!contenu) return
  const c = el('section', 'fiche-carte')
  c.appendChild(el('h3', 'fiche-carte__titre', titre))
  c.appendChild(contenu)
  parent.appendChild(c)
}
