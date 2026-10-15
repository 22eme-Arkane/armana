// Armana — « Mon planning » : l'espace du food truck (migration 0034).
//
// La semaine se saisit UNE FOIS ; ensuite, quatre gros boutons couvrent la
// vie courante (spec : moins de 10 secondes, d'une main) : pas là tel jour,
// vacances, changement de lieu, présence en plus. Et un cinquième, « Mon
// planning est toujours bon », sans lequel le camion finit par disparaître de
// la carte — pas de fiche fantôme.
import './planning.css'
import { el, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { choixLieu } from './choixLieu.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { getMaFiche } from '../lib/fiches.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import { listApprovedEvents } from '../lib/events.js'
import { eventDayKeys } from '../lib/recurrence.js'
import {
  JOURS,
  JOURS_COURTS,
  ajouterException,
  heure,
  aujourdhuiParis,
  confirmerPlanning,
  dateLongue,
  enregistrerCreneau,
  etatPlanning,
  jourIso,
  listerCreneaux,
  listerExceptions,
  maConfirmation,
  mesAnnonces,
  mesSignalements,
  retirerAnnonce,
  plageHoraire,
  reglages,
  supprimerCreneau,
  supprimerException,
} from '../lib/foodTrucks.js'

/** Jours proposés pour « pas là » et « change de lieu » : trois semaines. */
const HORIZON_JOURS = 21

export async function viewPlanning() {
  const wrap = el('section', 'page page--studio-sub page--planning')
  wrap.appendChild(studioHeader('Mon planning', { backTo: '/ma-fiche' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour gérer le planning de votre food truck.'))
    return wrap
  }

  const fiche = await getMaFiche().catch(() => null)
  if (!fiche || fiche.kind !== 'food_truck') {
    wrap.appendChild(
      el(
        'p',
        'page__subtitle',
        'Le planning est réservé aux food trucks. Créez d’abord la fiche de votre camion.'
      )
    )
    const aller = el('button', 'btn btn--primary btn--block', 'Créer ma fiche')
    aller.type = 'button'
    aller.addEventListener('click', () => navigate('/ma-fiche'))
    wrap.appendChild(aller)
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Votre semaine type, une fois pour toutes. Les jours où vous êtes là, votre camion apparaît sur la carte d’Armana.'
    )
  )
  if (fiche.status !== 'approved') {
    wrap.appendChild(
      el(
        'p',
        'fiche-etat fiche-etat--attente',
        'Votre fiche attend la validation d’un modérateur : vous pouvez préparer votre planning, il apparaîtra sur la carte une fois la fiche publiée.'
      )
    )
  }

  const corps = el('div', 'planning')
  wrap.appendChild(corps)

  // État partagé, rechargé après chaque modification.
  let donnees = null
  let panneauOuvert = null // clé de l'action rapide dépliée

  async function charger() {
    const [confirme, r, creneaux, exceptions, signal, annonces] = await Promise.all([
      maConfirmation(fiche.id),
      reglages(),
      listerCreneaux(fiche.id),
      listerExceptions(fiche.id),
      mesSignalements(),
      mesAnnonces(fiche.id),
    ])
    donnees = { confirme, r, creneaux, exceptions, signal, annonces }
  }

  async function rafraichir() {
    try {
      await charger()
    } catch (e) {
      // ⚠ JAMAIS LE MESSAGE BRUT DE LA BASE À L'ÉCRAN (« column … does not
      // exist ») : il inquiète sans rien expliquer. Il part dans la console.
      console.warn('[Armana] Planning indisponible :', e.message)
      const absent = /does not exist|schema cache|could not find/i.test(e.message || '')
      corps.innerHTML = ''
      corps.appendChild(
        el(
          'p',
          'fiche-etat fiche-etat--attente',
          absent
            ? 'Le planning arrive très bientôt : vous pourrez y choisir vos jours, vos communes et vos horaires.'
            : 'Le planning n’a pas pu être chargé. Vérifiez votre connexion et réessayez.'
        )
      )
      return
    }
    peindre()
  }

  function peindre() {
    corps.innerHTML = ''
    corps.appendChild(blocEtat())
    const s = blocSignalements()
    if (s) corps.appendChild(s)
    corps.appendChild(blocActions())
    corps.appendChild(blocSemaine())
    corps.appendChild(blocAVenir())
    const a = blocAnnonces()
    if (a) corps.appendChild(a)
  }

  /**
   * Les événements où un ORGANISATEUR annonce ce camion (migration 0035).
   * Le camion peut retirer la mention : personne n'est annoncé quelque part
   * contre son gré.
   */
  function blocAnnonces() {
    if (!donnees.annonces.length) return null
    const s = el('section', 'planning-bloc')
    s.appendChild(el('h3', 'studio-title', 'On vous annonce sur'))
    const liste = el('div', 'planning-semaine')
    for (const ev of donnees.annonces) {
      const l = el('div', 'planning-creneau')
      const texte = el('a', 'planning-creneau__texte')
      texte.href = '#/evenement?id=' + ev.id
      texte.appendChild(el('strong', null, ev.title))
      texte.appendChild(
        el(
          'span',
          null,
          new Date(ev.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) +
            (ev.city ? ' · ' + ev.city : '')
        )
      )
      const retirer = el('button', 'btn btn--ghost btn--sm', 'Retirer')
      retirer.type = 'button'
      retirer.addEventListener('click', async () => {
        if (!confirm(`Ne plus être annoncé sur « ${ev.title} » ?`)) return
        retirer.disabled = true
        try {
          await retirerAnnonce(ev.id, fiche.id)
          await rafraichir()
        } catch (e) {
          alert('Impossible : ' + e.message)
          retirer.disabled = false
        }
      })
      l.append(texte, retirer)
      liste.appendChild(l)
    }
    s.appendChild(liste)
    return s
  }

  // --- 1. État et confirmation --------------------------------------------------
  function blocEtat() {
    const { etat, jours } = etatPlanning(donnees.confirme, donnees.r)
    const textes = {
      actif: `Votre planning est à jour (confirmé ${quandIlYA(jours)}).`,
      rappel: `Votre planning est-il toujours bon ? Dernière confirmation ${quandIlYA(jours)}. Sans réponse, votre camion disparaîtra de la carte dans ${donnees.r.ft_masquage_jours - jours} jour${donnees.r.ft_masquage_jours - jours > 1 ? 's' : ''}.`,
      masque: `Votre camion n’apparaît plus sur la carte : dernière confirmation ${quandIlYA(jours)}. Confirmez pour revenir.`,
      archive: `Votre planning est archivé faute de confirmation depuis ${jours} jours. Confirmez pour le remettre en ligne.`,
    }
    const b = el('section', 'planning-etat planning-etat--' + etat)
    b.appendChild(el('p', 'planning-etat__texte', textes[etat]))
    const ok = el('button', 'btn btn--primary btn--block planning-etat__bouton')
    ok.type = 'button'
    ok.append(icon('check'), el('span', null, 'Mon planning est toujours bon'))
    ok.addEventListener('click', async () => {
      ok.disabled = true
      try {
        await confirmerPlanning()
        await rafraichir()
      } catch (e) {
        alert('Confirmation impossible : ' + e.message)
        ok.disabled = false
      }
    })
    b.appendChild(ok)
    b.appendChild(
      el(
        'p',
        'form__hint',
        `Toute modification du planning vaut aussi confirmation. Sans nouvelles pendant ${donnees.r.ft_masquage_jours} jours, le camion est retiré de la carte — personne ne se déplace pour rien.`
      )
    )
    return b
  }

  function blocSignalements() {
    const total = donnees.signal.reduce((n, s) => n + s.nb, 0)
    if (!total) return null
    const masques = donnees.signal.filter((s) => s.nb >= donnees.r.ft_seuil_signalements).length
    return el(
      'p',
      'fiche-etat fiche-etat--refusee',
      `${total} personne${total > 1 ? 's ont' : ' a'} signalé votre absence aujourd’hui.` +
        (masques
          ? ' Votre camion est masqué sur la carte pour la journée.'
          : ' Si vous n’êtes pas là, dites-le avec « Je ne suis pas là ».')
    )
  }

  // --- 2. Actions rapides --------------------------------------------------------
  function blocActions() {
    const s = el('section', 'planning-bloc')
    s.appendChild(el('h3', 'studio-title', 'Actions rapides'))
    const grille = el('div', 'planning-actions')
    const zone = el('div', 'planning-panneau-zone')
    const actions = [
      { cle: 'absent', icone: 'clock', texte: 'Je ne suis pas là', panneau: panneauAbsent },
      { cle: 'vacances', icone: 'calendar', texte: 'Je pars en vacances', panneau: panneauVacances },
      { cle: 'deplace', icone: 'navigation', texte: 'Je change de lieu', panneau: panneauDeplace },
      { cle: 'extra', icone: 'plus', texte: 'Présence en plus', panneau: panneauExtra },
    ]
    for (const a of actions) {
      const b = el('button', 'planning-action')
      b.type = 'button'
      b.append(icon(a.icone), el('span', null, a.texte))
      if (panneauOuvert === a.cle) b.classList.add('is-active')
      b.addEventListener('click', () => {
        panneauOuvert = panneauOuvert === a.cle ? null : a.cle
        for (const x of grille.children) x.classList.remove('is-active')
        zone.innerHTML = ''
        if (panneauOuvert) {
          b.classList.add('is-active')
          zone.appendChild(a.panneau())
          zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      })
      grille.appendChild(b)
    }
    s.append(grille, zone)
    if (panneauOuvert) zone.appendChild(actions.find((a) => a.cle === panneauOuvert).panneau())
    return s
  }

  /** Les prochaines occurrences des créneaux, déjà fermées exclues. */
  function prochainesOccurrences() {
    const out = []
    const debut = new Date(aujourdhuiParis() + 'T12:00:00')
    for (let i = 0; i < HORIZON_JOURS; i++) {
      const d = new Date(debut)
      d.setDate(debut.getDate() + i)
      const ymd = d.toLocaleDateString('en-CA')
      for (const c of donnees.creneaux) {
        if (c.weekday !== jourIso(ymd)) continue
        if (c.valid_from && c.valid_from > ymd) continue
        if (c.valid_until && c.valid_until < ymd) continue
        const ferme = donnees.exceptions.some(
          (e) =>
            e.kind === 'closed' &&
            e.date_start <= ymd &&
            e.date_end >= ymd &&
            (!e.slot_id || e.slot_id === c.id)
        )
        if (!ferme) out.push({ ymd, creneau: c })
      }
    }
    return out
  }

  /** Liste de choix d'une occurrence (« sam. 17 oct. · 18 h – 22 h »). */
  function choixOccurrence(surChoix) {
    const occ = prochainesOccurrences()
    const box = el('div', 'planning-occurrences')
    if (!occ.length) {
      box.appendChild(
        el('p', 'form__hint', 'Aucun créneau dans les trois prochaines semaines. Ajoutez d’abord votre semaine type.')
      )
      return box
    }
    let actif = null
    for (const o of occ) {
      const b = el('button', 'choix__option planning-occurrence')
      b.type = 'button'
      const d = new Date(o.ymd + 'T12:00:00')
      b.appendChild(
        el(
          'strong',
          null,
          d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
        )
      )
      b.appendChild(
        el('span', null, plageHoraire(o.creneau.start_time, o.creneau.end_time) + ' · ' + o.creneau.place_label)
      )
      b.addEventListener('click', () => {
        actif?.classList.remove('is-active')
        b.classList.add('is-active')
        actif = b
        surChoix(o)
      })
      box.appendChild(b)
    }
    return box
  }

  function panneauAbsent() {
    const p = el('div', 'planning-panneau')
    p.appendChild(el('p', 'form__hint', 'Touchez le créneau où vous ne serez pas là : il disparaît de la carte ce jour-là.'))
    const msg = el('p', 'form__msg')
    p.appendChild(
      choixOccurrence(async (o) => {
        msg.className = 'form__msg'
        msg.textContent = 'Enregistrement…'
        try {
          await ajouterException({
            truck_id: fiche.id,
            kind: 'closed',
            slot_id: o.creneau.id,
            date_start: o.ymd,
          })
          panneauOuvert = null
          await rafraichir()
        } catch (e) {
          msg.className = 'form__msg form__msg--err'
          msg.textContent = 'Impossible : ' + e.message
        }
      })
    )
    p.appendChild(msg)
    return p
  }

  function panneauVacances() {
    const p = el('form', 'planning-panneau form')
    const du = champDate('Du', aujourdhuiParis())
    const au = champDate('Au (inclus)', '')
    const ligne = el('div', 'planning-ligne')
    ligne.append(du.wrap, au.wrap)
    p.appendChild(ligne)
    p.appendChild(el('p', 'form__hint', 'Tous vos créneaux disparaissent de la carte pendant cette période.'))
    const msg = el('p', 'form__msg')
    const ok = bouton('Enregistrer mes vacances')
    p.append(ok, msg)
    p.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!du.input.value || !au.input.value) return erreur(msg, 'Indiquez les deux dates.')
      if (au.input.value < du.input.value) return erreur(msg, 'La fin est avant le début.')
      await envoyer(ok, msg, () =>
        ajouterException({
          truck_id: fiche.id,
          kind: 'closed',
          date_start: du.input.value,
          date_end: au.input.value,
        })
      )
    })
    return p
  }

  function panneauDeplace() {
    const p = el('form', 'planning-panneau form')
    p.appendChild(el('p', 'form__hint', '1. Le créneau concerné'))
    let choisi = null
    const suite = el('div', 'planning-suite')
    suite.hidden = true
    p.appendChild(
      choixOccurrence((o) => {
        choisi = o
        suite.hidden = false
        debut.input.value = o.creneau.start_time.slice(0, 5)
        fin.input.value = o.creneau.end_time.slice(0, 5)
      })
    )
    suite.appendChild(el('p', 'form__hint', '2. Le nouveau lieu, et l’horaire s’il change'))
    const lieu = choixLieu({ invite: 'Nouveau lieu' })
    suite.appendChild(lieu.wrap)
    const debut = champHeure('Début', '')
    const fin = champHeure('Fin', '')
    const ligne = el('div', 'planning-ligne')
    ligne.append(debut.wrap, fin.wrap)
    suite.appendChild(ligne)
    const msg = el('p', 'form__msg')
    const ok = bouton('Enregistrer le changement')
    suite.append(ok, msg)
    p.appendChild(suite)
    p.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!choisi) return erreur(msg, 'Choisissez d’abord le créneau.')
      const l = lieu.valeur()
      if (!l) return erreur(msg, 'Choisissez la commune dans la liste.')
      const memeHoraire =
        debut.input.value === choisi.creneau.start_time.slice(0, 5) &&
        fin.input.value === choisi.creneau.end_time.slice(0, 5)
      await envoyer(ok, msg, () =>
        ajouterException({
          truck_id: fiche.id,
          kind: 'moved',
          slot_id: choisi.creneau.id,
          date_start: choisi.ymd,
          start_time: memeHoraire ? null : debut.input.value,
          end_time: memeHoraire ? null : fin.input.value,
          lat: l.lat,
          lng: l.lng,
          place_label: l.label,
        })
      )
    })
    return p
  }

  function panneauExtra() {
    const p = el('form', 'planning-panneau form')
    const date = champDate('Date', aujourdhuiParis())
    p.appendChild(date.wrap)
    const debut = champHeure('Début', '18:00')
    const fin = champHeure('Fin', '22:00')
    const ligne = el('div', 'planning-ligne')
    ligne.append(debut.wrap, fin.wrap)
    p.appendChild(ligne)

    // Événement Armana facultatif : c'est lui qui allume « Food sur place ».
    const evChamp = el('label', 'form__field')
    evChamp.appendChild(el('span', 'form__label', 'Sur un événement d’Armana ? (facultatif)'))
    const select = el('select', 'form__input')
    select.appendChild(new Option('Non, ailleurs', ''))
    evChamp.appendChild(select)
    evChamp.appendChild(
      el('span', 'form__hint', 'Votre camion sera annoncé sur l’événement, avec le badge « Food sur place ».')
    )
    p.appendChild(evChamp)

    const lieuHote = el('div')
    let lieu = choixLieu()
    lieuHote.appendChild(lieu.wrap)
    p.appendChild(lieuHote)

    let evenements = []
    const remplirEvenements = async () => {
      if (!evenements.length) {
        evenements = (await listApprovedEvents().catch(() => [])).filter((e) => e.status === 'approved')
      }
      const jour = date.input.value
      const garde = select.value
      select.length = 1
      for (const ev of evenements) {
        if (!jour || !eventDayKeys(ev).includes(jour)) continue
        select.appendChild(new Option(ev.title + (ev.address ? ' — ' + ev.address : ''), ev.id))
      }
      select.value = [...select.options].some((o) => o.value === garde) ? garde : ''
    }
    remplirEvenements()
    date.input.addEventListener('change', remplirEvenements)
    // Un événement choisi donne son lieu : inutile de le ressaisir.
    select.addEventListener('change', () => {
      const ev = evenements.find((e) => e.id === select.value)
      lieuHote.innerHTML = ''
      // La commune de l'événement, et son point exact : rien à ressaisir.
      const ville = ev?.address ? villeDeLAdresse(ev.address) : ''
      lieu = choixLieu(
        ev && ev.lat != null && ville
          ? { lat: Number(ev.lat), lng: Number(ev.lng), label: ville.slice(0, 120) }
          : {}
      )
      lieuHote.appendChild(lieu.wrap)
    })

    const msg = el('p', 'form__msg')
    const ok = bouton('Ajouter cette présence')
    p.append(ok, msg)
    p.addEventListener('submit', async (e) => {
      e.preventDefault()
      const l = lieu.valeur()
      if (!date.input.value) return erreur(msg, 'Indiquez la date.')
      if (!debut.input.value || !fin.input.value) return erreur(msg, 'Indiquez les horaires.')
      if (!l) return erreur(msg, 'Choisissez la commune dans la liste.')
      await envoyer(ok, msg, () =>
        ajouterException({
          truck_id: fiche.id,
          kind: 'extra',
          date_start: date.input.value,
          start_time: debut.input.value,
          end_time: fin.input.value,
          lat: l.lat,
          lng: l.lng,
          place_label: l.label,
          event_id: select.value || null,
        })
      )
    })
    return p
  }

  // --- 3. La semaine type ---------------------------------------------------------
  function blocSemaine() {
    const s = el('section', 'planning-bloc')
    s.appendChild(el('h3', 'studio-title', 'Ma semaine type'))
    const liste = el('div', 'planning-semaine')
    if (!donnees.creneaux.length) {
      liste.appendChild(
        el('p', 'form__hint', 'Aucun créneau pour l’instant. Ajoutez les jours et les lieux où l’on vous trouve chaque semaine.')
      )
    }
    for (let j = 1; j <= 7; j++) {
      const du = donnees.creneaux.filter((c) => c.weekday === j)
      if (!du.length) continue
      const jour = el('div', 'planning-jour')
      jour.appendChild(el('h4', 'planning-jour__titre', JOURS[j - 1]))
      for (const c of du) jour.appendChild(ligneCreneau(c))
      liste.appendChild(jour)
    }
    s.appendChild(liste)

    const zone = el('div')
    const ajouter = el('button', 'btn btn--ghost btn--block planning-ajouter')
    ajouter.type = 'button'
    ajouter.append(icon('plus'), el('span', null, 'Ajouter un créneau'))
    ajouter.addEventListener('click', () => {
      ajouter.hidden = true
      zone.appendChild(formCreneau(null, () => {
        zone.innerHTML = ''
        ajouter.hidden = false
      }))
    })
    s.append(ajouter, zone)
    return s
  }

  function ligneCreneau(c) {
    const l = el('div', 'planning-creneau')
    const texte = el('div', 'planning-creneau__texte')
    texte.appendChild(el('strong', null, plageHoraire(c.start_time, c.end_time)))
    texte.appendChild(el('span', null, c.place_label))
    if (c.valid_from || c.valid_until) {
      texte.appendChild(el('small', null, saison(c)))
    }
    const modifier = el('button', 'btn btn--ghost btn--sm', 'Modifier')
    modifier.type = 'button'
    const suppr = el('button', 'btn btn--ghost btn--sm', 'Retirer')
    suppr.type = 'button'
    const boutons = el('div', 'planning-creneau__boutons')
    boutons.append(modifier, suppr)
    l.append(texte, boutons)
    modifier.addEventListener('click', () => {
      const f = formCreneau(c, () => f.replaceWith(l))
      l.replaceWith(f)
    })
    suppr.addEventListener('click', async () => {
      if (!confirm(`Retirer le créneau du ${JOURS[c.weekday - 1].toLowerCase()} (${c.place_label}) ?`)) return
      suppr.disabled = true
      try {
        await supprimerCreneau(c.id)
        await rafraichir()
      } catch (e) {
        alert('Impossible : ' + e.message)
        suppr.disabled = false
      }
    })
    return l
  }

  /** Formulaire de créneau. Création : PLUSIEURS jours d'un coup (« du mardi au samedi »). */
  function formCreneau(c, surAnnuler) {
    const f = el('form', 'planning-panneau form')
    f.appendChild(el('span', 'form__label', c ? 'Jour' : 'Jours *'))
    const jours = new Set(c ? [c.weekday] : [])
    const rangee = el('div', 'choix planning-jours')
    JOURS_COURTS.forEach((nom, i) => {
      const b = el('button', 'choix__option', nom)
      b.type = 'button'
      b.classList.toggle('is-active', jours.has(i + 1))
      b.addEventListener('click', () => {
        if (c) jours.clear() // en modification, un seul jour
        if (jours.has(i + 1)) jours.delete(i + 1)
        else jours.add(i + 1)
        for (const [k, x] of [...rangee.children].entries()) x.classList.toggle('is-active', jours.has(k + 1))
      })
      rangee.appendChild(b)
    })
    f.appendChild(rangee)

    const debut = champHeure('Début *', c?.start_time?.slice(0, 5) || '11:30')
    const fin = champHeure('Fin *', c?.end_time?.slice(0, 5) || '14:00')
    const ligne = el('div', 'planning-ligne')
    ligne.append(debut.wrap, fin.wrap)
    f.appendChild(ligne)
    f.appendChild(el('p', 'form__hint', 'Une fin avant le début = le créneau passe minuit (22 h – 2 h).'))

    const lieu = choixLieu(c ? { lat: c.lat, lng: c.lng, label: c.place_label } : {})
    f.appendChild(lieu.wrap)

    // Saisonnalité, repliée : rares sont ceux qui en ont besoin.
    const details = el('details', 'planning-saison')
    details.appendChild(el('summary', null, 'Seulement une partie de l’année ?'))
    const de = champDate('À partir du', c?.valid_from || '', { futur: false })
    const jusqu = champDate('Jusqu’au', c?.valid_until || '', { futur: false })
    const ligneS = el('div', 'planning-ligne')
    ligneS.append(de.wrap, jusqu.wrap)
    details.appendChild(ligneS)
    if (c?.valid_from || c?.valid_until) details.open = true
    f.appendChild(details)

    const msg = el('p', 'form__msg')
    const ok = bouton(c ? 'Enregistrer' : 'Ajouter')
    const annuler = el('button', 'btn btn--ghost btn--block', 'Annuler')
    annuler.type = 'button'
    annuler.addEventListener('click', surAnnuler)
    f.append(ok, annuler, msg)

    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!jours.size) return erreur(msg, 'Choisissez au moins un jour.')
      if (!debut.input.value || !fin.input.value) return erreur(msg, 'Indiquez les horaires.')
      if (debut.input.value === fin.input.value) return erreur(msg, 'Le début et la fin sont identiques.')
      const l = lieu.valeur()
      if (!l) return erreur(msg, 'Choisissez la commune dans la liste.')
      if (de.input.value && jusqu.input.value && jusqu.input.value < de.input.value) {
        return erreur(msg, 'La saison finit avant de commencer.')
      }
      await envoyer(ok, msg, async () => {
        for (const j of jours) {
          await enregistrerCreneau({
            id: c?.id,
            truck_id: fiche.id,
            weekday: j,
            start_time: debut.input.value,
            end_time: fin.input.value,
            lat: l.lat,
            lng: l.lng,
            place_label: l.label,
            valid_from: de.input.value,
            valid_until: jusqu.input.value,
          })
        }
      })
    })
    return f
  }

  // --- 4. Exceptions à venir -------------------------------------------------------
  function blocAVenir() {
    const s = el('section', 'planning-bloc')
    s.appendChild(el('h3', 'studio-title', 'À venir'))
    if (!donnees.exceptions.length) {
      s.appendChild(el('p', 'form__hint', 'Aucune absence ni présence exceptionnelle prévue.'))
      return s
    }
    const liste = el('div', 'planning-semaine')
    for (const e of donnees.exceptions) {
      const l = el('div', 'planning-creneau planning-creneau--' + e.kind)
      const texte = el('div', 'planning-creneau__texte')
      texte.appendChild(el('strong', null, titreException(e)))
      const detail = detailException(e)
      if (detail) texte.appendChild(el('span', null, detail))
      const suppr = el('button', 'btn btn--ghost btn--sm', 'Annuler')
      suppr.type = 'button'
      suppr.addEventListener('click', async () => {
        suppr.disabled = true
        try {
          await supprimerException(e.id)
          await rafraichir()
        } catch (err) {
          alert('Impossible : ' + err.message)
          suppr.disabled = false
        }
      })
      l.append(texte, suppr)
      liste.appendChild(l)
    }
    s.appendChild(liste)
    return s
  }

  function titreException(e) {
    const periode =
      e.date_start === e.date_end
        ? dateLongue(e.date_start)
        : `du ${dateLongue(e.date_start)} au ${dateLongue(e.date_end)}`
    if (e.kind === 'closed') return (e.slot_id ? 'Absent · ' : 'Vacances · ') + periode
    if (e.kind === 'moved') return 'Déplacé · ' + periode
    return 'En plus · ' + periode
  }

  function detailException(e) {
    const creneau = donnees.creneaux.find((c) => c.id === e.slot_id)
    const morceaux = []
    if (e.start_time) morceaux.push(plageHoraire(e.start_time, e.end_time))
    else if (creneau && e.kind !== 'extra') morceaux.push(plageHoraire(creneau.start_time, creneau.end_time))
    if (e.place_label) morceaux.push(e.place_label)
    else if (creneau) morceaux.push(creneau.place_label)
    if (e.events?.title) morceaux.push('sur « ' + e.events.title + ' »')
    return morceaux.join(' · ')
  }

  // --- Petits outils ------------------------------------------------------------------
  async function envoyer(bouton, msg, action) {
    bouton.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Enregistrement…'
    try {
      await action()
      panneauOuvert = null
      await rafraichir()
    } catch (err) {
      erreur(msg, 'Impossible : ' + err.message)
      bouton.disabled = false
    }
  }

  await rafraichir()
  return wrap
}

