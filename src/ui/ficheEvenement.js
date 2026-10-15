// Armana — fiche événement, sur fond bleu comme l'Agenda.
//
// Refonte du 28/09/2026, d'après trois propositions comparées en préversion.
// Ce que Matthieu a retenu, et pourquoi c'est ainsi :
//  - la PHOTO ENTIÈRE, sans bandes noires : un fond flouté d'elle-même comble
//    les côtés d'une affiche en hauteur ;
//  - collé sous la photo, UN SEUL ENCART : catégorie, titre, puis QUAND · OÙ ·
//    TARIF en trois cases — c'est ce qu'on cherche en premier. ⚠ PAS de reprise
//    du bloc-date jaune de l'Agenda (« on revoit l'affichage de l'agenda »), et
//    PAS d'allure de billet : les encoches de découpe ont été essayées, puis
//    retirées à sa demande ;
//  - le site en grand bouton jaune, puis Favori · Partager · Y aller en
//    pastilles rondes. Le contact devient des BOUTONS (site, appel, e-mail),
//    y compris pour une adresse saisie sans « http » ;
//  - TOUT EST CENTRÉ, titres comme paragraphes : c'est sa demande ;
//  - la description en paragraphes aérés, repliée au-delà d'une certaine
//    longueur.
import { el, formatDateFull, formatTime, formatPrice } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { addGem, removeGem } from '../lib/events.js'
import { shareEvent } from '../lib/share.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import { lireContact } from '../lib/contact.js'
import { dayKey, describeRecurrence, isRecurring, nextOccurrence } from '../lib/recurrence.js'
import './ficheEvenement.css'
import './planning.css' // badge « Food sur place »
import { formatPrix, lireMenu } from '../lib/menu.js'

const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const JOUR_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

const majuscule = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
// « 12 € » ne doit jamais se couper entre le nombre et l'euro, et le « · »
// reste accroché au mot qui le précède : une ligne ne commence pas par lui.
const prix = (ev) =>
  formatPrice(ev)
    .replace(/(\d) (?=\d|€)/g, '$1 ')
    .replace(/ €/g, ' €')
    .replace(/ ·/g, ' ·')

/** Longueur au-delà de laquelle la description est repliée. */
const DESCRIPTION_REPLIEE = 650

const ICONE_CONTACT = { web: 'globe', tel: 'phone', mail: 'mail' }

// ---------------------------------------------------------------------------
// Quand
// ---------------------------------------------------------------------------

/**
 * Tout ce qu'il faut savoir sur QUAND, sous plusieurs formes.
 *  - `ref`   : le jour mis en avant (la prochaine séance pour une série) ;
 *  - `court` : « ven. 11 sept. », pour la case de l'encart ;
 *  - `long`  : la phrase complète, pour les infos pratiques.
 */
function quand(ev) {
  const debut = new Date(ev.starts_at)
  const fin = ev.ends_at ? new Date(ev.ends_at) : null
  const heure = formatTime(ev.starts_at)
  // ⚠ Une fiche reste ouvrable après la fin — lien partagé, favori, mois en
  // cours non encore purgé. Sans ce drapeau, une série finie annonçait sa
  // « prochaine » séance… au jour de son lancement, deux mois plus tôt.
  const minuit = new Date()
  minuit.setHours(0, 0, 0, 0)
  const fini = (fin || debut) < minuit

  if (isRecurring(ev)) {
    const ref = fini ? fin || debut : nextOccurrence(ev)
    return {
      type: 'serie',
      fini,
      ref,
      heure,
      court: JOUR_COURT.format(ref),
      long: `${majuscule(describeRecurrence(ev))} · ${heure}`,
      prochaine: fini ? null : `Prochaine fois : ${JOUR_LONG.format(ref)}`,
    }
  }
  if (fin && dayKey(fin) !== dayKey(debut)) {
    return {
      type: 'plage',
      fini,
      ref: debut,
      fin,
      heure,
      court: JOUR_COURT.format(debut),
      long: `Du ${formatDateFull(ev.starts_at)} au ${formatDateFull(ev.ends_at)} · ${heure}`,
    }
  }
  const heureFin = fin ? formatTime(ev.ends_at) : null
  return {
    type: 'jour',
    fini,
    ref: debut,
    heure,
    heureFin,
    court: JOUR_COURT.format(debut),
    long: `${majuscule(formatDateFull(ev.starts_at))} · ${heure}${heureFin ? ' → ' + heureFin : ''}`,
  }
}

