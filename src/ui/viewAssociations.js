// Armana — l'annuaire des ASSOCIATIONS (14/11/2026).
//
// Une utilisatrice voulait voir Armana accueillir les associations — une asso
// de yoga, un club de foot. Ce ne sont pas des événements mais des présences
// durables : elles ont donc une FICHE (comme les lieux et les food trucks,
// migration 0041), et cet annuaire les rassemble.
//
// ⚠ JAMAIS DE LISTE INFINIE (Matthieu, 14/11/2026, comme pour les food
// trucks) : 30 associations au plus à l'écran, puis on invite à préciser. Les
// DÉPARTEMENTS de la zone, en pastilles, filtrent (une liste de départements à
// traverser d'abord était trop longue).
// ⚠ PAS DE NOMS DE RÉGIONS À L'ÉCRAN (Matthieu, 19/11/2026) : la CARTE de
// France montre déjà où l'on regarde, et l'on y touche un département. Le
// sommaire des régions (« Toute la France ») et le résumé qui énumérait tout
// le territoire (« 2 associations · Auvergne-Rhône-Alpes, Bourgogne… ») ont
// été retirés : on voit directement les associations.
//
// ⚠ TOUTES LES ASSOCIATIONS, MÊME SANS FICHE NI ÉVÉNEMENT (19/11/2026) : un
// compte « association » paraît sous son nom dès son inscription. Celles dont
// on ne connaît pas encore le lieu sont rangées à part, en bas.
// Les noms s'affichent sans « Association » devant (`nomAssociation`).
//
// Seul un INDEX léger (nom, département, domaine) est chargé d'un coup : le
// détail — photo, commune — ne l'est que pour la poignée d'associations
// affichées (lib/fiches.js).
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { carteDepartements } from './carteDepts.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { DOMAINES, detailsAssociations, indexAssociations, nomAssociation } from '../lib/fiches.js'
import { getMesDepartements } from '../lib/mesDepartements.js'
import { CODES_DEPARTEMENTS, deptsDeRegion, nomDepartement, nomRegion, regionDuDept } from '../lib/departements.js'
import './associations.css'

/** Au-delà, la liste est coupée : on invite à préciser. */
const MAX_LISTE = 30

/** Minuscules, sans accents : chercher « theatre » trouve « Théâtre ». */
const plat = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

const pluriel = (n) => `${n} association${n > 1 ? 's' : ''}`

