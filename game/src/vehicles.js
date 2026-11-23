// vehicles.js — every vehicle is built from an extruded 2D side profile, so
// cars have real silhouettes (bonnet, glasshouse, boot) instead of being
// boxes on wheels. All names are fictional. One builder returns a THREE
// group plus the metadata the traffic and driving code needs.

import * as THREE from '../vendor/three.module.min.js';

export const PAINTS = [0xc23b2e, 0x2e5fc2, 0xe8e8ec, 0x1c1e22, 0x8a8f98, 0x2f9e5f, 0xe0a51c, 0x7a3fa0, 0xd96c2c, 0x3fa7a0, 0x903a4d, 0x4d6b2f, 0xb8b0a0, 0x274156, 0x6e2f28, 0xd8d3c8, 0x14524d, 0xf0ead8];
const glassMat = new THREE.MeshLambertMaterial({ color: 0x18242e });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });

// side profiles as [z, height] polylines, nose at +z; length/height in metres
const PROFILES = {
  vulcan:  { pts: [[-2.25, 0.35], [-2.3, 0.62], [-1.5, 0.7], [-0.6, 1.02], [0.5, 1.05], [1.4, 0.78], [2.2, 0.62], [2.32, 0.42], [2.3, 0.25], [-2.2, 0.22]], w: 1.94, name: 'Vulcan GT', top: 52, acc: 15, seats: 2 },
  falco:   { pts: [[-2.05, 0.32], [-2.1, 0.58], [-1.2, 0.66], [-0.4, 1.0], [0.7, 1.0], [1.5, 0.72], [2.05, 0.6], [2.15, 0.4], [2.1, 0.22], [-2.0, 0.2]], w: 1.84, name: 'Falco Rossa', top: 47, acc: 13, seats: 2 },
  sedan:   { pts: [[-2.2, 0.35], [-2.25, 0.68], [-1.3, 0.74], [-0.5, 1.08], [0.8, 1.08], [1.5, 0.8], [2.15, 0.7], [2.25, 0.45], [2.2, 0.25], [-2.15, 0.22]], w: 1.8, name: 'Kirana Sedan', top: 40, acc: 10, seats: 4 },
  hatch:   { pts: [[-1.8, 0.35], [-1.85, 0.72], [-1.1, 0.78], [-0.4, 1.1], [0.8, 1.1], [1.3, 0.82], [1.8, 0.72], [1.88, 0.45], [1.85, 0.25], [-1.75, 0.22]], w: 1.76, name: 'Pico Hatch', top: 37, acc: 10, seats: 4 },
  suv:     { pts: [[-2.3, 0.4], [-2.35, 0.85], [-1.4, 0.92], [-0.9, 1.32], [1.1, 1.32], [1.7, 0.95], [2.25, 0.85], [2.35, 0.5], [2.3, 0.28], [-2.25, 0.25]], w: 1.92, name: 'Gajah SUV', top: 38, acc: 9, seats: 5 },
  mpv:     { pts: [[-2.35, 0.38], [-2.4, 0.88], [-1.2, 0.95], [-0.6, 1.3], [1.3, 1.3], [1.9, 0.92], [2.3, 0.8], [2.4, 0.48], [2.35, 0.26], [-2.3, 0.24]], w: 1.86, name: 'Keluarga MPV', top: 36, acc: 8.5, seats: 6 },
  taxi:    { pts: [[-2.2, 0.35], [-2.25, 0.68], [-1.3, 0.74], [-0.5, 1.08], [0.8, 1.08], [1.5, 0.8], [2.15, 0.7], [2.25, 0.45], [2.2, 0.25], [-2.15, 0.22]], w: 1.8, name: 'Taksub Taxi', top: 40, acc: 10, seats: 4, taxi: true },
  angkot:  { pts: [[-2.5, 0.4], [-2.55, 1.0], [-2.2, 1.42], [1.6, 1.42], [2.2, 1.0], [2.5, 0.85], [2.55, 0.5], [2.5, 0.28], [-2.45, 0.25]], w: 1.9, name: 'Angkot Mikro', top: 30, acc: 7, seats: 8 },
  pickup:  { pts: [[-2.4, 0.38], [-2.45, 0.8], [-0.9, 0.85], [-0.4, 1.24], [1.0, 1.24], [1.6, 0.88], [2.35, 0.8], [2.45, 0.48], [2.4, 0.26], [-2.35, 0.24]], w: 1.88, name: 'Badak Pickup', top: 37, acc: 9, seats: 2 },
  bus:     { pts: [[-4.6, 0.45], [-4.7, 1.5], [-4.2, 2.2], [3.6, 2.2], [4.4, 1.5], [4.65, 1.1], [4.7, 0.55], [4.6, 0.3], [-4.55, 0.28]], w: 2.5, name: 'TransKota Bus', top: 30, acc: 6, seats: 20 },
  classic: { pts: [[-2.15, 0.35], [-2.2, 0.62], [-1.5, 0.68], [-0.7, 1.02], [0.5, 1.02], [1.2, 0.72], [2.3, 0.66], [2.45, 0.5], [2.4, 0.28], [-2.1, 0.24]], w: 1.78, name: 'Betawi Classic', top: 34, acc: 8, seats: 4 },
  kei:     { pts: [[-1.5, 0.32], [-1.55, 0.7], [-1.2, 1.05], [0.7, 1.05], [1.2, 0.75], [1.5, 0.62], [1.55, 0.4], [1.5, 0.22], [-1.45, 0.2]], w: 1.6, name: 'Kancil Kei', top: 32, acc: 9, seats: 4 },
};
export const CAR_KINDS = Object.keys(PROFILES);
export const TRAFFIC_KINDS = ['sedan', 'sedan', 'hatch', 'suv', 'mpv', 'taxi', 'angkot', 'pickup', 'kei', 'falco', 'classic', 'bus'];

