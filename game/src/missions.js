// missions.js — the five story missions with NPC dialogue and coloured
// objective markers, plus the repeatable delivery and ojol (ride-hailing)
// side jobs that arrive by phone. Story order is fixed; side jobs fill the
// gaps. All dialogue is original and in English.

import * as THREE from '../vendor/three.module.min.js';
import { makePerson, idlePose } from './people.js';
import { NODES, EDGES } from './layout.js';

const GOLD = 0xffc93f, CYAN = 0x3fd2ff, RED = 0xff5040;

export function createMissions(ctx) {
  const { scene, S } = ctx;
  const npcs = {};
  function addNpc(key, x, z, h, opts = {}) {
    const p = makePerson(opts);
    p.g.position.set(x, 0, z); p.g.rotation.y = h;
    scene.add(p.g);
    npcs[key] = { p, x, z, h, key };
    return npcs[key];
  }
  addNpc('haji1', 8, -866, Math.PI, { shirt: 0xe8e8e8, head: 'peci' });
  addNpc('sari', 58, 252, -Math.PI / 2, { shirt: 0x3dd97a, head: 'hijab' });
  addNpc('rider', 48, 44, -2.4, { shirt: 0xd94f3d, head: 'cap' });
  addNpc('haji2', -63, -143, Math.PI / 2, { shirt: 0xe8e8e8, head: 'peci' });

  let active = null;   // story mission in progress
  let job = null;      // side job in progress or offered
  let jobOfferT = 45;  // first offer comes less than a minute in
  let idleT = 0;

  const MISSIONS = [
    {
      title: 'FIRST WHEELS', npc: 'haji1', reward: 150000,
      intro: [
        ['PAK HAJI', 'Peace be upon you, young one. You look like someone who can drive.'],
        ['PAK HAJI', 'My old legs cannot cross this city any more. Take me to Bundaran HI — the big roundabout with the fountain.'],
        ['YOU', 'Hop in, Pak. I will get you there.'],
      ],
      stages: [{ x: 24, z: 30, label: 'Take Pak Haji to Bundaran HI', color: GOLD }],
      outro: [
        ['PAK HAJI', 'Ah, the fountain. Fifty years in this city and it still makes me smile.'],
        ['PAK HAJI', 'Take this for your trouble. And keep the car — a friend at the hospital owes me a favour, she may need a driver too.'],
      ],
    },
    {
      title: 'THE HOUSE CALL', npc: 'sari', reward: 200000,
      intro: [
        ['SARI', 'You are the driver Pak Haji mentioned? Good. I am Sari, I work at the hospital.'],
        ['SARI', 'My grandmother is waiting at the Grand Mosque and her medicine is in my bag. Please — she cannot wait long.'],
        ['YOU', 'Eighty seconds of traffic lights cannot stop us. Let us go.'],
      ],
      stages: [{ x: 185, z: -171, label: 'Take Sari to the Grand Mosque', color: GOLD, timer: 80 }],
      outro: [
        ['SARI', 'You made it. Grandmother, your medicine — and this is the driver I told you about.'],
        ['SARI', 'Take this. The city is kinder than people say, when the right driver is working.'],
      ],
    },
    {
      title: 'RUSH HOUR', npc: 'rider', reward: 175000,
      intro: [
        ['PASSENGER', 'Driver! My motorbike died right here at the roundabout. I need the BENGKEL workshop — my tools are there.'],
        ['PASSENGER', 'Rush hour is coming and every minute costs me money. Step on it!'],
      ],
      stages: [{ x: 215, z: 505, label: 'Take the passenger to BENGKEL', color: GOLD }],
      outro: [
        ['PASSENGER', 'Ha! Faster than the busway. Here — worth every rupiah.'],
        ['PASSENGER', 'The boys at the workshop will look after your car, driver rates. Remember that.'],
      ],
    },
    {
      title: 'THE COURIER', npc: null, reward: 300000,
      intro: [
        ['PHONE', 'Unknown number: "Driver. A parcel at the workshop needs legs. Hit every checkpoint, in order, before the clock dies."'],
        ['PHONE', '"Bundaran HI. The avenue lights. The stadium gate. Then back to the fountain. Do not keep the city waiting."'],
      ],
      stages: [
        { x: 24, z: 30, label: 'Checkpoint 1 — Bundaran HI', color: RED, timer: 260 },
        { x: 8, z: 488, label: 'Checkpoint 2 — Semanggi flyover', color: RED },
        { x: -330, z: 742, label: 'Checkpoint 3 — GBK Stadium gate', color: RED },
        { x: 24, z: 30, label: 'Final checkpoint — Bundaran HI', color: RED },
      ],
      outro: [
        ['PHONE', '"Clean run. The parcel was never the point — the route was. Money sent."'],
      ],
    },
    {
      title: 'HEAT RUN', npc: 'haji2', reward: 500000,
      intro: [
        ['PAK HAJI', 'We meet again, driver — in front of the police station, of all places.'],
        ['PAK HAJI', 'A package waits at Monas, by the monument. Bring it to the workshop. If the police ask questions... drive faster than the questions.'],
        ['YOU', 'Pak, one day you will tell me what is in these packages.'],
        ['PAK HAJI', 'One day, driver. One day.'],
      ],
      stages: [
        { x: 20, z: -972, label: 'Pick up the package at Monas', color: GOLD },
        { x: 215, z: 505, label: 'Lose the heat — deliver to BENGKEL', color: RED, onArrive: 'heat' },
      ],
      outro: [
        ['PAK HAJI', 'Delivered, and not a scratch on you. Jakarta has a new legend, driver.'],
        ['PAK HAJI', 'This city is yours now. The jobs will keep coming — they always do.'],
      ],
    },
  ];

  function startMission(i) {
    const m = MISSIONS[i];
    active = { i, stage: 0, timer: m.stages[0].timer || 0 };
    ctx.dialog(m.intro, () => {});
    ctx.banner(m.title, 'Story mission');
    ctx.sfx('mission');
  }
  function completeMission() {
    const m = MISSIONS[active.i];
    S.money += m.reward;
    ctx.sfx('cash');
    const finish = () => {
      ctx.banner('MISSION PASSED', m.title + '  ·  +Rp ' + m.reward.toLocaleString('en-US'));
      S.missionIdx++;
      if (S.missionIdx >= MISSIONS.length) { S.storyDone = true; ctx.banner('STORY COMPLETE', 'Jakarta City is yours — side jobs continue'); }
      active = null;
    };
    if (m.outro) ctx.dialog(m.outro, finish); else finish();
  }
  function failMission(reason) {
    if (!active) return;
    ctx.banner('MISSION FAILED', reason);
    ctx.sfx('fail');
    active = null;
  }

  // ---------- side jobs ----------
  function randomNodeOnRoad(minW = 12) {
    for (let tries = 0; tries < 40; tries++) {
      const e = EDGES[Math.floor(Math.random() * EDGES.length)];
      if (e.w < minW) continue;
      const n = Math.random() < 0.5 ? e.a : e.b;
      return { x: NODES[n].x, z: NODES[n].z };
    }
    return { x: 24, z: 30 };
  }
  function offerJob() {
    if (job || active) return;
    const type = Math.random() < 0.5 ? 'delivery' : 'ojol';
    const from = randomNodeOnRoad(), to = randomNodeOnRoad();
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const pay = Math.round((45000 + dist * 55) / 1000) * 1000;
    job = { type, stage: 0, from, to, pay, expireT: 75 };
    ctx.toast(type === 'delivery' ? 'PHONE: New delivery job — follow the cyan marker' : 'PHONE: Ojol pickup — follow the cyan marker');
    ctx.sfx('phone');
  }
  function completeJob() {
    S.money += job.pay;
    ctx.sfx('cash');
    ctx.banner(job.type === 'delivery' ? 'DELIVERY DONE' : 'PASSENGER DELIVERED', '+Rp ' + job.pay.toLocaleString('en-US'));
    job = null;
    jobOfferT = 70 + Math.random() * 60;
  }

  // ---------- per-frame ----------
  function getObjective() {
    if (active) {
      const st = MISSIONS[active.i].stages[active.stage];
      return { x: st.x, z: st.z, label: st.label, color: st.color, timer: active.timer > 0 ? active.timer : 0 };
    }
    if (job) {
      const t = job.stage === 0 ? job.from : job.to;
      return {
        x: t.x, z: t.z, color: CYAN,
        label: job.stage === 0
          ? (job.type === 'delivery' ? 'Pick up the parcel' : 'Pick up the ojol passenger')
          : (job.type === 'delivery' ? 'Deliver the parcel' : 'Drop off the passenger'),
        timer: 0,
      };
    }
    if (!S.storyDone) {
      const m = MISSIONS[S.missionIdx];
      if (m.npc) { const n = npcs[m.npc]; return { x: n.x, z: n.z, label: 'Talk — ' + m.title, color: GOLD, timer: 0, talk: true }; }
      return { x: 215, z: 505, label: 'Go to BENGKEL — ' + m.title, color: GOLD, timer: 0, talk: true };
    }
    return null;
  }
  function update(dt) {
    idleT += dt;
    // idle animation + visibility of the story NPCs
    for (const k in npcs) {
      const n = npcs[k];
      idlePose(n.p, idleT + n.x);
      const m = MISSIONS[S.missionIdx];
      const shouldShow = !S.storyDone && !active && m && m.npc === k;
      n.p.g.visible = !!shouldShow;
    }
    const pl = ctx.playerPos();
    if (active) {
      const st = MISSIONS[active.i].stages[active.stage];
      if (st.timer && active.stage === 0) { /* timer set at start */ }
      if (active.timer > 0) {
        active.timer -= dt;
        if (active.timer <= 0) { failMission('Out of time'); return; }
      }
      if (Math.hypot(pl.x - st.x, pl.z - st.z) < 7) {
        if (st.onArrive === 'heat') ctx.addHeat(180);
        active.stage++;
        if (active.stage >= MISSIONS[active.i].stages.length) completeMission();
        else {
          const nx = MISSIONS[active.i].stages[active.stage];
          if (nx.timer) active.timer = nx.timer;
          ctx.toast(nx.label);
        }
      }
    } else if (job) {
      const t = job.stage === 0 ? job.from : job.to;
      if (job.stage === 0) {
        job.expireT -= dt;
        if (job.expireT <= 0) { job = null; jobOfferT = 50; ctx.toast('Job offer expired'); }
      }
      if (Math.hypot(pl.x - t.x, pl.z - t.z) < 7) {
        if (job.stage === 0) {
          job.stage = 1;
          ctx.toast(job.type === 'delivery' ? 'Parcel collected — deliver it' : 'Passenger aboard — go!');
          ctx.sfx('cash');
        } else completeJob();
      }
    } else if (S.storyDone) {
      // story finished: the phone keeps offering side work
      jobOfferT -= dt;
      if (jobOfferT <= 0) offerJob();
    }
  }

  // called by main when the player presses the interact key
  function tryInteract() {
    if (active || S.storyDone) return false;
    const m = MISSIONS[S.missionIdx];
    const pl = ctx.playerPos();
    if (m.npc) {
      const n = npcs[m.npc];
      if (Math.hypot(pl.x - n.x, pl.z - n.z) < 4.2) { startMission(S.missionIdx); return true; }
    } else if (Math.hypot(pl.x - 215, pl.z - 505.5) < 4.5) {
      startMission(S.missionIdx); return true;
    }
    return false;
  }

  return { update, getObjective, tryInteract, failMission, npcs, isActive: () => !!active };
}
