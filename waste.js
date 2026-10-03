// Hidden renderer: hoard random (incompressible) data in 16 MB buffers and never let go.
const bytes = Number(new URLSearchParams(location.search).get('bytes'));
const CH = 16 * 1024 * 1024, keep = [];
let done = 0;
function step() {
  const n = Math.min(CH, bytes - done), b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(i + 65536, n)));
  keep.push(b); done += n; wasteApi.report(n);
  if (done < bytes) setTimeout(step, 0);
}
step();
