// Armana — écran Map : Leaflet + OSM, filtre par rayon (PostGIS ST_DWithin).
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)

import { el, formatDate, formatTime, formatPrice, tarifMode } from './components.js'
import { icon } from './icons.js'
import './bulleCarte.css'
import { navigate, refresh } from '../lib/router.js'
import { DEFAULT_CENTER, getUserLocation, locationErrorMessage } from '../lib/geo.js'
import { listApprovedEvents } from '../lib/events.js'
import { poserFondDeCarte } from '../lib/fondDeCarte.js'
// ⚠ Par jours COUVERTS (eventDayKeys), jamais « début ≤ jour ≤ fin » : un
// événement récurrent couvre une longue période mais pas tous ses jours.
import { eventDayKeys } from '../lib/recurrence.js'
import { tagVisitDept } from '../lib/admins.js'
import {
  appliquerFiltres,
  getDepartementsEffectifs,
  getJourPrecis,
  getQuand,
  joursDeQuand,
  libelleQuand,
  nbFiltresActifs,
  onFilterChange,
  setJourPrecis,
  setQuand,
} from '../lib/filter.js'
import { ouvrirFiltres } from './filtres.js'
import { foodTrucksSurCarte } from '../lib/fiches.js'
import {
  JOURS,
  aujourdhuiParis,
  foodTrucksAujourdhui,
  foodTrucksPeriode,
  jourIso,
  lieuLisible,
  plageHoraire,
} from '../lib/foodTrucks.js'
import { ouvrirCalendrier } from './calendrier.js'

/** AAAA-MM-JJ décalé de n jours. */
function dansNJours(ymd, n) {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1)
import { studioHeader, boutonPartage } from './studio.js'
import {
  anneauxExterieurs,
  departementEnFrance,
  estDansLeTerritoire,
  loadDepartements,
  nomDepartement,
  TERRITOIRE_HISTORIQUE,
} from '../lib/departements.js'

// Le sélecteur de rayon (10/20/50 km) a été retiré : un rayon n'apportait
// qu'un filtre de plus à comprendre, dont le seul effet était de cacher des
// événements pourtant proches. Depuis l'ouverture à la France, la carte charge
// les événements des départements affichés, sans rayon du tout.

// Zoom d'ouverture, autrefois déduit du cercle de rayon.
const ZOOM_DEPART = 9


/**
 * Liseré jaune sur les frontières — INTERRUPTEUR.
 *
 * Coupé, le territoire n'est plus dessiné que par le fondu du motif : une
 * silhouette douce, sans trait. Essai demandé par Matthieu, le liseré barrant
 * les noms de villes posés sur les frontières.
 *
 * ⚠ Le remettre à `true` restaure les DEUX traits et leur découpe. Ne pas
 * supprimer le code correspondant : il porte des contraintes qui se
 * redécouvrent mal (trait centré sur son tracé, frontières internes effacées
 * par la découpe, référence circulaire du clipPath).
 */
const LISERE_JAUNE = false

/**
 * Bord du masque NET depuis le 07/11/2026 (demande de Matthieu) : le fondu
 * flou faisait « carte floue ». La MARGE reste : le motif démarre
 * MARGE_BORD_PX au-delà de la frontière, pour ne pas rogner les noms de villes
 * posés dessus, et un filet jaune de FILET_PX souligne ce bord.
 * ⚠ Remettre FONDU_DE_BORD à `true` restaure l'ancien fondu (flou de 11 px).
 */
const FONDU_DE_BORD = false
const MARGE_BORD_PX = 22
// 0 = pas de filet : jugé « pas beau » par Matthieu le 07/11, avec le fond
// maison (bord net du motif, sans trait).
const FILET_PX = 0

// Marqueur aux couleurs d'Armana : la goutte jaune cerclée de vert, avec les
// masques au centre. Plus gros que le marqueur bleu de Leaflet, qu'on
// distinguait mal du fond de carte (demande de Matthieu).
// `divIcon` plutôt qu'une image : le SVG reste net sur tous les écrans et ne
// coûte aucun téléchargement.
const MARQUEUR_ARMANA = L.divIcon({
  className: 'marqueur-armana',
  html: `
    <svg viewBox="0 0 44 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22 55C22 55 41 33.6 41 21A19 19 0 1 0 3 21C3 33.6 22 55 22 55Z"
            fill="#f4ca15" stroke="#064f36" stroke-width="3.5" stroke-linejoin="round"/>
      <image href="/icons/armana-logo.png" x="9" y="8" width="26" height="26"/>
    </svg>`,
  iconSize: [44, 56],
  // La POINTE de la goutte doit toucher le lieu, pas son centre : sinon tous
  // les événements paraissent décalés de 28 px vers le nord.
  iconAnchor: [22, 55],
  popupAnchor: [0, -48],
})

/** La même goutte, avec le NOMBRE d'événements qu'elle réunit au même endroit. */
function marqueurGroupe(n) {
  return L.divIcon({
    ...MARQUEUR_ARMANA.options,
    className: 'marqueur-armana marqueur-armana--groupe',
    html: MARQUEUR_ARMANA.options.html + `<span class="marqueur-armana__nombre">${n > 9 ? '9+' : n}</span>`,
  })
}

