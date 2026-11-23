// world.js — builds the whole island from layout.js: ground, roads with
// markings and planted medians, the Bundaran HI roundabout, district
// buildings, shophouse rows, the landmark places, kampungs, the port, the
// beach, both interiors and the sky. Almost everything static is merged
// into a handful of vertex-coloured meshes, and every solid object leaves
// an AABB in the collider grid so nothing in the city can be walked or
// driven through.

import * as THREE from '../vendor/three.module.min.js';
import {
  ROAD_SEGS, MEDIANS, ZONES, PARKS, KAMPUNGS, PLACES, INTERIOR, LAND, SAND,
  PORT, BEACH, PIER, ROUNDABOUT, BOATS, clearOfRoads, distToSeg, isMedianRoad,
} from './layout.js';

// deterministic scatter (reseeded for staged screenshots)
let seed = 1234567;
export function setSeed(n) { seed = n >>> 0 || 1; }
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const R = (a, b) => a + rnd() * (b - a);
const pick = arr => arr[Math.floor(rnd() * arr.length)];

// ---------------- colliders ----------------
export const colliders = [];
const grid = new Map(), CELL = 40;
export function addCollider(x, z, w, d) {
  const c = { x, z, hw: w / 2, hd: d / 2 };
  colliders.push(c);
  const x0 = Math.floor((x - c.hw) / CELL), x1 = Math.floor((x + c.hw) / CELL);
  const z0 = Math.floor((z - c.hd) / CELL), z1 = Math.floor((z + c.hd) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const k = cx + ',' + cz;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  return c;
}
// push a circle out of every collider it touches; returns [x, z, hitSomething]
export function collideCircle(x, z, r) {
  let hit = false;
  const cell = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!cell) return [x, z, false];
  for (let pass = 0; pass < 2; pass++) {
    for (const c of cell) {
      const dx = x - c.x, dz = z - c.z;
      const ox = c.hw + r - Math.abs(dx), oz = c.hd + r - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        hit = true;
        if (ox < oz) x = c.x + (dx >= 0 ? c.hw + r : -c.hw - r);
        else z = c.z + (dz >= 0 ? c.hd + r : -c.hd - r);
      }
    }
  }
  return [x, z, hit];
}

// ---------------- merged vertex-colour geometry ----------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function mergeParts(parts) {
  let total = 0;
  const prepped = parts.map(p => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    total += g.attributes.position.count;
    return { g, ...p };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  const c3 = new THREE.Color();
  for (const p of prepped) {
    _e.set(p.rx || 0, p.ry || 0, p.rz || 0); _q.setFromEuler(_e);
    _m4.compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), _q, new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1));
    p.g.applyMatrix4(_m4);
    const n = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, o * 3);
    nor.set(p.g.attributes.normal.array, o * 3);
    if (p.g.attributes.uv) uv.set(p.g.attributes.uv.array, o * 2);
    c3.set(p.color ?? 0xffffff);
    const shade = p.shade ?? 1;
    for (let i = 0; i < n; i++) { col[(o + i) * 3] = c3.r * shade; col[(o + i) * 3 + 1] = c3.g * shade; col[(o + i) * 3 + 2] = c3.b * shade; }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function part(parts, geo, x, y, z, color, o = {}) { parts.push({ geo, x, y, z, color, ...o }); }

// canvas noise texture for ground/asphalt variety
function noiseTex(base, fleck, n = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  g.fillStyle = fleck;
  for (let i = 0; i < n * 6; i++) g.fillRect(Math.random() * n, Math.random() * n, 2, 2);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// a text sign plate: dark board, bold letters
export function textPlate(text, w = 8, color = '#ffd23f', bg = '#20242c', fontPx = 44) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = color; g.font = 'bold ' + fontPx + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshBasicMaterial({ map: tex }));
  return m;
}
function sign(scene, text, x, y, z, ry, w, color, bg) {
  const p = textPlate(text, w, color, bg);
  p.position.set(x, y, z); p.rotation.y = ry;
  scene.add(p);
  return p;
}

// ---------------- shared scatter state ----------------
export const kampungSpots = { door: null, sitters: [] };
export const beachSpots = { sitters: [] };
export const boatRefs = [];
export const karaokeRefs = { light: null, ball: null };
export const propPositions = []; // palms/leafy/lamps, for audits
let ferrisWheel = null;
export function animatedRefs() { return { ferrisWheel, karaokeBall: karaokeRefs.ball }; }

const nearRoundabout = (x, z) => Math.hypot(x - ROUNDABOUT.x, z - ROUNDABOUT.z) < 38;
const protectedAt = (x, z, r) => {
  for (const k in PLACES) { const p = PLACES[k]; if (Math.hypot(x - p.x, z - p.z) < r + 16) return true; }
  if (nearRoundabout(x, z)) return true;
  if (x > PORT.x0 - 8 && x < PORT.x1 + 8 && z > PORT.z0 - 8 && z < PORT.z1 + 8) return true;
  return false;
};

