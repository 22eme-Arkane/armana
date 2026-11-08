// Armana — Tableau de bord (admin uniquement) : fréquentation, membres,
// événements, contenus, et entretien du stockage.
//
// Tout vient d'un SEUL appel RPC (admin_stats) : une requête, agrégée côté base.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import {
  amIOwner,
  getAdminStats,
  getPublishedTotal,
  getUpcomingPublished,
  getVisitsBreakdown,
  getVisitsSummary,
  getVisitsTotal,
} from '../lib/admins.js'
import { myPendingCount } from '../lib/moderation.js'
import { DEPARTEMENTS, REGIONS, nomDepartement } from '../lib/departements.js'
import { purgePastMonths } from '../lib/events.js'
import { navigate } from '../lib/router.js'

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' })
const JOUR = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })
const MOIS_LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

export async function viewStats() {
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--studio-stats')
  wrap.appendChild(studioHeader('Statistiques', { backTo: '/parametres' }))

  if (!isLoggedIn() || !isAdmin()) {
    wrap.appendChild(el('p', 'empty-state', 'Réservé aux modérateurs.'))
    return wrap
  }

  const body = el('div', 'stats')
  body.appendChild(el('p', 'form__hint', 'Chargement des statistiques…'))
  wrap.appendChild(body)

  let stats
  let visites = null
  let publiesTotal = null
  let visitesTotal = null
  let aVenirPublies = null
  let enAttenteZone = null
  let frequentation = null
  try {
    // Tout en parallèle : chaque total vit dans sa propre fonction, au fil des
    // migrations, inutile de les attendre l'une après l'autre.
    ;[stats, visites, publiesTotal, visitesTotal, aVenirPublies, enAttenteZone, frequentation] =
      await Promise.all([
        getAdminStats(),
        getVisitsSummary(),
        getPublishedTotal(),
        getVisitsTotal(),
        getUpcomingPublished(),
        myPendingCount().catch(() => null),
        getVisitsBreakdown(),
      ])
  } catch (e) {
    body.innerHTML = ''
    body.appendChild(el('p', 'form__msg form__msg--err', 'Statistiques indisponibles : ' + e.message))
    body.appendChild(
      el(
        'p',
        'form__hint',
        'Si l’erreur mentionne « admin_stats », la migration 0009 n’a pas encore été appliquée dans Supabase.'
      )
    )
    return wrap
  }

  body.innerHTML = ''

  // ⚠ Déclaré ICI et non plus bas : la tuile ci-dessous s'en sert, et un
  // `const` lu avant sa déclaration lèverait une erreur.
  const anon = stats.visites_anonymes ?? {}

  // --- Les trois chiffres qui comptent, en tête d'écran --------------------
  // Le coup d'œil de la maquette : visites, membres, événements, en très gros.
  // Le détail complet suit juste en dessous — rien n'est retiré.
  const bandeau = el('div', 'stats-hero')
  const grandChiffre = (valeur, mot) => {
    const l = el('div', 'stats-hero__ligne')
    l.appendChild(el('span', 'stats-hero__valeur', String(valeur ?? 0)))
    l.appendChild(el('span', 'stats-hero__mot', mot))
    bandeau.appendChild(l)
  }
  // ⚠ CHAQUE LIBELLÉ DIT SON UNITÉ. C'est la leçon de l'écart 1130 / 2079 :
  // les deux chiffres étaient justes, mais rien ne distinguait les VISITES
  // (chaque ouverture) des VISITEURS (les personnes). Ces quatre-là sont des
  // cumuls DEPUIS LA CRÉATION d'Armana ; les tuiles du dessous découpent par
  // période. Ne jamais mélanger les deux unités sans le dire dans le mot.
  grandChiffre(visites?.total ?? visitesTotal ?? 0, 'visites totales')
  grandChiffre(
    (stats.visites.uniques_total ?? 0) + (anon.uniques_total ?? 0),
    'visiteurs uniques'
  )
  grandChiffre(stats.membres.total, 'membres inscrits')
  // ⚠ Depuis la CRÉATION d'Armana, purges comprises. Compter la table donnerait
  // un total qui RÉTRÉCIT à chaque purge mensuelle : ce chiffre vient donc d'un
  // compteur que rien n'efface. Repli sur les seuls à venir tant que la
  // migration 0025 n'est pas appliquée.
  grandChiffre(publiesTotal ?? aVenirPublies ?? stats.evenements.a_venir, 'événements publiés')
  body.appendChild(bandeau)

  // --- Les quatre tuiles : LES VISITES, par période ------------------------
  // ⚠ Des VISITES, jamais des visiteurs uniques : quelqu'un qui ouvre
  // l'application trois fois aujourd'hui compte trois fois. Et la tuile
  // « Membres » a disparu — elle répétait mot pour mot le grand chiffre situé
  // juste au-dessus.
  // Semaine et mois sont CALENDAIRES : depuis lundi, depuis le 1er. Ce sont les
  // bornes auxquelles on pense en lisant ces mots ; des fenêtres glissantes de
  // 7 ou 30 jours auraient donné des chiffres qu'on n'aurait pas su recouper.
  const kpis = el('div', 'stats-grid')
  const visitesDuJour = visites?.aujourdhui ?? (stats.visites.aujourdhui ?? 0) + (anon.aujourdhui ?? 0)
  const visitesHier = visites?.hier ?? (stats.visites.hier ?? 0) + (anon.hier ?? 0)
  kpis.appendChild(kpi('Visites aujourd’hui', visitesDuJour))
  kpis.appendChild(kpi('Visites hier', visitesHier))
  kpis.appendChild(kpi('Visites cette semaine', visites?.semaine ?? '—', 'depuis lundi'))
  // Le NOM du mois plutôt que « depuis le 1er » : « août » se lit d'un coup
  // d'œil et lève l'ambiguïté quand on consulte l'écran un 2 du mois.
  kpis.appendChild(kpi('Visites ce mois-ci', visites?.mois ?? '—', MOIS_LONG.format(new Date())))
  body.appendChild(kpis)

  // ⚠ MA ZONE, pas tout le territoire. La tuile comptait les événements des
  // six départements alors que le bouton juste dessous mène à une file
  // cloisonnée : un modérateur du 04 lisait 7 et n'en trouvait que 3 à
  // traiter. `myPendingCount()` applique can_moderate(), comme la file.
  const enAttente = enAttenteZone ?? stats.evenements.en_attente

  // Le bouton suit la tuile : il ne s'affiche que s'il y a vraiment quelque
  // chose à traiter DANS SA ZONE, sinon il menait à une file vide.
  if (enAttente > 0) {
    const go = el('button', 'btn btn--primary btn--block', 'Aller à la modération')
    go.type = 'button'
    go.addEventListener('click', () => navigate('/moderation'))
    body.appendChild(go)
  }

  // --- Les tableaux de détail, FABRIQUÉS ICI mais POSÉS PLUS BAS -----------
  // Matthieu les veut sous « Contenus » : les graphiques racontent l'activité,
  // ces listes ne servent qu'à vérifier un chiffre précis. On les construit ici,
  // où les données sont sous la main, et on les ajoute à l'écran tout en bas.
  //
  // ⚠ Deux choses distinctes, autrefois mélangées dans un seul tableau :
  //   * QUI VIENT — passages réellement observés, mesurés depuis peu ;
  //   * L'ÉTAT DES COMPTES — historique d'authentification, qui remonte à la
  //     création de chaque compte.
  // Côte à côte sans explication, on lisait « 36 connectés sur 7 jours » sous
  // « 26 visiteurs sur 30 jours » et l'on croyait le tableau faux.
  const detail = document.createDocumentFragment()
  detail.appendChild(section('Qui vient'))
  const freq = el('div', 'settings-group')
  freq.appendChild(line('Navigateurs sans compte (7 jours)', anon.uniques_7j ?? 0))
  freq.appendChild(line('Navigateurs sans compte (30 jours)', anon.uniques_30j ?? 0))
  // Cumul depuis le début de la mesure, inscrits et non-inscrits réunis.
  const totalVisiteurs = (stats.visites.uniques_total ?? 0) + (anon.uniques_total ?? 0)
  // ⚠ « majorant » et non « total » : rien ne relie un navigateur anonyme au
  // compte créé ensuite, donc quelqu'un qui s'inscrit après être passé sans
  // compte est compté DEUX fois — définitivement. C'est un plafond, pas un
  // nombre de personnes.
  freq.appendChild(line('Membres + navigateurs sans compte (majorant)', totalVisiteurs))
  detail.appendChild(freq)

  detail.appendChild(section('État des comptes'))
  const comptes = el('div', 'settings-group')
  comptes.appendChild(line('Dernière connexion il y a moins de 24 h', stats.connexions.actifs_24h))
  comptes.appendChild(line('Dernière connexion il y a moins de 7 jours', stats.connexions.actifs_7j))
  comptes.appendChild(line('Dernière connexion il y a moins de 30 jours', stats.connexions.actifs_30j))
  comptes.appendChild(line('E-mails confirmés', stats.connexions.emails_confirmes))
  detail.appendChild(comptes)

  // ⚠ DEUX UNITÉS POSSIBLES, ET LE TITRE DOIT DIRE LAQUELLE.
  // `visits_breakdown` (migration 0027) compte des VISITES — `sum(passages)` —
  // comme les quatre tuiles du haut. Les `par_jour` / `par_departement`
  // d'`admin_stats`, eux, comptent des LIGNES : une par visiteur et par jour,
  // donc des VISITEURS. Affichés côte à côte sans le dire, ils donnaient 59
  // face à 115 pour le même 30 août. On préfère les visites ; tant que la
  // migration n'est pas appliquée on retombe sur les visiteurs, et le titre
  // change avec la donnée — jamais l'un sans l'autre.
  const enVisites = Boolean(frequentation)
  const periode = '(30 derniers jours)'

  const parJour = new Map()
  if (enVisites) {
    for (const d of frequentation.par_jour ?? []) parJour.set(d.label, d.n)
  } else {
    // Les deux publics cumulés : inscrits et visiteurs sans compte.
    for (const d of stats.visites.par_jour ?? []) parJour.set(d.label, d.n)
    for (const d of anon.par_jour ?? []) parJour.set(d.label, (parJour.get(d.label) ?? 0) + d.n)
  }
  const daily = [...parJour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, n]) => ({
      label: JOUR.format(new Date(label + 'T12:00:00')),
      n,
    }))
  // D'où viennent les gens (position GPS quand elle est donnée — seul le
  // département est enregistré, jamais la position elle-même).
  const parDept = repartitionParDept(
    enVisites ? frequentation.par_departement : stats.par_departement,
    'non renseigné'
  )
  if (parDept.some((d) => d.n)) {
    body.appendChild(
      section(`${enVisites ? 'Visites' : 'Visiteurs'} par département ${periode}`)
    )
    body.appendChild(barChart(parDept))
  }

  // Où se passe l'activité : les événements à venir, par département.
  const evtDept = repartitionParDept(stats.evenements_par_departement, 'hors territoire')
  if (evtDept.some((d) => d.n)) {
    body.appendChild(section('Événements publiés à venir, par département'))
    body.appendChild(barChart(evtDept))
  }

  if (daily.length) {
    body.appendChild(
      section(`${enVisites ? 'Visites' : 'Visiteurs'} par jour, tous publics ${periode}`)
    )
    body.appendChild(barChart(daily))
  }

  detail.appendChild(section('Événements'))
  const evs = el('div', 'settings-group')
  evs.appendChild(line('Publiés (approuvés)', stats.evenements.approuves))
  evs.appendChild(line('En attente', stats.evenements.en_attente))
  evs.appendChild(line('Rejetés', stats.evenements.rejetes))
  evs.appendChild(line('Payants (tous statuts)', stats.evenements.payants))
  // ⚠ Fenêtres GLISSANTES, pas semaine ni mois calendaires : le 3 du mois,
  // « ce mois-ci » remontait jusqu'au mois précédent sans le dire.
  evs.appendChild(line('Créés ces 7 jours', stats.evenements.new_7j))
  evs.appendChild(line('Créés ces 30 jours', stats.evenements.new_30j))
  detail.appendChild(evs)

  const parMois = (stats.par_mois ?? []).map((m) => ({
    label: MOIS.format(new Date(m.label + '-01T12:00:00')),
    n: m.n,
  }))
  if (parMois.length) {
    body.appendChild(section('Événements par mois'))
    body.appendChild(barChart(parMois))
  }

  if (stats.par_categorie?.length) {
    body.appendChild(section('Par catégorie'))
    body.appendChild(barChart(stats.par_categorie))
  }

  if (stats.top_auteurs?.length) {
    body.appendChild(section('Contributeurs les plus actifs'))
    body.appendChild(barChart(stats.top_auteurs))
  }

  // --- Contenus ------------------------------------------------------------
  body.appendChild(section('Contenus'))
  const cont = el('div', 'settings-group')
  cont.appendChild(line('Photos stockées', stats.photos.total))
  cont.appendChild(line('Favoris posés', stats.favoris.total))
  cont.appendChild(line('Retours reçus', stats.retours.total))
  cont.appendChild(line('— dont bugs', stats.retours.bugs))
  cont.appendChild(line('— dont avis', stats.retours.avis))
  body.appendChild(cont)

  // Les trois tableaux de détail, enfin posés.
  body.appendChild(detail)

  // --- Entretien du stockage : PROPRIÉTAIRE UNIQUEMENT ----------------------
  // La purge est irréversible et globale : elle n'a rien à faire entre les
  // mains d'un modérateur (et la base la refuse de toute façon depuis 0020).
  if (await amIOwner().catch(() => false)) {
    body.appendChild(section('Entretien du stockage'))
    const maint = el('div', 'settings-group')
    maint.appendChild(line('Événements des mois passés', stats.evenements.a_purger))
    body.appendChild(maint)

    const purgeBtn = el('button', 'btn btn--block', 'Nettoyer les mois passés')
    purgeBtn.type = 'button'
    purgeBtn.disabled = stats.evenements.a_purger === 0
    const purgeMsg = el('p', 'form__msg')
    purgeBtn.addEventListener('click', async () => {
      if (
        !confirm(
          `Supprimer définitivement ${stats.evenements.a_purger} événement(s) des mois passés, ainsi que leurs photos ?\n\nCette action est irréversible.`
        )
      )
        return
      purgeBtn.disabled = true
      purgeBtn.textContent = 'Nettoyage…'
      try {
        const r = await purgePastMonths()
        purgeMsg.className = 'form__msg'
        purgeMsg.textContent = `${r.events} événement(s) et ${r.files} fichier(s) supprimés.`
        purgeBtn.textContent = 'Nettoyage terminé'
      } catch (e) {
        purgeMsg.className = 'form__msg form__msg--err'
        purgeMsg.textContent = 'Nettoyage impossible : ' + e.message
        purgeBtn.disabled = false
        purgeBtn.textContent = 'Réessayer'
      }
    })
    body.appendChild(purgeBtn)
    body.appendChild(purgeMsg)
  }

  const stamp = new Date(stats.generated_at)
  body.appendChild(
    el('p', 'form__hint', 'Arrêté au ' + stamp.toLocaleString('fr-FR') + '.')
  )

  return wrap
}

