// The game's files (maps, models, textures: hundreds of megabytes) kept in the browser's
// Cache Storage, so a map loads from disk the second time. The server sends them with
// max-age=0, and browsers drop big files from their HTTP cache anyway, so without this
// each visit fetched (or at best revalidated) every one of them again.
//
// assets/manifest.json (small, always fetched) gives each file a fingerprint of its
// contents; a file is taken from the cache while its fingerprint matches, else fetched
// and stored, and old versions are deleted. Every fetch under <base>assets/ goes through
// here (fetch is wrapped: three's loaders use it); images too, via loadImage.
// ?nocache leaves it all to the network. The local dev server is left to itself (the
// files come straight off the disk there, faster than the cache gives them back, and
// they change under you): ?cache tries it there.

const BASE = import.meta.env?.BASE_URL || '/shootout/';
const PREFIX = `${BASE}assets/`;
const CACHE = 'shootout-assets';
const netFetch = globalThis.fetch?.bind(globalThis);
const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
const off = !q || typeof caches === 'undefined' || q.has('nocache') || (import.meta.env?.DEV && !q.has('cache'));

let files = null;
let cacheP = null;
const ready = off ? Promise.resolve() : netFetch(`${PREFIX}manifest.json`, { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { files = m?.files || null; if (files) setTimeout(prune, 8000); })
  .catch(() => {});

const open = () => cacheP || (cacheP = caches.open(CACHE));
const keyOf = (path, hash) => `${location.origin}${path}?v=${hash}`;

/** fetch, from the cache when the file is a known asset. */
export async function assetFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (off || !raw || (init && init.method && init.method !== 'GET')) return netFetch(input, init);
  const url = new URL(raw, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(PREFIX) || url.pathname.endsWith('/manifest.json')) return netFetch(input, init);
  await ready;
  const hash = files?.[decodeURIComponent(url.pathname.slice(PREFIX.length))];
  if (!hash) return netFetch(input, init);
  try {
    const cache = await open();
    const key = keyOf(url.pathname, hash);
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await netFetch(input, init);
    if (res.ok && res.status === 200) cache.put(key, res.clone()).catch(() => {}); // (a full disk: just not kept)
    return res;
  } catch {
    return netFetch(input, init);
  }
}

// versions the manifest no longer names go (a map rebuilt, a file removed)
async function prune() {
  try {
    const cache = await open();
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      if (files[decodeURIComponent(u.pathname.slice(PREFIX.length))] !== u.searchParams.get('v')) await cache.delete(req);
    }
  } catch { /* not important */ }
}

if (!off && netFetch) {
  globalThis.fetch = assetFetch;
  // ask for the storage to be kept (it can still be cleared by the user)
  navigator.storage?.persist?.().catch(() => {});
}