// Marqueur de food truck : un rond rouge au camion blanc. Volontairement d'une
// AUTRE FORME que la goutte des événements — on doit distinguer les deux d'un
// coup d'œil, même sans couleurs.
const MARQUEUR_FOOD_TRUCK = L.divIcon({
  className: 'marqueur-food-truck',
  html: `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" fill="#f04b2f" stroke="#fff" stroke-width="3"/>
      <g transform="translate(9 9) scale(0.92)" fill="none" stroke="#fff" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
        <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
      </g>
    </svg>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -18],
})

export async function viewMap() {
  const wrap = el('section', 'screen screen--studio-map')
  const head = studioHeader('Carte', { tone: 'blue', actions: [boutonPartage()] })

  wrap.appendChild(head)

  // --- Pastilles, sur UNE ligne ---------------------------------------------
  // « Filtres » ouvre LE MÊME panneau que l'Agenda (styles, tarif, quand,
  // départements) : un seul état, partagé, au lieu des deux menus « territoire »
  // et « style » propres à la carte, qui en étaient une version appauvrie.
  // La date précise y est aussi, depuis le 15/10/2026. Puis le mode Food trucks.
  const barre = el('section', 'map-pills')
  barre.setAttribute('aria-label', 'Filtres de la carte')

  /** Une pastille simple, sans menu : un geste, un effet. */
  function pastilleBouton(iconeNom, texte, onClick) {
    const p = el('button', 'map-pill')
    p.type = 'button'
    p.appendChild(icon(iconeNom))
    const txt = el('span', 'map-pill__texte', texte)
    p.appendChild(txt)
    p.addEventListener('click', onClick)
    barre.appendChild(p)
    p.texte = txt
    return p
  }

  // 1. Filtres — le panneau de l'Agenda, avec le nombre de filtres actifs : un
  //    filtre qui ne se voit pas est un filtre qu'on oublie.
  const pFiltres = pastilleBouton('sliders', 'Filtres', () => ouvrirFiltres(() => {}))
  pFiltres.setAttribute('aria-haspopup', 'dialog')
  const majFiltres = () => {
    // La date a sa propre pastille juste à côté : la compter ici aussi la
    // signalerait deux fois (et « Filtres · 1 » ne tenait plus sur la ligne).
    const n = nbFiltresActifs() - (libelleQuand() ? 1 : 0)
    pFiltres.texte.textContent = n ? `Filtres · ${n}` : 'Filtres'
    pFiltres.classList.toggle('is-active', n > 0)
  }
  majFiltres()

  // ⚠ LES DÉPARTEMENTS NE SE RATTRAPENT PAS EN RECHARGEANT LES POINTS. Le masque
  // et les limites de navigation sont bâtis à l'initialisation de Leaflet :
  // quand ils changent, on re-rend l'écran entier — un département décoché doit
  // VRAIMENT repasser sous le masque, pas seulement perdre ses marqueurs.
  // Le reste (styles, tarif, quand) ne demande qu'un nouveau tri des points.
  // Débranché seul quand la vue quitte le DOM, comme dans l'Agenda.
  const codesAuRendu = getDepartementsEffectifs().join(',')
  // ⚠ « PAS ENCORE AFFICHÉE » N'EST PAS « QUITTÉE ». Après une retouche des
  // départements, la carte se reconstruit — et pendant ce temps sa nouvelle
  // version n'est pas encore dans la page. Cocher plusieurs régions d'affilée
  // tombait dans ce creux : la nouvelle carte se croyait quittée, se
  // débranchait, et ne voyait jamais les régions suivantes (seule la première
  // s'affichait). On attend donc qu'elle soit posée, quelques secondes au plus.
  let montee = false
  let essais = 0
  const surChangement = () => {
    if (!wrap.isConnected) {
      if (montee || ++essais > 25) return desabonner()
      return setTimeout(surChangement, 200)
    }
    montee = true
    if (getDepartementsEffectifs().join(',') !== codesAuRendu) {
      desabonner()
      return refresh()
    }
    majFiltres()
    majDate()
    loadEvents()
    loadFoodTrucks()
  }
  const desabonner = onFilterChange(surChangement)
  // Une retouche faite PENDANT la construction (avant l'abonnement) serait
  // perdue sans ce contrôle, une fois la carte posée.
  let essaisPose = 0
  const verifierALaPose = () => {
    if (!wrap.isConnected) {
      if (++essaisPose <= 25) setTimeout(verifierALaPose, 200)
      return
    }
    if (getDepartementsEffectifs().join(',') !== codesAuRendu) {
      desabonner()
      refresh()
    }
  }
  setTimeout(verifierALaPose, 0)

  // 2. Date — à côté de « Filtres » (Matthieu, 15/10/2026). Un petit menu :
  //    aujourd'hui, ce week-end, cette semaine, ou un jour choisi dans le
  //    calendrier. MÊME ÉTAT que le panneau (lib/filter.js) : la date choisie
  //    ici vaut pour l'Agenda, et pour les food trucks.
  const pDate = pastilleBouton('calendar', 'Date', () => {
    if (menuDate) return fermerMenuDate()
    ouvrirMenuDate()
  })
  // Pas de flèche : les trois pastilles doivent tenir sur une ligne même à
  // 340 px. Le menu reste annoncé aux lecteurs d'écran.
  pDate.setAttribute('aria-haspopup', 'true')
  const majDate = () => {
    const l = libelleQuand()
    // Libellés COURTS : la barre partage sa ligne avec « Food trucks », et
    // « Cette semaine » s'y faisait couper à 360 px.
    const j = getJourPrecis()
    pDate.texte.textContent = j
      ? new Date(j + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : ({ weekend: 'Week-end', semaine: 'Semaine' }[getQuand()] ?? l ?? 'Date')
    pDate.classList.toggle('is-active', Boolean(l))
  }
  majDate()

  let menuDate = null
  function fermerMenuDate() {
    menuDate?.remove()
    menuDate = null
    pDate.setAttribute('aria-expanded', 'false')
  }
  function ouvrirMenuDate() {
    // ⚠ Le menu est posé sur le CADRE DE LA CARTE, jamais dans la barre de
    // pastilles : celle-ci défile horizontalement et découperait ce qui
    // dépasse (le menu s'y réduisait autrefois à un trait).
    const panneau = el('div', 'map-menu')
    const choix = (texte, actif, action) => {
      const b = el('button', 'map-menu__item', texte)
      b.type = 'button'
      if (actif) b.classList.add('is-active')
      b.addEventListener('click', () => {
        fermerMenuDate()
        action()
      })
      panneau.appendChild(b)
    }
    const q = getQuand()
    const j = getJourPrecis()
    choix('Toutes les dates', !q && !j, () => {
      setJourPrecis(null)
      if (getQuand()) setQuand(getQuand()) // re-choisir la même la relâche
    })
    choix('Aujourd’hui', q === 'today', () => q !== 'today' && setQuand('today'))
    choix('Ce week-end', q === 'weekend', () => q !== 'weekend' && setQuand('weekend'))
    choix('Cette semaine', q === 'semaine', () => q !== 'semaine' && setQuand('semaine'))
    // Le calendrier s'ouvre DANS le geste du clic : sinon le navigateur refuse.
    choix(j ? 'Autre date…' : 'Choisir une date…', Boolean(j), () =>
      ouvrirCalendrier(j, (jour) => setJourPrecis(jour))
    )
    mapFrame.appendChild(panneau)
    const r = pDate.getBoundingClientRect()
    const cadre = mapFrame.getBoundingClientRect()
    panneau.style.left = Math.max(8, Math.min(r.left - cadre.left, cadre.width - 248)) + 'px'
    panneau.style.top = r.bottom - cadre.top + 6 + 'px'
    pDate.setAttribute('aria-expanded', 'true')
    menuDate = panneau
  }
  // Un clic ailleurs referme le menu.
  document.addEventListener('click', (e) => {
    if (menuDate && !menuDate.contains(e.target) && !pDate.contains(e.target)) fermerMenuDate()
  })

  // 3. Food trucks — un MODE de la carte, éteint par défaut, posé seul dans le
  //    coin haut droit (Matthieu, 15/10/2026). Allumé, on ne voit plus que les
  //    camions — ceux du mois à venir, ou de la période choisie — et les
  //    événements où l'on mange sur place.
  // ⚠ PAS MÉMORISÉ d'une ouverture à l'autre : il CACHE des événements, et une
  //   carte presque vide au lancement passerait pour une panne.
  let avecFoodTrucks = false
  const pTrucks = el('button', 'map-pill map-pill--trucks map-food')
  pTrucks.type = 'button'
  pTrucks.append(icon('truck'), el('span', 'map-pill__texte', 'Food trucks'))
  pTrucks.addEventListener('click', () => {
    avecFoodTrucks = !avecFoodTrucks
    majTrucks()
    loadEvents()
    loadFoodTrucks()
  })
  const majTrucks = () => {
    pTrucks.classList.toggle('is-active', avecFoodTrucks)
    pTrucks.setAttribute('aria-pressed', String(avecFoodTrucks))
  }
  majTrucks()

  // Compteur de résultats et retour de géolocalisation, posés SUR la carte
  // pour ne rien prendre à sa hauteur.
  const resultsBar = el('div', 'map-results-bar')
  resultsBar.appendChild(el('span', 'map-results-bar__dot'))
  const count = el('span', 'map-results-bar__count', '')
  resultsBar.appendChild(count)
  const geoMsg = el('p', 'form__hint map-geo-msg')

  const recenter = el('button', 'map-recenter')
  recenter.type = 'button'
  recenter.title = 'Recentrer sur ma position'
  recenter.setAttribute('aria-label', 'Recentrer sur ma position')
  recenter.appendChild(icon('pin'))

  // Tout est POSÉ SUR la carte : les filtres en haut, le compteur en bas à
  // gauche, le recentrage et les zooms en bas à droite. Rien ne lui prend de
  // hauteur, elle occupe tout l'espace disponible.
  const mapFrame = el('div', 'map-frame-studio')
  const mapDiv = el('div', 'map map--studio')
  mapFrame.appendChild(mapDiv)
  // « Food trucks » ferme la rangée, poussé à droite (voir style.css).
  barre.appendChild(pTrucks)
  mapFrame.appendChild(barre)
  mapFrame.appendChild(resultsBar)
  mapFrame.appendChild(geoMsg)
  wrap.appendChild(mapFrame)

  let map = null
  let center = null
  let userMarker = null
  let contours = null
  let departmentBounds = null
  /** Promesse du fond de carte (lib/fondDeCarte.js) : maison ou repli OSM. */
  let fond = null
  // Relue à chaque rendu : l'utilisateur peut changer ses départements dans le
  // Profil et revenir sur la carte sans que celle-ci soit reconstruite.
  // ⚠ LA LISTE EFFECTIVE, pas le choix durable : si le panneau de filtres
  // porte une retouche temporaire, le masque de la carte doit la suivre,
  // sinon l'agenda et la carte ne montreraient pas le même territoire.
  const mesCodes = () => getDepartementsEffectifs()
  const markers = L.layerGroup()
  const marqueursTrucks = L.layerGroup()

  // Le compteur dit les deux : « 12 événements · 3 food trucks ».
  let nbEvenements = null
  let nbTrucks = null
  const peindreCompteur = () => {
    if (nbEvenements == null) return
    // Mode Food trucks : les camions d'abord, puis les événements où l'on mange.
    if (avecFoodTrucks) {
      if (nbTrucks == null) return
      const periode = libelleQuand()?.toLowerCase() ?? 'ce mois-ci'
      let t = `${nbTrucks} food truck${nbTrucks > 1 ? 's' : ''} · ${periode}`
      if (nbEvenements) t += ` · ${nbEvenements} événement${nbEvenements > 1 ? 's' : ''} avec food`
      count.textContent = t
      return
    }
    count.textContent = `${nbEvenements} événement${nbEvenements > 1 ? 's' : ''}`
  }

  async function loadEvents() {
    if (!map) return
    count.textContent = 'Recherche…'
    try {
      // ⚠ PAR DÉPARTEMENT, PLUS PAR RAYON, depuis l'ouverture à la France : un
      // cercle de 300 km autour de Forcalquier ne voit pas la Bretagne. Les
      // départements affichés sont filtrés en base (`events.dept`).
      let events = await listApprovedEvents(mesCodes())
      // Styles et tarif : la même fonction que l'Agenda.
      events = appliquerFiltres(events, tarifMode)
      // « Aujourd'hui » / « Ce week-end » du panneau, puis la date précise.
      // ⚠ Par jours COUVERTS, pas par date de début : un festival commencé
      // hier a bien lieu aujourd'hui (voir src/lib/recurrence.js).
      const jours = joursDeQuand()
      if (jours) events = events.filter((e) => eventDayKeys(e).some((k) => jours.has(k)))
      // Mode Food trucks : seulement les événements où un camion est annoncé.
      if (avecFoodTrucks) events = events.filter((e) => e.food_trucks?.length || e.restauration)
      markers.clearLayers()
      // ⚠ UN SEUL REPÈRE PAR ENDROIT (retour de Matthieu, 12/11/2026). Deux
      // événements posés exactement au même point — le même théâtre, ou bien
      // deux salles laissées au centre de leur commune — donnaient deux
      // gouttes superposées : on n'en voyait qu'une, et rien ne permettait
      // d'atteindre l'autre (« Swing Brassens » cachait « Muriel Robin » à
      // La Ciotat). Mesuré ce jour-là : 19 événements à venir sur 43
      // partageaient leur point avec un autre. Le repère porte désormais leur
      // nombre, et sa bulle les liste tous.
      const parEndroit = new Map()
      for (const ev of events) {
        if (ev.lat == null || ev.lng == null) continue
        // Quatre décimales : une dizaine de mètres, le même bâtiment.
        const cle = `${Number(ev.lat).toFixed(4)},${Number(ev.lng).toFixed(4)}`
        if (!parEndroit.has(cle)) parEndroit.set(cle, [])
        parEndroit.get(cle).push(ev)
      }
      // La carte se décale pour montrer la bulle EN ENTIER, sous la rangée de
      // filtres (60 px) et au-dessus du compteur.
      const bulle = {
        className: 'bulle-armana',
        minWidth: 240,
        maxWidth: 260,
        autoPanPaddingTopLeft: [12, 64],
        autoPanPaddingBottomRight: [12, 64],
      }
      let plotted = 0
      for (const groupe of parEndroit.values()) {
        const [premier] = groupe
        const seul = groupe.length === 1
        const m = L.marker([premier.lat, premier.lng], {
          icon: seul ? MARQUEUR_ARMANA : marqueurGroupe(groupe.length),
          // Un repère qui en cache plusieurs passe devant ses voisins.
          zIndexOffset: seul ? 0 : 500,
        })
        if (seul) {
          m.bindPopup(() => popupContent(premier), bulle)
        } else {
          groupe.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
          m.bindPopup(() => popupGroupe(groupe), bulle)
        }
        markers.addLayer(m)
        plotted += groupe.length
      }
      nbEvenements = plotted
      peindreCompteur()
    } catch (e) {
      count.textContent = 'Erreur : ' + e.message
    }
  }

  /**
   * La couche des food trucks. Chargée seulement quand elle est allumée, et
   * soumise au même territoire que les événements.
   * Les styles et le tarif du panneau ne s'y appliquent PAS : ils décrivent des
   * spectacles, pas des camions.
   */
  async function loadFoodTrucks() {
    if (!map) return
    marqueursTrucks.clearLayers()
    if (!avecFoodTrucks) {
      nbTrucks = null
      return peindreCompteur()
    }
    // La période : celle choisie (Date ou Filtres), sinon LE MOIS À VENIR —
    // comme la carte montre par défaut tous les événements à venir.
    const jours = joursDeQuand()
    const auj = aujourdhuiParis()
    let debut = auj
    let fin = dansNJours(auj, 30)
    if (jours) {
      const liste = [...jours].sort()
      debut = liste[0]
      fin = liste[liste.length - 1]
    }
    // Planning (0035, puis 0034 pour le seul jour même). Sans lui, repli sur
    // l'adresse de la fiche plutôt qu'une couche vide.
    let presences = await foodTrucksPeriode(debut, fin)
    if (!presences && debut === auj && fin === auj) {
      presences = (await foodTrucksAujourdhui())?.map((p) => ({ ...p, jour: auj })) ?? null
    }
    if (presences && jours) presences = presences.filter((p) => jours.has(p.jour))
    let groupes = presences ? regrouper(presences) : (await foodTrucksSurCarte()).map((t) => ({ fiche: t }))
    if (contours) {
      const codes = mesCodes()
      groupes = groupes.filter((g) => estDansLeTerritoire(g.fiche ?? g, contours, codes))
    }
    // La vue a pu être éteinte entre-temps : ne rien poser dans ce cas.
    if (!avecFoodTrucks) return
    for (const g of groupes) {
      const p = g.fiche ?? g
      // Au-dessus des gouttes : allumée exprès, la couche ne doit pas se
      // perdre sous un amas d'événements (Forcalquier, Manosque).
      const m = L.marker([p.lat, p.lng], { icon: MARQUEUR_FOOD_TRUCK, zIndexOffset: 1000 })
      m.bindPopup(() => popupFoodTruck(g))
      marqueursTrucks.addLayer(m)
    }
    // Un camion présent à deux endroits pose deux points, mais reste UN camion.
    nbTrucks = new Set(groupes.map((g) => g.truck_id ?? g.fiche?.id)).size
    peindreCompteur()
  }

  /**
   * UN SEUL REPÈRE PAR CAMION ET PAR LIEU sur la période (Matthieu,
   * 15/10/2026) : le lundi et le jeudi au même marché ne font pas deux points.
   * Chaque groupe garde ses présences, résumées dans la bulle.
   */
  function regrouper(presences) {
    const parCle = new Map()
    for (const p of presences) {
      const cle = `${p.truck_id}|${p.place_label}|${p.place_hint ?? ''}|${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`
      if (!parCle.has(cle)) {
        parCle.set(cle, {
          truck_id: p.truck_id,
          name: p.name,
          cuisine: p.cuisine,
          place_label: p.place_label,
          place_hint: p.place_hint,
          lat: p.lat,
          lng: p.lng,
          presences: [],
        })
      }
      parCle.get(cle).presences.push(p)
    }
    return [...parCle.values()]
  }

  /**
   * Les jours d'un groupe, lisibles : les présences RÉGULIÈRES se résument
   * (« Tous les lundis · 11 h 30 – 14 h »), les autres se datent
   * (« Sam. 18 oct. · 18 h – 22 h »). Aujourd'hui est signalé.
   */
  function joursLisibles(presences) {
    const auj = aujourdhuiParis()
    const parRythme = new Map()
    for (const p of presences) {
      const cle = `${jourIso(p.jour)}|${p.start_time}|${p.end_time}`
      if (!parRythme.has(cle)) parRythme.set(cle, [])
      parRythme.get(cle).push(p)
    }
    const lignes = []
    for (const groupe of parRythme.values()) {
      groupe.sort((a, b) => a.jour.localeCompare(b.jour))
      const p = groupe[0]
      const heures = plageHoraire(p.start_time, p.end_time)
      if (groupe.length >= 2) {
        const nom = JOURS[jourIso(p.jour) - 1].toLowerCase()
        lignes.push({ tri: p.jour, texte: `Tous les ${nom}s · ${heures}`, auj: groupe.some((x) => x.jour === auj) })
      } else {
        const date =
          p.jour === auj
            ? 'Aujourd’hui'
            : new Date(p.jour + 'T12:00:00').toLocaleDateString('fr-FR', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })
        lignes.push({ tri: p.jour, texte: `${majuscule(date)} · ${heures}`, auj: p.jour === auj })
      }
    }
    return lignes.sort((a, b) => a.tri.localeCompare(b.tri))
  }

  function popupFoodTruck(g) {
    const box = el('div', 'popup')
    // Repli sans planning : une fiche, avec ses horaires en texte.
    if (g.fiche) {
      const t = g.fiche
      box.appendChild(el('span', 'popup__cat popup__cat--truck', t.cuisine || 'Food truck'))
      box.appendChild(el('strong', 'popup__title', t.name))
      if (t.opening_hours) box.appendChild(el('div', 'popup__meta popup__meta--horaires', t.opening_hours))
      if (t.address) box.appendChild(el('div', 'popup__meta', '📍 ' + t.address))
      const open = el('button', 'btn btn--sm btn--primary', 'Voir la fiche')
      open.addEventListener('click', () => navigate('/fiche?id=' + t.id))
      box.appendChild(open)
      return box
    }
    box.appendChild(el('span', 'popup__cat popup__cat--truck', g.cuisine || 'Food truck'))
    box.appendChild(el('strong', 'popup__title', g.name))
    box.appendChild(el('div', 'popup__meta', '📍 ' + lieuLisible(g)))
    const ul = el('ul', 'popup__jours')
    for (const l of joursLisibles(g.presences)) {
      ul.appendChild(el('li', l.auj ? 'is-today' : null, l.texte))
    }
    box.appendChild(ul)
    const open = el('button', 'btn btn--sm btn--primary', 'Voir la fiche')
    open.addEventListener('click', () => navigate('/fiche?id=' + g.truck_id))
    box.appendChild(open)
    return box
  }

  /** Centre la carte sur la position retenue, au zoom d'ouverture. */
  function cadrerSurPosition() {
    applyDepartmentLimits()
    map.setView([center.lat, center.lng], ZOOM_DEPART, { animate: false })
  }

  /**
   * La bulle d'un événement : une MINI-FICHE au style d'Armana (refaite le
   * 07/11/2026 — l'ancienne datait des débuts) : l'affiche en tête, la
   * catégorie en pastille, le titre, la date, le lieu, le tarif, puis le
   * bouton vers la fiche complète. Toucher l'affiche y mène aussi.
   */
  function popupContent(ev) {
    const box = el('div', 'bulle')
    const ouvrir = () => navigate('/evenement?id=' + ev.id)

    const tete = el('div', 'bulle__affiche')
    if (ev.thumb_url) {
      const img = el('img')
      img.src = ev.thumb_url
      img.alt = ''
      img.loading = 'lazy'
      img.addEventListener('error', () => img.remove())
      tete.appendChild(img)
    } else {
      tete.classList.add('bulle__affiche--vide')
      tete.appendChild(el('span', 'bulle__masques', '🎭'))
    }
    if (ev.category) tete.appendChild(el('span', 'bulle__cat', ev.category))
    tete.addEventListener('click', ouvrir)
    box.appendChild(tete)

    const corps = el('div', 'bulle__corps')
    const quand = new Date(ev.starts_at)
    corps.appendChild(
      el(
        'span',
        'bulle__quand',
        `${quand.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(ev.starts_at)}`
      )
    )
    corps.appendChild(el('strong', 'bulle__titre', ev.title))
    const ou = ev.city ? [ev.place_name, ev.city].filter(Boolean).join(', ') : ev.address
    if (ou) {
      const lieu = el('span', 'bulle__lieu')
      lieu.append(icon('pin'), el('span', null, ou))
      corps.appendChild(lieu)
    }
    const badges = el('div', 'bulle__badges')
    const tarif = tarifMode(ev)
    badges.appendChild(el('span', `bulle__badge bulle__badge--${tarif}`, formatPrice(ev)))
    if (ev.food_trucks?.length || ev.restauration) {
      badges.appendChild(el('span', 'bulle__badge bulle__badge--food', 'Food sur place'))
    }
    corps.appendChild(badges)
    const open = el('button', 'bulle__bouton', 'Voir la fiche')
    open.type = 'button'
    open.addEventListener('click', ouvrir)
    corps.appendChild(open)
    box.appendChild(corps)
    return box
  }

  /**
   * La bulle d'un repère qui réunit PLUSIEURS événements : leur liste, du plus
   * proche au plus lointain ; chaque ligne ouvre sa fiche.
   */
  function popupGroupe(evs) {
    const box = el('div', 'bulle bulle--groupe')
    const tete = el('div', 'bulle__tete')
    tete.appendChild(el('strong', null, `${evs.length} événements ici`))
    const villes = [...new Set(evs.map((e) => e.city || e.ville).filter(Boolean))]
    if (villes.length === 1) tete.appendChild(el('span', null, villes[0]))
    box.appendChild(tete)

    const liste = el('div', 'bulle__liste')
    for (const ev of evs) {
      const ligne = el('button', 'bulle__ligne')
      ligne.type = 'button'
      const vignette = el('span', 'bulle__vignette')
      if (ev.thumb_url) {
        const img = el('img')
        img.src = ev.thumb_url
        img.alt = ''
        img.loading = 'lazy'
        img.addEventListener('error', () => img.remove())
        vignette.appendChild(img)
      } else {
        vignette.textContent = '🎭'
      }
      const texte = el('span', 'bulle__ligne-texte')
      const quand = new Date(ev.starts_at)
      texte.appendChild(
        el(
          'span',
          'bulle__quand',
          `${quand.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(ev.starts_at)}`
        )
      )
      texte.appendChild(el('strong', 'bulle__ligne-titre', ev.title))
      if (ev.place_name) texte.appendChild(el('span', 'bulle__ligne-lieu', ev.place_name))
      const chevron = icon('chevronRight')
      ligne.append(vignette, texte, chevron)
      ligne.addEventListener('click', () => navigate('/evenement?id=' + ev.id))
      liste.appendChild(ligne)
    }
    box.appendChild(liste)
    return box
  }

  async function initMap() {
    // ⚠ ORDRE CRITIQUE POUR LA VITESSE RESSENTIE.
    // Avant, on écrivait : `await loadDepartements()` PUIS `await
    // getUserLocation()` PUIS on créait la carte. Résultat mesuré : quand le
    // GPS ne répond pas — le cas ordinaire quand on ouvre l'app depuis chez
    // soi — l'écran restait VIDE 8 secondes, le temps du délai de garde.
    // Désormais la carte s'affiche IMMÉDIATEMENT sur le repli, et le
    // territoire puis la position viennent la compléter quand ils arrivent.
    // Personne n'attend plus rien pour voir quelque chose.
    center = { ...DEFAULT_CENTER, fallback: true }
    map = L.map(mapDiv, {
      // Les zooms sont replacés en bas à droite (demande de Matthieu) : en
      // haut à gauche ils tombaient sous les filtres.
      zoomControl: false,
      maxBoundsViscosity: 1.0,
      // ⚠ ZOOM PAR QUARTS, plus par niveaux entiers (08/11/2026, « bugs de
      // zoom et de dézoom » signalés par Matthieu). Avec des pas entiers, un
      // pincement léger était ramené de force au niveau entier le plus proche :
      // la carte « revenait en arrière » au relâcher. Le fond maison est
      // vectoriel, il reste net à tout niveau intermédiaire. Les boutons + et −
      // gardent un pas entier.
      zoomSnap: 0.25,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 90,
      // Pas de rebond en butée : pincer au-delà du zoom minimum faisait
      // rebondir la carte, perçu comme un bug.
      bounceAtZoomLimits: false,
      // ⚠ NE JAMAIS remettre `preferCanvas: true` ICI. Le masque du territoire
      // est un polygone « monde entier » percé des départements, et ces trous
      // reposent sur `fillRule: evenodd` — que le moteur CANEVAS de Leaflet
      // IGNORE. Résultat : le masque se remplit en entier et recouvre la carte
      // d'un grand aplat blanc. Essayé, cassé, retiré.
      // ⚠ Le crédit est déplacé en BAS À GAUCHE. Laissé à droite, Leaflet
      // l'empile dans le même coin que les zooms et les deux se recouvraient.
      attributionControl: false,
    }).setView([center.lat, center.lng], 11)
    if (import.meta.env.DEV) window.__armanaCarte = map // inspection en développement
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map)
    // ⚠ CHAQUE APPUI SUR + / − COMPTE. Leaflet IGNORE un zoom demandé pendant
    // l'animation du précédent : trois appuis rapides ne donnaient qu'un ou
    // deux niveaux (« bugs de zoom », 08/11/2026). On cumule donc une CIBLE,
    // rejointe dès que l'animation en cours se termine.
    let cibleZoom = null
    const zoomer = (pas) => {
      const depart = cibleZoom ?? map.getZoom()
      cibleZoom = Math.min(map.getMaxZoom() || 19, Math.max(map.getMinZoom(), depart + pas))
      if (!map._animatingZoom) map.setZoom(cibleZoom)
    }
    map.on('zoomend', () => {
      if (cibleZoom == null) return
      if (Math.abs(map.getZoom() - cibleZoom) > 0.01) map.setZoom(cibleZoom)
      else cibleZoom = null
    })
    const boutonsZoom = L.control.zoom({ position: 'bottomright' })
    boutonsZoom._zoomIn = () => zoomer(1)
    boutonsZoom._zoomOut = () => zoomer(-1)
    boutonsZoom.addTo(map)
    // Le recentrage vient se ranger à GAUCHE des zooms, dans le même coin.
    mapFrame.appendChild(recenter)

    // Le fond de carte MAISON (lib/fondDeCarte.js), chargé à la demande, avec
    // repli sur les tuiles OpenStreetMap. Le crédit des données est
    // OBLIGATOIRE : c'est la condition qui rend tout cela gratuit.
    fond = poserFondDeCarte(map, L)

    markers.addTo(map)
    marqueursTrucks.addTo(map)
    userMarker = L.circleMarker([center.lat, center.lng], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: '#f04b2f',
      fillOpacity: 1,
    }).addTo(map)
    userMarker.bindPopup('Vous êtes ici')
    fitToViewport()
    watchResize()

    // Le territoire et la position arrivent chacun de leur côté : ni l'un ni
    // l'autre ne fait attendre l'affichage.
    // Seulement les régions des départements affichés : chacune a son fichier.
    const pTerritoire = loadDepartements(mesCodes()).then((geo) => {
      contours = geo
      dessinerTerritoire()
      return geo
    })
    const pPosition = getUserLocation()

    // Les événements partent SANS attendre le GPS : la requête couvre tout le
    // territoire de toute façon, la position ne sert qu'au cadrage.
    const pEvenements = loadEvents()
    // Les camions attendent le territoire : ils sont triés par département.
    const pCouche = pTerritoire.then(() => loadFoodTrucks())

    const [, located] = await Promise.all([pTerritoire, pPosition, pEvenements, pCouche])

    // Position réelle obtenue → on complète la visite du jour avec le
    // DÉPARTEMENT (jamais la position). Le repli Forcalquier ne compte pas :
    // ce serait inventer une provenance.
    if (!located.fallback && contours) {
      // N'importe où en France : les contours chargés ne couvrent que les
      // régions affichées.
      departementEnFrance(located).then(tagVisitDept).catch(() => {})
      // Hors des départements retenus, on reste sur le repli plutôt que de
      // sauter dans une zone entièrement masquée.
      if (estDansLeTerritoire(located, contours, mesCodes())) {
        center = located
        userMarker.setLatLng([center.lat, center.lng])
      }
    }
    // ⚠ LE REPLI (Forcalquier) N'A DE SENS QUE POUR LE TERRITOIRE D'ORIGINE
    // (PACA + Drôme). Hors de lui — la Bretagne seule, ou toute la France —
    // ouvrir sur Forcalquier au zoom 9 cachait tout le reste : sans position
    // réelle, on cadre alors TOUT le territoire affiché.
    const horsOrigine = mesCodes().some((c) => !TERRITOIRE_HISTORIQUE.includes(c))
    if (
      contours &&
      departmentBounds &&
      center.fallback &&
      (horsOrigine || !estDansLeTerritoire(center, contours, mesCodes()))
    ) {
      applyDepartmentLimits()
      map.fitBounds(departmentBounds, { animate: false })
      center = { ...departmentBounds.getCenter(), fallback: true }
      userMarker.remove()
    } else {
      cadrerSurPosition()
    }
  }

  /** Le masque et les contours, posés dès que le territoire est chargé. */
  function dessinerTerritoire() {
    if (!map || !contours) return

    // Frontières exactes des départements RETENUS. Un masque 100 % opaque
    // recouvre le monde entier, avec ces départements comme « trous » : rien
    // d'autre n'est visible. Décocher un département le fait donc disparaître
    // de la carte, pas seulement de la liste.
    const codesActifs = mesCodes()
    const contoursActifs = {
      type: 'FeatureCollection',
      features: (contours.features ?? []).filter((f) =>
        codesActifs.includes(f?.properties?.code)
      ),
    }
    // Les anneaux servent DEUX FOIS : au masque et au calcul des limites. On
    // les construit donc une seule fois. (Avant, un L.geoJSON complet était
    // instancié uniquement pour lire ses limites, puis jeté — 5 000 sommets
    // convertis en couches Leaflet pour rien.)
    const anneaux = anneauxExterieurs(contoursActifs)
    departmentBounds = L.latLngBounds(anneaux.flat())

    // ⚠ AVEC LE FOND MAISON, LE MASQUE EST DANS LA CARTE ELLE-MÊME, sous les
    // noms de lieux (lib/fondDeCarte.js) : une ville près de la frontière
    // garde son nom entier. Le masque SVG ci-dessous, posé PAR-DESSUS tout,
    // ne sert plus qu'au repli OpenStreetMap.
    fond.then((f) => {
      if (f.maison) return f.masquer(contoursActifs, codesActifs)
      map.createPane('departmentMask')
      map.getPane('departmentMask').style.zIndex = '430'
      map.getPane('departmentMask').style.pointerEvents = 'none'
      const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]]
      const departmentMask = L.polygon([world, ...anneaux], {
        pane: 'departmentMask',
        stroke: false,
        fillColor: '#fff4df',
        fillOpacity: 1,
        fillRule: 'evenodd',
        interactive: false,
        className: 'department-mask',
      }).addTo(map)
      applyDepartmentMaskPattern(departmentMask)
      appliquerFonduDeBord(map, departmentMask)
      if (LISERE_JAUNE) dessinerLisere(contoursActifs)
    })

    // La carte occupe la place restante (flex) : sa taille définitive n'est
    // connue qu'APRÈS la mise en page. On cadre donc APRÈS mesure, sinon le
    // zoom est calculé sur un conteneur encore vide et l'affichage est décadré.
    fitToViewport()
    cadrerSurPosition()
  }

  /**
   * Liseré jaune des frontières — DEUX traits, et il en faut bien deux.
   *
   * Le premier, fin, dessine TOUTES les frontières, y compris celles qui
   * séparent deux départements retenus. Le second, épais, est rogné à
   * l'extérieur du territoire : ces frontières-là, entièrement intérieures,
   * en disparaîtraient complètement — on ne verrait plus où finit le 04 et
   * où commence le 05.
   *
   * Appelé seulement si `LISERE_JAUNE`.
   */
  function dessinerLisere(contoursActifs) {
    L.geoJSON(contoursActifs, {
      pane: 'departmentMask',
      interactive: false,
      style: {
        color: '#f4ca15',
        weight: 2.5,
        opacity: 1,
        fillOpacity: 0,
        className: 'department-outline-fine',
      },
    }).addTo(map)
    L.geoJSON(contoursActifs, {
      pane: 'departmentMask',
      interactive: false,
      style: {
        color: '#f4ca15',
        // ⚠ ÉPAISSEUR DOUBLE, ET C'EST VOLONTAIRE. Le trait est rogné à
        // l'extérieur du territoire (voir `territoire-dehors`) : seule la
        // moitié externe se voit. 8 ici = 4 à l'écran.
        weight: 8,
        opacity: 1,
        fillOpacity: 0,
        className: 'department-outline',
      },
    }).addTo(map)
  }

  /**
   * Hauteur de la carte MESURÉE sur l'appareil, jamais devinée.
   *
   * Les mises en page en CSS pur (flex, 100dvh, env(safe-area-inset-bottom))
   * dépendent du navigateur : `:has()` ignoré, `dvh` mal géré, barre d'URL qui
   * se rétracte, encoche… Sur certains téléphones la carte finissait sous la
   * barre d'onglets, avec l'attribution OpenStreetMap collée dessus.
   * On lit donc la position RÉELLE de la barre d'onglets (élément fixe, donc en
   * coordonnées de l'écran visible) et on cale la carte juste au-dessus.
   */
  function fitToViewport() {
    if (!mapDiv.isConnected) return
    const nav = document.querySelector('.bottom-nav')
    const visible = window.visualViewport?.height ?? window.innerHeight
    const limite = nav ? nav.getBoundingClientRect().top : visible
    const haut = mapDiv.getBoundingClientRect().top
    // 8 px de respiration sous la carte, et un plancher pour rester utilisable.
    const hauteur = Math.max(140, Math.round(limite - haut - 8))
    if (Math.abs(parseFloat(mapDiv.style.height) - hauteur) < 1) return

    // ⚠ La hauteur est posée sur la CARTE elle-même, en style inline : c'est la
    // seule façon de battre à coup sûr le `height: 58vh; min-height: 320px` de
    // la règle générique `.map`. La caler sur le cadre ne suffisait pas — la
    // carte reprenait ses 58vh dès qu'une règle de mise en page n'était pas
    // appliquée, et repassait sous la barre d'onglets.
    mapDiv.style.height = hauteur + 'px'
    mapDiv.style.minHeight = '0'
    mapFrame.style.flex = '0 0 auto'
    mapFrame.style.height = hauteur + 'px'
    map?.invalidateSize({ animate: false })
  }

  /** Bornes de navigation : impossible de sortir du 04 ni de dézoomer au-delà. */
  function applyDepartmentLimits() {
    if (!map || !departmentBounds) return
    const fitZoom = map.getBoundsZoom(departmentBounds, false, L.point(12, 12))
    // Deux niveaux de recul : l'extérieur reste masqué, mais on situe mieux la
    // silhouette du département.
    // ⚠ Plancher à 4, plus à 6 : depuis l'ouverture à la France, un
    // territoire peut couvrir tout le pays, qui ne tient à l'écran d'un
    // téléphone qu'au zoom 4 ou 5. À 6, on restait bloqué sur une région.
    map.setMinZoom(Math.max(4, fitZoom - 2))

    // ⚠ Marge volontairement large (mesurée, pas devinée). Au zoom d'ouverture,
    // la vue fait ~0,91° de haut pour 1,03° de bornes : il ne reste presque
    // aucun jeu, et `maxBoundsViscosity: 1` repousse la vue dès que le point
    // visé est près d'un bord. Sur Forcalquier, cela décalait l'ouverture de
    // 0,146° vers le nord — soit ~16 km à côté.
    // Déborder ne montre rien d'indésirable : le masque opaque couvre déjà tout
    // ce qui est hors du département.
    const limites = L.latLngBounds(
      departmentBounds.getSouthWest(),
      departmentBounds.getNorthEast()
    )
    map.setMaxBounds(limites.pad(0.25))
  }

  /** Rotation de l'écran, barre d'URL mobile qui se rétracte, clavier : la place
   *  disponible change SANS que le conteneur bouge de lui-même. On recalcule donc
   *  à chaque événement, et Leaflet est prévenu à chaque fois (il mémorise la
   *  taille de son conteneur).
   *  Tout se débranche seul quand la vue quitte le DOM : le routeur vide son
   *  conteneur sans prévenir personne, la carte fuiterait sinon. */
  function watchResize() {
    const relayout = () => {
      if (!mapFrame.isConnected) return detach()
      fitToViewport()
      applyDepartmentLimits()
    }

    const vv = window.visualViewport
    window.addEventListener('resize', relayout)
    window.addEventListener('orientationchange', relayout)
    vv?.addEventListener('resize', relayout)
    vv?.addEventListener('scroll', relayout)

    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (!mapDiv.isConnected) return detach()
            map.invalidateSize({ animate: false })
          })
        : null
    ro?.observe(mapDiv)

    function detach() {
      window.removeEventListener('resize', relayout)
      window.removeEventListener('orientationchange', relayout)
      vv?.removeEventListener('resize', relayout)
      vv?.removeEventListener('scroll', relayout)
      ro?.disconnect()
      map?.remove()
    }

    // La barre d'onglets et les polices peuvent finir de se poser après le
    // premier rendu : un dernier calage une fois tout stabilisé.
    setTimeout(relayout, 250)
  }

  recenter.addEventListener('click', async () => {
    if (!map) return
    geoMsg.textContent = 'Localisation en cours…'
    recenter.disabled = true
    const located = await getUserLocation()
    recenter.disabled = false

    if (located.fallback) {
      geoMsg.textContent = locationErrorMessage(located.reason)
      return
    }
    // Le département du point, n'importe où en France (contours allégés) : les
    // contours complets chargés ne couvrent que les régions affichées.
    const dept = await departementEnFrance(located).catch(() => null)
    if (contours && !estDansLeTerritoire(located, contours, mesCodes())) {
      // On ne déplace PAS la carte sans le dire : l'utilisateur croirait que sa
      // position a été prise en compte.
      geoMsg.textContent = !dept
        ? 'Vous semblez être hors du territoire couvert : la carte n’a pas bougé.'
        : `Vous êtes dans un département que vous n’affichez pas (${nomDepartement(dept)}). ` +
          'Ajoutez-le depuis Profil → Mon territoire.'
      return
    }

    geoMsg.textContent = ''
    center = located
    // Statistique de provenance : le DÉPARTEMENT observé, jamais la position.
    tagVisitDept(dept)
    userMarker.setLatLng([center.lat, center.lng]).addTo(map)
    cadrerSurPosition()
    await loadEvents()
  })

  // setTimeout plutôt que requestAnimationFrame : rAF est gelé quand l'onglet
  // n'est pas visible (app ouverte en arrière-plan) et la carte ne se construisait
  // jamais. Le dimensionnement est géré par invalidateSize + ResizeObserver.
  setTimeout(() => {
    initMap().catch((e) => {
      count.textContent = 'Carte indisponible : ' + e.message
    })
  }, 0)

  return wrap
}

