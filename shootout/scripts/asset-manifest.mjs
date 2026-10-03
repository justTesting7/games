// The asset manifest: every file under public/assets with a fingerprint of its contents
// ({ files: { "maps/habima/set.glb": "3f9a1c0e2b7d", ... } }). The game keeps the files in
// the browser's Cache Storage and takes them from there while their fingerprint matches
// (src/engine/assetCache.js). Served live by the dev server and written into the build
// (vite.config.js); a file whose size and time haven't changed isn't read again.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const known = new Map(); // path -> { size, mtime, hash }

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function hashFile(p) {
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex').slice(0, 12);
}

/** assetsDir: the folder that is served at <base>assets/. */
export function buildManifest(assetsDir) {
  const files = {};
  if (!fs.existsSync(assetsDir)) return { files };
  for (const p of walk(assetsDir, assetsDir, [])) {
    const st = fs.statSync(p);
    let k = known.get(p);
    if (!k || k.size !== st.size || k.mtime !== st.mtimeMs) {
      k = { size: st.size, mtime: st.mtimeMs, hash: hashFile(p) };
      known.set(p, k);
    }
    files[path.relative(assetsDir, p).split(path.sep).join('/')] = k.hash;
  }
  return { files };
}