// --- Petits composants ------------------------------------------------------

function kpi(label, value, hint, alert = false) {
  const box = el('div', 'stat-tile' + (alert ? ' stat-tile--alert' : ''))
  box.appendChild(el('span', 'stat-tile__value', String(value ?? 0)))
  box.appendChild(el('span', 'stat-tile__label', label))
  if (hint) box.appendChild(el('span', 'stat-tile__hint', hint))
  return box
}

function section(title) {
  const h = el('h2', 'stats-section')
  h.appendChild(icon('chevronRight'))
  h.appendChild(document.createTextNode(' ' + title))
  return h
}

function line(label, value) {
  const r = el('div', 'settings-row settings-row--static')
  r.appendChild(el('span', 'settings-row__label', label))
  r.appendChild(el('span', 'settings-row__value', String(value ?? 0)))
  return r
}

/** Histogramme horizontal en CSS pur — aucune bibliothèque, aucun réseau. */
/**
 * Répartition par département, COMPLÉTÉE par les départements ouverts que le
 * SQL n'a pas renvoyés — à zéro.
 *
 * ⚠ Sans cela, un département sans activité DISPARAÎT du graphique. On ne
 * distingue alors plus « aucun événement ici » de « ce département n'est pas
 * ouvert », ce qui a fait croire à une ouverture PACA ratée. Le SQL regroupe
 * les lignes existantes : il ne peut pas inventer celles qui sont vides, c'est
 * donc ici que la liste complète doit être rétablie.
 *
 * Les codes hors de la liste ouverte (« — » sans position, ou un département
 * fermé qui porte encore des données) sont conservés et rejetés en fin.
 */
