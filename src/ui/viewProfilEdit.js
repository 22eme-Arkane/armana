// Armana — écran « Mon profil » : modifier son nom affiché.
//
// ⚠ AUCUNE MIGRATION DERRIÈRE CET ÉCRAN. La politique
// `profiles_update_self_or_owner` autorise déjà chacun à modifier SA ligne, et
// le garde-fou en base ne protège que le rôle, la zone de modération, le
// statut de propriétaire et les soutiens. Le nom est libre — voir
// `updateDisplayName` dans lib/auth.js.
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
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Mon profil', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour modifier votre profil.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Votre nom apparaît sur les événements que vous publiez et dans la liste des membres.'
    )
  )

  const form = el('form', 'form')

  const champ = el('label', 'form__field')
  champ.appendChild(el('span', 'form__label', 'Nom affiché'))
  const input = el('input', 'form__input')
  input.type = 'text'
  input.maxLength = NOM_MAX
  input.autocomplete = 'name'
  input.placeholder = 'Comment on vous verra'
  input.value = getProfile()?.display_name || ''
  champ.appendChild(input)
  champ.appendChild(
    el('span', 'form__hint', `Entre ${NOM_MIN} et ${NOM_MAX} caractères.`)
  )
  form.appendChild(champ)

  const msg = el('p', 'form__msg')
  const submit = el('button', 'btn btn--primary btn--block', 'Enregistrer')
  submit.type = 'submit'
  form.appendChild(submit)
  form.appendChild(msg)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.className = 'form__msg'
    msg.textContent = ''
    const avant = getProfile()?.display_name || ''
    if (input.value.trim() === avant) {
      msg.className = 'form__msg'
      msg.textContent = 'Ce nom est déjà le vôtre.'
      return
    }
    submit.disabled = true
    submit.textContent = 'Enregistrement…'
    try {
      const retenu = await updateDisplayName(input.value)
      input.value = retenu
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = `C’est enregistré : vous apparaissez désormais comme « ${retenu} ».`
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Modification impossible : ' + err.message
    } finally {
      submit.disabled = false
      submit.textContent = 'Enregistrer'
    }
  })

  wrap.appendChild(form)

  // --- Type de compte (migration 0033) ------------------------------------
  // ⚠ Il ne donne AUCUN droit : il ouvre seulement la fiche d'un lieu ou d'un
  // food truck, qu'un modérateur valide avant qu'elle soit publique.
  const typeBloc = el('div', 'form')
  typeBloc.appendChild(el('span', 'form__label', 'Vous êtes…'))
  const typeRow = el('div', 'choix')
  const typeMsg = el('p', 'form__msg')
  const ficheBtn = el('button', 'btn btn--primary btn--block')
  ficheBtn.type = 'button'
  ficheBtn.addEventListener('click', () => navigate('/ma-fiche'))
  const typeBtns = TYPES_COMPTE.map((t) => {
    const b = el('button', 'choix__option', t.texte)
    b.type = 'button'
    b.addEventListener('click', async () => {
      if (t.cle === getProfile()?.account_type) return
      typeBtns.forEach((x) => (x.disabled = true))
      typeMsg.className = 'form__msg'
      typeMsg.textContent = 'Enregistrement…'
      try {
        await updateAccountType(t.cle)
        typeMsg.className = 'form__msg form__msg--ok'
        typeMsg.textContent =
          t.cle === 'particulier'
            ? 'C’est noté. Si vous aviez une fiche, elle reste en ligne : vous pouvez la supprimer depuis « Ma fiche ».'
            : 'C’est noté. Vous pouvez maintenant créer votre fiche.'
      } catch (err) {
        typeMsg.className = 'form__msg form__msg--err'
        typeMsg.textContent = 'Modification impossible : ' + err.message
      } finally {
        typeBtns.forEach((x) => (x.disabled = false))
        peindreType()
      }
    })
    typeRow.appendChild(b)
    return b
  })
  function peindreType() {
    const actuel = getProfile()?.account_type || 'particulier'
    TYPES_COMPTE.forEach((t, i) => typeBtns[i].classList.toggle('is-active', t.cle === actuel))
    ficheBtn.hidden = actuel === 'particulier'
    ficheBtn.textContent = actuel === 'food_truck' ? 'Ma fiche de food truck' : 'Ma fiche de lieu'
  }
  typeBloc.append(typeRow, typeMsg, ficheBtn)
  peindreType()
  wrap.appendChild(typeBloc)

  // L'adresse e-mail et le mot de passe ne se changent pas ici : ce sont des
  // opérations d'authentification, qui passent par un e-mail de confirmation.
  // ⚠ Le dire plutôt que de laisser chercher — et ne PAS offrir un bouton qui
  // échouerait : l'envoi d'e-mails n'est pas configuré sur ce projet.
  const compte = el('div', 'settings-group')
  compte.appendChild(
    el('p', 'form__label', 'Adresse de connexion')
  )
  compte.appendChild(el('p', 'form__hint', getUser()?.email || '—'))
  compte.appendChild(
    el(
      'p',
      'form__hint',
      'Elle ne se modifie pas depuis l’application. Écrivez-nous depuis ' +
        '« Nous contacter » si vous devez en changer.'
    )
  )
  wrap.appendChild(compte)

  const retour = el('button', 'btn btn--ghost btn--block', 'Retour au profil')
  retour.type = 'button'
  retour.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(retour)

  return wrap
}
