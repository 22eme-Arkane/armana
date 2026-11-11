// Cadrage interactif d'une photo dans une boîte d'aperçu.
//
// L'utilisateur glisse pour déplacer et pince (ou molette) pour zoomer : ce qu'il
// voit dans l'aperçu est EXACTEMENT ce que la vignette de l'agenda affichera.
//
// Modèle : on garde le rectangle visible en PIXELS DE LA PHOTO SOURCE
// ({sx, sy, sw, sh}). C'est directement ce qu'attend ctx.drawImage() au moment de
// fabriquer la vignette — aucune conversion approximative entre CSS et canvas.
//
// ⚠ PIÈGE CORRIGÉ (retour de Matthieu) : tant que le zoom minimal était le
// cadrage « couvrir », une photo PORTRAIT dans une carte LARGE n'avait aucun jeu
// horizontal — sa largeur remplissait exactement le cadre. Le glissement
// gauche/droite ne pouvait rien faire, et les affiches paraissaient mal centrées.
// On autorise donc le dézoom jusqu'à « photo entière » : la photo devient plus
// étroite que le cadre, elle peut alors coulisser librement, et les bandes
// découvertes sont comblées par un fond flouté (voir `paint()` dans lib/image.js).

const MAX_ZOOM = 4

// En deçà de ce rapport, « couvrir » amputerait l'essentiel de l'image : on
// ouvre alors directement sur la photo entière (cas typique d'une affiche
// portrait dans la carte large de l'agenda).
const SEUIL_PHOTO_ENTIERE = 0.62

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

/**
 * @param {HTMLElement} box conteneur (overflow:hidden, position:relative)
 * @param {HTMLImageElement} img image à cadrer, enfant de `box`
 */
