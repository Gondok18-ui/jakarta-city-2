// layout.js — the island's single source of truth: land bounds, road segments,
// medians, districts, kampungs, parks and every interactive place, plus the
// road graph the traffic router drives on. North is -z. All units are metres.
// Jakarta City is an original work; the layout is our own design inspired
// by Jakarta's geography, not a copy of any real or game map.

export const LAND = { x0: -780, x1: 780, z0: -1240, z1: 1040 };
export const SAND = { x0: -800, x1: 800, z0: -1260, z1: 1060 };

const seg = (x0, z0, x1, z1, w) => ({ x0, z0, x1, z1, w });

// --- road segments (rendering, building clearance, traffic graph) ---
export const ROAD_SEGS = [
  // avenues (north-south)
  seg(0, -880, 0, 900, 38),         // Thamrin-Sudirman
  seg(-400, -1010, -400, 830, 32),  // Jl. Panjang
  seg(400, -1010, 400, 880, 32),    // Rasuna Said
  seg(640, -420, 640, 560, 24),     // MT Haryono (east, partial)
  // arterials (east-west)
  seg(-700, -1000, 700, -1000, 26), // Gunung Sahari
  seg(-700, -640, 700, -640, 26),
  seg(-700, -300, 700, -300, 26),
  seg(-700, 30, 700, 30, 26),       // Kebon Kacang, through Bundaran HI
  seg(-700, 760, 700, 760, 26),     // Senayan-Blok M
  // ring road (rectangle)
  seg(-700, -1160, 700, -1160, 30), seg(-700, 960, 700, 960, 30),
  seg(-700, -1160, -700, 960, 30), seg(700, -1160, 700, 960, 30),
  // Gatot Subroto diagonal — the only east-west corridor through Semanggi
  seg(-680, -140, 430, 880, 30),
  // connectors from avenue/arterial ends to the ring
  seg(-400, -1010, -400, -1160, 14), seg(400, -1010, 400, -1160, 14),
  seg(0, 900, 0, 960, 14), seg(-400, 830, -400, 960, 14), seg(400, 880, 400, 960, 14),
  seg(430, 880, 430, 960, 14), seg(-680, -140, -700, -140, 14),
  // local streets serving the interactive places
  seg(-400, -140, 0, -140, 12),  // POLSEK street
  seg(0, -170, 400, -170, 12),   // MASJID street
  seg(0, 250, 400, 250, 12),     // RSUD / karaoke / gun shop row
  seg(60, 505, 400, 505, 12),    // BENGKEL street, off the diagonal
  // Menteng local grid
  seg(120, -620, 120, -40, 9), seg(300, -620, 300, -40, 9), seg(480, -620, 480, -40, 9),
  seg(60, -480, 690, -480, 9), seg(60, -120, 690, -120, 9),
  // Kebayoran local grid
  seg(-200, 800, -200, 1010, 9), seg(100, 800, 100, 1010, 9),
  seg(-330, 900, 340, 900, 9),
  // kampung barat streets and gang lanes
  seg(-690, 520, -500, 520, 7), seg(-690, 580, -500, 580, 7), seg(-690, 640, -500, 640, 7), seg(-690, 700, -500, 700, 7),
  seg(-370, 820, -215, 820, 7), seg(-370, 880, -215, 880, 7),
  seg(-640, 500, -640, 720, 5), seg(-580, 500, -580, 720, 5),
  seg(-340, 770, -340, 920, 5), seg(-280, 770, -280, 920, 5),
  seg(-690, 610, -500, 610, 10), // kampung barat main road to the ring road
  // kampung melayu streets and gang lanes
  seg(460, 600, 676, 600, 7), seg(460, 660, 676, 660, 7), seg(460, 720, 676, 720, 7), seg(460, 800, 676, 800, 7),
  seg(540, 570, 540, 810, 5), seg(630, 570, 630, 810, 5),
];

// distance from a point to a segment, and the closest point on it
export function segClosest(px, pz, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - s.x0) * dx + (pz - s.z0) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x0 + dx * t, cz = s.z0 + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), x: cx, z: cz, t };
}
export function distToSeg(px, pz, s) { return segClosest(px, pz, s).d; }

// true when a footprint (centre + radius) stays off every road
export function clearOfRoads(x, z, r, margin = 2.5) {
  for (const s of ROAD_SEGS) if (distToSeg(x, z, s) < s.w / 2 + r + margin) return false;
  return true;
}
// the widest road within r of a point (0 when off-road)
export function roadWidthAt(x, z, r = 0) {
  let w = 0;
  for (const s of ROAD_SEGS) if (distToSeg(x, z, s) < s.w / 2 + r) w = Math.max(w, s.w);
  return w;
}