function erreur(msg, texte) {
  msg.className = 'form__msg form__msg--err'
  msg.textContent = texte
}

function bouton(texte) {
  const b = el('button', 'btn btn--primary btn--block', texte)
  b.type = 'submit'
  return b
}

/** `futur` : refuse les dates passées (absences, présences) ; pas pour une saison. */
function champDate(label, valeur, { futur = true } = {}) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = 'date'
  if (futur) input.min = aujourdhuiParis()
  input.value = valeur || ''
  wrap.appendChild(input)
  return { wrap, input }
}

/**
 * Une heure CHOISIE dans un menu, au quart d'heure — jamais tapée (demande de
 * Matthieu : aucun champ libre dans le planning). La liste commence à 6 h et
 * fait le tour jusqu'à 5 h 45 : les soirées qui passent minuit restent dans
 * l'ordre où on les vit.
 */
function champHeure(label, valeur) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('select', 'form__input')
  for (let i = 0; i < 96; i++) {
    const minutes = (6 * 60 + i * 15) % (24 * 60)
    const v = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    input.appendChild(new Option(heure(v + ':00'), v))
  }
  // Une valeur hors de la grille (ancienne saisie) ne doit pas disparaître.
  if (valeur && ![...input.options].some((o) => o.value === valeur)) {
    input.appendChild(new Option(heure(valeur + ':00'), valeur))
  }
  input.value = valeur || '12:00'
  wrap.appendChild(input)
  return { wrap, input }
}

function quandIlYA(jours) {
  if (jours <= 0) return 'aujourd’hui'
  if (jours === 1) return 'hier'
  return `il y a ${jours} jours`
}

function saison(c) {
  const f = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  if (c.valid_from && c.valid_until) return `Du ${f(c.valid_from)} au ${f(c.valid_until)}`
  if (c.valid_from) return `À partir du ${f(c.valid_from)}`
  return `Jusqu’au ${f(c.valid_until)}`
}
