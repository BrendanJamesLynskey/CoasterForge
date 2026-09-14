import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

/* ---------------------------------------------------------------------
   MATH HELPERS
--------------------------------------------------------------------- */
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function normalize180(a) { return ((a + 180) % 360 + 360) % 360 - 180; }
function arc(radius, angleDeg) { return radius * Math.abs(angleDeg) * DEG; }
function helixLen(radius, turns, climbDeg) { return turns * 2 * Math.PI * radius / Math.cos(climbDeg * DEG); }

/* ---------------------------------------------------------------------
   COASTER LAYOUT PRESETS
   Every segment advances the ride by `length` metres. thetaTo is the
   pitch angle (deg, +up) to ease toward; psiTotal is the heading change
   (deg) over the segment (constant-radius arc); bankTo is the target
   roll/bank angle (deg). Unset fields hold their previous value, so a
   whole ride is authored as one continuous chain — every join is C1
   continuous by construction (see buildTrack).
--------------------------------------------------------------------- */
const PRESETS = {
  wildmouse: {
    name: 'Wild Mouse',
    segs: [
      { length: 6, tag: 'station' },
      { length: 15, thetaTo: 42, tag: 'lift' },
      { length: 3, thetaTo: 0 },
      { length: 7, thetaTo: -48 },
      { length: 4, thetaTo: 0 },
      { length: arc(3.2, 95), psiTotal: 95, bankTo: 8 },
      { length: 3, bankTo: 0 },
      { length: 5, thetaTo: -15 },
      { length: arc(3.2, -110), psiTotal: -110, bankTo: -8 },
      { length: 3, bankTo: 0, thetaTo: 0 },
      { length: arc(3, 130), psiTotal: 130, bankTo: 10 },
      { length: 3, bankTo: 0 },
      { length: 4, thetaTo: -10 },
      { length: arc(3.5, -140), psiTotal: -140, bankTo: -10 },
      { length: 3, bankTo: 0, thetaTo: 0 },
      { length: 6, thetaTo: 0, tag: 'brake' },
      { length: 5, thetaTo: 0, tag: 'station' },
    ],
  },
  outback: {
    name: 'Out & Back',
    segs: [
      { length: 6, tag: 'station' },
      { length: 32, thetaTo: 28, tag: 'lift' },
      { length: 4, thetaTo: 0 },
      { length: 26, thetaTo: -45 },
      { length: 6, thetaTo: 5 },
      { length: 10, kind: 'hump', thetaPeak: 22 },
      { length: 8, thetaTo: 0 },
      { length: arc(15, 180), psiTotal: 180, bankTo: 32 },
      { length: 5, bankTo: 0, thetaTo: 0 },
      { length: 9, kind: 'hump', thetaPeak: 16 },
      { length: 6, thetaTo: 0 },
      { length: arc(10, -90), psiTotal: -90, bankTo: -22 },
      { length: 4, bankTo: 0 },
      { length: 8, thetaTo: 0, tag: 'brake' },
      { length: 5, thetaTo: 0, tag: 'station' },
    ],
  },
  looping: {
    name: 'Looper',
    segs: [
      { length: 6, tag: 'station' },
      { length: 26, thetaTo: 30, tag: 'lift' },
      { length: 4, thetaTo: 0 },
      { length: 20, thetaTo: -40 },
      { length: 6, thetaTo: 0 },
      { length: 2 * Math.PI * 8, thetaDelta: 360, tag: 'loop', verticalPassThrough: true },
      { length: 6, thetaTo: 0 },
      { length: arc(9, 110), psiTotal: 110, bankTo: 28 },
      { length: 4, bankTo: 0, thetaTo: 0 },
      { length: helixLen(5, 1.15, 8), thetaTo: 8, psiTotal: 360 * 1.15, psiLinear: true, bankDelta: 360 * 1.15, bankLinear: true, tag: 'helix' },
      { length: 4, thetaTo: 0, bankTo: 0 },
      { length: 8, thetaTo: 0, tag: 'brake' },
      { length: 5, thetaTo: 0, tag: 'station' },
    ],
  },
  family: {
    name: 'Family Coaster',
    segs: [
      { length: 6, tag: 'station' },
      { length: 10, thetaTo: 14, tag: 'lift' },
      { length: 3, thetaTo: 0 },
      { length: 9, thetaTo: -16 },
      { length: 4, thetaTo: 0 },
      { length: arc(10, 110), psiTotal: 110, bankTo: 15 },
      { length: 4, bankTo: 0 },
      { length: 6, kind: 'hump', thetaPeak: 8 },
      { length: 4, thetaTo: 0 },
      { length: arc(9, -130), psiTotal: -130, bankTo: -15 },
      { length: 4, bankTo: 0, thetaTo: 0 },
      { length: 7, thetaTo: 0, tag: 'brake' },
      { length: 5, thetaTo: 0, tag: 'station' },
    ],
  },
};

