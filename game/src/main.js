// main.js — bootstrap and game loop for Jakarta City: renderer, input,
// the player on foot / in cars / in boats, graph-routed traffic with an
// anti-stuck watchdog, roaming pedestrians, combat, police wiring, place
// interactions, cheats, weather, day/night, saving, adaptive quality and
// the staged-screenshot hooks the screenshot script drives.

import * as THREE from '../vendor/three.module.min.js';
import {
  ROAD_SEGS, NODES, EDGES, PLACES, INTERIOR, SPAWN, BOATS, LAND,
  buildGraph, findPath, nearestNode, laneOffset, zoneName, roadWidthAt, distToSeg,
} from './layout.js';
import { S, WEAPON_SLOTS, fmtRp, saveGame, loadSave, applySave } from './state.js';
import { audioInit, sfx, engineSound, sirenSound } from './audio.js';
import {
  buildWorld, collideCircle, boatRefs, kampungSpots, beachSpots, karaokeRefs,
  animatedRefs, setSeed, lampGlow,
} from './world.js';
import { buildVehicle, TRAFFIC_KINDS, PAINTS } from './vehicles.js';
import { makePerson, walkPose, idlePose, sitPose, drivePose, aimPose, downPose, upPose } from './people.js';
import { WEAPONS, makeWeaponMesh, initFx, tracer, updateFx, hitscan, spreadDir } from './weapons.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
if (params.get('seed')) setSeed(parseInt(params.get('seed'), 10));

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3e8);
scene.fog = new THREE.Fog(0x9fd3e8, 150, 1500);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3200);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.camera.far = 500; sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x54603e, 0.85);
scene.add(hemi);

buildGraph();
const sky = buildWorld(scene);
initFx(scene);
const hud = createHud(S);

// ---------------- player ----------------
const player = makePerson({ shirt: 0x2e7ad9, pants: 0x2b2b30, head: 'cap' });
scene.add(player.g);
let weaponMesh = null;
function refreshWeaponMesh() {
  if (weaponMesh) { player.armR.remove(weaponMesh); weaponMesh = null; }
  if (S.weapon !== 'FISTS') {
    weaponMesh = makeWeaponMesh(S.weapon);
    weaponMesh.position.set(0, -0.58, 0.12);
    player.armR.add(weaponMesh);
  }
}
refreshWeaponMesh();
const pl = {
  h: 0, speed: 0, phase: 0, fireT: 0, swingT: 0, deadT: 0, stepT: 0,
  vehicle: null, boat: null, lastCar: null, returnPoint: null, shake: 0,
};
S.px = SPAWN.x; S.pz = SPAWN.z; pl.h = SPAWN.heading;
S.camYaw = pl.h + Math.PI; // camera starts behind the player

// ---------------- vehicles ----------------
const vehicles = [];
function addVehicle(kind, x, z, h, mode) {
  const color = PAINTS[Math.floor(Math.random() * PAINTS.length)];
  const v = buildVehicle(kind, color);
  v.group.position.set(x, 0, z); v.group.rotation.y = h;
  scene.add(v.group);
  const veh = {
    v, kind, x, z, h, speed: 0, mode, health: 100, dead: false, fireT: 0,
    path: null, pi: 0, lane: 0, driver: null, color,
    sx: x, sz: z, checkT: 0, stuck: 0, honkT: Math.random() * 8,
  };
  // most traffic cars get a visible driver (right-hand seat, as in Indonesia)
  if (mode === 'traffic' && !v.bike && Math.random() < 0.55) {
    const d = makePerson({});
    drivePose(d);
    d.g.position.set(0.38, 0.52, 0.15); d.g.rotation.y = 0;
    v.group.add(d.g);
    veh.driver = d;
  }
  vehicles.push(veh);
  return veh;
}
function lanePoint(a, b, off) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  const lx = dz / len, lz = -dx / len; // left-hand side of travel
  return { x: (a.x + b.x) / 2 + lx * off, z: (a.z + b.z) / 2 + lz * off, lx, lz, dx: dx / len, dz: dz / len };
}
function routeVehicle(veh, tx, tz) {
  const a = nearestNode(veh.x, veh.z), b = nearestNode(tx, tz);
  const nodes = findPath(a, b, e => (veh.v.bike ? 1 : (e.w < 8 ? 1000 : e.w < 12 ? 6 : 1)));
  if (!nodes || nodes.length < 2) { veh.path = null; return; }
  // choose a lane for each edge and build offset waypoints node by node
  const offs = laneOffset(24);
  veh.lane = Math.floor(Math.random() * 2);
  const pts = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const na = NODES[nodes[i]], nb = NODES[nodes[i + 1]];
    const e = EDGES.find(e2 => (e2.a === nodes[i] && e2.b === nodes[i + 1]) || (e2.b === nodes[i] && e2.a === nodes[i + 1]));
    const w = e ? e.w : 12;
    const lanes = laneOffset(w);
    const off = lanes[Math.min(veh.lane, lanes.length - 1)];
    const dx = nb.x - na.x, dz = nb.z - na.z, len = Math.hypot(dx, dz) || 1;
    const lx = dz / len, lz = -dx / len;
    if (i === 0) pts.push({ x: na.x + lx * off, z: na.z + lz * off });
    pts.push({ x: nb.x + lx * off, z: nb.z + lz * off });
  }
  // roundabout: replace a waypoint sitting on the circle centre with an arc
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Math.hypot(p.x - 0, p.z - 30) < 7 && i > 0 && i < pts.length - 1) {
      const prev = pts[i - 1], next = pts[i + 1];
      let a0 = Math.atan2(prev.x - 0, prev.z - 30);
      let a1 = Math.atan2(next.x - 0, next.z - 30);
      while (a1 > a0) a1 -= Math.PI * 2; // island stays on the driver's right
      const steps = Math.max(2, Math.ceil(Math.abs(a0 - a1) / 0.16));
      for (let sIdx = 1; sIdx < steps; sIdx++) {
        const a = a0 + (a1 - a0) * (sIdx / steps);
        out.push({ x: Math.sin(a) * 25, z: 30 + Math.cos(a) * 25 });
      }
      out.push(p);
    } else out.push(p);
  }
  veh.path = out; veh.pi = 1;
}
function randomTarget() {
  const n = NODES[Math.floor(Math.random() * NODES.length)];
  return { x: n.x, z: n.z };
}
function spawnTraffic() {
  const wide = EDGES.filter(e => e.w >= 12);
  for (let i = 0; i < 46; i++) {
    const e = wide[Math.floor(Math.random() * wide.length)];
    const a = NODES[e.a], b = NODES[e.b], t = Math.random();
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 25) continue;
    const kind = TRAFFIC_KINDS[Math.floor(Math.random() * TRAFFIC_KINDS.length)];
    const veh = addVehicle(kind, x, z, Math.atan2(b.x - a.x, b.z - a.z), 'traffic');
    const tgt = randomTarget();
    routeVehicle(veh, tgt.x, tgt.z);
  }
  for (let i = 0; i < 5; i++) { // bikes, some on the small streets
    const e = EDGES[Math.floor(Math.random() * EDGES.length)];
    const a = NODES[e.a], b = NODES[e.b], t = Math.random();
    const veh = addVehicle(Math.random() < 0.5 ? 'sportbike' : 'scooter', a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0, 'traffic');
    const d = makePerson({ head: 'helmet' });
    drivePose(d); d.g.position.set(0, 0.62, -0.1);
    veh.v.group.add(d.g); veh.driver = d;
    const tgt = randomTarget();
    routeVehicle(veh, tgt.x, tgt.z);
  }
  // parked, stealable cars on the wide roads
  const parkEdges = EDGES.filter(e => e.w >= 24);
  for (let i = 0; i < 16; i++) {
    const e = parkEdges[Math.floor(Math.random() * parkEdges.length)];
    const a = NODES[e.a], b = NODES[e.b], t = 0.2 + Math.random() * 0.6;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const off = e.w / 2 - 0.4, side = Math.random() < 0.5 ? 1 : -1;
    const x = a.x + dx * t + (dz / len) * off * side, z = a.z + dz * t + (-dx / len) * off * side;
    if (Math.hypot(x, z - 30) < 40 && Math.abs(x) < 40) continue;
    addVehicle(TRAFFIC_KINDS[Math.floor(Math.random() * TRAFFIC_KINDS.length)], x, z, Math.atan2(dx, dz), 'parked');
  }
}
// the player's starter Falco at the spawn
const starterCar = addVehicle('falco', SPAWN.carX, SPAWN.carZ, SPAWN.carH, 'parked');
pl.lastCar = starterCar;

