// Armana — « Journal des actions », réservé au PROPRIÉTAIRE du projet.
//
// Volontairement pas ouvert aux modérateurs : ce journal sert justement à les
// départager entre eux. La restriction est imposée en base (list_admin_actions),
// le contrôle ci-dessous n'est que du confort.
//
// Refonte du 11/11/2026 (Matthieu : « pas du tout optimisé »). C'était une
// liste plate de 200 phrases, sans filtre, sans suite, où un changement de zone
// s'écrivait « moderator_depts ». Désormais :
//   · rangé PAR JOUR, une icône et une couleur par nature d'acte ;
//   · filtrable par famille, par modérateur, par nom — les filtres sont
//     appliqués EN BASE (migration 0040), donc sur tout le journal et pas
//     seulement sur ce qui est affiché ;
//   · « Charger les plus anciennes » : on remonte aussi loin qu'on veut ;
//   · une ligne ouvre l'événement, la fiche ou le membre dont elle parle.
// Les phrases et les filtres sont dans lib/journal.js.
import { el } from './components.js'
import { icon } from './icons.js'
import { note, pageGestion, pastilles, recherche, vide } from './gestion.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { amIOwner, listAdminActions, listAdmins } from '../lib/admins.js'
import { demoActif } from '../lib/demo.js'
import { CATEGORIES, decrire, filtrerActes, fusionner } from '../lib/journal.js'

/** Lignes demandées à chaque fois. */
const PAGE = 60

const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const JOUR_AN = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

// Les filtres survivent à un aller-retour vers ce qu'une ligne a ouvert.
const memoire = { categorie: 'tout', acteur: '', recherche: '' }

