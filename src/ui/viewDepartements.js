// Armana — écran « Mon territoire » (Profil).
//
// Filtre de territoire : il agit à la fois sur l'agenda et sur la carte. Un
// département décoché disparaît des deux — sur la carte, il repasse même sous
// le masque, comme s'il n'était pas couvert.
//
// Préférence locale à l'appareil, pas au compte : quelqu'un peut vouloir voir
// toute sa région sur son ordinateur et seulement son département sur son
// téléphone.
//
// ⚠ DEPUIS L'OUVERTURE À LA FRANCE (07/11/2026), OUVERT À TOUS, compte ou
// non : un visiteur de Bretagne doit pouvoir quitter PACA sans s'inscrire.
// Les départements sont rangés par région (ui/parRegion.js).
import { el, toggleRow } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { listeParRegion } from './parRegion.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import {
  DEPARTEMENTS,
  deptsDeRegion,
  nomDepartement,
  regionDuDept,
  resumeTerritoire,
} from '../lib/departements.js'
import { carteDepartements } from './carteDepts.js'
import './territoire.css'
import { getMesDepartements, setMesDepartements } from '../lib/mesDepartements.js'
import { applyModerator, myModDepts, myModeratorRequest } from '../lib/moderation.js'

export async function viewDepartements() {
  // Refonte du 07/11/2026, dans l'esprit de « Faire un don » : fond bleu, une
  // CARTE DE FRANCE où l'on touche une région pour l'ajouter ou la retirer,
  // puis le détail par département pour qui veut affiner.
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--studio-territoire')
  wrap.appendChild(studioHeader('Mon territoire', { backTo: '/parametres' }))

  let choisis = getMesDepartements()
  const message = el('p', 'territoire__resume')
  const cases = new Map()

  // La carte : un département touché bascule TOUTE sa région — c'est la
  // région qu'on choisit d'un geste ; le détail se règle dans la liste.
  const carte = carteDepartements({
    selection: choisis,
    onPick: (code) => {
      const siens = deptsDeRegion(regionDuDept(code))
      const tous = siens.every((c) => choisis.includes(c))
      enregistrer(tous ? choisis.filter((c) => !siens.includes(c)) : [...choisis, ...siens])
    },
  })
  wrap.appendChild(carte)
  wrap.appendChild(el('p', 'territoire__aide', 'Touchez une région pour l’ajouter ou la retirer.'))
  wrap.appendChild(message)

  /** Le dernier département coché ne peut pas être décoché. */
  function majVerrous() {
    const seul = choisis.length === 1
    for (const [code, entree] of cases) {
      const dernier = seul && choisis.includes(code)
      entree.toggle.disabled = dernier
      entree.ligne.classList.toggle('is-locked', dernier)
    }
    message.textContent = seul
      ? 'Au moins un département doit rester affiché.'
      : `Affiché : ${resumeTerritoire(choisis)}.`
  }

  function enregistrer(prochain) {
    choisis = setMesDepartements(prochain)
    // On resynchronise les cases sur ce que le stockage a réellement retenu,
    // plutôt que sur ce que l'on croit avoir enregistré.
    for (const [code, e] of cases) e.toggle.checked = choisis.includes(code)
    liste.repeindre()
    carte.setSelection(choisis)
    majVerrous()
  }

  const liste = listeParRegion({
    selection: () => choisis,
    // « Toute la région » : on ajoute ses départements, ou on les retire tous
    // — sauf s'il n'en resterait aucun ailleurs (setMesDepartements refuse).
    basculerRegion: (codes, tous) =>
      enregistrer(tous ? [...choisis, ...codes] : choisis.filter((c) => !codes.includes(c))),
    // Le numéro en gros chiffres condensés à gauche, comme la maquette : c'est
    // lui qu'on cherche du regard, pas le nom complet.
    rendre: (d) => {
      const ligne = toggleRow(d.nom, {
        prefix: el('span', 'dept-num', d.code),
        actif: choisis.includes(d.code),
        onChange: (veut) =>
          enregistrer(veut ? [...choisis, d.code] : choisis.filter((c) => c !== d.code)),
      })
      cases.set(d.code, { toggle: ligne.input, ligne })
      return ligne
    },
  })

  wrap.appendChild(el('h3', 'territoire__titre', 'Affiner par département'))
  wrap.appendChild(liste)
  majVerrous()

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Ce réglage ne vaut que pour cet appareil. Il ne change rien pour les ' +
        'autres membres, et n’empêche personne de publier ailleurs.'
    )
  )

  // --- Ma zone de modération (modérateurs uniquement) ------------------------
  // Distincte du filtre d'affichage ci-dessus : l'affichage est un confort
  // local, la zone de modération est un DROIT, accordé par le propriétaire.
  // C'est ici qu'un modérateur demande à élargir sa zone (décision Matthieu).
  if (isLoggedIn() && isAdmin() && !(await amIOwner().catch(() => false))) {
    let zone = null
    let demande = null
    try {
      ;[zone, demande] = await Promise.all([myModDepts(), myModeratorRequest()])
    } catch {
      return wrap // migration pas encore appliquée : section simplement absente
    }

    wrap.appendChild(el('h3', 'support-wall__title', '🛡 Ma zone de modération'))
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        zone?.length
          ? 'Vous relisez les événements de : ' +
            zone.map((c) => `${c} (${nomDepartement(c)})`).join(', ') + '.'
          : 'Vous relisez les événements de tout le territoire.'
      )
    )

    if (demande?.status === 'pending') {
      wrap.appendChild(
        el(
          'p',
          'demo-note',
          `✉ Votre demande d’extension (${demande.depts.join(', ')}) attend la ` +
            'réponse du propriétaire.'
        )
      )
      return wrap
    }

    const restants = DEPARTEMENTS.filter((d) => zone?.length && !zone.includes(d.code))
    if (!restants.length) return wrap

    wrap.appendChild(
      el('p', 'form__label', 'Demander un département de plus')
    )
    const cases = []
    const lus = () => cases.filter((c) => c.checked).map((c) => c.dataset.code)
    const groupe = listeParRegion({
      codes: restants.map((d) => d.code),
      selection: lus,
      // Seules les régions de sa zone actuelle sont dépliées : on étend le
      // plus souvent chez ses voisins.
      ouvertes: [...new Set(zone.map((c) => DEPARTEMENTS.find((d) => d.code === c)?.region))],
      rendre: (d) => {
        const ligne = toggleRow(d.nom, {
          prefix: el('span', 'dept-num', d.code),
          onChange: () => groupe.repeindre(),
        })
        ligne.input.dataset.code = d.code
        cases.push(ligne.input)
        return ligne
      },
    })
    wrap.appendChild(groupe)

    const msg = el('p', 'form__msg')
    const demander = el('button', 'btn btn--primary btn--block')
    demander.type = 'button'
    demander.appendChild(icon('shield'))
    demander.appendChild(document.createTextNode(' Demander l’extension'))
    demander.addEventListener('click', async () => {
      const depts = lus()
      msg.className = 'form__msg'
      if (!depts.length) {
        msg.classList.add('form__msg--err')
        msg.textContent = 'Cochez au moins un département.'
        return
      }
      demander.disabled = true
      msg.textContent = 'Envoi…'
      try {
        await applyModerator(depts, null)
        msg.className = 'form__msg form__msg--ok'
        msg.textContent = '✅ Demande envoyée au propriétaire. Réponse dans l’application.'
        demander.remove()
        groupe.remove()
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Envoi impossible : ' + e.message
        demander.disabled = false
      }
    })
    wrap.appendChild(demander)
    wrap.appendChild(msg)
  }

  return wrap
}
