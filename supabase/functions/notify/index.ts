// Armana — envoi des notifications push (Supabase Edge Function).
//
// La base ne sait pas parler à un service de push : il faut signer un jeton
// VAPID. Elle dépose donc les notifications dans `notification_queue`
// (migration 0015) et cette fonction les consomme.
//
// Conséquence utile : tant que cette fonction n'est pas déployée, RIEN n'est
// cassé — la file se remplit simplement sans être vidée, et l'application
// fonctionne normalement.
//
// -----------------------------------------------------------------------------
// DÉPLOIEMENT (à faire une seule fois, depuis le dossier du projet)
// -----------------------------------------------------------------------------
//   1. Générer les clés VAPID :
//        npx web-push generate-vapid-keys
//      Elles ne vont NI dans le dépôt NI dans un message. La clé publique est
//      publique par nature (elle voyage dans le navigateur) ; la privée reste
//      un secret serveur.
//
//   2. Enregistrer les secrets côté Supabase :
//        npx supabase login
//        npx supabase link --project-ref <reference-du-projet>
//        npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//                                 VAPID_SUBJECT=mailto:22eme.arkane@gmail.com
//
//   3. Déployer :
//        npx supabase functions deploy notify
//
//   4. Sur Vercel, ajouter la variable d'environnement (clé PUBLIQUE seulement) :
//        VITE_VAPID_PUBLIC_KEY = ...
//      puis redéployer le site, sinon l'écran Notifications restera en
//      « Envoi pas encore en service ».
//
//   5. Après la migration 0016, qui génère un secret partagé et affiche sa
//      valeur, déposer ce secret puis redéployer SANS vérification de jeton :
//        npx supabase secrets set ARMANA_PUSH_KEY=la-valeur-affichee-par-0016
//        npx supabase functions deploy notify --no-verify-jwt
//
//      ⚠ Le drapeau --no-verify-jwt est indispensable : l'appel automatique
//      vient de la base via pg_net, qui n'envoie aucun jeton. Sans lui, la
//      passerelle refuse l'appel avant qu'il n'arrive ici, et rien ne part.
//      La protection ne disparaît pas pour autant — elle se déplace sur le
//      secret ci-dessus, qui vaut mieux qu'un jeton public.
// -----------------------------------------------------------------------------
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@armana.app'

// Secret partagé avec la base (migration 0016). Sans lui, la fonction était
// déclenchable par quiconque disposait de la clé publique de l'application —
// laquelle est dans le bundle, donc lisible par tous. Le risque n'était pas la
// fuite de données mais l'épuisement du quota gratuit d'invocations.
const PUSH_KEY = Deno.env.get('ARMANA_PUSH_KEY') ?? ''

// Qui reçoit quoi (le filtrage par préférence s'ajoute par-dessus) :
//   messages             → le PROPRIÉTAIRE uniquement (courriers, signalements,
//                          candidatures de modérateurs) ;
//   moderation           → le propriétaire, et les modérateurs dont la zone
//                          couvre le département de l'événement — un modérateur
//                          du 04 ne reçoit pas les événements du 84 ;
//   nouveaux_evenements  → tout abonné qui l'a demandé ;
//   food_truck           → (migration 0036) PERSONNELLE : le seul `user_id`
//                          de la ligne, sauf s'il a refusé (`food_truck_off`).
//                          Rappel de planning, signalements, annonces.

// Au-delà, l'abonnement est considéré mort et supprimé.
const ECHECS_MAX = 5

// Nombre de notifications traitées par appel : borne la durée d'exécution.
const LOT = 20

Deno.serve(async (req) => {
  // ⚠ Cette fonction est déployée avec --no-verify-jwt : la passerelle Supabase
  // ne filtre plus rien, car l'appel venu de la base (pg_net) n'envoie aucun
  // jeton et se faisait refuser avant même d'arriver ici.
  // Le secret partagé est donc la SEULE barrière — et c'en est une meilleure :
  // le jeton qu'exigeait la passerelle était la clé publique de l'application,
  // lisible par tout le monde dans le bundle.
  // D'où la sévérité : pas de secret configuré = on refuse tout.
  if (!PUSH_KEY || req.headers.get('x-armana-key') !== PUSH_KEY) {
    return json({ erreur: 'Non autorisé' }, 401)
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ erreur: 'Clés VAPID absentes. Voir l’en-tête du fichier.' }, 500)
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  // Clé de service : contourne la RLS, indispensable pour lire la file et les
  // abonnements de tout le monde. Elle ne quitte jamais le serveur.
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: file, error: erFile } = await db
    .from('notification_queue')
    .select('id, kind, title, body, url, dept, user_id')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(LOT)
  if (erFile) return json({ erreur: erFile.message }, 500)
  if (!file?.length) return json({ traitees: 0, envois: 0 })

  // Un seul chargement des abonnés pour tout le lot.
  const { data: abonnes, error: erAb } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, failures, user_id, profiles!inner(role, notif_prefs, is_owner, mod_depts)')
  if (erAb) return json({ erreur: erAb.message }, 500)

  let envois = 0
  const morts: string[] = []

  for (const notif of file) {
    const cibles = (abonnes ?? []).filter((a: any) => {
      const p = a.profiles
      if (!p) return false
      // ⚠ PERSONNELLE : uniquement son destinataire, JAMAIS les autres. Un
      // camion ne doit pas recevoir le rappel ou les signalements d'un autre.
      if (notif.user_id) {
        if (a.user_id !== notif.user_id) return false
        // Prévenu par défaut ; « food_truck_off » est un refus explicite.
        return notif.kind !== 'food_truck' || p.notif_prefs?.food_truck_off !== true
      }
      if (p.notif_prefs?.[notif.kind] !== true) return false
      if (notif.kind === 'messages') return p.is_owner === true
      if (notif.kind === 'moderation') {
        if (p.is_owner) return true
        if (p.role !== 'admin') return false
        // Zone du modérateur : null = tous ; un événement sans département
        // (hors territoire, sans coordonnées) est signalé à tout le monde,
        // sinon personne ne le verrait jamais.
        return p.mod_depts == null || notif.dept == null || p.mod_depts.includes(notif.dept)
      }
      return true // nouveaux_evenements
    })

    const charge = JSON.stringify({
      title: notif.title,
      body: notif.body,
      url: notif.url ?? '/',
      kind: notif.kind,
    })

    await Promise.all(
      cibles.map(async (a: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
            charge
          )
          envois++
        } catch (e: any) {
          const code = e?.statusCode ?? 0
          // 404 / 410 : le navigateur a révoqué l'abonnement (désinstallation,
          // cache vidé). Il ne servira plus jamais, on le supprime.
          if (code === 404 || code === 410 || a.failures + 1 >= ECHECS_MAX) {
            morts.push(a.endpoint)
          } else {
            await db
              .from('push_subscriptions')
              .update({ failures: a.failures + 1 })
              .eq('endpoint', a.endpoint)
          }
        }
      })
    )
  }

  if (morts.length) {
    await db.from('push_subscriptions').delete().in('endpoint', morts)
  }

  // Marquée envoyée même sans destinataire : sinon la file grossirait sans fin.
  await db
    .from('notification_queue')
    .update({ sent_at: new Date().toISOString() })
    .in('id', file.map((n: any) => n.id))

  return json({ traitees: file.length, envois, abonnements_supprimes: morts.length })
})

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
