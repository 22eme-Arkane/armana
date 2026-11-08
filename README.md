<p align="center">
  <img src="public/icons/armana-logo-grand.png" alt="Armana" width="160" />
</p>

# Armana

PWA d'**agenda culturel partagé, partout en France** — métropole et Corse :
96 départements, 13 régions. Née en Provence pour remplacer un groupe WhatsApp
de 1000+ personnes : à l'ouverture, les événements culturels de sa région sur un
**calendrier** + une **carte** interactive. Chacun choisit ses régions et
départements dans **Profil → Mon territoire** (sa région est proposée au premier
lancement). Les inscrits publient un événement et « **Gemment** » leurs favoris.

**En ligne : https://armana.app**

> Projet **isolé**. Aucune dépendance ni fichier partagé avec PANDORA, ORAKLE, Arkanyx.

---

## Stack

| Couche      | Choix                                                        |
|-------------|-------------------------------------------------------------|
| Front       | PWA — Vite + JavaScript vanilla, manifest + service worker  |
| Carte       | Leaflet + tuiles OpenStreetMap (sans clé, sans abonnement)  |
| Backend     | Supabase (Postgres + PostGIS + Auth + Storage) — projet dédié |
| Recherche   | PostGIS `ST_DWithin` sur `geography(Point,4326)`            |
| Déploiement | Cloudflare Pages                                            |

---

## Prérequis

- Node.js ≥ 18
- Un compte [Supabase](https://supabase.com) (offre gratuite suffisante pour démarrer)

---

## Setup

### 1. Installer les dépendances

```bash
npm install
```

### 2. Créer le projet Supabase dédié

1. Sur [app.supabase.com](https://app.supabase.com), **New project** (choisir une région
   proche, ex. Europe). Noter le mot de passe Postgres.
2. Dans **Project Settings → API**, récupérer :
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`

### 3. Appliquer la migration SQL

Le plus simple sans CLI : ouvrir **SQL Editor** dans le dashboard Supabase et exécuter,
**dans l'ordre**, le contenu de :

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — extension
   PostGIS, tables, vue `events_geo`, fonction de recherche par rayon, bucket Storage
   `event-photos`, **toutes** les politiques RLS et les `GRANT`.
2. [`supabase/migrations/0002_rpc_events.sql`](supabase/migrations/0002_rpc_events.sql) —
   fonctions `create_event` / `update_event`.
3. [`supabase/migrations/0003_admin_management.sql`](supabase/migrations/0003_admin_management.sql) —
   gestion des administrateurs par e-mail (`set_admin_by_email`, `list_admins`).
4. [`supabase/migrations/0004_fix_role_guard.sql`](supabase/migrations/0004_fix_role_guard.sql) —
   correctif : le garde-fou de rôle ne bloque plus le SQL Editor / service_role
   (sans quoi le premier admin ne peut pas être désigné).

> Avec la CLI Supabase installée : `supabase link` puis `supabase db push`.

### 3 bis. Se désigner PREMIER administrateur

Les rôles sont dans `profiles.role`. Après votre 1re inscription, passez **votre** compte
en admin depuis le SQL Editor (à faire une seule fois) :

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'VOTRE_EMAIL');
```

Ensuite, **tout se fait dans l'app** : **Paramètres → Gérer les administrateurs** permet
de désigner d'autres admins **par e-mail** (une fois qu'ils ont créé leur compte) et de
les retirer. Un admin peut modifier/supprimer tous les événements et nommer d'autres
admins.

### 4. Configurer l'environnement local

```bash
cp .env.example .env
# puis renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env
```

### 5. Lancer en local

```bash
npm run dev
```

L'écran d'accueil Phase 0 indique si la configuration Supabase est bien détectée.

---

## Déploiement (Vercel)

Le projet est un site **statique Vite** (aucun code spécifique à un hébergeur). Vercel
détecte automatiquement Vite ; `vercel.json` fixe la sortie et le fallback SPA.

### Étapes
1. Sur [vercel.com](https://vercel.com) → **Add New… → Project** → importer le dépôt Git
   (ou, en local : `npm i -g vercel` puis `vercel` / `vercel --prod`).
2. Réglages détectés automatiquement : **Framework = Vite**, **Build = `npm run build`**,
   **Output = `dist`**.
3. **⚠ Variables d'environnement** (Project Settings → Environment Variables), à définir
   **pour tous les environnements**, AVANT le build (Vite les incorpore à la compilation) :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé `anon`, publique — jamais `service_role`)
4. Déployer. L'URL `https://<projet>.vercel.app` est en HTTPS → PWA installable, service
   worker actif (partage d'image WhatsApp, offline, détection de mise à jour).

> Après tout changement de variable d'environnement, **redéployer** (les valeurs sont
> figées au build). Le domaine Supabase doit autoriser l'URL Vercel dans
> **Authentication → URL Configuration** (Site URL / Redirect URLs).

---

## Sécurité (rappels)

- **Aucun secret dans le repo / les logs.** Seul `.env.example` (sans valeurs) est commité.
- La clé `anon` est publique **par conception** — la sécurité vient des politiques **RLS**.
- Ne jamais exposer la clé `service_role` côté client.
- Public = uniquement les événements `status = 'approved'`.

---

## État d'avancement

- ✅ **Phase 0** — scaffold PWA, intégration Supabase + Leaflet, migrations SQL + RLS,
  `.env.example`, README, CLAUDE.md.
- ✅ **Phase 1** — UI complète *(codée, `npm run build` vert ; à valider en réel)* :
  auth e-mail/mot de passe, agenda (groupé par mois + filtre catégorie), carte Leaflet
  avec filtre par rayon (10/20/50 km), formulaire de publication (mini-carte + upload
  photo), favoris « Gems », mes événements (édition/suppression), modération admin.
- 🔲 **Reste** — appliquer les migrations (dont `0003`), tester en réel, puis **déployer
  sur Vercel** (variables d'env à renseigner). Pistes : multi-photos, événements
  récurrents, notifications, recherche plein texte.

Voir [`CLAUDE.md`](CLAUDE.md) pour le détail du modèle de données et la boucle de travail.