/* ---------------------------------------------------------------------
   TRACK BUILDER — turns a segment chain into a dense polyline with a
   moving orthonormal frame (fwd/right/up) at every sample. Position and
   heading come from numerically stepping a pitch(theta)/yaw(psi)
   spherical direction, so straights, hills, turns, loops and corkscrews
   all fall out of the same integrator. Banking rotates the (right,up)
   pair about the tangent only — it never perturbs the centreline.
--------------------------------------------------------------------- */
function buildTrack(segments, dsTarget = 0.35) {
  const worldUp = new THREE.Vector3(0, 1, 0);
  let pos = new THREE.Vector3(0, 0, 0);
  let thetaDeg = 0, psiDeg = 0, bankDeg = 0, s = 0;
  const samples = [];

  function frameAt(fwd, bankDegVal, fixedRight) {
    let right, up;
    if (fixedRight) {
      up = new THREE.Vector3().crossVectors(fixedRight, fwd).normalize();
      right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    } else {
      right = new THREE.Vector3().crossVectors(worldUp, fwd);
      if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
      right.normalize();
      up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    }
    const q = new THREE.Quaternion().setFromAxisAngle(fwd, bankDegVal * DEG);
    right.applyQuaternion(q);
    up.applyQuaternion(q);
    return { right, up };
  }

  {
    const fwd0 = new THREE.Vector3(0, 0, 1);
    const { right, up } = frameAt(fwd0, 0, null);
    samples.push({ pos: pos.clone(), fwd: fwd0, right, up, s, thetaDeg, psiDeg, bankDeg, tag: 'station' });
  }

  for (const seg of segments) {
    const thetaFrom = thetaDeg;
    const thetaTo = seg.kind === 'hump' ? thetaFrom
      : (seg.thetaDelta !== undefined ? thetaFrom + seg.thetaDelta
      : (seg.thetaTo !== undefined ? seg.thetaTo : thetaFrom));
    const thetaPeak = seg.thetaPeak !== undefined ? seg.thetaPeak : thetaFrom;
    const psiFrom = psiDeg;
    const psiTotal = seg.psiTotal || 0;
    const bankFrom = bankDeg;
    const bankTo = seg.bankDelta !== undefined ? bankFrom + seg.bankDelta
      : (seg.bankTo !== undefined ? seg.bankTo : bankFrom);
    const entryRight = samples[samples.length - 1].right.clone();
    const N = Math.max(4, Math.ceil(seg.length / dsTarget));
    const ds = seg.length / N;

    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const th = seg.kind === 'hump'
        ? thetaFrom + (thetaPeak - thetaFrom) * Math.sin(Math.PI * u)
        : lerp(thetaFrom, thetaTo, smoothstep(u));
      // yaw eases in/out like a real spiral (clothoid) transition by default —
      // a plain linear ramp gives constant curvature but *jumps* to it instantly
      // at the join, which is the "kinked" look real easement curves avoid.
      // psiLinear opts back into a constant-rate sweep (e.g. a uniform corkscrew).
      const ps = psiFrom + psiTotal * (seg.psiLinear ? u : smoothstep(u));
      const bk = seg.bankLinear ? lerp(bankFrom, bankTo, u) : lerp(bankFrom, bankTo, smoothstep(u));
      const thR = th * DEG, psR = ps * DEG;
      const fwd = new THREE.Vector3(Math.sin(psR) * Math.cos(thR), Math.sin(thR), Math.cos(psR) * Math.cos(thR));
      pos = pos.clone().addScaledVector(fwd, ds);
      s += ds;
      const { right, up } = frameAt(fwd, bk, seg.verticalPassThrough ? entryRight : null);
      samples.push({ pos: pos.clone(), fwd, right, up, s, thetaDeg: th, psiDeg: ps, bankDeg: bk, tag: seg.tag || null });
    }
    thetaDeg = normalize180(thetaTo);
    psiDeg = psiFrom + psiTotal;
    bankDeg = normalize180(bankTo);
  }
  return samples;
}

/* ---------------------------------------------------------------------
   PHYSICS — simplified point-mass energy model in real-world metres.
   Lift segments run at constant chain speed; brakes decelerate toward
   a target exit speed; everywhere else trades height for speed against
   rolling friction. G-forces come from the curvature of the pitch (theta)
   and heading (psi) traces already carried on every sample.
--------------------------------------------------------------------- */
function simulatePhysics(samplesM, p) {
  const g = 9.81;
  const N = samplesM.length;
  const v = new Float32Array(N), gVert = new Float32Array(N), gLat = new Float32Array(N), gTotal = new Float32Array(N);
  v[0] = 1.0;
  for (let i = 1; i < N; i++) {
    const a = samplesM[i - 1], b = samplesM[i];
    const ds = Math.max(1e-6, a.pos.distanceTo(b.pos));
    const dh = b.pos.y - a.pos.y;
    if (b.tag === 'lift') {
      v[i] = p.liftSpeed;
    } else if (b.tag === 'brake') {
      v[i] = Math.max(p.brakeExitSpeed, v[i - 1] - p.brakeDecel * ds);
    } else {
      const frictionLoss = p.friction * g * 2 * ds;
      const vSq = Math.max(0.25, v[i - 1] * v[i - 1] - 2 * g * dh - frictionLoss);
      v[i] = Math.sqrt(vSq);
    }
  }
  for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
    const ds2 = Math.max(1e-6, samplesM[i1].s - samplesM[i0].s);
    // wrap to the shortest angular step: raw subtraction spikes ~360deg/ds right
    // after a loop, where theta crosses back through its normalized origin
    const kVert = normalize180(samplesM[i1].thetaDeg - samplesM[i0].thetaDeg) * DEG / ds2;
    const kLat = normalize180(samplesM[i1].psiDeg - samplesM[i0].psiDeg) * DEG / ds2;
    const aVert = v[i] * v[i] * kVert;
    const aLat = v[i] * v[i] * kLat;
    gVert[i] = (g + aVert) / g;
    gLat[i] = aLat / g;
    gTotal[i] = Math.sqrt(gVert[i] * gVert[i] + gLat[i] * gLat[i]);
  }
  return { v, gVert, gLat, gTotal };
}