// --- districts: building generation + area notifications ---
export const ZONES = [
  { name: 'Kota Tua', x0: -690, x1: -210, z0: -1150, z1: -1020, hMin: 8, hMax: 16, sMin: 14, sMax: 24, density: 0.55, kind: 'block' },
  { name: 'Grogol', x0: -685, x1: -215, z0: -640, z1: -60, hMin: 12, hMax: 45, sMin: 16, sMax: 28, density: 0.6, kind: 'tower' },
  { name: 'Menteng', x0: 60, x1: 690, z0: -620, z1: -40, hMin: 6, hMax: 11, sMin: 11, sMax: 17, density: 0.62, kind: 'house' },
  { name: 'Thamrin', x0: -190, x1: 190, z0: -860, z1: -40, hMin: 26, hMax: 120, sMin: 20, sMax: 36, density: 0.72, kind: 'tower' },
  { name: 'Sudirman', x0: -190, x1: 190, z0: 60, z1: 890, hMin: 26, hMax: 120, sMin: 20, sMax: 36, density: 0.72, kind: 'tower' },
  { name: 'Kuningan', x0: 215, x1: 585, z0: -640, z1: 760, hMin: 22, hMax: 90, sMin: 18, sMax: 32, density: 0.66, kind: 'tower' },
  { name: 'Setiabudi', x0: 590, x1: 690, z0: -400, z1: 540, hMin: 14, hMax: 40, sMin: 16, sMax: 26, density: 0.55, kind: 'tower' },
  { name: 'Kebayoran', x0: -330, x1: -70, z0: 790, z1: 1010, hMin: 10, hMax: 30, sMin: 15, sMax: 26, density: 0.6, kind: 'block' },
  { name: 'Blok M', x0: -60, x1: 280, z0: 800, z1: 950, hMin: 11, hMax: 18, sMin: 26, sMax: 46, density: 0.7, kind: 'mall' },
  { name: 'Kebayoran Timur', x0: 290, x1: 420, z0: 790, z1: 1010, hMin: 10, hMax: 26, sMin: 15, sMax: 24, density: 0.55, kind: 'block' },
];
export const PARKS = [
  { name: 'Monas', x0: -175, x1: 175, z0: -1185, z1: -875 },
  { name: 'Senayan', x0: -490, x1: -170, z0: 495, z1: 745 },
];
export const KAMPUNGS = [
  { name: 'Kampung Barat', streets: [520, 580, 640, 700], x0: -676, x1: -500, lanes: [-640, -580], mainZ: 610 },
  { name: 'Kampung Barat', streets: [820, 880], x0: -370, x1: -215, lanes: [-340, -280], mainZ: null },
  { name: 'Kampung Melayu', streets: [600, 660, 720, 800], x0: 460, x1: 676, lanes: [540, 630], mainZ: null },
];
export const PORT = { x0: 535, x1: 685, z0: -1140, z1: -1010 };
export const BEACH = { x0: -800, x1: 800, z0: -1240, z1: -1176 };
export const ROUNDABOUT = { x: 0, z: 30, r: 34, island: 16 };

// --- interactive places: x,z = building centre; px,pz = prompt point ---
export const PLACES = {
  polsek:   { x: -70, z: -152, px: -70, pz: -141.5, label: 'POLSEK' },
  masjid:   { x: 185, z: -186, px: 185, pz: -171.5, label: 'GRAND MOSQUE' },
  rsud:     { x: 70, z: 263, px: 70, pz: 250.5, label: 'RSUD HOSPITAL' },
  karaoke:  { x: 150, z: 264, px: 150, pz: 250.5, label: 'STAR KARAOKE' },
  gunshop:  { x: 120, z: 238, px: 120, pz: 249, label: 'GUN SHOP' },
  bengkel:  { x: 215, z: 518, px: 215, pz: 505.5, label: 'BENGKEL' },
  house:    { x: 318, z: -268, px: 318, pz: -276, label: 'HOUSE FOR SALE' },
  singgah:  { x: -60, z: -862, px: -60, pz: -855.5, label: 'SAVE POINT' },
  gbk:      { x: -330, z: 620, px: -330, pz: 742, label: 'GBK STADIUM' },
  monas:    { x: 0, z: -1030, px: 0, pz: -1030, label: 'MONAS' },
};
// interiors live far off-island (teleport rooms in the sea, east side)
export const INTERIOR = { karaoke: { x: 1150, z: 690 }, rumah: { x: 1000, z: 690 } };
// spawn: on the hospital street facing the avenue; starter car beside it
export const SPAWN = { x: 46, z: 246, heading: -Math.PI / 2, carX: 56, carZ: 254, carH: Math.PI / 2 };
// sailable boats: west coast and beside the Ancol pier
export const BOATS = [{ x: -790, z: -100 }, { x: 409, z: -1280 }];
export const PIER = { x: 400, z0: -1240, z1: -1310, hw: 7 };

