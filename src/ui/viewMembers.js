// Armana — écran « Membres » (modérateurs et propriétaire).
//
// Savoir d'un coup d'œil QUI est inscrit — particulier, lieu culturel ou food
// truck —, chercher, filtrer par type, trier par date, par prénom ou par nom,
// avec les chiffres en tête. Refonte visuelle du 11/11/2026 : la grammaire des
// écrans de gestion (ui/gestion.js), sur fond bleu.
//
// La LISTE est ouverte aux modérateurs (migration 0022) : elle ne contient
// aucune adresse e-mail. La FICHE d'un membre, elle, en expose une et reste
// réservée au propriétaire — d'où `owner`, qui décide si les lignes s'ouvrent.
import { el } from './components.js'
import { icon } from './icons.js'
import { chiffres, depuis, joursDepuis, note, pageGestion, pastilles, recherche, vide } from './gestion.js'
import { navigate } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, listMembers } from '../lib/admins.js'
import { demoActif } from '../lib/demo.js'
import { avatarMembre, initiales as initialesCommunes, typeVisuel } from './typeCompte.js'

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

const TRIS = [
  { cle: 'recents', texte: 'Récents' },
  { cle: 'prenom', texte: 'Prénom' },
  { cle: 'nom', texte: 'Nom' },
]

const ETATS_FICHE = { pending: 'fiche à valider', approved: 'fiche publiée', rejected: 'fiche refusée' }

/** Inscrit depuis moins de sept jours : étiquette « nouveau ». */
const JOURS_NOUVEAU = 7

// Le filtre et le tri survivent au passage par une fiche : on revient sur la
// liste telle qu'on l'avait laissée (le temps de la visite seulement).
const memoire = { filtre: 'tous', tri: 'recents', recherche: '' }

