// state.js — the whole mutable game state in one object, plus save/load.
// Everything else imports S and reads/writes it; nothing keeps a second copy
// of money, health, wanted level or the clock, so the HUD can never disagree
// with the simulation.

export const WEAPON_SLOTS = ['FISTS', 'MACHETE', 'PISTOL', 'SMG', 'PUMP SHOTGUN', 'RIFLE'];

export const S = {
  started: false,        // menu dismissed, game running
  indoor: null,           // null | 'karaoke' | 'rumah'
  mode: 'foot',           // 'foot' | 'car' | 'boat'
  // player
  px: 46, pz: 246, heading: 0, vy: 0, grounded: true,
  health: 100, armor: 0, knocked: 0, // knocked > 0: seconds spent on the ground
  money: 250000,
  wanted: 0, wantedCool: 0,
  // clock: minutes since midnight; a new game starts at noon, bright daylight
  gameMinutes: 12 * 60,
  weather: 'clear', weatherT: 300, gloom: 0,
  // weapons: ammo per slot (FISTS/MACHETE are infinite)
  weapon: 'PISTOL', // start holding the pistol; the rest is bought at the gun shop
  ammo: { PISTOL: 240, SMG: 300, 'PUMP SHOTGUN': 48, RIFLE: 120 },
  owned: { FISTS: true, MACHETE: false, PISTOL: true, SMG: false, 'PUMP SHOTGUN': false, RIFLE: false },
  // story + economy
  missionIdx: 0, storyDone: false,
  houseOwned: false,
  kills: 0, crimes: 0,
  // camera + quality
  camYaw: 0, camPitch: 0.32, camDist: 9, qualityStep: 0,
  radioIdx: 0, radioT: 0,
  zone: '', zoneT: 0,
  dialogT: 0,
  saveT: 0,
};

export const fmtRp = n => 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const SAVE_KEY = 'jakarta-city-save';
const MANUAL_KEY = 'jakarta-city-manual';

export function snapshot() {
  return {
    money: S.money, missionIdx: S.missionIdx, storyDone: S.storyDone,
    px: S.px, pz: S.pz, heading: S.heading, gameMinutes: S.gameMinutes,
    ammo: S.ammo, owned: S.owned, houseOwned: S.houseOwned,
    health: S.health, armor: S.armor, weapon: S.weapon,
  };
}
export function saveGame(manual = false) {
  try { localStorage.setItem(manual ? MANUAL_KEY : SAVE_KEY, JSON.stringify(snapshot())); } catch (e) { /* private mode */ }
}
export function loadSave(manual = false) {
  try {
    const raw = localStorage.getItem(manual ? MANUAL_KEY : SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function hasSave() { return !!loadSave(false) || !!loadSave(true); }
// Apply a loaded save. Positions from an older map are not trusted: anything
// outside the island falls back to the spawn point, the rest of the save kept.
export function applySave(d, SPAWN, LAND) {
  if (!d) return false;
  S.money = d.money ?? S.money;
  S.missionIdx = d.missionIdx ?? 0;
  S.storyDone = !!d.storyDone;
  S.ammo = Object.assign(S.ammo, d.ammo || {});
  S.owned = Object.assign(S.owned, d.owned || {});
  S.houseOwned = !!d.houseOwned;
  S.health = Math.max(30, d.health ?? 100);
  S.armor = d.armor ?? 0;
  S.weapon = typeof d.weapon === 'string' ? d.weapon : 'PISTOL';
  S.gameMinutes = d.gameMinutes ?? 12 * 60;
  if (typeof d.px === 'number' && d.px > LAND.x0 && d.px < LAND.x1 && d.pz > LAND.z0 && d.pz < LAND.z1) {
    S.px = d.px; S.pz = d.pz; S.heading = d.heading ?? 0;
  } else { S.px = SPAWN.x; S.pz = SPAWN.z; S.heading = SPAWN.heading; }
  return true;
}