/* ---------------------------------------------------------------------
   LOW-LEVEL GEOMETRY BUILDERS
--------------------------------------------------------------------- */
function tubeGeometry(samples, i0, i1, offsetFn, radius, radialSeg = 10) {
  const n = i1 - i0 + 1;
  const positions = [], idx = [];
  for (let k = 0; k < n; k++) {
    const s = samples[i0 + k];
    const c = offsetFn(s);
    for (let j = 0; j < radialSeg; j++) {
      const phi = (j / radialSeg) * Math.PI * 2;
      const cx = Math.cos(phi), sx = Math.sin(phi);
      positions.push(
        c.x + (cx * s.up.x + sx * s.right.x) * radius,
        c.y + (cx * s.up.y + sx * s.right.y) * radius,
        c.z + (cx * s.up.z + sx * s.right.z) * radius
      );
    }
  }
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < radialSeg; j++) {
      const j2 = (j + 1) % radialSeg;
      const a = k * radialSeg + j, b = k * radialSeg + j2, c = (k + 1) * radialSeg + j, d = (k + 1) * radialSeg + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const startCenter = positions.length / 3;
  { const c = offsetFn(samples[i0]); positions.push(c.x, c.y, c.z); }
  for (let j = 0; j < radialSeg; j++) idx.push(startCenter, (j + 1) % radialSeg, j);
  const endCenter = positions.length / 3;
  { const c = offsetFn(samples[i1]); positions.push(c.x, c.y, c.z); }
  const ringOff = (n - 1) * radialSeg;
  for (let j = 0; j < radialSeg; j++) idx.push(endCenter, ringOff + j, ringOff + (j + 1) % radialSeg);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function cylinderBetween(p0, p1, diameter, radialSeg = 10) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = Math.max(0.01, dir.length());
  dir.normalize();
  const geo = new THREE.CylinderGeometry(diameter / 2, diameter / 2, len, radialSeg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyQuaternion(q);
  geo.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return geo;
}

function sleeveGeometry(center, axisDir, outerD, innerD, len, radialSeg = 10) {
  const outerR = outerD / 2, innerR = innerD / 2;
  const pos = [], idx = [];
  function ring(y, r) {
    const start = pos.length / 3;
    for (let j = 0; j < radialSeg; j++) {
      const phi = (j / radialSeg) * Math.PI * 2;
      pos.push(Math.cos(phi) * r, y, Math.sin(phi) * r);
    }
    return start;
  }
  const ot = ring(len / 2, outerR), ob = ring(-len / 2, outerR), it = ring(len / 2, innerR), ib = ring(-len / 2, innerR);
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  for (let j = 0; j < radialSeg; j++) {
    const j2 = (j + 1) % radialSeg;
    quad(ot + j, ob + j, ob + j2, ot + j2);
    quad(it + j2, ib + j2, ib + j, it + j);
    quad(ot + j, ot + j2, it + j2, it + j);
    quad(ob + j2, ob + j, ib + j, ib + j2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

function boxAt(sample, atPos, sx, sy, sz) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.fwd);
  geo.applyMatrix4(m);
  geo.translate(atPos.x, atPos.y, atPos.z);
  return geo;
}

function mergeGeometries(geoms) {
  if (!geoms.length) return null;
  let totalPos = 0, totalIdx = 0;
  for (const g of geoms) { totalPos += g.attributes.position.count; totalIdx += g.index.count; }
  const pos = new Float32Array(totalPos * 3);
  const idx = (totalPos > 65535) ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);
  let pOff = 0, iOff = 0, vOff = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, pOff * 3);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[iOff + k] = gi[k] + vOff;
    pOff += g.attributes.position.count;
    iOff += gi.length;
    vOff += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

/* ---------------------------------------------------------------------
   THREE.JS SCENE
--------------------------------------------------------------------- */
const canvasWrap = document.getElementById('canvas-wrap');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
canvasWrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0b0f);
scene.fog = new THREE.Fog(0x0a0b0f, 400, 2200);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
camera.position.set(220, 180, 260);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x11141c, 1.1));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
sun.position.set(300, 500, 200);
scene.add(sun);

const grid = new THREE.GridHelper(2000, 80, 0x2a3040, 0x1a1e28);
scene.add(grid);

function resize() {
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

const MAT = {
  rail: new THREE.MeshStandardMaterial({ color: 0xc9cdd6, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
  lift: new THREE.MeshStandardMaterial({ color: 0xff7a45, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }),
  brake: new THREE.MeshStandardMaterial({ color: 0x4fb3ff, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }),
  tie: new THREE.MeshStandardMaterial({ color: 0x8890a0, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide }),
  support: new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x333844, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide }),
  ground: new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1, side: THREE.DoubleSide }),
};

