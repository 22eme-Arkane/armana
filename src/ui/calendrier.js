// Armana — ouvrir le calendrier du téléphone pour choisir un jour.
//
// Un champ « date » invisible, posé le temps du choix : le calendrier natif
// (Android, iOS, ordinateur) s'ouvre directement, sans champ à remplir.
// ⚠ À APPELER DANS UN GESTE (clic) : les navigateurs refusent d'ouvrir un
// calendrier autrement.
import { el } from './components.js'

/**
 * @param {string|null} valeur  jour déjà choisi (AAAA-MM-JJ)
 * @param {(jour:string|null)=>void} onChoix
 */
export function ouvrirCalendrier(valeur, onChoix) {
  // ⚠ PAS DE RETRAIT AU « blur » : certains navigateurs retirent le focus en
  // ouvrant leur calendrier, et un champ retiré trop tôt ne reçoit jamais le
  // choix. Un champ abandonné (calendrier fermé sans choix) est simplement
  // nettoyé à l'ouverture suivante.
  document.querySelectorAll('.calendrier-cache').forEach((c) => c.remove())
  const champ = el('input', 'calendrier-cache')
  champ.type = 'date'
  champ.min = new Date().toLocaleDateString('en-CA')
  champ.value = valeur || ''
  champ.setAttribute('aria-label', 'Choisir une date')
  document.body.appendChild(champ)

  champ.addEventListener('change', () => {
    onChoix(champ.value || null)
    setTimeout(() => champ.remove(), 0)
  })

  try {
    if (typeof champ.showPicker === 'function') champ.showPicker()
    else champ.focus()
  } catch {
    // Navigateur plus ancien : le focus suffit à ouvrir le sélecteur (iOS).
    champ.focus()
  }
}
