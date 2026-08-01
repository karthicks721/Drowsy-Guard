/* ============================================================
   DrowsyGuard — on-device driver alertness monitor
   All processing runs in the browser. No video leaves the device.
   ============================================================ */

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const videoEl = $('video');
const canvasEl = $('overlay');
const ctx = canvasEl.getContext('2d');

const btnStart = $('btnStart');
const btnCalibrate = $('btnCalibrate');
const btnDemo = $('btnDemo');
const statusDot = $('statusDot');
const statusLabel = $('statusLabel');
const calibBadge = $('calibBadge');
const calibCard = $('calibCard');
const calibText = $('calibText');
const alertFlash = $('alertFlash');
const criticalOverlay = $('criticalOverlay');

const mPerclos = $('mPerclos');
const mEar = $('mEar');
const mMar = $('mMar');
const mBlink = $('mBlink');
const gaugeFill = $('gaugeFill');
const logList = $('logList');

const btnFindRest = $('btnFindRest');
const restList = $('restList');
const restStatus = $('restStatus');

const contactList = $('contactList');
const contactName = $('contactName');
const contactPhone = $('contactPhone');
const btnSaveContact = $('btnSaveContact');
const btnPingContact = $('btnPingContact');
const autoNotifyStatus = $('autoNotifyStatus');

const toggleVoice = $('toggleVoice');
const toggleVibrate = $('toggleVibrate');
const toggleNight = $('toggleNight');
const btnInstall = $('btnInstall');

const summaryBackdrop = $('summaryBackdrop');
const summaryGrid = $('summaryGrid');
const summaryTimeline = $('summaryTimeline');
const btnDownloadSummary = $('btnDownloadSummary');
const btnCloseSummary = $('btnCloseSummary');

/* ---------- Landmark indices (MediaPipe FaceMesh, 468-point) ---------- */
const LEFT_EYE  = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const MOUTH_V   = [13, 14];   // upper/lower inner lip
const MOUTH_H   = [78, 308];  // left/right mouth corner

/* ---------- State ----------
   Default thresholds are set from published drowsiness-detection research,
   not hand-tuned guesses. See README "Research basis" for full citations:
   - EAR closed-eye threshold 0.25, confirmed over 20 consecutive frames:
     Real-Time Drowsiness Detection Using EAR and Facial Landmarks (arXiv:2408.05836)
   - PERCLOS alarm threshold 0.15 (15%) as the highest drowsiness level:
     Viola-Jones + PERCLOS driver eye-tracking system (PERCLOS Threshold for
     Drowsiness Detection during Real Driving; NTHU-DDD evaluation)
   - PERCLOS >=0.30 (30%) as a drowsiness/wakefulness cutoff, validated against
     six-channel EEG in a 50-min driving simulation across 50 drivers:
     "Association of Visual-Based Signals with EEG Patterns..." (PMC11055081)
   Personal calibration (10s baseline) then adapts these defaults to the
   individual driver rather than replacing the research basis. */
const state = {
  running: false,
  calibrating: false,
  calibrated: false,
  baselineEar: 0.30,
  closedThreshold: 0.25,     // research default (arXiv:2408.05836), overwritten on calibration
  yawnThreshold: 0.55,
  perclosWindow: [],          // rolling {t, closed}
  perclosWindowMs: 30000,     // 30s rolling window
  blinkTimestamps: [],
  lastEyeClosed: false,
  tier: 0,                    // 0 alert, 1 mild, 2 moderate, 3 critical
  tierSince: 0,
  sessionStart: null,
  events: [],                 // {t, type, detail}
  demoTimer: null,
  faceMesh: null,
  camera: null,
};

/* ============================================================
   Emergency contacts — supports multiple, auto-notify at 3+
   ============================================================ */