// ---------------- ground, roads, medians, roundabout ----------------
export function buildGround(scene) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4400, 4400), new THREE.MeshLambertMaterial({ map: noiseTex('#5d7038', '#3f5226') }));
  grass.material.map.repeat.set(220, 220); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.09; scene.add(grass);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4400, 4400), new THREE.MeshLambertMaterial({ map: noiseTex('#2a6ea3', '#1d5f8a') }));
  sea.material.map.repeat.set(150, 150); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.06; scene.add(sea);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1600, 2320), new THREE.MeshLambertMaterial({ map: noiseTex('#d9c28a', '#c2ab72') }));
  sand.material.map.repeat.set(80, 120); sand.rotation.x = -Math.PI / 2; sand.position.set(0, -0.04, -100); sand.receiveShadow = true; scene.add(sand);
  const land = new THREE.Mesh(new THREE.PlaneGeometry(1560, 2280), new THREE.MeshLambertMaterial({ map: noiseTex('#5d7038', '#3f5226') }));
  land.material.map.repeat.set(80, 118); land.rotation.x = -Math.PI / 2; land.position.set(0, -0.02, -100); land.receiveShadow = true; scene.add(land);
  const beachMat = new THREE.MeshLambertMaterial({ map: noiseTex('#dcc794', '#c2ab72') });
  beachMat.map.repeat.set(30, 3);
  for (const [bx, bw] of [[465, 630], [-555, 450]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, 64), beachMat);
    b.rotation.x = -Math.PI / 2; b.position.set(bx, 0.005, -1208); b.receiveShadow = true; scene.add(b);
  }
  // roads
  const asphaltMat = new THREE.MeshLambertMaterial({ map: noiseTex('#43484f', '#24272c') });
  asphaltMat.map.repeat.set(4, 40);
  for (const s of ROAD_SEGS) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const m = new THREE.Mesh(B(s.w, 0.04, len), asphaltMat);
    m.position.set((s.x0 + s.x1) / 2, 0.012, (s.z0 + s.z1) / 2);
    m.rotation.y = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
    m.receiveShadow = true; scene.add(m);
  }
  // markings: median roads get per-carriageway dashes + solid edge lines
  const dash = [];
  for (const s of ROAD_SEGS) {
    if (s.w < 24) continue;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), ux = (s.x1 - s.x0) / len, uz = (s.z1 - s.z0) / len;
    const ry = Math.atan2(s.x1 - s.x0, s.z1 - s.z0), px = -uz, pz = ux;
    const dashAt = off => { for (let t = 6; t < len - 4; t += 11) part(dash, B(0.22, 0.02, 3.8), s.x0 + ux * t + px * off, 0.035, s.z0 + uz * t + pz * off, 0xd8dce0, { ry }); };
    const edgeAt = off => part(dash, B(0.18, 0.02, len - 2), (s.x0 + s.x1) / 2 + px * off, 0.035, (s.z0 + s.z1) / 2 + pz * off, 0xd8dce0, { ry });
    if (isMedianRoad(s)) { const c = s.w >= 30 ? 10 : 7.3; dashAt(c); dashAt(-c); edgeAt(s.w / 2 - 0.7); edgeAt(-(s.w / 2 - 0.7)); }
    else dashAt(0);
  }
  scene.add(new THREE.Mesh(mergeParts(dash), vcMat));
  // planted medians: concrete curb + grass bed + a collider strip
  const med = [];
  for (const m of MEDIANS) {
    const len = Math.hypot(m.x1 - m.x0, m.z1 - m.z0), cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2;
    const ry = Math.atan2(m.x1 - m.x0, m.z1 - m.z0);
    part(med, B(3.2, 0.22, len), cx, 0.11, cz, 0x8d9299, { ry });
    part(med, B(2.7, 0.1, len), cx, 0.24, cz, 0x4e6b30, { ry });
    addCollider(cx, cz, m.x0 === m.x1 ? 3.2 : len, m.x0 === m.x1 ? len : 3.2);
  }
  const medMesh = new THREE.Mesh(mergeParts(med), vcMat); medMesh.receiveShadow = true; scene.add(medMesh);
  // sidewalks along the avenues and three arterials (gap at the roundabout)
  const swMat = new THREE.MeshLambertMaterial({ map: noiseTex('#8d9299', '#6d7278') });
  const sw = (w, d, x, z) => { const m = new THREE.Mesh(B(w, 0.14, d), swMat); m.position.set(x, 0.07, z); m.receiveShadow = true; scene.add(m); };
  for (const s of [-1, 1]) {
    sw(4.5, 880, s * 21.4, -440); sw(4.5, 840, s * 21.4, 480);
    sw(4, 1840, -400 + s * 18.2, -90);
    sw(4, 1890, 400 + s * 18.2, -65);
    sw(1340, 4, 0, -300 + s * 15.2); sw(632, 4, -354, 30 + s * 15.2); sw(632, 4, 354, 30 + s * 15.2); sw(1340, 4, 0, 760 + s * 15.2);
  }
  // Bundaran HI: a full asphalt ring road around the island, raised above the
  // crossing road boxes so it reads as one continuous circle, with markings
  const ring = new THREE.Mesh(new THREE.RingGeometry(16, 34, 44), asphaltMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.036, 30); ring.receiveShadow = true; scene.add(ring);
  const ringMark = [];
  for (const [ri, ro] of [[16.35, 17.05], [33.0, 33.7]]) {
    const g = new THREE.RingGeometry(ri, ro, 44); g.rotateX(-Math.PI / 2); g.translate(0, 0.042, 30);
    ringMark.push({ geo: g, x: 0, y: 0, z: 0, color: 0xd8dce0 });
  }
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    part(ringMark, B(0.22, 0.02, 3.4), Math.sin(a) * 25, 0.042, 30 + Math.cos(a) * 25, 0xd8dce0, { ry: a });
  }
  scene.add(new THREE.Mesh(mergeParts(ringMark), vcMat));
  const island = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.25, 44), new THREE.MeshLambertMaterial({ map: noiseTex('#7d8288', '#5c6165') }));
  island.position.set(0, 0.12, 30); island.receiveShadow = true; scene.add(island);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 0.22, 36), new THREE.MeshLambertMaterial({ color: 0x2e7fb8 }));
  pool.position.set(0, 0.3, 30); scene.add(pool);
  // the welcome monument in the fountain: two bronze figures, arms raised
  const mon = [];
  part(mon, new THREE.CylinderGeometry(2.4, 2.9, 1.1, 14), 0, 0.85, 30, 0xb8bec4);
  part(mon, B(0.62, 1.8, 0.42), -0.58, 2.3, 30, 0x8a6f4d);
  part(mon, B(0.62, 1.8, 0.42), 0.58, 2.3, 30, 0x8a6f4d);
  part(mon, new THREE.SphereGeometry(0.27, 8, 8), -0.58, 3.45, 30, 0x8a6f4d);
  part(mon, new THREE.SphereGeometry(0.27, 8, 8), 0.58, 3.45, 30, 0x8a6f4d);
  part(mon, B(0.16, 1.15, 0.16), -1.12, 3.0, 30, 0x8a6f4d, { rz: 0.55 });
  part(mon, B(0.16, 1.15, 0.16), 1.12, 3.0, 30, 0x8a6f4d, { rz: -0.55 });
  const monMesh = new THREE.Mesh(mergeParts(mon), vcMat); monMesh.castShadow = true; scene.add(monMesh);
  // island collider: a PLUS shape hugging the disc (a square's corners would
  // poke into the r25 traffic arc and trap circulating vehicles)
  addCollider(0, 30, 34, 24); addCollider(0, 30, 24, 34);
  // park lawns
  const parkMat = new THREE.MeshLambertMaterial({ map: noiseTex('#4e6b30', '#385122') });
  parkMat.map.repeat.set(30, 30);
  const monasPark = new THREE.Mesh(new THREE.PlaneGeometry(350, 310), parkMat);
  monasPark.rotation.x = -Math.PI / 2; monasPark.position.set(0, 0.02, -1030); monasPark.receiveShadow = true; scene.add(monasPark);
  const gbkPark = new THREE.Mesh(new THREE.PlaneGeometry(320, 250), parkMat);
  gbkPark.rotation.x = -Math.PI / 2; gbkPark.position.set(-330, 0.02, 620); gbkPark.receiveShadow = true; scene.add(gbkPark);
  // Ancol pier: timber deck out into the bay
  const pier = new THREE.Mesh(B(14, 0.5, 78), new THREE.MeshLambertMaterial({ map: noiseTex('#8a6f4d', '#6e573a') }));
  pier.position.set(PIER.x, 0.1, (PIER.z0 + PIER.z1) / 2); pier.receiveShadow = true; pier.castShadow = true; scene.add(pier);
}