/** Lien d'itinéraire : les COORDONNÉES d'abord, l'adresse écrite à défaut. */
function lienItineraire(ev) {
  if (!ev.address && !Number.isFinite(Number(ev.lat))) return null
  // ⚠ Rechercher le texte exposerait aux homonymes (« Chahut-Chahut » s'était
  // retrouvé dans l'Orne) : le point choisi à la publication fait foi.
  const q =
    Number.isFinite(Number(ev.lat)) && Number.isFinite(Number(ev.lng))
      ? `${ev.lat},${ev.lng}`
      : ev.address
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q)
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

const ajouter = (parent, ...enfants) => {
  for (const e of enfants) if (e) parent.appendChild(e)
  return parent
}

// ---------------------------------------------------------------------------
// Les blocs
// ---------------------------------------------------------------------------

/** La photo entière, sur un fond flouté d'elle-même. Tap → plein écran. */
function photo(ev) {
  if (!ev.photo_url) return null
  const cadre = el('div', 'fiche-photo')
  const flou = el('img', 'fiche-photo__flou')
  flou.src = ev.photo_url
  flou.alt = ''
  flou.setAttribute('aria-hidden', 'true')
  const img = el('img', 'fiche-photo__img')
  img.src = ev.photo_url
  img.alt = ev.title
  cadre.append(flou, img)
  cadre.addEventListener('click', () => ouvrirPhoto(ev.photo_url, ev.title))
  return cadre
}

/** L'encart sous la photo : catégorie, titre, puis Quand · Où · Tarif. */
function entete(ev, q, avecPhoto) {
  const carte = el('section', 'fiche-entete' + (avecPhoto ? '' : ' fiche-entete--seule'))
  const haut = el('div', 'fiche-entete__haut')
  if (ev.category) haut.appendChild(el('span', 'fiche-categorie', ev.category))
  haut.appendChild(el('h2', 'fiche-titre', ev.title))
  carte.appendChild(haut)
  carte.appendChild(el('div', 'fiche-entete__filet'))

  const cases = el('div', 'fiche-cases')
  const kase = (intitule, valeur, sous) => {
    const c = el('div', 'fiche-case')
    c.appendChild(el('span', 'fiche-case__intitule', intitule))
    c.appendChild(el('span', 'fiche-case__valeur', valeur))
    if (sous) c.appendChild(el('span', 'fiche-case__sous', sous))
    return c
  }
  // Une case étroite ne dit que l'essentiel : la phrase complète (rythme d'une
  // série, dates de début et de fin) est dans les infos pratiques.
  if (q.type === 'serie' && !q.fini) {
    cases.appendChild(kase('Prochaine fois', majuscule(q.court), q.heure))
  } else if (q.type === 'plage') {
    cases.appendChild(kase('Quand', majuscule(q.court), '→ ' + JOUR_COURT.format(q.fin)))
  } else {
    cases.appendChild(kase('Quand', majuscule(q.court), q.heure + (q.heureFin ? ' → ' + q.heureFin : '')))
  }
  const ville = ev.ville || (ev.address ? villeDeLAdresse(ev.address) : '')
  if (ville) cases.appendChild(kase('Où', ville, ev.place_name || null))
  cases.appendChild(kase('Tarif', prix(ev)))
  carte.appendChild(cases)
  return carte
}

