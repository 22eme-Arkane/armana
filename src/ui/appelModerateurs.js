// Armana — « Nous cherchons des modérateurs » : proposé juste après l'inscription.
//
// Demande de Matthieu (07/11/2026), pour l'ouverture à la France : chaque
// nouvelle inscription dans une région qui manque de bras reçoit l'invitation.
// Le seuil : au-delà de CINQ modérateurs dans la région, on ne la montre plus.
// Les régions retenues sont celles du territoire suivi par la personne.
import { el } from './components.js'
import { navigate } from '../lib/router.js'
import { nomRegion, regionsDe } from '../lib/departements.js'
import { getMesDepartements } from '../lib/mesDepartements.js'
import { moderateursParRegion } from '../lib/moderation.js'
import './choixRegion.css'

export const SEUIL_MODERATEURS = 5

/**
 * Affiche l'invitation si une région suivie compte moins de 5 modérateurs.
 * Ne lève jamais : c'est une proposition, pas une étape de l'inscription.
 */
export async function proposerModeration() {
  let compte
  try {
    compte = await moderateursParRegion()
  } catch {
    return // migration absente ou hors ligne : on n'insiste pas
  }
  const manquent = regionsDe(getMesDepartements()).filter((r) => (compte.get(r) ?? 0) < SEUIL_MODERATEURS)
  if (!manquent.length) return

  const fond = el('div', 'feuille-fond')
  const feuille = el('div', 'feuille appel-moderateurs')
  fond.appendChild(feuille)
  feuille.appendChild(el('h2', 'feuille__titre', 'Bienvenue sur Armana !'))
  const ou = manquent.map(nomRegion).join(', ')
  feuille.appendChild(
    el(
      'p',
      'appel-moderateurs__texte',
      `Armana s’ouvre en ${ou} et nous cherchons des modérateurs : des personnes ` +
        'qui relisent les événements publiés près de chez elles avant leur mise en ligne. ' +
        'Quelques minutes par semaine, depuis votre téléphone.'
    )
  )
  const pied = el('div', 'feuille__pied')
  const plusTard = el('button', 'btn btn--ghost', 'Plus tard')
  plusTard.type = 'button'
  const oui = el('button', 'btn btn--primary', 'Devenir modérateur')
  oui.type = 'button'
  pied.append(plusTard, oui)
  feuille.appendChild(pied)

  const fermer = () => fond.remove()
  plusTard.addEventListener('click', fermer)
  fond.addEventListener('click', (e) => e.target === fond && fermer())
  oui.addEventListener('click', () => {
    fermer()
    navigate('/devenir-moderateur')
  })
  document.body.appendChild(fond)
}
