// Armana — le menu d'un food truck : une liste de plats, chacun avec son prix.
//
// Stocké dans la colonne texte `fiches.menu`, une ligne par plat :
// « Burger maison — 12 € ». Le formulaire écrit TOUJOURS ce format ; la
// lecture, elle, sait aussi démêler un menu tapé d'un seul tenant avant
// l'éditeur structuré (« Souris Farsi, 14 € Souris fraîche, 8 € … »), pour
// que toutes les fiches s'affichent de la même façon, plat par plat.

export const MENU_MAX_PLATS = 30

/** Un prix lisible : 8 → « 8 € », 8.5 → « 8,50 € ». */
export function formatPrix(n) {
  if (!Number.isFinite(n)) return ''
  return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €'
}

/**
 * @param {string} texte
 * @returns {{plat:string, prix:number|null}[]}
 */
export function lireMenu(texte) {
  const out = []
  for (const brute of String(texte || '').split('\n')) {
    const ligne = brute.trim()
    if (!ligne) continue
    // Tous les « nom … prix € » de la ligne : un seul d'ordinaire, plusieurs
    // quand le menu a été tapé à la suite.
    const motif = /(.+?)[\s,;:·—–-]*?(\d+(?:[.,]\d{1,2})?)\s*€/g
    let m
    let fin = 0
    let trouve = false
    while ((m = motif.exec(ligne))) {
      const plat = nettoyer(m[1])
      if (plat) out.push({ plat, prix: Number(m[2].replace(',', '.')) })
      fin = motif.lastIndex
      trouve = true
    }
    const reste = nettoyer(trouve ? ligne.slice(fin) : ligne)
    if (reste) out.push({ plat: reste, prix: null })
  }
  return out.slice(0, MENU_MAX_PLATS)
}

/** @param {{plat:string, prix:number|null}[]} plats */
export function ecrireMenu(plats) {
  return plats
    .map((p) => ({ plat: nettoyer(p.plat), prix: p.prix }))
    .filter((p) => p.plat)
    .slice(0, MENU_MAX_PLATS)
    .map((p) => (Number.isFinite(p.prix) ? `${p.plat} — ${formatPrix(p.prix)}` : p.plat))
    .join('\n')
}

function nettoyer(s) {
  return String(s || '')
    .replace(/^[\s,;:·—–-]+|[\s,;:·—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}