// ---------------- vegetation + street furniture ----------------
// Guards (hard-won): nothing green stands on a road, and nothing at all
// stands within 38 m of the Bundaran HI centre — the ring road stays clean.
export const lampHeadPts = [];
function plantTrees(scene) {
  const parts = [];
  const palm = (x, z, onMedian = false) => {
    if (!onMedian && (nearRoundabout(x, z) || !clearOfRoads(x, z, 1.1, 0.4))) return;
    propPositions.push({ x, z, kind: 'palm' });
    const h = R(4.5, 6.5), lean = R(-0.06, 0.06);
    part(parts, B(0.34, h, 0.34), x, h / 2, z, 0x6e5136, { rz: lean });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + R(-0.2, 0.2);
      part(parts, B(0.18, 0.06, 2.6), x + Math.sin(a) * 1.2, h + 0.25, z + Math.cos(a) * 1.2, 0x3f7a34, { ry: a, rz: 0.35 });
    }
    addCollider(x, z, 0.9, 0.9);
  };
  const leafy = (x, z, s = 1) => {
    if (nearRoundabout(x, z) || !clearOfRoads(x, z, 1.2, 0.4)) return;
    propPositions.push({ x, z, kind: 'leafy' });
    part(parts, B(0.4, 2.6 * s, 0.4), x, 1.3 * s, z, 0x6e5136);
    part(parts, new THREE.SphereGeometry(2.1 * s, 8, 6), x, 4.0 * s, z, pick([0x4e7a30, 0x5d8a38, 0x3f6b2a]));
    part(parts, new THREE.SphereGeometry(1.5 * s, 8, 6), x + 1.1 * s, 3.5 * s, z + 0.5, 0x557f33);
    addCollider(x, z, 0.9, 0.9);
  };
  const lamp = (x, z) => {
    if (nearRoundabout(x, z)) return;
    propPositions.push({ x, z, kind: 'lamp' });
    part(parts, B(0.22, 5.6, 0.22), x, 2.8, z, 0x3c4148);
    lampHeadPts.push([x, 5.75, z]);
    let nearLane = false;
    for (const s of ROAD_SEGS) if (distToSeg(x, z, s) < s.w / 2 + 2) { nearLane = true; break; }
    if (!nearLane) addCollider(x, z, 0.6, 0.6);
  };
  // median planting: palms, a leafy tree every third
  for (const m of MEDIANS) {
    const len = Math.hypot(m.x1 - m.x0, m.z1 - m.z0), ux = (m.x1 - m.x0) / len, uz = (m.z1 - m.z0) / len;
    let i = 0;
    for (let t = 8; t < len - 6; t += 15, i++) {
      const tx = m.x0 + ux * t, tz = m.z0 + uz * t;
      if (i % 3 === 2) { // leafy on a median: plant without the road guard
        propPositions.push({ x: tx, z: tz, kind: 'leafy' });
        part(parts, B(0.36, 2.2, 0.36), tx, 1.1, tz, 0x6e5136);
        part(parts, new THREE.SphereGeometry(1.7, 8, 6), tx, 3.2, tz, 0x4e7a30);
      } else palm(tx, tz, true);
    }
  }
  // beach palms along the Ancol band and the west/east shores
  for (let x = -770; x <= 770; x += R(26, 44)) palm(x, -1196 + R(-8, 8));
  for (let z = -1100; z <= 950; z += R(60, 110)) { palm(-786, z); palm(786, z); }
  // park trees: Monas lawn and Senayan
  for (let i = 0; i < 46; i++) leafy(R(-165, 165), R(-1175, -885), R(0.9, 1.3));
  for (let i = 0; i < 30; i++) leafy(R(-480, -180), R(505, 735), R(0.9, 1.2));
  // scattered street trees on grass verges all over the island
  for (let i = 0; i < 260; i++) {
    const x = R(LAND.x0 + 10, LAND.x1 - 10), z = R(LAND.z0 + 10, LAND.z1 - 10);
    if (rnd() < 0.5) leafy(x, z, R(0.8, 1.15)); else palm(x, z);
  }
  // lamps along both edges of the big roads
  for (const s of ROAD_SEGS) {
    if (s.w < 24) continue;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), ux = (s.x1 - s.x0) / len, uz = (s.z1 - s.z0) / len;
    const px = -uz, pz = ux, off = s.w / 2 + 1.4;
    for (let t = 14; t < len - 8; t += 58) {
      lamp(s.x0 + ux * t + px * off, s.z0 + uz * t + pz * off);
      lamp(s.x0 + ux * (t + 29) - px * off, s.z0 + uz * (t + 29) - pz * off);
    }
  }
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat);
  mesh.castShadow = true; scene.add(mesh);
  // benches + bins on the main sidewalks
  const furn = [];
  for (let z = -840; z <= 860; z += 90) for (const sx of [-1, 1]) {
    if (nearRoundabout(sx * 22, z)) continue;
    part(furn, B(1.9, 0.12, 0.55), sx * 22, 0.5, z, 0x7a5c38);
    part(furn, B(1.9, 0.5, 0.12), sx * 22, 0.75, z - sx * 0.0, 0x7a5c38);
    addCollider(sx * 22, z, 1.9, 0.6);
    part(furn, B(0.55, 0.8, 0.55), sx * 22, 0.4, z + 14, 0x3f6b4f);
    addCollider(sx * 22, z + 14, 0.6, 0.6);
  }
  scene.add(new THREE.Mesh(mergeParts(furn), vcMat));
}

