/**
 * Draws Aurora's painted skies into public/sky/.
 *
 *   npx tsx scripts/sky-art.ts
 *
 * Most of Aurora's skies are gradients written in app/globals.css. A few are
 * scenes -- dunes, a starfield, the northern lights -- and a scene is too many
 * shapes for CSS: thousands of stars at their own brightness, a ridge of pines,
 * the leeward shadow on every dune. Those are SVG files, drawn here from a
 * seeded random number generator so the same run always draws the same sky,
 * and committed, so nothing runs at build time.
 *
 * Every file is 1600x1000 and anchored to the bottom (`xMidYMax slice`), so
 * the horizon stays on the floor of the screen at any window shape.
 *
 * The colours each scene paints at its brightest are listed beside the sky in
 * lib/theme/sky.ts as `peaks`, and lib/theme/sky.test.ts measures the glass
 * over every one of them. Change a scene's colours here and change its peaks
 * there.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1600;
const H = 1000;
const OUT = join(process.cwd(), 'public/sky');

/** A small seeded generator (mulberry32), so a scene is the same every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal deviate, for stars that crowd towards the Milky Way. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const f = (n: number) => n.toFixed(1);

function svg(defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice"><defs>${defs}</defs>${body}</svg>\n`;
}

/* ─────────────────────────── Stars ─────────────────────────── */

type StarOptions = { count: number; seed: number; band?: { from: [number, number]; to: [number, number]; width: number; count: number }; maxY?: number };

const STAR_TINTS = ['#ffffff', '#ffffff', '#ffffff', '#dce8ff', '#cfe0ff', '#fff1d6', '#ffe0b8'];

function stars({ count, seed, band, maxY = H }: StarOptions): string {
  const random = seeded(seed);
  const out: string[] = [];
  const one = (x: number, y: number) => {
    if (y > maxY || y < 0 || x < 0 || x > W) return;
    // Most stars are faint; a few are bright. A steep power gives the right
    // spread, which is what makes a field read as sky rather than as dots.
    const power = random() ** 7;
    const r = 0.35 + power * 1.6;
    const opacity = 0.25 + Math.min(0.75, power * 1.4 + random() * 0.35);
    const tint = STAR_TINTS[Math.floor(random() * STAR_TINTS.length)]!;
    if (power > 0.45) {
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 4)}" fill="url(#glow)" opacity="${(opacity * 0.6).toFixed(2)}"/>`);
    }
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${r.toFixed(2)}" fill="${tint}" opacity="${opacity.toFixed(2)}"/>`);
  };
  for (let i = 0; i < count; i += 1) one(random() * W, random() * H);
  if (band) {
    const [x0, y0] = band.from;
    const [x1, y1] = band.to;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / length;
    const ny = (x1 - x0) / length;
    for (let i = 0; i < band.count; i += 1) {
      const t = random();
      const off = gaussian(random) * band.width;
      one(x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off);
    }
  }
  return out.join('');
}

const GLOW_DEF = '<radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="#cfe0ff" stop-opacity=".25"/><stop offset="1" stop-color="#cfe0ff" stop-opacity="0"/></radialGradient>';

/* ─────────────────────────── Ridges and trees ─────────────────────────── */

/** A mountain ridge along the bottom: midpoint displacement, then filled down. */
function ridge(seed: number, base: number, rough: number, fill: string): string {
  const random = seeded(seed);
  let points: [number, number][] = [
    [0, base - rough * 0.4],
    [W, base - rough * 0.2],
  ];
  let spread = rough;
  for (let pass = 0; pass < 7; pass += 1) {
    const next: [number, number][] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[i + 1]!;
      next.push([ax, ay], [(ax + bx) / 2, (ay + by) / 2 + (random() - 0.5) * spread]);
    }
    next.push(points[points.length - 1]!);
    points = next;
    spread *= 0.55;
  }
  return `<path d="M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} L${W} ${H} L0 ${H}Z" fill="${fill}"/>`;
}

