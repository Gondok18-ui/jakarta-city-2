// people.js — capsule people built from primitives: a rounded body, a head
// with a hair/cap/peci/hijab/helmet variant, and swinging arms and legs
// pivoted at the hip (local y 0.86) and shoulder. Poses are plain functions
// of a phase value, so walkers, sitters, drivers and gunmen all share them.

import * as THREE from '../vendor/three.module.min.js';

const SKIN = [0xf2c79b, 0xd9a066, 0xb97a4a, 0x8d5a33, 0x6e4423];
const SHIRTS = [0xd94f3d, 0x3d7bd9, 0x3dd97a, 0xe8c832, 0xe8e8e8, 0x2b2b30, 0xd93db0, 0x3dc8d9, 0x8a5fd9, 0xd97a3d, 0x5f7a3a, 0xa03232];
const PANTS = [0x2b3450, 0x3a3a3e, 0x5a4632, 0x243028, 0x6e2f28, 0x384858];
const HEADS = ['hair', 'cap', 'peci', 'hijab', 'helmet', 'bald'];

const R = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function limb(w, len, mat) {
  const geo = new THREE.CapsuleGeometry(w, len, 3, 8);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// makePerson({skin, shirt, pants, head, police}) → { g, legL, legR, armL, armR, headG }
export function makePerson(o = {}) {
  const skin = new THREE.MeshLambertMaterial({ color: o.skin ?? pick(SKIN) });
  const shirt = new THREE.MeshLambertMaterial({ color: o.police ? 0x27364f : (o.shirt ?? pick(SHIRTS)) });
  const pants = new THREE.MeshLambertMaterial({ color: o.police ? 0x1d2739 : (o.pants ?? pick(PANTS)) });
  const g = new THREE.Group();
  // legs, pivoted at the hip
  const legL = limb(0.085, 0.62, pants); legL.position.set(-0.13, 0.86, 0);
  const legR = limb(0.085, 0.62, pants); legR.position.set(0.13, 0.86, 0);
  // torso: a capsule worn like a shirt
  const torsoGeo = new THREE.CapsuleGeometry(0.21, 0.42, 4, 10);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.y = 1.14; torso.castShadow = true;
  // arms, pivoted at the shoulder
  const armL = limb(0.065, 0.52, shirt); armL.position.set(-0.3, 1.38, 0);
  const armR = limb(0.065, 0.52, shirt); armR.position.set(0.3, 1.38, 0);
  // head group at neck height
  const headG = new THREE.Group(); headG.position.y = 1.58;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), skin);
  head.position.y = 0.1; head.castShadow = true;
  headG.add(head);
  const style = o.head ?? pick(HEADS);
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d1a17 });
  if (style === 'hair') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.162, 12, 8, 0, Math.PI * 2, 0, 1.25), new THREE.MeshLambertMaterial({ color: pick([0x1d1a17, 0x33241a, 0x4a3220, 0x777777]) }));
    hair.position.y = 0.115; headG.add(hair);
  } else if (style === 'cap') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.17, 0.09, 12), new THREE.MeshLambertMaterial({ color: pick([0xc23b2e, 0x2e5fc2, 0xe0a51c, 0x2f9e5f]) }));
    cap.position.y = 0.22; headG.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), cap.material);
    brim.position.set(0, 0.19, 0.2); headG.add(brim);
  } else if (style === 'peci') {
    const peci = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.158, 0.13, 12), dark);
    peci.position.y = 0.23; headG.add(peci);
  } else if (style === 'hijab') {
    const cloth = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 10), new THREE.MeshLambertMaterial({ color: pick([0xd96cae, 0x7a9fd9, 0xe8e0d0, 0x9fd97a, 0xd9b03d]) }));
    cloth.position.y = 0.09; cloth.scale.set(1, 1.12, 1); headG.add(cloth);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.128, 10, 8), skin);
    face.position.set(0, 0.09, 0.075); headG.add(face);
  } else if (style === 'helmet') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 9, 0, Math.PI * 2, 0, 1.7), new THREE.MeshLambertMaterial({ color: pick([0xe8e8ec, 0xc23b2e, 0x2e5fc2, 0x1c1e22]) }));
    helm.position.y = 0.11; headG.add(helm);
  }
  if (o.police) {
    const capP = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.17, 0.08, 12), new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
    capP.position.y = 0.225; headG.add(capP);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.02), new THREE.MeshLambertMaterial({ color: 0xd8b83d }));
    badge.position.set(-0.1, 1.22, 0.21); g.add(badge);
  }
  g.add(legL, legR, torso, armL, armR, headG);
  return { g, legL, legR, armL, armR, headG, torso };
}

// walking swing: phase advances with distance travelled
export function walkPose(p, phase, amp = 1) {
  const s = Math.sin(phase) * 0.55 * amp, c = Math.sin(phase + Math.PI) * 0.55 * amp;
  p.legL.rotation.x = s; p.legR.rotation.x = c;
  p.armL.rotation.x = c * 0.8; p.armR.rotation.x = s * 0.8;
  p.armL.rotation.z = 0.08; p.armR.rotation.z = -0.08;
  p.g.position.y = Math.abs(Math.sin(phase)) * 0.045 * amp;
}
export function idlePose(p, t = 0) {
  p.legL.rotation.x = 0; p.legR.rotation.x = 0;
  p.armL.rotation.x = Math.sin(t * 1.4) * 0.05; p.armR.rotation.x = -Math.sin(t * 1.4) * 0.05;
  p.armL.rotation.z = 0.1; p.armR.rotation.z = -0.1;
  p.g.position.y = 0;
}
// seated: hips at bench height, thighs forward, shins down
export function sitPose(p) {
  p.legL.rotation.x = -1.5; p.legR.rotation.x = -1.5;
  p.armL.rotation.x = -0.5; p.armR.rotation.x = -0.5;
  p.armL.rotation.z = 0.15; p.armR.rotation.z = -0.15;
  p.g.position.y = -0.42;
}
// driving: arms forward to the wheel, legs bent
export function drivePose(p) {
  p.legL.rotation.x = -1.1; p.legR.rotation.x = -0.9;
  p.armL.rotation.x = -0.95; p.armR.rotation.x = -0.95;
  p.armL.rotation.z = 0.25; p.armR.rotation.z = -0.25;
  p.g.position.y = -0.5;
}
// aiming a gun with the right arm, left arm supporting
export function aimPose(p, pitch = 0) {
  p.armR.rotation.x = -Math.PI / 2 + pitch; p.armR.rotation.z = 0;
  p.armL.rotation.x = -Math.PI / 2 + pitch + 0.25; p.armL.rotation.z = 0.35;
  p.legL.rotation.x = 0.12; p.legR.rotation.x = -0.12;
}
// knocked down: lying flat on the back
export function downPose(p) {
  p.g.rotation.x = -Math.PI / 2;
  p.g.position.y = 0.16;
  p.legL.rotation.x = 0.15; p.legR.rotation.x = -0.1;
  p.armL.rotation.z = 0.9; p.armR.rotation.z = -0.9;
}
export function upPose(p) { p.g.rotation.x = 0; p.g.position.y = 0; }
