// Carte éditoriale dédiée à l’Agenda « Studio Affiche ».
// Elle est volontairement indépendante de la carte générique utilisée ailleurs.
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import { addGem, removeGem } from '../lib/events.js'
import { el, formatPriceCourt, formatTime } from './components.js'
import { icon, marqueurArmana } from './icons.js'
import { libelleCourt } from '../lib/univers.js'

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
const JOUR_SEMAINE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' })

/** Une clé AAAA-MM-JJ en Date locale, à midi pour éviter tout décalage. */
function jourDe(cle) {
  const [a, m, j] = cle.split('-').map(Number)
  return new Date(a, m - 1, j, 12, 0, 0, 0)
}

const deuxChiffres = (d) => String(d.getDate()).padStart(2, '0')

// --- Un MOT trop long pour la colonne du titre (14/11/2026) ------------------
// La colonne du titre ne fait que ~85 px sur un téléphone de 360 px. Un mot
// plus large qu'elle — « FORCAL'STREET », « développement » — y était rogné à
// droite, sans le moindre signe (signalé par Matthieu). Plutôt que de couper le
// mot, on rapetisse le titre de CETTE carte, demi-pixel par demi-pixel, juste
// assez pour qu'il tienne ; les autres cartes gardent leur corps. Sous
// CORPS_MINI, en dernier recours seulement, le mot passe à la ligne.
// ⚠ Pas de ResizeObserver par carte : l'Agenda reconstruit sa liste à chaque
// filtre, et un observateur garde chaque titre en mémoire. On mesure une fois
// à l'affichage, puis on remesure tout quand la largeur ou la police change.
// Le BADGE DE PRIX suit la même règle (« Libre + chapeau », « Payant · 3,5 -
// 7 € » finissaient en « … » à 360 px) ; lui garde ses points de suspension en
// dernier recours, il n'a qu'une ligne.
// Le STYLE aussi, sur les plus petits écrans (320 px) : « Exposition »,
// « Méditation » y dépassaient de 2 à 4 px.
const CORPS_MINI = 11
const CORPS_MINI_PRIX = 7.5
const CORPS_MINI_STYLE = 7.5

/** Rapetisse `noeud` jusqu'à ce que son texte tienne en largeur (≥ `mini` px).
 *  Rend vrai si le texte tient. */
function rapetisser(noeud, mini) {
  noeud.style.fontSize = ''
  if (!noeud.isConnected || !noeud.clientWidth) return true
  const deborde = () => noeud.scrollWidth > noeud.clientWidth + 0.5
  if (!deborde()) return true
  let corps = parseFloat(getComputedStyle(noeud).fontSize)
  while (deborde() && corps - 0.5 >= mini) {
    corps -= 0.5
    noeud.style.fontSize = `${corps}px`
  }
  return !deborde()
}

function ajusterTitre(titre) {
  titre.style.overflowWrap = ''
  if (!rapetisser(titre, CORPS_MINI)) titre.style.overflowWrap = 'anywhere'
}

/** `textesChanges` : l'aperçu de Publier vient de réécrire titre et tarif. */
export function ajusterCarte(carte, { textesChanges = false } = {}) {
  const titre = carte.querySelector('.poster-card__title')
  if (titre) ajusterTitre(titre)
  const style = carte.querySelector('.poster-card__category')
  if (style) rapetisser(style, CORPS_MINI_STYLE)
  const prix = carte.querySelector('.poster-card__price')
  if (prix) {
    // Le texte complet est gardé à part : une carte plus large (téléphone
    // tourné) le retrouve.
    if (textesChanges) delete prix.dataset.complet
    prix.dataset.complet ??= prix.textContent
    prix.textContent = prix.dataset.complet
    // Toujours trop long (à côté de la pastille « Food sur place ») : le mot
    // « Payant » tombe, le montant reste — il dit à lui seul que c'est payant.
    if (!rapetisser(prix, CORPS_MINI_PRIX) && /^Payant · /.test(prix.textContent)) {
      prix.textContent = prix.textContent.replace(/^Payant · /, '')
      rapetisser(prix, CORPS_MINI_PRIX)
    }
  }
}

let reajustementPrevu = false
function reajusterTout() {
  if (reajustementPrevu) return
  reajustementPrevu = true
  requestAnimationFrame(() => {
    reajustementPrevu = false
    document.querySelectorAll('.poster-card').forEach(ajusterCarte)
  })
}
window.addEventListener('resize', reajusterTout)
// Oswald arrive de Google Fonts : mesuré avec la police de secours, un titre
// pourrait paraître tenir et déborder une fois la vraie police chargée.
document.fonts?.ready.then(reajusterTout)

