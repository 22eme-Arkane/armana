// Armana — lecture et écriture des points PostGIS échangés avec PostgREST.

/**
 * Lit un point tel que PostgREST le renvoie : en EWKB hexadécimal
 * (« 0101000020E6100000… ») le plus souvent, en GeoJSON selon la version.
 * @returns {{lat:number, lng:number}|null}
 */
export function lirePoint(v) {
  if (!v) return null
  if (typeof v === 'object' && Array.isArray(v.coordinates)) {
    const [lng, lat] = v.coordinates
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  }
  if (typeof v !== 'string' || !/^[0-9a-f]+$/i.test(v)) return null
  const octets = new Uint8Array(v.match(/../g).map((h) => parseInt(h, 16)))
  const vue = new DataView(octets.buffer)
  const le = octets[0] === 1
  const type = vue.getUint32(1, le)
  if ((type & 0xff) !== 1) return null // pas un point
  const debut = type & 0x20000000 ? 9 : 5 // SRID présent : 4 octets de plus
  if (octets.length < debut + 16) return null
  const lng = vue.getFloat64(debut, le)
  const lat = vue.getFloat64(debut + 8, le)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** Un point à écrire dans une colonne geography. */
export function ecrirePoint(lat, lng) {
  return `SRID=4326;POINT(${lng} ${lat})`
}
