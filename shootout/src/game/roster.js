import { OUTFITS } from './character.js';

// How a rival fights. The personality text goes to Jev; the numbers tune aim.
export const STYLES = {
  brawler: {
    label: 'Brawler',
    personality: 'a reckless brawler who loves close-range fights, pushes hard and rarely backs down',
    accuracy: 1.1, fireInterval: 0.24, reaction: 0.4,
  },
  sharpshooter: {
    label: 'Sharpshooter',
    personality: 'a patient sharpshooter who fights from cover at medium range and retreats when hurt',
    accuracy: 0.8, fireInterval: 0.34, reaction: 0.55, prefersCover: true,
  },
  grenadier: {
    label: 'Grenadier',
    personality: 'a demolitionist who spams grenades to flush enemies from cover, then picks them off at medium range',
    accuracy: 0.95, fireInterval: 0.28, reaction: 0.45, grenadier: true,
  },
  flanker: {
    label: 'Flanker',
    personality: 'a slippery flanker who circles around enemies to hit them from the side and never stands still for long',
    accuracy: 1.0, fireInterval: 0.26, reaction: 0.45,
  },
  ruthless: {
    label: 'Ruthless',
    personality: 'utterly ruthless. Always attack, never take cover, never retreat, never stop shooting. Close the distance and kill.',
    accuracy: 0.95, fireInterval: 0.2, reaction: 0.28, ruthless: true,
  },
};

// Everyone who can be played or fought. Ben, Nagar, Dror, Idan and Noam wear
// faces baked by scripts/bake-faces.py into public/assets/faces/<id>.png.
export const ROSTER = [
  {
    id: 'adventurer', name: 'Mara', color: '#f3dcb0', style: 'flanker',
    look: { body: 'f', outfit: OUTFITS.adventurer },
  },
  {
    id: 'redpolo', name: 'Ben', color: '#ff6a55', style: 'brawler',
    look: { body: 'm', face: 'redpolo', hair: 0x1c130c, outfit: { top: [0.5, 0.05, 0.05], trousers: [0.1, 0.1, 0.12], boots: [0.16, 0.11, 0.08] } },
  },
  {
    id: 'greytee', name: 'Nagar', color: '#8fc8ff', style: 'ruthless',
    look: { body: 'm', face: 'greytee', hair: 0x0f0b08, outfit: { top: [0.3, 0.3, 0.31], trousers: [0.12, 0.14, 0.22], boots: [0.25, 0.18, 0.12] } },
  },
  {
    id: 'checkers', name: 'Dror', color: '#ff9ad0', style: 'flanker',
    look: { body: 'm', face: 'checkers', hair: 0x140e0a, outfit: { top: [0.42, 0.08, 0.08], check: [0.62, 0.6, 0.58], trousers: [0.09, 0.1, 0.13], boots: [0.18, 0.12, 0.08] } },
  },
  {
    id: 'denim', name: 'Idan', color: '#c8d46a', style: 'grenadier',
    look: { body: 'm', face: 'denim', hair: 0x120d09, outfit: { top: [0.14, 0.22, 0.36], trousers: [0.08, 0.08, 0.09], boots: [0.2, 0.15, 0.1] } },
  },
  {
    id: 'linen', name: 'Noam', color: '#f0b060', style: 'sharpshooter',
    look: { body: 'm', face: 'linen', bald: true, outfit: { top: [0.56, 0.53, 0.46], trousers: [0.3, 0.27, 0.2], boots: [0.22, 0.15, 0.1] } },
  },
];

export const byId = (id) => ROSTER.find((r) => r.id === id);

const KEY = 'relic-roster';
const PLAYER_KEY = 'relic-player';
const DEFAULT = { player: 'adventurer', rivals: ['redpolo', 'greytee', 'denim'] };

export function loadSelection() {
  let player = DEFAULT.player;
  let rivals = [...DEFAULT.rivals];
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    const stored = (s?.rivals || []).filter((id) => byId(id) && id !== s.player);
    if (byId(s?.player) && stored.length) {
      player = s.player;
      rivals = stored;
    }
  } catch { /* fall back to the default line-up */ }
  try {
    const tab = sessionStorage.getItem(PLAYER_KEY);
    if (byId(tab)) player = tab;
    else sessionStorage.setItem(PLAYER_KEY, player);
  } catch { /* private mode */ }
  rivals = rivals.filter((id) => id !== player);
  if (!rivals.length) rivals = DEFAULT.rivals.filter((id) => id !== player);
  return { player, rivals };
}

export function saveSelection(sel) {
  localStorage.setItem(KEY, JSON.stringify(sel));
  try { sessionStorage.setItem(PLAYER_KEY, sel.player); } catch { /* private mode */ }
}

// A rival persona in the shape Rival expects.
export function persona(entry) {
  return { id: entry.id, name: entry.name, color: entry.color, style: entry.style, ...STYLES[entry.style] };
}

// Skin tones sampled from photos at bake time (faces.json only at runtime).
export async function resolveLooks(entries) {
  const base = `${import.meta.env.BASE_URL}assets/faces`;
  const need = entries.some((e) => e.look.face);
  if (!need) return entries.map((e) => e.look);
  const meta = await fetch(`${base}/faces.json`).then((r) => r.json());
  return entries.map((e) => (e.look.face
    ? { ...e.look, face: { skin: meta[e.look.face].skin } }
    : e.look));
}
