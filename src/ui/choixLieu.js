// Armana — choix d'un lieu SANS CHAMP LIBRE : la commune se CHOISIT dans la
// liste officielle (voir rechercheCommune.js), puis on touche la mini-carte
// pour l'emplacement exact (facultatif — le centre de la commune sinon).
//
// ⚠ DEMANDE DE MATTHIEU (15/10/2026) : rien de saisi à la main dans le
// planning des food trucks, pour qu'aucune fausse information ne s'y écrive.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../lib/leafletIcons.js'
import { el } from './components.js'
import { rechercheCommune } from './rechercheCommune.js'

/**
 * @param {{lat?:number, lng?:number, label?:string}} depart  lieu déjà connu
 * @returns {{wrap:HTMLElement, valeur:()=>({lat:number,lng:number,label:string}|null)}}
 */
export function choixLieu(depart = {}) {
  const wrap = el('div', 'form__field choix-lieu')
  wrap.appendChild(el('span', 'form__label', 'Commune *'))

  const cadre = el('div', 'choix-lieu__carte')
  const aide = el('span', 'form__hint', '')
  let point = Number.isFinite(depart.lat) ? { lat: depart.lat, lng: depart.lng } : null
  let map = null
  let marqueur = null

  const commune = rechercheCommune({
    onChoix: (c) => {
      peindre()
      if (!c) return
      initCarte(c)
      poserPoint(c.lat, c.lng, true)
    },
  })
  wrap.append(commune.wrap, cadre, aide)

  function peindre() {
    const c = commune.valeur()
    cadre.hidden = !c
    aide.textContent = c ? 'Touchez la carte pour l’emplacement exact (place, parking…).' : ''
    if (c) setTimeout(() => map?.invalidateSize(), 0)
  }

  function poserPoint(lat, lng, recentrer) {
    point = { lat, lng }
    if (!map) return
    if (!marqueur) {
      marqueur = L.marker([lat, lng], { draggable: true }).addTo(map)
      marqueur.on('dragend', () => {
        const p = marqueur.getLatLng()
        point = { lat: p.lat, lng: p.lng }
      })
    } else {
      marqueur.setLatLng([lat, lng])
    }
    if (recentrer) map.setView([lat, lng], 14)
  }

  function initCarte(centre) {
    if (map) return
    map = L.map(cadre, { minZoom: 7 }).setView([centre.lat, centre.lng], 14)
    map.attributionControl.setPrefix(false)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      keepBuffer: 2,
      attribution: '© OpenStreetMap',
    }).addTo(map)
    map.on('click', (e) => poserPoint(e.latlng.lat, e.latlng.lng, false))
    setTimeout(() => map.invalidateSize(), 120)
  }

  // Lieu déjà connu (modification) : la commune s'affiche, la carte s'ouvre
  // sur le point enregistré. setTimeout : rAF est gelé onglet caché.
  if (depart.label && point) {
    commune.choisir({ nom: depart.label }, true)
    peindre()
    setTimeout(() => {
      initCarte(point)
      poserPoint(point.lat, point.lng, false)
    }, 0)
  } else {
    peindre()
  }

  return {
    wrap,
    valeur: () => {
      const c = commune.valeur()
      return c && point ? { ...point, label: c.nom } : null
    },
  }
}
