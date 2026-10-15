// Armana — éditeur de menu, plat par plat : un nom, un prix (nombre), un
// bouton pour retirer. Partagé par la fiche d'un food truck et la
// « restauration sur place » d'un événement.
//
// Un menu déjà tapé d'un bloc est démêlé à l'ouverture (lib/menu.js), et
// l'enregistrement le réécrit au format propre : une ligne par plat.
import { el } from './components.js'
import { MENU_MAX_PLATS, ecrireMenu, lireMenu } from '../lib/menu.js'
import './planning.css'

/**
 * @param {string} texte  menu existant
 * @param {{titre?:string}} opts
 * @returns {{wrap:HTMLElement, valeur:()=>string}}
 */
export function menuEditeur(texte, { titre = 'Menu' } = {}) {
  const wrap = el('div', 'form__field')
  wrap.appendChild(el('span', 'form__label', titre))
  const lignes = el('div', 'menu-edit')
  wrap.appendChild(lignes)
  const ajouter = el('button', 'btn btn--ghost btn--sm', '+ Ajouter un plat')
  ajouter.type = 'button'
  wrap.appendChild(ajouter)
  wrap.appendChild(el('span', 'form__hint', 'Le prix est facultatif. Les plats s’affichent dans cet ordre.'))

  function ligne(plat = '', prix = null) {
    const l = el('div', 'menu-edit__ligne')
    const nom = el('input', 'form__input')
    nom.type = 'text'
    nom.maxLength = 80
    nom.placeholder = 'Burger maison'
    nom.value = plat
    nom.setAttribute('aria-label', 'Plat')
    const cadrePrix = el('div', 'menu-edit__prix')
    const p = el('input', 'form__input')
    p.type = 'number'
    p.inputMode = 'decimal'
    p.min = '0'
    p.max = '999'
    p.step = '0.5'
    p.placeholder = '12'
    p.setAttribute('aria-label', 'Prix en euros')
    if (prix != null) p.value = String(prix)
    cadrePrix.appendChild(p)
    const retirer = el('button', 'menu-edit__retirer', '×')
    retirer.type = 'button'
    retirer.setAttribute('aria-label', 'Retirer ce plat')
    retirer.addEventListener('click', () => {
      l.remove()
      ajouter.hidden = false
    })
    l.append(nom, cadrePrix, retirer)
    lignes.appendChild(l)
    ajouter.hidden = lignes.children.length >= MENU_MAX_PLATS
    return nom
  }

  const existants = lireMenu(texte)
  if (existants.length) existants.forEach((x) => ligne(x.plat, x.prix))
  else ligne()
  ajouter.addEventListener('click', () => ligne().focus())

  return {
    wrap,
    valeur: () =>
      ecrireMenu(
        [...lignes.children].map((l) => {
          const [nom, prix] = l.querySelectorAll('input')
          const n = parseFloat(String(prix.value).replace(',', '.'))
          return { plat: nom.value, prix: Number.isFinite(n) && n >= 0 ? n : null }
        })
      ),
  }
}
