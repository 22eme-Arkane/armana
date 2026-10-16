// Armana — « Ma fiche » : créer ou modifier la fiche d'un lieu culturel ou d'un
// food truck (migration 0033).
//
// Une fiche naît EN ATTENTE ; toute retouche la renvoie en relecture. C'est
// imposé en base : l'écran se contente de l'annoncer clairement, pour qu'on ne
// croie pas sa fiche publiée alors qu'elle attend un modérateur.
import { el, loginPrompt } from './components.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { getProfile, getUser, isLoggedIn } from '../lib/auth.js'
import { toDisplayableFile } from '../lib/heic.js'
import { geocodeAddress } from '../lib/geo.js'
import { choixLieu } from './choixLieu.js'
import './planning.css'
import { menuEditeur } from './menuEditeur.js'
import {
  GALERIE_MAX,
  LIMITES,
  effacerPhotosGalerie,
  envoyerGalerie,
  enregistrerFiche,
  envoyerPhotoFiche,
  getMaFiche,
  retirerPhotoProduit,
  supprimerMaFiche,
} from '../lib/fiches.js'

const ETATS = {
  pending: {
    classe: 'fiche-etat--attente',
    texte: 'En attente de validation. Un modérateur va la relire ; elle sera visible de tous ensuite.',
  },
  approved: { classe: 'fiche-etat--publiee', texte: 'Publiée : tout le monde peut la voir.' },
  rejected: {
    classe: 'fiche-etat--refusee',
    texte: 'Refusée par un modérateur. Corrigez-la puis enregistrez : elle repartira en relecture.',
  },
}