// ---------------- district buildings + shophouse rows ----------------
const FACADE_TINTS = [0xd8cfc0, 0xb8c4cc, 0x9fb4c8, 0xd0b8a0, 0xa8b8a0, 0xc8a8b8, 0x8fa3b8, 0xe0d8c8, 0xb0a090, 0x9fc0b8, 0xd8b890, 0xa0a8c0, 0xc4ccd4, 0x8a97a8];
function buildDistricts(scene) {
  const parts = [], roofs = [], glass = [];
  for (const zn of ZONES) {
    const step = zn.kind === 'tower' ? 34 : 26;
    for (let x = zn.x0 + step / 2; x < zn.x1; x += step) {
      for (let z = zn.z0 + step / 2; z < zn.z1; z += step) {
        if (rnd() > zn.density) continue;
        const jx = x + R(-5, 5), jz = z + R(-5, 5);
        const w = R(zn.sMin, zn.sMax), d = R(zn.sMin, zn.sMax), h = R(zn.hMin, zn.hMax);
        const rr = Math.hypot(w, d) / 2;
        if (!clearOfRoads(jx, jz, rr, 2) || protectedAt(jx, jz, rr)) continue;
        if (jx > PARKS[0].x0 - 6 && jx < PARKS[0].x1 + 6 && jz > PARKS[0].z0 - 6 && jz < PARKS[0].z1 + 6) continue;
        if (jx > PARKS[1].x0 - 6 && jx < PARKS[1].x1 + 6 && jz > PARKS[1].z0 - 6 && jz < PARKS[1].z1 + 6) continue;
        let inKampung = false;
        for (const k of KAMPUNGS) if (jx >= k.x0 - 10 && jx <= k.x1 + 10 && jz >= k.streets[0] - 20 && jz <= k.streets[k.streets.length - 1] + 20) inKampung = true;
        if (inKampung) continue;
        const tint = pick(FACADE_TINTS);
        part(parts, B(w, h, d), jx, h / 2, jz, tint);
        part(roofs, B(w + 0.4, 0.5, d + 0.4), jx, h + 0.25, jz, 0x3c4148);
        if (zn.kind === 'tower' || zn.kind === 'mall') {
          part(glass, B(w * 0.7, h * 0.5, 0.3), jx, h * 0.55, jz - d / 2 - 0.1, 0x2c4456);
          part(glass, B(w * 0.7, h * 0.5, 0.3), jx, h * 0.55, jz + d / 2 + 0.1, 0x2c4456);
          part(glass, B(0.3, h * 0.5, d * 0.7), jx - w / 2 - 0.1, h * 0.55, jz, 0x2c4456);
          part(glass, B(0.3, h * 0.5, d * 0.7), jx + w / 2 + 0.1, h * 0.55, jz, 0x2c4456);
        }
        if (zn.kind === 'house') part(roofs, B(w * 0.8, 1.6, d * 0.9), jx, h + 1.0, jz, 0x9c4a34);
        addCollider(jx, jz, w, d);
      }
    }
  }
  // shophouse (ruko) rows along the great avenue and the hospital row
  const rukoRow = (x0, z0, x1, z1, faceRy) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 15);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (protectedAt(x, z, 8) || nearRoundabout(x, z)) continue;
      const tint = pick(FACADE_TINTS);
      part(parts, B(12, 8, 10), x, 4, z, tint, { ry: faceRy });
      part(roofs, B(12.6, 0.4, 10.6), x, 8.2, z, pick([0x9c4a34, 0x3c4148, 0x5d6b78]), { ry: faceRy });
      part(glass, B(9, 2.6, 0.3), x, 1.6, z, 0x24313c, { ry: faceRy });
      addCollider(x, z, faceRy ? 10 : 12, faceRy ? 12 : 10);
    }
  };
  for (const sx of [-1, 1]) {
    rukoRow(sx * 27, -860, sx * 27, -70, 0);
    rukoRow(sx * 27, 130, sx * 27, 880, 0);
  }
  rukoRow(30, 258, 380, 258, Math.PI / 2); // behind the hospital row plots — sparse infill
  const m1 = new THREE.Mesh(mergeParts(parts), vcMat); m1.castShadow = true; m1.receiveShadow = true; scene.add(m1);
  scene.add(new THREE.Mesh(mergeParts(roofs), vcMat));
  const gm = new THREE.Mesh(mergeParts(glass), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x11181f }));
  scene.add(gm);
}

