// Armana — écran « Soutenir Armana » : don libre + mur de remerciements.
//
// Même principe que « Soutenir Pandora » : un lien PayPal.me, qui fonctionne avec
// n'importe quel compte et accepte la carte bancaire sans que le donateur ait
// besoin d'un compte PayPal.
// ⚠ NE PAS utiliser « paypal.com/donate?business=… » : ce point d'entrée est
// réservé aux organisations caritatives ENREGISTRÉES et répond « cette
// organisation ne peut pas accepter de dons » sur un compte ordinaire.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import {
  listSupporters,
  setSupporterByEmail,
  mySupporterStatus,
  setSupporterVisibility,
} from '../lib/supporters.js'

const PAYPAL_URL = 'https://paypal.me/22emearkane'

const MEDAILLES = ['🥇', '🥈', '🥉']
// Petites touches chaleureuses, choisies de façon stable pour chaque personne :
// le même nom garde toujours le même emblème.
const EMBLEMES = ['🌻', '🎭', '🎪', '🎨', '🎵', '🌟', '🍀', '🕯️', '🎻', '🌞', '🎨', '🥁']

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

function embleme(nom, rang) {
  if (rang < MEDAILLES.length) return MEDAILLES[rang]
  let somme = 0
  for (const c of nom) somme = (somme + c.codePointAt(0)) % 9973
  return EMBLEMES[somme % EMBLEMES.length]
}

export async function viewSupport() {
  // Fond bleu, comme la connexion (refonte du 05/11/2026) : le bouton juste
  // sous l'illustration, puis les explications, puis les remerciements.
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--studio-don')
  wrap.appendChild(studioHeader('Faire un don', { backTo: '/parametres' }))

  // L'illustration fournie par Matthieu (assets/Faire un Don.png), recadrée et
  // réduite à 288 px. J'avais d'abord tenté de la redessiner en SVG pour
  // économiser le téléchargement : le rendu ne lui allait pas, on garde donc
  // l'originale. Elle ne se charge que sur cet écran.
  const illu = el('div', 'illu')
  const imgDon = el('img', 'illu__img')
  imgDon.src = '/icons/armana-don.png'
  imgDon.alt = 'Un cœur tenu à deux mains'
  illu.appendChild(imgDon)
  wrap.appendChild(illu)

  // Le même bouton que dans le Profil (.don-banner, style.css) : on retrouve
  // ce qu'on vient de toucher, et il est visible sans faire défiler.
  const btn = el('a', 'don-banner')
  btn.href = PAYPAL_URL
  btn.target = '_blank'
  btn.rel = 'noopener noreferrer'
  const coeur = el('span', 'don-banner__coeur')
  coeur.appendChild(icon('heart'))
  const textes = el('span', 'don-banner__texte')
  textes.append(
    el('strong', 'don-banner__titre', 'Faire un don'),
    el('span', 'don-banner__sous-titre', 'PayPal ou carte bancaire')
  )
  const rond = el('span', 'don-banner__fleche')
  rond.appendChild(icon('chevronRight'))
  btn.append(coeur, textes, rond)
  wrap.appendChild(btn)

  // ⚠ Explications COMPLÈTES, volontairement. J'avais coupé au plus court ;
  // Matthieu l'a corrigé : c'est justement l'endroit où les gens ont besoin de
  // tout savoir avant de sortir leur carte bancaire.
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Armana est et restera gratuite, sans publicité et sans revente de données.'
    )
  )

  const card = el('div', 'support-card')
  card.appendChild(
    el(
      'p',
      'support-text',
      'L’application est développée et hébergée par 22eme Arkane. Les frais sont ' +
        'modestes mais réels : hébergement, nom de domaine, stockage des photos. ' +
        'Un coup de pouce, même très petit, aide à la garder en ligne et à continuer ' +
        'de l’améliorer.'
    )
  )
  card.appendChild(
    el(
      'p',
      'support-text support-text--muted',
      'C’est totalement facultatif : rien n’est bloqué, rien n’est limité, et vous ' +
        'ne serez jamais relancé.'
    )
  )
  wrap.appendChild(card)

  // --- Mur des soutiens ----------------------------------------------------
  const wall = el('div', 'support-wall')
  wrap.appendChild(wall)
  renderWall(wall)

  // --- Réglage personnel : apparaître ou non dans les remerciements ---------
  if (isLoggedIn()) renderVisibility(wrap)

  // --- Outil admin : marquer un soutien ------------------------------------
  if (isLoggedIn() && isAdmin()) renderAdminTool(wrap)

  wrap.appendChild(
    el(
      'p',
      'support-thanks',
      'Et si vous préférez aider autrement : parlez d’Armana autour de vous et ' +
        'publiez les événements que vous connaissez. C’est au moins aussi précieux. 🙏'
    )
  )

  return wrap
}