export async function viewFicheEdit() {
  const wrap = el('section', 'page page--studio-sub page--fiche-edit')
  wrap.appendChild(studioHeader('Ma fiche', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour créer la fiche de votre lieu ou de votre food truck.'))
    return wrap
  }

  let fiche = await getMaFiche()
  // Le type vient de la fiche si elle existe, sinon du profil — ou, juste après
  // l'inscription, des métadonnées (le profil n'est pas encore à jour).
  const typeProfil = getProfile()?.account_type
  const typeInscription = getUser()?.user_metadata?.account_type
  const kind =
    fiche?.kind ||
    (['lieu', 'food_truck'].includes(typeProfil) ? typeProfil : null) ||
    (['lieu', 'food_truck'].includes(typeInscription) ? typeInscription : null)

  if (!kind) {
    wrap.appendChild(
      el(
        'p',
        'page__subtitle',
        'Les fiches sont réservées aux lieux culturels et aux food trucks. ' +
          'Choisissez votre type de compte dans « Mon profil ».'
      )
    )
    const aller = el('button', 'btn btn--primary btn--block', 'Ouvrir Mon profil')
    aller.type = 'button'
    aller.addEventListener('click', () => navigate('/mon-profil'))
    wrap.appendChild(aller)
    return wrap
  }

  const estTruck = kind === 'food_truck'
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      estTruck
        ? 'La vitrine de votre camion : ce que vous cuisinez, votre menu, comment vous joindre.'
        : 'La vitrine de votre lieu : ce qu’on y trouve, quand c’est ouvert, comment venir.'
    )
  )

  const etat = el('p', 'fiche-etat')
  const peindreEtat = () => {
    if (!fiche) {
      etat.hidden = true
      return
    }
    etat.hidden = false
    etat.className = 'fiche-etat ' + ETATS[fiche.status].classe
    etat.textContent = ETATS[fiche.status].texte
    if (fiche.status === 'approved') {
      const voir = el('a', 'fiche-etat__lien', 'Voir ma fiche')
      voir.href = '#/fiche?id=' + fiche.id
      etat.appendChild(document.createTextNode(' '))
      etat.appendChild(voir)
    }
  }
  peindreEtat()
  wrap.appendChild(etat)

  // Le planning, en tête : une fois la fiche faite, c'est lui qu'on vient
  // chercher ici. Il suppose une fiche enregistrée (il s'y rattache).
  const planning = el('button', 'btn btn--primary btn--block', 'Mon planning de la semaine')
  planning.type = 'button'
  planning.hidden = !(estTruck && fiche)
  planning.addEventListener('click', () => navigate('/mon-planning'))
  wrap.appendChild(planning)

  const form = el('form', 'form')

  // --- Photos ---------------------------------------------------------------
  let nouvellePhoto = null
  let nouveauProduit = null
  const photo = champPhoto(
    estTruck ? 'Photo du camion' : 'Photo du lieu',
    fiche?.photo_url,
    (f) => (nouvellePhoto = f)
  )
  form.appendChild(photo.wrap)

  // --- Textes -----------------------------------------------------------------
  const nom = champ('Nom *', 'input', fiche?.name, LIMITES.name, estTruck ? 'Le nom du camion' : 'Le nom du lieu')
  nom.input.required = true
  nom.input.minLength = 2
  form.appendChild(nom.wrap)

  let cuisine = null
  if (estTruck) {
    cuisine = champ('Cuisine', 'input', fiche?.cuisine, LIMITES.cuisine, 'Pizzas au feu de bois, burgers, crêpes…')
    form.appendChild(cuisine.wrap)
  }

  const description = champ(
    'Description',
    'textarea',
    fiche?.description,
    LIMITES.description,
    estTruck ? 'Votre histoire, vos produits, ce qui vous rend unique' : 'Ce qu’on y voit, ce qu’on y fait, l’ambiance'
  )
  form.appendChild(description.wrap)

  // Le menu, PLAT PAR PLAT : un nom et un prix par ligne (Matthieu,
  // 15/10/2026). Tapé d'un bloc, un menu s'affichait d'un bloc — illisible.
  // Puis la photo du menu, juste dessous : elle s'affiche dans la même carte.
  let menu = null
  let produit = null
  if (estTruck) {
    menu = menuEditeur(fiche?.menu)
    form.appendChild(menu.wrap)
    produit = champPhoto('Photo du menu (ardoise, carte)', fiche?.product_photo_url, (f) => (nouveauProduit = f), {
      retirer: fiche?.product_photo_path
        ? async () => {
            fiche = await retirerPhotoProduit(fiche)
          }
        : null,
    })
    form.appendChild(produit.wrap)
  }

  // ⚠ PAS DE CHAMP LIBRE « HORAIRES » POUR UN FOOD TRUCK (Matthieu,
  // 15/10/2026) : un camion n'a pas des horaires d'ouverture mais une tournée
  // — tel jour dans telle commune, à telle heure. Elle se CHOISIT dans « Mon
  // planning » (jours, communes de la liste officielle, heures en menus), et
  // c'est elle que la fiche publique affiche. Un texte libre à côté aurait pu
  // la contredire.
  let horaires = null
  if (estTruck) {
    const bloc = el('div', 'form__field')
    bloc.appendChild(el('span', 'form__label', 'Jours, communes et horaires'))
    bloc.appendChild(
      el(
        'span',
        'form__hint',
        fiche
          ? 'Ils se choisissent dans « Mon planning » (bouton en haut de page) : le lundi ici, le mardi là, avec vos heures.'
          : 'Une fois la fiche envoyée, vous choisirez vos jours, vos communes et vos heures dans « Mon planning ».'
      )
    )
    form.appendChild(bloc)
  } else {
    horaires = champ(
      'Horaires d’ouverture',
      'textarea',
      fiche?.opening_hours,
      LIMITES.opening_hours,
      'Du mercredi au dimanche, 14 h – 19 h'
    )
    form.appendChild(horaires.wrap)
  }

  // L'adresse : celle du lieu, ou la base du camion. Elle sert aussi à savoir
  // quel modérateur relit la fiche (son département).
  // Food truck : la commune de rattachement, CHOISIE dans la liste officielle
  // (pas de champ libre). Elle donne le département, donc le modérateur qui
  // relit la fiche. Un lieu garde son adresse complète, géocodée.
  let adresse = null
  let base = null
  if (estTruck) {
    base = choixLieu(
      fiche?.address && fiche.lat != null ? { lat: fiche.lat, lng: fiche.lng, label: fiche.address } : {}
    )
    base.wrap.querySelector('.form__label').textContent = 'Commune de rattachement'
    form.appendChild(base.wrap)
  } else {
    adresse = champ('Adresse', 'input', fiche?.address, LIMITES.address, 'Rue, ville')
    form.appendChild(adresse.wrap)
  }

  const site = champ('Site internet', 'input', fiche?.website, LIMITES.website, 'www.monsite.fr')
  site.input.inputMode = 'url'
  form.appendChild(site.wrap)

  const contact = champ(
    'Contact',
    'input',
    fiche?.contact,
    LIMITES.contact,
    'Téléphone, e-mail, Instagram…'
  )
  form.appendChild(contact.wrap)

  // « En photo » : jusqu'à quatre photos du camion ou du lieu.
  const galerie = galerieEditeur(fiche, estTruck ? 'Photos du camion' : 'Photos du lieu')
  form.appendChild(galerie.wrap)

  const msg = el('p', 'form__msg')
  const submit = el('button', 'btn btn--primary btn--block', fiche ? 'Enregistrer' : 'Envoyer ma fiche')
  submit.type = 'submit'
  form.appendChild(submit)
  form.appendChild(msg)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Enregistrement…'
    try {
      const champs = {
        kind,
        name: nom.input.value,
        description: description.input.value,
        website: site.input.value,
        contact: contact.input.value,
        // Food truck : l'ancien texte libre est effacé, le planning le remplace.
        opening_hours: horaires ? horaires.input.value : '',
      }
      if (estTruck) {
        champs.cuisine = cuisine.input.value
        champs.menu = menu.valeur()
      }
      // Un point sur la carte seulement si l'adresse a changé : géocoder à
      // chaque enregistrement solliciterait Nominatim pour rien.
      if (base) {
        const l = base.valeur()
        champs.address = l?.label ?? ''
        if (l) Object.assign(champs, { lat: l.lat, lng: l.lng })
        else champs.lat = null
      } else {
        const adr = adresse.input.value.trim()
        champs.address = adr
        if (adr && adr !== (fiche?.address || '')) {
          msg.textContent = 'Recherche de l’adresse…'
          const pos = await geocodeAddress(adr).catch(() => null)
          if (pos) Object.assign(champs, { lat: pos.lat, lng: pos.lng })
        } else if (!adr) {
          champs.lat = null
        }
      }
      // Chaque envoi dit QUELLE photo a échoué : « Image illisible » tout court
      // laissait chercher parmi trois photos et une galerie.
      const envoyer = async (quoi, action) => {
        try {
          return await action()
        } catch (e) {
          throw new Error(`${quoi} n’a pas pu être envoyée (${e.message}). Choisissez-la à nouveau.`)
        }
      }
      if (nouvellePhoto) {
        msg.textContent = 'Envoi de la photo…'
        champs.photo_path = await envoyer('la photo principale', () =>
          envoyerPhotoFiche(nouvellePhoto, 'photo', fiche?.photo_path)
        )
      }
      if (nouveauProduit) {
        msg.textContent = 'Envoi de la photo du menu…'
        champs.product_photo_path = await envoyer('la photo du menu', () =>
          envoyerPhotoFiche(nouveauProduit, 'produit', fiche?.product_photo_path)
        )
      }
      // La galerie n'est envoyée que si elle a changé : sans la migration 0034,
      // la colonne n'existe pas et l'enregistrement entier échouerait.
      const retirees = galerie.retirees()
      if (galerie.aChange()) {
        msg.textContent = 'Envoi des photos…'
        champs.gallery_paths = [
          ...galerie.gardees(),
          ...(await envoyer('une photo de la galerie', () => envoyerGalerie(galerie.nouvelles()))),
        ]
      }
      const premiere = !fiche
      fiche = await enregistrerFiche(champs)
      // Les photos retirées s'effacent APRÈS l'enregistrement : si celui-ci
      // échoue, la fiche garde des photos qui existent encore.
      if (retirees.length) await effacerPhotosGalerie(retirees)
      galerie.reinitialiser(fiche)
      nouvellePhoto = nouveauProduit = null
      submit.textContent = 'Enregistrer'
      peindreEtat()
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = premiere
        ? 'Fiche envoyée ! Un modérateur va la relire avant qu’elle soit visible de tous.'
        : fiche.status === 'pending'
          ? 'Modifications enregistrées. La fiche repasse en relecture avant d’être de nouveau visible.'
          : 'Modifications enregistrées.'
      supprimer.hidden = false
      planning.hidden = !estTruck
      etat.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Enregistrement impossible : ' + err.message
    } finally {
      submit.disabled = false
    }
  })
  wrap.appendChild(form)

  // --- Supprimer la fiche -----------------------------------------------------
  const supprimer = el('button', 'btn btn--danger btn--block fiche-supprimer', 'Supprimer ma fiche')
  supprimer.type = 'button'
  supprimer.hidden = !fiche
  supprimer.addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement votre fiche et ses photos ?')) return
    supprimer.disabled = true
    try {
      await supprimerMaFiche(fiche)
      navigate('/parametres')
    } catch (err) {
      alert('Suppression impossible : ' + err.message)
      supprimer.disabled = false
    }
  })
  wrap.appendChild(supprimer)

  return wrap
}