// --- planted medians (pembatas jalan) on the wide avenues + Gunung Sahari ---
// Segments run between crossing bands so every junction stays open.
function medianV(x, z0, z1, crossings) {
  const out = []; let cur = z0;
  for (const [cz, hb] of crossings.slice().sort((a, b) => a[0] - b[0])) {
    if (cz - hb > cur + 8) out.push({ x0: x, z0: cur, x1: x, z1: cz - hb });
    cur = Math.max(cur, cz + hb);
  }
  if (z1 > cur + 8) out.push({ x0: x, z0: cur, x1: x, z1 });
  return out;
}
function medianH(z, x0, x1, crossings) {
  const out = []; let cur = x0;
  for (const [cx, hb] of crossings.slice().sort((a, b) => a[0] - b[0])) {
    if (cx - hb > cur + 8) out.push({ x0: cur, z0: z, x1: cx - hb, z1: z });
    cur = Math.max(cur, cx + hb);
  }
  if (x1 > cur + 8) out.push({ x0: cur, z0: z, x1, z1: z });
  return out;
}
export const MEDIANS = [
  ...medianV(0, -880, 900, [[-640, 17], [-300, 17], [-170, 10], [-140, 10], [30, 40], [250, 10], [485, 26], [760, 17]]),
  ...medianV(-400, -1010, 830, [[-1000, 17], [-640, 17], [-300, 17], [-140, 10], [30, 17], [117, 24], [760, 17]]),
  ...medianV(400, -1010, 880, [[-1000, 17], [-640, 17], [-300, 17], [-170, 10], [30, 17], [250, 10], [505, 10], [760, 17], [852, 24]]),
  ...medianH(-1000, -685, 685, [[-400, 20], [400, 20]]),
];
export function isMedianRoad(s) {
  return (s.x0 === s.x1 && (s.x0 === 0 || Math.abs(s.x0) === 400)) || (s.z0 === s.z1 && s.z0 === -1000);
}
// lane offsets from the centreline for a road of this width (left-hand traffic)
export function laneOffset(w) {
  if (w >= 30) return [6.2, 14.2];
  if (w >= 24) return [4.5, 9.5];
  if (w >= 12) return [3.0];
  if (w >= 8) return [2.4];
  return [1.8];
}

// --- district lookup for area notifications and the world map ---
export function zoneName(x, z) {
  if (Math.hypot(x - ROUNDABOUT.x, z - ROUNDABOUT.z) < 58) return 'Bundaran HI';
  if (x >= PARKS[0].x0 && x <= PARKS[0].x1 && z >= PARKS[0].z0 && z <= PARKS[0].z1) return 'Monas';
  if (x >= PARKS[1].x0 && x <= PARKS[1].x1 && z >= PARKS[1].z0 && z <= PARKS[1].z1) return 'Senayan — GBK';
  if (x >= PORT.x0 && x <= PORT.x1 && z >= PORT.z0 && z <= PORT.z1) return 'Pelabuhan';
  if (z < -1176 && z >= -1260) return 'Pantai Ancol';
  if (x < LAND.x0 + 8 || x > LAND.x1 - 8 || z > LAND.z1 - 8) return 'Pantai';
  for (const k of KAMPUNGS) if (x >= k.x0 - 14 && x <= k.x1 + 14 && z >= k.streets[0] - 26 && z <= k.streets[k.streets.length - 1] + 26) return k.name;
  for (const zn of ZONES) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn.name;
  if (Math.abs(x) <= 30) return z < 30 ? 'Thamrin' : 'Sudirman';
  if (Math.abs(x + 400) <= 26) return 'Jl. Panjang';
  if (Math.abs(x - 400) <= 26) return 'Rasuna Said';
  if (Math.abs(z + 1000) <= 22) return 'Gunung Sahari';
  if (Math.abs(z - 760) <= 22) return 'Senayan — Blok M';
  return 'Jakarta';
}