/**
 * La description en paragraphes — un paragraphe par ligne sautée —, repliée
 * au-delà d'une certaine longueur. Tous les paragraphes ont la même taille :
 * un premier paragraphe plus gros comptait moins de lettres par ligne, et
 * c'est justement l'irrégularité que Matthieu ne voulait plus.
 *
 * Exportée : le formulaire de publication l'affiche en aperçu, pour que
 * l'auteur voie son texte exactement tel qu'il sera lu.
 * @returns {HTMLElement|null} null si le texte est vide
 */
export function blocDescription(texte) {
  texte = String(texte || '').trim()
  if (!texte) return null
  const bloc = el('div', 'fiche-texte')
  const corps = el('div', 'fiche-texte__corps')
  texte
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((p) => corps.appendChild(el('p', 'fiche-texte__p', p)))
  bloc.appendChild(corps)
  if (texte.length > DESCRIPTION_REPLIEE) {
    corps.classList.add('is-replie')
    const suite = el('button', 'fiche-texte__suite', 'Lire la suite')
    suite.type = 'button'
    suite.addEventListener('click', () => {
      const replie = corps.classList.toggle('is-replie')
      suite.textContent = replie ? 'Lire la suite' : 'Replier'
    })
    bloc.appendChild(suite)
  }
  return bloc
}

/** Une ligne d'information : pastille d'icône, intitulé, valeur, le tout centré. */
function info(nomIcone, intitule, valeur, extra = null) {
  const ligne = el('div', 'fiche-info')
  const pastille = el('span', 'fiche-info__icone')
  pastille.appendChild(icon(nomIcone))
  ligne.appendChild(pastille)
  ligne.appendChild(el('span', 'fiche-info__intitule', intitule))
  if (valeur) ligne.appendChild(el('span', 'fiche-info__valeur', valeur))
  if (extra) ligne.appendChild(extra)
  return ligne
}

/** Les infos pratiques, complètes : quand, où, tarif, et qui contacter. */
function infosPratiques(ev, q, reste) {
  const carte = el('section', 'fiche-carte')
  carte.appendChild(el('h3', 'fiche-carte__titre', 'Infos pratiques'))
  const liste = el('div', 'fiche-infos')
  const prochaine = q.prochaine ? el('span', 'fiche-info__sous', q.prochaine) : null
  liste.appendChild(info('calendar', 'Quand', q.long, prochaine))
  // L'adresse complète, sans bouton d'itinéraire : « Y aller », plus haut,
  // fait déjà ce travail (retiré à la demande de Matthieu).
  // Lieu et commune, séparés depuis la migration 0035 : « Théâtre La Rirette,
  // Mane ». Les anciens événements gardent leur adresse telle quelle.
  const ou = ev.city ? [ev.place_name, ev.city].filter(Boolean).join(', ') : ev.address
  if (ou) liste.appendChild(info('pin', 'Où', ou))
  liste.appendChild(info('euro', 'Tarif', prix(ev)))
  // Ce qui reste du champ contact une fois les liens et numéros devenus des
  // boutons : le plus souvent, le nom de l'organisateur.
  if (reste) liste.appendChild(info('message', 'Contact', reste))
  carte.appendChild(liste)
  return carte
}

function carte(titre, contenu) {
  if (!contenu) return null
  const c = el('section', 'fiche-carte')
  c.appendChild(el('h3', 'fiche-carte__titre', titre))
  c.appendChild(contenu)
  return c
}

// ---------------------------------------------------------------------------
// Les boutons
// ---------------------------------------------------------------------------

/** Petit message éphémère (« Lien copié »), là où aucune feuille de partage n'existe. */
function toast(texte) {
  const t = el('div', 'fiche-toast', texte)
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2600)
}

async function partager(ev, q) {
  const ville = ev.ville || (ev.address ? villeDeLAdresse(ev.address) : '')
  const quandTexte =
    q.type === 'serie'
      ? `prochaine séance ${JOUR_LONG.format(q.ref)} à ${q.heure}`
      : q.type === 'plage'
        ? `du ${JOUR_LONG.format(q.ref)} au ${JOUR_LONG.format(q.fin)}`
        : `${JOUR_LONG.format(q.ref)} à ${q.heure}`
  // ⚠ Le texte dit tout l'essentiel : l'aperçu du lien ne montrera que la page
  // d'accueil d'Armana (voir shareEvent, dans lib/share.js).
  const texte = [ev.title, quandTexte + (ville ? `, ${ville}` : ''), 'Sur Armana :'].join('\n')
  const r = await shareEvent({ id: ev.id, title: ev.title, texte })
  if (r === 'copied') toast('Lien copié : à coller dans un message')
  else if (r === 'failed') toast('Copie impossible')
}