/** Motif SVG discret appliqué uniquement à l'extérieur du contour départemental. */
function applyDepartmentMaskPattern(layer) {
  const path = layer.getElement()
  const svg = path?.ownerSVGElement
  if (!path || !svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let defs = svg.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(ns, 'defs')
    svg.prepend(defs)
  }
  const pattern = document.createElementNS(ns, 'pattern')
  pattern.id = 'department-04-outside-pattern'
  pattern.setAttribute('patternUnits', 'userSpaceOnUse')
  pattern.setAttribute('width', '132')
  pattern.setAttribute('height', '118')
  pattern.innerHTML = `
    <rect width="132" height="118" fill="#0b55c5"/>
    <image href="/icons/armana-logo.png" x="8" y="8" width="46" height="46" opacity=".9" transform="rotate(-9 31 31)"/>
    <image href="/icons/armana-logo.png" x="74" y="61" width="39" height="39" opacity=".72" transform="rotate(11 93 80)"/>
  `
  defs.appendChild(pattern)
  path.setAttribute('fill', 'url(#department-04-outside-pattern)')
  path.setAttribute('fill-opacity', '1')
}

/**
 * Fondu du motif le long de la frontière, pour laisser respirer la carte.
 *
 * Coupé net, le masque tranchait les noms de villes posés SUR la frontière —
 * Marseille, Toulon, Avignon. Le motif ne commence donc plus à la frontière :
 * il démarre une vingtaine de pixels plus loin et monte en puissance sur une
 * quarantaine. La bande ainsi dégagée montre la carte en clair.
 *
 * ⚠ ON NE FLOUTE QUE LES FRONTIÈRES, JAMAIS LE MASQUE LUI-MÊME.
 * Non pour le coût — Leaflet découpe déjà son tracé à la vue, vérifié : le
 * cadre du masque mesure 412 × 782 px pour une vue de 406 × 776, et son `d`
 * commence par un simple rectangle aux dimensions de l'écran. Mais parce que
 * ce rectangle EST le bord de l'écran : le flouter dégraderait le motif tout
 * autour du cadre de la carte, pas seulement le long des départements.
 * D'où le découpage du `d` ci-dessous : le premier sous-tracé est ce
 * rectangle, on le jette et on ne garde que les frontières.
 *
 * Le trait noir de 34 px creuse le trou de 17 px vers l'extérieur AVANT le
 * flou : sans lui, le fondu serait centré sur la frontière et voilerait
 * l'intérieur du territoire, exactement ce qu'on cherche à éviter.
 */