// ---------------- road graph (traffic + pedestrian routing) ----------------
// Nodes are segment endpoints plus every crossing; edges are the pieces of
// road between consecutive nodes along a segment, tagged with its width.
export const NODES = [];
export const EDGES = [];
const nodeKeys = new Map();
export function nodeAt(x, z) {
  const key = Math.round(x * 2) + ',' + Math.round(z * 2);
  let id = nodeKeys.get(key);
  if (id === undefined) {
    id = NODES.length;
    NODES.push({ x, z, edges: [] });
    nodeKeys.set(key, id);
  }
  return id;
}
function segIntersect(a, b) {
  const d1x = a.x1 - a.x0, d1z = a.z1 - a.z0, d2x = b.x1 - b.x0, d2z = b.z1 - b.z0;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.x0 - a.x0) * d2z - (b.z0 - a.z0) * d2x) / den;
  const u = ((b.x0 - a.x0) * d1z - (b.z0 - a.z0) * d1x) / den;
  if (t <= 0.001 || t >= 0.999 || u <= -0.001 || u >= 1.001) return null;
  return { x: a.x0 + d1x * t, z: a.z0 + d1z * t, t, u };
}
export function buildGraph() {
  if (EDGES.length) return;
  const cuts = ROAD_SEGS.map(() => [{ t: 0 }, { t: 1 }]);
  for (let i = 0; i < ROAD_SEGS.length; i++) {
    nodeAt(ROAD_SEGS[i].x0, ROAD_SEGS[i].z0);
    nodeAt(ROAD_SEGS[i].x1, ROAD_SEGS[i].z1);
    for (let j = i + 1; j < ROAD_SEGS.length; j++) {
      const hit = segIntersect(ROAD_SEGS[i], ROAD_SEGS[j]);
      if (!hit) continue;
      nodeAt(hit.x, hit.z);
      cuts[i].push({ t: hit.t });
      cuts[j].push({ t: Math.max(0, Math.min(1, hit.u)) });
    }
  }
  // T-junctions: an endpoint lying on another segment also cuts it
  for (let j = 0; j < ROAD_SEGS.length; j++) {
    for (let i = 0; i < ROAD_SEGS.length; i++) {
      if (i === j) continue;
      for (const [ex, ez] of [[ROAD_SEGS[j].x0, ROAD_SEGS[j].z0], [ROAD_SEGS[j].x1, ROAD_SEGS[j].z1]]) {
        const c = segClosest(ex, ez, ROAD_SEGS[i]);
        if (c.d < 0.6 && c.t > 0.001 && c.t < 0.999) cuts[i].push({ t: c.t });
      }
    }
  }
  for (let i = 0; i < ROAD_SEGS.length; i++) {
    const s = ROAD_SEGS[i];
    const ts = [...new Set(cuts[i].map(c => Math.round(c.t * 2000) / 2000))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      const ax = s.x0 + (s.x1 - s.x0) * ts[k], az = s.z0 + (s.z1 - s.z0) * ts[k];
      const bx = s.x0 + (s.x1 - s.x0) * ts[k + 1], bz = s.z0 + (s.z1 - s.z0) * ts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2) continue;
      const a = nodeAt(ax, az), b = nodeAt(bx, bz);
      if (a === b) continue;
      const id = EDGES.length;
      EDGES.push({ a, b, w: s.w, len });
      NODES[a].edges.push(id);
      NODES[b].edges.push(id);
    }
  }
}
// Dijkstra shortest path between two nodes; returns a node-id list or null.
// costK lets callers price out classes of road (gang lanes for cars).
export function findPath(from, to, costK = null) {
  if (from === to) return [from];
  const dist = new Float64Array(NODES.length).fill(Infinity);
  const prev = new Int32Array(NODES.length).fill(-1);
  const done = new Uint8Array(NODES.length);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < NODES.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    for (const eid of NODES[u].edges) {
      const e = EDGES[eid];
      const v = e.a === u ? e.b : e.a;
      const wgt = e.len * (costK ? costK(e) : 1);
      if (dist[u] + wgt < dist[v]) { dist[v] = dist[u] + wgt; prev[v] = u; }
    }
  }
  const path = [to];
  let cur = to;
  while (cur !== from) { cur = prev[cur]; if (cur < 0) return null; path.push(cur); }
  return path.reverse();
}
export function nearestNode(x, z, pred = null) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    if (pred && !pred(i)) continue;
    const d = Math.hypot(NODES[i].x - x, NODES[i].z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