/** A line of pines: each a narrow stack of tiers, so the edge is ragged like a real treeline. */
function pines(seed: number, base: number, fill: string): string {
  const random = seeded(seed);
  const trees: string[] = [`<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="${fill}"/>`];
  let x = -10;
  while (x < W + 20) {
    const height = 40 + random() ** 1.6 * 120;
    const width = height * (0.22 + random() * 0.1);
    // Overlapping tiers, each a triangle wider than the one above it, on a
    // thin trunk: the silhouette of a spruce rather than a stack of diamonds.
    const tiers = 6 + Math.floor(random() * 4);
    const top = base - height;
    let d = `M${f(x - 1.2)} ${f(base + 2)} L${f(x - 1.2)} ${f(top)} L${f(x + 1.2)} ${f(top)} L${f(x + 1.2)} ${f(base + 2)}Z`;
    for (let k = 0; k < tiers; k += 1) {
      const apex = top + (height * 0.92 * k) / tiers;
      const foot = apex + (height / tiers) * 1.9;
      const w = (width / 2) * (0.25 + (0.75 * (k + 1)) / tiers) * (0.9 + random() * 0.25);
      d += ` M${f(x)} ${f(apex)} L${f(x - w)} ${f(Math.min(foot, base + 2))} L${f(x + w)} ${f(Math.min(foot, base + 2))}Z`;
    }
    trees.push(`<path d="${d}" fill="${fill}"/>`);
    x += 6 + random() * 22;
  }
  return trees.join('');
}

/* ─────────────────────────── Dunes ─────────────────────────── */

type DuneColours = { lit: string; body: string; shade: string };

/**
 * One rank of dunes: a smooth crest line with a few humps, lit along the
 * crest and graded down into shade.
 */
function duneRank(seed: number, base: number, amp: number, humps: number, colours: DuneColours, id: string): { defs: string; body: string } {
  const random = seeded(seed);
  const crests: [number, number][] = [];
  for (let i = 0; i <= humps; i += 1) {
    const x = (i / humps) * W + (random() - 0.5) * (W / humps) * 0.5;
    crests.push([x, base - amp * (0.5 + random() * 0.6)]);
  }
  let d = `M-50 ${f(base + amp * 0.2)}`;
  for (let i = 0; i < crests.length; i += 1) {
    const [cx, cy] = crests[i]!;
    const prevX = i === 0 ? -50 : crests[i - 1]![0];
    const trough = base + amp * (0.15 + random() * 0.2);
    const mid = (prevX + cx) / 2;
    d += ` Q${f(mid - 60)} ${f(trough)} ${f(mid)} ${f(trough)} Q${f(cx - 110)} ${f(cy - 4)} ${f(cx)} ${f(cy)}`;
    // A draw that used to place a leeward shadow, kept so every dune after it
    // lands where it was approved. At this distance a dune reads as a smooth
    // ridge graded from its lit crest down into shade, which the fill does.
    random();
  }
  d += ` Q${W + 20} ${f(base)} ${W + 50} ${f(base + amp * 0.2)} L${W + 50} ${H} L-50 ${H}Z`;
  const defs = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colours.lit}"/><stop offset=".45" stop-color="${colours.body}"/><stop offset="1" stop-color="${colours.shade}"/></linearGradient>`;
  return { defs, body: `<path d="${d}" fill="url(#${id})"/>` };
}

type DuneScene = {
  sky: [string, string][];
  sun?: { x: number; y: number; r: number; core: string; halo: string };
  ranks: DuneColours[];
  stars?: number;
  haze: string;
};

function dunes(scene: DuneScene, seed: number): string {
  const skyStops = scene.sky.map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`).join('');
  let defs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${skyStops}</linearGradient>${GLOW_DEF}`;
  let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (scene.stars) body += stars({ count: scene.stars, seed: seed + 9, maxY: 560 });
  if (scene.sun) {
    const { x, y, r, core, halo } = scene.sun;
    defs += `<radialGradient id="sun"><stop offset="0" stop-color="${core}"/><stop offset=".18" stop-color="${core}"/><stop offset=".22" stop-color="${halo}" stop-opacity=".7"/><stop offset="1" stop-color="${halo}" stop-opacity="0"/></radialGradient>`;
    body += `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#sun)"/>`;
  }
  defs += `<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scene.haze}" stop-opacity="0"/><stop offset="1" stop-color="${scene.haze}" stop-opacity=".7"/></linearGradient>`;
  body += `<rect y="430" width="${W}" height="180" fill="url(#haze)"/>`;
  const layout = [
    { base: 610, amp: 70, humps: 3 },
    { base: 720, amp: 110, humps: 3 },
    { base: 850, amp: 140, humps: 2 },
  ];
  scene.ranks.forEach((colours, i) => {
    const rank = duneRank(seed + i * 17, layout[i]!.base, layout[i]!.amp, layout[i]!.humps, colours, `d${i}`);
    defs += rank.defs;
    body += rank.body;
  });
  return svg(defs, body);
}

/* ─────────────────────────── Starfield ─────────────────────────── */