// ---------------- the landmark places ----------------
function placeBuilding(scene, parts, x, z, w, h, d, tint, ry = 0) {
  part(parts, B(w, h, d), x, h / 2, z, tint, { ry });
  addCollider(x, z, ry ? d : w, ry ? w : d);
}
function buildPlaces(scene) {
  const parts = [];
  const P = PLACES;
  // POLSEK — blue-white station block, flag pole, canopy
  placeBuilding(scene, parts, P.polsek.x, P.polsek.z, 22, 9, 12, 0xdde3ea);
  part(parts, B(22.4, 1.2, 12.4), P.polsek.x, 9.6, P.polsek.z, 0x1c3fa0);
  part(parts, B(0.18, 11, 0.18), P.polsek.x - 8, 5.5, P.polsek.z + 10, 0x8a8f98);
  part(parts, B(2.2, 1.4, 0.06), P.polsek.x - 6.9, 10.2, P.polsek.z + 10, 0xc23b2e);
  sign(scene, 'POLSEK', P.polsek.x, 6.5, P.polsek.z + 6.2, 0, 10, '#ffffff', '#1c3fa0');
  // RSUD hospital — white block, red cross, entrance canopy
  placeBuilding(scene, parts, P.rsud.x, P.rsud.z, 26, 13, 14, 0xf0f2f0);
  part(parts, B(4, 0.5, 6), P.rsud.x, 3.4, P.rsud.z - 9.5, 0xb8bec4);
  part(parts, B(0.5, 5, 0.5), P.rsud.x - 1.8, 1.7, P.rsud.z - 12, 0x8a8f98);
  part(parts, B(0.5, 5, 0.5), P.rsud.x + 1.8, 1.7, P.rsud.z - 12, 0x8a8f98);
  sign(scene, 'RSUD HOSPITAL', P.rsud.x, 10, P.rsud.z - 7.2, Math.PI, 13, '#c22e2e', '#f0f2f0');
  sign(scene, '+', P.rsud.x + 8, 10, P.rsud.z - 7.2, Math.PI, 2.4, '#c22e2e', '#f0f2f0');
  // STAR KARAOKE — magenta block on the same row
  placeBuilding(scene, parts, P.karaoke.x, P.karaoke.z, 20, 9, 14, 0x5a2a52);
  sign(scene, 'STAR KARAOKE', P.karaoke.x, 6.8, P.karaoke.z - 7.2, Math.PI, 12, '#ff5da2', '#2a1030');
  // GUN SHOP — dark block with a yellow sign
  placeBuilding(scene, parts, P.gunshop.x, P.gunshop.z, 14, 7, 10, 0x3a3f45);
  sign(scene, 'GUN SHOP', P.gunshop.x, 5.2, P.gunshop.z + 5.2, 0, 8, '#ffd23f', '#20242c');
  // BENGKEL — open workshop: slab, canopy on posts, tyre stacks, tool cabinet
  part(parts, B(24, 0.25, 18), P.bengkel.x, 0.12, P.bengkel.z, 0x9aa0a6);
  part(parts, B(24, 0.4, 18), P.bengkel.x, 6.4, P.bengkel.z, 0x707880);
  for (const [ox, oz] of [[-11, -8], [11, -8], [-11, 8], [11, 8]]) {
    part(parts, B(0.5, 6.4, 0.5), P.bengkel.x + ox, 3.2, P.bengkel.z + oz, 0x565c63);
    addCollider(P.bengkel.x + ox, P.bengkel.z + oz, 0.7, 0.7);
  }
  for (let i = 0; i < 3; i++) part(parts, new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12), P.bengkel.x - 8, 0.35 + i * 0.36, P.bengkel.z + 5, 0x1c1e22);
  part(parts, B(2.4, 1.6, 0.7), P.bengkel.x + 8.5, 0.8, P.bengkel.z - 6, 0xb03a2e);
  addCollider(P.bengkel.x + 8.5, P.bengkel.z - 6, 2.4, 0.7);
  sign(scene, 'BENGKEL — PAY N SPRAY', P.bengkel.x, 5.4, P.bengkel.z - 9.2, Math.PI, 14, '#7ae08a', '#20301f');
  // GRAND MOSQUE — white prayer hall, dome and minaret
  placeBuilding(scene, parts, P.masjid.x, P.masjid.z, 24, 8, 16, 0xeef0ea);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2f8a6b }));
  dome.position.set(P.masjid.x, 8, P.masjid.z); dome.castShadow = true; scene.add(dome);
  part(parts, B(2.2, 26, 2.2), P.masjid.x - 22, 13, P.masjid.z - 6, 0xeef0ea);
  part(parts, new THREE.ConeGeometry(1.9, 4, 10), P.masjid.x - 22, 28, P.masjid.z - 6, 0x2f8a6b);
  addCollider(P.masjid.x - 22, P.masjid.z - 6, 2.4, 2.4);
  sign(scene, 'GRAND MOSQUE', P.masjid.x, 6, P.masjid.z + 8.2, 0, 11, '#2f8a6b', '#eef0ea');
  // HOUSE FOR SALE — on its own plot east of the Menteng street grid
  placeBuilding(scene, parts, P.house.x, P.house.z, 11, 5.5, 9, 0xe8dcc8);
  part(parts, B(12, 1.8, 10), P.house.x, 6.4, P.house.z, 0x9c4a34);
  sign(scene, 'FOR SALE — Rp 300,000', P.house.x, 3.4, P.house.z - 4.7, Math.PI, 9, '#ffd23f', '#5a2e22');
  // RUMAH SINGGAH — the save house south of Monas
  placeBuilding(scene, parts, P.singgah.x, P.singgah.z, 12, 5, 10, 0xd8e2ee);
  part(parts, B(13, 1.6, 11), P.singgah.x, 5.8, P.singgah.z, 0x707880);
  sign(scene, 'SAVE POINT', P.singgah.x, 3.6, P.singgah.z + 5.2, 0, 8, '#7ae08a', '#20301f');
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat);
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  // Semanggi flyover: a raised deck where the diagonal crosses the avenue,
  // on four pillars — avenue traffic passes underneath
  const deck = new THREE.Group();
  const slab = new THREE.Mesh(B(17, 0.8, 96), new THREE.MeshLambertMaterial({ map: noiseTex('#43484f', '#24272c') }));
  slab.rotation.y = Math.atan2(430 - -680, 880 - -140);
  slab.position.set(0, 6.6, 485); slab.castShadow = true; deck.add(slab);
  const pil = [];
  for (const [ox, oz] of [[-14, 452], [14, 452], [-14, 518], [14, 518]]) {
    part(pil, B(1.6, 6.4, 1.6), ox, 3.2, oz, 0x8a8f98);
    addCollider(ox, oz, 1.8, 1.8);
  }
  const pilMesh = new THREE.Mesh(mergeParts(pil), vcMat); pilMesh.castShadow = true; deck.add(pilMesh);
  scene.add(deck);
}

// ---------------- Monas park + carnival, GBK stadium ----------------
function buildLandmarks(scene) {
  const parts = [];
  // the Monas monument: a tapered obelisk with a golden flame
  part(parts, B(14, 3, 14), 0, 1.5, -1030, 0xb8bec4);
  const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.4, 56, 4), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
  obelisk.position.set(0, 31, -1030); obelisk.rotation.y = Math.PI / 4; obelisk.castShadow = true; scene.add(obelisk);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.7, 4.4, 10), new THREE.MeshLambertMaterial({ color: 0xd8a51c, emissive: 0x6e5208 }));
  flame.position.set(0, 61, -1030); scene.add(flame);
  addCollider(0, -1030, 15, 15);
  // plaza paths + ring benches and park lamps
  part(parts, B(60, 0.06, 10), 0, 0.05, -960, 0xb0a894);
  part(parts, B(10, 0.06, 60), 0, 0.05, -990, 0xb0a894);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, bx = Math.sin(a) * 24, bz = -1030 + Math.cos(a) * 24;
    part(parts, B(2.2, 0.5, 0.7), bx, 0.45, bz, 0x7a5c38, { ry: a });
  }
  // carnival corner: ferris wheel, tents, stalls (wheel returned for animation)
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(11, 0.35, 8, 24), new THREE.MeshLambertMaterial({ color: 0xd94f6a }));
  wheel.add(rim);
  for (let i = 0; i < 6; i++) {
    const spoke = new THREE.Mesh(B(0.25, 21, 0.25), new THREE.MeshLambertMaterial({ color: 0xe8e8ec }));
    spoke.rotation.z = (i / 6) * Math.PI; wheel.add(spoke);
    const a = (i / 6) * Math.PI * 2;
    const cab = new THREE.Mesh(B(1.8, 1.6, 1.6), new THREE.MeshLambertMaterial({ color: pick([0xffd23f, 0x3dc8d9, 0xd93db0, 0x3dd97a]) }));
    cab.position.set(Math.sin(a) * 11, Math.cos(a) * 11, 0); wheel.add(cab);
  }
  wheel.position.set(-120, 12.5, -950); scene.add(wheel);
  ferrisWheel = wheel;
  part(parts, B(1.2, 12, 1.2), -126, 6, -950, 0x565c63); part(parts, B(1.2, 12, 1.2), -114, 6, -950, 0x565c63);
  addCollider(-120, -950, 14, 3);
  for (const [tx, tz, tc] of [[-90, -920, 0xd94f3d], [-70, -935, 0x3d7bd9], [-100, -895, 0xe8c832]]) {
    part(parts, new THREE.ConeGeometry(4.4, 3.4, 10), tx, 3.4, tz, tc);
    part(parts, B(6, 1.8, 5), tx, 0.9, tz, 0xe8e2d4);
    addCollider(tx, tz, 6, 5);
  }
  // GBK stadium: ring wall, stands, running track, pitch, goals, floodlights
  const gbk = { x: -330, z: 620 };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(58, 58, 13, 28, 1, true), new THREE.MeshLambertMaterial({ color: 0xc8ccd2, side: THREE.DoubleSide }));
  wall.position.set(gbk.x, 6.5, gbk.z); wall.castShadow = true; scene.add(wall);
  const roofRing = new THREE.Mesh(new THREE.RingGeometry(46, 60, 28), new THREE.MeshLambertMaterial({ color: 0x8a2f2f, side: THREE.DoubleSide }));
  roofRing.rotation.x = -Math.PI / 2; roofRing.position.set(gbk.x, 13.5, gbk.z); scene.add(roofRing);
  const track = new THREE.Mesh(new THREE.RingGeometry(30, 44, 28), new THREE.MeshLambertMaterial({ color: 0xa0522d }));
  track.rotation.x = -Math.PI / 2; track.position.set(gbk.x, 0.06, gbk.z); track.receiveShadow = true; scene.add(track);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(56, 36), new THREE.MeshLambertMaterial({ color: 0x4e8a34 }));
  pitch.rotation.x = -Math.PI / 2; pitch.rotation.z = 0.0; pitch.position.set(gbk.x, 0.08, gbk.z); pitch.receiveShadow = true; scene.add(pitch);
  part(parts, B(0.3, 2.4, 7), gbk.x - 26, 1.2, gbk.z, 0xe8e8ec); part(parts, B(0.3, 2.4, 7), gbk.x + 26, 1.2, gbk.z, 0xe8e8ec);
  for (const [fx, fz] of [[-52, -42], [52, -42], [-52, 42], [52, 42]]) {
    part(parts, B(0.8, 17, 0.8), gbk.x + fx, 8.5, gbk.z + fz, 0x565c63);
    part(parts, B(3.4, 1.6, 0.8), gbk.x + fx, 17.4, gbk.z + fz, 0xd8dce0);
  }
  // stadium wall colliders: a ring of blocks with a south gate gap
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.2 && Math.cos(a) > 0.9) continue; // south gate
    addCollider(gbk.x + Math.sin(a) * 58, gbk.z + Math.cos(a) * 58, 12, 12);
  }
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat);
  mesh.castShadow = true; scene.add(mesh);
  sign(scene, 'GBK STADIUM', gbk.x, 8, gbk.z + 59, 0, 15, '#ffffff', '#8a2f2f');
}