export async function viewMembers() {
  const wrap = pageGestion('Membres')

  if (!isAdmin() && !demoActif()) {
    wrap.appendChild(vide('Réservé aux modérateurs.'))
    return wrap
  }
  const owner = await amIOwner().catch(() => false)

  let tous = []
  try {
    tous = await listMembers()
  } catch (e) {
    wrap.appendChild(vide('Chargement impossible : ' + e.message))
    return wrap
  }

  // --- Les chiffres ----------------------------------------------------------
  const debutMois = new Date()
  debutMois.setDate(1)
  debutMois.setHours(0, 0, 0, 0)
  const compte = (pred) => tous.filter(pred).length
  const typeDe = (m) => m.account_type || 'particulier'
  wrap.appendChild(
    chiffres([
      { valeur: tous.length, libelle: 'inscrits' },
      { valeur: '+' + compte((m) => new Date(m.created_at) >= debutMois), libelle: 'ce mois' },
      { valeur: compte((m) => typeDe(m) === 'lieu'), libelle: 'lieux' },
      { valeur: compte((m) => typeDe(m) === 'food_truck'), libelle: 'food trucks' },
    ])
  )

  // --- Recherche, filtres, tri ---------------------------------------------------
  const champ = recherche('Chercher un nom…', 'Chercher un membre')
  champ.input.value = memoire.recherche
  wrap.appendChild(champ)

  wrap.appendChild(
    pastilles(
      [
        { cle: 'tous', texte: 'Tous', n: tous.length },
        { cle: 'particulier', texte: 'Particuliers', n: compte((m) => typeDe(m) === 'particulier') },
        { cle: 'lieu', texte: 'Lieux', n: compte((m) => typeDe(m) === 'lieu') },
        { cle: 'food_truck', texte: 'Food trucks', n: compte((m) => typeDe(m) === 'food_truck') },
        { cle: 'association', texte: 'Associations', n: compte((m) => typeDe(m) === 'association') },
        { cle: 'moderateurs', texte: 'Modérateurs', n: compte((m) => m.role === 'admin' || m.is_owner) },
      ],
      {
        actif: memoire.filtre,
        file: true,
        onChange: (cle) => {
          memoire.filtre = cle
          peindre()
        },
      }
    )
  )

  const tris = el('div', 'g-tri')
  tris.setAttribute('role', 'radiogroup')
  tris.setAttribute('aria-label', 'Trier par')
  tris.appendChild(el('span', null, 'Trier :'))
  const boutonsTri = TRIS.map((t) => {
    const b = el('button', null, t.texte)
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

  const liste = el('div', 'g-pile')
  wrap.appendChild(liste)
  wrap.appendChild(
    note(
      owner
        ? 'Touchez un membre pour ouvrir sa fiche : son adresse, son activité, ses publications.'
        : 'Les fiches individuelles, qui portent les adresses e-mail, sont réservées au propriétaire du projet.'
    )
  )

  champ.input.addEventListener('input', () => {
    memoire.recherche = champ.input.value
    peindre()
  })

  const myId = getUser()?.id

  function peindre() {
    for (const { b, cle } of boutonsTri) {
      b.classList.toggle('is-active', cle === memoire.tri)
      b.setAttribute('aria-checked', String(cle === memoire.tri))
    }

    const q = normaliser(memoire.recherche)
    let membres = tous.filter((m) => {
      if (memoire.filtre === 'moderateurs') return m.role === 'admin' || m.is_owner
      if (memoire.filtre !== 'tous') return typeDe(m) === memoire.filtre
      return true
    })
    if (q) {
      membres = membres.filter(
        (m) => normaliser(m.display_name).includes(q) || normaliser(m.fiche_name).includes(q)
      )
    }

    liste.innerHTML = ''
    if (!membres.length) {
      liste.appendChild(vide(q ? 'Aucun membre ne porte ce nom.' : 'Aucun membre de ce type.'))
      return
    }
    // Un filtre ou une recherche annonce ce qu'il donne, sinon on croirait
    // avoir perdu des membres.
    if (membres.length !== tous.length) {
      liste.appendChild(note(`${membres.length} sur ${tous.length} membres`))
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
        liste.appendChild(el('h3', 'g-repere', r))
        groupe = el('div', 'g-groupe')
        liste.appendChild(groupe)
      }
      groupe.appendChild(ligneMembre(m))
    }
  }

  function ligneMembre(m) {
    const nom = m.display_name || 'Sans nom'
    const type = typeDe(m)
    // Un modérateur consulte la liste ; seul le propriétaire ouvre la fiche.
    // Une ligne inerte plutôt qu'un lien vers une erreur — la base refuserait
    // de toute façon (member_profile).
    const row = el(owner ? 'button' : 'div', 'g-ligne')
    if (owner) {
      row.type = 'button'
      row.addEventListener('click', () => navigate('/membre?id=' + m.id))
    }
    row.appendChild(avatarMembre(nom, type))

    const corps = el('div', 'g-ligne__corps')
    corps.appendChild(el('span', 'g-ligne__nom', nom + (m.id === myId ? ' (vous)' : '')))
    const details = [typeVisuel(type).libelle]
    if (m.events_total) details.push(`${m.events_total} publication${m.events_total > 1 ? 's' : ''}`)
    // La dernière visite n'arrive de la base que pour le propriétaire (0037).
    if (m.last_seen) details.push('vu ' + depuis(m.last_seen))
    corps.appendChild(el('span', 'g-ligne__detail', details.join(' · ')))
    if (m.fiche_status) {
      corps.appendChild(
        el(
          'span',
          'g-ligne__detail' + (m.fiche_status === 'pending' ? ' g-ligne__detail--attente' : ''),
          [m.fiche_name, ETATS_FICHE[m.fiche_status]].filter(Boolean).join(' — ')
        )
      )
    }
    row.appendChild(corps)

    const fin = el('span', 'g-ligne__fin')
    const anciennete = joursDepuis(m.created_at)
    if (anciennete != null && anciennete < JOURS_NOUVEAU) {
      fin.appendChild(el('span', 'g-etiquette g-etiquette--nouveau', 'nouveau'))
    }
    if (m.is_owner || m.role === 'admin') {
      const s = icon('shield')
      s.setAttribute('aria-label', m.is_owner ? 'Propriétaire' : 'Modérateur')
      s.classList.add('g-marque--moderateur')
      fin.appendChild(s)
    }
    if (m.is_supporter) {
      const h = icon('heart')
      h.setAttribute('aria-label', 'Soutien')
      h.classList.add('g-marque--soutien')
      fin.appendChild(h)
    }
    row.appendChild(fin)
    if (owner) {
      const chevron = icon('chevronRight')
      chevron.classList.add('g-ligne__chevron')
      row.appendChild(chevron)
    }
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
