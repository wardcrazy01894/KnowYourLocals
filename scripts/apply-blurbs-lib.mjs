// Pure normalization of blurb-research results before they touch a sidecar.
// See apply-blurbs.mjs (CLI) and docs/DATA-SOURCING.md §4f.

/** Hard cap on blurb length: ~3 sentences; the recap card is a phone-width box. */
export const MAX_CHARS = 600
/** Hard cap on the one-line "what kind of place" descriptor. */
export const MAX_DESCRIPTOR_CHARS = 100
/** Research confidence tiers that are allowed into the shipped sidecar. */
export const ACCEPTED_CONFIDENCE = new Set(['high', 'medium'])

const collapse = (s) => s.replace(/\s+/g, ' ').trim()

/**
 * Hosts that are never "read more" material: geocoders, search engines, and
 * raw map-DATA pages. A research agent sometimes cites the lookup it used to
 * confirm an address — including an openstreetmap.org node/way page, which is
 * a database record of tags, not something a player would read. That belongs
 * in the `note` as provenance, never as a player-facing link. (This also
 * catches nominatim.openstreetmap.org and malformed doubled-domain OSM URLs.)
 */
const JUNK_SOURCE =
  /^https:\/\/([^/]*\.)?(openstreetmap\.org|google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com)\//i

/**
 * Has this sidecar entry been written? A descriptor-only entry (researched,
 * no story) counts — it is NOT a placeholder, must not be re-researched, and
 * must not be overwritten without --force. Shared by the generator's
 * candidate filter and the apply gate so the two can't disagree.
 */
export function isWritten(entry) {
  return Boolean(((entry?.text ?? '') + (entry?.descriptor ?? '')).trim())
}

/**
 * Filter + clean research rows.
 * @param {Array<{id:string,text:string,descriptor?:string,sources?:string[],confidence?:string}>} rows
 * @param {{knownIds:Set<string>, existing?:Record<string,{text?:string}>, force?:boolean}} opts
 * @returns {{accepted: Array<{id:string,text:string,descriptor:string,sources:string[]}>, skipped: Record<string,string[]>}}
 */
export function normalizeBlurbResults(rows, opts) {
  const { knownIds, existing = {}, force = false } = opts
  const skipped = {
    'unknown id': [],
    'nothing usable (no text, no descriptor)': [],
    'too long': [],
    'already written (use --force)': [],
    'no https source': [],
  }
  const accepted = []
  const seen = new Set()
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue
    seen.add(r.id)
    // The STORY is gated on confidence (an invented fact is worse than none);
    // the factual DESCRIPTOR survives regardless — a researched spot must at
    // least say what kind of place it is (owner rule, 2026-09-04).
    const text = ACCEPTED_CONFIDENCE.has(r.confidence)
      ? collapse(String(r.text ?? ''))
      : ''
    const descriptor = collapse(String(r.descriptor ?? ''))
    if (!knownIds.has(r.id)) {
      skipped['unknown id'].push(r.id)
      continue
    }
    if (!text && !descriptor) {
      skipped['nothing usable (no text, no descriptor)'].push(r.id)
      continue
    }
    if (text.length > MAX_CHARS || descriptor.length > MAX_DESCRIPTOR_CHARS) {
      skipped['too long'].push(r.id)
      continue
    }
    if (!force && isWritten(existing[r.id])) {
      skipped['already written (use --force)'].push(r.id)
      continue
    }
    const sources = [...new Set((r.sources ?? []).map(String))]
      .filter((s) => /^https:\/\/\S+$/.test(s) && !JUNK_SOURCE.test(s))
      .slice(0, 2)
    // A story must be backed by a link; a bare descriptor (what kind of place)
    // is low-risk and may stand on its own.
    if (text && sources.length === 0) {
      skipped['no https source'].push(r.id)
      continue
    }
    accepted.push({ id: r.id, text, descriptor, sources })
  }
  for (const k of Object.keys(skipped)) skipped[k].sort()
  return { accepted, skipped }
}
