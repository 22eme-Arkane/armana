// Armana — vue Publier / Modifier un événement.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)
import { el, formatPrice, formatPriceCourt, formatTime, BADGE_MAX } from './components.js'
import { blocDescription } from './ficheEvenement.js'
import { loginPrompt } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { createPhotoFramer } from './photoFramer.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { DEFAULT_CENTER } from '../lib/geo.js'
import { chargerCommunes, communeDansLeTexte, communeLaPlusProche } from '../lib/communes.js'
import { getMaFiche } from '../lib/fiches.js'
import { rechercheCommune } from './rechercheCommune.js'
import { menuEditeur } from './menuEditeur.js'
import { foodTrucksAnnonces, foodTrucksValides, synchroniserFoodTrucks } from '../lib/foodTrucks.js'
import './planning.css'
import { JOURS, formatJourMois, serieProposee } from '../lib/recurrence.js'
import { toDisplayableFile } from '../lib/heic.js'
import { consumeDraft, consumeSharedFile } from '../lib/draft.js'
import {
  CATEGORIES,
  createEvent,
  updateEvent,
  uploadEventPhotos,
  envoyerPhotoMenu,
  retirerPhotoMenu,
  getEventById,
  isUpcoming,
} from '../lib/events.js'

const PREVIEW_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

// Date écrite en toutes lettres, ANNÉE COMPRISE : c'est elle qui manque partout
// ailleurs (l'aperçu n'affiche que « 01 AOÛT »).
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Nombre de mois entre aujourd'hui et `d` (négatif si passé). */
function moisDEcart(d) {
  const now = new Date()
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
}

function toolButton(label, title) {
  const b = el('button', 'photo-preview__zoom', label)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  return b
}

