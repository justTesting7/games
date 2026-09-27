// Rematch is server-owned: ready/R must not start a new fight while
// the round is over. After rematchAt, start even if nobody pressed ready.
const canStart = ({ state, rematch, ready, size, min }) => {
  if (size < min) return rematch || state === 'over' ? 'waiting' : false;
  if (state === 'fight' || state === 'countdown') return false;
  if (state === 'over' && !rematch) return false;
  if (!rematch && !ready) return false;
  return 'countdown';
};

if (canStart({ state: 'over', rematch: false, ready: true, size: 2, min: 2 }) !== false) {
  throw new Error('R/ready must not restart an over round');
}
if (canStart({ state: 'over', rematch: true, ready: false, size: 2, min: 2 }) !== 'countdown') {
  throw new Error('timer rematch should start without ready');
}
if (canStart({ state: 'waiting', rematch: false, ready: false, size: 2, min: 2 }) !== false) {
  throw new Error('first fight still needs Join');
}
if (canStart({ state: 'waiting', rematch: false, ready: true, size: 2, min: 2 }) !== 'countdown') {
  throw new Error('Join should start the first fight');
}
if (canStart({ state: 'over', rematch: true, ready: false, size: 1, min: 2 }) !== 'waiting') {
  throw new Error('not enough players after a wipe should wait');
}

console.log('rematch policy ok');