function appliquerFonduDeBord(map, layer) {
  const path = layer.getElement()
  const svg = path?.ownerSVGElement
  const defs = svg?.querySelector('defs')
  if (!path || !svg || !defs) return
  const ns = 'http://www.w3.org/2000/svg'

  const filtre = document.createElementNS(ns, 'filter')
  filtre.id = 'territoire-flou'
  /**
   * ⚠ RÉGION EN PIXELS, JAMAIS EN POURCENTAGE.
   *
   * Un filtre est COUPÉ NET aux bords de sa région. Exprimée en pourcentage du
   * cadre des frontières (`-10% / 120%`), cette région rétrécit avec le
   * territoire : une fois dézoomé, ses 10 % valaient moins que la portée du
   * flou (17 px de trait + ~33 px d'étalement), qui se retrouvait tranché — de
   * grands rectangles apparaissaient autour du territoire. Invisible zoomé,
   * flagrant dézoomé, exactement ce que Matthieu a vu.
   *
   * La région suit donc la VUE, en pixels, comme le masque : recalée dans
   * `suivre()`, avec la même marge. Ce qui serait coupé l'est alors largement
   * hors de l'écran.
   */
  filtre.setAttribute('filterUnits', 'userSpaceOnUse')
  filtre.innerHTML = '<feGaussianBlur stdDeviation="11"/>'

  // Masque de luminance : blanc = motif visible, noir = motif effacé.
  const masque = document.createElementNS(ns, 'mask')
  masque.id = 'territoire-fondu'
  masque.setAttribute('maskUnits', 'userSpaceOnUse')
  const fond = document.createElementNS(ns, 'rect')
  fond.setAttribute('fill', '#fff')
  const bord = document.createElementNS(ns, 'path')
  bord.setAttribute('fill', '#000')
  bord.setAttribute('fill-rule', 'evenodd')
  bord.setAttribute('stroke', '#000')
  bord.setAttribute('stroke-width', FONDU_DE_BORD ? '34' : String(MARGE_BORD_PX * 2))
  bord.setAttribute('stroke-linejoin', 'round')
  if (FONDU_DE_BORD) bord.setAttribute('filter', 'url(#territoire-flou)')
  masque.append(fond, bord)

  /**
   * Le filet jaune, au BORD DU MOTIF et non sur la frontière : un anneau de
   * FILET_PX pris entre la marge (noir) et la marge + le filet (blanc). Il ne
   * passe donc jamais sur les noms posés près de la frontière.
   */
  const masqueFilet = document.createElementNS(ns, 'mask')
  masqueFilet.id = 'territoire-filet'
  masqueFilet.setAttribute('maskUnits', 'userSpaceOnUse')
  const filetExterieur = document.createElementNS(ns, 'path')
  filetExterieur.setAttribute('fill', '#fff')
  filetExterieur.setAttribute('fill-rule', 'evenodd')
  filetExterieur.setAttribute('stroke', '#fff')
  filetExterieur.setAttribute('stroke-width', String((MARGE_BORD_PX + FILET_PX) * 2))
  filetExterieur.setAttribute('stroke-linejoin', 'round')
  const filetInterieur = document.createElementNS(ns, 'path')
  filetInterieur.setAttribute('fill', '#000')
  filetInterieur.setAttribute('fill-rule', 'evenodd')
  filetInterieur.setAttribute('stroke', '#000')
  filetInterieur.setAttribute('stroke-width', String(MARGE_BORD_PX * 2))
  filetInterieur.setAttribute('stroke-linejoin', 'round')
  masqueFilet.append(filetExterieur, filetInterieur)
  const filet = document.createElementNS(ns, 'rect')
  filet.setAttribute('fill', '#f4ca15')
  filet.setAttribute('mask', 'url(#territoire-filet)')
  filet.style.pointerEvents = 'none'
  if (!FONDU_DE_BORD && FILET_PX > 0) path.after(filet)

  /**
   * Découpe « tout sauf le territoire », qui sert au liseré jaune.
   *
   * Un trait SVG est CENTRÉ sur son tracé : la moitié de ses 4 px mordait donc
   * à l'intérieur du département, pile là où la carte pose les noms de villes.
   * Marseille et Avignon, posées sur leur frontière, se retrouvaient barrées.
   * On dessine désormais un trait deux fois plus épais, rogné à l'extérieur :
   * l'épaisseur vue est la même, mais plus rien n'empiète sur le territoire.
   *
   * Même géométrie que le masque — monde plus départements, règle `evenodd` —
   * mais sur une COPIE : viser le tracé du masque, qui porte lui-même ce
   * découpage, créerait une référence circulaire que le navigateur ignore.
   */
  const decoupe = document.createElementNS(ns, 'clipPath')
  decoupe.id = 'territoire-dehors'
  decoupe.setAttribute('clipPathUnits', 'userSpaceOnUse')
  const dehors = document.createElementNS(ns, 'path')
  dehors.setAttribute('clip-rule', 'evenodd')
  decoupe.appendChild(dehors)

  defs.append(filtre, masque, masqueFilet, decoupe)
  path.setAttribute('mask', 'url(#territoire-fondu)')

  /**
   * Le `d` du masque et les coordonnées de l'écran changent à chaque zoom : on
   * les recopie. Un masque plus petit que la vue rendrait le motif INVISIBLE
   * au-delà de ses bornes — d'où la marge, et le recalage sur la vue réelle.
   */
  const suivre = () => {
    const d = path.getAttribute('d') || ''
    const sousTraces = d.split('M').filter((s) => s.trim())
    const frontieres = sousTraces.length > 1 ? 'M' + sousTraces.slice(1).join('M') : ''
    bord.setAttribute('d', frontieres)
    filetExterieur.setAttribute('d', frontieres)
    filetInterieur.setAttribute('d', frontieres)
    dehors.setAttribute('d', d)

    const vue = map.getPixelBounds()
    const origine = map.getPixelOrigin()
    const marge = 300
    const boite = {
      x: vue.min.x - origine.x - marge,
      y: vue.min.y - origine.y - marge,
      width: vue.max.x - vue.min.x + marge * 2,
      height: vue.max.y - vue.min.y + marge * 2,
    }
    for (const [cle, valeur] of Object.entries(boite)) {
      masque.setAttribute(cle, String(valeur))
      fond.setAttribute(cle, String(valeur))
      filtre.setAttribute(cle, String(valeur))
      masqueFilet.setAttribute(cle, String(valeur))
      filet.setAttribute(cle, String(valeur))
    }
  }
  suivre()
  map.on('zoomend viewreset moveend', suivre)
}