function loadContacts() {
  return JSON.parse(localStorage.getItem('dg_contacts') || '[]');
}
function saveContacts(list) {
  localStorage.setItem('dg_contacts', JSON.stringify(list));
}
function renderContacts() {
  const list = loadContacts();
  contactList.innerHTML = '';
  if (list.length === 0) {
    contactList.innerHTML = '<li class="contact-empty">No contacts saved yet.</li>';
  } else {
    list.forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${c.name} · ${c.phone}</span><button data-i="${i}">Remove</button>`;
      contactList.appendChild(li);
    });
  }
  btnPingContact.disabled = list.length === 0;
  autoNotifyStatus.textContent = list.length >= 3
    ? `Auto-notify is ON — a critical alert will open a message to all ${list.length} saved contacts.`
    : `Add 3+ contacts to enable auto-notify on a critical alert (${list.length}/3 saved).`;

  contactList.querySelectorAll('button[data-i]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.i);
      const updated = loadContacts();
      updated.splice(idx, 1);
      saveContacts(updated);
      renderContacts();
    });
  });
}
renderContacts();

/* ============================================================
   Geometry helpers
   ============================================================ */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function eyeAspectRatio(lm, idx) {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  const vertical = dist(p2, p6) + dist(p3, p5);
  const horizontal = 2 * dist(p1, p4);
  return horizontal === 0 ? 0 : vertical / horizontal;
}

function mouthAspectRatio(lm) {
  const vertical = dist(lm[MOUTH_V[0]], lm[MOUTH_V[1]]);
  const horizontal = dist(lm[MOUTH_H[0]], lm[MOUTH_H[1]]);
  return horizontal === 0 ? 0 : vertical / horizontal;
}

/* ============================================================
   Logging
   ============================================================ */
function logEvent(type, detail, tagClass) {
  const t = new Date();
  state.events.push({ t, type, detail });
  const li = document.createElement('li');
  const time = t.toLocaleTimeString([], { hour12: false });
  li.innerHTML = `<span>${time} — ${detail}</span><span class="tag ${tagClass}">${type}</span>`;
  if (logList.querySelector('.log-empty')) logList.innerHTML = '';
  logList.prepend(li);
}

/* ============================================================
   Alarm sound — synthesized siren via Web Audio API (no audio file
   needed, works fully offline once the page has loaded once).
   ============================================================ */
let audioCtx = null;
let sirenNodes = null;

function startSiren() {
  if (sirenNodes) return; // already running
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  gain.gain.value = 0.18;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();

  // sweep frequency up/down for a siren effect
  let rising = true;
  const sweep = setInterval(() => {
    const now = audioCtx.currentTime;
    osc.frequency.linearRampToValueAtTime(rising ? 880 : 440, now + 0.35);
    rising = !rising;
  }, 350);

  sirenNodes = { osc, gain, sweep };
}

function stopSiren() {
  if (!sirenNodes) return;
  clearInterval(sirenNodes.sweep);
  sirenNodes.osc.stop();
  sirenNodes.osc.disconnect();
  sirenNodes.gain.disconnect();
  sirenNodes = null;
}

/* ============================================================
   Voice alerts (bilingual EN / TA) + vibration
   ============================================================ */
function speak(en, ta) {
  if (!toggleVoice.checked || !('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  const say = (text, lang) => {
    const u = new SpeechSynthesisUtterance(text);
    const match = voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.slice(0,2)));
    if (match) u.voice = match;
    u.lang = lang;
    u.rate = 1.0;
    speechSynthesis.speak(u);
  };
  speechSynthesis.cancel();
  say(en, 'en-IN');
  if (ta) setTimeout(() => say(ta, 'ta-IN'), 1400);
}

function vibrate(pattern) {
  if (!toggleVibrate.checked) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ============================================================
   Alert tier state machine
   0 = alert, 1 = mild (micro-break nudge), 2 = moderate (vibration+sound),
   3 = critical (full alarm + rest-stop push + auto-notify contacts)
   ============================================================ */
let criticalVoiceLoop = null;

function setTier(newTier, perclosPct) {
  if (newTier === state.tier) return;
  const enteringCritical = newTier === 3;
  const leavingCritical = state.tier === 3 && newTier !== 3;
  state.tier = newTier;
  state.tierSince = Date.now();

  statusDot.className = 'dot' + (newTier === 0 ? ' live' : newTier < 3 ? ' warn' : ' danger');
  alertFlash.hidden = newTier < 3;
  criticalOverlay.hidden = newTier < 3;

  if (leavingCritical) {
    stopSiren();
    if (criticalVoiceLoop) { clearInterval(criticalVoiceLoop); criticalVoiceLoop = null; }
  }

  if (newTier === 0) {
    statusLabel.textContent = 'Alert';
  } else if (newTier === 1) {
    statusLabel.textContent = 'Fatigue rising';
    logEvent('MILD', `PERCLOS ${perclosPct}% — micro-break suggested`, 'tag-mild');
    speak('You seem a little tired. Consider a short break soon.', 'நீங்கள் சற்று சோர்வாக இருக்கிறீர்கள். விரைவில் ஒரு சிறு இடைவெளி எடுக்கவும்.');
  } else if (newTier === 2) {
    statusLabel.textContent = 'Drowsiness detected';
    logEvent('MODERATE', `PERCLOS ${perclosPct}% — vibration + audio alert`, 'tag-mild');
    speak('Drowsiness detected. Please stay alert.', 'சோர்வு கண்டறியப்பட்டது. விழிப்புடன் இருக்கவும்.');
    vibrate([300, 100, 300]);
  } else if (enteringCritical) {
    statusLabel.textContent = 'CRITICAL — pull over';
    logEvent('CRITICAL', `PERCLOS ${perclosPct}% — critical drowsiness, rest stop suggested`, 'tag-critical');
    startSiren();
    vibrate([500, 150, 500, 150, 500]);
    speak('Critical alert. Please pull over and rest now.', 'முக்கிய எச்சரிக்கை. வண்டியை நிறுத்தி ஓய்வு எடுக்கவும்.');
    criticalVoiceLoop = setInterval(() => {
      speak('Critical alert. Please pull over and rest now.', 'முக்கிய எச்சரிக்கை. வண்டியை நிறுத்தி ஓய்வு எடுக்கவும்.');
      vibrate([500, 150, 500]);
    }, 6000);
    findRestStops(); // proactively surface nearby stops
    if (loadContacts().length >= 3) {
      notifyAllContacts(true); // auto-notify once per critical episode
    }
  }
}

/* ============================================================
   Calibration
   ============================================================ */
function startCalibration() {
  if (!state.running) return;
  state.calibrating = true;
  calibBadge.hidden = false;
  btnCalibrate.disabled = true;
  const samples = [];
  const t0 = Date.now();

  const collect = setInterval(() => {
    if (state._lastEar) samples.push(state._lastEar);
    if (Date.now() - t0 > 10000) {
      clearInterval(collect);
      finishCalibration(samples);
    }
  }, 150);
}

function finishCalibration(samples) {
  state.calibrating = false;
  calibBadge.hidden = true;
  btnCalibrate.disabled = false;
  if (samples.length < 10) {
    calibText.textContent = 'Calibration failed — face not detected clearly. Using default thresholds.';
    return;
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  state.baselineEar = avg;
  // 0.82 ratio reflects the gap between typical open-eye EAR (~0.30) and the
  // published closed-eye threshold (0.25) in arXiv:2408.05836 — applied
  // relative to this driver's own open-eye baseline instead of a fixed value.
  state.closedThreshold = avg * 0.82;
  state.calibrated = true;
  calibText.textContent = `Calibrated to your baseline (EAR ≈ ${avg.toFixed(3)}). Thresholds adapted to your eyes.`;
  logEvent('INFO', 'Personal calibration complete', 'tag-info');
}

/* ============================================================
   PERCLOS computation over rolling window
   ============================================================ */
function updatePerclos(isClosed) {
  const now = Date.now();
  state.perclosWindow.push({ t: now, closed: isClosed });
  state.perclosWindow = state.perclosWindow.filter(p => now - p.t <= state.perclosWindowMs);
  const closedCount = state.perclosWindow.filter(p => p.closed).length;
  const pct = Math.round((closedCount / state.perclosWindow.length) * 100);
  return pct;
}

// Tier cutoffs match published PERCLOS alarm levels rather than arbitrary
// numbers: 15% is the documented PERCLOS alarm threshold for the highest
// drowsiness level in Viola-Jones/PERCLOS driver eye-tracking research; 30%
// is the drowsiness cutoff independently validated against EEG in PMC11055081.
function evaluateTier(perclosPct) {
  if (perclosPct >= 30) return 3;   // EEG-validated drowsiness cutoff
  if (perclosPct >= 15) return 2;   // published PERCLOS alarm threshold
  if (perclosPct >= 8)  return 1;   // early/mild rise, pre-alarm nudge
  return 0;
}

/* ============================================================
   Frame processing
   ============================================================ */
function onResults(results) {
  canvasEl.width = videoEl.videoWidth || 640;
  canvasEl.height = videoEl.videoHeight || 480;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    mEar.textContent = '–';
    mMar.textContent = '–';
    return;
  }

  const lm = results.multiFaceLandmarks[0];
  const earL = eyeAspectRatio(lm, LEFT_EYE);
  const earR = eyeAspectRatio(lm, RIGHT_EYE);
  const ear = (earL + earR) / 2;
  const mar = mouthAspectRatio(lm);
  state._lastEar = ear;

  const threshold = state.calibrated ? state.closedThreshold : state.closedThreshold;
  const isClosed = ear < threshold;

  // blink counting (closed -> open transition)
  if (state.lastEyeClosed && !isClosed) {
    state.blinkTimestamps.push(Date.now());
    const cutoff = Date.now() - 60000;
    state.blinkTimestamps = state.blinkTimestamps.filter(t => t > cutoff);
  }
  state.lastEyeClosed = isClosed;

  const perclosPct = state.calibrating ? 0 : updatePerclos(isClosed);

  mEar.textContent = ear.toFixed(3);
  mMar.textContent = mar.toFixed(3);
  mPerclos.textContent = perclosPct + '%';
  mBlink.textContent = state.blinkTimestamps.length;
  gaugeFill.style.transform = `scaleX(${1 - Math.min(perclosPct, 100) / 100})`;

  if (mar > state.yawnThreshold) {
    logEvent('YAWN', `MAR ${mar.toFixed(2)} — possible yawn detected`, 'tag-mild');
  }

  if (!state.calibrating) {
    const tier = evaluateTier(perclosPct);
    setTier(tier, perclosPct);
  }

  // simple mesh dot overlay for visual feedback
  ctx.fillStyle = 'rgba(45,212,200,0.7)';
  [...LEFT_EYE, ...RIGHT_EYE].forEach(i => {
    const p = lm[i];
    ctx.beginPath();
    ctx.arc(p.x * canvasEl.width, p.y * canvasEl.height, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ============================================================
   Night mode — dims/warms the UI to preserve night vision and cut
   windshield glare, AND boosts brightness/contrast on the actual
   frame handed to the face detector (via an offscreen canvas), which
   genuinely helps landmark detection in low light — CSS filters on
   the visible <video> element alone would only change what you see,
   not the pixels the detector processes.
   ============================================================ */
const nightCanvas = document.createElement('canvas');
const nightCtx = nightCanvas.getContext('2d');

toggleNight.addEventListener('change', () => {
  document.body.classList.toggle('night-mode', toggleNight.checked);
  logEvent('INFO', `Night mode ${toggleNight.checked ? 'enabled' : 'disabled'}`, 'tag-info');
});

function getDetectionFrame() {
  if (!toggleNight.checked || !videoEl.videoWidth) return videoEl;
  nightCanvas.width = videoEl.videoWidth;
  nightCanvas.height = videoEl.videoHeight;
  nightCtx.filter = 'brightness(1.55) contrast(1.2)';
  nightCtx.drawImage(videoEl, 0, 0, nightCanvas.width, nightCanvas.height);
  return nightCanvas;
}

/* ============================================================
   Start / stop monitoring
   ============================================================ */
async function startMonitoring() {
  if (state.running) return;
  try {
    state.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    state.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
    state.faceMesh.onResults(onResults);

    state.camera = new Camera(videoEl, {
      onFrame: async () => { await state.faceMesh.send({ image: getDetectionFrame() }); },
      width: 640,
      height: 480
    });
    await state.camera.start();

    state.running = true;
    state.sessionStart = new Date();
    btnStart.textContent = 'End Session';
    btnCalibrate.disabled = false;
    statusDot.className = 'dot live';
    statusLabel.textContent = 'Monitoring';
    logEvent('INFO', 'Monitoring session started', 'tag-info');
  } catch (err) {
    alert('Camera access failed: ' + err.message + '\n\nTip: use "Run Demo Scenario" to see the app work without a webcam.');
  }
}

function endMonitoring() {
  if (state.camera) state.camera.stop();
  if (state.demoTimer) clearInterval(state.demoTimer);
  stopSiren();
  if (criticalVoiceLoop) { clearInterval(criticalVoiceLoop); criticalVoiceLoop = null; }
  criticalOverlay.hidden = true;
  alertFlash.hidden = true;
  state.running = false;
  btnStart.textContent = 'Start Monitoring';
  statusDot.className = 'dot';
  statusLabel.textContent = 'Session ended';
  showSummary();
}

btnStart.addEventListener('click', () => {
  if (state.running) endMonitoring();
  else startMonitoring();
});

btnCalibrate.addEventListener('click', startCalibration);

/* ============================================================
   Demo scenario — deterministic, no camera required.
   Reliable for stage demos regardless of lighting/wifi.
   ============================================================ */
function runDemoScenario() {
  if (state.demoTimer) clearInterval(state.demoTimer);
  state.running = true;
  state.sessionStart = new Date();
  btnStart.textContent = 'End Session';
  logEvent('INFO', 'Demo scenario started (simulated data)', 'tag-info');

  const script = [
    { t: 0,  perclos: 5,  ear: 0.31 },
    { t: 3,  perclos: 12, ear: 0.29 },
    { t: 6,  perclos: 22, ear: 0.25 },   // mild
    { t: 10, perclos: 38, ear: 0.20 },   // moderate
    { t: 14, perclos: 62, ear: 0.15 },   // critical
    { t: 19, perclos: 20, ear: 0.27 },   // recovering
    { t: 23, perclos: 4,  ear: 0.32 },   // back to alert
  ];

  script.forEach(step => {
    setTimeout(() => {
      mPerclos.textContent = step.perclos + '%';
      mEar.textContent = step.ear.toFixed(3);
      mMar.textContent = (0.2 + Math.random() * 0.1).toFixed(3);
      mBlink.textContent = Math.max(6, 20 - Math.round(step.perclos / 5));
      gaugeFill.style.transform = `scaleX(${1 - Math.min(step.perclos, 100) / 100})`;
      const tier = evaluateTier(step.perclos);
      setTier(tier, step.perclos);
    }, step.t * 1000);
  });

  setTimeout(() => {
    logEvent('INFO', 'Demo scenario complete', 'tag-info');
    endMonitoring();
  }, 27000);
}
btnDemo.addEventListener('click', runDemoScenario);

/* ============================================================
   Rest stop finder — geolocation + OpenStreetMap Overpass API
   ============================================================ */
function findRestStops() {
  if (!navigator.geolocation) {
    restStatus.textContent = 'Geolocation not supported on this device.';
    return;
  }
  restStatus.textContent = 'Locating you…';
  restList.innerHTML = '';

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    restStatus.textContent = 'Searching nearby rest areas, fuel stations and cafes…';

    const query = `
      [out:json][timeout:15];
      (
        node["highway"="rest_area"](around:15000,${latitude},${longitude});
        node["amenity"="fuel"](around:8000,${latitude},${longitude});
        node["amenity"="cafe"](around:5000,${latitude},${longitude});
      );
      out body 12;
    `;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
      });
      const data = await res.json();
      renderRestStops(data.elements, latitude, longitude);
    } catch (e) {
      restStatus.textContent = 'Could not reach the map service. Check your connection and try again.';
    }
  }, (err) => {
    restStatus.textContent = 'Location permission denied — enable it to find nearby stops.';
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderRestStops(elements, lat, lon) {
  if (!elements || elements.length === 0) {
    restStatus.textContent = 'No rest stops found nearby. Try again on a main road.';
    return;
  }
  const withDist = elements
    .filter(e => e.lat && e.lon)
    .map(e => ({
      name: (e.tags && (e.tags.name || e.tags.amenity || e.tags.highway)) || 'Unnamed stop',
      kind: e.tags && (e.tags.highway === 'rest_area' ? 'Rest area' : e.tags.amenity === 'fuel' ? 'Fuel station' : 'Cafe'),
      d: haversine(lat, lon, e.lat, e.lon),
      lat: e.lat, lon: e.lon
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);

  restStatus.textContent = `Found ${withDist.length} nearby stop(s):`;
  restList.innerHTML = '';
  withDist.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${s.kind} · ${s.name}</span><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">${s.d.toFixed(1)} km →</a>`;
    restList.appendChild(li);
  });
}
btnFindRest.addEventListener('click', findRestStops);