/**
 * La galerie « En photo » : jusqu'à quatre photos. Les nouvelles partent à
 * l'enregistrement ; les retirées ne sont effacées du stockage qu'APRÈS.
 */
function galerieEditeur(fiche, titre) {
  const wrap = el('div', 'form__field')
  wrap.appendChild(el('span', 'form__label', `${titre} (${GALERIE_MAX} au plus)`))
  const grille = el('div', 'galerie-edit')
  wrap.appendChild(grille)
  const aide = el('span', 'form__hint', 'Elles s’affichent dans « En photo » sur votre fiche.')
  wrap.appendChild(aide)
  const input = el('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.hidden = true
  wrap.appendChild(input)

  let gardees = []
  let retirees = []
  let nouvelles = [] // { file, url }

  function reinitialiser(f) {
    const chemins = f?.gallery_paths ?? []
    const urls = f?.gallery_urls ?? []
    gardees = chemins.map((c, i) => ({ chemin: c, url: urls[i] }))
    retirees = []
    nouvelles = []
    peindre()
  }

  function caseImage(url, surRetrait) {
    const c = el('div', 'galerie-edit__case')
    const img = el('img')
    img.src = url
    img.alt = ''
    const x = el('button', 'galerie-edit__retirer', '×')
    x.type = 'button'
    x.setAttribute('aria-label', 'Retirer cette photo')
    x.addEventListener('click', surRetrait)
    c.append(img, x)
    return c
  }

  function peindre() {
    grille.innerHTML = ''
    for (const g of gardees) {
      grille.appendChild(
        caseImage(g.url, () => {
          gardees = gardees.filter((x) => x !== g)
          retirees.push(g.chemin)
          peindre()
        })
      )
    }
    for (const n of nouvelles) {
      grille.appendChild(
        caseImage(n.url, () => {
          nouvelles = nouvelles.filter((x) => x !== n)
          peindre()
        })
      )
    }
    if (gardees.length + nouvelles.length < GALERIE_MAX) {
      const c = el('div', 'galerie-edit__case')
      const plus = el('button', 'galerie-edit__ajouter', '+')
      plus.type = 'button'
      plus.setAttribute('aria-label', 'Ajouter des photos')
      plus.addEventListener('click', () => input.click())
      c.appendChild(plus)
      grille.appendChild(c)
    }
  }

  input.addEventListener('change', async () => {
    const place = GALERIE_MAX - gardees.length - nouvelles.length
    const fichiers = [...(input.files ?? [])].slice(0, place)
    // ⚠ Le champ n'est vidé qu'APRÈS la copie des photos (voir copieEnMemoire,
    // lib/heic.js) : vidé avant, Android retirait l'accès aux fichiers et
    // l'envoi échouait sur « Image illisible ».
    let erreur = null
    for (const brut of fichiers) {
      aide.textContent = 'Préparation de la photo…'
      try {
        const f = await toDisplayableFile(brut, (etape) => (aide.textContent = etape))
        nouvelles.push({ file: f, url: URL.createObjectURL(f) })
      } catch (err) {
        erreur = err
      }
    }
    input.value = ''
    // ⚠ Un échec reste AFFICHÉ : il était aussitôt écrasé par le message
    // ordinaire, et l'on ne comprenait pas pourquoi une photo manquait.
    aide.textContent = erreur
      ? 'Photo illisible : ' + erreur.message
      : nouvelles.length
        ? 'Elles seront envoyées à l’enregistrement.'
        : 'Elles s’affichent dans « En photo » sur votre fiche.'
    peindre()
  })

  reinitialiser(fiche)
  return {
    wrap,
    aChange: () => nouvelles.length > 0 || retirees.length > 0,
    gardees: () => gardees.map((g) => g.chemin),
    nouvelles: () => nouvelles.map((n) => n.file),
    retirees: () => [...retirees],
    reinitialiser,
  }
}

/** Un champ texte ou zone de texte, avec son compteur de longueur. */
function champ(label, type, valeur, max, placeholder) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el(type, type === 'textarea' ? 'form__input form__textarea' : 'form__input')
  if (type === 'input') input.type = 'text'
  if (type === 'textarea') input.rows = 4
  input.maxLength = max
  input.placeholder = placeholder || ''
  if (valeur) input.value = valeur
  wrap.appendChild(input)
  return { wrap, input }
}

