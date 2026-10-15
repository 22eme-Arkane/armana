// Armana — choisir une commune dans la liste officielle, SANS LA TAPER.
//
// Le champ de saisie ne sert qu'à FILTRER : tant qu'on n'a pas touché une
// proposition, aucune commune n'est retenue. Une fois choisie, elle s'affiche
// en pastille avec « Changer ».
import { el } from './components.js'
import { icon } from './icons.js'
import { chargerCommunes, rechercher } from '../lib/communes.js'

/**
 * @param {{onChoix?:(c:object|null)=>void, invite?:string}} opts
 * @returns {{wrap:HTMLElement, valeur:()=>object|null, choisir:(c:object|null, silencieux?:boolean)=>void}}
 */
export function rechercheCommune({ onChoix, invite } = {}) {
  const wrap = el('div', 'commune')

  const choisie = el('div', 'choix-lieu__choisie')
  const nomChoisi = el('strong', null, '')
  const changer = el('button', 'btn btn--ghost btn--sm', 'Changer')
  changer.type = 'button'
  choisie.append(icon('pin'), nomChoisi, changer)

  const recherche = el('div', 'choix-lieu__recherche')
  const input = el('input', 'form__input')
  input.type = 'search'
  input.placeholder = invite || 'Tapez le début du nom, puis choisissez'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Rechercher une commune')
  const liste = el('div', 'choix-lieu__liste')
  liste.setAttribute('role', 'listbox')
  recherche.append(input, liste)
  wrap.append(choisie, recherche)

  let commune = null

  function peindre() {
    choisie.hidden = !commune
    recherche.hidden = Boolean(commune)
    nomChoisi.textContent = commune ? commune.nom + (commune.dept ? ` (${commune.dept})` : '') : ''
  }

  /** `silencieux` : pré-remplissage, sans prévenir l'appelant. */
  function choisir(c, silencieux = false) {
    commune = c
    input.value = ''
    liste.innerHTML = ''
    peindre()
    if (!silencieux) onChoix?.(c)
  }

  changer.addEventListener('click', () => {
    commune = null
    peindre()
    onChoix?.(null)
    input.focus()
  })

  input.addEventListener('input', async () => {
    liste.innerHTML = ''
    if (input.value.trim().length < 2) return
    let communes
    try {
      communes = await chargerCommunes()
    } catch (e) {
      liste.appendChild(el('p', 'form__hint', 'Liste des communes indisponible : ' + e.message))
      return
    }
    const trouvees = rechercher(communes, input.value)
    if (!trouvees.length) {
      liste.appendChild(el('p', 'form__hint', 'Aucune commune de la région ne correspond.'))
      return
    }
    for (const c of trouvees) {
      const b = el('button', 'choix-lieu__option')
      b.type = 'button'
      b.setAttribute('role', 'option')
      b.appendChild(el('strong', null, c.nom))
      b.appendChild(el('span', null, `${c.cp} · ${c.dept}`))
      b.addEventListener('click', () => choisir(c))
      liste.appendChild(b)
    }
  })
  // Entrée = la première proposition, jamais l'envoi du formulaire.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    liste.querySelector('.choix-lieu__option')?.click()
  })

  peindre()
  return { wrap, valeur: () => commune, choisir }
}