/* ============================================================
   Emergency contacts — local only. Opens the device's messaging app
   pre-addressed to every saved contact with live location. No website
   can send SMS without a backend gateway and the user's final tap —
   this is a browser/OS security boundary, not a limitation we chose.
   ============================================================ */
btnSaveContact.addEventListener('click', () => {
  const name = contactName.value.trim();
  const phone = contactPhone.value.trim();
  if (!name || !phone) { alert('Enter both a name and a phone number.'); return; }
  const list = loadContacts();
  list.push({ name, phone });
  saveContacts(list);
  contactName.value = '';
  contactPhone.value = '';
  renderContacts();
  logEvent('INFO', `Emergency contact added (${name}) — ${list.length} saved`, 'tag-info');
});

function notifyAllContacts(auto = false) {
  const list = loadContacts();
  if (list.length === 0) return;
  const send = (lat, lon) => {
    const locText = lat ? ` My location: https://maps.google.com/?q=${lat},${lon}` : '';
    const msg = encodeURIComponent(`I'm feeling drowsy while driving and may need help.${locText}`);
    const numbers = list.map(c => c.phone).join(',');
    // Comma-separated recipients open a single group message on most
    // messaging apps (confirmed behavior on iOS Messages; Android varies
    // by default SMS app). The user still taps Send themselves.
    window.location.href = `sms:${numbers}?&body=${msg}`;
    logEvent('CRITICAL', `${auto ? 'Auto-notify' : 'Manual notify'}: message opened for ${list.length} contact(s)`, 'tag-critical');
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => send(pos.coords.latitude, pos.coords.longitude),
      () => send(null, null)
    );
  } else {
    send(null, null);
  }
}
btnPingContact.addEventListener('click', () => notifyAllContacts(false));