/* ---------------------------------------------------------------------
   UI STATE
--------------------------------------------------------------------- */
const els = id => document.getElementById(id);
function bindRange(id, lblId, fmt = v => v) {
  const el = els(id), lbl = els(lblId);
  const update = () => { if (lbl) lbl.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', () => { update(); scheduleRegen(); });
  update();
}
['railD', 'gauge', 'tieSp', 'mass', 'fric', 'liftS', 'brakeS', 'suppSp', 'aframe'].forEach(id => {});
bindRange('railD', 'railDLbl', v => v.toFixed(1));
bindRange('gauge', 'gaugeLbl', v => v.toFixed(1));
bindRange('tieSp', 'tieSpLbl', v => v.toFixed(1));
bindRange('mass', 'massLbl', v => v.toFixed(0));
bindRange('fric', 'fricLbl', v => v.toFixed(3));
bindRange('liftS', 'liftSLbl', v => v.toFixed(1));
bindRange('brakeS', 'brakeSLbl', v => v.toFixed(1));
bindRange('suppSp', 'suppSpLbl', v => v.toFixed(1));
bindRange('aframe', 'aframeLbl', v => v.toFixed(0));
bindRange('mmPerM', 'mmPerMLbl', v => v.toFixed(2));

els('scalePreset').addEventListener('change', () => {
  const v = els('scalePreset').value;
  const wrap = els('customScaleWrap');
  if (v === 'custom') { wrap.style.display = ''; }
  else {
    wrap.style.display = 'none';
    els('mmPerM').value = (1000 / parseFloat(v)).toFixed(2);
    els('mmPerMLbl').textContent = els('mmPerM').value;
  }
  scheduleRegen();
});
els('coasterType').addEventListener('change', () => {
  els('builderPanel').style.display = els('coasterType').value === 'custom' ? '' : 'none';
  scheduleRegen();
});
['bedX', 'bedY', 'bedZ', 'suppMin', 'suppMax'].forEach(id => els(id).addEventListener('change', scheduleRegen));
els('regenBtn').addEventListener('click', () => generate());

function getParams() {
  return {
    type: els('coasterType').value,
    mmPerM: parseFloat(els('mmPerM').value),
    bed: new THREE.Vector3(parseFloat(els('bedX').value), parseFloat(els('bedY').value), parseFloat(els('bedZ').value)),
    railD: parseFloat(els('railD').value),
    gauge: parseFloat(els('gauge').value),
    tieSp: parseFloat(els('tieSp').value),
    mass: parseFloat(els('mass').value),
    friction: parseFloat(els('fric').value),
    liftSpeed: parseFloat(els('liftS').value),
    brakeExitSpeed: parseFloat(els('brakeS').value),
    brakeDecel: 1.8,
    suppSpacing: parseFloat(els('suppSp').value),
    suppMin: parseFloat(els('suppMin').value),
    suppMax: parseFloat(els('suppMax').value),
    aframeAt: parseFloat(els('aframe').value),
  };
}

let regenTimer = null;
function scheduleRegen() { clearTimeout(regenTimer); regenTimer = setTimeout(generate, 180); }

function toast(msg) {
  const t = els('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function coasterName(type) { return type === 'custom' ? 'Custom Coaster' : PRESETS[type].name; }

/* ---------------------------------------------------------------------
   TRACK BUILDER (custom mode) — lets a ride be built from scratch, one
   segment at a time, instead of only picking a preset. Every segment
   continues from wherever the chain currently ends (see buildTrack),
   so anything strung together here is automatically continuous.
--------------------------------------------------------------------- */
let customSegments = [];
const CUSTOM_STORE_KEY = 'coasterforge_custom_v1';

function saveCustom() {
  try { localStorage.setItem(CUSTOM_STORE_KEY, JSON.stringify(customSegments)); } catch (e) { /* private mode etc — non-fatal */ }
}
function loadCustom() {
  try {
    const raw = localStorage.getItem(CUSTOM_STORE_KEY);
    if (raw) customSegments = JSON.parse(raw);
  } catch (e) { customSegments = []; }
}

function describeSegment(seg) {
  if (seg._desc) return seg._desc;
  if (seg.tag === 'loop') return `Vertical Loop — R${(seg.length / (2 * Math.PI)).toFixed(1)}m`;
  if (seg.tag === 'helix') return `Corkscrew — ${seg.length.toFixed(0)}m run`;
  if (seg.tag === 'lift') return `Lift Hill — ${seg.length.toFixed(0)}m`;
  if (seg.tag === 'brake') return `Brake Run — ${seg.length.toFixed(0)}m`;
  if (seg.tag === 'station') return `Station — ${seg.length.toFixed(0)}m`;
  if (seg.kind === 'hump') return `Airtime Hill — ${seg.length.toFixed(0)}m`;
  if (seg.psiTotal) return `Curve — ${Math.abs(seg.psiTotal).toFixed(0)}° ${seg.psiTotal > 0 ? 'right' : 'left'}`;
  if (seg.thetaTo !== undefined) return `Climb/Drop — ${seg.length.toFixed(0)}m to ${seg.thetaTo}°`;
  if (seg.bankTo !== undefined) return `Level Bank — ${seg.length.toFixed(0)}m`;
  return `Straight — ${seg.length.toFixed(0)}m`;
}

const SEG_FIELDS = {
  straight: ['length'],
  climb: ['length', 'grade'],
  hill: ['length', 'peak'],
  levelbank: ['length'],
  curve: ['radius', 'angle', 'dir', 'bank'],
  lift: ['length', 'grade'],
  brake: ['length'],
  loop: ['radius'],
  corkscrew: ['radius', 'turns', 'grade', 'dir'],
  station: ['length'],
};
const FIELD_IDS = { length: 'segFieldLength', grade: 'segFieldGrade', peak: 'segFieldPeak', bank: 'segFieldBank', radius: 'segFieldRadius', angle: 'segFieldAngle', turns: 'segFieldTurns', dir: 'segFieldDir' };

function updateAddFields() {
  const active = new Set(SEG_FIELDS[els('addSegType').value]);
  for (const f in FIELD_IDS) els(FIELD_IDS[f]).style.display = active.has(f) ? '' : 'none';
}
els('addSegType').addEventListener('change', updateAddFields);
updateAddFields();

function bindLocalRange(id, lblId, fmt = v => v) {
  const el = els(id), lbl = els(lblId);
  const u = () => { lbl.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', u);
  u();
}
bindLocalRange('segLength', 'segLengthLbl', v => v.toFixed(1));
bindLocalRange('segGrade', 'segGradeLbl', v => v.toFixed(0));
bindLocalRange('segPeak', 'segPeakLbl', v => v.toFixed(0));
bindLocalRange('segBank', 'segBankLbl', v => v.toFixed(0));
bindLocalRange('segRadius', 'segRadiusLbl', v => v.toFixed(1));
bindLocalRange('segAngle', 'segAngleLbl', v => v.toFixed(0));
bindLocalRange('segTurns', 'segTurnsLbl', v => v.toFixed(2));

function readSegForm() {
  return {
    length: parseFloat(els('segLength').value),
    grade: parseFloat(els('segGrade').value),
    peak: parseFloat(els('segPeak').value),
    bank: parseFloat(els('segBank').value),
    radius: parseFloat(els('segRadius').value),
    angle: parseFloat(els('segAngle').value),
    turns: parseFloat(els('segTurns').value),
    direction: els('segDir').value,
  };
}

function makeSegment(type, f) {
  const dir = f.direction === 'left' ? -1 : 1;
  switch (type) {
    case 'straight': return { length: f.length, _desc: `Straight — ${f.length}m` };
    case 'climb': return { length: f.length, thetaTo: f.grade, _desc: `Climb/Drop — ${f.length}m to ${f.grade}°` };
    case 'hill': return { length: f.length, kind: 'hump', thetaPeak: f.peak, _desc: `Airtime Hill — ${f.length}m, peak ${f.peak}°` };
    case 'levelbank': return { length: f.length, bankTo: 0, _desc: `Level Bank — ${f.length}m` };
    case 'curve': return {
      length: arc(f.radius, f.angle), psiTotal: f.angle * dir, bankTo: f.bank * dir,
      _desc: `Curve — R${f.radius}m, ${f.angle}° ${f.direction}, bank ${f.bank}°`,
    };
    case 'lift': return { length: f.length, thetaTo: f.grade, tag: 'lift', _desc: `Lift Hill — ${f.length}m to ${f.grade}°` };
    case 'brake': return { length: f.length, thetaTo: 0, tag: 'brake', _desc: `Brake Run — ${f.length}m` };
    case 'loop': return { length: 2 * Math.PI * f.radius, thetaDelta: 360, tag: 'loop', verticalPassThrough: true, _desc: `Vertical Loop — R${f.radius}m` };
    case 'corkscrew': return {
      length: helixLen(f.radius, f.turns, f.grade), thetaTo: f.grade,
      psiTotal: 360 * f.turns * dir, psiLinear: true, bankDelta: 360 * f.turns * dir, bankLinear: true, tag: 'helix',
      _desc: `Corkscrew — R${f.radius}m, ${f.turns} turn${f.turns === 1 ? '' : 's'} ${f.direction}`,
    };
    case 'station': return { length: f.length, thetaTo: 0, tag: 'station', _desc: `Station — ${f.length}m` };
    default: return { length: f.length };
  }
}

function renderSegList() {
  const list = els('segList');
  if (!customSegments.length) {
    list.innerHTML = '<div class="segempty">Empty — add your first segment below.</div>';
    return;
  }
  list.innerHTML = customSegments.map((seg, i) => `
    <div class="segrow">
      <span><span class="segn">${i + 1}.</span>${describeSegment(seg)}</span>
      <span class="segactions">
        <button data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>&#8593;</button>
        <button data-act="down" data-i="${i}" ${i === customSegments.length - 1 ? 'disabled' : ''}>&#8595;</button>
        <button data-act="del" data-i="${i}">&times;</button>
      </span>
    </div>`).join('');
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i, 10), act = btn.dataset.act;
      if (act === 'del') customSegments.splice(i, 1);
      else if (act === 'up' && i > 0) [customSegments[i - 1], customSegments[i]] = [customSegments[i], customSegments[i - 1]];
      else if (act === 'down' && i < customSegments.length - 1) [customSegments[i + 1], customSegments[i]] = [customSegments[i], customSegments[i + 1]];
      renderSegList();
      saveCustom();
      if (els('coasterType').value === 'custom') generate();
    });
  });
}