// ⚠ DEPUIS L'OUVERTURE À LA FRANCE, PAR RÉGION : 96 lignes à zéro rendraient
// le graphique illisible. Chaque région a sa ligne (même vide, pour la même
// raison que ci-dessus), suivie du détail de ses départements actifs.
function repartitionParDept(lignes, libelleHorsListe) {
  const trouves = new Map((lignes ?? []).map((d) => [d.code, d.n]))
  const regions = REGIONS.map((r) => {
    const depts = r.depts
      .map((d) => ({ label: `· ${d.code} ${d.nom}`, n: trouves.get(d.code) ?? 0, sous: true }))
      .filter((d) => d.n > 0)
      .sort((a, b) => b.n - a.n)
    return { label: r.nom, n: depts.reduce((s, d) => s + d.n, 0), depts }
  })
  regions.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  const ouverts = regions.flatMap(({ label, n, depts }) => [{ label, n }, ...depts])

  const autres = []
  for (const [code, n] of trouves) {
    if (code === '—') autres.push({ label: libelleHorsListe, n })
    else if (!DEPARTEMENTS.some((d) => d.code === code)) {
      autres.push({ label: `${code} ${nomDepartement(code)}`, n })
    }
  }
  autres.sort((a, b) => b.n - a.n)
  return [...ouverts, ...autres]
}

function barChart(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  const box = el('div', 'bars')
  for (const r of rows) {
    const line = el('div', r.sous ? 'bars__row bars__row--sous' : 'bars__row')
    line.appendChild(el('span', 'bars__label', r.label))
    const track = el('div', 'bars__track')
    const fill = el('div', 'bars__fill')
    fill.style.width = Math.round((r.n / max) * 100) + '%'
    track.appendChild(fill)
    line.appendChild(track)
    line.appendChild(el('span', 'bars__value', String(r.n)))
    box.appendChild(line)
  }
  return box
}
