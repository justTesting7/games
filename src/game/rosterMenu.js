import { ROSTER, STYLES, portraitUrl, saveSelection } from './roster.js';

// "Play as" and "Opponents" pickers. Changes apply on the next load, so the
// caller swaps the Fight button for a reload when `changed()` is true.
export function setupRosterMenu(initial, root, onChange) {
  const sel = { player: initial.player, rivals: [...initial.rivals] };
  const key = (s) => `${s.player}|${[...s.rivals].sort().join(',')}`;
  const start = key(initial);

  const chip = (entry, group) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.id = entry.id;
    b.style.setProperty('--c', entry.color);
    const url = portraitUrl(entry);
    b.innerHTML = `${url ? `<img src="${url}" alt="">` : `<span class="mono">${entry.name[0]}</span>`}`
      + `<b>${entry.name}</b><small>${group === 'rivals' ? STYLES[entry.style].label : ''}</small>`;
    b.onclick = () => {
      if (group === 'player') {
        if (sel.player === entry.id) return;
        const prev = sel.player;
        sel.player = entry.id;
        sel.rivals = sel.rivals.filter((id) => id !== entry.id);
        if (!sel.rivals.length) sel.rivals.push(prev);
      } else {
        if (entry.id === sel.player) return;
        const i = sel.rivals.indexOf(entry.id);
        if (i >= 0) { if (sel.rivals.length > 1) sel.rivals.splice(i, 1); } else sel.rivals.push(entry.id);
      }
      render();
      onChange();
    };
    return b;
  };

  root.innerHTML = '<div class="row"><span>Play as</span><div class="chips" data-g="player"></div></div>'
    + '<div class="row"><span>Opponents</span><div class="chips" data-g="rivals"></div></div>';
  const rows = { player: root.querySelector('[data-g=player]'), rivals: root.querySelector('[data-g=rivals]') };
  for (const g of ['player', 'rivals']) ROSTER.forEach((e) => rows[g].append(chip(e, g)));

  function render() {
    for (const b of rows.player.children) b.classList.toggle('on', b.dataset.id === sel.player);
    for (const b of rows.rivals.children) {
      b.classList.toggle('on', sel.rivals.includes(b.dataset.id));
      b.classList.toggle('off', b.dataset.id === sel.player);
    }
  }
  render();

  return {
    changed: () => key(sel) !== start,
    save: () => saveSelection(sel),
  };
}
