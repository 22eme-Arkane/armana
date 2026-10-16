// Armana — écran « Membres » (modérateurs et propriétaire).
//
// Refonte du 16/10/2026 (Matthieu) : savoir d'un coup d'œil QUI est inscrit —
// particulier, lieu culturel ou food truck —, filtrer par type, trier par date,
// par prénom ou par nom, et des chiffres en tête.
//
// La LISTE est ouverte aux modérateurs (migration 0022) : elle ne contient
// aucune adresse e-mail. La FICHE d'un membre, elle, en expose une et reste
// réservée au propriétaire — d'où `owner`, qui décide si les lignes s'ouvrent.
import './admin.css'
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, listMembers } from '../lib/admins.js'
import { avatarMembre, initiales as initialesCommunes, typeVisuel } from './typeCompte.js'

const DTF = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

const FILTRES = [
  { cle: 'tous', texte: 'Tous' },
  { cle: 'particulier', texte: 'Particuliers' },
  { cle: 'lieu', texte: 'Lieux' },
  { cle: 'food_truck', texte: 'Food trucks' },
  { cle: 'moderateurs', texte: 'Modérateurs' },
]

const TRIS = [
  { cle: 'recents', texte: 'Récents' },
  { cle: 'prenom', texte: 'Prénom' },
  { cle: 'nom', texte: 'Nom' },
]

const ETATS_FICHE = { pending: 'fiche à valider', approved: 'fiche publiée', rejected: 'fiche refusée' }

// Le filtre et le tri survivent au passage par une fiche : on revient sur la
// liste telle qu'on l'avait laissée (le temps de la visite seulement).
const memoire = { filtre: 'tous', tri: 'recents', recherche: '' }