// ---------------- pedestrians ----------------
const peds = [];
function addPed(x, z, opts = {}) {
  const p = makePerson(opts);
  p.g.position.set(x, 0, z);
  scene.add(p.g);
  const ped = {
    p, x, z, h: Math.random() * 6.28, phase: Math.random() * 6, speed: 1.1 + Math.random() * 0.5,
    path: null, pi: 0, state: opts.state || 'walk', t: Math.random() * 5, hp: 40, downT: 0,
  };
  peds.push(ped);
  return ped;
}
function routePed(ped) {
  const a = nearestNode(ped.x, ped.z);
  const tgt = randomTarget();
  const b = nearestNode(tgt.x, tgt.z);
  const nodes = findPath(a, b);
  if (!nodes || nodes.length < 2) { ped.path = null; return; }
  const pts = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const na = NODES[nodes[i]], nb = NODES[nodes[i + 1]];
    const e = EDGES.find(e2 => (e2.a === nodes[i] && e2.b === nodes[i + 1]) || (e2.b === nodes[i] && e2.a === nodes[i + 1]));
    const w = e ? e.w : 10;
    const off = w / 2 + 1.7;
    const dx = nb.x - na.x, dz = nb.z - na.z, len = Math.hypot(dx, dz) || 1;
    const lx = dz / len, lz = -dx / len, side = ped.side || (ped.side = Math.random() < 0.5 ? 1 : -1);
    if (i === 0) pts.push({ x: na.x + lx * off * side, z: na.z + lz * off * side });
    pts.push({ x: nb.x + lx * off * side, z: nb.z + lz * off * side });
  }
  ped.path = pts; ped.pi = 1;
}
function spawnPeds() {
  for (let i = 0; i < 96; i++) {
    const n = NODES[Math.floor(Math.random() * NODES.length)];
    const ped = addPed(n.x + (Math.random() - 0.5) * 8, n.z + (Math.random() - 0.5) * 8);
    routePed(ped);
  }
  for (const s of kampungSpots.sitters) { const ped = addPed(s.x, s.z, { state: 'sit' }); sitPose(ped.p); ped.p.g.rotation.y = s.h; ped.h = s.h; }
  for (const s of beachSpots.sitters) { const ped = addPed(s.x, s.z, { state: 'sit' }); sitPose(ped.p); ped.p.g.rotation.y = s.h; ped.h = s.h; }
  // pairs strolling the Monas plaza and the beach
  for (let i = 0; i < 8; i++) addPed((Math.random() - 0.5) * 120, -1030 + (Math.random() - 0.5) * 160);
}
spawnTraffic();
spawnPeds();

// ---------------- police + missions wiring ----------------
const police = createPolice({
  scene, S,
  player: () => ({ x: S.px, z: S.pz, inVehicle: !!pl.vehicle, knocked: S.knocked, heading: pl.h }),
  damagePlayer: (n) => damagePlayer(n),
  onBusted: () => doBusted(),
  sfx: (name) => { if (sfx[name]) sfx[name](); },
  siren: (on) => sirenSound(on && S.started && !S.knocked),
  sirenHeli: (on) => { /* heli rotor is visual; siren handled by cars */ },
});
const missions = createMissions({
  scene, S,
  toast: (m) => hud.toast(m),
  banner: (t, s) => hud.banner(t, s),
  dialog: (lines, cb) => hud.dialog(lines, cb),
  playerPos: () => ({ x: S.px, z: S.pz }),
  addHeat: (n) => police.addHeat(n),
  sfx: (name) => { if (sfx[name]) sfx[name](); },
});

// ---------------- input ----------------
const keys = {};
let mouseDown = false, firing = false, camDrag = null;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!S.started) return;
  if (e.code === 'KeyM') hud.toggleMap();
  if (e.code === 'KeyE' || e.code === 'Enter') interact();
  if (e.code === 'KeyR') cycleRadio();
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 6) selectWeapon(n - 1);
  }
  cheatFeed(e.key);
});
addEventListener('keyup', e => { keys[e.code] = false; });
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', e => {
  audioInit();
  if (!S.started || hud.dialogOpen() || hud.isMapOpen() || shopOpen) return;
  if (e.pointerType === 'mouse' && e.button === 0 && !isTouch) { firing = true; mouseDown = true; }
  camDrag = { x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', e => {
  if (camDrag && (mouseDown || e.pointerType !== 'mouse' || e.buttons > 0)) {
    S.camYaw -= (e.clientX - camDrag.x) * 0.005;
    S.camPitch = Math.max(-0.15, Math.min(0.9, S.camPitch + (e.clientY - camDrag.y) * 0.004));
    camDrag = { x: e.clientX, y: e.clientY };
  }
});
addEventListener('pointerup', () => { firing = false; mouseDown = false; camDrag = null; });
addEventListener('wheel', e => { S.camDist = Math.max(5, Math.min(18, S.camDist + e.deltaY * 0.01)); }, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// touch controls: left stick + buttons (wired in index.html)
const touchMove = { x: 0, y: 0 };
let touchFire = false, touchRun = false;
function bindTouch() {
  if (!isTouch) return;
  $('touch').style.display = 'block';
  const stick = $('stick'), knob = $('knob');
  let sid = null;
  stick.addEventListener('touchstart', e => { sid = e.changedTouches[0].identifier; }, { passive: true });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === sid) {
      const r = stick.getBoundingClientRect();
      let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      touchMove.x = dx; touchMove.y = dy;
      knob.style.transform = `translate(${dx * 26}px, ${dy * 26}px)`;
    }
  }, { passive: true });
  const endStick = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; touchMove.x = 0; touchMove.y = 0; knob.style.transform = ''; } };
  addEventListener('touchend', endStick); addEventListener('touchcancel', endStick);
  const btn = (id, down, up) => {
    const b = $(id);
    b.addEventListener('touchstart', e => { e.preventDefault(); audioInit(); down(); }, { passive: false });
    if (up) b.addEventListener('touchend', e => { e.preventDefault(); up(); }, { passive: false });
  };
  btn('btn-act', () => interact());
  btn('btn-fire', () => { touchFire = true; }, () => { touchFire = false; });
  btn('btn-run', () => { touchRun = !touchRun; $('btn-run').classList.toggle('on', touchRun); });
  btn('btn-map', () => hud.toggleMap());
  btn('btn-cheat', () => { $('cheatrow').style.display = $('cheatrow').style.display === 'flex' ? 'none' : 'flex'; });
}
function applyCheatInput() {
  const v = $('cheattext').value.trim().toUpperCase();
  $('cheattext').value = '';
  $('cheatrow').style.display = 'none';
  if (v) runCheat(v);
}

