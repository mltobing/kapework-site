/**
 * lib/logboek-feed.js
 *
 * Pure, dependency-injected orchestration for a Logboek feed page — no
 * Supabase client, no DOM, so the behaviour that actually matters here (which
 * failures blank the feed and which don't) can be unit tested directly (see
 * logboek-feed.test.mjs) instead of only being reachable through a live
 * database.
 *
 * The core query (scalar ma_posts columns only, no embedded relationships)
 * is authoritative: it is the thing a Logboek entry actually needs to exist,
 * so its failure propagates. Author profile, attachment, and provenance
 * hydration are each a separate, best-effort lookup — a failure in any one
 * of them (a table a migration hasn't created yet, a transient network
 * error, whatever) is caught, logged, and simply leaves that field
 * unhydrated for the page, rather than throwing away every entry the family
 * can already see. This is what an embedded PostgREST relationship
 * (`ma_posts.select('..., ma_post_sources(...)')`) cannot do — there, one
 * broken relationship fails the *entire* query.
 */

/**
 * @param {object} deps
 * @param {(sort: 'created_at'|'event_date') => Promise<object[]>} deps.fetchCorePage
 *   Scalar-only ma_posts page for one sort mode. Its rejection is fatal
 *   unless `sort` was 'event_date', in which case one fallback attempt with
 *   'created_at' is made before giving up.
 * @param {(authorIds: string[]) => Promise<Map<string, object>>} deps.fetchProfiles
 * @param {(postIds: string[]) => Promise<Map<string, object[]>>} deps.fetchAttachments
 * @param {(postIds: string[]) => Promise<Map<string, object>>} deps.fetchProvenance
 * @param {'created_at'|'event_date'} deps.sort
 * @returns {Promise<{ entries: object[], usedSortFallback: boolean }>}
 */
export async function loadLogboekFeedPage({
  fetchCorePage, fetchProfiles, fetchAttachments, fetchProvenance, sort,
}) {
  const { core, usedSortFallback } = await fetchCoreWithSortFallback(fetchCorePage, sort);
  const entries = await hydrateLogboekEntries(core, { fetchProfiles, fetchAttachments, fetchProvenance });
  return { entries, usedSortFallback };
}

/**
 * Hydrates already-fetched core rows (e.g. the single row returned by an
 * insert/update) with the same best-effort profile/attachment/provenance
 * lookups as a feed page — so a create or update can never fail just
 * because an optional enrichment table is unavailable.
 * @param {object[]} coreRows
 * @param {object} deps — same fetchProfiles/fetchAttachments/fetchProvenance as above
 * @returns {Promise<object[]>}
 */
export async function hydrateLogboekEntries(coreRows, { fetchProfiles, fetchAttachments, fetchProvenance }) {
  const authorIds = dedupeIds(coreRows.map((e) => e.author_id));
  const postIds   = dedupeIds(coreRows.map((e) => e.id));

  const [profilesById, attachmentsByPostId, sourcesByPostId] = await Promise.all([
    safeHydrate(() => fetchProfiles(authorIds), new Map(), 'author profile'),
    safeHydrate(() => fetchAttachments(postIds), new Map(), 'attachment'),
    safeHydrate(() => fetchProvenance(postIds), new Map(), 'provenance'),
  ]);

  return coreRows.map((entry) => ({
    ...entry,
    ma_profiles: profilesById.get(entry.author_id) ?? null,
    ma_attachments: attachmentsByPostId.get(entry.id) ?? [],
    ma_post_sources: sourcesByPostId.get(entry.id) ?? null,
  }));
}

async function fetchCoreWithSortFallback(fetchCorePage, sort) {
  try {
    return { core: await fetchCorePage(sort), usedSortFallback: false };
  } catch (err) {
    if (sort !== 'event_date') throw err; // already on the fallback sort — no further retry, this is fatal
    console.error(
      '[ma/logboek-feed] event_date sort failed, retrying once with created_at (non-fatal):', err,
    );
    const core = await fetchCorePage('created_at'); // a second failure here propagates — never an infinite retry
    return { core, usedSortFallback: true };
  }
}

async function safeHydrate(fn, fallback, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[ma/logboek-feed] ${label} hydration unavailable (non-fatal, feed still renders):`, err);
    return fallback;
  }
}

function dedupeIds(ids) {
  return Array.from(new Set(ids.filter(Boolean)));
}
