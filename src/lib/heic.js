// Armana — accepter les photos que le navigateur ne sait pas lire (HEIC/HEIF).
//
// LE PROBLÈME
// Les iPhone, et désormais beaucoup de Samsung, enregistrent en HEIC. Aucun
// navigateur ne sait décoder ce format, sauf Safari. Sur Android, choisir une
// telle photo échouait donc — signalé par une utilisatrice, et probablement
// subi en silence par d'autres.
//
// ⚠ POURQUOI LA PREMIÈRE TENTATIVE RESTAIT BLOQUÉE
// Le décodeur employé (heic2any) fait trois `new Function` et lance ses Workers
// depuis des URL `blob:`. Notre politique de sécurité en production
// (`script-src 'self' 'unsafe-inline'`, sans `worker-src`) interdisait les
// deux : le Worker ne démarrait jamais, sa promesse ne se résolvait jamais, et
// l'écran restait indéfiniment sur « Conversion… ». Ce n'était donc pas de la
// lenteur mais un blocage franc — invisible en développement, où le serveur
// Vite n'applique aucune de ces règles.
//
// Corrigé sur trois fronts :
//   1. `worker-src 'self' blob:` ajouté à la politique (vercel.json) ;
//   2. décodeur remplacé par la variante SANS `eval` de heic-to (libheif
//      compilé, pas d'asm.js) ;
//   3. délai de garde ici — quoi qu'il arrive en dessous, l'interface ne peut
//      plus rester figée.
//
// Le décodage reste LOCAL, jamais un service en ligne : la contrainte du projet
// est le gratuit total, et une affiche n'a rien à faire chez un tiers.

const EXT_HEIC = /\.(heic|heif)$/i

// Une photo de 12 Mpx sur un téléphone modeste prend une dizaine de secondes.
// Au-delà d'une minute, quelque chose ne va pas : mieux vaut l'admettre et
// proposer une porte de sortie que laisser tourner indéfiniment.
const DELAI_MAX_MS = 60000

class EchecConversion extends Error {}

function nomJpeg(file) {
  return (file?.name || 'photo').replace(EXT_HEIC, '') + '.jpg'
}

/** Le navigateur sait-il afficher ce fichier tel quel ? */
function lisibleParLeNavigateur(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const fin = (ok) => {
      URL.revokeObjectURL(url)
      resolve(ok)
    }
    img.onload = () => fin(true)
    img.onerror = () => fin(false)
    img.src = url
  })
}

function ressembleAduHeic(file) {
  const type = (file?.type || '').toLowerCase()
  // ⚠ Le type MIME est souvent VIDE pour ces fichiers selon le sélecteur
  // Android : se fier au seul type reviendrait à ne jamais convertir.
  return type.includes('heic') || type.includes('heif') || EXT_HEIC.test(file?.name || '')
}

/**
 * Une COPIE en mémoire du fichier choisi, faite tout de suite.
 *
 * ⚠ SUR ANDROID, UNE PHOTO CHOISIE N'EST LISIBLE QUE TANT QUE LE SÉLECTEUR LA
 * TIENT. Le fichier renvoyé pointe vers la galerie du téléphone ; une fois le
 * champ vidé (la galerie d'une fiche le vidait aussitôt) ou après un long
 * moment, le relire échoue. L'aperçu passait, puis l'envoi, fait bien plus
 * tard à l'enregistrement, tombait sur « Image illisible » — signalé par un
 * food truck le 16/10/2026, sur plusieurs photos. Copier les octets dès le
 * choix rend la photo indépendante du sélecteur.
 */
async function copieEnMemoire(file) {
  try {
    const octets = await file.arrayBuffer()
    return new File([octets], file.name || 'photo', {
      type: file.type || '',
      lastModified: file.lastModified || Date.now(),
    })
  } catch {
    throw new Error(
      'le téléphone n’a pas donné accès à cette photo. Réessayez, ou choisissez-la ' +
        'depuis « Fichiers » plutôt que depuis la galerie.'
    )
  }
}

/** Aucune promesse ne doit pouvoir rester en suspens pour toujours. */
function avecDelai(promesse, ms) {
  let minuteur
  const garde = new Promise((_, ko) => {
    minuteur = setTimeout(
      () => ko(new EchecConversion('la conversion a pris trop de temps')),
      ms
    )
  })
  return Promise.race([promesse, garde]).finally(() => clearTimeout(minuteur))
}

/**
 * Raccourci gratuit : certains appareils décodent le HEIC nativement, via les
 * codecs du système. Quand c'est le cas, c'est instantané et rien n'est
 * téléchargé. Sinon on renvoie null sans faire d'histoires.
 */
async function viaDecodeurNatif(file) {
  if (typeof ImageDecoder === 'undefined') return null
  const type = file.type && file.type !== '' ? file.type : 'image/heic'
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null
  } catch {
    return null
  }
  try {
    const decodeur = new ImageDecoder({ data: await file.arrayBuffer(), type })
    const { image } = await decodeur.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.displayWidth
    canvas.height = image.displayHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    image.close?.()
    decodeur.close?.()
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
    return blob ? new File([blob], nomJpeg(file), { type: 'image/jpeg' }) : null
  } catch {
    return null
  }
}

/** Décodage par bibliothèque, chargée seulement à cet instant. */
async function viaBibliotheque(file) {
  // ⚠ Variante « csp » IMPÉRATIVE : la version standard emploie `new Function`,
  // que notre politique de sécurité interdit — elle échouerait en production
  // tout en marchant en développement.
  const { heicTo } = await import('heic-to/csp')
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
  if (!blob) throw new EchecConversion('conversion sans résultat')
  return new File([blob], nomJpeg(file), { type: 'image/jpeg' })
}

/**
 * Renvoie un fichier que le navigateur sait afficher, en convertissant si
 * nécessaire. Lève une erreur explicite — jamais de blocage silencieux.
 * @param {File} file
 * @param {(etape: string) => void} [onProgres] la conversion prend plusieurs
 *        secondes : il faut le dire, sinon l'écran paraît figé.
 * @returns {Promise<File>}
 */
export async function toDisplayableFile(file, onProgres) {
  if (!file) return file
  file = await copieEnMemoire(file)
  if (await lisibleParLeNavigateur(file)) return file

  if (!ressembleAduHeic(file)) {
    throw new Error(
      'ce format d’image n’est pas reconnu. Essayez avec une photo au format JPEG ou PNG.'
    )
  }

  onProgres?.('Conversion de la photo…')

  const natif = await viaDecodeurNatif(file).catch(() => null)
  if (natif) return natif

  try {
    return await avecDelai(viaBibliotheque(file), DELAI_MAX_MS)
  } catch (e) {
    const cause = e instanceof EchecConversion ? ` (${e.message})` : ''
    throw new Error(
      `cette photo au format HEIC n’a pas pu être convertie${cause}. ` +
        'Sur votre téléphone, ouvrez-la dans la galerie et partagez-la vers Armana, ' +
        'ou enregistrez-la en JPEG, puis réessayez.'
    )
  }
}