// ---------------- weapons ----------------
function selectWeapon(i) {
  const slot = WEAPON_SLOTS[i];
  if (!slot || !S.owned[slot]) { if (slot) hud.toast(slot + ' — not owned. Visit the GUN SHOP'); return; }
  S.weapon = slot;
  refreshWeaponMesh();
  sfx.uiClick();
}
function combatTargets() {
  const list = [];
  for (const o of police.officers) if (!o.dead) list.push({ x: o.x, y: 1.15, z: o.z, r: 0.62, kind: 'officer', ref: o });
  for (const p of peds) if (p.state !== 'down') list.push({ x: p.x, y: 1.1, z: p.z, r: 0.55, kind: 'ped', ref: p });
  for (const v of vehicles) if (!v.dead) list.push({ x: v.x, y: 0.9, z: v.z, r: Math.max(1.3, v.v.len / 2), kind: 'car', ref: v });
  for (const c of police.cars) if (!c.dead) list.push({ x: c.x, y: 0.9, z: c.z, r: 2.2, kind: 'copcar', ref: c });
  return list;
}
function hurtPed(ped, dmg, crimeHeat) {
  ped.hp -= dmg;
  if (crimeHeat) police.addHeat(crimeHeat);
  if (ped.hp <= 0 && ped.state !== 'down') {
    ped.state = 'down'; ped.downT = 14;
    downPose(ped.p);
    if (crimeHeat) police.addHeat(25);
  } else if (ped.state !== 'down') { ped.state = 'flee'; ped.t = 3; ped.fleeX = S.px; ped.fleeZ = S.pz; }
}
function hurtVehicle(veh, dmg) {
  veh.health -= dmg;
  if (veh.health <= 0 && !veh.dead) explodeVehicle(veh);
}
function explodeVehicle(veh) {
  if (veh.dead) return;
  veh.dead = true; veh.fireT = 0;
  sfx.explosion();
  pl.shake = Math.max(pl.shake, 0.5);
  police.addHeat(30);
  const d = Math.hypot(veh.x - S.px, veh.z - S.pz);
  if (pl.vehicle === veh) { damagePlayer(45); exitVehicle(true); }
  else if (d < 6 && !pl.vehicle) damagePlayer(26 * (1 - d / 7));
  for (const o of vehicles) {
    if (o !== veh && !o.dead && Math.hypot(o.x - veh.x, o.z - veh.z) < 6.5) {
      o.health = Math.min(o.health, 12); // chain: neighbours catch fire next
      o.fireT = -1.2;
    }
  }
  veh.v.group.traverse(m => { if (m.material && m.material.color) m.material = m.material.clone(); });
}
function playerShoot(dt) {
  pl.fireT -= dt;
  const w = WEAPONS[S.weapon];
  const wantFire = (firing || touchFire) && !pl.vehicle && !pl.boat && !S.knocked && !hud.dialogOpen();
  if (pl.swingT > 0) {
    pl.swingT -= dt;
    player.armR.rotation.x = -2.2 + Math.sin((0.28 - pl.swingT) / 0.28 * Math.PI) * 1.6;
    if (pl.swingT <= 0) player.armR.rotation.x = 0;
  }
  if (!wantFire || pl.fireT > 0) return;
  if (w.melee) {
    pl.fireT = w.rate; pl.swingT = 0.28;
    if (S.weapon === 'MACHETE') sfx.swing(); else sfx.swing();
    // arc in front of the player
    let hitAny = false;
    for (const t of combatTargets()) {
      const d = Math.hypot(t.x - S.px, t.z - S.pz);
      if (d > w.range + t.r) continue;
      const ang = Math.abs(((Math.atan2(t.x - S.px, t.z - S.pz) - pl.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ang > 1.1) continue;
      hitAny = true;
      if (t.kind === 'ped') hurtPed(t.ref, w.dmg, t.ref.state === 'down' ? 0 : 22);
      else if (t.kind === 'officer') { t.ref.hp -= w.dmg; police.addHeat(35); if (t.ref.hp <= 0) killOfficer(t.ref); }
      else hurtVehicle(t.ref, w.dmg * 0.4);
    }
    if (hitAny) sfx.punchHit();
    return; // a swing that hits nobody is not a crime — heat only lands on a hit
  }
  // guns
  if (S.ammo[S.weapon] <= 0) { pl.fireT = 0.3; sfx.dryFire(); hud.toast('No ammo — visit the GUN SHOP'); return; }
  pl.fireT = w.rate;
  S.ammo[S.weapon]--;
  sfx.shot();
  pl.shake = Math.max(pl.shake, S.weapon === 'PUMP SHOTGUN' || S.weapon === 'RIFLE' ? 0.16 : 0.06);
  const origin = { x: S.px, y: 1.45, z: S.pz };
  // shots travel along the camera's look direction, lifted a touch so the
  // crosshair centre-mass connects at street range
  const baseDir = new THREE.Vector3(-Math.sin(S.camYaw), -Math.sin(S.camPitch) + 0.07, -Math.cos(S.camYaw)).normalize();
  // face the shot
  pl.h = Math.atan2(baseDir.x, baseDir.z);
  const pellets = w.pellets || 1;
  const targets = combatTargets();
  let heard = false;
  for (let i = 0; i < pellets; i++) {
    const dir = spreadDir(baseDir, w.spread);
    const hit = hitscan(origin, dir, w.range, targets);
    const end = hit ? hit.point : { x: origin.x + dir.x * w.range, y: Math.max(0.2, origin.y + dir.y * w.range), z: origin.z + dir.z * w.range };
    tracer(origin, end);
    if (hit) {
      const t = hit.target;
      if (t.kind === 'ped') hurtPed(t.ref, w.dmg, 15);
      else if (t.kind === 'officer') { t.ref.hp -= w.dmg; police.addHeat(20); if (t.ref.hp <= 0) killOfficer(t.ref); }
      else if (t.kind === 'car') hurtVehicle(t.ref, w.dmg);
      else if (t.kind === 'copcar') { t.ref.hp -= w.dmg; police.addHeat(20); if (t.ref.hp <= 0) t.ref.dead = true; }
    }
  }
  for (const o of police.officers) if (Math.hypot(o.x - S.px, o.z - S.pz) < 75) heard = true;
  for (const c of police.cars) if (Math.hypot(c.x - S.px, c.z - S.pz) < 75) heard = true;
  police.addHeat(heard ? 7 : 2);
  // nearby peds panic
  for (const p of peds) if (p.state === 'walk' && Math.hypot(p.x - S.px, p.z - S.pz) < 16) { p.state = 'flee'; p.t = 2.5; p.fleeX = S.px; p.fleeZ = S.pz; }
}
function killOfficer(o) {
  o.dead = true; o.deadT = 0;
  downPose(o.p);
  police.addHeat(70);
}

// ---------------- player damage / busted / wasted ----------------
function damagePlayer(n) {
  if (S.knocked || !S.started) return;
  if (pl.vehicle) { hurtVehicle(pl.vehicle, n * 1.6); n *= 0.3; }
  const absorbed = Math.min(S.armor, n * 0.6);
  S.armor -= absorbed; n -= absorbed;
  S.health -= n;
  hud.damageFlash();
  sfx.hurt();
  if (S.health <= 0) {
    S.health = 0; S.knocked = true; pl.deadT = 0;
    if (pl.vehicle) exitVehicle(true);
    if (pl.boat) exitBoat(true);
    downPose(player);
    missions.failMission('You went down');
  }
}
function respawnAt(x, z, msg) {
  S.knocked = false; S.health = 100; S.armor = 0;
  upPose(player);
  S.px = x; S.pz = z; pl.h = 0; pl.vehicle = null; pl.boat = null;
  police.clearHeat();
  hud.hideEnd();
  hud.toast(msg);
  S.started = true;
}
function doBusted() {
  if (S.knocked && S._bustedDone) return;
  S._bustedDone = true;
  const fine = Math.min(S.money, 25000 * Math.max(1, S.wanted));
  S.money -= fine;
  hud.showEnd('BUSTED', 'Fine paid: Rp ' + fine.toLocaleString('en-US') + ' — released at the POLSEK');
  sfx.fail();
  setTimeout(() => { S._bustedDone = false; respawnAt(PLACES.polsek.px, PLACES.polsek.pz + 8, 'Released. Keep it clean out there.'); }, 2600);
}
function doWasted() {
  const fee = Math.min(S.money, Math.max(10000, Math.floor(S.money * 0.1)));
  S.money -= fee;
  hud.showEnd('WASTED', 'Hospital bill: Rp ' + fee.toLocaleString('en-US'));
  sfx.fail();
  setTimeout(() => respawnAt(PLACES.rsud.px, PLACES.rsud.pz - 6, 'The RSUD patched you up. Take it easy.'), 2600);
}

// ---------------- entering / exiting vehicles and boats ----------------
function nearestVehicle(maxD) {
  let best = null, bd = maxD;
  for (const v of vehicles) {
    if (v.dead) continue;
    const d = Math.hypot(v.x - S.px, v.z - S.pz);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}
function enterVehicle(veh) {
  if (veh.mode === 'traffic' && veh.driver) {
    // carjacking: the driver bails out and runs — his model becomes a ped
    const d = veh.driver;
    veh.v.group.remove(d.g);
    scene.add(d.g);
    upPose(d);
    d.g.position.set(veh.x + 2, 0, veh.z + 1);
    peds.push({
      p: d, x: veh.x + 2, z: veh.z + 1, h: 0, phase: 0, speed: 1.4,
      path: null, pi: 0, state: 'flee', t: 4, hp: 40, downT: 0, fleeX: S.px, fleeZ: S.pz,
    });
    veh.driver = null;
    police.addHeat(30);
    hud.toast('Carjacked! The driver ran off');
  }
  veh.mode = 'player';
  pl.vehicle = veh; pl.lastCar = veh;
  S.mode = 'car';
  player.g.visible = true;
  drivePose(player);
  sfx.door();
}
function exitVehicle(ejected = false) {
  const veh = pl.vehicle;
  if (!veh) return;
  veh.mode = 'parked'; veh.speed = 0;
  pl.vehicle = null;
  S.mode = 'foot';
  upPose(player);
  const side = 1.6;
  S.px = veh.x + Math.cos(veh.h) * side; S.pz = veh.z - Math.sin(veh.h) * side;
  [S.px, S.pz] = collideCircle(S.px, S.pz, 0.45);
  player.g.position.set(S.px, 0, S.pz);
  engineSound(false);
  if (!ejected) sfx.door();
}
function nearestBoat(maxD) {
  let best = null, bd = maxD;
  for (const b of boatRefs) {
    const d = Math.hypot(b.x - S.px, b.z - S.pz);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function enterBoat(b) {
  pl.boat = b; S.mode = 'boat';
  sitPose(player);
  sfx.door();
}
function exitBoat(swim = false) {
  const b = pl.boat;
  if (!b) return;
  pl.boat = null; S.mode = 'foot';
  upPose(player);
  // step ashore at the nearest sand point
  let best = null, bd = 1e9;
  for (let a = 0; a < Math.PI * 2; a += 0.35) {
    for (const r of [6, 10, 14, 20]) {
      const x = b.x + Math.sin(a) * r, z = b.z + Math.cos(a) * r;
      if (x > -798 && x < 798 && z > -1245 && z < 1055 && z < -1150 || (Math.abs(x) > 770 && z >= -1150)) {
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < bd) { bd = d; best = { x, z }; }
      }
    }
  }
  if (best) { S.px = best.x; S.pz = best.z; }
  if (swim) hud.toast('You swim ashore, soaked but alive');
  engineSound(false);
}

// ---------------- traffic update ----------------
function trafficUpdate(dt) {
  for (const veh of vehicles) {
    if (veh.mode !== 'traffic') continue;
    if (veh.fireT < 0) { veh.fireT += dt; if (veh.fireT >= 0) explodeVehicle(veh); continue; }
    if (veh.dead) continue;
    if (!veh.path || veh.pi >= veh.path.length) {
      const t = randomTarget();
      routeVehicle(veh, t.x, t.z);
      if (!veh.path) continue;
    }
    const wp = veh.path[veh.pi];
    const dx = wp.x - veh.x, dz = wp.z - veh.z, dist = Math.hypot(dx, dz);
    if (dist < 4.5) { veh.pi++; continue; }
    const want = Math.atan2(dx, dz);
    let dh = want - veh.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    veh.h += Math.max(-1.9 * dt, Math.min(1.9 * dt, dh * 2.2));
    // speed by road class, slower in turns
    const wHere = roadWidthAt(veh.x, veh.z, 2);
    let target = wHere >= 24 ? 12.5 : wHere >= 12 ? 9.5 : wHere >= 8 ? 6.5 : 3.6;
    if (Math.abs(dh) > 0.35) target *= 0.45;
    if (veh.v.bike) target *= 1.15;
    // keep a gap to whatever is ahead
    const fx = Math.sin(veh.h), fz = Math.cos(veh.h);
    let blocked = false;
    const ahead = (ox, oz, r) => {
      const rx = ox - veh.x, rz = oz - veh.z;
      const fwd = rx * fx + rz * fz, side = Math.abs(rx * fz - rz * fx);
      return fwd > 0 && fwd < r && side < 1.7;
    };
    for (const o of vehicles) {
      if (o === veh) continue;
      if (ahead(o.x, o.z, 8)) { blocked = true; break; }
    }
    if (!blocked && pl.vehicle && ahead(pl.vehicle.x, pl.vehicle.z, 8)) blocked = true;
    if (!blocked && !pl.vehicle && ahead(S.px, S.pz, 6)) blocked = true;
    if (!blocked) for (const p of peds) { if (p.state === 'walk' && ahead(p.x, p.z, 6)) { blocked = true; break; } }
    if (blocked) target = 0;
    veh.speed += Math.max(-16 * dt, Math.min(veh.v.acc * dt, target - veh.speed));
    if (veh.speed < 0.05 && target === 0) veh.speed = 0;
    veh.x += Math.sin(veh.h) * veh.speed * dt;
    veh.z += Math.cos(veh.h) * veh.speed * dt;
    const [nx, nz, hit] = collideCircle(veh.x, veh.z, veh.v.bike ? 0.6 : 1.45);
    if (hit) { veh.x = nx; veh.z = nz; if (Math.abs(veh.speed) > 5) { veh.speed *= 0.3; sfx.crash(); } }
    veh.v.group.position.set(veh.x, 0, veh.z);
    veh.v.group.rotation.y = veh.h;
    for (const wh of veh.v.wheels) wh.rotation.x += veh.speed * dt / 0.36;
    // headlight glow at night is handled by lampGlow-style points; skip per-car lights
    // displacement watchdog: moving nowhere for 6 s → re-route; 12 s → respawn
    veh.checkT += dt;
    if (veh.checkT >= 1) {
      const moved = Math.hypot(veh.x - veh.sx, veh.z - veh.sz);
      veh.checkT = 0;
      if (moved < 0.35 && !blocked) veh.stuck += 1; else veh.stuck = 0;
      veh.sx = veh.x; veh.sz = veh.z;
      if (veh.stuck === 6) {
        const t = randomTarget();
        routeVehicle(veh, t.x, t.z);
      } else if (veh.stuck >= 12) {
        const wide = EDGES.filter(e => e.w >= 24);
        const e = wide[Math.floor(Math.random() * wide.length)];
        const a = NODES[e.a], b = NODES[e.b], t = Math.random();
        veh.x = a.x + (b.x - a.x) * t; veh.z = a.z + (b.z - a.z) * t;
        veh.h = Math.atan2(b.x - a.x, b.z - a.z);
        veh.stuck = 0; veh.speed = 0;
        const tg = randomTarget();
        routeVehicle(veh, tg.x, tg.z);
      }
    }
    veh.honkT -= dt;
    if (veh.honkT <= 0) { veh.honkT = 6 + Math.random() * 14; if (blocked && Math.hypot(veh.x - S.px, veh.z - S.pz) < 26) sfx.horn(); }
  }
  // chained fires: a car set alight by a neighbouring explosion burns down
  // and blows up a moment later, whatever mode it is in
  for (const veh of vehicles) {
    if (veh.dead || veh.fireT >= 0 || veh.mode === 'traffic') continue; // traffic ticks its own in trafficUpdate
    veh.fireT += dt;
    if (veh.fireT >= 0) explodeVehicle(veh);
  }
  // fire + smoke on wrecked cars: reuse fireT as a burn timer for effects
  for (const veh of vehicles) {
    if (!veh.dead) continue;
    veh.fireT += dt;
    veh.v.group.position.y = 0;
    if (veh.fireT < 2.5) {
      const s = 1 + Math.sin(veh.fireT * 31) * 0.06;
      veh.v.group.scale.set(s, 1, s);
    }
  }
}

// ---------------- pedestrian update ----------------
function pedUpdate(dt) {
  for (const ped of peds) {
    if (ped.state === 'sit') continue;
    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) { ped.state = 'flee'; ped.t = 2; ped.hp = 25; upPose(ped.p); }
      continue;
    }
    let tx, tz, sp = ped.speed;
    if (ped.state === 'flee') {
      ped.t -= dt;
      const dx = ped.x - (ped.fleeX ?? S.px), dz = ped.z - (ped.fleeZ ?? S.pz);
      const d = Math.hypot(dx, dz) || 1;
      tx = ped.x + (dx / d) * 10; tz = ped.z + (dz / d) * 10; sp = 4.6;
      if (ped.t <= 0) { ped.state = 'walk'; routePed(ped); }
    } else {
      if (!ped.path || ped.pi >= ped.path.length) {
        if (Math.random() < 0.25) { ped.state = 'idle'; ped.t = 4 + Math.random() * 8; }
        else routePed(ped);
        continue;
      }
      const wp = ped.path[ped.pi];
      tx = wp.x; tz = wp.z;
      if (Math.hypot(tx - ped.x, tz - ped.z) < 1.6) { ped.pi++; continue; }
    }
    if (ped.state === 'idle') {
      ped.t -= dt;
      idlePose(ped.p, performance.now() / 1000 + ped.phase);
      if (ped.t <= 0) { ped.state = 'walk'; routePed(ped); }
      continue;
    }
    const want = Math.atan2(tx - ped.x, tz - ped.z);
    let dh = want - ped.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    ped.h += Math.max(-4 * dt, Math.min(4 * dt, dh));
    ped.x += Math.sin(ped.h) * sp * dt;
    ped.z += Math.cos(ped.h) * sp * dt;
    ped.phase += dt * (sp > 3 ? 13 : 8);
    walkPose(ped.p, ped.phase, sp > 3 ? 1 : 0.75);
    ped.p.g.position.set(ped.x, ped.p.g.position.y, ped.z);
    ped.p.g.rotation.y = ped.h;
    // hit by the player's car
    if (pl.vehicle && Math.abs(pl.vehicle.speed) > 3.5 && Math.hypot(ped.x - pl.vehicle.x, ped.z - pl.vehicle.z) < 1.5) {
      hurtPed(ped, 30, 20);
      sfx.punchHit();
    }
  }
}

// ---------------- player update ----------------
function updatePlayer(dt) {
  if (S.knocked) {
    pl.deadT += dt;
    if (pl.deadT > 3.6) doWasted();
    player.g.position.set(S.px, 0.16, S.pz);
    return;
  }
  if (pl.vehicle) {
    const veh = pl.vehicle;
    const fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (touchMove.y < -0.25 ? 1 : touchMove.y > 0.25 ? -0.6 : 0);
    const steerIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) + (touchMove.x < -0.25 ? 0.8 : touchMove.x > 0.25 ? -0.8 : 0);
    const handbrake = keys.Space;
    const top = veh.v.top, acc = veh.v.acc;
    if (fwdIn > 0) veh.speed += acc * dt * (veh.speed < 0 ? 2.2 : 1);
    else if (fwdIn < 0) veh.speed -= (veh.speed > 0.5 ? 16 : acc * 0.55) * dt;
    else veh.speed -= Math.sign(veh.speed) * Math.min(Math.abs(veh.speed), 2.2 * dt);
    if (handbrake) veh.speed -= Math.sign(veh.speed) * Math.min(Math.abs(veh.speed), 22 * dt);
    veh.speed = Math.max(-11, Math.min(top, veh.speed));
    const steerAuthority = Math.min(1, Math.abs(veh.speed) / 6) * (veh.speed < 0 ? -1 : 1);
    veh.h += steerIn * steerAuthority * 1.55 * dt * (handbrake ? 1.5 : 1);
    const px0 = veh.x, pz0 = veh.z;
    veh.x += Math.sin(veh.h) * veh.speed * dt;
    veh.z += Math.cos(veh.h) * veh.speed * dt;
    // the player's car collides with the static world (and takes damage)
    const [nx, nz, hit] = collideCircle(veh.x, veh.z, veh.v.bike ? 0.6 : 1.5);
    if (hit) {
      veh.x = nx; veh.z = nz;
      const impact = Math.abs(veh.speed);
      if (impact > 4) {
        hurtVehicle(veh, (impact - 3) * 2.4);
        sfx.crash(); pl.shake = Math.max(pl.shake, 0.3);
        veh.speed = -veh.speed * 0.22;
      } else veh.speed *= 0.4;
    }
    // car vs car / ped handled by proximity: shove traffic cars
    for (const o of vehicles) {
      if (o === veh || o.dead) continue;
      const d = Math.hypot(o.x - veh.x, o.z - veh.z);
      if (d < 2.6) {
        o.x += (o.x - veh.x) / (d || 1) * (2.6 - d); o.z += (o.z - veh.z) / (d || 1) * (2.6 - d);
        hurtVehicle(o, Math.abs(veh.speed) * 0.7);
        if (Math.abs(veh.speed) > 6) { sfx.crash(); veh.speed *= 0.55; }
      }
    }
    // flooding: cars die in the sea
    if (veh.z < -1178 || Math.abs(veh.x) > 786 || veh.z > 1046) {
      if (Math.abs(veh.speed) > 0) { veh.speed *= Math.max(0, 1 - dt * 2.5); if (Math.random() < dt) sfx.splash(); }
      if (veh.health > 0) veh.health -= dt * 8;
      if (veh.health <= 0 && !veh.dead) { hud.toast('The car drowned. Swim — no, walk — back to shore'); exitVehicle(true); S.px = Math.max(-790, Math.min(790, veh.x)); S.pz = -1172; }
    }
    veh.v.group.position.set(veh.x, 0, veh.z);
    veh.v.group.rotation.y = veh.h;
    for (const wh of veh.v.wheels) wh.rotation.x += veh.speed * dt / 0.36;
    S.px = veh.x; S.pz = veh.z; pl.h = veh.h;
    player.g.position.set(veh.x, -0.52, veh.z); // seated in the car, not on it
    player.g.rotation.y = veh.h;
    engineSound(true, Math.abs(veh.speed) / top, false);
    pl.speed = veh.speed;
    return;
  }
  if (pl.boat) {
    const b = pl.boat;
    const fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const steerIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    if (fwdIn > 0) b.speed = Math.min(11, b.speed + 5.5 * dt);
    else if (fwdIn < 0) b.speed = Math.max(-3.5, b.speed - 4 * dt);
    else b.speed -= Math.sign(b.speed) * Math.min(Math.abs(b.speed), 1.2 * dt);
    b.h += steerIn * 0.9 * dt * (Math.abs(b.speed) > 0.4 ? 1 : 0);
    b.x += Math.sin(b.h) * b.speed * dt;
    b.z += Math.cos(b.h) * b.speed * dt;
    b.x = Math.max(-1150, Math.min(1150, b.x));
    b.z = Math.max(-1450, Math.min(1030, b.z));
    b.mesh.position.set(b.x, Math.sin(performance.now() / 480) * 0.07, b.z);
    b.mesh.rotation.y = b.h;
    b.mesh.rotation.z = Math.sin(performance.now() / 620) * 0.02;
    S.px = b.x; S.pz = b.z; pl.h = b.h;
    player.g.position.set(b.x, 0.35, b.z); // seated on the bench
    player.g.rotation.y = b.h;
    engineSound(true, Math.abs(b.speed) / 11, true);
    pl.speed = b.speed;
    return;
  }
  // on foot
  engineSound(false);
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz -= 1;
  if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (isTouch) { mx += touchMove.x; mz += touchMove.y; }
  const moving = Math.hypot(mx, mz) > 0.12;
  const run = keys.ShiftLeft || keys.ShiftRight || touchRun;
  const spd = S.indoor ? 3.4 : (run ? 7.6 : 4.6);
  if (moving && !hud.dialogOpen()) {
    // camera-relative movement: the camera looks along -(sin camYaw, cos camYaw),
    // so W walks away from the camera and D strafes to the player's right
    const lx = -Math.sin(S.camYaw), lz = -Math.cos(S.camYaw);
    const rx = -lz, rz = lx;
    const dirx = lx * -mz + rx * mx, dirz = lz * -mz + rz * mx;
    const targetH = Math.atan2(dirx, dirz);
    let dh = targetH - pl.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    pl.h += Math.max(-11 * dt, Math.min(11 * dt, dh * 1.6));
    S.px += Math.sin(pl.h) * spd * dt;
    S.pz += Math.cos(pl.h) * spd * dt;
    [S.px, S.pz] = collideCircle(S.px, S.pz, 0.45);
    if (!S.indoor) {
      S.px = Math.max(-796, Math.min(796, S.px));
      S.pz = Math.max(-1248, Math.min(1052, S.pz));
    }
    pl.phase += dt * (run ? 12.5 : 9);
    walkPose(player, pl.phase, run ? 1 : 0.8);
    pl.stepT -= dt;
    if (pl.stepT <= 0) { pl.stepT = run ? 0.3 : 0.42; sfx.step(); }
    pl.speed = spd;
  } else {
    if (!hud.dialogOpen() && S.weapon === 'FISTS') idlePose(player, performance.now() / 1000);
    else if (S.weapon !== 'FISTS') aimPose(player, 0);
    pl.speed = 0;
  }
  player.g.position.set(S.px, player.g.position.y, S.pz);
  player.g.rotation.y = pl.h;
  // face the camera aim while firing guns
  if ((firing || touchFire) && S.weapon !== 'FISTS' && !WEAPONS[S.weapon].melee) {
    player.g.rotation.y = S.camYaw + Math.PI;
    pl.h = S.camYaw + Math.PI;
  }
}

// ---------------- interactions & places ----------------
let shopOpen = false;
function nearPlace(key, r = 4.0) {
  const p = PLACES[key];
  return Math.hypot(S.px - p.px, S.pz - p.pz) < r;
}
function currentPrompt() {
  if (hud.dialogOpen()) return 'E / tap — Continue';
  if (S.knocked) return null;
  if (pl.vehicle) {
    if (Math.hypot(S.px - PLACES.bengkel.x, S.pz - PLACES.bengkel.z) < 11) return 'E — Pay N Spray · Rp 50,000 (repair + respray)';
    return 'E — Exit vehicle';
  }
  if (pl.boat) return 'E — Step ashore';
  if (S.indoor === 'karaoke') return Math.hypot(S.px - (INTERIOR.karaoke.x - 9), S.pz - INTERIOR.karaoke.z) < 3.4 ? 'E — Leave STAR KARAOKE' : null;
  if (S.indoor === 'rumah') {
    if (Math.hypot(S.px - (INTERIOR.rumah.x - 3.4), S.pz - (INTERIOR.rumah.z + 2.6)) < 2.6) return 'E — Save game';
    if (Math.hypot(S.px - (INTERIOR.rumah.x - 6), S.pz - INTERIOR.rumah.z) < 3.4) return 'E — Leave the house';
    return null;
  }
  const obj = missions.getObjective();
  if (obj && obj.talk && Math.hypot(S.px - obj.x, S.pz - obj.z) < 4.2) return 'E — Talk';
  const veh = nearestVehicle(3.4);
  if (veh) return 'E — Drive ' + veh.v.name;
  const boat = nearestBoat(5);
  if (boat) return 'E — Board the boat';
  if (nearPlace('polsek')) return S.wanted > 0 ? 'E — Surrender · fine Rp ' + (25000 * S.wanted).toLocaleString('en-US') : 'POLSEK — all quiet. Stay legal, citizen.';
  if (nearPlace('rsud')) return S.health < 100 ? 'E — Treatment · Rp 20,000' : 'RSUD — you are in good shape';
  if (nearPlace('karaoke')) return 'E — Enter STAR KARAOKE';
  if (nearPlace('gunshop')) return 'E — Browse the GUN SHOP';
  if (nearPlace('bengkel')) return pl.lastCar && Math.hypot(pl.lastCar.x - S.px, pl.lastCar.z - S.pz) < 14 ? 'E — Repair your ' + pl.lastCar.v.name + ' · Rp 50,000' : 'BENGKEL — bring your car onto the slab for a Pay N Spray';
  if (nearPlace('house')) return S.houseOwned ? 'E — Save game (your house)' : 'E — Buy this house · Rp 300,000';
  if (nearPlace('singgah')) return 'E — Save game';
  if (nearPlace('gbk')) return 'GBK Stadium — walk in through the south gate';
  if (nearPlace('monas')) return 'Monas — the National Monument, 132 m of pride';
  if (nearPlace('masjid')) return 'Grand Mosque — a place of peace';
  if (kampungSpots.door && Math.hypot(S.px - kampungSpots.door.x, S.pz - kampungSpots.door.z) < 3.4) return 'E — Enter the kampung house';
  return null;
}
function spend(amount) {
  if (S.money < amount) { hud.toast('Not enough money'); sfx.denied(); return false; }
  S.money -= amount; sfx.buy();
  return true;
}
function interact() {
  audioInit();
  if (!S.started || S.knocked) return;
  if (hud.advanceDialog()) return;
  if (hud.isMapOpen()) { hud.toggleMap(false); return; }
  if (shopOpen) { toggleShop(false); return; }
  if (pl.vehicle) {
    if (Math.hypot(S.px - PLACES.bengkel.x, S.pz - PLACES.bengkel.z) < 11) {
      if (spend(50000)) {
        pl.vehicle.health = 100; pl.vehicle.dead = false;
        police.addHeat(-S.heat * 0.5 - 40);
        hud.toast('Pay N Spray: good as new — and the heat is off');
        sfx.heal();
      }
      return;
    }
    exitVehicle();
    return;
  }
  if (pl.boat) { exitBoat(false); return; }
  if (S.indoor === 'karaoke') {
    if (Math.hypot(S.px - (INTERIOR.karaoke.x - 9), S.pz - INTERIOR.karaoke.z) < 3.4) {
      S.indoor = null;
      S.px = PLACES.karaoke.px; S.pz = PLACES.karaoke.pz - 2;
      sfx.door();
    }
    return;
  }
  if (S.indoor === 'rumah') {
    if (Math.hypot(S.px - (INTERIOR.rumah.x - 3.4), S.pz - (INTERIOR.rumah.z + 2.6)) < 2.6) { saveGame(false); hud.toast('Game saved'); sfx.heal(); return; }
    if (Math.hypot(S.px - (INTERIOR.rumah.x - 6), S.pz - INTERIOR.rumah.z) < 3.4) {
      S.indoor = null;
      S.px = kampungSpots.door.x; S.pz = kampungSpots.door.z;
      sfx.door();
    }
    return;
  }
  if (missions.tryInteract()) return;
  const veh = nearestVehicle(3.4);
  if (veh) { enterVehicle(veh); return; }
  const boat = nearestBoat(5);
  if (boat) { enterBoat(boat); return; }
  if (nearPlace('polsek') && S.wanted > 0) {
    const fine = 25000 * S.wanted;
    S.money = Math.max(0, S.money - fine);
    police.clearHeat();
    hud.toast('You surrendered. Fine paid: Rp ' + fine.toLocaleString('en-US'));
    sfx.buy();
    return;
  }
  if (nearPlace('rsud') && S.health < 100) {
    if (spend(20000)) { S.health = 100; hud.toast('Fully treated. Take care out there'); sfx.heal(); }
    return;
  }
  if (nearPlace('karaoke')) {
    S.indoor = 'karaoke';
    pl.returnPoint = { x: PLACES.karaoke.px, z: PLACES.karaoke.pz };
    S.px = INTERIOR.karaoke.x - 7; S.pz = INTERIOR.karaoke.z;
    sfx.door();
    hud.toast('STAR KARAOKE — the bar heals: stand at the bar a moment');
    return;
  }
  if (nearPlace('gunshop')) { toggleShop(true); return; }
  if (nearPlace('bengkel') && pl.lastCar && Math.hypot(pl.lastCar.x - S.px, pl.lastCar.z - S.pz) < 14) {
    if (spend(50000)) { pl.lastCar.health = 100; pl.lastCar.dead = false; hud.toast('Repaired to full health'); }
    return;
  }
  if (nearPlace('house')) {
    if (!S.houseOwned) {
      if (spend(300000)) { S.houseOwned = true; hud.banner('HOUSE PURCHASED', 'Your kampung-side home — a permanent save point'); }
    } else { saveGame(false); hud.toast('Game saved at home'); sfx.heal(); }
    return;
  }
  if (nearPlace('singgah')) { saveGame(false); hud.toast('Game saved'); sfx.heal(); return; }
  if (nearPlace('gbk')) { hud.toast('GBK Stadium — Gelora Bung Karno. The south gate is open'); return; }
  if (nearPlace('monas')) { hud.toast('Monas — climb it in your heart. The carnival is west'); return; }
  if (nearPlace('masjid')) { hud.toast('You take a quiet moment by the mosque'); return; }
  if (kampungSpots.door && Math.hypot(S.px - kampungSpots.door.x, S.pz - kampungSpots.door.z) < 3.4) {
    S.indoor = 'rumah';
    S.px = INTERIOR.rumah.x - 4; S.pz = INTERIOR.rumah.z;
    sfx.door();
    hud.toast('A kampung home — rest, and save your game by the rug');
    return;
  }
}
// karaoke bar healing: stand near the bar counter inside
setInterval(() => {
  if (S.indoor === 'karaoke' && Math.hypot(S.px - (INTERIOR.karaoke.x + 5.5), S.pz - (INTERIOR.karaoke.z + 5.5)) < 3.4 && S.health < 100) {
    if (S.money >= 10000) { S.money -= 10000; S.health = Math.min(100, S.health + 25); hud.toast('A drink at the bar: +25 HP · Rp 10,000'); sfx.heal(); }
  }
}, 1200);

// ---------------- gun shop UI ----------------
function toggleShop(open) {
  shopOpen = open;
  $('shop').style.display = open ? 'flex' : 'none';
  if (open) renderShop();
}
function renderShop() {
  const list = $('shop-list');
  list.innerHTML = '';
  for (const slot of WEAPON_SLOTS) {
    if (slot === 'FISTS') continue;
    const w = WEAPONS[slot];
    const row = document.createElement('div');
    row.className = 'shop-row';
    const owned = S.owned[slot];
    row.innerHTML = '<b>' + slot + '</b><span>' + (owned ? 'Owned · ammo ' + S.ammo[slot] : fmtRp(w.price)) + '</span>';
    const btn = document.createElement('button');
    btn.textContent = owned ? 'Ammo +' + w.mag + ' · ' + fmtRp(w.ammoPrice) : 'Buy';
    btn.onclick = () => {
      audioInit();
      if (!owned) {
        if (spend(w.price)) { S.owned[slot] = true; S.ammo[slot] = w.mag * 3; S.weapon = slot; refreshWeaponMesh(); hud.toast(slot + ' purchased'); }
      } else if (spend(w.ammoPrice)) { S.ammo[slot] += w.mag; hud.toast('Ammo restocked'); }
      renderShop();
    };
    row.appendChild(btn);
    list.appendChild(row);
  }
}

// ---------------- radio ----------------
const STATIONS = [
  { name: '98.4 KOTA FM', tick: ' +++ KOTA FM traffic: Sudirman flowing, Semanggi busy +++ Weather: hot, chance of rain +++ Monas carnival open all weekend +++ ' },
  { name: '101.2 SUARA JAKARTA', tick: ' +++ News: GBK hosts the Garuda this Saturday +++ A mysterious gold Vulcan GT was seen near Bundaran HI +++ Police remind drivers: surrender at the POLSEK is cheaper than the chase +++ ' },
  { name: '88.9 DANGDUT KOPLO', tick: ' +++ Koplo nonstop! +++ Warung Bu Tini wins best sate in Kampung Barat +++ Ojol drivers: stay hydrated +++ ' },
  { name: '95.5 JAZZ SENAYAN', tick: ' +++ Smooth jazz for the Menteng evenings +++ Art exhibition opens in Kota Tua +++ The ferry to the islands leaves Ancol at dawn +++ ' },
  { name: 'OFF', tick: ' +++ Radio off +++ ' },
];
let radioIdx = 0;
function cycleRadio() {
  radioIdx = (radioIdx + 1) % STATIONS.length;
  hud.toast('Radio: ' + STATIONS[radioIdx].name);
  sfx.uiClick();
}

// ---------------- cheats ----------------
let cheatBuf = '';
function cheatFeed(key) {
  if (!key || key.length !== 1) return;
  cheatBuf = (cheatBuf + key.toUpperCase()).slice(-10);
  for (const code of CHEAT_CODES) if (cheatBuf.endsWith(code)) { runCheat(code); cheatBuf = ''; break; }
}
const CHEAT_CODES = ['BANYAKDUIT', 'SENJATA', 'BINTANG5', 'BERSIH', 'SEHAT', 'ROMPI', 'SIANG', 'MALAM', 'JAKARTA', 'MOBIL', 'MOTOR'];
function runCheat(code) {
  sfx.mission();
  hud.toast('CHEAT ACTIVATED: ' + code);
  if (code === 'BANYAKDUIT') { S.money += 250000; S.health = 100; S.armor = 100; }
  else if (code === 'MOBIL') spawnCheatCar('vulcan', 0xe0a51c);
  else if (code === 'MOTOR') spawnCheatCar('sportbike', 0xc23b2e);
  else if (code === 'SENJATA') { for (const s of WEAPON_SLOTS) { S.owned[s] = true; if (S.ammo[s] !== undefined && S.ammo[s] !== Infinity) S.ammo[s] = 240; } }
  else if (code === 'BINTANG5') police.addHeat(300);
  else if (code === 'BERSIH') police.clearHeat();
  else if (code === 'SEHAT') S.health = 100;
  else if (code === 'ROMPI') S.armor = 100;
  else if (code === 'SIANG') S.gameMinutes = 720;
  else if (code === 'MALAM') S.gameMinutes = 1410;
  else if (code === 'JAKARTA') { S.money += 100000; spawnCheatCar('vulcan', 0xffc93f); }
}
function spawnCheatCar(kind, color) {
  const x = S.px + Math.sin(pl.h) * 6, z = S.pz + Math.cos(pl.h) * 6;
  const v = buildVehicle(kind, color);
  v.group.position.set(x, 0, z); v.group.rotation.y = pl.h;
  scene.add(v.group);
  const veh = { v, kind, x, z, h: pl.h, speed: 0, mode: 'parked', health: 100, dead: false, fireT: 0, path: null, pi: 0, lane: 0, driver: null, color, sx: x, sz: z, checkT: 0, stuck: 0, honkT: 9 };
  vehicles.push(veh);
  pl.lastCar = veh;
}

// ---------------- environment: time, weather, sky, lights ----------------
let weather = 'clear', weatherT = 200, gloom = 0;
const rainGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) { pos[i * 3] = (Math.random() - 0.5) * 70; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 70; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaac4de, size: 0.55, transparent: true, opacity: 0 }));
rain.frustumCulled = false;
scene.add(rain);
const skyDay = new THREE.Color(0x9fd3e8), skyNight = new THREE.Color(0x0d1524), skyDusk = new THREE.Color(0xf2a65e), skyRain = new THREE.Color(0x5d707e);
const _skyCol = new THREE.Color();
function updateEnvironment(dt) {
  S.gameMinutes = (S.gameMinutes + dt * 1.2) % 1440;
  const hourA = ((S.gameMinutes / 60) - 6) / 12 * Math.PI; // sunrise 06:00, sunset 18:00
  const sunDir = new THREE.Vector3(Math.cos(hourA) * 0.55, Math.sin(hourA), 0.38).normalize();
  const dayF = Math.max(0, Math.min(1, sunDir.y * 2.4 + 0.3));
  // weather cycle
  weatherT -= dt;
  if (weatherT <= 0) {
    if (weather === 'clear') { weather = 'rain'; weatherT = 60 + Math.random() * 50; hud.toast('Rain rolls in over the bay'); }
    else { weather = 'clear'; weatherT = 240 + Math.random() * 200; hud.toast('The rain clears'); }
  }
  const targetGloom = weather === 'rain' ? 0.6 : 0;
  gloom += (targetGloom - gloom) * Math.min(1, dt * 0.4);
  S.weather = weather; S.gloom = gloom;
  // sky + fog colour: day → dusk tint near the horizon hours → night, grey in rain
  _skyCol.copy(skyNight).lerp(skyDay, dayF);
  if (sunDir.y > -0.05 && sunDir.y < 0.3) _skyCol.lerp(skyDusk, (0.3 - Math.abs(sunDir.y - 0.1)) * 1.6);
  if (gloom > 0.03) _skyCol.lerp(skyRain, gloom * 0.8);
  scene.background.copy(_skyCol);
  scene.fog.color.copy(_skyCol);
  scene.fog.near = 150 - gloom * 60;
  scene.fog.far = 1500 - gloom * 750 - (1 - dayF) * 350;
  sun.position.set(S.px + sunDir.x * 260, Math.max(30, sunDir.y * 260), S.pz + sunDir.z * 260);
  sun.target.position.set(S.px, 0, S.pz);
  sun.intensity = 0.15 + dayF * 2.4;
  sun.color.setHex(sunDir.y < 0.25 && sunDir.y > -0.1 ? 0xffb37a : 0xfff2dd);
  hemi.intensity = 0.16 + dayF * 0.7;
  sky.update(dt, S.px, S.pz, sunDir, dayF, gloom);
  if (lampGlow.points) lampGlow.points.material.opacity = Math.max(0, 0.9 - dayF * 1.6) * (1 - gloom * 0.3);
  // rain around the camera
  rain.material.opacity = gloom * 1.1;
  if (gloom > 0.05) {
    rain.position.set(S.px, 0, S.pz);
    const p = rainGeo.attributes.position;
    for (let i = 0; i < 700; i++) {
      let y = p.getY(i) - dt * 34;
      if (y < 0) y = 30;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }
  // ferris wheel + disco ball keep turning
  const anim = animatedRefs();
  if (anim.ferrisWheel) anim.ferrisWheel.rotation.z += dt * 0.25;
  if (anim.karaokeBall) anim.karaokeBall.rotation.y += dt * 0.8;
  if (karaokeRefs.light) karaokeRefs.light.intensity = S.indoor === 'karaoke' ? 26 : 0;
}

// ---------------- camera ----------------
let camPos = new THREE.Vector3(30, 14, 120);
function updateCamera(dt) {
  if (SHOT && shotCam) { shotCam(); return; }
  if (!S.started) {
    // menu backdrop: a slow orbit over the avenue and the roundabout
    const t = performance.now() * 0.00005;
    const tx = Math.sin(t) * 120, tz = 30 + Math.cos(t) * 120;
    camPos.lerp(new THREE.Vector3(tx, 26, tz), 0.02);
    camera.position.copy(camPos);
    camera.lookAt(0, 4, 30);
    return;
  }
  const target = new THREE.Vector3(S.px, 1.6, S.pz);
  const dist = pl.vehicle ? 8.5 : S.camDist;
  const yaw = pl.vehicle ? pl.h + Math.PI : S.camYaw;
  if (pl.vehicle) S.camYaw = pl.h + Math.PI;
  const pitch = S.camPitch;
  const off = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist + 1.6,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  const want = target.clone().add(off);
  // keep the camera out of the ground and out of walls (simple raise)
  want.y = Math.max(want.y, 1.1);
  const k = SHOT ? 1 : Math.min(1, dt * 7);
  camPos.lerp(want, k);
  camera.position.copy(camPos);
  if (pl.shake > 0) {
    pl.shake -= dt;
    camera.position.x += (Math.random() - 0.5) * pl.shake * 0.7;
    camera.position.y += (Math.random() - 0.5) * pl.shake * 0.7;
  }
  camera.lookAt(target.x, target.y + 0.6, target.z);
}

// ---------------- menu / start ----------------
function startGame(continued) {
  audioInit();
  S.started = true;
  $('menu').style.display = 'none';
  $('hud').style.display = 'block';
  bindTouch();
  if (!continued) {
    S.px = SPAWN.x; S.pz = SPAWN.z; pl.h = SPAWN.heading;
    S.camYaw = pl.h + Math.PI;
    hud.banner('JAKARTA CITY', 'Free to roam — follow the gold marker when you are ready');
    hud.toast('WASD drive & walk · E interact · M map · 1-6 weapons');
  } else {
    hud.toast('Welcome back to Jakarta');
  }
}
function wireMenu() {
  const saved = loadSave();
  if (saved) { $('btn-continue').style.display = 'block'; $('btn-load').style.display = 'block'; }
  $('btn-new').onclick = () => startGame(false);
  $('btn-continue').onclick = () => { const s = loadSave(); if (s) { applySave(s); placePlayerFromSave(); } startGame(true); };
  $('btn-load').onclick = () => {
    try {
      const raw = localStorage.getItem('jakarta-city-manual');
      if (raw) { applySave(JSON.parse(raw)); placePlayerFromSave(); }
    } catch { /* no manual save */ }
    startGame(true);
  };
  $('btn-controls').onclick = () => { $('controls').style.display = $('controls').style.display === 'block' ? 'none' : 'block'; };
  $('shop-close').onclick = () => toggleShop(false);
  $('cheatgo').onclick = applyCheatInput;
}
function placePlayerFromSave() {
  pl.h = 0; pl.vehicle = null; pl.boat = null; S.mode = 'foot';
  upPose(player);
  player.g.position.set(S.px, 0, S.pz);
  // park the starter car near the player
  starterCar.x = S.px + 6; starterCar.z = S.pz + 4;
  starterCar.v.group.position.set(starterCar.x, 0, starterCar.z);
}

// ---------------- staged screenshots ----------------
let shotCam = null;
function stageShot() {
  if (!SHOT) return;
  S.started = true;
  $('menu').style.display = 'none';
  $('hud').style.display = 'block';
  const gold = 0xffc93f;
  if (SHOT === 'cover') {
    S.gameMinutes = 17 * 60 + 5; // golden hour, still bright
    const veh = addVehicle('vulcan', 6.2, 205, Math.PI, 'parked');
    veh.color = gold;
    if (veh.v.paintMat) veh.v.paintMat.color.setHex(gold); // the hero car wears gold
    enterVehicle(veh);
    veh.speed = 9;
    // dress the avenue with traffic in both carriageways, on hand-set
    // straight paths so the cover frame is composed, not routed
    for (let i = 0; i < 7; i++) {
      const north = i % 2 === 0, lane = north ? 6.2 : -6.2, z0 = 168 - i * 42;
      const v2 = addVehicle(TRAFFIC_KINDS[i % TRAFFIC_KINDS.length], lane, z0, north ? Math.PI : 0, 'traffic');
      v2.path = [0, 1, 2, 3].map(k => ({ x: lane, z: z0 + (north ? -1 : 1) * k * 130 }));
      v2.pi = 1;
      v2.speed = 9;
    }
    shotCam = () => {
      // high three-quarter from the south-east, kept over the roadway so no
      // rooftop intrudes: hero car near, median and tower walls running north
      camera.position.set(S.px + 11.5, 9.5, S.pz + 25);
      camera.lookAt(S.px - 3, 2.5, S.pz - 62);
    };
  } else if (SHOT === 'bundaran') {
    S.gameMinutes = 10 * 60 + 20;
    S.px = 21; S.pz = 52; pl.h = -0.7;
    // five cars circulating the ring on hand-set arc paths
    for (let i = 0; i < 5; i++) {
      const a = 0.6 + i * 0.55;
      const v2 = addVehicle(TRAFFIC_KINDS[(i * 3) % TRAFFIC_KINDS.length], Math.sin(a) * 25, 30 + Math.cos(a) * 25, a + Math.PI * 1.5, 'traffic');
      v2.path = [];
      for (let s2 = 0; s2 <= 10; s2++) {
        const aa = a - s2 * 0.22;
        v2.path.push({ x: Math.sin(aa) * 25, z: 30 + Math.cos(aa) * 25 });
      }
      v2.path.push({ x: 200, z: 30 }, { x: 500, z: 30 });
      v2.pi = 1;
      v2.speed = 6;
    }
    shotCam = () => { camera.position.set(47, 13.5, 88); camera.lookAt(-4, 2, 24); };
  } else if (SHOT === 'mission') {
    S.gameMinutes = 9 * 60 + 40;
    S.px = 12.5; S.pz = -857; pl.h = Math.PI + 0.35;
    player.g.position.set(S.px, 0, S.pz);
    hud.dialog([
      ['PAK HAJI', 'Peace be upon you, young one. You look like someone who can drive.'],
      ['PAK HAJI', 'Take me to Bundaran HI — the big roundabout with the fountain.'],
    ], () => {});
    shotCam = () => { camera.position.set(17.5, 2.6, -848.5); camera.lookAt(4, 1.6, -872); };
  } else if (SHOT === 'drive') {
    S.gameMinutes = 17 * 60 + 15; // dusk: warm sky, street lights just on
    const veh = addVehicle('sedan', -6.2, 150, Math.PI, 'parked');
    enterVehicle(veh);
    veh.speed = 13;
    for (let i = 0; i < 5; i++) {
      const lane = i % 2 ? -6.2 : 6.2, z0 = 96 - i * 30;
      const v2 = addVehicle(TRAFFIC_KINDS[(i * 2 + 1) % TRAFFIC_KINDS.length], lane, z0, Math.PI, 'traffic');
      v2.path = [0, 1, 2, 3].map(k => ({ x: lane, z: z0 - k * 150 }));
      v2.pi = 1;
      v2.speed = 11;
    }
    shotCam = () => {
      // low tracking shot off the rear quarter, over the carriageway (the
      // median's trees would swallow a camera placed any closer to it)
      camera.position.set(S.px - 5.6, 3.4, S.pz + 11);
      camera.lookAt(S.px + 1, 1.2, S.pz - 30);
    };
  } else if (SHOT === 'night') {
    S.gameMinutes = 21 * 60 + 40;
    const veh = addVehicle('falco', 14, 64, 2.6, 'parked');
    enterVehicle(veh);
    veh.speed = 10;
    police.addHeat(250);
    shotCam = null;
  } else if (SHOT === 'map') {
    S.gameMinutes = 12 * 60;
    S.px = 40; S.pz = -300;
    hud.toggleMap(true);
    shotCam = () => { camera.position.set(40, 60, -240); camera.lookAt(40, 0, -300); };
  }
}

// ---------------- save loop ----------------
setInterval(() => { if (S.started && !S.knocked) saveGame(true); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.started) saveGame(true); });

