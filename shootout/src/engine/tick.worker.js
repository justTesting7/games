// Hidden tabs pause requestAnimationFrame. This worker keeps posting a
// 60 Hz clock so the game can simulate (and stay in the room) while you
// look at another tab.
setInterval(() => postMessage(0), 16);