// ---------------- kampungs: dense little houses, stalls, sitters ----------------
function buildKampungs(scene) {
  const parts = [], roofs = [];
  const houseCols = [0xf2d8c9, 0xc9e2f2, 0xf2ecc9, 0xd8f2d0, 0xf2c9d8, 0xe8e0d0, 0xd0e8e0];
  for (const k of KAMPUNGS) {
    for (const sz of k.streets) {
      for (let x = k.x0 + 6; x < k.x1 - 4; x += R(10.5, 13)) {
        for (const side of [-1, 1]) {
          if (rnd() < 0.12) continue;
          const hz = sz + side * 8.2, w = R(6.5, 8.5), d = 6, h = R(3, 4.4);
          const tint = pick(houseCols);
          part(parts, B(w, h, d), x, h / 2, hz, tint);
          part(roofs, B(w + 0.7, 1.3, d + 0.8), x, h + 0.6, hz, pick([0x9c4a34, 0xb05a38, 0x707880]));
          addCollider(x, hz, w, d);
          if (rnd() < 0.15) kampungSpots.sitters.push({ x: x + R(-2, 2), z: hz - side * (d / 2 + 1.1), h: side > 0 ? Math.PI : 0 });
        }
      }
    }
    // warung stalls with a tarp roof
    const wz = k.streets[0] - 12;
    for (const wx of [k.x0 + 24, (k.x0 + k.x1) / 2]) {
      part(parts, B(4.6, 2.2, 3), wx, 1.1, wz, 0xa8763e);
      part(parts, B(5.4, 0.15, 3.8), wx, 2.6, wz, pick([0x3d7bd9, 0xd94f3d, 0x3dd97a]));
      addCollider(wx, wz, 4.6, 3);
      kampungSpots.sitters.push({ x: wx + 1.5, z: wz + 2.4, h: Math.PI });
      kampungSpots.sitters.push({ x: wx - 1.5, z: wz + 2.4, h: Math.PI });
    }
    // clotheslines across the gang lanes
    for (const lx of k.lanes) for (const lz of [k.streets[0] + 22, k.streets[k.streets.length - 1] - 22]) {
      part(parts, B(0.08, 0.08, 14), lx, 3.1, lz, 0xd8dce0, { ry: Math.PI / 2 });
      for (let i = 0; i < 4; i++) part(parts, B(1.1, 1.3, 0.06), lx - 4.5 + i * 3, 2.4, lz, pick([0xd94f3d, 0xe8e8e8, 0x3d7bd9, 0xe8c832]));
    }
  }
  // the enterable house: kampung barat, street 580 south row — its door
  kampungSpots.door = { x: -571, z: 577.8 };
  // taman warga (community garden) in the south cluster
  const partsT = [];
  part(partsT, B(16, 0.15, 12), -330, 0.07, 850, 0x557f33);
  for (const [gx, gz] of [[-336, 846], [-324, 846], [-336, 854], [-324, 854]]) part(partsT, B(0.4, 3, 0.4), gx, 1.5, gz, 0x7a5c38);
  part(partsT, B(9, 0.3, 7), -330, 3.1, 850, 0x9c4a34);
  for (const gx of [-336, -324]) for (const gz of [846, 854]) addCollider(gx, gz, 0.6, 0.6);
  part(partsT, B(2, 0.5, 0.6), -330, 0.45, 856, 0x7a5c38); addCollider(-330, 856, 2, 0.6);
  const m1 = new THREE.Mesh(mergeParts(parts), vcMat); m1.castShadow = true; scene.add(m1);
  scene.add(new THREE.Mesh(mergeParts(roofs), vcMat));
  scene.add(new THREE.Mesh(mergeParts(partsT), vcMat));
}

