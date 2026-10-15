// Armana — Connexion / Inscription (e-mail + mot de passe Supabase Auth).
import { el } from './components.js'
import { navigate } from '../lib/router.js'
import { studioHeader } from './studio.js'
import { signIn, signUp, resetPassword, isLoggedIn, TYPES_COMPTE } from '../lib/auth.js'

export function viewAuth() {
  // Le nom du projet est dans la barre de titre, et c'est le LOGO qui accueille
  // — pas un « Bienvenue sur Armana » géant qui répétait deux fois la même
  // chose et repoussait le formulaire hors de l'écran (demande de Matthieu).
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--studio-auth')
  // Barre sans titre : le logo juste dessous dit déjà où l'on est, et
  // « ARMANA » écrit au-dessus de lui faisait doublon.
  wrap.appendChild(studioHeader('', { backTo: '/', backLabel: 'Agenda', sansLogo: true }))

  if (isLoggedIn()) {
    navigate('/')
    return wrap
  }

  // ⚠ La version 288 px, pas celle des en-têtes : c'est le seul endroit où le
  // logo s'affiche en grand, et 192 px y paraissaient mous sur un écran fin.
  // Ce fichier plus lourd (86 Ko) ne se télécharge QUE sur cet écran, vu une
  // fois par personne — les autres écrans gardent la version de 42 Ko.
  const logo = el('img', 'auth-logo')
  logo.src = '/icons/armana-logo-grand.png'
  logo.alt = 'Armana'
  wrap.appendChild(logo)

  let mode = 'login' // 'login' | 'signup'
  const card = el('div', 'card-panel studio-auth-card')
  const title = el('h2', 'card-panel__title')
  const form = el('form', 'form')
  const msg = el('p', 'form__msg')

  const nameField = field('Nom affiché', 'text', 'name', 'Comment on vous verra')

  // --- « Vous êtes… » (migration 0033), à l'inscription seulement ---------
  // Trois pastilles qui s'excluent. ⚠ Le choix ne donne AUCUN droit : il ouvre
  // seulement, ensuite, la possibilité de créer une fiche (lieu, food truck),
  // qu'un modérateur validera. Il se change à tout moment dans « Mon profil ».
  let typeCompte = 'particulier'
  const typeWrap = el('div', 'form__field')
  typeWrap.appendChild(el('span', 'form__label', 'Vous êtes…'))
  const typeRow = el('div', 'choix')
  const typeBtns = TYPES_COMPTE.map((t) => {
    const b = el('button', 'choix__option', t.texte)
    b.type = 'button'
    b.addEventListener('click', () => {
      typeCompte = t.cle
      peindreType()
    })
    typeRow.appendChild(b)
    return b
  })
  typeWrap.appendChild(typeRow)
  const typeAide = el('span', 'form__hint')
  typeWrap.appendChild(typeAide)
  const AIDES = {
    particulier: 'Pour suivre l’agenda, garder vos favoris et publier des événements.',
    lieu: 'Vous gérez une salle, un café-concert, une galerie… Vous pourrez créer la fiche de votre lieu : photo, horaires, site.',
    food_truck: 'Vous pourrez créer la fiche de votre camion : cuisine, menu, photo — puis indiquer où vous trouver.',
  }
  function peindreType() {
    TYPES_COMPTE.forEach((t, i) => typeBtns[i].classList.toggle('is-active', t.cle === typeCompte))
    typeAide.textContent = AIDES[typeCompte]
  }
  peindreType()
  const emailField = field('E-mail', 'email', 'email', 'vous@exemple.fr')
  const passField = field('Mot de passe', 'password', 'password', '••••••••')

  const submit = el('button', 'btn btn--primary btn--block')
  submit.type = 'submit'
  const toggle = el('button', 'btn btn--link')
  toggle.type = 'button'
  const forgot = el('button', 'btn btn--link', 'Mot de passe oublié ?')
  forgot.type = 'button'

  function paint() {
    title.textContent = mode === 'login' ? 'Connexion' : 'Créer un compte'
    submit.textContent = mode === 'login' ? 'Se connecter' : "S'inscrire"
    toggle.textContent =
      mode === 'login' ? 'Pas encore de compte ? S’inscrire' : 'Déjà inscrit ? Se connecter'
    nameField.wrap.style.display = mode === 'signup' ? '' : 'none'
    typeWrap.style.display = mode === 'signup' ? '' : 'none'
    forgot.style.display = mode === 'login' ? '' : 'none'
    msg.textContent = ''
    msg.className = 'form__msg'
  }

  forgot.addEventListener('click', async () => {
    const email = emailField.input.value.trim()
    if (!email) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Entrez d’abord votre e-mail ci-dessus, puis retouchez « Mot de passe oublié ? ».'
      return
    }
    forgot.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Envoi…'
    try {
      await resetPassword(email)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent =
        'E-mail envoyé ! Ouvrez le lien reçu : il vous amènera à l’écran « Nouveau mot de passe ».'
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = friendly(e.message)
    } finally {
      forgot.disabled = false
    }
  })

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login'
    paint()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Veuillez patienter…'
    try {
      const email = emailField.input.value.trim()
      const password = passField.input.value
      if (mode === 'signup') {
        const name = nameField.input.value.trim()
        if (!name) throw new Error('Le nom affiché est requis.')
        const res = await signUp(email, password, name, typeCompte)
        if (!res.session) {
          mode = 'login'
          paint()
          msg.className = 'form__msg form__msg--ok'
          msg.textContent = 'Compte créé. Vérifiez votre e-mail pour confirmer, puis connectez-vous.'
          return
        }
        // Lieu ou food truck : on enchaîne directement sur la fiche.
        if (typeCompte !== 'particulier') {
          navigate('/ma-fiche')
          return
        }
      } else {
        await signIn(email, password)
      }
      navigate('/')
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = friendly(err.message)
    } finally {
      submit.disabled = false
    }
  })

  form.appendChild(nameField.wrap)
  form.appendChild(typeWrap)
  form.appendChild(emailField.wrap)
  form.appendChild(passField.wrap)
  form.appendChild(submit)
  form.appendChild(msg)
  form.appendChild(forgot)
  form.appendChild(toggle)

  card.appendChild(title)
  card.appendChild(form)
  wrap.appendChild(card)
  paint()
  return wrap
}

function field(label, type, name, placeholder) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = type
  input.name = name
  input.placeholder = placeholder || ''
  input.autocomplete = type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'
  if (type !== 'text') input.required = true
  wrap.appendChild(input)
  return { wrap, input }
}

function friendly(m) {
  if (!m) return 'Erreur inconnue.'
  if (/invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.'
  if (/password/i.test(m) && /6/.test(m)) return 'Mot de passe : 6 caractères minimum.'
  if (/already registered/i.test(m)) return 'Cet e-mail est déjà utilisé.'
  return m
}
