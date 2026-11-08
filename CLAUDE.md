# CLAUDE.md — Armana

## Identité du projet

**Armana** est une **PWA d'agenda culturel régional**, multi-utilisateur, adossée à
**Supabase**. Elle remplace un groupe WhatsApp de 1000+ personnes : à l'ouverture,
l'utilisateur voit les événements culturels de sa région sur un **calendrier** + une
**carte** interactive. Les inscrits publient des événements (photo, description,
date(s), gratuit/payant + prix) et « **Gemment** » leurs favoris.

**Territoire couvert : toute la France métropolitaine et la Corse** (96
départements, 13 régions — ouverture du 07/11/2026, migration 0039 ; avant :
PACA + Drôme). La liste vit dans `src/lib/territoire.js` (généré) et en base
dans la table `departements`. Les contours officiels sont découpés par région
dans `public/data/contours/<région>.geojson` (jeu Etalab NON simplifié — deux
départements voisins doivent partager exactement les mêmes sommets, sinon un
liseré de masque apparaît entre eux), plus `france-allege.geojson` pour
localiser un point et dessiner les vignettes ; les communes dans
`public/data/communes/`. Chacun choisit ses régions et départements dans
**Profil → Mon territoire** (un appareil neuf choisit sa région au premier
lancement) ; le filtre agit sur l'agenda ET sur la carte, où un département
décoché repasse sous le masque. Les événements sont filtrés EN BASE par
`events.dept`.

> Le sélecteur de rayon (10/20/50 km) a été retiré : il ne faisait que cacher des
> événements proches. Tout le territoire est chargé d'un coup.

> ⚠ **Projet strictement isolé.** À NE PAS confondre avec **PANDORA**, **ORAKLE**,
> **Arkanyx** : repo séparé, aucune dépendance croisée, aucun fichier partagé. Ce dépôt
> ne touche à aucun autre projet, et réciproquement. Ce CLAUDE.md fait seul autorité ici.

---

## Stack imposée

- **Front** : PWA — Vite + JS vanilla, `manifest.webmanifest` + service worker
  (installable, offline shell). Pas de framework.
- **Carte** : Leaflet + tuiles OpenStreetMap (pas de clé, pas d'abonnement).
- **Backend** : Supabase (Postgres + PostGIS + Auth + Storage), **projet Supabase dédié**.
- **Recherche par rayon** : PostGIS `ST_DWithin` sur une colonne `geography(Point,4326)`.
- **Déploiement** : **Vercel** (build statique Vite, `npm run build` → `dist/` ;
  `vercel.json` : framework vite + fallback SPA). Variables d'env `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` dans le dashboard Vercel (build-time).

---

## Invariants — non négociables

1. **Aucune clé / secret** dans le repo, les prompts ou les logs. Uniquement via `.env`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) ; `.env.example` commité **sans valeurs**.
   Jamais la clé `service_role` côté client.