// ---------------- port, beach dressing, boats, ships ----------------
function buildPortBeach(scene) {
  const parts = [];
  part(parts, B(150, 0.15, 130), 610, 0.05, -1075, 0x8d9299); // concrete pad
  for (const [wx, wz] of [[570, -1040], [655, -1040]]) {
    part(parts, B(38, 11, 22), wx, 5.5, wz, 0x7a8894);
    part(parts, B(39, 0.5, 23), wx, 11.2, wz, 0x565c63);
    addCollider(wx, wz, 38, 22);
  }
  const contCols = [0xc23b2e, 0x2e5fc2, 0x2f9e5f, 0xe0a51c, 0x7a3fa0, 0xd96c2c];
  for (let i = 0; i < 26; i++) {
    const cx = R(548, 672), cz = R(-1128, -1022);
    if (Math.hypot(cx - 570, cz + 1040) < 26 || Math.hypot(cx - 655, cz + 1040) < 26) continue;
    const lvl = rnd() < 0.4 ? 2 : 1;
    for (let l = 0; l < lvl; l++) part(parts, B(6, 2.6, 2.4), cx, 1.3 + l * 2.6, cz, pick(contCols), { ry: rnd() < 0.5 ? 0 : Math.PI / 2 });
    addCollider(cx, cz, 6, 2.6);
  }
  for (const cx of [575, 630, 678]) { // cranes
    part(parts, B(1.4, 24, 1.4), cx, 12, -1110, 0xd96c2c);
    part(parts, B(1, 1, 26), cx, 23, -1098, 0xd96c2c);
    addCollider(cx, -1110, 1.8, 1.8);
  }
  // beach dressing: umbrellas, loungers, towels, a lifeguard tower
  for (let i = 0; i < 24; i++) {
    const ux = R(-740, 740), uz = R(-1232, -1190);
    part(parts, B(0.14, 2.2, 0.14), ux, 1.1, uz, 0xe8e2d4);
    part(parts, new THREE.ConeGeometry(1.9, 0.7, 8), ux, 2.3, uz, pick([0xd94f3d, 0x3dc8d9, 0xe8c832, 0xd93db0]));
    addCollider(ux, uz, 0.4, 0.4);
    part(parts, B(0.7, 0.25, 1.9), ux + R(-1.5, 1.5), 0.12, uz + R(1, 2.2), pick([0xe8e8e8, 0xd8cfc0]));
    if (i % 3 === 0) beachSpots.sitters.push({ x: ux + 1.2, z: uz + 1.4, h: Math.PI });
  }
  part(parts, B(2.6, 0.3, 2.6), -420, 3.4, -1210, 0xe8e2d4);
  for (const [lx, lz] of [[-421, -1211], [-419, -1211], [-421, -1209], [-419, -1209]]) part(parts, B(0.25, 3.4, 0.25), lx, 1.7, lz, 0xa8763e);
  addCollider(-420, -1210, 2.6, 2.6);
  // volleyball net + a beach soccer pitch outline
  part(parts, B(0.15, 2.2, 0.15), 120, 1.1, -1212, 0xe8e2d4); part(parts, B(0.15, 2.2, 0.15), 132, 1.1, -1212, 0xe8e2d4);
  part(parts, B(12, 1, 0.06), 126, 1.7, -1212, 0xf0f0f0);
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat);
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  // cargo ships offshore, decorative
  for (const [sx, sz, sr] of [[-500, -1420, 0.4], [420, -1480, -0.3]]) {
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(B(16, 6, 90), new THREE.MeshLambertMaterial({ color: 0x37424e }));
    hull.position.y = 1; ship.add(hull);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(B(12, 3, 12), new THREE.MeshLambertMaterial({ color: pick(contCols) }));
      c.position.set(0, 5.5, -32 + i * 13); ship.add(c);
    }
    const bridge = new THREE.Mesh(B(12, 9, 10), new THREE.MeshLambertMaterial({ color: 0xe8e8ec }));
    bridge.position.set(0, 8, 34); ship.add(bridge);
    ship.position.set(sx, 0, sz); ship.rotation.y = sr;
    scene.add(ship);
  }
}
// one sailable motor boat; returns its ref object (also pushed to boatRefs)
export function buildBoat(scene, x, z, h, color) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(B(2.4, 0.8, 5.6), new THREE.MeshLambertMaterial({ color }));
  hull.position.y = 0.35; hull.castShadow = true; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.8, 4), new THREE.MeshLambertMaterial({ color }));
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1, 1, 0.45); bow.position.set(0, 0.35, 3.4); g.add(bow);
  const bench = new THREE.Mesh(B(2, 0.25, 0.5), new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }));
  bench.position.set(0, 0.8, -0.6); g.add(bench);
  const motor = new THREE.Mesh(B(0.5, 0.8, 0.4), new THREE.MeshLambertMaterial({ color: 0x24272c }));
  motor.position.set(0, 0.7, -2.9); g.add(motor);
  g.position.set(x, 0, z); g.rotation.y = h;
  scene.add(g);
  const ref = { x, z, h, mesh: g, speed: 0 };
  boatRefs.push(ref);
  return ref;
}

