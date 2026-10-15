// Armana — choisir un jour dans un calendrier D'ARMANA.
//
// ⚠ PLUS DE CALENDRIER NATIF DU TÉLÉPHONE. Un champ « date » invisible
// ouvrait le sélecteur d'Android, mais le choix validé par « OK » n'arrivait
// jamais jusqu'à l'application — deux corrections successives (« change »,
// puis « input » / « blur ») n'y ont rien changé, et ce sélecteur ne se
// teste pas hors d'un vrai téléphone (signalé deux fois par Matthieu le
// 15/10/2026). Ce calendrier-ci est à nous : une feuille qui monte du bas,
// comme le panneau Filtres ; on touche un jour, c'est retenu, sans « OK ».
import { el } from './components.js'
import { icon } from './icons.js'

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const ENTETES = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/** AAAA-MM-JJ d'une date locale. */
const cle = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * @param {string|null} valeur  jour déjà choisi (AAAA-MM-JJ)
 * @param {(jour:string)=>void} onChoix  appelé au toucher d'un jour
 */
export function ouvrirCalendrier(valeur, onChoix) {
  const auj = new Date()
  const aujCle = cle(auj)
  // Le mois affiché : celui du jour déjà choisi, sinon le mois en cours.
  const depart = valeur ? new Date(valeur + 'T12:00:00') : auj
  let annee = depart.getFullYear()
  let mois = depart.getMonth()

  const fond = el('div', 'feuille-fond')
  const feuille = el('div', 'feuille feuille--calendrier')
  fond.appendChild(feuille)

  const tete = el('div', 'feuille__tete')
  tete.appendChild(el('h2', 'feuille__titre', 'Choisir une date'))
  const fermer = el('button', 'feuille__fermer', '×')
  fermer.type = 'button'
  fermer.setAttribute('aria-label', 'Fermer')
  tete.appendChild(fermer)
  feuille.appendChild(tete)

  const nav = el('div', 'cal-nav')
  const prec = el('button', 'cal-nav__btn')
  prec.type = 'button'
  prec.setAttribute('aria-label', 'Mois précédent')
  prec.appendChild(icon('chevronLeft'))
  const titre = el('span', 'cal-nav__titre')
  const suiv = el('button', 'cal-nav__btn')
  suiv.type = 'button'
  suiv.setAttribute('aria-label', 'Mois suivant')
  suiv.appendChild(icon('chevronRight'))
  nav.append(prec, titre, suiv)
  feuille.appendChild(nav)

  const grille = el('div', 'cal-grille')
  feuille.appendChild(grille)

  function peindre() {
    titre.textContent = MOIS.format(new Date(annee, mois, 1))
    // Pas de retour avant le mois en cours : les jours passés n'ont rien à
    // montrer (l'agenda ne garde que ce qui vient).
    prec.disabled = annee === auj.getFullYear() && mois === auj.getMonth()
    grille.innerHTML = ''
    for (const e of ENTETES) grille.appendChild(el('span', 'cal-grille__entete', e))
    const premier = new Date(annee, mois, 1)
    const decalage = (premier.getDay() + 6) % 7 // lundi = 0
    for (let i = 0; i < decalage; i++) grille.appendChild(el('span', 'cal-grille__vide'))
    const nbJours = new Date(annee, mois + 1, 0).getDate()
    for (let j = 1; j <= nbJours; j++) {
      const d = new Date(annee, mois, j)
      const k = cle(d)
      const b = el('button', 'cal-grille__jour', String(j))
      b.type = 'button'
      if (k < aujCle) b.disabled = true
      if (k === aujCle) b.classList.add('is-today')
      if (k === valeur) b.classList.add('is-active')
      b.setAttribute('aria-label', d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))
      b.addEventListener('click', () => {
        refermer()
        onChoix(k)
      })
      grille.appendChild(b)
    }
  }

  prec.addEventListener('click', () => {
    if (prec.disabled) return
    mois -= 1
    if (mois < 0) {
      mois = 11
      annee -= 1
    }
    peindre()
  })
  suiv.addEventListener('click', () => {
    mois += 1
    if (mois > 11) {
      mois = 0
      annee += 1
    }
    peindre()
  })

  function refermer() {
    document.removeEventListener('keydown', surTouche)
    fond.remove()
  }
  const surTouche = (e) => {
    if (e.key === 'Escape') refermer()
  }
  document.addEventListener('keydown', surTouche)
  fond.addEventListener('click', (e) => {
    if (e.target === fond) refermer()
  })
  fermer.addEventListener('click', refermer)

  peindre()
  document.body.appendChild(fond)
}