/**
 * Un bouton d'action. `forme` : 'rond' (pastille + légende) ou 'cta' (le grand
 * bouton jaune). Renvoie un <a> si `href` est donné, sinon un <button>.
 */
function action({ forme, nomIcone, texte, detail, href, onClick, classe = '' }) {
  const n = href ? lien(href, `fiche-${forme} ${classe}`) : el('button', `fiche-${forme} ${classe}`)
  if (!href) n.type = 'button'
  if (forme === 'rond') {
    const pastille = el('span', 'fiche-rond__pastille')
    pastille.appendChild(icon(nomIcone))
    n.append(pastille, el('span', 'fiche-rond__texte', texte))
  } else {
    n.appendChild(icon(nomIcone))
    const t = el('span', 'fiche-cta__texte')
    t.appendChild(el('span', null, texte))
    if (detail) t.appendChild(el('small', null, detail))
    n.appendChild(t)
  }
  if (onClick) n.addEventListener('click', onClick)
  return n
}

/** Le cœur. Sans compte, il mène à la connexion. */
function actionFavori(ev, gemmed) {
  let on = Boolean(gemmed)
  // La légende ne change pas : c'est le cœur, plein ou vide, qui dit l'état.
  const b = action({ forme: 'rond', nomIcone: 'heart', texte: 'Favori', classe: 'fiche-favori' })
  const peindre = () => {
    b.classList.toggle('is-on', on)
    b.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none')
    b.setAttribute('aria-label', on ? 'Retirer des favoris' : 'Ajouter aux favoris')
  }
  peindre()
  b.addEventListener('click', async () => {
    if (!isLoggedIn()) {
      navigate('/connexion')
      return
    }
    b.disabled = true
    try {
      if (on) await removeGem(ev.id)
      else await addGem(ev.id)
      on = !on
      peindre()
    } catch (e) {
      alert('Action impossible : ' + e.message)
    } finally {
      b.disabled = false
    }
  })
  return b
}

function actionPartager(ev, q) {
  // ⚠ SEULEMENT POUR UN ÉVÉNEMENT PUBLIÉ : partagé en attente, son lien mènerait
  // vers « Cet événement n'existe plus ».
  if (ev.status !== 'approved') return null
  return action({ forme: 'rond', nomIcone: 'share', texte: 'Partager', onClick: () => partager(ev, q) })
}

function actionItineraire(ev) {
  const href = lienItineraire(ev)
  return href ? action({ forme: 'rond', nomIcone: 'navigation', texte: 'Y aller', href }) : null
}

function actionContact(a, forme) {
  const textes = { web: a.label === 'Site web' ? 'Voir le site' : a.label, tel: 'Appeler', mail: 'Écrire' }
  return action({
    forme,
    nomIcone: ICONE_CONTACT[a.type],
    texte: forme === 'rond' && a.type === 'web' ? 'Site' : textes[a.type],
    detail: a.detail,
    href: a.href,
  })
}

// ---------------------------------------------------------------------------
// La fiche
// ---------------------------------------------------------------------------

/**
 * Le corps de la fiche d'un événement — tout sauf la barre de titre et les
 * actions de gestion, qui restent dans viewDetail.
 * @param {object} ev
 * @param {{ gemmed?: boolean }} ctx
 */
