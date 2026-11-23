// hud.js — the SA-style interface: money, clock, wanted stars, health and
// armour bars, weapon and ammo, objective line with distance, area-entry
// banner, toasts, prompts, dialogue box, mission banner, speedometer,
// radio ticker, a rotating-blip minimap and the full world map. Both maps
// are painted from layout.js data, never from a picture.

import { ROAD_SEGS, PARKS, KAMPUNGS, PLACES, ROUNDABOUT, LAND, zoneName } from './layout.js';

const $ = id => document.getElementById(id);

export function createHud(S) {
  const el = {
    money: $('money'), clock: $('clock'), stars: $('stars'),
    health: $('healthfill'), armor: $('armorfill'), armorRow: $('armorbar'),
    weapon: $('weapon'), ammo: $('ammo'), objective: $('objective'),
    zone: $('zone'), toast: $('toast'), prompt: $('prompt'),
    dialog: $('dialog'), dlgWho: $('dlg-who'), dlgText: $('dlg-text'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    speedo: $('speedo'), speedVal: $('speed-val'), radioText: $('radio-text'), radioStation: $('radio-station'),
    minimap: $('minimap'), worldmap: $('worldmap'), mapwrap: $('mapwrap'),
    dmg: $('dmg'), endcard: $('endcard'), endTitle: $('end-title'), endSub: $('end-sub'),
    weather: $('weather'),
  };
  const mm = el.minimap.getContext('2d');
  const wm = el.worldmap.getContext('2d');
  let toastT = 0, bannerT = 0, zoneT = 0, tickerX = 0;
  let dialogLines = null, dialogIdx = 0, dialogCb = null;
  let mapOpen = false;

  function toast(msg, secs = 3.4) {
    el.toast.textContent = msg;
    el.toast.style.opacity = 1;
    toastT = secs;
  }
  function banner(title, sub = '') {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.style.opacity = 1;
    bannerT = 3.2;
  }
  function setZone(name) {
    if (el.zone.textContent === name && zoneT > 0) return;
    el.zone.textContent = name;
    el.zone.style.opacity = 1;
    zoneT = 2.6;
  }
  function showPrompt(text) {
    if (text) { el.prompt.textContent = text; el.prompt.style.opacity = 1; }
    else el.prompt.style.opacity = 0;
  }
  function dialog(lines, cb) {
    dialogLines = lines; dialogIdx = 0; dialogCb = cb || null;
    renderDialog();
    el.dialog.style.display = 'block';
  }
  function renderDialog() {
    if (!dialogLines) return;
    el.dlgWho.textContent = dialogLines[dialogIdx][0];
    el.dlgText.textContent = dialogLines[dialogIdx][1];
  }
  function advanceDialog() {
    if (!dialogLines) return false;
    dialogIdx++;
    if (dialogIdx >= dialogLines.length) {
      dialogLines = null;
      el.dialog.style.display = 'none';
      if (dialogCb) { const cb = dialogCb; dialogCb = null; cb(); }
    } else renderDialog();
    return true;
  }
  function showEnd(kind, sub) {
    el.endTitle.textContent = kind;
    el.endTitle.style.color = kind === 'BUSTED' ? '#5f8dff' : '#ff5040';
    el.endSub.textContent = sub;
    el.endcard.style.display = 'flex';
  }
  function hideEnd() { el.endcard.style.display = 'none'; }
  function toggleMap(force) {
    mapOpen = force !== undefined ? force : !mapOpen;
    el.mapwrap.style.display = mapOpen ? 'flex' : 'none';
    return mapOpen;
  }

  // ---------- minimap (north-up, player-centred) ----------
  function drawMinimap(px, pz, heading, objective, police) {
    const W = el.minimap.width, H = el.minimap.height, view = 340; // metres across
    const sc = W / view, cx = W / 2, cy = H / 2;
    mm.fillStyle = '#20301e'; mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#2a6ea3';
    if (pz - view / 2 < -1176) mm.fillRect(0, 0, W, ((-1176) - (pz - view / 2)) * sc);
    if (pz - view / 2 < -1240) mm.fillRect(0, 0, W, H);
    mm.strokeStyle = '#565e66'; mm.lineCap = 'round';
    for (const s of ROAD_SEGS) {
      mm.lineWidth = Math.max(1.5, s.w * sc * 0.8);
      mm.beginPath();
      mm.moveTo(cx + (s.x0 - px) * sc, cy + (s.z0 - pz) * sc);
      mm.lineTo(cx + (s.x1 - px) * sc, cy + (s.z1 - pz) * sc);
      mm.stroke();
    }
    mm.fillStyle = '#4e7a30';
    for (const p of PARKS) mm.fillRect(cx + (p.x0 - px) * sc, cy + (p.z0 - pz) * sc, (p.x1 - p.x0) * sc, (p.z1 - p.z0) * sc);
    // police blips flash blue/red
    if (S.wanted > 0 && police) {
      const flash = Math.floor(performance.now() / 300) % 2 === 0;
      mm.fillStyle = flash ? '#3d6bff' : '#ff4030';
      const dots = [...(police.officers || []), ...(police.cars || [])];
      for (const o of dots) {
        if (o.dead) continue;
        const dx = cx + (o.x - px) * sc, dy = cy + (o.z - pz) * sc;
        if (dx < -4 || dy < -4 || dx > W + 4 || dy > H + 4) continue;
        mm.beginPath(); mm.arc(dx, dy, 3, 0, 7); mm.fill();
      }
    }
    // objective blip, clamped to the rim
    if (objective) {
      let dx = (objective.x - px) * sc, dy = (objective.z - pz) * sc;
      const d = Math.hypot(dx, dy), max = W / 2 - 8;
      if (d > max) { dx *= max / d; dy *= max / d; }
      mm.fillStyle = '#ffc93f';
      mm.beginPath(); mm.arc(cx + dx, cy + dy, 4.5, 0, 7); mm.fill();
      mm.strokeStyle = '#000'; mm.lineWidth = 1; mm.stroke();
    }
    // player arrow
    mm.save();
    mm.translate(cx, cy); mm.rotate(heading);
    mm.fillStyle = '#ffffff';
    mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(4.6, 5); mm.lineTo(0, 2.4); mm.lineTo(-4.6, 5); mm.closePath(); mm.fill();
    mm.restore();
    mm.fillStyle = '#fff'; mm.font = 'bold 11px Arial'; mm.fillText('N', cx - 3, 13);
  }

  // ---------- full world map ----------
  function drawWorldMap(px, pz, heading, objective) {
    const W = el.worldmap.width, H = el.worldmap.height;
    const sc = Math.min(W / 1750, H / 2450);
    const ox = W / 2, oy = H / 2 + 40;
    const X = x => ox + x * sc, Y = z => oy + z * sc;
    wm.fillStyle = '#1d4e6b'; wm.fillRect(0, 0, W, H);
    wm.fillStyle = '#d9c28a'; wm.fillRect(X(-800), Y(-1260), 1600 * sc, 2320 * sc);
    wm.fillStyle = '#5d7038'; wm.fillRect(X(LAND.x0), Y(LAND.z0), (LAND.x1 - LAND.x0) * sc, (LAND.z1 - LAND.z0) * sc);
    wm.fillStyle = '#4e7a30';
    for (const p of PARKS) wm.fillRect(X(p.x0), Y(p.z0), (p.x1 - p.x0) * sc, (p.z1 - p.z0) * sc);
    wm.strokeStyle = '#4a5058'; wm.lineCap = 'round';
    for (const s of ROAD_SEGS) {
      wm.lineWidth = Math.max(1, s.w * sc * 0.85);
      wm.beginPath(); wm.moveTo(X(s.x0), Y(s.z0)); wm.lineTo(X(s.x1), Y(s.z1)); wm.stroke();
    }
    wm.strokeStyle = '#4a5058'; wm.lineWidth = Math.max(1, 18 * sc);
    wm.beginPath(); wm.arc(X(ROUNDABOUT.x), Y(ROUNDABOUT.z), ROUNDABOUT.r * sc, 0, 7); wm.stroke();
    wm.fillStyle = '#20301e';
    wm.font = 'bold 12px Arial'; wm.textAlign = 'center';
    const labels = [['Monas', 0, -1030], ['Bundaran HI', 0, 86], ['Kota Tua', -450, -1080], ['Menteng', 380, -330], ['Kuningan', 400, 60], ['Grogol', -450, -350], ['Senayan — GBK', -330, 560], ['Blok M', 110, 880], ['Kampung Barat', -590, 600], ['Kampung Melayu', 570, 690], ['Pelabuhan', 610, -1075], ['Pantai Ancol', -450, -1210], ['Thamrin', 0, -500], ['Sudirman', 0, 420]];
    for (const [t, x, z] of labels) wm.fillText(t, X(x), Y(z));
    // place markers
    wm.font = 'bold 11px Arial';
    for (const k in PLACES) {
      const p = PLACES[k];
      wm.fillStyle = '#ffc93f';
      wm.beginPath(); wm.arc(X(p.px), Y(p.pz), 4, 0, 7); wm.fill();
    }
    if (objective) {
      wm.fillStyle = '#ff5040';
      wm.beginPath(); wm.arc(X(objective.x), Y(objective.z), 6, 0, 7); wm.fill();
      wm.strokeStyle = '#fff'; wm.lineWidth = 1.5; wm.stroke();
    }
    wm.save();
    wm.translate(X(px), Y(pz)); wm.rotate(heading);
    wm.fillStyle = '#fff';
    wm.beginPath(); wm.moveTo(0, -8); wm.lineTo(5, 6); wm.lineTo(0, 3); wm.lineTo(-5, 6); wm.closePath(); wm.fill();
    wm.restore();
    wm.fillStyle = '#fff'; wm.font = 'bold 17px Arial'; wm.textAlign = 'left';
    wm.fillText('JAKARTA CITY — WORLD MAP', 16, 28);
    wm.font = '12px Arial';
    wm.fillText('Yellow dots: services & landmarks · Red dot: objective · M or ✕ to close', 16, 48);
  }

  // ---------- per-frame refresh ----------
  function update(dt, info) {
    const hh = Math.floor(S.gameMinutes / 60) % 24, mnt = Math.floor(S.gameMinutes % 60);
    el.clock.textContent = String(hh).padStart(2, '0') + ':' + String(mnt).padStart(2, '0');
    el.money.textContent = 'Rp ' + Math.max(0, Math.floor(S.money)).toLocaleString('en-US');
    el.stars.textContent = S.wanted > 0 ? '★'.repeat(S.wanted) : '';
    el.stars.style.color = Math.floor(performance.now() / 350) % 2 ? '#ffc93f' : '#ff5040';
    el.health.style.width = Math.max(0, S.health) + '%';
    el.health.style.background = S.health < 30 ? '#ff5040' : '#e33f2e';
    el.armorRow.style.display = S.armor > 0 ? 'block' : 'none';
    el.armor.style.width = Math.max(0, S.armor) + '%';
    el.weapon.textContent = S.weapon;
    const ammo = S.ammo[S.weapon];
    el.ammo.textContent = ammo === undefined ? '' : (ammo === Infinity ? '∞' : ammo);
    if (info.objective) {
      const d = Math.round(Math.hypot(info.objective.x - info.px, info.objective.z - info.pz));
      el.objective.textContent = '◎ ' + info.objective.label + ' · ' + d + ' m' +
        (info.objective.timer > 0 ? ' · ' + Math.ceil(info.objective.timer) + ' s' : '');
      el.objective.style.opacity = 1;
    } else el.objective.style.opacity = 0;
    // speedometer + radio only make sense in a vehicle
    const driving = info.mode === 'car' || info.mode === 'boat';
    el.speedo.style.display = driving ? 'block' : 'none';
    if (driving) el.speedVal.textContent = Math.round(Math.abs(info.speed || 0) * 3.6);
    $('radio').style.display = driving ? 'block' : 'none';
    if (info.station) el.radioStation.textContent = info.station;
    if (info.ticker) {
      tickerX -= dt * 42;
      const w = el.radioText.scrollWidth || 300;
      if (tickerX < -w) tickerX = 190;
      el.radioText.style.transform = 'translateX(' + tickerX + 'px)';
      el.radioText.textContent = info.ticker;
    }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.style.opacity = 0; }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.style.opacity = 0; }
    if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) el.zone.style.opacity = 0; }
    el.dmg.style.opacity = Math.max(0, parseFloat(el.dmg.style.opacity || 0) - dt * 1.6);
    drawMinimap(info.px, info.pz, info.heading, info.objective, info.police);
    if (mapOpen) drawWorldMap(info.px, info.pz, info.heading, info.objective);
  }
  function damageFlash() { el.dmg.style.opacity = 0.55; }

  return {
    update, toast, banner, setZone, showPrompt, dialog, advanceDialog,
    dialogOpen: () => !!dialogLines, showEnd, hideEnd, toggleMap,
    isMapOpen: () => mapOpen, damageFlash,
  };
}
export { zoneName };
