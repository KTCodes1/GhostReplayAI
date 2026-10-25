// 2D tactical stand-in for the 3D pitch canvas. Returns an <svg> React element.
export function pitchSvg(React, d, t) {
  const h = React.createElement;
  const L = { fill: 'none', stroke: t.line, strokeWidth: 0.3 };
  const kids = [];
  kids.push(h('defs', { key: 'defs' },
    ['ghost', 'actual', 'alt'].map((k) => h('marker', { key: k, id: `ah-${t.id}-${k}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' },
      h('path', { d: 'M0,0 L10,5 L0,10 z', fill: t[k] })))));
  kids.push(h('rect', { key: 'bg', x: -4, y: -4, width: 113, height: 76, fill: t.grass }));
  for (let i = 0; i < 14; i++) if (i % 2) kids.push(h('rect', { key: 's' + i, x: i * 7.5, y: 0, width: 7.5, height: 68, fill: t.grass2 }));
  kids.push(h('rect', { key: 'out', x: 0, y: 0, width: 105, height: 68, ...L }));
  kids.push(h('line', { key: 'half', x1: 52.5, y1: 0, x2: 52.5, y2: 68, ...L }));
  kids.push(h('circle', { key: 'cc', cx: 52.5, cy: 34, r: 9.15, ...L }));
  kids.push(h('circle', { key: 'cs', cx: 52.5, cy: 34, r: 0.35, fill: t.line }));
  [0, 105].forEach((gx) => {
    const s = gx ? -1 : 1;
    kids.push(h('rect', { key: 'pb' + gx, x: gx ? 105 - 16.5 : 0, y: 34 - 20.16, width: 16.5, height: 40.32, ...L }));
    kids.push(h('rect', { key: 'gb' + gx, x: gx ? 105 - 5.5 : 0, y: 34 - 9.16, width: 5.5, height: 18.32, ...L }));
    kids.push(h('rect', { key: 'gl' + gx, x: gx ? 105 : -1.6, y: 34 - 3.66, width: 1.6, height: 7.32, ...L }));
    kids.push(h('circle', { key: 'ps' + gx, cx: gx + s * 11, cy: 34, r: 0.3, fill: t.line }));
    const ax = gx + s * 16.5, dy = Math.sqrt(9.15 * 9.15 - 5.5 * 5.5);
    kids.push(h('path', { key: 'arc' + gx, d: `M${ax},${34 - dy} A9.15,9.15 0 0 ${gx ? 0 : 1} ${ax},${34 + dy}`, ...L }));
  });
  // zone highlight: space behind the line
  kids.push(h('rect', { key: 'zone', x: 85, y: 30, width: 12, height: 13, rx: 1, fill: t.ghost, opacity: 0.12, stroke: t.ghost, strokeWidth: 0.2, strokeDasharray: '0.8 0.6' }));
  const A = d.arrows;
  kids.push(h('line', { key: 'run', ...A.run, stroke: t.text, strokeWidth: 0.25, strokeDasharray: '0.5 0.6', opacity: 0.7 }));
  kids.push(h('line', { key: 'alt', ...A.alt, stroke: t.alt, strokeWidth: 0.35, strokeDasharray: '1 0.8', markerEnd: `url(#ah-${t.id}-alt)` }));
  kids.push(h('line', { key: 'act', ...A.actual, stroke: t.actual, strokeWidth: 0.5, markerEnd: `url(#ah-${t.id}-actual)` }));
  kids.push(h('line', { key: 'gh', ...A.ghost, stroke: t.ghost, strokeWidth: 0.6, markerEnd: `url(#ah-${t.id}-ghost)` }));
  // ghost target
  kids.push(h('circle', { key: 'gt', cx: 91.5, cy: 38.5, r: 1.7, fill: 'none', stroke: t.ghost, strokeWidth: 0.3, strokeDasharray: '0.6 0.4' }));
  d.players.forEach((p, i) => {
    const fill = p.team === 'h' ? t.home : t.away;
    if (p.hl) kids.push(h('circle', { key: 'hl' + i, cx: p.x, cy: p.y, r: 2.6, fill: 'none', stroke: t.ghost, strokeWidth: 0.35 }));
    kids.push(h('circle', { key: 'p' + i, cx: p.x, cy: p.y, r: 1.7, fill, stroke: t.ring, strokeWidth: 0.25 }));
    kids.push(h('text', { key: 't' + i, x: p.x, y: p.y + 0.45, textAnchor: 'middle', fontSize: p.role.length > 2 ? 0.95 : 1.15, fontWeight: 700, fill: '#fff', fontFamily: t.font }, p.role));
    if (p.name) {
      const w = p.name.length * 0.95 + 1.6;
      kids.push(h('rect', { key: 'nb' + i, x: p.x - w / 2, y: p.y - 4.9, width: w, height: 2.3, rx: 0.4, fill: t.labelBg, stroke: p.hl ? t.ghost : t.labelLine, strokeWidth: 0.15 }));
      kids.push(h('text', { key: 'n' + i, x: p.x, y: p.y - 3.3, textAnchor: 'middle', fontSize: 1.3, fontWeight: 600, fill: t.labelFg, fontFamily: t.font }, p.name));
    }
  });
  kids.push(h('circle', { key: 'ball', cx: 61.4, cy: 32.8, r: 0.6, fill: '#fff', stroke: '#000', strokeWidth: 0.15 }));
  return h('svg', { viewBox: '-3 -3 111 74', preserveAspectRatio: 'xMidYMid meet', style: { width: '100%', height: '100%', display: 'block' } }, kids);
}
