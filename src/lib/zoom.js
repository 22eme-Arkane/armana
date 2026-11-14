// Armana — pas de zoom de PAGE (14/11/2026).
//
// Matthieu : sur iPhone, l'application « débordait sur la droite, il fallait
// dézoomer ». Deux causes :
//   1. les champs de Publier et de Connexion sont en 15,2 px ; sous 16 px,
//      Safari agrandit la page au toucher d'un champ, et elle RESTE agrandie.
//      → `maximum-scale=1` dans la balise viewport (index.html) ;
//   2. un pincement par mégarde. Safari passe outre `user-scalable=no` depuis
//      iOS 10 : il faut refuser le geste lui-même → ce module.
// Mesuré le 14/11/2026 de 320 à 430 px sur tous les écrans : aucun élément ne
// déborde de lui-même ; c'était bien le zoom.
//
// ⚠ LA CARTE ET LE CADRAGE DES PHOTOS GARDENT LEUR PINCEMENT. Ils le gèrent
// eux-mêmes (événements tactiles, pointeurs) et n'ont pas besoin des gestes
// propres à Safari que l'on bloque ici — mais on les laisse passer quand même
// dans ces zones, par prudence.
// (Le cadrage photo, ui/photoFramer.js, pose lui-même `data-zoom-libre`.)
const ZONES_LIBRES = '.leaflet-container, .maplibregl-map, [data-zoom-libre]'

const surGeste = (e) => {
  if (e.target?.closest?.(ZONES_LIBRES)) return
  e.preventDefault()
}

let installe = false

export function bloquerZoomPage() {
  if (installe) return
  installe = true
  // Seul Safari (iPhone, iPad) passe outre la balise viewport. Ailleurs —
  // Android en tête — elle suffit, et un écouteur `touchmove` non passif sur
  // tout le document ralentirait le défilement pour rien.
  if (!('ongesturestart' in window)) return
  // Le pincement passe par ces gestes propres à Safari…
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, surGeste, { passive: false })
  }
  // … et, par sûreté, par un glissement à deux doigts hors de la carte.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length < 2 || e.target?.closest?.(ZONES_LIBRES)) return
      e.preventDefault()
    },
    { passive: false }
  )
}