2. **Séparation stricte** : ce repo ne touche à aucun autre projet.
3. **Sécurité côté base** : RLS activé partout, **jamais** de confiance côté client.
4. **Rôles** (depuis la migration 0020) — trois niveaux, deux valeurs en base :
   - **Propriétaire** (`profiles.is_owner`, unique — Matthieu) : tous les droits.
     Gestion des modérateurs, candidatures, messages, membres, purge, journal.
   - **Modérateur** (`role = 'admin'` en base ; TOUJOURS dit « modérateur » dans
     l'interface) : modération + statistiques, CLOISONNÉ à sa zone
     `profiles.mod_depts` (ex. `{'04'}`). `NULL` = tous les départements.
     Le cloisonnement est imposé par `can_moderate(dept)` dans les politiques RLS
     (events, event_photos, storage.objects) — jamais seulement par l'interface.
   - **User** : ne gère que ses propres événements. Peut postuler modérateur
     (`moderator_requests`, écran « Devenir modérateur ») ; un modérateur demande
     une extension de zone depuis « Mes départements ».
   Rôle et zone ne se modifient que par le propriétaire (garde-fou trigger).
   Chaque événement porte son département (`events.dept`, trigger PostGIS sur les
   contours allégés de `dept_contours`, migration 0019).
5. **Modération** : `events.status ∈ {pending, approved, rejected}`. Le public ne voit
   que `approved`.

> Note d'implémentation : Vite n'expose au navigateur que les variables préfixées
> `VITE_`. Les noms du cahier des charges (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) sont
> donc portés en `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

---

## Design & UI (Phase 1 — reproduire la maquette)

### Design tokens (thème « Soleil d'Or » par défaut, dans `src/style.css`)
Variables CSS par thème (`[data-theme=…]`) ; tout le reste s'appuie dessus.
- `--bg` fond principal **#F9D44D** (jaune chaud)
- `--accent` / jour sélectionné **#F7C108** (orange doré, carré à coins arrondis)
- `--grad` carte « ambiance » quand pas de photo **#533377** (violet)
- `--green` titres / marque **#2E7D32** (⚠ À CONFIRMER par Matthieu)
- `--fav` cœur favori · `--surface` blanc · rayons généreux (cartes 20px, chips pilules)
- Police : sans-serif ronde souhaitée (**Poppins/Nunito — À CONFIRMER** ; fallback
  `system-ui` tant que non embarquée pour rester offline-first).
- Mobile-first, **une seule colonne** centrée (`--maxw: 540px`), plein écran.
- Multi-thèmes conservés (sélecteur 🎨 dans Paramètres) ; Soleil d'Or = défaut.

### Navigation — barre du bas, 4 onglets (icônes Lucide inline, `src/ui/icons.js`)
`Calendrier` (défaut) · `Map` · `Favoris` · `Paramètres`. Barre fixe en bas, libellés
sous les icônes (`src/ui/nav.js`). Les sous-écrans (détail, publier, mes événements,
modération, connexion) allument leur onglet parent.

### Écrans
- **Calendrier** (`viewCalendar.js`) : titre centré vert ; chips de catégories
  scrollables (filtre partagé liste + carte via `src/lib/filter.js`) ; calendrier mensuel
  (jour sélectionné = carré orange, pastille verte sur les jours à événement, mois passés
  jamais affichés) ; liste sous le calendrier (jour sélectionné, sinon « à venir »).
- **Carte** (`viewMap.js`) : Leaflet+OSM, position via `resolveStartLocation` (géoloc →
  ville par défaut → centre 04), rayon 10/20/50 km (`ST_DWithin`), respecte le filtre.
- **Favoris** (`viewGems.js`) · **Détail** (`viewDetail.js`, photo pleine résolution).
- **Paramètres** (`viewSettings.js`) : compte (Auth), ville par défaut, thème, mes
  événements, et si `role=admin` → file de modération.

### Composant carte événement — UNIQUE (`eventCard` dans `src/ui/components.js`)
Fond = **vignette** photo + overlay dégradé (lisibilité) ; sans photo → dégradé violet.
Affiche titre, date, lieu (pin), badge « Payant · N € » si `is_paid`, cœur favori en
coin (table `gems`). Tap → écran détail.

---

## Règles de STOCKAGE (critiques — rester sur le plan gratuit)

1. **Upload compressé côté client** (`src/lib/image.js`, AVANT Supabase Storage) :
   redimensionner à ~1600px + encoder **WebP** ; générer aussi une **vignette ~400px**.
   Chemins : `{uid}/{eventId}/photo.webp` (pleine) + `thumb.webp` (vignette).
   La vignette sert aux listes/cartes ; la pleine résolution seulement au détail.
2. **Filtre d'affichage** : ne lister que les événements non terminés
   (`ends_at >= now()`, sinon `starts_at`). Les mois passés ne s'affichent jamais
   (`isUpcoming` / `applyUpcoming` dans `src/lib/events.js`).
3. **Règle de rétention — au MOIS, pas au jour.** On conserve le **mois en cours**
   et **tous les mois à venir** ; on supprime tout ce qui appartient aux **mois
   révolus**. En juillet : juillet, août, septembre… sont gardés ; juin, mai… sont
   purgés (base **et** photos). Deux mises en œuvre :
   - **Edge Function** `supabase/functions/purge-expired` + cron quotidien
     (automatique, à déployer une fois) ;
   - **bouton « Nettoyer les mois passés »** dans Profil → Statistiques
     (manuel, disponible sans aucun déploiement — s'appuie sur la RPC
     `expired_events_before_month` et les droits admin du bucket, migration 0009).
   ⚠ **PIÈGE** : supprimer d'abord les **fichiers Storage** (original + vignette) via
   l'API Storage, **PUIS** les lignes en base (`event_photos` + `gems` en cascade).
   Un simple DELETE SQL ne libère PAS le Storage. `service_role` **côté serveur
   uniquement**, jamais exposé (invariant).

---

## Modèle de données

Défini dans [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
(extension `postgis` activée, RLS complète).

- **profiles**(`id` → `auth.users`, `display_name`, `role` {user,admin}, `created_at`)
  — créé automatiquement à l'inscription (trigger `handle_new_user`).
- **events**(`id`, `created_by` → profiles, `title`, `description`, `starts_at`,
  `ends_at`, `is_paid`, `price` null, `currency` 'EUR', `location` geography(Point,4326),
  `address`, `category`, `status`, `created_at`).
- **event_photos**(`id`, `event_id` → events, `storage_path`, `position`).
- **gems**(`user_id` → profiles, `event_id` → events, `created_at`, **PK(user_id,event_id)**).
- **Storage** : bucket `event-photos` (lecture publique, écriture confinée au dossier
  `{uid}/…` de l'auteur).
- **Recherche par rayon** : fonction `events_within_radius(lat, lng, radius_m)` →
  `ST_DWithin(location, ST_MakePoint(lng,lat)::geography, radius_m)`. En INVOKER : la RLS
  s'applique, donc un anonyme ne reçoit que les événements `approved`.

### Résumé des politiques RLS

| Table         | Lecture                                   | Écriture                                             |
|---------------|-------------------------------------------|------------------------------------------------------|
| profiles      | publique                                  | insert/​update sa ligne ; admin override ; pas d'auto-escalade de rôle |
| events        | `approved` (public) + siens + admin       | insert pour soi en `pending` ; update sans auto-approbation ; admin tout ; delete auteur/admin |
| event_photos  | miroir de la visibilité de l'événement    | auteur de l'événement ou admin                       |
| gems          | seulement les siennes                     | insert/​delete les siennes                            |
| storage.objects (`event-photos`) | publique                | upload/​update/​delete confinés au dossier `{uid}/`  |

---

## Boucle de travail (à appliquer systématiquement)

Travailler comme un ingénieur qui relit, teste et corrige son propre code avant de livrer.
**Un livrable par session**, en étapes incrémentales auto-validées.

1. **Avant d'agir — planifier.** Reformuler la tâche en une phrase ; découper en étapes ;
   si une étape est ambiguë ou entre en conflit avec un invariant, **demander** avant de
   coder. Identifier les fichiers concernés.
2. **Pendant — petits incréments.** Une modification cohérente à la fois. Après chaque
   modif, relire son propre diff (imports, effets de bord, régressions). Architecture
   modulaire : une fonctionnalité = un module dédié, jamais de monolithe.
3. **Après — vérifier (jamais sauté).**
   - Front : `npm run build` doit passer ; `npm run dev` pour un contrôle visuel quand le
     rendu compte (layout, carte, formulaire).
   - SQL : relire la migration ; vérifier mentalement chaque politique RLS contre les
     rôles (anonyme / user / auteur / admin) avant de la considérer correcte.
4. **Sécurité à chaque tâche.** Aucun secret introduit ; RLS cohérente ; le public ne voit
   que `approved` ; un user ne peut pas agir sur les données d'un autre.
5. **Auto-critique avant de rendre la main.** « Qu'est-ce qui pourrait être cassé que je
   n'ai pas testé ? Ai-je introduit une faille RLS ? Un secret a-t-il pu fuiter ? »
6. **Rendre la main = rapport.** Dire ce qui a été fait ET vérifié ; signaler honnêtement
   ce qui n'a pas pu l'être ; lister ce qui reste à décider.

### Garde-fous (priment sur tout)

- **Jamais** `git push`, `git reset --hard`, `git clean`, `rm`/`Remove-Item`, ni
  publication `gh` sans demande explicite. Commit + `git add` locaux OK.
- **Jamais** de secret réel dans un fichier suivi, un prompt ou un log.
- **Ne jamais** toucher un autre projet (PANDORA, ORAKLE, Arkanyx) depuis ce repo.
- **Ne jamais** relâcher la RLS « pour tester » : isoler côté données de test, pas en
  désactivant les politiques de production.

---

## Arborescence

```
Armana/
├── CLAUDE.md
├── README.md
├── .env.example                 # sans valeurs
├── .gitignore
├── package.json
├── vite.config.js
├── index.html
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js                     # service worker (offline shell)
│   └── icons/                    # icon-192.png / icon-512.png (à fournir)
├── src/
│   ├── main.js                   # point d'entrée (Phase 0 : squelette)
│   ├── style.css
│   └── lib/
│       └── supabaseClient.js     # client Supabase + eventsWithinRadius()
└── supabase/
    └── migrations/
        └── 0001_init.sql         # schéma + PostGIS + RLS + Storage
```

---

## État d'avancement

### ✅ Phase 0
- Scaffold Vite PWA vanilla (manifest + service worker offline shell).
- Intégration `@supabase/supabase-js` + Leaflet.
- Migrations SQL : `0001_init.sql` (PostGIS, tables, triggers, vue `events_geo`, fonction
  de rayon, RLS, GRANT, bucket Storage) + `0002_rpc_events.sql` (`create_event` /
  `update_event`).
- `.env.example`, README de setup, ce CLAUDE.md.

### ✅ Phase 1 — codée, `npm run build` vert (à valider en réel)
- Auth Supabase e-mail/mot de passe (`src/lib/auth.js`, `src/ui/viewAuth.js`).
- Agenda des événements approuvés, groupés par mois + filtre catégorie (`viewCalendar.js`).
- Carte Leaflet + géoloc + filtre par rayon 10/20/50 km via `ST_DWithin` (`viewMap.js`).
- Formulaire de publication : mini-carte (marqueur déplaçable + géocodage Nominatim),
  upload photo → Storage, dates, gratuit/payant + prix, édition `?id=` (`viewPublish.js`).
- Favoris « Gems » (`viewGems.js`).
- Mes événements — édition / suppression (`viewMine.js`).
- Modération admin — approuver / rejeter / supprimer (`viewAdmin.js`).

### 🔲 Reste à faire
- Créer le projet Supabase, appliquer les migrations, remplir `.env`, tester en réel.
- Déployer sur Vercel (variables d'environnement Supabase à renseigner).
- Fournir les icônes PWA (`public/icons/icon-192.png`, `icon-512.png`).
- Pistes : multi-photos, événements récurrents, notifications, recherche plein texte.