export async function viewAssociations({ query } = {}) {
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--associations')
  wrap.appendChild(studioHeader('Associations', { backLabel: 'Retour', onBack: () => history.back() }))
  wrap.appendChild(
    el('p', 'page__subtitle', 'Clubs, ateliers, comités des fêtes : ce que les associations proposent toute l’année.')
  )

  // --- L'état ------------------------------------------------------------------
  // `zone` : où l'on regarde — Mon territoire (par défaut, comme l'Agenda),
  // toute la France, ou une région. `dept` : un département de la zone, ou
  // null (toute la zone).
  let zone = { type: 'territoire' }
  let dept = null
  let domaine = DOMAINES.some((d) => d.cle === query?.get('domaine')) ? query.get('domaine') : null
  let recherche = ''

  const deptsDeZone = () => {
    if (zone.type === 'france') return CODES_DEPARTEMENTS
    if (zone.type === 'region') return deptsDeRegion(zone.code)
    return getMesDepartements()
  }
  // Un SEUL nom, et seulement quand on a touché un département ou une région :
  // « Mon territoire » et « Toute la France » se lisent déjà sur les boutons
  // et sur la carte.
  const nomZone = () => {
    if (dept) return nomDepartement(dept)
    if (zone.type === 'region') return nomRegion(zone.code)
    return ''
  }
  const aller = (z, d = null) => {
    zone = z
    dept = d
    peindre()
  }

  // --- La recherche par nom ------------------------------------------------------
  const champ = el('label', 'asso-recherche')
  champ.appendChild(icon('search'))
  const input = el('input')
  input.type = 'search'
  input.placeholder = 'Chercher une association…'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Chercher une association par son nom')
  champ.appendChild(input)
  wrap.appendChild(champ)
  let attente = null
  input.addEventListener('input', () => {
    clearTimeout(attente)
    attente = setTimeout(() => {
      recherche = input.value
      peindre()
    }, 200)
  })

  // --- Où : Mon territoire, Toute la France, et la carte --------------------------
  const ou = el('div', 'asso-ou')
  const zones = el('div', 'asso-zones')
  const btnTerritoire = el('button', 'asso-zone', 'Mon territoire')
  btnTerritoire.type = 'button'
  btnTerritoire.addEventListener('click', () => aller({ type: 'territoire' }))
  const btnFrance = el('button', 'asso-zone', 'Toute la France')
  btnFrance.type = 'button'
  btnFrance.addEventListener('click', () => aller({ type: 'france' }))
  zones.append(btnTerritoire, btnFrance)
  ou.appendChild(zones)
  // Toucher un département le retient (dans sa région, si l'on regardait
  // ailleurs) ; le toucher de nouveau le relâche.
  const carte = carteDepartements({
    selection: getMesDepartements(),
    onPick: (code) => {
      if (dept === code) return aller(zone)
      const dansLaZone = zone.type !== 'france' && deptsDeZone().includes(code)
      aller(dansLaZone ? zone : { type: 'region', code: regionDuDept(code) }, code)
    },
  })
  carte.classList.add('asso-france')
  ou.appendChild(carte)
  wrap.appendChild(ou)

  // --- Les domaines -------------------------------------------------------------------
  const domaines = el('div', 'asso-domaines')
  const boutonsDomaine = [{ cle: null, texte: 'Tous les domaines' }, ...DOMAINES.map((d) => ({ cle: d.cle, texte: d.cle }))].map(
    (d) => {
      const b = el('button', 'asso-domaine', d.texte)
      b.type = 'button'
      b.addEventListener('click', () => {
        domaine = d.cle
        peindre()
      })
      domaines.appendChild(b)
      return { b, cle: d.cle }
    }
  )
  wrap.appendChild(domaines)

  // --- Le résultat ------------------------------------------------------------------
  const resume = el('div', 'asso-resume')
  // Les départements de la zone, en pastilles : on filtre, on ne descend plus
  // dans une liste de départements (« ça fait une longue liste », Matthieu).
  const filtreDepts = el('div', 'asso-domaines asso-depts')
  const liste = el('div', 'asso-liste')
  wrap.append(resume, filtreDepts, liste)

  // L'appel aux associations absentes : toujours là, en bas.
  const appel = el('button', 'asso-appel')
  appel.type = 'button'
  const appelPicto = el('span', 'asso-appel__picto')
  appelPicto.appendChild(icon('users'))
  const appelTexte = el('span', 'asso-appel__texte')
  appelTexte.append(
    // Espace insécable avant le « ? », comme le veut la typographie française.
    el('strong', null, 'Votre association n’y est pas ?'),
    el('span', null, 'Créez sa fiche : c’est gratuit, et un modérateur la publie.')
  )
  appel.append(appelPicto, appelTexte, icon('chevronRight'))
  appel.addEventListener('click', () => navigate(isLoggedIn() ? '/mon-profil' : '/connexion'))
  wrap.appendChild(appel)

  const index = await indexAssociations().catch(() => [])

  let tour = 0
  async function peindre() {
    const moi = ++tour
    btnTerritoire.classList.toggle('is-active', zone.type === 'territoire')
    btnFrance.classList.toggle('is-active', zone.type === 'france')
    for (const { b, cle } of boutonsDomaine) b.classList.toggle('is-active', cle === domaine)

    const codes = deptsDeZone()
    const dansZone = new Set(codes)
    carte.setSelection(dept ? [dept] : zone.type === 'france' ? [] : codes)
    // Sur la carte, les départements qui ont au moins une association (pour
    // le domaine et la recherche en cours) se distinguent des autres.
    const q = plat(recherche)
    const pool = index.filter((a) => (!domaine || a.domaine === domaine) && (!q || plat(a.name).includes(q)))
    const peuples = new Set(pool.map((a) => a.dept))
    for (const p of carte.querySelectorAll('[data-code]')) p.classList.toggle('a-des-assos', peuples.has(p.dataset.code))

    const dansLaZone = pool.filter((a) => dansZone.has(a.dept))
    const trouvees = dept ? dansLaZone.filter((a) => a.dept === dept) : dansLaZone
    // Celles dont on ne connaît pas encore le lieu (ni fiche, ni événement) :
    // visibles tant qu'on n'a pas touché un département ou une région, et
    // rangées à part, en bas.
    const sansLieu = dept || zone.type === 'region' ? [] : pool.filter((a) => !a.dept)
    const total = trouvees.length + sansLieu.length

    // Le résumé, et le chemin pour remonter d'une région à toute la France.
    resume.innerHTML = ''
    if (zone.type === 'region') {
      const remonter = el('button', 'asso-remonter')
      remonter.type = 'button'
      remonter.append(icon('chevronLeft'), el('span', null, 'Toute la France'))
      remonter.addEventListener('click', () => aller({ type: 'france' }))
      resume.appendChild(remonter)
    }
    const ou = nomZone()
    resume.appendChild(el('p', 'asso-resume__texte', pluriel(total) + (ou ? ` · ${ou}` : '')))

    // Les pastilles des départements de la zone qui ont des associations —
    // pas pour toute la France, où l'on passe d'abord par la région.
    filtreDepts.innerHTML = ''
    const parDept = new Map()
    for (const a of dansLaZone) parDept.set(a.dept, (parDept.get(a.dept) ?? 0) + 1)
    filtreDepts.hidden = zone.type === 'france' || parDept.size < 2
    if (!filtreDepts.hidden) {
      const pastille = (texte, cle) => {
        const b = el('button', 'asso-domaine' + (dept === cle ? ' is-active' : ''), texte)
        b.type = 'button'
        b.addEventListener('click', () => aller(zone, cle))
        filtreDepts.appendChild(b)
      }
      pastille(`Tous · ${dansLaZone.length}`, null)
      for (const [code, n] of [...parDept].sort((x, y) => x[0].localeCompare(y[0]))) {
        pastille(`${nomDepartement(code)} · ${n}`, code)
      }
    }

    liste.innerHTML = ''
    if (!total) {
      liste.appendChild(
        emptyState(
          q
            ? 'Aucune association de ce nom ici. Essayez « Toute la France ».'
            : domaine
              ? `Aucune association « ${domaine} » inscrite ici pour l’instant.`
              : 'Aucune association inscrite ici pour l’instant.'
        )
      )
      return
    }

    // Les associations elles-mêmes : le détail ne se charge que pour elles.
    const montrees = trouvees.slice(0, MAX_LISTE)
    const aPart = sansLieu.slice(0, MAX_LISTE)
    const details = await detailsAssociations([...montrees, ...aPart]).catch(() => [])
    if (moi !== tour) return // une autre demande est passée entre-temps
    const parId = new Map(details.map((a) => [a.id, a]))
    const poser = (a) => {
      const d = parId.get(a.id)
      if (d) liste.appendChild(carteAsso(d))
    }
    montrees.forEach(poser)
    if (trouvees.length > MAX_LISTE) {
      liste.appendChild(
        el('p', 'asso-plus', `Et ${trouvees.length - MAX_LISTE} autres : touchez un département sur la carte, ou cherchez un nom.`)
      )
    }
    if (aPart.length) {
      liste.appendChild(el('p', 'asso-sous-titre', 'Lieu pas encore indiqué'))
      aPart.forEach(poser)
    }
  }

  peindre()
  return wrap
}

function carteAsso(a) {
  const b = el('button', 'asso-carte')
  b.type = 'button'
  const vignette = el('span', 'asso-carte__photo')
  if (a.photo_url) {
    const img = el('img')
    img.src = a.photo_url
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('error', () => img.remove())
    vignette.appendChild(img)
  } else {
    vignette.appendChild(icon('users'))
  }
  const texte = el('span', 'asso-carte__texte')
  texte.appendChild(el('span', 'asso-carte__domaine', a.domaine || 'Association'))
  // Le nom sans « Association » devant : la ligne rouge au-dessus le dit déjà.
  texte.appendChild(el('strong', 'asso-carte__nom', nomAssociation(a.name)))
  if (a.ville) texte.appendChild(el('span', 'asso-carte__ville', a.ville))
  b.append(vignette, texte, icon('chevronRight'))
  // Un compte sans fiche ouvre sa fiche réduite (son nom, ses rendez-vous).
  b.addEventListener('click', () => navigate(a.compte ? '/fiche?compte=' + a.compte : '/fiche?id=' + a.id))
  return b
}
