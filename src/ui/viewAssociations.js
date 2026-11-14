// Armana — l'annuaire des ASSOCIATIONS (14/11/2026).
//
// Une utilisatrice voulait voir Armana accueillir les associations — une asso
// de yoga, un club de foot. Ce ne sont pas des événements mais des présences
// durables : elles ont donc une FICHE (comme les lieux et les food trucks,
// migration 0041), et cet annuaire les rassemble.
//
// ⚠ JAMAIS DE LISTE INFINIE (Matthieu, 14/11/2026, comme pour les food
// trucks). L'annuaire se parcourt du large au précis :
//   · toute la France  → les RÉGIONS, avec leur nombre d'associations ;
//   · une région, ou Mon territoire → les associations elles-mêmes, avec les
//     DÉPARTEMENTS en pastilles pour filtrer (une liste de départements à
//     traverser d'abord était, elle aussi, trop longue) ; 30 au plus à l'écran.
// La CARTE de France, comme dans Mon territoire, montre où l'on regarde et
// permet de toucher un département directement. Une recherche par nom et les
// domaines (Sport, Bien-être…) affinent à tout moment.
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
import { DOMAINES, associationsParIds, indexAssociations } from '../lib/fiches.js'
import { getMesDepartements } from '../lib/mesDepartements.js'
import { CODES_DEPARTEMENTS, deptsDeRegion, nomDepartement, nomRegion, regionDuDept, resumeTerritoire } from '../lib/departements.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import './associations.css'

/** En deçà, on montre directement les associations plutôt qu'un sommaire. */
const SEUIL_LISTE = 8
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
  const nomZone = () => {
    if (dept) return `${dept} ${nomDepartement(dept)}`
    if (zone.type === 'france') return 'toute la France'
    if (zone.type === 'region') return nomRegion(zone.code)
    return resumeTerritoire(getMesDepartements()) || 'mon territoire'
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

    // Le résumé, et le chemin pour remonter d'une région à toute la France.
    resume.innerHTML = ''
    if (zone.type === 'region') {
      const remonter = el('button', 'asso-remonter')
      remonter.type = 'button'
      remonter.append(icon('chevronLeft'), el('span', null, 'Toute la France'))
      remonter.addEventListener('click', () => aller({ type: 'france' }))
      resume.appendChild(remonter)
    }
    resume.appendChild(el('p', 'asso-resume__texte', `${pluriel(trouvees.length)} · ${nomZone()}`))

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
    if (!trouvees.length) {
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

    // Toute la France : le sommaire des RÉGIONS (treize au plus), tant que la
    // liste serait longue — sauf si l'on cherche un nom.
    if (!q && !dept && zone.type === 'france' && trouvees.length > SEUIL_LISTE) {
      const parRegion = new Map()
      for (const a of trouvees) {
        const r = regionDuDept(a.dept)
        parRegion.set(r, (parRegion.get(r) ?? 0) + 1)
      }
      const rangs = el('div', 'asso-rangs')
      for (const [code, n] of [...parRegion].sort((x, y) => nomRegion(x[0]).localeCompare(nomRegion(y[0]), 'fr'))) {
        const r = el('button', 'asso-rang')
        r.type = 'button'
        const texte = el('span', 'asso-rang__texte')
        texte.append(el('strong', null, nomRegion(code)), el('span', null, pluriel(n)))
        r.append(texte, icon('chevronRight'))
        r.addEventListener('click', () => aller({ type: 'region', code }))
        rangs.appendChild(r)
      }
      liste.appendChild(rangs)
      return
    }

    // Les associations elles-mêmes : le détail ne se charge que pour elles.
    const montrees = trouvees.slice(0, MAX_LISTE)
    const details = await associationsParIds(montrees.map((a) => a.id)).catch(() => [])
    if (moi !== tour) return // une autre demande est passée entre-temps
    for (const a of details) liste.appendChild(carteAsso(a))
    if (trouvees.length > MAX_LISTE) {
      liste.appendChild(
        el('p', 'asso-plus', `Et ${trouvees.length - MAX_LISTE} autres : choisissez un département, ou cherchez un nom.`)
      )
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
  texte.appendChild(el('strong', 'asso-carte__nom', a.name))
  const ville = a.address ? villeDeLAdresse(a.address) : null
  if (ville) texte.appendChild(el('span', 'asso-carte__ville', ville))
  b.append(vignette, texte, icon('chevronRight'))
  b.addEventListener('click', () => navigate('/fiche?id=' + a.id))
  return b
}