export async function viewPublish({ query } = {}) {
  if (!isLoggedIn()) {
    const wrap = el('section', 'page page--studio-sub')
    wrap.appendChild(studioHeader('Publier', { backTo: '/parametres' }))
    wrap.appendChild(loginPrompt('Connectez-vous pour publier un événement.'))
    return wrap
  }

  const editId = query?.get('id') || null
  const existing = editId ? await getEventById(editId) : null
  // Brouillon pré-rempli (issu de l'analyse d'un message). Consommé une seule fois.
  const draft = existing ? null : consumeDraft()
  const init = existing || draft || {}
  // Photo reçue via le partage natif (WhatsApp…), en création uniquement.
  const sharedPhoto = existing ? null : consumeSharedFile()

  // ⚠ C'est l'ENCADRÉ du formulaire qui est bleu, pas la page. J'avais fait
  // l'inverse au premier essai : tout l'écran devenait bleu et les textes
  // passaient en blanc, y compris hors de l'encadré, où ils devenaient
  // invisibles sur le fond clair.
  const wrap = el('section', 'page page--studio-sub page--studio-publish')
  wrap.appendChild(
    studioHeader(existing ? 'Modifier' : 'Publier', {
      backTo: existing ? '/mes-evenements' : '/parametres',
      backLabel: existing ? 'Mes événements' : 'Profil',
    })
  )
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Votre événement sera visible après validation par un modérateur.'
    )
  )

  // Raccourci : pré-remplir depuis un message (WhatsApp…). Uniquement en création.
  if (!existing) {
    const fromMsg = el('button', 'btn btn--green btn--block')
    fromMsg.type = 'button'
    fromMsg.appendChild(icon('message'))
    fromMsg.appendChild(document.createTextNode(' Remplir depuis un message'))
    fromMsg.addEventListener('click', () => navigate('/importer'))
    wrap.appendChild(fromMsg)
  }
  if (draft) {
    wrap.appendChild(
      el('p', 'demo-note', 'Champs pré-remplis depuis votre message — vérifiez et complétez le lieu.')
    )
  }

  const form = el('form', 'form form--wide')

  const fTitle = textField('Titre *', 'text', init.title)
  // « Musique » par défaut : la catégorie la plus publiée, et un choix déjà
  // valide vaut mieux qu'un champ vide qu'on oublie de remplir.
  const fCategory = selectField('Catégorie *', CATEGORIES, init.category || 'Musique')
  const fDesc = textareaField('Description', init.description)
  // ⚠ DÉBUT PRÉ-RENSEIGNÉ SUR AUJOURD'HUI. Vide, `datetime-local` laisse
  // l'année à ce que le navigateur propose : c'est ainsi qu'un événement s'est
  // retrouvé daté 2027 (« La mare où (l')on se Mire ») et relégué tout en bas
  // de l'agenda. Partir de la date du jour supprime la faute la plus coûteuse,
  // celle qu'on ne voit pas.
  // L'heure, elle, doit bien être choisie : 20 h, l'heure la plus fréquente
  // pour un événement culturel — à corriger d'un geste.
  const fStart = textField(
    'Début *',
    'datetime-local',
    toLocalInput(init.starts_at) || debutParDefaut()
  )
  const fEnd = textField('Fin (optionnel)', 'datetime-local', toLocalInput(init.ends_at))

  fTitle.input.placeholder = 'Nom de l’événement'
  fDesc.input.placeholder =
    'Décrivez votre événement de la manière la plus précise possible'

  // --- Aperçu « À propos », tel que la fiche l'affichera --------------------
  // La fiche découpe la description en paragraphes (une ligne sautée), la
  // justifie et la centre : un texte tapé d'un bloc ne ressemble plus à ce
  // qu'on a écrit. L'auteur voit donc ici, à chaque frappe, exactement le
  // rendu final — et comprend pourquoi sauter des lignes (demande de Matthieu,
  // après l'affiche « Farouche Devah » dont la mise en page ne passait pas).
  const apercuDesc = el('div', 'form__field')
  apercuDesc.appendChild(el('span', 'form__label', 'Aperçu sur la fiche'))
  const cadreApercu = el('div', 'fiche-apercu')
  apercuDesc.appendChild(cadreApercu)
  apercuDesc.appendChild(
    el(
      'span',
      'form__hint',
      'Sautez une ligne entre deux paragraphes : c’est ce qui les sépare sur la fiche.'
    )
  )
  function majApercuDesc() {
    cadreApercu.textContent = ''
    const bloc = blocDescription(fDesc.input.value)
    if (!bloc) {
      cadreApercu.appendChild(
        el('p', 'fiche-apercu__vide', 'Votre description apparaîtra ici, telle qu’elle sera lue.')
      )
      return
    }
    const carte = el('section', 'fiche-carte')
    carte.appendChild(el('h3', 'fiche-carte__titre', 'À propos'))
    carte.appendChild(bloc)
    cadreApercu.appendChild(carte)
  }
  fDesc.input.addEventListener('input', majApercuDesc)
  majApercuDesc()

  // ⚠ L'ANNÉE est le piège de `datetime-local` : on tape le jour et le mois, et
  // l'année reste sur ce que le navigateur avait proposé. Rien ne la rappelait
  // ensuite — l'aperçu n'affiche que le jour et le mois — si bien qu'un
  // événement saisi pour l'an prochain paraissait juste et se retrouvait tout
  // en bas de l'agenda (cas réel : « La mare où (l')on se Mire », daté 2027).
  // On écrit donc la date en toutes lettres sous le champ.
  const dateEcho = el('span', 'form__hint date-echo')
  fStart.wrap.appendChild(dateEcho)

  // ⚠ Beaucoup de gens laissent « Fin » vide et recréent un SECOND événement
  // pour le lendemain (cas réel : les 21 et 22 août saisis deux fois). Le
  // mécanisme multi-jours existe pourtant déjà — c'est le champ qui ne disait
  // pas à quoi il sert. On l'explique, et on montre l'étendue obtenue.
  fEnd.wrap.appendChild(
    el(
      'span',
      'form__hint',
      'Sur plusieurs jours ? Indiquez ici la date de fin : l’événement apparaîtra ' +
        'sur toutes les dates, sans avoir à le saisir deux fois.'
    )
  )
  const finEcho = el('span', 'form__hint date-echo')
  fEnd.wrap.appendChild(finEcho)

  /** Confirme l'étendue réellement couverte par les deux dates. */
  function majEtendue(debut) {
    finEcho.textContent = ''
    const vf = fEnd.input.value
    if (!debut || !vf) return
    const f = new Date(vf)
    if (Number.isNaN(f.getTime())) return
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
    const n = Math.round((jour(f) - jour(debut)) / 86400000) + 1
    if (n > 1) {
      finEcho.textContent = `→ ${n} jours : affiché du ${formatJourMois(debut)} au ${formatJourMois(f)}.`
    }
  }

  function majEchoDate() {
    const v = fStart.input.value
    if (!v) {
      dateEcho.textContent = ''
      dateEcho.classList.remove('date-echo--warn')
      majEtendue(null)
      return
    }
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) {
      dateEcho.textContent = ''
      dateEcho.classList.remove('date-echo--warn')
      majEtendue(null)
      return
    }
    majEtendue(d)
    const ecart = moisDEcart(d)
    let texte = '→ ' + DATE_LONGUE.format(d)
    let alerte = false
    // ⚠ `>= 12` et non `> 12` : la faute de frappe classique est l'année juste
    // au-dessus, soit EXACTEMENT 12 mois d'écart — c'est le cas qu'il faut
    // attraper en premier, et un seuil strict le laissait passer.
    if (ecart >= 12) {
      texte += ' — dans un an ou plus, l’année est-elle la bonne ?'
      alerte = true
    } else if (!isUpcoming({ starts_at: d.toISOString(), ends_at: null })) {
      texte += ' — date déjà passée, l’événement n’apparaîtrait pas'
      alerte = true
    }
    dateEcho.textContent = texte
    dateEcho.classList.toggle('date-echo--warn', alerte)
  }

  // --- Répétition -----------------------------------------------------------
  // Le marché du vendredi, les food-trucks du mercredi : un seul événement,
  // qui s'allume sur les bons jours de la période (migration 0013).
  const recurWrap = el('div', 'form__field')
  recurWrap.appendChild(el('span', 'form__label', 'Répétition'))
  const recurToggle = el('label', 'switch')
  const recurInput = el('input')
  recurInput.type = 'checkbox'
  recurToggle.appendChild(recurInput)
  recurToggle.appendChild(el('span', 'switch__text', 'Cet événement se répète'))
  recurWrap.appendChild(recurToggle)

  const recurBox = el('div', 'recur')
  const daysRow = el('div', 'recur__days')
  const dayBtns = JOURS.map((j) => {
    const b = el('button', 'recur__day', j.court)
    b.type = 'button'
    b.dataset.n = String(j.n)
    b.title = j.long
    b.setAttribute('aria-label', j.long)
    b.addEventListener('click', () => {
      b.classList.toggle('is-active')
      refreshPreview()
    })
    daysRow.appendChild(b)
    return b
  })
  // ⚠ LE RYTHME N'EST PAS ENREGISTRÉ, C'EST UNE AIDE DE SAISIE.
  // « Une fois par mois » ne tombe pas sur la même semaine tous les mois : une
  // règle hebdomadaire ne peut pas le décrire, et l'atelier « un vendredi par
  // mois » s'affichait « Tous les vendredis ». Au-delà de l'hebdomadaire, on
  // enregistre donc LES DATES ELLES-MÊMES ; le rythme sert seulement à les
  // proposer, l'organisateur corrigeant celles qui tombent mal — vacances,
  // salle prise, jour férié.
  const RYTHMES = [
    { cle: 'semaine', texte: 'Toutes les semaines' },
    { cle: 'quinzaine', texte: 'Une semaine sur deux' },
    { cle: 'mois', texte: 'Une fois par mois' },
  ]
  let rythme = 'semaine'
  const rythmeRow = el('div', 'choix')
  const rythmeBtns = RYTHMES.map((r) => {
    const b = el('button', 'choix__option', r.texte)
    b.type = 'button'
    b.dataset.cle = r.cle
    b.addEventListener('click', () => {
      if (rythme === r.cle) return
      rythme = r.cle
      // Passer à un rythme non hebdomadaire propose aussitôt les dates :
      // sinon on découvre une liste vide sans savoir quoi en faire.
      if (rythme !== 'semaine') proposerDates()
      majRecurrence()
      refreshPreview()
    })
    rythmeRow.appendChild(b)
    return b
  })
  recurBox.appendChild(rythmeRow)
  recurBox.appendChild(daysRow)

  // --- Les dates de la série, une par ligne --------------------------------
  const datesBox = el('div', 'serie')
  const datesListe = el('div', 'serie__liste')
  datesBox.appendChild(datesListe)
  const datesActions = el('div', 'serie__actions')
  const btnAjouter = el('button', 'btn btn--ghost btn--sm', 'Ajouter une date')
  btnAjouter.type = 'button'
  btnAjouter.addEventListener('click', () => {
    ajouterLigneDate('')
    refreshPreview()
  })
  // ⚠ LE LIBELLÉ DOIT DIRE CE QUE FAIT LE BOUTON. « Recalculer les dates » ne
  // le disait pas — Matthieu n'a pas compris à quoi il servait. Il REPREND la
  // liste depuis le début et la fin de période : utile quand on change ces
  // dates après coup, la liste ne les suit pas toute seule.
  const btnProposer = el('button', 'btn btn--ghost btn--sm', 'Reproposer depuis la période')
  btnProposer.type = 'button'
  btnProposer.addEventListener('click', () => {
    proposerDates()
    majRecurrence()
    refreshPreview()
  })
  datesActions.append(btnAjouter, btnProposer)
  datesBox.appendChild(datesActions)
  recurBox.appendChild(datesBox)

  const recurEcho = el('p', 'form__hint recur__echo')
  recurBox.appendChild(recurEcho)
  recurWrap.appendChild(recurBox)

  function ajouterLigneDate(valeur) {
    const ligne = el('div', 'serie__ligne')
    const champ = el('input', 'form__input serie__date')
    champ.type = 'date'
    if (valeur) champ.value = valeur
    champ.addEventListener('change', () => {
      majRecurrence()
      refreshPreview()
    })
    const retirer = el('button', 'serie__retirer', '×')
    retirer.type = 'button'
    retirer.setAttribute('aria-label', 'Retirer cette date')
    retirer.addEventListener('click', () => {
      ligne.remove()
      majRecurrence()
      refreshPreview()
    })
    ligne.append(champ, retirer)
    datesListe.appendChild(ligne)
    return champ
  }

  /** Dates saisies, nettoyées : triées, sans doublon ni ligne vide. */
  const datesChoisies = () => {
    const brut = [...datesListe.querySelectorAll('.serie__date')]
      .map((i) => i.value)
      .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
    return [...new Set(brut)].sort()
  }

  /**
   * Propose les dates depuis le début et la fin de période saisis.
   * « Une fois par mois » garde le RANG DU JOUR DANS LE MOIS — deuxième
   * vendredi, troisième samedi — et non le quantième : c'est ainsi que les
   * ateliers et les marchés s'organisent, et le 31 n'existe pas tous les mois.
   */
  function proposerDates() {
    const debut = lireDateChamp(fStart.input)
    const fin = lireDateChamp(fEnd.input)
    if (!debut || !fin) return
    const out = serieProposee(debut, fin, rythme)
    if (!out.length) return
    datesListe.innerHTML = ''
    for (const d of out) ajouterLigneDate(d)
  }

  const joursChoisis = () =>
    dayBtns.filter((b) => b.classList.contains('is-active')).map((b) => Number(b.dataset.n))

  function majRecurrence() {
    const actif = recurInput.checked
    recurBox.style.display = actif ? '' : 'none'
    for (const b of rythmeBtns) b.classList.toggle('is-active', b.dataset.cle === rythme)

    const parDates = rythme !== 'semaine'
    daysRow.style.display = parDates ? 'none' : ''
    datesBox.style.display = parDates ? '' : 'none'

    // Pour une répétition hebdomadaire, « Fin » borne la PÉRIODE et devient
    // requis : sans borne, elle remplirait le calendrier indéfiniment. Pour une
    // série de dates, les bornes se déduisent des dates — mais elles restent
    // nécessaires pour les PROPOSER.
    const lbl = fEnd.wrap.querySelector('.form__label')
    if (lbl) lbl.textContent = actif ? 'Fin de la période *' : 'Fin (optionnel)'
    if (!actif) {
      recurEcho.textContent = ''
      return
    }

    if (parDates) {
      const n = datesChoisies().length
      recurEcho.textContent = n
        ? `${n} séance${n > 1 ? 's' : ''}. Corrigez les dates qui tombent mal, ` +
          'ajoutez ou retirez-en librement. « Reproposer depuis la période » ' +
          'refait la liste à partir du début et de la fin — vos retouches sont perdues.'
        : 'Renseignez le début et la fin de période, puis « Reproposer depuis la période ».'
      return
    }
    const noms = JOURS.filter((j) => joursChoisis().includes(j.n)).map((j) => j.long)
    recurEcho.textContent = noms.length
      ? `Tous les ${noms.join('s, tous les ')}s, jusqu’à la date de fin.`
      : 'Choisissez au moins un jour.'
  }
  recurInput.addEventListener('change', () => {
    majRecurrence()
    refreshPreview()
  })

  // Reprise d'un événement existant en édition.
  const joursInit = Array.isArray(init.recur_days) ? init.recur_days.map(Number) : []
  const datesInit = Array.isArray(init.recur_dates)
    ? init.recur_dates.map((d) => String(d).slice(0, 10)).filter(Boolean)
    : []
  recurInput.checked = joursInit.length > 0 || datesInit.length > 0
  for (const b of dayBtns) {
    if (joursInit.includes(Number(b.dataset.n))) b.classList.add('is-active')
  }
  if (datesInit.length) {
    // On ne sait plus quel rythme les avait produites, et ça n'a pas
    // d'importance : ce sont les dates qui font foi. « Une fois par mois »
    // n'est ici qu'un intitulé d'onglet.
    rythme = 'mois'
    for (const d of datesInit) ajouterLigneDate(d)
  }
  majRecurrence()

  // --- Contact de l'organisateur (facultatif) -------------------------------
  const fContact = textField('Contact ou lien (facultatif)', 'text', init.contact || '')
  fContact.input.placeholder = 'Site, page Facebook, téléphone, e-mail…'
  fContact.wrap.appendChild(
    el(
      'span',
      'form__hint',
      'Affiché sur la fiche de l’événement, pour que le public puisse vous joindre.'
    )
  )

  // --- Tarif : gratuit, prix libre, payant ----------------------------------
  // « Prix libre » existait déjà dans les faits — une affiche publiée porte
  // « Entrée libre participation » — sans pouvoir se dire dans le formulaire.
  const TARIFS = [
    { cle: 'gratuit', texte: 'Gratuit' },
    { cle: 'libre', texte: 'Prix libre' },
    { cle: 'payant', texte: 'Payant' },
  ]
  let tarif = init.price_mode || (init.is_paid ? 'payant' : 'gratuit')
  // « Au chapeau » S'AJOUTE au tarif choisi (demande d'une utilisatrice) :
  // gratuit et au chapeau, prix libre et au chapeau. Les trois tarifs
  // s'excluent entre eux ; le chapeau, lui, se coche ou se décoche à part.
  let chapeau = Boolean(init.au_chapeau)
  const paidWrap = el('div', 'form__field')
  paidWrap.appendChild(el('span', 'form__label', 'Tarif'))
  const tarifRow = el('div', 'choix')
  const tarifBtns = TARIFS.map((t) => {
    const b = el('button', 'choix__option', t.texte)
    b.type = 'button'
    b.dataset.cle = t.cle
    b.addEventListener('click', () => {
      tarif = t.cle
      majTarif()
      refreshPreview()
    })
    tarifRow.appendChild(b)
    return b
  })
  const chapeauBtn = el('button', 'choix__option choix__option--ajout', '+ Au chapeau')
  chapeauBtn.type = 'button'
  chapeauBtn.setAttribute('aria-pressed', String(chapeau))
  chapeauBtn.addEventListener('click', () => {
    chapeau = !chapeau
    majTarif()
    refreshPreview()
  })
  tarifRow.appendChild(chapeauBtn)
  paidWrap.appendChild(tarifRow)

  const paidRow = el('div', 'form__row')
  // « Prix libre » prend lui aussi un MONTANT, pas du texte : c'est le minimum
  // attendu, rangé dans la même colonne `price`. D'où ce préfixe, affiché pour
  // ce seul tarif.
  const prefixe = el('span', 'tarif__prefixe', '≥')
  paidRow.appendChild(prefixe)
  const priceInput = el('input', 'form__input form__input--price')
  priceInput.type = 'number'
  priceInput.min = '0'
  priceInput.step = '0.5'
  if (init.price != null) priceInput.value = init.price
  priceInput.addEventListener('input', () => {
    // Le montant mange la place de la précision : on remet les compteurs.
    majTarif()
    refreshPreview()
  })
  paidRow.appendChild(priceInput)

  // ⚠ LONGUEUR BORNÉE À 15, comme la contrainte en base (migration 0029).
  // Cette précision s'affiche à la suite du montant dans le badge de la
  // vignette, sur UNE ligne. « tarif réduit 12 €, par personne » n'y entrerait
  // jamais : elle serait tronquée, soit exactement l'information qu'on vient
  // d'ajouter. Quinze caractères, prix compris.
  const detailInput = el('input', 'form__input')
  detailInput.type = 'text'
  detailInput.maxLength = 15
  // L'exemple suit le tarif choisi : voir `majTarif`. Proposer « tarif réduit
  // 12 € » sous « Prix libre » n'aurait aucun sens.
  if (init.price_detail) detailInput.value = init.price_detail
  detailInput.addEventListener('input', refreshPreview)
  paidRow.appendChild(detailInput)
  paidWrap.appendChild(paidRow)
  const tarifEcho = el('span', 'form__hint')
  paidWrap.appendChild(tarifEcho)
  const chapeauEcho = el(
    'span',
    'form__hint',
    'Au chapeau : le public donne en plus ce qu’il veut, au passage du chapeau.'
  )
  paidWrap.appendChild(chapeauEcho)

  function majTarif() {
    for (const b of tarifBtns) b.classList.toggle('is-active', b.dataset.cle === tarif)
    chapeauBtn.classList.toggle('is-active', chapeau)
    chapeauBtn.setAttribute('aria-pressed', String(chapeau))
    chapeauEcho.hidden = !chapeau
    // Le montant sert au tarif payant (le prix) comme au prix libre (le
    // minimum) ; la précision en texte est réservée au payant.
    priceInput.style.display = tarif === 'gratuit' ? 'none' : ''
    prefixe.style.display = tarif === 'libre' ? '' : 'none'
    detailInput.style.display = tarif === 'payant' ? '' : 'none'
    priceInput.placeholder = tarif === 'libre' ? 'Minimum en €' : 'Prix en €'
    detailInput.placeholder = 'ex. tarif réduit'

    if (tarif === 'gratuit') {
      tarifEcho.textContent = ''
      return
    }
    if (tarif === 'libre') {
      tarifEcho.textContent =
        'Chacun donne ce qu’il veut. Laissez le montant vide s’il n’y a pas de minimum.'
      return
    }

    // ⚠ QUINZE CARACTÈRES EN TOUT, PRIX COMPRIS — et non quinze pour la seule
    // précision. Mesuré : le badge de la vignette est plafonné par sa colonne
    // (86 px) et coupe au-delà d'une quinzaine de caractères. « 200 € · réduit
    // 12 € » y était TRONQUÉ, donc l'information ajoutée se perdait.
    // La place restante dépend du montant : on l'annonce, et on borne le champ
    // en conséquence plutôt que de laisser saisir ce qui ne s'affichera pas.
    const dejaPris = formatPrice({ price_mode: 'payant', price: Number(priceInput.value) || 0 })
      .replace(/^Payant · /, '').length + 3 // le montant, plus le « · »
    const reste = Math.max(0, BADGE_MAX - dejaPris)
    detailInput.maxLength = reste
    if (detailInput.value.length > reste) detailInput.value = detailInput.value.slice(0, reste)
    tarifEcho.textContent = reste
      ? `Précision facultative, ${reste} caractères : « tarif réduit », « par personne ». ` +
        'Le montant est déjà dans le champ Prix, ne le répétez pas.'
      : 'Le montant occupe déjà toute la place : pas de précision possible.'
  }
  majTarif()

  // --- Restauration sur place (migration 0035) -------------------------------
  // Matthieu, 15/10/2026 : l'organisateur peut annoncer les FOOD TRUCKS
  // présents — choisis dans la liste des fiches validées, jamais tapés — et/ou
  // dire qu'on mange sur place, avec un menu plat par plat et/ou sa photo.
  // Tout allume le badge « Food sur place » de l'Agenda.
  const restoWrap = el('div', 'form__field resto')
  restoWrap.appendChild(el('span', 'form__label', 'Restauration sur place'))
  const restoChoix = el('div', 'choix')
  const restoNon = el('button', 'choix__option', 'Non')
  restoNon.type = 'button'
  const restoOui = el('button', 'choix__option', 'Oui, on peut manger sur place')
  restoOui.type = 'button'
  restoChoix.append(restoNon, restoOui)
  restoWrap.appendChild(restoChoix)
  const restoCorps = el('div', 'resto__corps')
  restoWrap.appendChild(restoCorps)

  let resto = Boolean(init.restauration || init.food_trucks?.length)
  const trucksChoisis = new Set()
  let photoMenu = null // nouveau fichier
  let retirerMenu = false

  // 1. Les food trucks — la liste des fiches validées, à cocher.
  restoCorps.appendChild(el('span', 'form__label', 'Food trucks présents'))
  const trucksListe = el('div', 'choix resto__trucks')
  trucksListe.appendChild(el('span', 'form__hint', 'Chargement des food trucks…'))
  restoCorps.appendChild(trucksListe)
  restoCorps.appendChild(
    el('p', 'form__hint', 'Seuls les food trucks inscrits et validés sur Armana apparaissent ici. Ils peuvent retirer la mention depuis leur planning.')
  )
  let trucksCharges = false
  async function chargerTrucks() {
    if (trucksCharges) return
    trucksCharges = true
    const [liste, deja] = await Promise.all([
      foodTrucksValides(),
      existing ? foodTrucksAnnonces(existing.id) : Promise.resolve([]),
    ])
    deja.forEach((id) => trucksChoisis.add(id))
    trucksListe.innerHTML = ''
    if (!liste.length) {
      trucksListe.appendChild(el('span', 'form__hint', 'Aucun food truck n’est encore inscrit sur Armana.'))
      return
    }
    for (const t of liste) {
      const b = el('button', 'choix__option', t.name + (t.cuisine ? ` · ${t.cuisine}` : ''))
      b.type = 'button'
      b.classList.toggle('is-active', trucksChoisis.has(t.id))
      b.addEventListener('click', () => {
        if (trucksChoisis.has(t.id)) trucksChoisis.delete(t.id)
        else if (trucksChoisis.size < 6) trucksChoisis.add(t.id)
        b.classList.toggle('is-active', trucksChoisis.has(t.id))
      })
      trucksListe.appendChild(b)
    }
  }

  // 2. Le menu, plat par plat, et/ou sa photo.
  const menuResto = menuEditeur(init.restauration_menu, { titre: 'Menu (facultatif)' })
  restoCorps.appendChild(menuResto.wrap)
  const photoMenuWrap = el('div', 'form__field')
  photoMenuWrap.appendChild(el('span', 'form__label', 'Photo du menu (facultatif)'))
  const photoMenuApercu = el('div', 'fiche-edit-photo')
  const photoMenuImg = el('img')
  photoMenuImg.alt = ''
  if (init.menu_photo_url) photoMenuImg.src = init.menu_photo_url
  else photoMenuApercu.classList.add('fiche-edit-photo--vide')
  photoMenuApercu.append(photoMenuImg, el('span', 'fiche-edit-photo__invite', 'Toucher pour choisir une photo'))
  const photoMenuInput = el('input')
  photoMenuInput.type = 'file'
  photoMenuInput.accept = 'image/*'
  photoMenuInput.hidden = true
  const photoMenuAide = el('span', 'form__hint', 'Ardoise, carte, tableau des prix…')
  const photoMenuRetirer = el('button', 'btn btn--ghost btn--sm', 'Retirer cette photo')
  photoMenuRetirer.type = 'button'
  photoMenuRetirer.hidden = !init.menu_photo_url
  photoMenuWrap.append(photoMenuApercu, photoMenuInput, photoMenuAide, photoMenuRetirer)
  restoCorps.appendChild(photoMenuWrap)
  photoMenuApercu.addEventListener('click', () => photoMenuInput.click())
  photoMenuInput.addEventListener('change', async () => {
    const brut = photoMenuInput.files?.[0]
    if (!brut) return
    try {
      const f = await toDisplayableFile(brut, (etape) => (photoMenuAide.textContent = etape))
      photoMenu = f
      retirerMenu = false
      photoMenuImg.src = URL.createObjectURL(f)
      photoMenuApercu.classList.remove('fiche-edit-photo--vide')
      photoMenuRetirer.hidden = false
      photoMenuAide.textContent = 'Elle sera envoyée à la publication.'
    } catch (err) {
      photoMenuAide.textContent = 'Photo illisible : ' + err.message
    }
  })
  photoMenuRetirer.addEventListener('click', () => {
    photoMenu = null
    retirerMenu = Boolean(init.menu_photo_path)
    photoMenuImg.removeAttribute('src')
    photoMenuApercu.classList.add('fiche-edit-photo--vide')
    photoMenuRetirer.hidden = true
  })

  function majResto() {
    restoNon.classList.toggle('is-active', !resto)
    restoOui.classList.toggle('is-active', resto)
    restoCorps.hidden = !resto
    if (resto) chargerTrucks()
  }
  restoNon.addEventListener('click', () => {
    resto = false
    majResto()
  })
  restoOui.addEventListener('click', () => {
    resto = true
    majResto()
  })
  majResto()

  // Localisation : NOM DU LIEU (facultatif) + COMMUNE (choisie dans la liste
  // officielle) + point sur la mini-carte.
  // ⚠ DEMANDE DE MATTHIEU (15/10/2026) : un seul champ « Adresse » libre
  // donnait sur l'Agenda tantôt « 04300 », tantôt « Mane », tantôt « Théâtre
  // La Rirette ». La commune se CHOISIT désormais, le nom du lieu est à part.
  const locWrap = el('div', 'form__field')
  locWrap.appendChild(el('span', 'form__label', 'Nom du lieu'))
  const placeInput = el('input', 'form__input')
  placeInput.type = 'text'
  placeInput.maxLength = 120
  placeInput.placeholder = 'Théâtre, salle des fêtes, place du village…'
  locWrap.appendChild(placeInput)
  locWrap.appendChild(
    el('p', 'form__hint', 'Facultatif, mais il aide à trouver : « Théâtre La Rirette », « Salle des fêtes ».')
  )
  locWrap.appendChild(el('span', 'form__label lieu-commune__label', 'Commune *'))
  let communeChoisie = null
  const communeChamp = rechercheCommune({
    onChoix: (c) => {
      communeChoisie = c
      // Une commune choisie à la main recentre la carte sur elle ; on affine
      // ensuite en touchant la carte.
      if (c) setPoint(c.lat, c.lng)
      refreshPreview()
      saveSnapshot()
    },
  })
  locWrap.appendChild(communeChamp.wrap)
  const coordReadout = el('p', 'form__hint', 'Touchez la carte pour placer le lieu exact.')
  locWrap.appendChild(coordReadout)
  const pickMap = el('div', 'map map--pick')
  locWrap.appendChild(pickMap)

  /** L'adresse écrite, recomposée : « Théâtre La Rirette, 04300 Mane ».
   *  Elle reste en base pour les anciens téléphones, l'itinéraire et le partage. */
  function adresseComposee() {
    const c = communeChoisie
    return [placeInput.value.trim(), c ? [c.cp, c.nom].filter(Boolean).join(' ') : ''].filter(Boolean).join(', ')
  }

  /** Pré-remplit la commune (et le nom du lieu) d'un événement existant, d'un
   *  brouillon importé, ou de la fiche « lieu culturel » de l'auteur. */
  async function preRemplirLieu() {
    let communes
    try {
      communes = await chargerCommunes()
    } catch {
      return
    }
    const lat = Number(init.lat)
    const lng = Number(init.lng)
    if (init.city || init.address) {
      const c =
        (init.city && communes.find((x) => x.nom === init.city)) ||
        communeDansLeTexte(communes, init.address, lat, lng) ||
        communeLaPlusProche(communes, lat, lng)
      if (c && !communeChoisie) {
        communeChoisie = c
        communeChamp.choisir(c, true)
        // Message importé : une ville, pas encore de point.
        if (state.lat == null) setPoint(c.lat, c.lng)
      }
      if (init.place_name) placeInput.value = init.place_name
      else if (!init.city && init.address && c) {
        // Ancien événement : ce qui précède le code postal et la commune
        // devient le nom du lieu (« Chapelle St François, Couvent… »).
        const reste = init.address
          .replace(/\b\d{5}\b/g, '')
          .replace(new RegExp(c.nom.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'), 'i'), '')
          .replace(/[\s,]+$/g, '')
          .replace(/^[\s,]+/g, '')
          .trim()
        if (reste) placeInput.value = reste
      }
    } else if (!existing) {
      // Nouvel événement d'un lieu culturel : son nom et sa commune d'office.
      const fiche = await getMaFiche().catch(() => null)
      if (fiche?.kind === 'lieu' && !placeInput.value && !communeChoisie) {
        placeInput.value = fiche.name
        const c =
          communeDansLeTexte(communes, fiche.address, fiche.lat, fiche.lng) ||
          communeLaPlusProche(communes, fiche.lat, fiche.lng)
        if (c) {
          communeChoisie = c
          communeChamp.choisir(c, true)
          if (state.lat == null) setPoint(fiche.lat ?? c.lat, fiche.lng ?? c.lng)
        }
      }
    }
    refreshPreview()
  }

  // --- Photo(s) -------------------------------------------------------------
  // Un événement sur plusieurs jours peut avoir une affiche par journée : on
  // ouvre autant d'emplacements que de dates annoncées. La photo de
  // l'emplacement N illustrera le jour N dans l'agenda.
  const fPhoto = el('div', 'form__field')
  fPhoto.appendChild(el('span', 'form__label', 'Photo (optionnel)'))
  const slotsBox = el('div', 'photo-slots')
  fPhoto.appendChild(slotsBox)
  const photoHint = el('p', 'form__hint')
  fPhoto.appendChild(photoHint)
  if (sharedPhoto) {
    fPhoto.appendChild(
      el('p', 'form__hint', `📷 Photo importée depuis le partage. Choisissez un fichier pour la remplacer.`)
    )
  } else if (existing?.photo_url) {
    fPhoto.appendChild(el('p', 'form__hint', 'Une photo existe déjà ; en choisir une nouvelle la remplace.'))
  }

  /** Une entrée par jour : { file, crop }. Les trous sont permis. */
  const photos = []
  let slotActif = 0
  let slots = []

  /** Nombre d'affiches proposées = nombre de jours annoncés (borné). */
  function joursAnnonces() {
    // Un événement récurrent peut compter vingt occurrences : une affiche par
    // occurrence n'aurait aucun sens, on en reste à une seule.
    if (recurInput.checked) return 1
    const d = fStart.input.value ? new Date(fStart.input.value) : null
    const f = fEnd.input.value ? new Date(fEnd.input.value) : null
    if (!d || !f || Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return 1
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
    const n = Math.round((jour(f) - jour(d)) / 86400000) + 1
    // Garde-fou : au-delà, on enverrait des dizaines de photos pour un seul
    // événement, ce que la règle de stockage du plan gratuit ne supporte pas.
    return Math.min(Math.max(1, n), 10)
  }

  /** Le cadrage en cours appartient à l'emplacement affiché : le conserver. */
  function memoriserCadrage() {
    if (framingEnabled && photos[slotActif]) photos[slotActif].crop = framer.getCrop()
  }

  async function chargerDansApercu(i) {
    slotActif = i
    try {
      await framer.setFile(photos[i].file)
      framingEnabled = true
      previewMedia.classList.remove('poster-card__media--empty')
      refreshPreview()
    } catch (e) {
      framingEnabled = false
      frameHint.textContent = 'Cette image n’a pas pu être lue : ' + e.message
    }
  }

  function construireEmplacements() {
    const n = joursAnnonces()
    if (slots.length === n) return
    slotsBox.innerHTML = ''
    slots = []
    const debut = fStart.input.value ? new Date(fStart.input.value) : null
    for (let i = 0; i < n; i++) {
      const slot = el('div', 'photo-slot')
      if (n > 1 && debut) {
        const d = new Date(debut)
        d.setDate(d.getDate() + i)
        slot.appendChild(el('span', 'photo-slot__jour', `Jour ${i + 1} · ${formatJourMois(d)}`))
      }
      const input = el('input', 'form__input')
      input.type = 'file'
      input.accept = 'image/*'
      input.addEventListener('change', async () => {
        const brut = input.files?.[0]
        if (!brut) return
        memoriserCadrage()
        try {
          // ⚠ Convertir AVANT de toucher au cadreur : celui-ci affiche le
          // fichier tel quel et échoue sur un HEIC, format qu'aucun navigateur
          // ne décode hors Safari.
          const file = await toDisplayableFile(brut, (etape) => {
            frameHint.textContent = etape
          })
          photos[i] = { file, crop: null }
          await chargerDansApercu(i)
        } catch (e) {
          framingEnabled = false
          frameHint.textContent = 'Photo non utilisable : ' + e.message
        }
      })
      slot.appendChild(input)
      slotsBox.appendChild(slot)
      slots.push(input)
    }
    photoHint.textContent =
      n > 1
        ? `Une affiche par journée. Les jours laissés vides reprennent celle du premier jour.`
        : ''
  }

  // --- Aperçu « tel qu'il apparaîtra dans l'agenda » ---
  // Exactement la carte de l'Agenda (date à gauche sur fond de couleur, photo au
  // centre, informations à droite). La photo se cadre au doigt : ce que l'auteur
  // voit ici est ce que la vignette affichera.
  const preview = el('div', 'photo-preview')
  preview.appendChild(el('p', 'form__label', 'Aperçu dans l’agenda'))
  const previewCard = posterEventCard(previewEventData(), {
    preview: true,
    showGem: false,
    index: 0,
  })
  preview.appendChild(previewCard)
  const frameHint = el('p', 'form__hint photo-preview__hint', '')
  preview.appendChild(frameHint)

  const frameTools = el('div', 'photo-preview__tools')
  const zoomOut = toolButton('−', 'Dézoomer')
  const zoomIn = toolButton('+', 'Zoomer')
  // Bascule « photo entière ⇄ remplir la carte » : c'est elle qui débloque le
  // déplacement latéral d'une affiche portrait (voir photoFramer.js).
  const wholeToggle = el('button', 'btn btn--ghost btn--sm', 'Photo entière')
  wholeToggle.type = 'button'
  const resetFrame = el('button', 'btn btn--ghost btn--sm', 'Recadrer')
  resetFrame.type = 'button'
  frameTools.appendChild(zoomOut)
  frameTools.appendChild(zoomIn)
  frameTools.appendChild(wholeToggle)
  frameTools.appendChild(resetFrame)
  preview.appendChild(frameTools)
  fPhoto.appendChild(preview)

  const previewMedia = previewCard.querySelector('.poster-card__media')
  let previewImg = previewMedia.querySelector('img')
  if (!previewImg) {
    previewImg = el('img')
    previewImg.alt = ''
    previewMedia.appendChild(previewImg)
  }
  const framer = createPhotoFramer(previewMedia, previewImg)
  let framingEnabled = false

  // Toucher l'aperçu ouvre le sélecteur de photo (demande de Matthieu) : c'est
  // le geste que tout le monde tente en premier. Le champ « Parcourir » reste
  // en dessous — il est le seul chemin au clavier, et certains le cherchent.
  // ⚠ Une fois une photo posée, l'aperçu sert au CADRAGE (glisser/pincer) :
  // ouvrir le sélecteur à ce moment-là volerait le geste. On ne l'ouvre donc
  // que tant que l'emplacement est vide.
  previewMedia.classList.add('poster-card__media--choisir')
  previewMedia.setAttribute('role', 'button')
  previewMedia.setAttribute('tabindex', '0')
  previewMedia.setAttribute('aria-label', 'Ajouter une photo')
  const ouvrirSelecteur = () => {
    if (photos[slotActif]) return
    slots[slotActif]?.click()
  }
  previewMedia.addEventListener('click', ouvrirSelecteur)
  previewMedia.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ouvrirSelecteur()
    }
  })

  /** Données de l'événement telles que saisies, pour l'aperçu. */
  function previewEventData() {
    const startsAt = fStart?.input.value ? new Date(fStart.input.value) : new Date()
    return {
      id: 'preview',
      title: fTitle?.input.value.trim() || 'Titre de votre événement',
      starts_at: startsAt.toISOString(),
      address: adresseComposee() || 'Lieu à préciser',
      ville: communeChoisie?.nom || 'Commune ?',
      category: fCategory?.input.value || 'Catégorie ?',
      price_mode: tarif,
      is_paid: tarif === 'payant',
      // Le montant vaut pour « payant » (le prix) ET « libre » (le minimum).
      price: tarif !== 'gratuit' && priceInput?.value ? Number(priceInput.value) : null,
      price_detail: tarif === 'payant' ? detailInput?.value.trim() || '' : '',
      au_chapeau: chapeau,
      thumb_url: null,
    }
  }

  /** Met à jour les textes de l'aperçu sans reconstruire la carte (le cadrage
   *  de la photo, lui, doit survivre à chaque frappe au clavier). */
  function refreshPreview() {
    majEchoDate()
    majRecurrence()
    // Le nombre d'emplacements suit les dates saisies : allonger l'événement
    // d'un jour ouvre aussitôt un emplacement de plus.
    construireEmplacements()
    const ev = previewEventData()
    const d = new Date(ev.starts_at)
    setText('.poster-card__day', String(d.getDate()).padStart(2, '0'))
    setText('.poster-card__month', PREVIEW_MONTH.format(d).replace('.', '').toUpperCase())
    setText('.poster-card__time', formatTime(ev.starts_at))
    setText('.poster-card__category', ev.category)
    setText('.poster-card__title', ev.title)
    // Comme sur l'Agenda : la commune seule.
    setText('.poster-card__place', ev.ville)
    setText('.poster-card__price', formatPriceCourt(ev))
    frameTools.style.display = framingEnabled ? '' : 'none'
    syncFrameUi()
  }

  /** Message d'aide et libellé de la bascule, selon le cadrage courant.
   *  Une affiche portrait « qui remplit la carte » n'a AUCUN jeu horizontal :
   *  plutôt que de laisser croire à un bug, on dit quoi faire pour l'obtenir. */
  function syncFrameUi() {
    if (!framingEnabled) {
      frameHint.textContent = 'Choisissez une photo pour la cadrer ici.'
      return
    }
    const { pannableX, pannableY, whole } = framer.info()
    wholeToggle.textContent = whole ? 'Remplir la carte' : 'Photo entière'
    if (pannableX && pannableY) {
      frameHint.textContent = 'Glissez la photo dans tous les sens · pincez (ou molette) pour zoomer.'
    } else if (pannableY) {
      frameHint.textContent =
        'Glissez la photo vers le haut ou le bas. Pour la déplacer aussi vers la ' +
        'gauche ou la droite, touchez « Photo entière ».'
    } else if (pannableX) {
      frameHint.textContent = 'Glissez la photo vers la gauche ou la droite · pincez pour zoomer.'
    } else {
      frameHint.textContent = 'La photo tient entièrement dans la carte. Zoomez (+) pour la recadrer.'
    }
  }

  function setText(sel, value) {
    const node = previewCard.querySelector(sel)
    if (node) node.textContent = value
  }

  // (Le choix d'un fichier est géré par emplacement, dans construireEmplacements.)

  zoomIn.addEventListener('click', () => {
    framer.zoomBy(1.2)
    syncFrameUi()
  })
  zoomOut.addEventListener('click', () => {
    framer.zoomBy(1 / 1.2)
    syncFrameUi()
  })
  wholeToggle.addEventListener('click', () => {
    if (framer.info().whole) framer.fillCard()
    else framer.fitWhole()
    syncFrameUi()
  })
  resetFrame.addEventListener('click', () => {
    framer.reset()
    syncFrameUi()
  })
  // Le glissement change aussi le jeu disponible : on tient le message à jour.
  previewMedia.addEventListener('pointerup', syncFrameUi)

  // Photo reçue par partage (WhatsApp) : on la charge d'emblée dans l'aperçu,
  // en la convertissant au besoin — un partage depuis un iPhone arrive en HEIC.
  // Elle rejoint le premier emplacement, donc le chemin normal d'envoi.
  if (sharedPhoto) {
    toDisplayableFile(sharedPhoto, (etape) => {
      frameHint.textContent = etape
    })
      .then(async (f) => {
        photos[0] = { file: f, crop: null }
        await chargerDansApercu(0)
      })
      .catch((e) => {
        frameHint.textContent = 'Photo non utilisable : ' + e.message
      })
  }

  const submit = el('button', 'btn btn--primary btn--block')
  submit.type = 'submit'
  submit.textContent = existing ? 'Enregistrer les modifications' : 'Publier'
  const msg = el('p', 'form__msg')

  // --- Parcours guidé (création) ou page unique (modification) -------------
  // Publier pour la première fois est intimidant : on avance par petites
  // étapes, l'aperçu se complétant au fil de la saisie. Corriger une faute de
  // frappe, en revanche, ne doit pas imposer de retraverser quatre écrans —
  // d'où la page unique en modification (décision de Matthieu).
  // ⚠ DÉCLARÉE ICI, ET PAS PLUS BAS. `montrer()` la lit, et `montrer(0)`
  // s'exécute avant le bloc de la carte : une déclaration plus tardive la
  // laisserait en zone morte temporelle et jetterait une ReferenceError.
  let map = null

  const ETAPES = [
    { titre: 'L’essentiel', champs: [fPhoto, fTitle.wrap, fCategory.wrap] },
    { titre: 'Quand', champs: [fDesc.wrap, apercuDesc, fStart.wrap, fEnd.wrap, recurWrap] },
    { titre: 'Où', champs: [locWrap] },
    { titre: 'Détails', champs: [paidWrap, restoWrap, fContact.wrap] },
  ]
  const guide = !existing

  let pages = []
  let pageActive = 0
  const points = el('div', 'etapes-points')
  const barreEtapes = el('div', 'etapes-barre')
  const precedent = el('button', 'btn btn--ghost', 'Retour')
  precedent.type = 'button'
  const suivant = el('button', 'btn btn--primary', 'Continuer')
  suivant.type = 'button'

  if (guide) {
    for (const [i, etape] of ETAPES.entries()) {
      const page = el('div', 'etape')
      page.appendChild(el('h2', 'etape__titre', etape.titre))
      for (const champ of etape.champs) page.appendChild(champ)
      form.appendChild(page)
      pages.push(page)

      const pt = el('span', 'etapes-points__pt')
      pt.title = `Étape ${i + 1} : ${etape.titre}`
      points.appendChild(pt)
    }

    barreEtapes.appendChild(precedent)
    barreEtapes.appendChild(suivant)
    form.appendChild(points)
    form.appendChild(barreEtapes)
    form.appendChild(submit)
    form.appendChild(msg)

    /** Affiche l'étape n et remet les commandes en cohérence. */
    const montrer = (n) => {
      pageActive = Math.max(0, Math.min(ETAPES.length - 1, n))
      pages.forEach((p, i) => (p.hidden = i !== pageActive))
      points
        .querySelectorAll('.etapes-points__pt')
        .forEach((p, i) => p.classList.toggle('is-active', i === pageActive))
      const dernier = pageActive === ETAPES.length - 1
      precedent.hidden = pageActive === 0
      suivant.hidden = dernier
      // Le bouton « Publier » n'apparaît qu'à la fin : le voir dès la première
      // étape laisserait croire qu'on peut publier un formulaire à moitié vide.
      submit.hidden = !dernier
      // ⚠ LA MINI-CARTE EST CONSTRUITE DANS UNE ÉTAPE MASQUÉE. Leaflet y
      // mesure un conteneur de taille NULLE et ne charge donc aucune tuile ;
      // rien ne le lui redisait quand l'étape s'affichait enfin, d'où une
      // carte qui « a du mal à se charger ». On le lui redit à chaque
      // changement d'étape — c'est la vraie cause, les tuiles n'y étaient
      // pour rien.
      if (map) setTimeout(() => map.invalidateSize(), 0)
      wrap.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    precedent.addEventListener('click', () => montrer(pageActive - 1))
    suivant.addEventListener('click', () => {
      // Le navigateur signale lui-même les champs obligatoires vides ; sans
      // cela on pouvait arriver à la dernière étape et découvrir seulement là
      // que le titre manquait.
      const page = pages[pageActive]
      const manquant = [...page.querySelectorAll('input, select, textarea')].find(
        (c) => !c.checkValidity()
      )
      if (manquant) {
        manquant.reportValidity()
        return
      }
      montrer(pageActive + 1)
    })
    montrer(0)
  } else {
    form.appendChild(fPhoto)
    form.appendChild(fTitle.wrap)
    form.appendChild(fCategory.wrap)
    form.appendChild(fDesc.wrap)
    form.appendChild(apercuDesc)
    // Dates en pleine largeur (empilées) : en 2 colonnes le champ datetime
    // était trop étroit sur mobile (« croupi »).
    form.appendChild(fStart.wrap)
    form.appendChild(fEnd.wrap)
    form.appendChild(recurWrap)
    form.appendChild(locWrap)
    form.appendChild(paidWrap)
    form.appendChild(fContact.wrap)
    form.appendChild(submit)
    form.appendChild(msg)
  }
  wrap.appendChild(form)

  // --- Mini-carte de sélection ---
  const state = {
    lat: init.lat ?? null,
    lng: init.lng ?? null,
  }
  let marker = null

  // --- Brouillon persistant (création uniquement) ---
  // Sur mobile, quitter l'app peut recharger la page au retour : on sauvegarde la
  // saisie en continu (localStorage) et on la restaure. Vidé à la publication.
  const FORM_KEY = 'rezo-publish-form'
  function saveSnapshot() {
    if (existing) return
    try {
      localStorage.setItem(
        FORM_KEY,
        JSON.stringify({
          title: fTitle.input.value,
          category: fCategory.input.value,
          description: fDesc.input.value,
          startLocal: fStart.input.value,
          endLocal: fEnd.input.value,
          tarif,
          chapeau,
          price: priceInput.value,
          priceDetail: detailInput.value,
          placeName: placeInput.value,
          commune: communeChoisie,
          lat: state.lat,
          lng: state.lng,
        })
      )
    } catch {
      /* stockage indisponible : sans effet */
    }
  }
  if (!existing && !draft) {
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem(FORM_KEY) || 'null')
    } catch {
      saved = null
    }
    // On ne restaure que s'il y a une vraie saisie (titre ou description ou point).
    if (saved && (saved.title || saved.description || saved.lat != null)) {
      // ⚠ ON N'ECRASE QUE CE QUI EXISTE. Ces lignes affectaient la valeur
      // enregistrée même vide : un brouillon sans date effaçait le début
      // pré-rempli sur aujourd'hui, et le champ redevenait vide — donc à
      // nouveau exposé à l'erreur d'année qu'il servait à écarter.
      if (saved.title) fTitle.input.value = saved.title
      if (saved.category) fCategory.input.value = saved.category
      if (saved.description) {
        fDesc.input.value = saved.description
        majApercuDesc()
      }
      if (saved.startLocal) fStart.input.value = saved.startLocal
      if (saved.endLocal) fEnd.input.value = saved.endLocal
      // `isPaid` : brouillon d'avant la migration 0028, encore en mémoire sur
      // les téléphones. On le relit plutôt que de perdre la saisie.
      tarif = saved.tarif || (saved.isPaid ? 'payant' : 'gratuit')
      chapeau = Boolean(saved.chapeau)
      if (saved.price) priceInput.value = saved.price
      if (saved.priceDetail) detailInput.value = saved.priceDetail
      majTarif()
      if (saved.placeName) placeInput.value = saved.placeName
      if (saved.commune?.nom) {
        communeChoisie = saved.commune
        communeChamp.choisir(saved.commune, true)
      } else if (saved.address) {
        // Brouillon d'avant le choix de la commune : on la retrouvera dedans.
        init.address = saved.address
      }
      if (saved.lat != null) {
        state.lat = saved.lat
        state.lng = saved.lng
      }
      const note = el('p', 'demo-note')
      note.textContent = '📝 Brouillon restauré — votre saisie a été conservée. '
      const clearBtn = el('button', 'btn btn--link btn--sm', 'Recommencer à zéro')
      clearBtn.type = 'button'
      clearBtn.addEventListener('click', () => {
        try {
          localStorage.removeItem(FORM_KEY)
        } catch {}
        location.reload()
      })
      note.appendChild(clearBtn)
      wrap.insertBefore(note, form)
    }
  }
  form.addEventListener('input', () => {
    refreshPreview()
    clearTimeout(saveSnapshot._t)
    saveSnapshot._t = setTimeout(saveSnapshot, 300)
  })
  form.addEventListener('change', () => {
    refreshPreview()
    saveSnapshot()
  })
  refreshPreview()
  if (draft) saveSnapshot() // l'import depuis un message est lui aussi protégé

  function setPoint(lat, lng, recenter = true) {
    state.lat = lat
    state.lng = lng
    saveSnapshot() // le lieu fait partie du brouillon persistant
    coordReadout.textContent = `Coordonnées : ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    if (!map) return
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setPoint(p.lat, p.lng, false)
      })
    } else {
      marker.setLatLng([lat, lng])
    }
    if (recenter) map.setView([lat, lng], 14)
  }

  // ⚠ setTimeout ET NON requestAnimationFrame. rAF est GELÉ quand l'onglet
  // n'est pas au premier plan : la carte ne se construisait alors jamais. Même
  // correction que sur la carte principale, où le piège avait déjà mordu.
  setTimeout(() => {
    const start = state.lat != null ? [state.lat, state.lng] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]
    map = L.map(pickMap, {
      // ⚠ SANS PLANCHER DE ZOOM, un dézoom ramenait la carte du monde : des
      // centaines de tuiles à charger d'un coup, pour choisir une adresse à
      // vingt kilomètres. C'est ce qui la rendait poussive. 7 montre déjà tout
      // le territoire couvert.
      minZoom: 7,
    }).setView(start, state.lat != null ? 14 : 10)
    // ⚠ MÊME SOURCE DE TUILES QUE LA CARTE PRINCIPALE. Celle-ci était restée
    // sur les sous-domaines `{s}.` abandonnés par OpenStreetMap, qui répondent
    // plus lentement. `keepBuffer` garde une couronne de tuiles autour de
    // l'écran, ce qui évite les carrés gris au déplacement.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      keepBuffer: 3,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map)
    if (state.lat != null) setPoint(state.lat, state.lng)
    map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, false))
    setTimeout(() => map.invalidateSize(), 100)
    // La commune (et le nom du lieu) d'un événement existant, d'un message
    // importé ou de la fiche de l'auteur. Plus de géocodage Nominatim : la
    // commune choisie donne le point, la carte l'affine.
    preRemplirLieu()
  })

  // --- Soumission ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.className = 'form__msg'
    msg.textContent = ''

    const title = fTitle.input.value.trim()
    const starts_at = fStart.input.value ? new Date(fStart.input.value).toISOString() : null
    const ends_at = fEnd.input.value ? new Date(fEnd.input.value).toISOString() : null

    if (!title) return fail('Le titre est requis.')
    if (!fCategory.input.value) return fail('Choisissez une catégorie.')
    if (!starts_at) return fail('La date de début est requise.')

    // Garde-fou sur l'année. On demande confirmation plutôt que de bloquer : un
    // événement peut légitimement être annoncé très à l'avance, et une date
    // passée peut être corrigée après coup sur un événement existant.
    const debut = new Date(starts_at)
    if (
      moisDEcart(debut) >= 12 &&
      !confirm(
        `Vous avez indiqué :\n\n${DATE_LONGUE.format(debut)}\n\n` +
          'C’est dans un an ou plus. Est-ce bien l’année voulue ?'
      )
    ) {
      return
    }
    if (
      !isUpcoming({ starts_at, ends_at }) &&
      !confirm(
        `Vous avez indiqué :\n\n${DATE_LONGUE.format(debut)}\n\n` +
          'Cette date est déjà passée : l’événement n’apparaîtra pas dans l’agenda. ' +
          'Enregistrer quand même ?'
      )
    ) {
      return
    }
    if (!communeChoisie) return fail('Choisissez la commune dans la liste.')
    if (state.lat == null || state.lng == null)
      return fail('Placez le lieu sur la carte (touchez la carte).')
    if (ends_at && ends_at < starts_at) return fail('La fin est avant le début.')

    // Répétition. Deux formes exclusives : les jours de la semaine sur une
    // période, ou la liste des dates. Sans jour ni borne, l'hebdomadaire
    // remplirait le calendrier indéfiniment — la base refuse d'ailleurs les
    // deux cas.
    const parDates = recurInput.checked && rythme !== 'semaine'
    const recurrence = recurInput.checked && !parDates ? joursChoisis() : []
    const series = parDates ? datesChoisies() : []
    if (recurInput.checked) {
      if (parDates) {
        if (series.length < 2)
          return fail('Une série demande au moins deux dates. Ajoutez-les ou changez de rythme.')
      } else {
        if (!recurrence.length) return fail('Choisissez au moins un jour de répétition.')
        if (!ends_at)
          return fail('Un événement qui se répète doit avoir une date de fin de période.')
      }
    }

    const payload = {
      title,
      description: fDesc.input.value.trim(),
      starts_at,
      ends_at,
      // ⚠ `price_mode` fait autorité ; `is_paid` reste envoyé pour rester
      // compatible avec la fonction d'avant la migration 0028.
      price_mode: tarif,
      is_paid: tarif === 'payant',
      // Le montant vaut pour « payant » (le prix) ET « libre » (le minimum) ;
      // la précision en texte est réservée au payant.
      price: tarif !== 'gratuit' && priceInput.value ? Number(priceInput.value) : null,
      price_detail: tarif === 'payant' ? detailInput.value.trim() : '',
      au_chapeau: chapeau,
      lat: state.lat,
      lng: state.lng,
      address: adresseComposee(),
      // Migration 0035 : le lieu et la commune, séparés.
      place_name: placeInput.value.trim(),
      city: communeChoisie.nom,
      // Restauration sur place (migration 0035).
      restauration: resto,
      restauration_menu: resto ? menuResto.valeur() : '',
      category: fCategory.input.value,
      recur_days: recurrence,
      recur_dates: series,
      contact: fContact.input.value.trim(),
    }

    submit.disabled = true
    submit.textContent = 'Envoi…'
    try {
      const row = existing
        ? await updateEvent(existing.id, payload)
        : await createEvent(payload)
      // Photos : un emplacement par journée annoncée, plus la photo reçue par
      // partage (WhatsApp) si aucun choix manuel n'a été fait.
      memoriserCadrage()
      const aEnvoyer = []
      photos.forEach((p, i) => {
        if (p?.file) aEnvoyer.push({ file: p.file, crop: p.crop, position: i })
      })
      // (La photo reçue par partage a déjà rejoint le premier emplacement, une
      // fois convertie : inutile de la reprendre ici, et surtout on ne veut pas
      // envoyer le fichier BRUT si la conversion a échoué.)
      if (aEnvoyer.length) {
        try {
          // Le cadrage choisi dans l'aperçu est appliqué à la vignette.
          await uploadEventPhotos(row.id, aEnvoyer)
        } catch (pe) {
          // Ne JAMAIS avaler cet échec en silence : l'auteur croyait sa photo
          // publiée, et un problème de droits sur le Storage passait inaperçu.
          console.warn('[Armana] Photo non envoyée :', pe.message)
          fail(
            'L’événement est bien enregistré, mais la photo n’a pas pu être envoyée (' +
              pe.message +
              '). Vous pourrez la rajouter depuis « Mes événements ».'
          )
          submit.disabled = false
          submit.textContent = 'Continuer sans la photo'
          submit.type = 'button'
          submit.addEventListener('click', () => navigate('/mes-evenements'), { once: true })
          return
        }
      }
      // Food trucks annoncés et photo du menu. ⚠ Jamais bloquant : l'événement
      // est déjà enregistré, un échec ici (migration 0035 absente, réseau) ne
      // doit pas faire croire que rien n'est parti.
      try {
        if (trucksCharges || !resto) await synchroniserFoodTrucks(row.id, resto ? [...trucksChoisis] : [])
        if (resto && photoMenu) await envoyerPhotoMenu(row.id, photoMenu)
        else if ((!resto || retirerMenu) && init.menu_photo_path) {
          await retirerPhotoMenu(row.id, init.menu_photo_path)
        }
      } catch (re) {
        console.warn('[Armana] Restauration non enregistrée :', re.message)
      }
      // Publication réussie : le brouillon persistant n'a plus lieu d'être.
      if (!existing) {
        try {
          localStorage.removeItem(FORM_KEY)
        } catch {}
      }
      navigate('/mes-evenements')
    } catch (err) {
      fail(err.message)
      submit.disabled = false
      submit.textContent = existing ? 'Enregistrer les modifications' : 'Publier'
    }

    function fail(m) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = m
    }
  })

  return wrap
}

// --- Champs ---
/**
 * La DATE seule d'un champ `datetime-local`, en Date locale calée à MIDI.
 *
 * ⚠ Midi, et jamais minuit : un calcul de dates qui traverse un changement
 * d'heure décalerait une date de minuit à la veille 23 h, et le jour affiché
 * ne serait plus le bon.
 */
function lireDateChamp(input) {
  const v = (input?.value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [a, m, j] = v.split('-').map(Number)
  return new Date(a, m - 1, j, 12, 0, 0, 0)
}

/** Aujourd'hui, 20 h, au format attendu par `datetime-local`. */
function debutParDefaut() {
  const d = new Date()
  d.setHours(20, 0, 0, 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`
}

function textField(label, type, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = type
  if (value != null) input.value = value
  wrap.appendChild(input)
  return { wrap, input }
}

function textareaField(label, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('textarea', 'form__input form__textarea')
  input.rows = 4
  if (value != null) input.value = value
  wrap.appendChild(input)
  return { wrap, input }
}

function selectField(label, options, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('select', 'form__input')
  // Option vide EN TÊTE : sans elle, le premier choix de la liste (« Musique »)
  // était retenu par défaut et tous les événements non renseignés atterrissaient
  // en Musique — filtres et badges faussés dès la première soirée.
  const empty = el('option', null, '— Choisir une catégorie —')
  empty.value = ''
  input.appendChild(empty)
  for (const o of options) {
    const opt = el('option', null, o)
    opt.value = o
    if (o === value) opt.selected = true
    input.appendChild(opt)
  }
  if (!options.includes(value)) empty.selected = true
  wrap.appendChild(input)
  return { wrap, input }
}

/** ISO → valeur d'input datetime-local (heure locale, sans secondes). */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