/* ============================================================
   Session summary
   ============================================================ */
function showSummary() {
  const durationMs = state.sessionStart ? (Date.now() - state.sessionStart.getTime()) : 0;
  const mins = Math.max(1, Math.round(durationMs / 60000));
  const mild = state.events.filter(e => e.type === 'MILD').length;
  const moderate = state.events.filter(e => e.type === 'MODERATE').length;
  const critical = state.events.filter(e => e.type === 'CRITICAL').length;
  const score = Math.max(0, 100 - mild * 5 - moderate * 12 - critical * 25);

  summaryGrid.innerHTML = `
    <div class="metric"><span class="metric-label">Duration</span><span class="metric-value">${mins} min</span></div>
    <div class="metric"><span class="metric-label">Safe driving score</span><span class="metric-value">${score}</span></div>
    <div class="metric"><span class="metric-label">Critical alerts</span><span class="metric-value">${critical}</span></div>
    <div class="metric"><span class="metric-label">Moderate alerts</span><span class="metric-value">${moderate}</span></div>
    <div class="metric"><span class="metric-label">Mild alerts</span><span class="metric-value">${mild}</span></div>
    <div class="metric"><span class="metric-label">Events logged</span><span class="metric-value">${state.events.length}</span></div>
  `;

  summaryTimeline.innerHTML = '';
  state.events.slice().reverse().forEach(e => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${e.t.toLocaleTimeString([], { hour12: false })} — ${e.detail}</span><span class="tag ${e.type === 'CRITICAL' ? 'tag-critical' : e.type === 'INFO' ? 'tag-info' : 'tag-mild'}">${e.type}</span>`;
    summaryTimeline.appendChild(li);
  });

  summaryBackdrop.hidden = false;
  window._lastSummary = { mins, score, mild, moderate, critical, events: state.events };
}

btnCloseSummary.addEventListener('click', () => { summaryBackdrop.hidden = true; });

btnDownloadSummary.addEventListener('click', () => {
  const s = window._lastSummary;
  if (!s) return;
  const lines = [
    'DrowsyGuard — Session Summary',
    `Date: ${new Date().toLocaleString()}`,
    `Duration: ${s.mins} min`,
    `Safe driving score: ${s.score}/100`,
    `Critical alerts: ${s.critical}`,
    `Moderate alerts: ${s.moderate}`,
    `Mild alerts: ${s.mild}`,
    '',
    'Timeline:',
    ...s.events.map(e => `  ${e.t.toLocaleTimeString([], { hour12: false })}  [${e.type}]  ${e.detail}`)
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drowsyguard-session-${Date.now()}.txt`;
  a.click();
});

/* ============================================================
   Voice list warm-up (some browsers load voices async)
   ============================================================ */
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

/* ============================================================
   Offline support — register service worker (app-shell + best-effort
   CDN caching). Runs over HTTPS (GitHub Pages) or localhost only,
   per browser requirements for service workers.
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Registration can fail on http:// (non-secure) origins — safe to ignore.
    });
  });
}

/* ============================================================
   Install prompt — Chrome fires 'beforeinstallprompt' once the PWA
   criteria (manifest + icons + HTTPS + service worker) are met. We
   capture it and show our own button instead of relying only on
   Chrome's automatic mini-infobar, since that timing varies.
   ============================================================ */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  btnInstall.hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  btnInstall.hidden = true;
  logEvent('INFO', 'App installed to home screen', 'tag-info');
});
