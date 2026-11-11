// Armana — choisir une adresse précise, SANS LA TAPER EN ENTIER.
//
// Même geste que pour la commune (ui/rechercheCommune.js) : le champ ne sert
// qu'à chercher ; tant qu'on n'a pas touché une proposition, rien n'est retenu.
// Une fois choisie, l'adresse s'affiche en pastille avec « Changer ».
// La recherche elle-même est dans lib/geocodage.js.
import { el } from './components.js'
import { icon } from './icons.js'
import { chercherAdresse } from '../lib/geocodage.js'

/**
 * @param {object} opts
 * @param {(a:object|null)=>void} [opts.onChoix]
 * @param {()=>({nom?:string, lat?:number, lng?:number}|null)} [opts.pres]
 *        la commune déjà choisie, lue au moment de chercher
 * @returns {{wrap:HTMLElement, valeur:()=>object|null,
 *            choisir:(a:object|null, silencieux?:boolean)=>void}}
 */
export function rechercheAdresse({ onChoix, pres } = {}) {
  const wrap = el('div', 'commune')

  const choisie = el('div', 'choix-lieu__choisie')
  const nomChoisi = el('strong', null, '')
  const changer = el('button', 'btn btn--ghost btn--sm', 'Changer')
  changer.type = 'button'
  choisie.append(icon('navigation'), nomChoisi, changer)

  const recherche = el('div', 'choix-lieu__recherche')
  const input = el('input', 'form__input')
  input.type = 'search'
  input.placeholder = 'N° et rue — ex. 12 rue des Cordeliers'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Rechercher une adresse précise')
  const liste = el('div', 'choix-lieu__liste')
  liste.setAttribute('role', 'listbox')
  recherche.append(input, liste)
  wrap.append(choisie, recherche)

  let adresse = null

  function peindre() {
    choisie.hidden = !adresse
    recherche.hidden = Boolean(adresse)
    nomChoisi.textContent = adresse ? [adresse.lieu, adresse.rue].filter(Boolean).join(' — ') || adresse.titre || '' : ''
  }

  /** `silencieux` : pré-remplissage, sans prévenir l'appelant. */
  function choisir(a, silencieux = false) {
    adresse = a
    input.value = ''
    liste.innerHTML = ''
    peindre()
    if (!silencieux) onChoix?.(a)
  }

  changer.addEventListener('click', () => {
    choisir(null)
    input.focus()
  })

  const message = (texte) => {
    liste.innerHTML = ''
    liste.appendChild(el('p', 'form__hint', texte))
  }

  let attente = null
  let enCours = null
  input.addEventListener('input', () => {
    clearTimeout(attente)
    enCours?.abort()
    const saisie = input.value.trim()
    if (saisie.length < 3) {
      liste.innerHTML = ''
      return
    }
    // On attend que la frappe se pose : une requête par lettre saturerait des
    // services gratuits, et les réponses arriveraient dans le désordre.
    attente = setTimeout(async () => {
      const moi = new AbortController()
      enCours = moi
      if (!liste.children.length) message('Recherche…')
      let trouvees
      try {
        trouvees = await chercherAdresse(saisie, { pres: pres?.() ?? null, signal: moi.signal })
      } catch {
        if (moi.signal.aborted) return
        message('Recherche d’adresse indisponible pour l’instant. Placez le repère à la main sur la carte, juste en dessous.')
        return
      }
      if (moi.signal.aborted) return
      if (!trouvees.length) {
        message('Adresse introuvable. Essayez sans le numéro, ou placez le repère à la main sur la carte.')
        return
      }
      liste.innerHTML = ''
      for (const a of trouvees) {
        const b = el('button', 'choix-lieu__option choix-lieu__option--adresse')
        b.type = 'button'
        b.setAttribute('role', 'option')
        b.appendChild(el('strong', null, a.titre))
        b.appendChild(
          el('span', null, [a.lieu && a.rue ? a.rue : '', [a.cp, a.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '))
        )
        b.addEventListener('click', () => choisir(a))
        liste.appendChild(b)
      }
    }, 350)
  })
  // Entrée = la première proposition, jamais l'envoi du formulaire.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    liste.querySelector('.choix-lieu__option')?.click()
  })

  peindre()
  return { wrap, valeur: () => adresse, choisir }
}
