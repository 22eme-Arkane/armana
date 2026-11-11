// Armana — le journal des actions, côté lecture : ses catégories, ses filtres,
// et la mise en phrase d'un acte.
//
// Aucune dépendance à l'interface : l'écran (ui/viewJournal.js) et les données
// de démonstration (lib/demoGestion.js) s'en servent tous les deux, pour que la
// démo filtre exactement comme la base.
import { nomDepartement, zoneEnClair } from './departements.js'

/** Les familles d'actes — c'est par elles qu'on filtre, pas par nom technique. */
export const CATEGORIES = [
  { cle: 'tout', texte: 'Tout', actions: null },
  { cle: 'evenements', texte: 'Événements', actions: ['event_status', 'event_delete'] },
  { cle: 'fiches', texte: 'Fiches', actions: ['fiche_status'] },
  { cle: 'equipe', texte: 'Équipe', actions: ['role_change', 'moderator_depts', 'request_refused'] },
  { cle: 'comptes', texte: 'Comptes', actions: ['member_delete', 'supporter'] },
]

/** Minuscules, sans accents : chercher « fete » trouve « Fête ». */
const plat = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

/**
 * Les mêmes filtres que `list_admin_actions` en base (migration 0040). Rejoués
 * ici pour la démonstration, et pour une base qui n'aurait pas encore la 0040
 * (elle rend alors les 200 dernières lignes, sans tri possible côté serveur).
 */
export function filtrerActes(lignes, { acteur = null, acteurNom = null, actions = null, recherche = '' } = {}) {
  const q = plat(recherche)
  return lignes.filter((a) => {
    // Sans identifiant (base d'avant la 0040), on se rabat sur le nom.
    if (acteur && (a.actor_id ? a.actor_id !== acteur : a.actor_name !== acteurNom)) return false
    if (actions && !actions.includes(a.action)) return false
    if (q && !plat(a.target_label).includes(q)) return false
    return true
  })
}

/**
 * Nommer un modérateur — ou lui retirer le rôle — écrit DEUX lignes dans la
 * même transaction : le rôle, puis la zone. On n'en montre qu'une, qui porte
 * la zone. Les lignes arrivent de la plus récente à la plus ancienne.
 */
export function fusionner(lignes) {
  const memeCible = (a, b) =>
    a.actor_name === b.actor_name &&
    (a.target_id && b.target_id ? a.target_id === b.target_id : a.target_label === b.target_label) &&
    Math.abs(new Date(a.created_at) - new Date(b.created_at)) < 5000

  const sortie = []
  for (let i = 0; i < lignes.length; i++) {
    const a = lignes[i]
    const b = lignes[i + 1]
    const paire =
      b &&
      ((a.action === 'role_change' && b.action === 'moderator_depts') ||
        (a.action === 'moderator_depts' && b.action === 'role_change')) &&
      memeCible(a, b)
    if (!paire) {
      sortie.push(a)
      continue
    }
    const role = a.action === 'role_change' ? a : b
    const zone = a.action === 'role_change' ? b : a
    sortie.push({ ...role, zone: zone.details ?? null })
    i++
  }
  return sortie
}

const INSECABLE = String.fromCharCode(160)
const ETAT_EVENEMENT = { approved: 'il était en ligne', pending: 'il était en attente', rejected: 'il avait été rejeté' }
const TYPE_FICHE = { food_truck: 'food truck', lieu: 'lieu culturel' }
const TYPE_COMPTE = { particulier: 'particulier', lieu: 'lieu culturel', food_truck: 'food truck' }

const liste = (codes) => (codes.length > 4 ? zoneEnClair(codes) : codes.map((c) => `${c} ${nomDepartement(c)}`).join(', '))

/**
 * Un acte → de quoi écrire une ligne : « **Qui** a fait quoi à **cible** ».
 *
 * @returns {{ton:string, icone:string, avant:string, cible:string, apres:string,
 *            detail:string|null, lien:string|null}}
 *   `ton` : ok · refus · sensible · equipe · soutien · neutre.
 *   `lien` : la route de la cible quand elle existe encore (jamais pour une
 *   suppression).
 */