// ---------------- interiors (teleport rooms floating east of the island) ----------------
function room(scene, cx, cz, w, d, wallCol, floorCol) {
  const parts = [];
  part(parts, B(w, 0.15, d), cx, 0.05, cz, floorCol);
  const h = 3.6;
  part(parts, B(w, h, 0.4), cx, h / 2, cz - d / 2, wallCol); // north
  part(parts, B(w, h, 0.4), cx, h / 2, cz + d / 2, wallCol); // south
  part(parts, B(0.4, h, d), cx + w / 2, h / 2, cz, wallCol); // east
  // west wall in two pieces, leaving a 2.2 m door gap in the middle
  part(parts, B(0.4, h, d / 2 - 1.1), cx - w / 2, h / 2, cz - (d / 4 + 0.55), wallCol);
  part(parts, B(0.4, h, d / 2 - 1.1), cx - w / 2, h / 2, cz + (d / 4 + 0.55), wallCol);
  part(parts, B(w + 1, 0.25, d + 1), cx, h + 0.1, cz, 0x2c2f34); // ceiling
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat);
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  addCollider(cx, cz - d / 2, w, 0.6); addCollider(cx, cz + d / 2, w, 0.6);
  addCollider(cx + w / 2, cz, 0.6, d);
  addCollider(cx - w / 2, cz - (d / 4 + 0.55), 0.6, d / 2 - 1.1);
  addCollider(cx - w / 2, cz + (d / 4 + 0.55), 0.6, d / 2 - 1.1);
  return { door: { x: cx - w / 2, z: cz } };
}
function buildInteriors(scene) {
  // STAR KARAOKE room: stage, dance floor, disco ball, bar
  const K = INTERIOR.karaoke;
  room(scene, K.x, K.z, 18, 14, 0x4a2440, 0x2c2430);
  const parts = [];
  part(parts, B(8, 0.5, 4), K.x, 0.3, K.z - 4.5, 0x5c3150); // stage
  part(parts, B(5, 0.06, 5), K.x, 0.14, K.z + 0.5, 0x8a2f6b); // dance floor
  part(parts, B(6, 1.1, 1), K.x + 5.5, 0.55, K.z + 5.5, 0x6e4a2f); // bar counter
  addCollider(K.x + 5.5, K.z + 5.5, 6, 1);
  addCollider(K.x, K.z - 4.5, 8, 4);
  for (const sx of [3.8, 5.5, 7.2]) { // bar stools in a row before the counter
    part(parts, new THREE.CylinderGeometry(0.32, 0.32, 0.75, 10), K.x + sx, 0.4, K.z + 4.2, 0xb03a6e);
  }
  const mesh = new THREE.Mesh(mergeParts(parts), vcMat); scene.add(mesh);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0xd8e2ee }));
  ball.position.set(K.x, 3, K.z + 0.5); scene.add(ball);
  karaokeRefs.ball = ball;
  const kLight = new THREE.PointLight(0xff5da2, 30, 22, 1.6);
  kLight.position.set(K.x, 2.8, K.z); scene.add(kLight);
  karaokeRefs.light = kLight;
  // kampung house room: bed, table, chairs, rug and the save glow
  const Rm = INTERIOR.rumah;
  room(scene, Rm.x, Rm.z, 12, 10, 0xd8cfc0, 0x8a6f4d);
  const parts2 = [];
  part(parts2, B(2.2, 0.6, 3.4), Rm.x + 3.6, 0.3, Rm.z - 2.4, 0x7a4a6e); // bed
  part(parts2, B(2.2, 0.25, 1), Rm.x + 3.6, 0.65, Rm.z - 3.8, 0xe8e2d4);
  addCollider(Rm.x + 3.6, Rm.z - 2.4, 2.2, 3.4);
  part(parts2, B(2.4, 0.12, 1.4), Rm.x - 1, 0.75, Rm.z + 1, 0x6e5136); // table
  part(parts2, B(0.18, 0.75, 0.18), Rm.x - 1.9, 0.37, Rm.z + 0.5, 0x6e5136);
  part(parts2, B(0.18, 0.75, 0.18), Rm.x - 0.1, 0.37, Rm.z + 1.5, 0x6e5136);
  part(parts2, B(4.5, 0.05, 3.2), Rm.x - 1, 0.14, Rm.z - 1, 0xa03a4a); // rug
  const mesh2 = new THREE.Mesh(mergeParts(parts2), vcMat); mesh2.castShadow = true; scene.add(mesh2);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.08, 18), new THREE.MeshBasicMaterial({ color: 0x37e08a, transparent: true, opacity: 0.55 }));
  glow.position.set(Rm.x - 3.4, 0.16, Rm.z + 2.6); scene.add(glow);
}

// ---------------- sky: clouds, sun, moon, stars ----------------
function buildSky(scene) {
  const group = new THREE.Group(); scene.add(group);
  // clouds: merged puffs, duplicated so the wrap is invisible
  const cparts = [];
  for (let i = 0; i < 30; i++) {
    const cx = R(-1500, 1500), cz = R(-1500, 1500), cy = R(120, 170), s = R(0.7, 1.6);
    const n = 3 + Math.floor(rnd() * 4);
    for (let j = 0; j < n; j++) part(cparts, B(R(26, 52) * s, R(4, 7), R(16, 30) * s), cx + R(-22, 22) * s, cy + R(-2.5, 2.5), cz + R(-12, 12) * s, 0xffffff);
  }
  const cloudGeo = mergeParts(cparts);
  const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
  const cloudsA = new THREE.Mesh(cloudGeo, cloudMat);
  const cloudsB = new THREE.Mesh(cloudGeo, cloudMat); cloudsB.position.x = -3000;
  group.add(cloudsA, cloudsB);
  // sun disc + halo, moon disc
  const sunTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,225,140,1)'); gr.addColorStop(0.35, 'rgba(255,205,100,0.85)'); gr.addColorStop(1, 'rgba(255,190,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  })();
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }));
  const moon = new THREE.Mesh(new THREE.CircleGeometry(42, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecf2, fog: false, depthWrite: false }));
  group.add(sun, moon);
  // stars on a dome
  const starPos = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const a = R(0, Math.PI * 2), e = Math.acos(R(0.02, 1));
    starPos[i * 3] = Math.sin(e) * Math.cos(a) * 1450;
    starPos[i * 3 + 1] = Math.cos(e) * 1450;
    starPos[i * 3 + 2] = Math.sin(e) * Math.sin(a) * 1450;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);
  let cloudX = 0;
  return {
    group,
    update(dt, camX, camZ, sunDir, dayF, gloom) {
      group.position.set(camX, 0, camZ);
      cloudX = (cloudX + dt * 1.3) % 3000;
      cloudsA.position.x = cloudX; cloudsB.position.x = cloudX - 3000;
      cloudMat.opacity = 0.35 + 0.57 * dayF;
      cloudMat.color.setScalar(0.45 + 0.55 * dayF).multiplyScalar(1 - gloom * 0.35);
      sun.position.set(sunDir.x * 1350, Math.max(sunDir.y, -0.2) * 1350, sunDir.z * 1350);
      sun.lookAt(camX, 0, camZ);
      sun.material.opacity = Math.max(0, Math.min(1, sunDir.y * 4 + 0.4));
      moon.position.set(-sunDir.x * 1350, Math.max(-sunDir.y, -0.2) * 1350, -sunDir.z * 1350);
      moon.lookAt(camX, 0, camZ);
      moon.material.opacity = 1;
      moon.visible = sunDir.y < 0.25;
      starMat.opacity = Math.max(0, -sunDir.y * 1.6) * (1 - gloom);
    },
  };
}

// lamp glow points (night): positions collected while planting
export const lampGlow = { points: null };
function buildLampGlow(scene) {
  if (!lampHeadPts.length) return;
  const pos = new Float32Array(lampHeadPts.length * 3);
  lampHeadPts.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // a soft radial sprite, so each lamp reads as a round glow, not a square
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g2 = cv.getContext('2d');
  const grad = g2.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,216,150,1)'); grad.addColorStop(0.4, 'rgba(255,192,110,0.5)'); grad.addColorStop(1, 'rgba(255,180,100,0)');
  g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
  const m = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), color: 0xffc37a, size: 8, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  lampGlow.points = new THREE.Points(g, m);
  scene.add(lampGlow.points);
}

// ---------------- build everything ----------------
export function buildWorld(scene) {
  buildGround(scene);
  plantTrees(scene);
  buildLampGlow(scene);
  buildDistricts(scene);
  buildPlaces(scene);
  buildLandmarks(scene);
  buildKampungs(scene);
  buildPortBeach(scene);
  buildInteriors(scene);
  // the two sailable boats from the layout table
  const cols = [0xe8e8ec, 0xd96c2c];
  BOATS.forEach((b, i) => buildBoat(scene, b.x, b.z, i === 0 ? Math.PI / 2 : 0, cols[i]));
  return buildSky(scene);
}