/** Un choix de photo, avec aperçu immédiat (HEIC converti au besoin). */
function champPhoto(label, urlActuelle, surChoix, { retirer = null } = {}) {
  const wrap = el('div', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const apercu = el('div', 'fiche-edit-photo')
  const img = el('img')
  img.alt = ''
  if (urlActuelle) img.src = urlActuelle
  else apercu.classList.add('fiche-edit-photo--vide')
  apercu.appendChild(img)
  apercu.appendChild(el('span', 'fiche-edit-photo__invite', 'Toucher pour choisir une photo'))
  wrap.appendChild(apercu)

  const input = el('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.hidden = true
  wrap.appendChild(input)
  const aide = el('span', 'form__hint', '')
  wrap.appendChild(aide)

  apercu.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const brut = input.files?.[0]
    if (!brut) return
    aide.textContent = 'Préparation de la photo…'
    try {
      const f = await toDisplayableFile(brut, (etape) => (aide.textContent = etape))
      img.src = URL.createObjectURL(f)
      apercu.classList.remove('fiche-edit-photo--vide')
      aide.textContent = 'Elle sera envoyée à l’enregistrement.'
      surChoix(f)
    } catch (err) {
      aide.textContent = 'Photo illisible : ' + err.message
    }
  })

  if (retirer) {
    const b = el('button', 'btn btn--ghost btn--sm', 'Retirer cette photo')
    b.type = 'button'
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await retirer()
        img.removeAttribute('src')
        apercu.classList.add('fiche-edit-photo--vide')
        b.remove()
      } catch (err) {
        aide.textContent = 'Impossible : ' + err.message
        b.disabled = false
      }
    })
    wrap.appendChild(b)
  }
  return { wrap, input }
}