/** « Aujourd'hui », « Hier », sinon « lundi 9 novembre » (l'année si ce n'est pas la nôtre). */
function titreJour(date) {
  const minuit = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const ecart = Math.round((minuit(new Date()) - minuit(date)) / 86400000)
  if (ecart === 0) return 'Aujourd’hui'
  if (ecart === 1) return 'Hier'
  const t = (date.getFullYear() === new Date().getFullYear() ? JOUR : JOUR_AN).format(date)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export async function viewJournal() {
  const wrap = pageGestion('Journal', { backTo: '/admins', backLabel: 'Modérateurs' })

  if (!demoActif() && (!isLoggedIn() || !(await amIOwner()))) {
    wrap.appendChild(vide('Réservé au propriétaire du projet.'))
    return wrap
  }

  // --- Filtres -----------------------------------------------------------------
  const champ = recherche('Chercher un événement, un membre…', 'Chercher dans le journal')
  champ.input.value = memoire.recherche
  wrap.appendChild(champ)

  wrap.appendChild(
    pastilles(
      CATEGORIES.map((c) => ({ cle: c.cle, texte: c.texte })),
      {
        actif: memoire.categorie,
        file: true,
        onChange: (cle) => {
          memoire.categorie = cle
          charger(true)
        },
      }
    )
  )

  // Qui : la liste des modérateurs (et vous). Chargée à part — si elle échoue,
  // le journal reste lisible, simplement sans ce filtre.
  const qui = el('div', 'g-filtres-journal')
  const select = el('select', 'g-select')
  select.setAttribute('aria-label', 'Filtrer par modérateur')
  select.appendChild(new Option('Tous les modérateurs', ''))
  qui.appendChild(select)
  wrap.appendChild(qui)
  const noms = new Map()
  listAdmins()
    .then((admins) => {
      for (const a of admins) {
        const nom = a.display_name || a.email || 'Sans nom'
        noms.set(a.id, nom)
        select.appendChild(new Option(nom, a.id))
      }
      select.value = noms.has(memoire.acteur) ? memoire.acteur : ''
    })
    .catch(() => qui.remove())
  select.addEventListener('change', () => {
    memoire.acteur = select.value
    charger(true)
  })

  let attente = null
  champ.input.addEventListener('input', () => {
    memoire.recherche = champ.input.value
    clearTimeout(attente)
    attente = setTimeout(() => charger(true), 300)
  })

  // --- La liste ------------------------------------------------------------------
  const liste = el('div', 'g-pile')
  wrap.appendChild(liste)
  const plus = el('button', 'g-plus', 'Charger les plus anciennes')
  plus.type = 'button'
  plus.hidden = true
  plus.addEventListener('click', () => charger(false))
  wrap.appendChild(plus)
  const pied = note('')
  wrap.appendChild(pied)

  let lignes = []
  let fini = false
  let tour = 0

  const filtres = () => ({
    acteur: memoire.acteur || null,
    acteurNom: noms.get(memoire.acteur) ?? null,
    actions: CATEGORIES.find((c) => c.cle === memoire.categorie)?.actions ?? null,
    recherche: memoire.recherche,
  })

  /** `depuisLeDebut` : un filtre a changé. Sinon : la page suivante. */
  async function charger(depuisLeDebut) {
    // Une réponse lente à une ancienne question ne doit pas écraser la nouvelle.
    const moi = ++tour
    if (depuisLeDebut) {
      lignes = []
      fini = false
    }
    plus.disabled = true
    const f = filtres()
    let recues
    try {
      recues = await listAdminActions({
        max: PAGE,
        avant: lignes.length ? lignes[lignes.length - 1].id : null,
        acteur: f.acteur,
        actions: f.actions,
        recherche: f.recherche,
      })
    } catch (e) {
      if (moi !== tour) return
      liste.innerHTML = ''
      liste.appendChild(vide('Chargement impossible : ' + e.message))
      plus.hidden = true
      return
    }
    if (moi !== tour) return
    // Une base d'avant la 0040 rend tout d'un bloc, sans filtrer : on filtre ici.
    fini = !recues.paginable || recues.length < PAGE
    lignes = lignes.concat(recues.paginable ? recues : filtrerActes(recues, f))
    plus.disabled = false
    peindre()
  }

  function peindre() {
    liste.innerHTML = ''
    const actes = fusionner(lignes)
    const filtre = memoire.categorie !== 'tout' || memoire.acteur || memoire.recherche.trim()

    if (!actes.length) {
      liste.appendChild(
        vide(filtre ? 'Aucune action ne correspond à ces filtres.' : 'Aucune action enregistrée pour l’instant.')
      )
      plus.hidden = true
      pied.textContent = ''
      return
    }

    let dernier = null
    let groupe = null
    for (const a of actes) {
      const date = new Date(a.created_at)
      const jour = titreJour(date)
      if (jour !== dernier) {
        dernier = jour
        liste.appendChild(el('h3', 'g-repere', jour))
        groupe = el('div', 'g-groupe')
        liste.appendChild(groupe)
      }
      groupe.appendChild(ligne(a, date))
    }

    plus.hidden = fini
    pied.textContent = fini
      ? `${actes.length > 1 ? `Les ${actes.length} actions` : 'La seule action'}${filtre ? ' correspondantes' : ''} — c’est tout. ` +
        'Le journal ne peut être ni modifié ni effacé depuis l’application, par personne.'
      : 'Le journal ne peut être ni modifié ni effacé depuis l’application, par personne.'
  }

  function ligne(a, date) {
    const d = decrire(a)
    const row = el(d.lien ? 'button' : 'div', 'g-acte g-acte--' + d.ton)
    if (d.lien) {
      row.type = 'button'
      row.addEventListener('click', () => navigate(d.lien))
    }
    const picto = el('span', 'g-acte__picto')
    picto.appendChild(icon(d.icone))
    row.appendChild(picto)

    const corps = el('div', 'g-acte__corps')
    const texte = el('p', 'g-acte__texte')
    texte.append(
      el('strong', null, a.actor_name || '(compte supprimé)'),
      document.createTextNode(` ${d.avant} `),
      el('strong', null, d.cible),
      document.createTextNode(d.apres)
    )
    corps.appendChild(texte)
    if (d.detail) corps.appendChild(el('span', 'g-acte__detail', d.detail))
    row.appendChild(corps)
    row.appendChild(el('span', 'g-acte__heure', HEURE.format(date)))
    return row
  }

  await charger(true)
  return wrap
}