function starfield(): string {
  const band = { from: [-100, 980] as [number, number], to: [1700, -60] as [number, number] };
  const defs =
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03040a"/><stop offset=".7" stop-color="#070b18"/><stop offset=".92" stop-color="#0f1a2c"/><stop offset="1" stop-color="#16243a"/></linearGradient>` +
    `<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="38"/></filter>` +
    `<filter id="dust" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>` +
    GLOW_DEF;
  const random = seeded(42);
  // The galaxy's glow: overlapping soft clouds along the band, warm towards
  // the core at the lower left and cool and thin towards the top right.
  let glow = '';
  for (let i = 0; i < 26; i += 1) {
    const t = i / 25;
    const x = band.from[0] + (band.to[0] - band.from[0]) * t + (random() - 0.5) * 60;
    const y = band.from[1] + (band.to[1] - band.from[1]) * t + (random() - 0.5) * 60;
    const warm = 1 - t;
    const colour = warm > 0.55 ? '#b8a48c' : warm > 0.3 ? '#9a98b4' : '#7d86ad';
    glow += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(120 + random() * 90)}" ry="${f(60 + random() * 40)}" fill="${colour}" opacity="${(0.08 + warm * 0.1).toFixed(3)}" transform="rotate(-30 ${f(x)} ${f(y)})"/>`;
  }
  // Dust lanes: dark, broken streaks along the middle of the band.
  let lanes = '';
  for (let i = 0; i < 14; i += 1) {
    const t = 0.05 + (i / 13) * 0.75;
    const x = band.from[0] + (band.to[0] - band.from[0]) * t + (random() - 0.5) * 30;
    const y = band.from[1] + (band.to[1] - band.from[1]) * t + (random() - 0.5) * 30;
    lanes += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(70 + random() * 80)}" ry="${f(10 + random() * 12)}" fill="#03040a" opacity="${(0.45 + random() * 0.3).toFixed(2)}" transform="rotate(-30 ${f(x)} ${f(y)})"/>`;
  }
  const body =
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
    `<g filter="url(#soft)">${glow}</g>` +
    stars({ count: 1500, seed: 7, band: { ...band, width: 90, count: 2600 } }) +
    `<g filter="url(#dust)">${lanes}</g>` +
    // Airglow, the faint green-blue band real skies have above the horizon.
    `<rect y="760" width="${W}" height="120" fill="#1f4a4a" opacity=".12" filter="url(#dust)"/>` +
    ridge(11, 900, 160, '#05070c') +
    ridge(23, 950, 90, '#020306');
  return svg(defs, body);
}

/* ─────────────────────────── Northern lights ─────────────────────────── */

/**
 * One curtain: a wavy lower edge, a height that swells and thins along it, a
 * bright green edge fading up through teal into a violet top, and fine
 * vertical rays cut through it by a stretched noise.
 */
function curtain(seed: number, baseY: number, height: number, amp: number, id: string, opacity: number): { defs: string; body: string } {
  const random = seeded(seed);
  const steps = 40;
  const phase = random() * 6;
  const lower: [number, number][] = [];
  const upper: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = -100 + ((W + 200) * i) / steps;
    const wave = Math.sin(i / 5 + phase) * amp + Math.sin(i / 2.3 + phase * 2) * amp * 0.3;
    const y = baseY + wave;
    const swell = 0.45 + 0.55 * Math.max(0, Math.sin(i / 7 + phase));
    lower.push([x, y]);
    upper.push([x, y - height * swell]);
  }
  const d = `M${lower.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} L${upper
    .reverse()
    .map(([x, y]) => `${f(x)} ${f(y)}`)
    .join(' L')}Z`;
  const defs =
    `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0">` +
    `<stop offset="0" stop-color="#b8ffd9" stop-opacity=".95"/>` +
    `<stop offset=".08" stop-color="#4dffa6" stop-opacity=".9"/>` +
    `<stop offset=".45" stop-color="#1fc98a" stop-opacity=".45"/>` +
    `<stop offset=".8" stop-color="#3b6fd0" stop-opacity=".18"/>` +
    `<stop offset="1" stop-color="#b04fe0" stop-opacity=".22"/></linearGradient>`;
  return { defs, body: `<path d="${d}" fill="url(#${id})" opacity="${opacity}"/>` };
}

