// Armana — écran « Mon profil » : nom affiché, type de compte, adresse de
// connexion.
//
// ⚠ AUCUNE MIGRATION DERRIÈRE LE NOM. La politique
// `profiles_update_self_or_owner` autorise déjà chacun à modifier SA ligne, et
// le garde-fou en base ne protège que le rôle, la zone de modération, le
// statut de propriétaire et les soutiens. Le nom est libre — voir
// `updateDisplayName` dans lib/auth.js.
//
// Mise en page revue le 15/10/2026 (Matthieu) : tout centré comme le reste de
// l'application, trois cartes compactes, et le nom AFFICHÉ, pas offert à la
// saisie — on le change en touchant « Modifier », pour éviter qu'une fausse
// manœuvre ne l'abîme.
import './profil.css'
import { el, loginPrompt } from './components.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import {
  NOM_MAX,
  NOM_MIN,
  TYPES_COMPTE,
  getProfile,
  getUser,
  isLoggedIn,
  updateAccountType,
  updateDisplayName,
} from '../lib/auth.js'

export function viewProfilEdit() {
  const wrap = el('section', 'page page--studio-sub page--profil')
  wrap.appendChild(studioHeader('Mon profil', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour modifier votre profil.'))
    return wrap
  }

  wrap.appendChild(blocNom())
  wrap.appendChild(blocType())
  wrap.appendChild(blocConnexion())

  const retour = el('button', 'btn btn--ghost btn--block', 'Retour au profil')
  retour.type = 'button'
  retour.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(retour)

  return wrap
}

/** Une carte centrée, avec son intitulé. */
function carte(titre) {
  const c = el('section', 'profil-carte')
  c.appendChild(el('h3', 'profil-carte__titre', titre))
  return c
}

// --- Nom affiché ---------------------------------------------------------------
// Lu, pas saisi. « Modifier » ouvre le champ ; « Annuler » le referme sans rien
// changer.
function blocNom() {
  const c = carte('Nom affiché')
  const lecture = el('div', 'profil-nom')
  const valeur = el('p', 'profil-nom__valeur', getProfile()?.display_name || '—')
  const modifier = el('button', 'btn btn--ghost btn--sm', 'Modifier')
  modifier.type = 'button'
  lecture.append(valeur, modifier)

  const edition = el('form', 'profil-nom__edition')
  edition.hidden = true
  const input = el('input', 'form__input')
  input.type = 'text'
  input.maxLength = NOM_MAX
  input.autocomplete = 'name'
  input.setAttribute('aria-label', 'Nouveau nom affiché')
  const aide = el('p', 'profil-aide', `Entre ${NOM_MIN} et ${NOM_MAX} caractères.`)
  const boutons = el('div', 'profil-boutons')
  const annuler = el('button', 'btn btn--ghost', 'Annuler')
  annuler.type = 'button'
  const enregistrer = el('button', 'btn btn--primary', 'Enregistrer')
  enregistrer.type = 'submit'
  boutons.append(annuler, enregistrer)
  edition.append(input, aide, boutons)

  const msg = el('p', 'form__msg profil-msg')

  modifier.addEventListener('click', () => {
    input.value = getProfile()?.display_name || ''
    lecture.hidden = true
    edition.hidden = false
    msg.textContent = ''
    input.focus()
    input.select()
  })
  annuler.addEventListener('click', () => {
    edition.hidden = true
    lecture.hidden = false
  })
  edition.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (input.value.trim() === (getProfile()?.display_name || '')) {
      edition.hidden = true
      lecture.hidden = false
      return
    }
    enregistrer.disabled = true
    enregistrer.textContent = 'Enregistrement…'
    try {
      const retenu = await updateDisplayName(input.value)
      valeur.textContent = retenu
      edition.hidden = true
      lecture.hidden = false
      msg.className = 'form__msg form__msg--ok profil-msg'
      msg.textContent = 'C’est enregistré.'
    } catch (err) {
      msg.className = 'form__msg form__msg--err profil-msg'
      msg.textContent = 'Modification impossible : ' + err.message
    } finally {
      enregistrer.disabled = false
      enregistrer.textContent = 'Enregistrer'
    }
  })

  c.append(lecture, edition, msg)
  c.appendChild(el('p', 'profil-aide', 'Il apparaît sur vos événements et dans la liste des membres.'))
  return c
}

// --- Type de compte ---------------------------------------------------------------
// ⚠ Il ne donne AUCUN droit : il ouvre seulement la fiche d'un lieu ou d'un
// food truck, qu'un modérateur valide avant qu'elle soit publique.
// Trois segments sur UNE ligne, au lieu de trois grosses pastilles dans un
// grand cadre.
function blocType() {
  const c = carte('Vous êtes…')
  const segments = el('div', 'profil-segments')
  segments.setAttribute('role', 'radiogroup')
  segments.setAttribute('aria-label', 'Type de compte')
  const msg = el('p', 'form__msg profil-msg')
  const ficheBtn = el('button', 'btn btn--primary btn--block')
  ficheBtn.type = 'button'
  ficheBtn.addEventListener('click', () => navigate('/ma-fiche'))

  const boutons = TYPES_COMPTE.map((t) => {
    const b = el('button', 'profil-segment', t.texte)
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.addEventListener('click', async () => {
      if (t.cle === getProfile()?.account_type) return
      boutons.forEach((x) => (x.disabled = true))
      msg.className = 'form__msg profil-msg'
      msg.textContent = 'Enregistrement…'
      try {
        await updateAccountType(t.cle)
        msg.className = 'form__msg form__msg--ok profil-msg'
        msg.textContent =
          t.cle === 'particulier'
            ? 'C’est noté. Si vous aviez une fiche, elle reste en ligne : vous pouvez la supprimer depuis « Ma fiche ».'
            : 'C’est noté. Vous pouvez maintenant créer votre fiche.'
      } catch (err) {
        msg.className = 'form__msg form__msg--err profil-msg'
        msg.textContent = 'Modification impossible : ' + err.message
      } finally {
        boutons.forEach((x) => (x.disabled = false))
        peindre()
      }
    })
    segments.appendChild(b)
    return b
  })

  function peindre() {
    const actuel = getProfile()?.account_type || 'particulier'
    TYPES_COMPTE.forEach((t, i) => {
      boutons[i].classList.toggle('is-active', t.cle === actuel)
      boutons[i].setAttribute('aria-checked', String(t.cle === actuel))
    })
    ficheBtn.hidden = actuel === 'particulier'
    ficheBtn.textContent = actuel === 'food_truck' ? 'Ma fiche de food truck' : 'Ma fiche de lieu'
  }
  peindre()

  c.append(segments, msg, ficheBtn)
  return c
}

// --- Adresse de connexion ------------------------------------------------------------
// Elle ne se change pas ici : c'est une opération d'authentification, qui passe
// par un e-mail de confirmation — et l'envoi d'e-mails n'est pas configuré. On
// le dit plutôt que d'offrir un bouton qui échouerait.
function blocConnexion() {
  const c = carte('Adresse de connexion')
  // ⚠ Une adresse longue se coupe PROPREMENT (voir profil.css) au lieu de
  // déborder de la carte, ce qui la tronquait.
  c.appendChild(el('p', 'profil-email', getUser()?.email || '—'))
  c.appendChild(
    el(
      'p',
      'profil-aide',
      'Elle ne se modifie pas depuis l’application. Écrivez-nous depuis « Nous contacter » si vous devez en changer.'
    )
  )
  return c
}
