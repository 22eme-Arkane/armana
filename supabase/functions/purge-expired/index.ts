// Armana — Edge Function : purge des événements terminés.
//
// OBJECTIF (plan gratuit) : libérer la base ET le Storage. Déclenchée par un cron
// quotidien (voir README de ce dossier).
//
// ⚠ PIÈGE CRITIQUE : un simple DELETE SQL ne libère PAS le Storage. On supprime donc
// d'abord les FICHIERS du bucket (original + vignette), PUIS les lignes en base.
// La suppression des lignes events fait tomber event_photos et gems EN CASCADE.
//
// SÉCURITÉ : utilise la clé service_role, injectée par Supabase UNIQUEMENT côté
// serveur (jamais exposée au client — invariant projet).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'event-photos'
// Fuseau de référence : la bascule d'un mois se fait à minuit heure française.
const TZ = 'Europe/Paris'
// Sécurité : on ne traite qu'un nombre borné d'événements par exécution
// (les identifiants transitent dans l'URL PostgREST, qui a une longueur limitée).
const BATCH = 100

/**
 * RÈGLE DE RÉTENTION : on conserve le MOIS EN COURS et les MOIS À VENIR ;
 * on supprime tout ce qui appartient aux mois révolus.
 * En juillet : juillet, août, septembre… sont gardés ; juin, mai… sont purgés.
 * Renvoie le premier instant du mois courant, en heure de Paris.
 */
function startOfCurrentMonth(): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  // Décalage réel de Paris ce jour-là (+01:00 ou +02:00 selon l'heure d'été).
  const offsetMin = parisOffsetMinutes(now)
  return new Date(Date.UTC(year, month - 1, 1, 0, -offsetMin, 0))
}

function parisOffsetMinutes(at: Date): number {
  const asParis = new Date(at.toLocaleString('en-US', { timeZone: TZ }))
  const asUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((asParis.getTime() - asUtc.getTime()) / 60000)
}

Deno.serve(async (req) => {
  // Autorisation simple : réservé au cron/appel authentifié service_role.
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(SERVICE_ROLE)) {
    return json({ error: 'Non autorisé' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const cutoff = startOfCurrentMonth().toISOString()

  // 1) Cibler les événements des MOIS RÉVOLUS.
  //    Fin effective = ends_at si présent, sinon starts_at (événement d'un jour).
  const { data: expired, error: selErr } = await admin
    .from('events')
    .select('id')
    .or(`ends_at.lt.${cutoff},and(ends_at.is.null,starts_at.lt.${cutoff})`)
    .limit(BATCH)
  if (selErr) return json({ error: 'select: ' + selErr.message }, 500)

  const ids = (expired ?? []).map((e: { id: string }) => e.id)
  if (!ids.length) return json({ purged: 0, files_removed: 0, cutoff })

  // 2) Récupérer les chemins de fichiers à supprimer (une photo → photo.webp + thumb.webp).
  const { data: photos, error: phErr } = await admin
    .from('event_photos')
    .select('storage_path')
    .in('event_id', ids)
  if (phErr) return json({ error: 'photos: ' + phErr.message }, 500)

  const files: string[] = []
  for (const p of photos ?? []) {
    const path = (p as { storage_path: string }).storage_path
    files.push(path)
    // La vignette est déduite du chemin : photo.webp → thumb.webp, et depuis
    // les photos multiples photo-N.webp → thumb-N.webp. ⚠ Ne reconnaître que
    // la première forme laissait toutes les vignettes récentes ORPHELINES dans
    // le Storage (même règle que thumbPath, src/lib/events.js).
    const vignette = path.replace(/photo(-\d+)?\.webp$/, (_m, n) => 'thumb' + (n || '') + '.webp')
    if (vignette !== path) files.push(vignette)
  }

  // 3) Supprimer les FICHIERS Storage EN PREMIER, par paquets.
  let filesRemoved = 0
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH)
    const { data: removed, error: rmErr } = await admin.storage.from(BUCKET).remove(slice)
    if (rmErr) return json({ error: 'storage.remove: ' + rmErr.message }, 500)
    filesRemoved += removed?.length ?? 0
  }

  // 4) PUIS supprimer les lignes (event_photos + gems partent en cascade).
  const { error: delErr } = await admin.from('events').delete().in('id', ids)
  if (delErr) return json({ error: 'delete: ' + delErr.message }, 500)

  return json({ purged: ids.length, files_removed: filesRemoved, cutoff })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
