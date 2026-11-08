// Armana — premier lancement : « Quelle région voulez-vous suivre ? »
//
// Depuis l'ouverture à la France (07/11/2026), un appareil NEUF n'a pas de
// territoire : lui montrer PACA à Brest serait absurde, lui montrer les 96
// départements le noierait. On lui demande donc sa région, une fois — avec la
// possibilité de se localiser (décision de Matthieu : « sa région, devinée
// puis modifiable »). Les appareils d'avant ne voient jamais cet écran : ils
// gardent PACA et la Drôme (lib/mesDepartements.js).
import { el } from './components.js'
import { icon } from './icons.js'
import { getUserLocation } from '../lib/geo.js'
import { REGIONS, departementEnFrance, deptsDeRegion, nomRegion, regionDuDept } from '../lib/departements.js'
import { setMesDepartements } from '../lib/mesDepartements.js'
import './choixRegion.css'

/**
 * Ouvre l'écran par-dessus l'application. Ne se ferme qu'une fois une région
 * choisie : sans territoire, l'agenda n'aurait rien de juste à montrer.
 * @param {(codes:string[]) => void} onChoix
 */
export function ouvrirChoixRegion(onChoix) {
  const fond = el('div', 'choix-region')
  const carte = el('div', 'choix-region__carte')
  fond.appendChild(carte)

  const logo = el('img', 'choix-region__logo')
  logo.src = '/icons/armana-logo.png'
  logo.alt = ''
  carte.appendChild(logo)
  carte.appendChild(el('h1', 'choix-region__titre', 'Bienvenue sur Armana'))
  carte.appendChild(
    el(
      'p',
      'choix-region__texte',
      'L’agenda culturel partagé, partout en France. Quelle région voulez-vous suivre ?'
    )
  )

  const msg = el('p', 'choix-region__msg')
  const localiser = el('button', 'choix-region__localiser')
  localiser.type = 'button'
  localiser.append(icon('navigation'), el('span', null, 'Me localiser'))
  localiser.addEventListener('click', async () => {
    localiser.disabled = true
    msg.textContent = 'Localisation en cours…'
    const pos = await getUserLocation()
    const dept = pos.fallback ? null : await departementEnFrance(pos).catch(() => null)
    localiser.disabled = false
    if (!dept) {
      msg.textContent = pos.fallback
        ? 'Position indisponible : choisissez votre région ci-dessous.'
        : 'Vous semblez être hors de France métropolitaine : choisissez une région ci-dessous.'
      return
    }
    choisir(regionDuDept(dept), `Vous êtes en ${nomRegion(regionDuDept(dept))}.`)
  })
  carte.appendChild(localiser)
  carte.appendChild(msg)

  const liste = el('div', 'choix-region__liste')
  for (const r of REGIONS) {
    const b = el('button', 'choix-region__region', r.nom)
    b.type = 'button'
    b.addEventListener('click', () => choisir(r.code))
    liste.appendChild(b)
  }
  carte.appendChild(liste)
  carte.appendChild(
    el(
      'p',
      'choix-region__aide',
      'Vous pourrez ajouter d’autres régions, ou ne garder que quelques départements, ' +
        'dans Profil → Mon territoire.'
    )
  )

  function choisir(region, annonce = null) {
    const codes = setMesDepartements(deptsDeRegion(region))
    if (annonce) msg.textContent = annonce
    // Un instant pour lire l'annonce de la localisation, puis on ferme.
    setTimeout(
      () => {
        fond.remove()
        onChoix?.(codes)
      },
      annonce ? 700 : 0
    )
  }

  document.body.appendChild(fond)
}
