const $ = id => document.getElementById(id);
const U = ['Bit','B','KB','MB','GB','TB','PB','EB','ZB','YB'];
const MAX = 2n ** 64n - 1n, PART = 4n * 1024n ** 3n;
const MODES = {
  1: { t: 'Register space', d: 'Create one file of the exact size with fsutil.', b: 'Waste space', disk: 1 },
  2: { t: 'Write space', d: 'Write real data into one file, one 4 GB part at a time.', b: 'Write space', disk: 1 },
  3: { t: 'Waste memory', d: 'Commit and fill RAM. It stays used until you release it.', b: 'Waste memory', disk: 0 },
  4: { t: 'Waste Electron', d: 'Spawn hidden Chromium windows that each hoard random data.', b: 'Waste Electron', disk: 0 }
};
let mode = 1, items = [], busy = false, cur = 0n;

U.forEach(u => $('unit').add(new Option(u, u)));
$('unit').value = 'MB';

function toBytes(s, u) { // 1 KB = 1024 B; Bit = 1/8 B (rounded up)
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim()); if (!m) return null;
  const f = m[2] || '', i = U.indexOf(u), den = 10n ** BigInt(f.length) * (i === 0 ? 8n : 1n);
  return (BigInt(m[1] + f) * (i <= 1 ? 1n : 1024n ** BigInt(i - 1)) + den - 1n) / den;
}
function say(t, bad) { $('status').textContent = t; $('status').className = bad ? 'err' : ''; }
function render() {
  $('list').innerHTML = '';
  items.forEach((x, k) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${x.a} ${x.u} <small>(${x.b.toLocaleString()} bytes)</small></span>`;
    const r = document.createElement('button'); r.textContent = 'Remove'; r.disabled = busy;
    r.onclick = () => { items.splice(k, 1); render(); };
    li.append(r); $('list').append(li);
  });
  const t = items.reduce((a, x) => a + x.b, 0n);
  $('total').textContent = items.length ? `Total: ${t.toLocaleString()} bytes` : 'The waste list is empty.';
}
function setMode(m) {
  if (busy) return; mode = m;
  $('title').textContent = MODES[m].t; $('desc').textContent = MODES[m].d; $('go').textContent = MODES[m].b;
  $('diskf').hidden = !MODES[m].disk; $('rel').hidden = true; $('fill').style.width = '0'; say('Ready.');
  [...$('nav').children].forEach((b, i) => b.classList.toggle('on', i + 1 === m));
}
Object.keys(MODES).forEach(k => {
  const b = document.createElement('button'); b.textContent = MODES[k].t; b.onclick = () => setMode(+k); $('nav').append(b);
});
function lock(v) { busy = v; document.querySelectorAll('button,input,select').forEach(e => e.disabled = v); if (!v) $('folder').disabled = false; render(); }

$('pick').onclick = async () => { const p = await api.pick(); if (p) $('folder').value = p; };
$('add').onclick = () => {
  const b = toBytes($('amt').value, $('unit').value);
  if (b === null || b === 0n) return say('Enter a number greater than 0, for example 2.5.', 1);
  items.push({ a: $('amt').value.trim(), u: $('unit').value, b }); $('amt').value = ''; say('Ready.'); render();
};
$('amt').onkeydown = e => { if (e.key === 'Enter') $('add').click(); };
$('rel').onclick = async () => { await api.free(); $('rel').hidden = true; $('fill').style.width = '0'; say('Memory released.'); };

api.onProgress(p => {
  $('fill').style.width = p + '%';
  const parts = Number((cur + PART - 1n) / PART);
  say(mode === 2 ? `Part ${Math.min(parts, Math.floor(p / 100 * Number(cur) / 2 ** 32) + 1)} of ${parts} - ${p.toFixed(1)}%` : `${p.toFixed(1)}%`);
});
$('go').onclick = async () => {
  cur = items.reduce((a, x) => a + x.b, 0n);
  if (!items.length) return say('Add at least one amount to the waste list first.', 1);
  if (cur > MAX) return say('The total is above the 16 EB limit.', 1);
  let file = '';
  if (MODES[mode].disk) {
    const f = $('folder').value, n = $('fname').value.trim();
    if (!f) return say('Choose a save location first.', 1);
    if (!n || /[\\/:*?"<>|]/.test(n)) return say('Enter a valid file name (no \\ / : * ? " < > |).', 1);
    file = f.replace(/[\\/]+$/, '') + '\\' + n;
  }
  lock(true); $('fill').style.width = '0'; say('Starting...');
  const err = await (mode === 4 ? api.electron(cur.toString()) : api.run(mode, file, cur.toString()));
  lock(false);
  if (err) { $('fill').style.width = '0'; return say(err, 1); }
  $('fill').style.width = '100%';
  if (mode >= 3) { $('rel').hidden = false; say(`Done. ${cur.toLocaleString()} bytes of RAM are in use until you release them.`); }
  else say(`Done. File created: ${file}`);
};
setMode(1); render();