function northern(): string {
  let defs =
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02040b"/><stop offset=".6" stop-color="#04101c"/><stop offset=".9" stop-color="#082430"/><stop offset="1" stop-color="#0b2e36"/></linearGradient>` +
    // The rays: noise stretched almost entirely vertical, used as a mask, so
    // each curtain breaks into the fine pleats a real aurora hangs in.
    `<filter id="rays" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035 0.0009" numOctaves="2" seed="5" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.6 -0.75" result="m"/>` +
    `<feComposite in="SourceGraphic" in2="m" operator="in" result="cut"/>` +
    `<feGaussianBlur in="cut" stdDeviation="1.4"/></filter>` +
    `<filter id="bloom" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>` +
    GLOW_DEF;
  let bands = '';
  [
    { seed: 3, base: 520, height: 300, amp: 60, opacity: 1 },
    { seed: 8, base: 640, height: 220, amp: 40, opacity: 0.8 },
    { seed: 13, base: 410, height: 240, amp: 70, opacity: 0.55 },
  ].forEach((c, i) => {
    const one = curtain(c.seed, c.base, c.height, c.amp, `c${i}`, c.opacity);
    defs += one.defs;
    bands += one.body;
  });
  const body =
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
    stars({ count: 700, seed: 19, maxY: 820 }) +
    // A soft bloom of the same curtains underneath, then the rayed curtains on top.
    `<ellipse cx="900" cy="520" rx="900" ry="230" fill="#1fbf80" opacity=".12" filter="url(#bloom)"/>` +
    `<g filter="url(#bloom)" opacity=".85">${bands}</g>` +
    `<g filter="url(#rays)">${bands}</g>` +
    // The green light catching the snow along the horizon.
    `<rect y="800" width="${W}" height="70" fill="#2bd48c" opacity=".08" filter="url(#bloom)"/>` +
    ridge(31, 870, 70, '#03080d') +
    pines(77, 905, '#010307');
  return svg(defs, body);
}

/* ─────────────────────────── Write ─────────────────────────── */

const FILES: Record<string, string> = {
  'dunes-dawn.svg': dunes(
    {
      sky: [['0', '#b9a7f0'], ['.38', '#f0b8c8'], ['.58', '#ffd2a3'], ['.64', '#ffe5bf']],
      sun: { x: 1120, y: 520, r: 260, core: '#fff6d6', halo: '#ffc98a' },
      ranks: [
        { lit: '#f9cf9c', body: '#eeb07c', shade: '#c98a62' },
        { lit: '#f6bb84', body: '#e69563', shade: '#b86f4c' },
        { lit: '#efa56f', body: '#d47a4d', shade: '#a2583a' },
      ],
      haze: '#ffd9b0',
    },
    101,
  ),
  'dunes-night.svg': dunes(
    {
      sky: [['0', '#120c26'], ['.4', '#2a1640'], ['.56', '#7a3a58'], ['.64', '#d8794f']],
      sun: { x: 420, y: 600, r: 220, core: '#ffcf8a', halo: '#f08a4a' },
      ranks: [
        { lit: '#8a4a52', body: '#5e3048', shade: '#3a1d36' },
        { lit: '#6e3a4c', body: '#47243e', shade: '#2a1530' },
        { lit: '#55304a', body: '#341b34', shade: '#1d0f22' },
      ],
      stars: 260,
      haze: '#c0604a',
    },
    202,
  ),
  'silver-dawn.svg': dunes(
    {
      sky: [['0', '#a9c4e6'], ['.4', '#cddcef'], ['.58', '#eef2f6'], ['.64', '#f7f5ef']],
      sun: { x: 380, y: 470, r: 230, core: '#ffffff', halo: '#e6eef8' },
      ranks: [
        { lit: '#efe9de', body: '#ddd5c6', shade: '#b9b3a8' },
        { lit: '#e7e0d3', body: '#cfc6b6', shade: '#a8a196' },
        { lit: '#ddd5c6', body: '#c0b6a5', shade: '#958e84' },
      ],
      haze: '#f3f1ec',
    },
    303,
  ),
  'silver-night.svg': dunes(
    {
      sky: [['0', '#050a18'], ['.45', '#0c1a33'], ['.6', '#1c3256'], ['.64', '#2b4670']],
      sun: { x: 1180, y: 300, r: 150, core: '#b8c6dc', halo: '#5a74a0' },
      ranks: [
        { lit: '#4a5f82', body: '#2f3f5c', shade: '#1a2438' },
        { lit: '#3b4e70', body: '#26334d', shade: '#141c2e' },
        { lit: '#2f405e', body: '#1c2740', shade: '#0e1424' },
      ],
      stars: 420,
      haze: '#3a5580',
    },
    404,
  ),
  'starfield.svg': starfield(),
  'northern.svg': northern(),
};

mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(FILES)) {
  writeFileSync(join(OUT, name), text);
  console.log(`${name}  ${(text.length / 1024).toFixed(0)} KB`);
}
