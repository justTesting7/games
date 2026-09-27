const KEY = 'relic-mode';
const ROOM_KEY = 'relic-room';

export function resolveMode() {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'solo') return 'solo';
  if (q.get('mode') === 'multi' || q.get('room')) return 'multi';
  return localStorage.getItem(KEY) === 'multi' ? 'multi' : 'solo';
}

export function resolveRoom() {
  const q = new URLSearchParams(location.search);
  const fromUrl = (q.get('room') || '').trim().slice(0, 16);
  if (fromUrl) return fromUrl;
  const saved = (localStorage.getItem(ROOM_KEY) || '').trim().slice(0, 16);
  return saved || 'lobby';
}

export function persistMode(mode) {
  localStorage.setItem(KEY, mode === 'multi' ? 'multi' : 'solo');
}

export function persistRoom(room) {
  const clean = (room || 'lobby').trim().slice(0, 16) || 'lobby';
  localStorage.setItem(ROOM_KEY, clean);
  return clean;
}

export function modeUrl(mode, room) {
  const url = new URL(location.href);
  if (mode === 'multi') {
    url.searchParams.set('mode', 'multi');
    const code = (room || 'lobby').trim().slice(0, 16) || 'lobby';
    if (code !== 'lobby') url.searchParams.set('room', code);
    else url.searchParams.delete('room');
  } else {
    url.searchParams.delete('mode');
    url.searchParams.delete('room');
  }
  return url;
}
