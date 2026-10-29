/* Drawn smiling portraits for the doctors (replace with <img> tags if you have real photos). */
let faceId = 0;
function face(o) {
  const id = 'f' + (++faceId), h = o.hair, s = o.skin;
  const back = o.style === 'long' ? `<path d="M30 56Q22 18 60 18Q98 18 90 56L96 104L24 104Z" fill="${h}"/>` : '';
  const curls = o.style === 'curly' ? [[40, 34], [52, 25], [68, 25], [80, 34], [33, 48], [87, 48], [60, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="${h}"/>`).join('') : '';
  const top = o.style === 'curly' ? '' : `<path d="M33 52Q29 20 60 20Q91 20 87 52Q80 36 60 37Q40 36 33 52Z" fill="${h}"/>`;
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Smiling dentist"><defs><clipPath id="${id}"><circle cx="60" cy="60" r="60"/></clipPath></defs>
  <g clip-path="url(#${id})"><rect width="120" height="120" fill="${o.bg}"/>${back}${curls}
  <path d="M14 124Q20 92 60 90Q100 92 106 124Z" fill="#fff"/><path d="M48 90L60 108L72 90" fill="none" stroke="#0f766e" stroke-width="5" stroke-linejoin="round"/>
  <rect x="51" y="74" width="18" height="20" rx="7" fill="${s}"/><ellipse cx="60" cy="54" rx="26" ry="30" fill="${s}"/>${top}
  <path d="M44 50q6-8 12 0M64 50q6-8 12 0" stroke="#2b1b14" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <circle cx="41" cy="63" r="5" fill="#ff7f7f" opacity=".3"/><circle cx="79" cy="63" r="5" fill="#ff7f7f" opacity=".3"/>
  <path d="M42 64Q60 92 78 64Q60 70 42 64Z" fill="#fff" stroke="#7a2e2e" stroke-width="2.4" stroke-linejoin="round"/></g></svg>`;
}
// One look per doctor, in the same order as the database (ids 1 to 5).
const DOCTOR_LOOKS = [
  { skin: '#a8693f', hair: '#17100d', bg: '#bfeee3', style: 'short' },
  { skin: '#6a4128', hair: '#0f0a08', bg: '#d6e6ff', style: 'short' },
  { skin: '#c68a5b', hair: '#2a1a12', bg: '#ffe9c2', style: 'long' },
  { skin: '#8a5a3c', hair: '#120c09', bg: '#e4dcff', style: 'curly' },
  { skin: '#7b4a2d', hair: '#1d130e', bg: '#ffd9e8', style: 'long' }
];
