// Armana — écran Calendrier (défaut) : en-tête, chips de catégories,
// calendrier mensuel (jours à événements marqués), liste des événements.
import { el, emptyState, formatMonthLabel, formatDateFull, tarifMode } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import {
  appliquerFiltres,
  basculerTarif,
  getDepartementsEffectifs,
  getQuand,
  getTarifs,
  getUnivers,
  joursDeQuand,
  nbFiltresActifs,
  onFilterChange,
  setQuand,
  setUnivers,
} from '../lib/filter.js'
import { UNIVERS } from '../lib/univers.js'
import { ouvrirFiltres } from './filtres.js'
import './enteteAgenda.css'
import './associations.css'
import { dayKey, eventDayKeys, isRecurring, recurrenceDaysLabel } from '../lib/recurrence.js'
import { listApprovedEvents, listGemEventIds } from '../lib/events.js'

// Les jours couverts par un événement (multi-jours ET récurrence) sont calculés
// dans un seul endroit, partagé avec la Carte : src/lib/recurrence.js.

function studioPreviewEvents(seed = {}) {
  const samples = [
    { offset: 0, title: 'Les Inattendus', category: 'Spectacle', address: 'Forcalquier', is_paid: false },
    { offset: 1, title: 'Jazz sous les étoiles', category: 'Concert', address: 'Digne-les-Bains', is_paid: true, price: 12 },
    { offset: 7, title: 'Arts & Paysages', category: 'Randonnée', address: 'Annot', is_paid: false },
    { offset: 8, title: 'Lettres à demain', category: 'Théâtre', address: 'Manosque', is_paid: false },
  ]
  const start = new Date()
  return samples.map((sample, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + sample.offset, 20, 30)
    return {
      ...seed,
      ...sample,
      id: `studio-preview-${index + 1}`,
      starts_at: date.toISOString(),
      ends_at: null,
      status: 'approved',
      _studioPreview: true,
    }
  })
}