els('addSegBtn').addEventListener('click', () => {
  customSegments.push(makeSegment(els('addSegType').value, readSegForm()));
  renderSegList();
  saveCustom();
  if (els('coasterType').value === 'custom') generate();
});

els('startBlankBtn').addEventListener('click', () => {
  customSegments = [];
  renderSegList();
  saveCustom();
  if (els('coasterType').value === 'custom') generate();
  toast('Cleared — build your coaster from scratch');
});

els('loadPresetBtn').addEventListener('click', () => {
  const key = els('loadPresetSelect').value;
  customSegments = JSON.parse(JSON.stringify(PRESETS[key].segs));
  renderSegList();
  saveCustom();
  if (els('coasterType').value === 'custom') generate();
  toast(`Loaded ${PRESETS[key].name} into the builder — edit freely`);
});

loadCustom();
renderSegList();

/* ---------------------------------------------------------------------
   MODEL STATE — rebuilt on every generate()
--------------------------------------------------------------------- */
let sceneGroup = new THREE.Group();
scene.add(sceneGroup);
let groundMesh = null;
let currentModel = null; // { pieceMeshes:[], connectorMeshes:[], supportMeshes:[] }

function generate() {
  const p = getParams();
  const segs = p.type === 'custom' ? customSegments : PRESETS[p.type].segs;
  if (!segs.length) {
    while (sceneGroup.children.length) sceneGroup.remove(sceneGroup.children[0]);
    currentModel = null;
    els('stats').innerHTML = 'Add at least one segment in the Track Builder above to generate a ride.';
    return;
  }
  const samplesM = buildTrack(segs);
  const phys = simulatePhysics(samplesM, p);

  const samplesMM = samplesM.map(s => ({
    pos: s.pos.clone().multiplyScalar(p.mmPerM),
    fwd: s.fwd, right: s.right, up: s.up, s: s.s * p.mmPerM, tag: s.tag,
  }));

  while (sceneGroup.children.length) sceneGroup.remove(sceneGroup.children[0]);

  const railR = p.railD / 2;
  const offsetL = s => s.pos.clone().addScaledVector(s.right, -p.gauge / 2);
  const offsetR = s => s.pos.clone().addScaledVector(s.right, p.gauge / 2);

  /* ---- ground plane sized to the model footprint ---- */
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samplesMM) {
    minY = Math.min(minY, s.pos.y); maxY = Math.max(maxY, s.pos.y);
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
  }
  const groundY = Math.min(0, minY);
  const padX = Math.max(60, (maxX - minX) * 0.15), padZ = Math.max(60, (maxZ - minZ) * 0.15);
  const gGeo = new THREE.PlaneGeometry(maxX - minX + padX * 2, maxZ - minZ + padZ * 2);
  gGeo.rotateX(-Math.PI / 2);
  gGeo.translate((minX + maxX) / 2, groundY, (minZ + maxZ) / 2);
  groundMesh = new THREE.Mesh(gGeo, MAT.ground);
  sceneGroup.add(groundMesh);

  /* ---- piece boundaries: cut the rail run into bed-fitting chunks ---- */
  const targetPieceLen = Math.min(p.bed.x, p.bed.y) * 0.8;
  const margin = p.gauge / 2 + railR + 2;
  function bboxFits(i0, i1) {
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (let k = i0; k <= i1; k++) {
      const c = samplesMM[k].pos;
      mnx = Math.min(mnx, c.x); mxx = Math.max(mxx, c.x);
      mny = Math.min(mny, c.y); mxy = Math.max(mxy, c.y);
      mnz = Math.min(mnz, c.z); mxz = Math.max(mxz, c.z);
    }
    const dx = mxx - mnx + margin * 2, dy = mxy - mny + margin * 2, dz = mxz - mnz + margin * 2;
    const piece = [dx, dy, dz].sort((a, b) => a - b);
    const bed = [p.bed.x, p.bed.y, p.bed.z].sort((a, b) => a - b);
    return piece[0] <= bed[0] && piece[1] <= bed[1] && piece[2] <= bed[2];
  }
  const pieceRanges = [];
  function splitRange(i0, i1, depth) {
    if (i1 <= i0) return;
    if (bboxFits(i0, i1) || depth > 6) { pieceRanges.push([i0, i1]); return; }
    const mid = Math.floor((i0 + i1) / 2);
    splitRange(i0, mid, depth + 1);
    splitRange(mid, i1, depth + 1);
  }
  {
    let i0 = 0;
    for (let i = 1; i < samplesMM.length; i++) {
      if (samplesMM[i].s - samplesMM[i0].s >= targetPieceLen || i === samplesMM.length - 1) {
        splitRange(i0, i, 0);
        i0 = i;
      }
    }
  }

  /* ---- build each piece: rails + ties + lift teeth + brake fins ---- */
  const pieceMeshes = [];
  const tieEvery = Math.max(1, Math.round(p.tieSp / ((samplesMM[1].s - samplesMM[0].s) || 1)));
  for (const [i0, i1] of pieceRanges) {
    const parts = [];
    parts.push(tubeGeometry(samplesMM, i0, i1, offsetL, railR));
    parts.push(tubeGeometry(samplesMM, i0, i1, offsetR, railR));
    let anyLift = false, anyBrake = false;
    const tieIdx = [];
    for (let k = i0; k <= i1; k++) {
      if (samplesMM[k].tag === 'lift') anyLift = true;
      if (samplesMM[k].tag === 'brake') anyBrake = true;
      if (k % tieEvery === 0) {
        // slim crossbar, not a chunky block — real tubular-coaster ties read as a thin plate
        parts.push(boxAt(samplesMM[k], samplesMM[k].pos, p.gauge + railR * 2, railR * 0.8, railR * 1.0));
        tieIdx.push(k);
      }
      if (samplesMM[k].tag === 'lift' && k % Math.max(1, Math.floor(tieEvery / 2)) === 0) {
        parts.push(boxAt(samplesMM[k], samplesMM[k].pos, 1.6, 1.3, 0.9));
      }
      if (samplesMM[k].tag === 'brake' && k % tieEvery === 0) {
        const finPos = samplesMM[k].pos.clone().addScaledVector(samplesMM[k].up, 3);
        parts.push(boxAt(samplesMM[k], finPos, p.gauge * 0.55, 6, 0.9));
      }
    }
    // diagonal cross-bracing between alternating tie pairs — the X-lattice that
    // gives real tubular steel coaster track (B&M/Intamin-style) its rigidity,
    // rather than a bare ladder of straight rungs
    const braceDia = Math.max(0.5, railR * 0.5);
    for (let t = 0; t < tieIdx.length - 1; t += 2) {
      const a = samplesMM[tieIdx[t]], b = samplesMM[tieIdx[t + 1]];
      parts.push(cylinderBetween(offsetL(a), offsetR(b), braceDia));
      parts.push(cylinderBetween(offsetR(a), offsetL(b), braceDia));
    }
    const merged = mergeGeometries(parts);
    const mat = anyBrake ? MAT.brake : (anyLift ? MAT.lift : MAT.rail);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData = { kind: 'piece', i0, i1 };
    sceneGroup.add(mesh);
    pieceMeshes.push(mesh);
  }

  /* ---- connector sleeves at every internal cut ---- */
  const connectorMeshes = [];
  const sleeveLen = Math.max(6, railR * 5);
  for (let k = 1; k < pieceRanges.length; k++) {
    const idx = pieceRanges[k][0];
    const s = samplesMM[idx];
    for (const off of [offsetL, offsetR]) {
      const geo = sleeveGeometry(off(s), s.fwd, p.railD + 1.2, p.railD + 0.3, sleeveLen);
      const mesh = new THREE.Mesh(geo, MAT.sleeve);
      sceneGroup.add(mesh);
      connectorMeshes.push(mesh);
    }
  }

  /* ---- supports, spaced along real-world arc length, sized from the
     simulated G-load and leaned against the local lateral force ---- */
  const supportMeshes = [];
  const maxG = Math.max(1, ...phys.gTotal);
  let nextS = p.suppSpacing;
  const totalS = samplesM[samplesM.length - 1].s;
  const suppIdx = [];
  for (let sTarget = p.suppSpacing; sTarget < totalS; sTarget += p.suppSpacing) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < samplesM.length; k++) {
      const d = Math.abs(samplesM[k].s - sTarget);
      if (d < bestD) { bestD = d; best = k; }
    }
    suppIdx.push(best);
  }
  for (const idx of suppIdx) {
    const sMM = samplesMM[idx];
    const height = sMM.pos.y - groundY;
    if (height < 3) continue;
    const normG = clamp(phys.gTotal[idx] / maxG, 0, 1);
    const dia = clamp(Math.cbrt(height * (0.4 + normG)) * 1.0, p.suppMin, p.suppMax);
    const leanSign = Math.sign(phys.gLat[idx]) || 1;
    const leanMM = height * 0.16 * leanSign;
    const top = sMM.pos.clone();
    if (height > p.aframeAt) {
      const spread = height * 0.22;
      for (const side of [-1, 1]) {
        const base = new THREE.Vector3(
          top.x + sMM.right.x * (spread * side + leanMM),
          groundY,
          top.z + sMM.right.z * (spread * side + leanMM)
        );
        const geo = cylinderBetween(base, top, dia);
        const mesh = new THREE.Mesh(geo, MAT.support);
        mesh.userData = { kind: 'support', base, top, dia, height };
        sceneGroup.add(mesh);
        supportMeshes.push(mesh);
      }
    } else {
      const base = new THREE.Vector3(top.x + sMM.right.x * leanMM, groundY, top.z + sMM.right.z * leanMM);
      const geo = cylinderBetween(base, top, dia);
      const mesh = new THREE.Mesh(geo, MAT.support);
      mesh.userData = { kind: 'support', base, top, dia, height };
      sceneGroup.add(mesh);
      supportMeshes.push(mesh);
    }
  }

  currentModel = { pieceMeshes, connectorMeshes, supportMeshes, params: p, samplesMM, groundY, railR };

  /* ---- stats ---- */
  const kmh = v => (v * 3.6).toFixed(1);
  const maxV = Math.max(...phys.v), minG = Math.min(...phys.gTotal);
  const footprintX = (maxX - minX) / 1000, footprintZ = (maxZ - minZ) / 1000;
  els('stats').innerHTML =
    `track length <b>${totalS.toFixed(0)} m</b><br>` +
    `top speed <b>${kmh(maxV)} km/h</b><br>` +
    `max G <b>${maxG.toFixed(2)} g</b> &nbsp;min G <b>${minG.toFixed(2)} g</b><br>` +
    `model footprint <b>${footprintX.toFixed(2)} × ${footprintZ.toFixed(2)} m</b><br>` +
    `print pieces <b>${pieceMeshes.length}</b><br>` +
    `connector sleeves <b>${connectorMeshes.length * 2}</b><br>` +
    `supports <b>${supportMeshes.length}</b>`;

  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2, centerY = (groundY + maxY) / 2;
  controls.target.set(centerX, centerY, centerZ);
  const diag = Math.hypot(maxX - minX, maxY - groundY, maxZ - minZ);
  const dist = Math.max(150, diag * 1.1);
  camera.position.set(centerX + dist * 0.55, centerY + dist * 0.42, centerZ + dist * 0.65);
  camera.near = Math.max(0.5, dist / 500);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------------
   EXPORT