// ---------------- adaptive quality ----------------
let fpsAcc = 0, fpsN = 0, fpsT = 0, qLevel = 0;
function adaptQuality(dt) {
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT < 4) return;
  const avg = fpsN / fpsAcc;
  fpsAcc = 0; fpsN = 0; fpsT = 0;
  if (avg < 26 && qLevel < 2) {
    qLevel++;
    if (qLevel === 1) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    if (qLevel === 2) { renderer.setPixelRatio(1); sun.castShadow = false; }
  } else if (avg > 52 && qLevel > 0) {
    qLevel--;
    if (qLevel === 1) { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); sun.castShadow = true; }
    if (qLevel === 0) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  }
}

// ---------------- main loop ----------------
let lastT = performance.now();
let zoneNow = '';
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (S.started && !hud.isMapOpen() && !shopOpen) {
    updatePlayer(dt);
    playerShoot(dt);
    trafficUpdate(dt);
    pedUpdate(dt);
    police.update(dt);
    missions.update(dt);
    // zone notifications
    const zn = S.indoor ? (S.indoor === 'karaoke' ? 'STAR KARAOKE' : 'Kampung Barat') : zoneName(S.px, S.pz);
    if (zn !== zoneNow) { zoneNow = zn; S.zone = zn; hud.setZone(zn); }
    hud.showPrompt(currentPrompt());
    // radio only in vehicles
    if (!pl.vehicle && !pl.boat) engineSound(false);
  }
  updateFx(dt);
  updateEnvironment(dt);
  updateCamera(dt);
  const obj = missions.getObjective();
  hud.update(dt, {
    px: S.px, pz: S.pz, heading: pl.vehicle ? pl.h : (player.g.rotation.y || 0),
    objective: S.started ? obj : null, police, mode: S.mode, speed: pl.speed,
    station: STATIONS[radioIdx].name, ticker: STATIONS[radioIdx].tick,
  });
  adaptQuality(dt);
  renderer.render(scene, camera);
}

wireMenu();
stageShot();
loop();

// debug / verification hook (also used by the screenshot harness)
window.__JC = {
  S, vehicles, peds, police, missions, camera, renderer, scene,
  playerPos: () => ({ x: S.px, z: S.pz, mode: S.mode }),
  setTime: (m) => { S.gameMinutes = m; },
  teleport: (x, z) => { S.px = x; S.pz = z; },
  heat: (n) => police.addHeat(n),
  start: () => startGame(false),
};
