// Armana — décrire l'appareil en quelques mots (« Android · Chrome · app
// installée »), joint à un message « Nous contacter » pour comprendre un bug.
//
// ⚠ VOLONTAIREMENT GROSSIER : système, navigateur, app installée ou non. Pas
// d'empreinte détaillée (modèle exact, version complète) — c'est tout ce qu'il
// faut pour reproduire un problème, et rien de plus.

export function decrireAppareil() {
  const ua = navigator.userAgent || ''
  const systeme = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'autre système'
  const navigateur = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'navigateur inconnu'
  let installee = false
  try {
    installee =
      window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  } catch {
    /* sans effet */
  }
  return [systeme, navigateur, installee ? 'app installée' : 'site web'].join(' · ')
}