export function ficheEvenement(ev, { gemmed = false } = {}) {
  const q = quand(ev)
  const contact = lireContact(ev.contact)
  const f = document.createDocumentFragment()
  if (q.fini) f.appendChild(el('p', 'fiche-termine', 'Cet événement est terminé'))

  const ph = photo(ev)
  ajouter(f, ph, entete(ev, q, Boolean(ph)))

  // Le premier moyen de contact en grand — c'est là qu'on réserve, qu'on
  // vérifie ; les autres rejoignent la rangée de pastilles.
  const [principal, ...autres] = contact.actions
  ajouter(
    f,
    principal ? actionContact(principal, 'cta') : null,
    ajouter(
      el('div', 'fiche-ronds'),
      actionFavori(ev, gemmed),
      actionPartager(ev, q),
      actionItineraire(ev),
      ...autres.map((a) => actionContact(a, 'rond'))
    ),
    carte('À propos', blocDescription(ev.description)),
    carte('Food sur place', blocFood(ev)),
    infosPratiques(ev, q, contact.reste),
    auteur(ev)
  )
  return f
}

/**
 * « Publié par … ». Si l'auteur est un lieu ou un food truck dont la fiche est
 * publiée, son nom devient un lien vers elle (migration 0033) : c'est ce qui
 * donne une raison d'avoir une fiche complète.
 */
/**
 * « Food sur place » : les food trucks annoncés (vers leur fiche), puis la
 * restauration de l'organisateur — menu plat par plat et/ou sa photo
 * (migrations 0034 et 0035).
 */
function blocFood(ev) {
  const plats = ev.restauration ? lireMenu(ev.restauration_menu) : []
  const photoMenu = ev.restauration ? ev.menu_photo_url : null
  if (!ev.food_trucks?.length && !ev.restauration) return null
  const bloc = el('div', 'fiche-menu-bloc')
  if (ev.food_trucks?.length) {
    const box = el('div', 'fiche-food')
    for (const t of ev.food_trucks) {
      const a = el('a', 'badge-food')
      a.href = '#/fiche?id=' + encodeURIComponent(t.id)
      a.append(icon('truck'), el('span', null, t.name))
      box.appendChild(a)
    }
    bloc.appendChild(box)
  }
  if (plats.length) {
    const ul = el('ul', 'fiche-menu')
    for (const p of plats) {
      const li = el('li', 'fiche-menu__ligne')
      li.appendChild(el('span', 'fiche-menu__plat', p.plat))
      if (p.prix != null) li.appendChild(el('span', 'fiche-menu__prix', formatPrix(p.prix)))
      ul.appendChild(li)
    }
    bloc.appendChild(ul)
  }
  if (photoMenu) {
    const cadre = el('div', 'fiche-produit')
    const img = el('img')
    img.src = photoMenu
    img.alt = 'Le menu'
    img.loading = 'lazy'
    cadre.appendChild(img)
    bloc.appendChild(cadre)
  }
  // Ni camion, ni menu, ni photo : l'organisateur a seulement dit qu'on
  // mange sur place — on le dit aussi.
  if (!bloc.children.length) bloc.appendChild(el('p', 'fiche-texte__p fiche-texte__p--centre', 'On peut manger sur place.'))
  return bloc
}

function auteur(ev) {
  const p = el('p', 'fiche-auteur', 'Publié par ')
  const f = ev.author_fiche
  if (!f) {
    p.appendChild(document.createTextNode(ev.author_name || 'Anonyme'))
    return p
  }
  const a = el('a', 'fiche-auteur__lien', f.name)
  a.href = '#/fiche?id=' + encodeURIComponent(f.id)
  p.appendChild(a)
  return p
}

// Aperçu plein écran de la photo (tap ou Échap pour fermer).
function ouvrirPhoto(src, alt) {
  const fond = el('div', 'lightbox')
  const img = el('img')
  img.src = src
  img.alt = alt || ''
  fond.appendChild(img)
  const fermer = () => {
    fond.remove()
    document.removeEventListener('keydown', surTouche)
  }
  const surTouche = (e) => {
    if (e.key === 'Escape') fermer()
  }
  fond.addEventListener('click', fermer)
  document.addEventListener('keydown', surTouche)
  document.body.appendChild(fond)
}
