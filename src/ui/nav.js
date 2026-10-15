// Armana — barre de navigation basse (4 onglets, icônes Lucide).
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate, currentRoute } from '../lib/router.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import { myPendingCount } from '../lib/moderation.js'

/**
 * Balayage au pouce d'un onglet à l'autre.
 *
 * Posé UNE SEULE FOIS sur le document (la nav est reconstruite à chaque
 * changement de route : y attacher l'écouteur en empilerait un par navigation).
 *
 * Trois garde-fous, sans lesquels le geste se retournerait contre l'utilisateur :
 *  - on ignore tout geste parti d'une CARTE Leaflet, d'un curseur ou d'une zone
 *    qui défile horizontalement — sinon déplacer la carte changerait d'onglet ;
 *  - le mouvement doit être franchement horizontal (deux fois plus que
 *    vertical), pour ne pas déclencher pendant un défilement de liste ;
 *  - on n'agit que sur les quatre onglets racines, jamais dans un sous-écran :
 *    balayer en pleine saisie d'un formulaire ferait perdre le travail.
 */
let balayageInstalle = false
function activerBalayage() {
  if (balayageInstalle) return
  balayageInstalle = true

  let x0 = 0
  let y0 = 0
  let valide = false

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return (valide = false)
      const cible = e.target
      valide = !cible.closest?.(
        '.leaflet-container, input, textarea, select, .chips-row, .map-pills, .map-menu, [data-no-swipe]'
      )
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
    },
    { passive: true }
  )

  document.addEventListener(
    'touchend',
    (e) => {
      if (!valide) return
      const t = e.changedTouches[0]
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return

      const ici = TABS.findIndex((tab) => tab.path === currentRoute())
      if (ici === -1) return // sous-écran : on ne fait rien
      const suivant = ici + (dx < 0 ? 1 : -1)
      if (suivant < 0 || suivant >= TABS.length) return
      navigate(TABS[suivant].path)
    },
    { passive: true }
  )
}

const TABS = [
  { path: '/', label: 'Agenda', ic: 'calendar' },
  { path: '/carte', label: 'Carte', ic: 'map' },
  { path: '/favoris', label: 'Favoris', ic: 'heart' },
  { path: '/parametres', label: 'Profil', ic: 'user' },
]

// Les sous-écrans allument l'onglet parent.
const PARENT = {
  '/evenement': '/',
  '/publier': '/',
  '/mes-evenements': '/parametres',
  '/moderation': '/parametres',
  '/connexion': '/parametres',
  '/admins': '/parametres',
  '/nouveau-mdp': '/parametres',
  '/contact': '/parametres',
  '/membres': '/parametres',
  '/statistiques': '/parametres',
  '/messages': '/parametres',
  '/soutenir': '/parametres',
  '/importer': '/',
  '/installer': '/parametres',
  '/journal': '/parametres',
  '/membre': '/parametres',
  '/notifications': '/parametres',
  '/mes-departements': '/parametres',
  '/devenir-moderateur': '/parametres',
  '/candidatures': '/parametres',
  '/mon-profil': '/parametres',
  '/ma-fiche': '/parametres',
  '/mon-planning': '/parametres',
  '/fiche': '/',
}

/** Le « + » central : publier un événement (ou se connecter d'abord). */
function boutonPublier(path) {
  const b = el('button', 'navtab-publier')
  b.type = 'button'
  b.title = 'Publier un événement'
  b.setAttribute('aria-label', 'Publier un événement')
  const carre = el('span', 'navtab-publier__carre')
  carre.appendChild(icon('plus'))
  b.appendChild(carre)
  if (path === '/publier') b.classList.add('is-active')
  b.addEventListener('click', () => navigate(isLoggedIn() ? '/publier' : '/connexion'))
  return b
}

export function buildNav() {
  const nav = el('nav', 'bottom-nav bottom-nav--studio')
  const inner = el('div', 'bottom-nav__inner')
  const { path } = currentRoute()
  const active = PARENT[path] ?? path

  const buttons = {}
  TABS.forEach((t, i) => {
    // « Publier » au centre, entre Carte et Favoris (version C, 15/10/2026) :
    // l'ancien bouton flottant n'existait que sur l'Agenda et masquait la
    // dernière carte de la liste. Ici il est sur tous les écrans, et ne
    // recouvre rien.
    if (i === 2) inner.appendChild(boutonPublier(path))
    const b = el('button', 'navtab')
    b.type = 'button'
    // Le pictogramme est enveloppé : c'est l'enveloppe qui porte le carré
    // bleu de l'onglet actif, sans rogner l'icône (voir style.css).
    const pastille = el('span', 'navtab__icone')
    pastille.appendChild(icon(t.ic))
    b.appendChild(pastille)
    b.appendChild(el('span', 'navtab__label', t.label))
    if (active === t.path) {
      b.classList.add('is-active')
      b.setAttribute('aria-current', 'page')
    }
    b.addEventListener('click', () => navigate(t.path))
    inner.appendChild(b)
    buttons[t.path] = b
  })

  // Pastille du modérateur sur « Profil » : les événements en attente DANS SA
  // ZONE — l'ancien compteur global aurait menti à un modérateur cloisonné à
  // son département. Chargée en arrière-plan.
  if (isAdmin()) {
    myPendingCount()
      .then((pending) => {
        if (!pending) return
        const badge = el('span', 'navtab__badge', pending > 99 ? '99+' : String(pending))
        badge.title = `${pending} événement(s) à modérer`
        buttons['/parametres'].appendChild(badge)
      })
      .catch(() => {})
  }

  nav.appendChild(inner)
  activerBalayage()
  return nav
}