export async function viewCalendar() {
  const wrap = el('section', 'screen screen--studio-calendar')

  // --- En-tête Studio Affiche : titre utile + marque ---
  const head = el('header', 'screen-head screen-head--studio')
  // ⚠ « Armana », ET NON « Agenda ». Le nom de l'application n'apparaissait
  // NULLE PART à l'écran : ni ici, ni dans les autres titres, ni dans la barre
  // d'onglets — qui garde « Agenda », puisqu'elle nomme l'onglet, pas l'app.
  // C'est le seul endroit où la marque peut se voir sans rien coûter.
  const title = el('h1', 'screen-title screen-title--studio', 'Armana')
  const logo = el('img')
  logo.src = '/icons/armana-logo.png'
  logo.alt = 'Armana'
  logo.addEventListener('error', () => logo.remove())
  head.appendChild(title)
  // La devise du sticker, sous le nom (en-tête « Signature », enteteAgenda.css).
  head.appendChild(el('p', 'entete-devise', 'L’agenda culturel partagé'))

  // Le bouton du calendrier n'est plus dans l'en-tête : il a sa propre ligne sous
  // le calendrier, et se place donc plus bas dans la vue (juste après `cal`).
  const calendarToggle = el('button', 'studio-calendar-toggle')
  calendarToggle.type = 'button'
  calendarToggle.title = 'Fermer le calendrier'
  calendarToggle.setAttribute('aria-label', 'Fermer le calendrier')
  calendarToggle.setAttribute('aria-expanded', 'true')
  calendarToggle.classList.add('is-open')
  calendarToggle.appendChild(icon('chevronDown'))

  // ⚠ PAS de bouton de partage ici : j'en avais ajouté un « pour la cohérence »,
  // Matthieu l'a fait retirer — l'Agenda est déjà chargé (titre, calendrier,
  // filtres) et c'était mieux avant. Il reste sur Carte, Favoris et Profil.
  head.appendChild(logo)

  // --- Les UNIVERS, sous le titre et AU-DESSUS des filtres rapides ----------
  // (14/11/2026) Culture, Ateliers, Vie locale : un seul à la fois, Culture
  // par défaut (lib/univers.js). Ils prennent LA PLACE de la rangée de styles
  // (« Tous les styles », « Musique »…), à la demande de Matthieu : deux
  // rangées en plus des filtres rapides chargeaient trop l'en-tête. Les styles
  // se choisissent désormais dans le panneau Filtres, où ils se combinent.
  // Même allure que l'ancienne rangée — contour blanc, choisi en jaune —, pour
  // ne pas se confondre avec la barre translucide des filtres rapides.
  const universRow = el('div', 'chips-row chips-row--studio chips-row--cats chips-row--univers')
  universRow.setAttribute('role', 'tablist')
  const universBtns = UNIVERS.map((u) => {
    const b = el('button', 'chip', u.nom)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.dataset.cle = u.cle
    b.addEventListener('click', () => setUnivers(u.cle))
    universRow.appendChild(b)
    return b
  })
  head.appendChild(universRow)
  const paintCats = () => {
    const u = getUnivers()
    for (const b of universBtns) {
      b.classList.toggle('is-active', b.dataset.cle === u)
      b.setAttribute('aria-selected', String(b.dataset.cle === u))
    }
  }
  paintCats()

  // --- Filtres rapides ---
  // ⚠ « Gratuit » et « Tout » ont disparu, et ce n'est pas une perte.
  // Les quatre puces s'EXCLUAIENT : choisir « Gratuit » effaçait « Ce
  // week-end », alors que « gratuit ce week-end » est précisément la question
  // du vendredi soir. Le tarif rejoint donc le panneau, où il se COMBINE.
  // « Tout » devient inutile : re-taper la puce active la relâche, et la ligne
  // de rappel sous l'en-tête porte la remise à zéro quand il y a lieu.
  // « Ce mois-ci » prend la place libérée — une troisième fenêtre de temps
  // naturelle, plutôt qu'un vide.
  // ⚠ CLASSE PROPRE À CETTE RANGÉE. Contrairement à celle des styles, elle
  // ne doit JAMAIS être tronquée : elle ne compte que quatre puces, et on
  // ne devine pas qu'il faut la faire défiler pour en trouver une.
  const chipsRow = el('div', 'chips-row chips-row--studio chips-row--rapides')
  const allChips = []
  // `nature` vaut 'quand' (fenêtre de temps) ou 'tarif' : la rangée porte
  // désormais deux sortes de filtres, qui se COMBINENT — c'était tout l'enjeu.
  const addChip = (label, value, nature = 'quand') => {
    const c = el('button', 'chip', label)
    c.dataset.value = value
    c.dataset.nature = nature
    c.addEventListener('click', () => {
      if (nature === 'tarif') return basculerTarif(value)
      // Les fenêtres de temps désignent une date : on ramène le calendrier sur
      // le mois concerné, sinon les choisir depuis décembre afficherait une
      // liste vide.
      const mois = moisDuFiltre(value)
      setQuand(value)
      if (mois && getQuand() === value) monthCursor = mois
      selectedDay = null
    })
    allChips.push(c)
    chipsRow.appendChild(c)
  }
  /** Mois sur lequel se placer quand une fenêtre de temps est choisie. */
  function moisDuFiltre(value) {
    const now = new Date()
    if (value === 'today' || value === 'month') {
      return new Date(now.getFullYear(), now.getMonth(), 1)
    }
    if (value === 'weekend') {
      const samedi = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      samedi.setDate(samedi.getDate() + ((6 - samedi.getDay() + 7) % 7))
      return new Date(samedi.getFullYear(), samedi.getMonth(), 1)
    }
    return null
  }

  // Le bouton du panneau, avec le nombre de filtres actifs : un filtre qui ne
  // se voit pas est un filtre qu'on oublie, et un agenda vide qu'on ne
  // s'explique pas.
  const boutonFiltres = el('button', 'chip chip--filtres')
  boutonFiltres.type = 'button'
  const libelleFiltres = el('span', null, 'Filtres')
  boutonFiltres.append(libelleFiltres, icon('chevronDown'))
  boutonFiltres.addEventListener('click', () => ouvrirFiltres(() => {}))
  chipsRow.appendChild(boutonFiltres)

  // ⚠ LES FENÊTRES DE TEMPS VIENNENT APRÈS LE BOUTON, et pas l'inverse.
  // La rangée défile horizontalement : placé en dernier, « Filtres » sortait
  // de l'écran sur un téléphone de 375 px — le point d'entrée du panneau à
  // moitié caché. Il reste donc toujours visible, les fenêtres défilent.
  addChip("Aujourd'hui", 'today')
  addChip('Ce week-end', 'weekend')
  // ⚠ « GRATUIT » REVIENT EN PUCE, mais il ne s'exclut plus des dates : il
  // agit sur le TARIF, pas sur la même valeur unique qu'avant. « Gratuit ce
  // week-end » devient donc possible — c'était le défaut de départ.
  // « Ce mois-ci » lui cède la place : le calendrier affiche déjà son mois,
  // la puce ne faisait que répéter ce qui était à l'écran.
  addChip('Gratuit', 'gratuit', 'tarif')

  const paintChips = () => {
    const q = getQuand()
    const t = getTarifs()
    for (const c of allChips) {
      const actif =
        c.dataset.nature === 'tarif' ? t.has(c.dataset.value) : c.dataset.value === q
      c.classList.toggle('is-active', actif)
    }
    const n = nbFiltresActifs()
    libelleFiltres.textContent = n ? `Filtres · ${n}` : 'Filtres'
    boutonFiltres.classList.toggle('is-active', n > 0)
  }
  paintChips()
  head.appendChild(chipsRow)
  wrap.appendChild(head)

  // --- Données ---
  // ⚠ DEPUIS L'OUVERTURE À LA FRANCE, LES DÉPARTEMENTS SONT FILTRÉS EN BASE
  // (`events.dept`, calculé par trigger) : on ne télécharge que ceux affichés.
  // Une retouche des départements dans le panneau relance donc le
  // chargement — voir `rechargerSiBesoin`.
  const studioPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('studio-preview')
  const cleDe = (codes) => [...codes].sort().join(',')
  let cleChargee = cleDe(getDepartementsEffectifs())
  const [approvedEvents, gemIds] = await Promise.all([
    listApprovedEvents(getDepartementsEffectifs()),
    isLoggedIn() ? listGemEventIds() : Promise.resolve(new Set()),
  ])
  let allEvents = studioPreview ? studioPreviewEvents(approvedEvents[0]) : approvedEvents

  /** Recharge les événements si les départements affichés ont changé. */
  async function rechargerSiBesoin() {
    const cle = cleDe(getDepartementsEffectifs())
    if (cle === cleChargee || studioPreview) return false
    cleChargee = cle
    const frais = await listApprovedEvents(getDepartementsEffectifs()).catch(() => null)
    // Une réponse arrivée après un autre changement est périmée : on l'ignore.
    if (!frais || cle !== cleChargee) return false
    allEvents = frais
    return true
  }

  /** Filtres portant sur l'ÉVÉNEMENT lui-même (style, gratuité). */
  // ⚠ Le tarif est filtré par `appliquerFiltres`, et « Gratuit » y veut dire
  // GRATUIT, pas « prix libre » : les deux ont `is_paid` à false, et
  // `tarifMode` est le seul juge.
  const filtered = () => appliquerFiltres(allEvents, tarifMode)

  /** Filtres portant sur le JOUR — appliqués aux occurrences, pas aux événements. */
  // Calcul partagé avec la Carte (lib/filter.js), dimanche compris.
  const joursDuFiltreRapide = joursDeQuand

  /**
   * UNE CARTE PAR JOUR COUVERT. Un festival du 7 au 9 août apparaît trois fois
   * dans l'agenda, à sa date propre ; un marché hebdomadaire apparaît à chaque
   * date où il a lieu.
   *
   * ⚠ Ce sont des copies d'affichage : l'événement reste UNIQUE en base. Rien
   * n'est dupliqué — ni la photo, ni la modération, ni les favoris — et
   * corriger l'événement corrige toutes ses dates d'un coup. `id` est conservé,
   * donc le favori et l'ouverture de la fiche pointent bien vers l'original.
   */
  function occurrences() {
    const aujourdhui = dayKey(new Date())
    const filtreJours = joursDuFiltreRapide()
    const out = []
    for (const ev of filtered()) {
      // ⚠ Compter sur TOUS les jours, pas seulement ceux restants : un festival
      // entamé doit annoncer « Jour 2 sur 3 », pas « Jour 1 sur 2 ».
      const tous = eventDayKeys(ev)
      const total = tous.length
      const debut = new Date(ev.starts_at)
      tous.forEach((k, i) => {
        if (k < aujourdhui) return
        if (filtreJours && !filtreJours.has(k)) return
        const [a, m, j] = k.split('-').map(Number)
        const d = new Date(a, m - 1, j, debut.getHours(), debut.getMinutes(), 0, 0)
        // Une affiche par journée quand l'auteur en a fourni plusieurs : la
        // photo de position i illustre le jour i+1. Sinon, celle de
        // l'événement sert pour toutes ses dates.
        const photo = ev.photos?.[i] ?? null
        out.push({
          ...ev,
          starts_at: d.toISOString(),
          photo_url: photo?.photo_url ?? ev.photo_url,
          thumb_url: photo?.thumb_url ?? ev.thumb_url,
          _dayKey: k,
          // Étiquette seulement s'il y a plusieurs dates : inutile de surcharger
          // une carte d'événement ponctuel.
          _occ:
            total > 1
              ? isRecurring(ev)
                ? recurrenceDaysLabel(ev)
                : `Jour ${i + 1} sur ${total}`
              : null,
        })
      })
    }
    out.sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    return out
  }

  // --- Calendrier mensuel ---
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  let monthCursor = new Date(thisMonth)
  let selectedDay = null // clé AAAA-MM-JJ ou null = "à venir"

  const cal = el('div', 'calendar calendar--studio')
  cal.id = 'agenda-calendar-panel'
  cal.hidden = false
  calendarToggle.setAttribute('aria-controls', cal.id)
  const calHead = el('div', 'calendar__head')
  // ⚠ size explicite : sans attributs width/height ni règle CSS, Safari iOS
  // rendait ces SVG à sa taille par défaut, hors du bouton de 28 px — flèches
  // invisibles sur iPhone alors que Chrome, lui, devinait une taille correcte.
  const prevBtn = el('button', 'calendar__nav')
  prevBtn.type = 'button'
  prevBtn.setAttribute('aria-label', 'Mois précédent')
  prevBtn.appendChild(icon('chevronLeft', { size: 18 }))
  const monthLabel = el('div', 'calendar__month')
  const nextBtn = el('button', 'calendar__nav')
  nextBtn.type = 'button'
  nextBtn.setAttribute('aria-label', 'Mois suivant')
  nextBtn.appendChild(icon('chevronRight', { size: 18 }))
  calHead.appendChild(prevBtn)
  calHead.appendChild(monthLabel)
  calHead.appendChild(nextBtn)
  cal.appendChild(calHead)
  const grid = el('div', 'calendar__grid')
  cal.appendChild(grid)
  wrap.appendChild(cal)
  // La ligne du petit rond : centré, avec de la place libre de part et
  // d'autre. Le lien vers les associations s'y loge, à droite (plus bas).
  const ligneCalendrier = el('div', 'ligne-calendrier')
  ligneCalendrier.append(el('span'), calendarToggle)
  wrap.appendChild(ligneCalendrier)

  calendarToggle.addEventListener('click', () => {
    const willOpen = cal.hidden
    cal.hidden = !willOpen
    calendarToggle.classList.toggle('is-open', willOpen)
    calendarToggle.title = willOpen ? 'Fermer le calendrier' : 'Ouvrir le calendrier'
    calendarToggle.setAttribute('aria-label', calendarToggle.title)
    calendarToggle.setAttribute('aria-expanded', String(willOpen))
    // Le calendrier commande la liste : ouvert, elle se limite au mois affiché ;
    // fermé, elle s'ouvre à tout ce qui vient. Un jour resté sélectionné
    // masquerait tout le reste sans qu'on puisse voir d'où ça vient.
    selectedDay = null
    repaintList()
  })

  // Changer de mois change la liste : un jour sélectionné dans le mois qu'on
  // quitte n'aurait plus de sens.
  const allerAuMois = (delta) => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1)
    selectedDay = null
    repaintCalendar()
    repaintList()
  }
  prevBtn.addEventListener('click', () => allerAuMois(-1))
  nextBtn.addEventListener('click', () => allerAuMois(1))

  function repaintCalendar() {
    monthLabel.textContent = formatMonthLabel(monthCursor)
    // Les mois passés ne s'affichent jamais : pas de navigation avant le mois courant.
    prevBtn.disabled = monthCursor <= thisMonth

    // Les pastilles s'appuient sur les MÊMES occurrences que la liste : les deux
    // ne peuvent donc pas se contredire.
    const eventDays = new Set(occurrences().map((o) => o._dayKey))

    grid.innerHTML = ''
    for (const d of ['L', 'M', 'M', 'J', 'V', 'S', 'D']) {
      grid.appendChild(el('div', 'calendar__dow', d))
    }
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const pad = (first.getDay() + 6) % 7 // semaine française : lundi en premier
    for (let i = 0; i < pad; i++) grid.appendChild(el('button', 'calendar__cell is-empty'))
    const nDays = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
    const todayKey = dayKey(today)
    for (let day = 1; day <= nDays; day++) {
      const key = dayKey(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day))
      const cell = el('button', 'calendar__cell', String(day))
      if (key === todayKey) cell.classList.add('is-today')
      if (eventDays.has(key)) cell.classList.add('has-event')
      if (key === selectedDay) cell.classList.add('is-selected')
      cell.addEventListener('click', () => {
        selectedDay = selectedDay === key ? null : key // re-tap = désélection
        repaintCalendar()
        repaintList()
      })
      grid.appendChild(cell)
    }
  }

  // --- Liste des événements ---
  const sectionLabel = el('h2', 'section-label')
  const list = el('div', 'events-list')

  // L'entrée vers l'annuaire des associations (14/11/2026) : un simple lien,
  // dans les univers Ateliers et Vie locale, logé à droite du petit rond du
  // calendrier — une place libre, qui n'ajoute pas une ligne.
  // ⚠ PAS DE BANDEAU : le premier essai, une grande carte violette entre le
  // calendrier et la liste, « surchargeait la page d'accueil » (Matthieu).
  const lienAsso = el('button', 'asso-lien')
  lienAsso.type = 'button'
  lienAsso.append(icon('users'), el('span', null, 'Associations'), icon('chevronRight'))
  lienAsso.addEventListener('click', () => navigate('/associations'))
  ligneCalendrier.appendChild(lienAsso)
  wrap.appendChild(sectionLabel)
  wrap.appendChild(list)
  const peindreEntreeAsso = () => {
    lienAsso.hidden = getUnivers() === 'culture'
  }
  peindreEntreeAsso()

  /** ⚠ TOUT PASSE PAR ICI. L'état de filtre est partagé et peut changer
   *  depuis la rangée comme depuis le panneau : un seul abonnement redessine
   *  l'ensemble, plutôt que trois appels recopiés à chaque endroit. */
  function toutRedessiner() {
    paintCats()
    peindreEntreeAsso()
    paintChips()
    repaintCalendar()
    repaintList()
  }
  // ⚠ LE ROUTEUR NE PRÉVIENT DE RIEN : il fait `container.innerHTML = ''`,
  // sans événement ni rappel. L'abonnement survivrait donc à la vue et
  // redessinerait un DOM détaché à chaque changement de filtre. On se
  // débranche soi-même en constatant le détachement — même idiome que la
  // carte, qui teste `isConnected`.
  const desabonner = onFilterChange(() => {
    if (!wrap.isConnected) return desabonner()
    toutRedessiner()
    // Départements retouchés : nouvelle requête, puis on redessine.
    rechargerSiBesoin().then((change) => change && wrap.isConnected && toutRedessiner())
  })

  function repaintList() {
    list.innerHTML = ''
    let shown = occurrences()
    let vide = 'Aucun événement à venir.'

    if (selectedDay) {
      shown = shown.filter((o) => o._dayKey === selectedDay)
      sectionLabel.textContent = formatDateFull(selectedDay + 'T12:00:00')
      vide = 'Aucun événement ce jour-là.'
    } else if (!cal.hidden) {
      // Calendrier OUVERT : la liste suit le mois affiché. Le calendrier et ce
      // qu'on lit dessous racontent alors la même chose ; sans cela, on
      // feuilletait les mois sans que la liste bouge.
      const mois = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`
      shown = shown.filter((o) => o._dayKey.startsWith(mois))
      sectionLabel.textContent = formatMonthLabel(monthCursor)
      vide = 'Aucun événement ce mois-ci.'
    } else {
      // Calendrier FERMÉ : plus de mois affiché, donc plus de raison de borner.
      sectionLabel.textContent = 'À venir'
      // Garde-fou : une longue récurrence pourrait à elle seule produire des
      // centaines de cartes. Le calendrier reste le moyen d'aller plus loin.
      shown = shown.slice(0, 300)
    }

    // --- ESSAI : les événements qui DURENT, regroupés en tête ---------------
    // Une exposition ouverte dix jours produisait dix cartes, noyant les
    // rendez-vous d'un soir. On n'en garde qu'UNE, portant la plage restante
    // (« du 2 au 10 septembre »), et on la remonte en haut de la liste.
    //
    // ⚠ Regroupement fait ICI, au rendu, et non dans occurrences() : les
    // pastilles du calendrier ont besoin, elles, du détail jour par jour.
    // Les toucher ferait disparaître les points des jours intermédiaires.
    // ⚠ ORDRE CHRONOLOGIQUE CONSERVÉ. Ces cartes étaient remontées en tête ;
    // Matthieu l'a corrigé : une exposition qui commence le 31 doit se lire
    // après les rendez-vous du 30. On parcourt donc `shown`, déjà trié par
    // date, en ne gardant que la PREMIÈRE occurrence de chaque événement —
    // sa place dans la liste est celle de son premier jour visible.
    //
    // ⚠ LES RENDEZ-VOUS QUI REVIENNENT AUSSI, ET C'EST VOULU (14/11/2026).
    // J'avais essayé une carte à chaque date pour « Le Jeu de Peindre » (tous
    // les vendredis d'octobre à juin) : il apparaissait alors deux, quatre,
    // cinq fois dans la liste. Matthieu a préféré la carte unique avec sa
    // plage (« 20 NOV → 4 JUIN »). Les pastilles du calendrier, elles, restent
    // sur les seuls vendredis, et toucher un autre jour ne le montre pas.
    const aujourdHui = dayKey(new Date())
    const dejaVu = new Set()
    const cartes = []
    for (const o of shown) {
      if (!o._occ) {
        cartes.push(o)
        continue
      }
      if (dejaVu.has(o.id)) continue
      // ⚠ La plage part du PREMIER JOUR VISIBLE DANS LA VUE COURANTE, et court
      // jusqu'à la fin de l'événement. `o` est une occurrence : son `starts_at`
      // a été réécrit à la date de ce jour-là, donc eventDayKeys() repart de là.
      // C'est voulu, et cohérent dans les trois vues :
      //   · liste « à venir »   → « du 30 août au 20 septembre » ;
      //   · mois de septembre   → « du 1er au 20 septembre » ;
      //   · jour du 5 septembre → « du 5 au 20 septembre ».
      // Le resserrement demandé par Matthieu en découle : demain, la même
      // exposition annoncera « du 31 août au 20 septembre ».
      const restants = eventDayKeys(o).filter((k) => k >= aujourdHui)
      const carte = {
        ...o,
        _plage: restants.length > 1 ? { debut: restants[0], fin: restants[restants.length - 1] } : null,
        // « Jour 2 sur 3 » n'a plus de sens sur une carte unique ; pour un
        // événement récurrent, en revanche, savoir QUELS jours reste utile.
        _occ: isRecurring(o) ? recurrenceDaysLabel(o) : null,
      }
      dejaVu.add(o.id)
      cartes.push(carte)
    }
    shown = cartes

    if (!shown.length) {
      list.appendChild(emptyState(vide))
      return
    }
    if (shown.some((ev) => ev.title.includes('[DÉMO]'))) {
      list.appendChild(
        el('p', 'demo-note', 'Les événements « [DÉMO] » sont des exemples de démonstration.')
      )
    }
    let posterIndex = 0
    for (const ev of shown) {
      list.appendChild(
        posterEventCard(ev, {
          gemmed: gemIds.has(ev.id),
          onGemChange: (id, on) => {
            if (on) gemIds.add(id)
            else gemIds.delete(id)
            // Le même événement peut être affiché à plusieurs dates : on
            // synchronise tous ses cœurs, sinon la carte du lendemain
            // paraîtrait ne pas avoir enregistré le favori.
            for (const b of list.querySelectorAll(
              `[data-event-id="${id}"] .poster-card__favorite`
            )) {
              b.classList.toggle('is-on', on)
              b.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none')
            }
          },
          index: posterIndex++,
          preview: Boolean(ev._studioPreview),
        })
      )
    }
  }

  repaintCalendar()
  repaintList()

  // Le bouton « Publier » flottant a rejoint la barre d'onglets (version C,
  // 15/10/2026) : il est désormais au centre, sur tous les écrans.

  return wrap
}