--------------------------------------------------------------------- */
const exporter = new STLExporter();

// STLExporter's binary mode returns a DataView; JSZip and Blob both need a
// concrete typed array / ArrayBuffer, not a DataView, to read the bytes.
function exportSTL(obj) {
  const dv = exporter.parse(obj, { binary: true });
  return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

els('exportFullBtn').addEventListener('click', () => {
  if (!currentModel) { toast('Add track segments first'); return; }
  const group = new THREE.Group();
  [...currentModel.pieceMeshes, ...currentModel.connectorMeshes, ...currentModel.supportMeshes].forEach(m => group.add(m.clone()));
  const buf = exportSTL(group);
  downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `CoasterForge_${currentModel.params.type}_full.stl`);
  toast('Full model STL downloaded');
});

els('exportKitBtn').addEventListener('click', async () => {
  if (!currentModel) { toast('Add track segments first'); return; }
  const btn = els('exportKitBtn');
  btn.disabled = true; btn.textContent = 'Packing…';
  try {
    const zip = new JSZip();
    const manifest = [];
    manifest.push(`CoasterForge print kit — ${coasterName(currentModel.params.type)}`);
    manifest.push(`Generated ${new Date().toISOString()}`);
    manifest.push(`Bed: ${currentModel.params.bed.x} x ${currentModel.params.bed.y} x ${currentModel.params.bed.z} mm`);
    manifest.push('');
    manifest.push(`-- Track pieces (${currentModel.pieceMeshes.length}) --`);

    currentModel.pieceMeshes.forEach((m, i) => {
      const name = `pieces/track_${String(i + 1).padStart(3, '0')}.stl`;
      const buf = exportSTL(m);
      zip.file(name, buf);
      manifest.push(`${name}`);
    });

    manifest.push('', `-- Connector sleeves (${currentModel.connectorMeshes.length}, glue over each track-to-track joint) --`);
    currentModel.connectorMeshes.forEach((m, i) => {
      const name = `connectors/sleeve_${String(i + 1).padStart(3, '0')}.stl`;
      zip.file(name, exportSTL(m));
      manifest.push(name);
    });

    manifest.push('', `-- Supports (${currentModel.supportMeshes.length}, split if taller than the bed) --`);
    const bedZ85 = currentModel.params.bed.z * 0.85;
    let suppFileCount = 0, suppSleeveCount = 0;
    currentModel.supportMeshes.forEach((m, i) => {
      const { base, top, dia, height } = m.userData;
      if (height <= bedZ85) {
        const name = `supports/support_${String(i + 1).padStart(3, '0')}.stl`;
        zip.file(name, exportSTL(m));
        manifest.push(name);
        suppFileCount++;
      } else {
        const n = Math.ceil(height / bedZ85);
        const dir = new THREE.Vector3().subVectors(top, base).normalize();
        for (let seg = 0; seg < n; seg++) {
          const p0 = base.clone().addScaledVector(dir, height * (seg / n));
          const p1 = base.clone().addScaledVector(dir, height * ((seg + 1) / n));
          const geo = cylinderBetween(p0, p1, dia);
          const segMesh = new THREE.Mesh(geo, MAT.support);
          const name = `supports/support_${String(i + 1).padStart(3, '0')}_${seg + 1}of${n}.stl`;
          zip.file(name, exportSTL(segMesh));
          manifest.push(name);
          suppFileCount++;
          if (seg < n - 1) {
            const sleeveGeo = sleeveGeometry(p1, dir, dia + 1.2, dia + 0.3, Math.max(6, dia * 2.5));
            const sleeveMesh = new THREE.Mesh(sleeveGeo, MAT.sleeve);
            const sname = `supports/support_${String(i + 1).padStart(3, '0')}_sleeve${seg + 1}.stl`;
            zip.file(sname, exportSTL(sleeveMesh));
            manifest.push(sname);
            suppSleeveCount++;
          }
        }
      }
    });

    manifest.push('', '-- Assembly --',
      '1. Print all pieces (no supports needed if oriented with the flattest face down).',
      '2. Dry-fit each track piece pair in order; glue a sleeve over every rail joint.',
      '3. Glue supports to the underside of the track at their marked stations, base to the baseboard.',
      '4. Tall supports print in stacked segments — join with the matching sleeve before gluing to the track.');
    zip.file('MANIFEST.txt', manifest.join('\n'));

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `CoasterForge_${currentModel.params.type}_kit.zip`);
    toast(`Kit exported: ${currentModel.pieceMeshes.length} pieces, ${suppFileCount} support parts`);
  } finally {
    btn.disabled = false; btn.textContent = 'Export Print Kit (.zip)';
  }
});

generate();
