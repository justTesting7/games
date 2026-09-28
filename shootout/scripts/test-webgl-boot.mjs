// Mock a phone-like canvas: first getContext(attrs) fails and poisons that
// element; the next canvas then succeeds. Mirrors iOS Safari.
const ok = { isContextLost: () => false };
const attempts = [];
let created = 0;

function makeCanvas(poisoned) {
  created += 1;
  const el = {
    id: 'game',
    className: '',
    width: 0,
    height: 0,
    poisoned,
    hasAttribute: () => false,
    getAttribute: () => null,
    replaceWith(next) {
      el.replacedBy = next;
    },
    getContext(type, attrs) {
      attempts.push({ id: el.id, poisoned: el.poisoned, type, attrs: attrs === undefined ? '(none)' : { ...attrs } });
      if (type !== 'webgl2') return null;
      if (el.poisoned) return null;
      return ok;
    },
  };
  return el;
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(tag);
    return makeCanvas(false);
  },
};

const { acquireContext } = await import('../src/engine/webgl.js');
const first = makeCanvas(true);
first.id = 'game';
const hit = acquireContext(first);

if (!hit.gl) {
  console.error('expected a WebGL2 context after swapping the poisoned canvas');
  console.error(attempts);
  process.exit(1);
}
if (hit.canvas === first) {
  console.error('expected a replacement canvas, first element was poisoned');
  process.exit(1);
}
if (attempts[0].poisoned !== true || attempts.some((a) => !a.poisoned && a.type === 'webgl2') === false) {
  console.error('expected a failed attempt on the poisoned canvas, then success');
  console.error(attempts);
  process.exit(1);
}
console.log(`ok: recovered after ${created - 1} new canvas(es), ${attempts.length} getContext calls`);
