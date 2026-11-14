// Armana — le « + » de publication, en forme de masque (14/11/2026).
//
// Choisi par Matthieu après trois séries d'essais : le masque jaune du logo,
// détouré par ses soins (`public/icons/masque-jaune.png`, tiré de
// `assets/LOGO_Armana_1mask.png`, recadré et réduit sans retouche des bords),
// cerné d'un liseré vert sombre — comme les repères de la carte — pour se
// détacher de la barre jaune, et une pastille bleue « + » sur le menton.
// Taille retenue : masque de 56 px, pastille de 28 px (« le masque était gros
// et le plus petit »).
//
// ⚠ Ni forme redessinée ni contour relevé sur l'image : les deux ont été
// jugés « pas propres ». C'est l'image d'origine, telle quelle.
import { el } from './components.js'
import { icon } from './icons.js'

/** Le contenu du bouton : le masque, et sa pastille « + ». */
export function masquePublier() {
  const cadre = el('span', 'navtab-publier__masque')
  const img = el('img')
  img.src = '/icons/masque-jaune.png'
  img.alt = ''
  img.decoding = 'async'
  const pastille = el('span', 'navtab-publier__pastille')
  pastille.appendChild(icon('plus'))
  cadre.append(img, pastille)
  return cadre
}
