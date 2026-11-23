// police.js — the wanted system: heat and stars, foot officers who deploy
// from patrol cars and shoot on foot, graph-routed pursuit cars, a
// roadblock at five stars and a helicopter with a searchlight at four.
// The SA rules live here too: an officer only busts you when you are
// knocked down and he reaches you; at 0 HP you are wasted, not busted.

import * as THREE from '../vendor/three.module.min.js';
import { makePerson, aimPose, walkPose, idlePose } from './people.js';
import { buildPoliceCar } from './vehicles.js';
import { makeWeaponMesh, tracer } from './weapons.js';
import { findPath, NODES, EDGES, nearestNode, laneOffset } from './layout.js';
import { collideCircle } from './world.js';

const OFFICER_MAX = 10;

export function createPolice(ctx) {
  const { scene, S } = ctx;
  const group = new THREE.Group(); scene.add(group);
  const officers = [], cars = [];
  let heli = null, heliLight = null, block = null;
  let seenT = 0, repathT = 0;

  S.heat = 0;
  const stars = () => Math.min(5, Math.ceil(S.heat / 60));
  function addHeat(n) {
    S.heat = Math.min(300, S.heat + n);
    S.wanted = stars();
  }
  function clearHeat() { S.heat = 0; S.wanted = 0; }

  // ---------- foot officers ----------
  function spawnOfficer(x, z) {
    if (officers.length >= OFFICER_MAX) return null;
    const p = makePerson({ police: true, head: 'bald' });
    p.g.position.set(x, 0, z);
    const gun = makeWeaponMesh('PISTOL');
    gun.position.set(0, -0.55, 0.25); gun.rotation.x = Math.PI / 2;
    p.armR.add(gun);
    group.add(p.g);
    const o = { p, x, z, h: 0, phase: Math.random() * 6, fireT: 1 + Math.random(), hp: 60, dead: false, deadT: 0 };
    officers.push(o);
    return o;
  }
  function officerTargets() {
    const w = S.wanted;
    return w <= 0 ? 0 : Math.min(OFFICER_MAX, w * 2);
  }

  // ---------- pursuit cars ----------
  function spawnCar(x, z) {
    const v = buildPoliceCar();
    v.group.position.set(x, 0, z);
    group.add(v.group);
    const c = { v, x, z, h: 0, speed: 0, path: null, pi: 0, deployed: false, hp: 220, dead: false, lx: x, lz: z };
    cars.push(c);
    return c;
  }
  function carTargets() { return S.wanted >= 2 ? Math.min(4, S.wanted - 1) : (S.wanted === 1 ? 1 : 0); }
  function routeTo(c, tx, tz) {
    const a = nearestNode(c.x, c.z), b = nearestNode(tx, tz);
    const nodes = findPath(a, b, e => (e.w < 8 ? 1000 : 1));
    if (!nodes || nodes.length < 2) { c.path = null; return; }
    c.path = nodes.map(id => ({ x: NODES[id].x, z: NODES[id].z }));
    c.pi = 1;
  }

  // ---------- helicopter ----------
  function ensureHeli() {
    if (heli) return;
    heli = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 6.5), new THREE.MeshLambertMaterial({ color: 0x27364f }));
    body.position.y = 0; heli.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 5.5), new THREE.MeshLambertMaterial({ color: 0x27364f }));
    tail.position.set(0, 0.4, -5.4); heli.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.08, 0.7), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    rotor.position.y = 1.5; rotor.name = 'rotor'; heli.add(rotor);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 3.6), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    skid.position.y = -1.4; heli.add(skid);
    heliLight = new THREE.SpotLight(0xfff2cc, 900, 160, 0.32, 0.5, 1.2);
    heli.add(heliLight); heli.add(heliLight.target);
    scene.add(heli);
  }

  // ---------- roadblock ----------
  function setBlock(px, pz, ph) {
    clearBlock();
    block = new THREE.Group();
    const bx = px + Math.sin(ph) * 65, bz = pz + Math.cos(ph) * 65;
    for (const s of [-1, 1]) {
      const v = buildPoliceCar();
      const ox = Math.cos(ph) * s * 4.5, oz = -Math.sin(ph) * s * 4.5;
      v.group.position.set(bx + ox, 0, bz + oz);
      v.group.rotation.y = ph + Math.PI / 2 + s * 0.35;
      block.add(v.group);
    }
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(9, 1, 0.5), new THREE.MeshLambertMaterial({ color: 0xd96c2c }));
    barrier.position.set(bx, 0.5, bz); barrier.rotation.y = ph;
    block.add(barrier);
    block.position.set(0, 0, 0);
    scene.add(block);
    block.userData = { x: bx, z: bz };
  }
  function clearBlock() { if (block) { scene.remove(block); block = null; } }

  // ---------- main update ----------
  function update(dt) {
    const pl = ctx.player();
    S.wanted = stars();
    // heat decay: fast when nobody has eyes on the player, slow otherwise
    let seen = false;
    for (const o of officers) if (!o.dead && Math.hypot(o.x - pl.x, o.z - pl.z) < 45) seen = true;
    for (const c of cars) if (Math.hypot(c.x - pl.x, c.z - pl.z) < 55) seen = true;
    if (heli && S.wanted >= 4) seen = true;
    seenT = seen ? 0 : seenT + dt;
    S.heat = Math.max(0, S.heat - dt * (seenT > 4 ? 3.2 : 0.3));
    if (S.wanted === 0 && S.heat <= 0) { /* fully clean */ }

    // --- officers: spawn near the player, despawn far away ---
    const wantO = officerTargets();
    let aliveO = officers.filter(o => !o.dead).length;
    if (aliveO < wantO && Math.random() < dt * 2) {
      const a = Math.random() * Math.PI * 2, d = 48 + Math.random() * 22;
      const sx = pl.x + Math.sin(a) * d, sz = pl.z + Math.cos(a) * d;
      const n = nearestNode(sx, sz);
      if (n >= 0) spawnOfficer(NODES[n].x, NODES[n].z);
    }
    for (let i = officers.length - 1; i >= 0; i--) {
      const o = officers[i];
      if (o.dead) {
        o.deadT += dt;
        if (o.deadT > 20) { group.remove(o.p.g); officers.splice(i, 1); }
        continue;
      }
      const dx = pl.x - o.x, dz = pl.z - o.z, dist = Math.hypot(dx, dz);
      if (dist > 150 && S.wanted <= 1) { group.remove(o.p.g); officers.splice(i, 1); continue; }
      if (S.wanted === 0) {
        // heat is gone: stand down — holster, idle, and melt away once the
        // player has put some distance between you
        idlePose(o.p, performance.now() / 1000 + o.phase);
        o.p.g.position.set(o.x, o.p.g.position.y, o.z);
        if (dist > 22) { group.remove(o.p.g); officers.splice(i, 1); }
        continue;
      }
      o.h = Math.atan2(dx, dz);
      if (pl.knocked && dist < 2.4) { ctx.onBusted(); continue; }
      if (dist > 24) {
        const sp = 5.4;
        o.x += Math.sin(o.h) * sp * dt; o.z += Math.cos(o.h) * sp * dt;
        [o.x, o.z] = collideCircle(o.x, o.z, 0.45);
        o.phase += dt * 11;
        walkPose(o.p, o.phase);
      } else {
        aimPose(o.p, 0);
        o.fireT -= dt;
        if (o.fireT <= 0 && !pl.knocked) {
          o.fireT = 0.85 + Math.random() * 0.6;
          const hitChance = Math.max(0.12, 0.55 - dist * 0.012);
          const from = { x: o.x, y: 1.35, z: o.z };
          const miss = Math.random() > hitChance;
          const to = { x: pl.x + (miss ? (Math.random() - 0.5) * 3 : 0), y: 1.1, z: pl.z + (miss ? (Math.random() - 0.5) * 3 : 0) };
          tracer(from, to);
          ctx.sfx('shot');
          if (!miss) ctx.damagePlayer(3 + Math.random() * 4);
        }
      }
      o.p.g.position.set(o.x, o.p.g.position.y, o.z);
      o.p.g.rotation.y = o.h;
    }

    // --- pursuit cars ---
    const wantC = carTargets();
    if (cars.length < wantC && Math.random() < dt * 1.5) {
      const a = Math.random() * Math.PI * 2;
      const n = nearestNode(pl.x + Math.sin(a) * 80, pl.z + Math.cos(a) * 80);
      if (n >= 0) { const c = spawnCar(NODES[n].x, NODES[n].z); routeTo(c, pl.x, pl.z); }
    }
    repathT -= dt;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      const dx = pl.x - c.x, dz = pl.z - c.z, dist = Math.hypot(dx, dz);
      if (dist > 220 && S.wanted <= 1) { group.remove(c.v.group); cars.splice(i, 1); continue; }
      if (S.wanted === 0) {
        // pursuit over: roll to a stop and leave once the player is clear
        c.speed = Math.max(0, c.speed - 12 * dt);
        c.x += Math.sin(c.h) * c.speed * dt;
        c.z += Math.cos(c.h) * c.speed * dt;
        c.v.group.position.set(c.x, 0, c.z);
        if (dist > 48) { group.remove(c.v.group); cars.splice(i, 1); }
        continue;
      }
      if (c.dead) { c.speed = 0; continue; }
      if (repathT <= 0) routeTo(c, pl.x, pl.z);
      let tx, tz, targetSpeed = 24;
      if (dist < 20) { tx = pl.x; tz = pl.z; targetSpeed = 17; }
      else if (c.path && c.pi < c.path.length) {
        const p = c.path[c.pi];
        tx = p.x; tz = p.z;
        if (Math.hypot(tx - c.x, tz - c.z) < 7) { c.pi++; }
      } else { tx = pl.x; tz = pl.z; }
      const want = Math.atan2(tx - c.x, tz - c.z);
      let dh = want - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.h += Math.max(-1.7 * dt, Math.min(1.7 * dt, dh));
      c.speed += Math.max(-14 * dt, Math.min(7 * dt, targetSpeed - c.speed));
      c.x += Math.sin(c.h) * c.speed * dt;
      c.z += Math.cos(c.h) * c.speed * dt;
      [c.x, c.z] = collideCircle(c.x, c.z, 1.5);
      c.v.group.position.set(c.x, 0, c.z);
      c.v.group.rotation.y = c.h;
      if (c.v.lightBar) {
        const t = performance.now() * 0.012;
        c.v.lightBar.children[0].material.color.setHex(Math.sin(t) > 0 ? 0x2e6cff : 0x0d2a66);
        c.v.lightBar.children[1].material.color.setHex(Math.sin(t) > 0 ? 0x661008 : 0xff3524);
      }
      // deploy officers when close to a player on foot
      if (!c.deployed && dist < 9 && !pl.inVehicle) {
        c.deployed = true;
        spawnOfficer(c.x + 2, c.z); spawnOfficer(c.x - 2, c.z + 1);
      }
      // ramming a player on foot hurts
      if (dist < 2.6 && !pl.inVehicle && Math.abs(c.speed) > 4) ctx.damagePlayer(6);
    }
    if (repathT <= 0) repathT = 2.2;

    // --- helicopter ---
    if (S.wanted >= 4) {
      ensureHeli();
      heli.visible = true;
      const t = performance.now() * 0.0004;
      const hx = pl.x + Math.sin(t) * 26, hz = pl.z + Math.cos(t) * 26;
      heli.position.set(hx, 36 + Math.sin(t * 3) * 2, hz);
      heli.rotation.y = Math.atan2(pl.x - hx, pl.z - hz);
      const rotor = heli.getObjectByName('rotor');
      if (rotor) rotor.rotation.y += dt * 28;
      heliLight.position.set(0, -1, 0);
      heliLight.target.position.set(pl.x - hx, -36, pl.z - hz);
      ctx.sirenHeli(true);
    } else if (heli) { heli.visible = false; ctx.sirenHeli(false); }

    // --- roadblock at five stars ---
    if (S.wanted >= 5 && !block) setBlock(pl.x, pl.z, pl.heading || 0);
    if (block && (S.wanted < 5 || Math.hypot(block.userData.x - pl.x, block.userData.z - pl.z) > 170)) clearBlock();

    // siren ambience while any pursuit car is near
    ctx.siren(cars.some(c => Math.hypot(c.x - pl.x, c.z - pl.z) < 70));
  }

  return { update, addHeat, clearHeat, officers, cars, spawnOfficer, spawnCar };
}