export function posterEventCard(ev, opts = {}) {
  const card = el('article', 'poster-card')
  const tones = ['yellow', 'red', 'green', 'blue']
  card.dataset.tone = tones[(opts.index ?? 0) % tones.length]
  // Un événement sur plusieurs jours est affiché à chacune de ses dates : cet
  // attribut permet de garder tous ses cœurs de favori synchronisés.
  if (ev.id) card.dataset.eventId = ev.id
  card.tabIndex = 0
  card.setAttribute('aria-label', `Voir l’événement ${ev.title}`)

  const startsAt = new Date(ev.starts_at)
  const date = el('div', 'poster-card__date')
  // Le jour de la semaine, en tête et en petit : « samedi 30 août » se situe
  // d'un coup d'œil, là où « 30 août » oblige à compter.
  date.appendChild(el('span', 'poster-card__weekday', JOUR_SEMAINE.format(startsAt)))
  if (ev._plage) {
    // ÉVÉNEMENT QUI DURE : la plage restante, pas la date de départ. Elle se
    // resserre d'elle-même au fil des jours, puisqu'elle est recalculée à
    // chaque affichage.
    // Le PREMIER jour garde toute sa taille — c'est la date qu'on cherche — et
    // la fin s'inscrit dessous, plus petite. Les serrer sur une même ligne
    // rapetissait les deux pour rien : la colonne a la place.
    const d = jourDe(ev._plage.debut)
    const f = jourDe(ev._plage.fin)
    const memeMois = d.getMonth() === f.getMonth() && d.getFullYear() === f.getFullYear()
    const mois = (x) => MONTH.format(x).replace('.', '').toUpperCase()
    date.classList.add('poster-card__date--plage')
    date.appendChild(el('span', 'poster-card__day', deuxChiffres(d)))
    date.appendChild(el('span', 'poster-card__month', mois(d)))
    // Le mois de fin n'est répété que s'il diffère : « → 20 » suffit à
    // l'intérieur d'un même mois.
    // La flèche dans son propre élément : elle doit être plus grosse que le
    // texte pour ne pas paraître flotter, ce qu'un seul nœud de texte ne
    // permettait pas.
    // ⚠ FLÈCHE DESSINÉE, pas le caractère « → ». Le glyphe d'Oswald a une barre
    // bien plus fine que les jambages des lettres : à côté d'un « T », il
    // paraissait fluet quelle que soit sa taille. Ici l'épaisseur du trait est
    // réglée à la main pour égaler celle des lettres.
    const jusqua = el('span', 'poster-card__jusqua')
    const fleche = el('span', 'poster-card__fleche')
    fleche.innerHTML =
      '<svg viewBox="0 0 22 12" aria-hidden="true" focusable="false">' +
      '<path d="M1.6 6h16M12.4 1.4 17.9 6l-5.5 4.6" fill="none" stroke="currentColor" ' +
      'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    jusqua.appendChild(fleche)
    jusqua.appendChild(
      document.createTextNode(memeMois ? deuxChiffres(f) : `${deuxChiffres(f)} ${mois(f)}`)
    )
    date.appendChild(jusqua)
  } else {
    date.appendChild(el('span', 'poster-card__day', String(startsAt.getDate()).padStart(2, '0')))
    date.appendChild(
      el('span', 'poster-card__month', MONTH.format(startsAt).replace('.', '').toUpperCase())
    )
  }
  date.appendChild(el('span', 'poster-card__time', formatTime(ev.starts_at)))
  card.appendChild(date)

  const media = el('div', 'poster-card__media')
  const src = ev.thumb_url || ev.photo_url
  if (src) {
    const image = el('img')
    image.src = src
    image.alt = ''
    image.loading = 'lazy'
    media.appendChild(image)
  } else {
    media.classList.add('poster-card__media--empty')
  }
  card.appendChild(media)

  const info = el('div', 'poster-card__info')
  // Le libellé COURT (« Spectacles » pour « Spectacles vivants ») : le long
  // finissait en « SPECTACLES… » dans la colonne étroite.
  if (ev.category) info.appendChild(el('span', 'poster-card__category', libelleCourt(ev.category)))
  // Titre COMPLET : le tronquer à la première virgule amputait « Fête votive,
  // feu d'artifice et bal » sans le moindre signe. Le CSS gère l'ellipse.
  info.appendChild(el('h3', 'poster-card__title', ev.title))
  // La carte n'est posée dans la page qu'après ce retour : on mesure à l'image
  // suivante (voir ajusterCarte, plus haut).
  requestAnimationFrame(() => ajusterCarte(card))
  // ⚠ L'ADRESSE PASSE AVANT LA MENTION DES JOURS. « Tous les lundis, mardis,
  // mercredis, jeudis, vendredis et samedis » remplissait le cadre à lui seul
  // et chassait le lieu — or c'est le lieu qui fait décider d'y aller. Les
  // trois choses qui comptent sont le titre, le style et l'adresse ; le reste
  // s'efface, et la fiche complète est à un doigt de là.
  // ⚠ LA MENTION DES JOURS EST RETIRÉE de la carte. « Jour 10 sur 31 » ou
  // « Tous les lundis, mardis… » écrasait le titre et l'adresse pour une
  // information qu'on ne lit pas en parcourant une liste. Trois choses
  // suffisent ici : le style, le nom, le lieu. Le détail est sur la fiche.
  const ville = ev.ville || (ev.address ? villeDeLAdresse(ev.address) : '')
  if (ville) {
    // ⚠ LA VILLE SEULE, PAS L'ADRESSE COMPLÈTE. « Chapelle St François,
    // Couvent des Cordeliers, 04300 Forcalquier » tenait sur trois lignes et
    // repoussait tout le reste, alors qu'en parcourant l'agenda on ne cherche
    // qu'à savoir si c'est près de chez soi. L'adresse entière est sur la
    // fiche, à un doigt de là — c'est là qu'on la lit, au moment d'y aller.
    const lieu = el('p', 'poster-card__place')
    // Le même marqueur que la carte et la fiche, en tout petit : il signale
    // « c'est ici que ça se passe » sans qu'on ait à lire.
    lieu.appendChild(marqueurArmana({ size: 12 }))
    // ⚠ TOUJOURS LA COMMUNE, et la même partout (Matthieu, 15/10/2026) : on
    // lisait tantôt « 04300 », tantôt « Mane », tantôt « Théâtre La
    // Rirette ». `ev.ville` vient de la commune choisie (migration 0035) ou,
    // pour les anciens événements, de la liste officielle (lib/communes.js).
    lieu.appendChild(document.createTextNode(' ' + ville))
    info.appendChild(lieu)
  }
  // Forme COURTE : le badge ne dépasse pas quinze signes (voir formatPriceCourt).
  info.appendChild(el('span', 'poster-card__price', formatPriceCourt(ev)))
  // « Food sur place » (migration 0034) : un food truck a annoncé sa venue.
  // En pastille seule — la carte n'a pas la place d'un mot de plus à côté du
  // tarif ; la fiche, elle, l'écrit en toutes lettres.
  if (ev.food_trucks?.length || ev.restauration) {
    const food = el('span', 'poster-card__food')
    food.title = 'Food sur place'
    food.setAttribute('aria-label', 'Food sur place')
    food.appendChild(icon('truck'))
    info.appendChild(food)
    info.classList.add('poster-card__info--food')
  }
  card.appendChild(info)

  if (opts.showGem !== false) {
    const loggedIn = isLoggedIn()
    let gemmed = Boolean(opts.gemmed)
    const favorite = el('button', 'poster-card__favorite')
    favorite.type = 'button'
    favorite.title = 'Favori'
    favorite.setAttribute('aria-label', 'Ajouter aux favoris')
    const heart = icon('heart')
    favorite.appendChild(heart)
    const paint = () => {
      favorite.classList.toggle('is-on', gemmed)
      favorite.setAttribute('aria-label', gemmed ? 'Retirer des favoris' : 'Ajouter aux favoris')
      heart.setAttribute('fill', gemmed ? 'currentColor' : 'none')
    }
    paint()
    favorite.addEventListener('click', async (event) => {
      event.stopPropagation()
      if (opts.preview) return
      if (!loggedIn) {
        navigate('/connexion')
        return
      }
      favorite.disabled = true
      try {
        if (gemmed) await removeGem(ev.id)
        else await addGem(ev.id)
        gemmed = !gemmed
        paint()
        opts.onGemChange?.(ev.id, gemmed)
      } catch (error) {
        alert('Action impossible : ' + error.message)
      } finally {
        favorite.disabled = false
      }
    })
    card.appendChild(favorite)
  }

  const open = () => {
    if (!opts.preview) navigate('/evenement?id=' + ev.id)
  }
  card.addEventListener('click', (event) => {
    if (!event.target.closest('button')) open()
  })
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })

  return card
}