export async function viewMembers() {
  const wrap = el('section', 'page page--studio-sub page--admin')
  wrap.appendChild(studioHeader('Membres', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Réservé aux modérateurs.'))
    return wrap
  }
  const owner = await amIOwner().catch(() => false)

  let tous = []
  try {
    tous = await listMembers()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  // --- Les chiffres ----------------------------------------------------------
  const debutMois = new Date()
  debutMois.setDate(1)
  debutMois.setHours(0, 0, 0, 0)
  const compte = (pred) => tous.filter(pred).length
  const tuiles = el('div', 'admin-tuiles')
  const tuile = (n, texte) => {
    const t = el('div', 'admin-tuile')
    t.append(el('strong', null, String(n)), el('span', null, texte))
    return t
  }
  tuiles.append(
    tuile(tous.length, 'inscrits'),
    tuile('+' + compte((m) => new Date(m.created_at) >= debutMois), 'ce mois'),
    tuile(compte((m) => m.account_type === 'lieu'), 'lieux'),
    tuile(compte((m) => m.account_type === 'food_truck'), 'food trucks')
  )
  wrap.appendChild(tuiles)

  // --- Recherche, filtres, tri ---------------------------------------------------
  const rechercheChamp = el('label', 'admin-recherche')
  rechercheChamp.appendChild(icon('search'))
  const recherche = el('input')
  recherche.type = 'search'
  recherche.placeholder = 'Chercher un nom…'
  recherche.autocomplete = 'off'
  recherche.value = memoire.recherche
  recherche.setAttribute('aria-label', 'Chercher un membre')
  rechercheChamp.appendChild(recherche)
  wrap.appendChild(rechercheChamp)

  const filtres = el('div', 'admin-chips')
  filtres.setAttribute('role', 'radiogroup')
  filtres.setAttribute('aria-label', 'Type de compte')
  const boutonsFiltre = FILTRES.map((f) => {
    const n =
      f.cle === 'tous'
        ? tous.length
        : f.cle === 'moderateurs'
          ? compte((m) => m.role === 'admin' || m.is_owner)
          : compte((m) => (m.account_type || 'particulier') === f.cle)
    const b = el('button', 'admin-chip')
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.append(el('span', null, f.texte), el('span', 'admin-chip__n', String(n)))
    b.addEventListener('click', () => {
      memoire.filtre = f.cle
      peindre()
    })
    filtres.appendChild(b)
    return { b, cle: f.cle }
  })
  wrap.appendChild(filtres)

  const tris = el('div', 'admin-segments')
  tris.setAttribute('role', 'radiogroup')
  tris.setAttribute('aria-label', 'Trier par')
  const boutonsTri = TRIS.map((t) => {
    const b = el('button', 'admin-segment', t.texte)
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.addEventListener('click', () => {
      memoire.tri = t.cle
      peindre()
    })
    tris.appendChild(b)
    return { b, cle: t.cle }
  })
  wrap.appendChild(tris)

  const resume = el('p', 'admin-resume')
  wrap.appendChild(resume)
  const liste = el('div', 'admin-liste')
  wrap.appendChild(liste)
  wrap.appendChild(
    el(
      'p',
      'form__hint admin-note',
      owner
        ? 'Touchez un membre pour ouvrir sa fiche : son adresse, son activité, sa fiche, ses publications.'
        : 'Les fiches individuelles, qui portent les adresses e-mail, sont réservées au propriétaire du projet.'
    )
  )

  recherche.addEventListener('input', () => {
    memoire.recherche = recherche.value
    peindre()
  })

  const myId = getUser()?.id

  function peindre() {
    for (const { b, cle } of boutonsFiltre) {
      b.classList.toggle('is-active', cle === memoire.filtre)
      b.setAttribute('aria-checked', String(cle === memoire.filtre))
    }
    for (const { b, cle } of boutonsTri) {
      b.classList.toggle('is-active', cle === memoire.tri)
      b.setAttribute('aria-checked', String(cle === memoire.tri))
    }

    const q = normaliser(memoire.recherche)
    let membres = tous.filter((m) => {
      if (memoire.filtre === 'moderateurs') return m.role === 'admin' || m.is_owner
      if (memoire.filtre !== 'tous') return (m.account_type || 'particulier') === memoire.filtre
      return true
    })
    if (q) {
      membres = membres.filter(
        (m) => normaliser(m.display_name).includes(q) || normaliser(m.fiche_name).includes(q)
      )
    }

    // Le total reste celui des INSCRITS ; un filtre ou une recherche annonce en
    // plus ce qu'il donne, sinon on croirait avoir perdu des membres.
    resume.textContent =
      membres.length === tous.length
        ? `${tous.length} membre${tous.length > 1 ? 's' : ''}`
        : `${membres.length} sur ${tous.length} membres`

    liste.innerHTML = ''
    if (!membres.length) {
      liste.appendChild(emptyState(q ? 'Aucun membre ne porte ce nom.' : 'Aucun membre de ce type.'))
      return
    }

    // Tri, et les REPÈRES qui vont avec : la lettre pour les tris alphabétiques,
    // le mois d'inscription pour « Récents ».
    const cleTri = (m) => {
      const mots = String(m.display_name || '').trim().split(/\s+/).filter(Boolean)
      if (memoire.tri === 'prenom') return normaliser(mots[0] || '')
      return normaliser(mots[mots.length - 1] || '')
    }
    if (memoire.tri === 'recents') {
      membres.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    } else {
      membres.sort(
        (a, b) =>
          cleTri(a).localeCompare(cleTri(b), 'fr') ||
          normaliser(a.display_name).localeCompare(normaliser(b.display_name), 'fr')
      )
    }
    const repere = (m) => {
      if (memoire.tri === 'recents') {
        const t = MOIS.format(new Date(m.created_at))
        return t.charAt(0).toUpperCase() + t.slice(1)
      }
      const c = cleTri(m).charAt(0).toUpperCase()
      return /[A-Z]/.test(c) ? c : '#'
    }

    let dernier = null
    let groupe = null
    for (const m of membres) {
      const r = repere(m)
      if (r !== dernier) {
        dernier = r
        liste.appendChild(el('h3', 'admin-repere', r))
        groupe = el('div', 'admin-groupe')
        liste.appendChild(groupe)
      }
      groupe.appendChild(ligneMembre(m))
    }
  }

  function ligneMembre(m) {
    const nom = m.display_name || 'Sans nom'
    const type = m.account_type || 'particulier'
    // Un modérateur consulte la liste ; seul le propriétaire ouvre la fiche.
    // Une ligne inerte plutôt qu'un lien vers une erreur — la base refuserait
    // de toute façon (member_profile).
    const row = el(owner ? 'button' : 'div', 'admin-membre')
    if (owner) {
      row.type = 'button'
      row.addEventListener('click', () => navigate('/membre?id=' + m.id))
    }
    row.appendChild(avatarMembre(nom, type))

    const corps = el('div', 'admin-membre__corps')
    corps.appendChild(el('span', 'admin-membre__nom', nom + (m.id === myId ? ' (vous)' : '')))
    const details = [typeVisuel(type).libelle]
    if (m.fiche_status) details.push(ETATS_FICHE[m.fiche_status] || '')
    if (m.events_total) details.push(`${m.events_total} évén.`)
    if (!m.fiche_status && !m.events_total) details.push('inscrit le ' + DTF.format(new Date(m.created_at)))
    const detail = el('span', 'admin-membre__detail', details.filter(Boolean).join(' · '))
    if (m.fiche_status === 'pending') detail.classList.add('admin-membre__detail--attente')
    corps.appendChild(detail)
    row.appendChild(corps)

    const marques = el('span', 'admin-membre__marques')
    if (m.is_owner || m.role === 'admin') {
      const s = icon('shield')
      s.setAttribute('aria-label', m.is_owner ? 'Propriétaire' : 'Modérateur')
      s.classList.add('admin-marque--moderateur')
      marques.appendChild(s)
    }
    if (m.is_supporter) {
      const h = icon('heart')
      h.setAttribute('aria-label', 'Soutien')
      h.classList.add('admin-marque--soutien')
      marques.appendChild(h)
    }
    row.appendChild(marques)
    if (owner) row.appendChild(icon('chevronRight'))
    return row
  }

  peindre()
  return wrap
}

/**
 * Forme comparable d'un nom : minuscules, sans accents, sans espaces en trop.
 *
 * ⚠ LES ACCENTS SONT RETIRÉS DES DEUX CÔTÉS. Sans cela, chercher « Benoit »
 * ne trouvait pas « Benoît », et taper un accent sur un clavier de téléphone
 * demande un appui long que personne ne fait pour une recherche.
 */
export function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Conservé pour les écrans qui l'importaient d'ici (voir typeCompte.js). */
export const initiales = initialesCommunes