function profileShape(pts) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  return sh;
}
function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function wheel(r, w, x, z) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), tyreMat);
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10), hubMat);
  hub.rotation.z = Math.PI / 2;
  g.add(tyre, hub); g.position.set(x, r, z);
  return g;
}

// build one vehicle; kind 'sportbike'/'scooter' build a bike with a rider
export function buildVehicle(kind, colorHex) {
  const g = new THREE.Group();
  const wheels = [];
  if (kind === 'sportbike' || kind === 'scooter') {
    const body = new THREE.MeshLambertMaterial({ color: colorHex });
    const r = kind === 'sportbike' ? 0.33 : 0.28;
    const wf = wheel(r, 0.09, 0, 0.95), wb = wheel(r, 0.09, 0, -0.95);
    wheels.push(wf, wb); g.add(wf, wb);
    const frame = box(0.16, 0.3, 1.3, 0, 0.55, 0, body); g.add(frame);
    const tank = box(0.3, 0.26, 0.7, 0, 0.78, 0.25, body); g.add(tank);
    const tail = box(0.24, 0.16, 0.6, 0, 0.82, -0.55, body); g.add(tail);
    const shield = box(0.34, 0.4, 0.06, 0, 1.0, 0.92, glassMat); shield.rotation.x = -0.3; g.add(shield);
    return { group: g, wheels, kind, name: kind === 'sportbike' ? 'Ninja-Style Sport Bike' : 'Bebek Scooter', top: kind === 'sportbike' ? 44 : 30, acc: kind === 'sportbike' ? 14 : 9, len: 2.1, wid: 0.7, bike: true, health: 100 };
  }
  const P = PROFILES[kind] || PROFILES.sedan;
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const geo = new THREE.ExtrudeGeometry(profileShape(P.pts), { depth: P.w - 0.36, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1, steps: 1 });
  geo.translate(0, 0, -(P.w - 0.36) / 2);
  const bodyMesh = new THREE.Mesh(geo, paint);
  bodyMesh.rotation.y = Math.PI / 2; // profile z becomes forward
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  // glasshouse: a tinted band following the cabin part of the profile
  const cabin = box(P.w - 0.3, 0.34, 1.7, 0, 1.02, -0.15, glassMat);
  if (kind === 'bus' || kind === 'angkot') { cabin.scale.set(1, 1.6, 3.4); cabin.position.set(0, 1.5, -0.2); }
  if (kind === 'vulcan' || kind === 'falco') { cabin.scale.set(0.9, 0.8, 0.9); cabin.position.y = 0.92; }
  g.add(cabin);
  // wheels at the profile's wheelbase
  const zs = kind === 'bus' ? [3.1, -3.1] : [1.45, -1.45];
  const wr = kind === 'bus' || kind === 'suv' || kind === 'pickup' ? 0.42 : 0.36;
  for (const sx of [-1, 1]) for (const zz of zs) {
    const wh = wheel(wr, 0.24, sx * (P.w / 2 - 0.1), zz);
    wheels.push(wh); g.add(wh);
  }
  // lights: pale front, red rear (emissive material swapped on at night by main)
  const fl = new THREE.MeshLambertMaterial({ color: 0xf5f2d8 });
  const rl = new THREE.MeshLambertMaterial({ color: 0xa01818 });
  const fz = Math.max(...P.pts.map(p => p[0])) - 0.05, rz = Math.min(...P.pts.map(p => p[0])) + 0.05;
  g.add(box(0.34, 0.12, 0.05, -P.w / 4, 0.62, fz, fl), box(0.34, 0.12, 0.05, P.w / 4, 0.62, fz, fl));
  g.add(box(0.34, 0.1, 0.05, -P.w / 4, 0.66, rz, rl), box(0.34, 0.1, 0.05, P.w / 4, 0.66, rz, rl));
  if (P.taxi) {
    const sign = box(0.7, 0.16, 0.3, 0, 1.32, 0.1, new THREE.MeshLambertMaterial({ color: 0xffd23f }));
    g.add(sign);
    const stripe = box(P.w + 0.02, 0.18, 3.6, 0, 0.5, 0, new THREE.MeshLambertMaterial({ color: 0x14524d }));
    g.add(stripe);
  }
  if (kind === 'bus') g.add(box(P.w + 0.02, 0.5, 7.6, 0, 1.05, 0, new THREE.MeshLambertMaterial({ color: 0xd96c2c })));
  return { group: g, wheels, kind, name: P.name, top: P.top, acc: P.acc, len: Math.abs(fz - rz), wid: P.w, bike: false, health: 100, paintMat: paint };
}

// a police livery version of the sedan with a light bar
export function buildPoliceCar() {
  const v = buildVehicle('sedan', 0xf0f2f4);
  const stripe = box(1.86, 0.3, 3.4, 0, 0.55, 0, new THREE.MeshLambertMaterial({ color: 0x1c3fa0 }));
  v.group.add(stripe);
  const bar = new THREE.Group();
  const bl = box(0.4, 0.12, 0.24, -0.3, 0, 0, new THREE.MeshBasicMaterial({ color: 0x2e6cff }));
  const br = box(0.4, 0.12, 0.24, 0.3, 0, 0, new THREE.MeshBasicMaterial({ color: 0xff3524 }));
  bar.add(bl, br); bar.position.set(0, 1.32, 0.1);
  v.group.add(bar);
  v.lightBar = bar; v.name = 'Police Interceptor';
  return v;
}