export function decrire(a) {
  const d = a.details || {}
  const nom = a.target_label || '(sans nom)'
  // Espaces insécables : un guillemet ne reste pas seul en bout de ligne.
  const titre = `«${INSECABLE}${nom}${INSECABLE}»`
  const versMembre = a.target_id ? `/membre?id=${a.target_id}&retour=journal` : null
  const base = { ton: 'neutre', icone: 'clock', avant: '', cible: nom, apres: '', detail: null, lien: null }

  switch (a.action) {
    case 'event_status': {
      const lien = a.target_id ? `/evenement?id=${a.target_id}` : null
      if (d.apres === 'approved') return { ...base, ton: 'ok', icone: 'check', avant: 'a approuvé', cible: titre, lien }
      if (d.apres === 'rejected') return { ...base, ton: 'refus', icone: 'x', avant: 'a rejeté', cible: titre, lien }
      return { ...base, avant: 'a remis en attente', cible: titre, lien }
    }
    case 'event_delete':
      return {
        ...base,
        ton: 'sensible',
        icone: 'trash',
        avant: 'a supprimé l’événement',
        cible: titre,
        detail: ETAT_EVENEMENT[d.statut] ?? null,
      }
    case 'fiche_status': {
      const lien = a.target_id ? `/fiche?id=${a.target_id}` : null
      const detail = TYPE_FICHE[d.kind] ?? null
      if (d.apres === 'approved') {
        return { ...base, ton: 'ok', icone: d.kind === 'food_truck' ? 'truck' : 'landmark', avant: 'a validé la fiche', cible: titre, detail, lien }
      }
      if (d.apres === 'rejected') {
        return { ...base, ton: 'refus', icone: 'x', avant: 'a refusé la fiche', cible: titre, detail, lien }
      }
      return { ...base, avant: 'a remis en relecture la fiche', cible: titre, detail, lien }
    }
    case 'role_change':
      if (d.apres === 'admin') {
        const codes = a.zone?.apres ?? null
        return {
          ...base,
          ton: 'equipe',
          icone: 'userPlus',
          avant: 'a nommé',
          apres: ' modérateur',
          detail: codes?.length ? 'Zone : ' + zoneEnClair(codes) : null,
          lien: versMembre,
        }
      }
      return { ...base, ton: 'sensible', icone: 'shield', avant: 'a retiré le rôle de modérateur à', lien: versMembre }
    case 'moderator_depts': {
      const avant = d.avant ?? []
      const apres = d.apres ?? []
      const ajoutes = apres.filter((c) => !avant.includes(c))
      const retires = avant.filter((c) => !apres.includes(c))
      const morceaux = []
      if (!apres.length) morceaux.push('désormais toute la France')
      else if (!avant.length) morceaux.push('Zone : ' + zoneEnClair(apres))
      else {
        if (ajoutes.length) morceaux.push('+ ' + liste(ajoutes))
        if (retires.length) morceaux.push('− ' + liste(retires))
      }
      return {
        ...base,
        ton: 'equipe',
        icone: 'map',
        avant: 'a modifié la zone de',
        detail: morceaux.join(' · ') || null,
        lien: versMembre,
      }
    }
    case 'request_refused':
      return {
        ...base,
        ton: 'refus',
        icone: 'x',
        avant: 'a refusé la candidature de',
        detail: d.depts?.length ? 'Zone demandée : ' + zoneEnClair(d.depts) : null,
        lien: versMembre,
      }
    case 'supporter':
      return {
        ...base,
        ton: 'soutien',
        icone: 'heart',
        avant: d.ajoute ? 'a ajouté' : 'a retiré',
        apres: d.ajoute ? ' au mur des soutiens' : ' du mur des soutiens',
        lien: versMembre,
      }
    case 'member_delete':
      return {
        ...base,
        ton: 'sensible',
        icone: 'trash',
        avant: 'a supprimé le compte de',
        detail: TYPE_COMPTE[d.type] ?? null,
      }
    default:
      // Un acte que cette version ne connaît pas : on le montre quand même.
      return { ...base, avant: `— ${a.action} —` }
  }
}
