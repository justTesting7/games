// Rifle rounds drop: at 300 m a level shot lands ~0.65 m low (820 m/s), at 20 m it's
// a straight line for all purposes.
const SPEED = 820, G = 9.8;
const dropAt = (d) => 0.5 * G * (d / SPEED) ** 2;
if (Math.abs(dropAt(300) - 0.656) > 0.01) throw new Error('drop at 300 m');
if (dropAt(20) > 0.003) throw new Error('no visible drop at close range');
import { readFileSync } from 'node:fs';
const w = readFileSync(new URL('../src/game/weapons.js', import.meta.url), 'utf8');
if (!w.includes('let hit = rifle ? this.ballistic(from, dir, shooter)')) throw new Error('rifle shots trace the arc');
if (!w.includes('const SPEED = 820, STEP = 0.01;')) throw new Error('820 m/s, 10 ms segments');
console.log('ok ballistic');