export function createPhotoFramer(box, img) {
  const state = { zoom: 1, sx: 0, sy: 0, w: 0, h: 0 }
  const pointers = new Map()
  let pinchDist = 0
  let objectUrl = null

  box.style.touchAction = 'none' // sinon le glissement fait défiler la page
  box.style.cursor = 'grab'

  const pret = () => box.clientWidth && box.clientHeight && state.w && state.h

  /** Échelle qui remplit la boîte (déborde sur un axe). */
  function coverScale() {
    return Math.max(box.clientWidth / state.w, box.clientHeight / state.h)
  }

  /** Échelle qui fait tenir la photo ENTIÈRE dans la boîte. */
  function containScale() {
    return Math.min(box.clientWidth / state.w, box.clientHeight / state.h)
  }

  /** Zoom minimal autorisé : 1 = couvrir, en dessous = photo entière. */
  function minZoom() {
    if (!pret()) return 1
    return containScale() / coverScale()
  }

  /** Échelle d'affichage : « couvrir la boîte » × zoom utilisateur. */
  function scale() {
    if (!pret()) return 0
    return coverScale() * state.zoom
  }

  /**
   * Borne une coordonnée de cadrage sur un axe.
   * - photo plus grande que la fenêtre → le cadre reste à l'intérieur ;
   * - photo plus petite (dézoom) → elle coulisse librement dans le cadre sans
   *   jamais en sortir. C'est ce second cas qui rend possible le déplacement
   *   horizontal d'une affiche portrait.
   */
  function clampAxis(v, total, visible) {
    return visible <= total ? clamp(v, 0, total - visible) : clamp(v, total - visible, 0)
  }

  function apply() {
    const s = scale()
    if (!s) return
    state.sx = clampAxis(state.sx, state.w, box.clientWidth / s)
    state.sy = clampAxis(state.sy, state.h, box.clientHeight / s)
    img.style.position = 'absolute'
    img.style.maxWidth = 'none'
    img.style.objectFit = 'fill' // dimensions déjà proportionnelles : aucun recadrage implicite
    img.style.width = state.w * s + 'px'
    img.style.height = state.h * s + 'px'
    img.style.left = -state.sx * s + 'px'
    img.style.top = -state.sy * s + 'px'
  }

  /** Zoom en gardant fixe le centre de la zone visible. */
  function setZoom(z) {
    const s0 = scale()
    if (!s0) return
    const cx = state.sx + box.clientWidth / s0 / 2
    const cy = state.sy + box.clientHeight / s0 / 2
    state.zoom = clamp(z, minZoom(), MAX_ZOOM)
    const s1 = scale()
    state.sx = cx - box.clientWidth / s1 / 2
    state.sy = cy - box.clientHeight / s1 / 2
    apply()
  }

  /** Cadrage centré sur la photo (et non calé en haut à gauche). */
  function centerCrop() {
    const s = scale()
    if (!s) {
      state.sx = 0
      state.sy = 0
      return
    }
    state.sx = (state.w - box.clientWidth / s) / 2
    state.sy = (state.h - box.clientHeight / s) / 2
  }

  /** Cadrage d'ouverture : photo entière si « couvrir » la mutilerait. */
  function initialZoom() {
    const mz = minZoom()
    return mz < SEUIL_PHOTO_ENTIERE ? mz : 1
  }

  function panBy(dx, dy) {
    const s = scale()
    if (!s) return
    state.sx -= dx / s
    state.sy -= dy / s
    apply()
  }

  // --- Gestes ---------------------------------------------------------------
  const onDown = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) pinchDist = distance()
    box.setPointerCapture?.(e.pointerId)
    box.style.cursor = 'grabbing'
  }

  const onMove = (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    e.preventDefault()
    const next = { x: e.clientX, y: e.clientY }
    pointers.set(e.pointerId, next)

    if (pointers.size >= 2) {
      const d = distance()
      if (pinchDist > 0 && d > 0) setZoom(state.zoom * (d / pinchDist))
      pinchDist = d
      return
    }
    panBy(next.x - prev.x, next.y - prev.y)
  }

  const onUp = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDist = 0
    if (!pointers.size) box.style.cursor = 'grab'
  }

  const onWheel = (e) => {
    if (!state.w) return
    e.preventDefault()
    setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
  }

  function distance() {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  box.addEventListener('pointerdown', onDown)
  box.addEventListener('pointermove', onMove, { passive: false })
  box.addEventListener('pointerup', onUp)
  box.addEventListener('pointercancel', onUp)
  box.addEventListener('wheel', onWheel, { passive: false })

  // La boîte d'aperçu est fluide (largeur de l'écran) : on recalcule au besoin.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => apply()) : null
  ro?.observe(box)

  return {
    /** Charge un fichier local et réinitialise le cadrage. */
    async setFile(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(file)
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('Image illisible'))
        img.src = objectUrl
      })
      state.w = img.naturalWidth
      state.h = img.naturalHeight
      state.zoom = initialZoom()
      centerCrop()
      apply()
    },
    /**
     * Vide le cadreur : l'aperçu montre autre chose qu'un fichier à cadrer (la
     * photo déjà en ligne d'un événement qu'on modifie). L'image retrouve le
     * style de la carte — sans cela, les dimensions posées par `apply()`
     * resteraient collées à la photo suivante.
     */
    clear() {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = null
      state.w = 0
      state.h = 0
      img.onload = null
      img.onerror = null
      for (const p of ['position', 'maxWidth', 'objectFit', 'width', 'height', 'left', 'top']) img.style[p] = ''
    },
    zoomBy(factor) {
      setZoom(state.zoom * factor)
    },
    /** Dézoom maximal : toute la photo tient dans la carte. */
    fitWhole() {
      setZoom(minZoom())
      centerCrop()
      apply()
    },
    /** Cadrage « couvrir » : la photo remplit la carte, quitte à être rognée. */
    fillCard() {
      setZoom(1)
      centerCrop()
      apply()
    },
    reset() {
      state.zoom = initialZoom()
      centerCrop()
      apply()
    },
    /** État courant — sert à adapter le message d'aide sous l'aperçu. */
    info() {
      const s = scale()
      if (!s) return { pannableX: false, pannableY: false, whole: false }
      const vw = box.clientWidth / s
      const vh = box.clientHeight / s
      return {
        // Un axe est déplaçable dès qu'il y a du jeu, dans un sens ou dans l'autre.
        pannableX: Math.abs(state.w - vw) > 1,
        pannableY: Math.abs(state.h - vh) > 1,
        whole: state.zoom <= minZoom() + 0.001,
      }
    },
    /** Rectangle visible en pixels source — prêt pour ctx.drawImage(). */
    getCrop() {
      const s = scale()
      if (!s) return null
      return {
        sx: state.sx,
        sy: state.sy,
        sw: box.clientWidth / s,
        sh: box.clientHeight / s,
      }
    },
    destroy() {
      box.removeEventListener('pointerdown', onDown)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', onUp)
      box.removeEventListener('pointercancel', onUp)
      box.removeEventListener('wheel', onWheel)
      ro?.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    },
  }
}
