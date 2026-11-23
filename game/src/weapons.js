// weapons.js — the six-slot arsenal: stats, prices, view models, hitscan
// fire with tracers and muzzle flash, and melee swings. Fists and the
// machete are silent; gunfire is what draws police attention.

import * as THREE from '../vendor/three.module.min.js';

export const WEAPONS = {
  FISTS:          { dmg: 12, range: 1.9, rate: 0.38, melee: true },
  MACHETE:        { dmg: 30, range: 2.3, rate: 0.45, melee: true, price: 75000 },
  PISTOL:         { dmg: 34, range: 95, rate: 0.34, spread: 0.012, price: 150000, ammoPrice: 2000, mag: 12 },
  SMG:            { dmg: 20, range: 80, rate: 0.11, spread: 0.03, auto: true, price: 400000, ammoPrice: 3500, mag: 30 },
  'PUMP SHOTGUN': { dmg: 13, range: 42, rate: 0.95, spread: 0.05, pellets: 6, price: 650000, ammoPrice: 5000, mag: 6 },
  RIFLE:          { dmg: 55, range: 160, rate: 0.55, spread: 0.004, price: 1200000, ammoPrice: 6000, mag: 20 },
};

const darkMetal = new THREE.MeshLambertMaterial({ color: 0x24272c });
const gripMat = new THREE.MeshLambertMaterial({ color: 0x4a3220 });
const bladeMat = new THREE.MeshLambertMaterial({ color: 0xb9c1c9 });

// a small view model for the player's right hand (null for fists)
export function makeWeaponMesh(slot) {
  const g = new THREE.Group();
  const b = (w, h, d, x, y, z, mat = darkMetal) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); g.add(m); return m;
  };
  if (slot === 'MACHETE') {
    b(0.05, 0.16, 0.3, 0, -0.05, 0.05, gripMat);
    const blade = b(0.015, 0.14, 0.62, 0, 0.02, 0.45, bladeMat);
    blade.rotation.x = 0.06;
  } else if (slot === 'PISTOL') {
    b(0.07, 0.11, 0.3, 0, -0.02, 0.1);
    b(0.06, 0.16, 0.09, 0, -0.12, 0.02, gripMat);
  } else if (slot === 'SMG') {
    b(0.08, 0.13, 0.52, 0, 0, 0.16);
    b(0.06, 0.2, 0.08, 0, -0.14, 0.12, gripMat);
    b(0.05, 0.22, 0.06, 0, -0.13, 0.3);
  } else if (slot === 'PUMP SHOTGUN') {
    b(0.09, 0.12, 0.85, 0, 0, 0.28);
    b(0.1, 0.1, 0.3, 0, -0.03, 0.42, gripMat);
    b(0.07, 0.18, 0.09, 0, -0.13, -0.08, gripMat);
  } else if (slot === 'RIFLE') {
    b(0.08, 0.12, 0.95, 0, 0.02, 0.32);
    b(0.06, 0.2, 0.08, 0, -0.13, 0.1, gripMat);
    b(0.07, 0.16, 0.34, 0, -0.04, -0.2, gripMat);
    b(0.04, 0.09, 0.2, 0, 0.12, 0.3);
  }
  return g;
}

// ---- transient effects: tracers + muzzle flashes, pooled ----
const tracers = [];
export function initFx(scene) {
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
    line.frustumCulled = false; scene.add(line);
    tracers.push({ line, life: 0 });
  }
}
export function tracer(from, to) {
  const t = tracers.find(t => t.life <= 0) || tracers[0];
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, from.x, from.y, from.z); p.setXYZ(1, to.x, to.y, to.z);
  p.needsUpdate = true;
  t.life = 0.06; t.line.material.opacity = 0.9;
}
export function updateFx(dt) {
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.material.opacity = 0; }
  }
}

// Hitscan: from origin along dir, find the closest target sphere hit.
// targets: [{x, y, z, r, ref}] — returns {target, point, dist} or null.
export function hitscan(origin, dir, range, targets) {
  let best = null, bestT = range;
  for (const t of targets) {
    const ox = t.x - origin.x, oy = t.y - origin.y, oz = t.z - origin.z;
    const along = ox * dir.x + oy * dir.y + oz * dir.z;
    if (along < 0 || along > bestT) continue;
    const px = origin.x + dir.x * along, py = origin.y + dir.y * along, pz = origin.z + dir.z * along;
    const d2 = (t.x - px) ** 2 + (t.y - py) ** 2 + (t.z - pz) ** 2;
    if (d2 < t.r * t.r) { bestT = along; best = { target: t, dist: along, point: { x: px, y: py, z: pz } }; }
  }
  return best;
}
export function spreadDir(dir, spread) {
  const d = new THREE.Vector3(
    dir.x + (Math.random() - 0.5) * 2 * spread,
    dir.y + (Math.random() - 0.5) * 2 * spread,
    dir.z + (Math.random() - 0.5) * 2 * spread,
  );
  return d.normalize();
}
