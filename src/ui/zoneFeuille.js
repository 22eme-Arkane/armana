// Armana — la feuille « zone de modération » : choisir des départements sur la
// carte de France, puis VALIDER.
//
// Refonte du 11/11/2026. Avant, la zone d'un modérateur se réglait dans treize
// menus de régions dépliés au milieu de la page, et CHAQUE touche enregistrait
// aussitôt : le journal se remplissait d'une ligne par département, et l'on ne
// savait jamais si c'était « fini ». Désormais : une feuille, la carte (toucher
// une région la prend ou la rend en entier), le détail par département pour
// affiner, et UN bouton — donc une seule écriture, une seule ligne au journal.
import './gestion.css'
import './filtres.css' // « Affiner par département » (.filtre-affiner)
import { el } from './components.js'
import { carteDepartements } from './carteDepts.js'
import { listeParRegion } from './parRegion.js'
import { deptsDeRegion, regionDuDept, regionsDe, resumeTerritoire } from '../lib/departements.js'

/**
 * Une feuille vide, à remplir : { fond, corps, pied, fermer }.
 * Se referme au fond, à la croix, ou sur Échap.
 */
export function feuilleGestion(titre) {
  const fond = el('div', 'feuille-fond g-feuille')
  const feuille = el('div', 'feuille')
  fond.appendChild(feuille)
  const tete = el('div', 'feuille__tete')
  tete.appendChild(el('h2', 'feuille__titre', titre))
  const croix = el('button', 'feuille__fermer', '×')
  croix.type = 'button'
  croix.setAttribute('aria-label', 'Fermer')
  tete.appendChild(croix)
  const corps = el('div', 'feuille__corps')
  const pied = el('div', 'feuille__pied')
  feuille.append(tete, corps, pied)

  const surTouche = (e) => e.key === 'Escape' && fermer()
  function fermer() {
    document.removeEventListener('keydown', surTouche)
    fond.remove()
  }
  document.addEventListener('keydown', surTouche)
  fond.addEventListener('click', (e) => e.target === fond && fermer())
  croix.addEventListener('click', fermer)
  document.body.appendChild(fond)
  return { fond, corps, pied, fermer }
}

/**
 * Ouvre le choix d'une zone.
 * @param {object} o
 * @param {string} o.titre
 * @param {string} [o.aide]              une phrase sous le titre
 * @param {string[]} o.selection         départements cochés à l'ouverture
 * @param {string} [o.valider]           libellé du bouton (« Enregistrer »)
 * @param {(codes:string[]) => Promise<any>} o.onValider  lève en cas d'échec ;
 *        la feuille reste alors ouverte, avec le message
 * @param {() => Promise<any>} [o.onRetirer]  affiche « Retirer le rôle »
 * @param {string} [o.nom]               pour la confirmation du retrait
 */
export function ouvrirZone({ titre, aide = null, selection, valider = 'Enregistrer', onValider, onRetirer = null, nom = '' }) {
  const { corps, pied, fermer } = feuilleGestion(titre)
  let choisis = [...new Set(selection ?? [])]

  if (aide) corps.appendChild(el('p', 'g-feuille__aide', aide))

  const cadre = el('div', 'g-france')
  const carte = carteDepartements({
    selection: choisis,
    // Un département touché bascule TOUTE sa région : c'est la région qu'on
    // confie d'un geste ; le détail se règle dessous.
    onPick: (code) => {
      const siens = deptsDeRegion(regionDuDept(code))
      const tous = siens.every((c) => choisis.includes(c))
      choisis = tous ? choisis.filter((c) => !siens.includes(c)) : [...new Set([...choisis, ...siens])]
      peindre()
    },
  })
  cadre.appendChild(carte)
  corps.appendChild(cadre)

  const resume = el('p', 'g-feuille__resume')
  corps.appendChild(resume)

  const affiner = el('details', 'filtre-affiner')
  affiner.appendChild(el('summary', null, 'Affiner par département'))
  // Ouvert d'emblée quand la zone est déjà PARTIELLE dans une région : sinon
  // on ne verrait pas ce qui la compose.
  const partielle = regionsDe(choisis).some((r) => !deptsDeRegion(r).every((c) => choisis.includes(c)))
  affiner.open = partielle
  const boutons = new Map()
  const regions = listeParRegion({
    pastilles: true,
    selection: () => choisis,
    basculerRegion: (codes, tous) => {
      choisis = tous ? [...new Set([...choisis, ...codes])] : choisis.filter((c) => !codes.includes(c))
      peindre()
    },
    rendre: (d) => {
      const b = el('button', 'choix__option', `${d.code} ${d.nom}`)
      b.type = 'button'
      b.addEventListener('click', () => {
        choisis = choisis.includes(d.code) ? choisis.filter((c) => c !== d.code) : [...choisis, d.code]
        peindre()
      })
      boutons.set(d.code, b)
      return b
    },
  })
  affiner.appendChild(regions)
  corps.appendChild(affiner)

  const msg = el('p', 'g-feuille__msg')
  corps.appendChild(msg)

  const annuler = el('button', 'btn btn--ghost', 'Annuler')
  annuler.type = 'button'
  annuler.addEventListener('click', fermer)
  const ok = el('button', 'btn btn--primary', valider)
  ok.type = 'button'
  pied.append(annuler, ok)

  function peindre() {
    carte.setSelection(choisis)
    for (const [code, b] of boutons) b.classList.toggle('is-active', choisis.includes(code))
    regions.repeindre()
    resume.textContent = choisis.length
      ? `${resumeTerritoire(choisis)} — ${choisis.length} département${choisis.length > 1 ? 's' : ''}`
      : 'Aucun département choisi.'
    msg.textContent = ''
  }
  peindre()

  const occupe = (oui) => {
    ok.disabled = annuler.disabled = oui
    if (retirer) retirer.disabled = oui
  }

  ok.addEventListener('click', async () => {
    if (!choisis.length) {
      msg.textContent = 'Choisissez au moins un département.'
      return
    }
    occupe(true)
    ok.textContent = 'Enregistrement…'
    try {
      await onValider([...choisis].sort())
      fermer()
    } catch (e) {
      msg.textContent = e.message || 'Enregistrement impossible.'
      ok.textContent = valider
      occupe(false)
    }
  })

  let retirer = null
  if (onRetirer) {
    retirer = el('button', 'g-feuille__retirer', 'Retirer le rôle de modérateur')
    retirer.type = 'button'
    retirer.addEventListener('click', async () => {
      if (!confirm(`Retirer le rôle de modérateur à ${nom || 'ce membre'} ?`)) return
      occupe(true)
      try {
        await onRetirer()
        fermer()
      } catch (e) {
        msg.textContent = e.message || 'Retrait impossible.'
        occupe(false)
      }
    })
    corps.appendChild(retirer)
  }
}