async function renderWall(wall) {
  wall.innerHTML = ''
  wall.appendChild(
    el('h2', 'support-wall__title', 'Merci à celles et ceux qui ont fait un don')
  )

  let list = []
  try {
    list = await listSupporters()
  } catch (e) {
    wall.appendChild(el('p', 'form__hint', 'Liste indisponible pour le moment.'))
    return
  }

  if (!list.length) {
    wall.appendChild(
      el(
        'p',
        'support-empty',
        'Personne pour l’instant… vous pourriez être la première personne à figurer ici ! ✨'
      )
    )
    return
  }

  const grid = el('div', 'support-list')
  list.forEach((s, i) => {
    const item = el('div', 'support-badge')
    item.appendChild(el('span', 'support-badge__emoji', embleme(s.display_name, i)))
    item.appendChild(el('span', 'support-badge__name', s.display_name))
    if (s.since) {
      item.appendChild(el('span', 'support-badge__since', 'depuis ' + MOIS.format(new Date(s.since))))
    }
    grid.appendChild(item)
  })
  wall.appendChild(grid)
  // (Le décompte « N personnes soutiennent Armana. Merci ! » a été retiré :
  //  le titre remercie déjà, et les noms parlent d'eux-mêmes.)
}

async function renderVisibility(wrap) {
  let status
  try {
    status = await mySupporterStatus()
  } catch {
    return
  }
  if (!status?.is_supporter) return

  const box = el('div', 'settings-group')
  const row = el('label', 'settings-row settings-row--static')
  const label = el('div', 'settings-row__label')
  label.appendChild(icon('heart'))
  label.appendChild(document.createTextNode('Apparaître dans les remerciements'))
  row.appendChild(label)
  const toggle = el('input')
  toggle.type = 'checkbox'
  toggle.checked = Boolean(status.is_public)
  toggle.addEventListener('change', async () => {
    toggle.disabled = true
    try {
      await setSupporterVisibility(toggle.checked)
      renderWall(document.querySelector('.support-wall'))
    } catch (e) {
      alert('Modification impossible : ' + e.message)
      toggle.checked = !toggle.checked
    } finally {
      toggle.disabled = false
    }
  })
  row.appendChild(toggle)
  box.appendChild(row)
  wrap.appendChild(box)
  wrap.appendChild(
    el('p', 'form__hint', 'Vous restez un soutien même si vous choisissez de ne pas apparaître.')
  )
}

function renderAdminTool(wrap) {
  wrap.appendChild(el('h2', 'support-wall__title', '🔧 Enregistrer un soutien (admin)'))
  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'PayPal ne prévient pas l’application : après avoir reçu un don, indiquez ici ' +
        'l’e-mail du compte Armana de la personne pour l’ajouter au mur. ' +
        'Demandez-lui son accord avant de l’afficher publiquement.'
    )
  )

  const form = el('form', 'form')
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'E-mail du compte'))
  const input = el('input', 'form__input')
  input.type = 'email'
  input.placeholder = 'prenom.nom@exemple.fr'
  input.required = true
  field.appendChild(input)
  form.appendChild(field)

  const row = el('div', 'form__row')
  const add = el('button', 'btn btn--primary', 'Ajouter au mur')
  add.type = 'submit'
  const remove = el('button', 'btn btn--ghost', 'Retirer')
  remove.type = 'button'
  row.appendChild(add)
  row.appendChild(remove)
  form.appendChild(row)

  const msg = el('p', 'form__msg')
  form.appendChild(msg)

  const apply = async (isSupporter) => {
    const email = input.value.trim()
    if (!email) return
    add.disabled = true
    remove.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Enregistrement…'
    try {
      const r = await setSupporterByEmail(email, isSupporter)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = isSupporter
        ? `${r?.display_name || email} a été ajouté au mur des soutiens. 💛`
        : `${r?.display_name || email} a été retiré du mur.`
      input.value = ''
      renderWall(document.querySelector('.support-wall'))
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = e.message
    } finally {
      add.disabled = false
      remove.disabled = false
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    apply(true)
  })
  remove.addEventListener('click', () => apply(false))

  wrap.appendChild(form)
}
