# DrowsyGuard

An on-device driver drowsiness detection app. Runs entirely in the browser using webcam-based face-landmark tracking — no wearables, no video ever leaves the device.

## Features

1. **Live multi-signal detection** — PERCLOS (percentage of eye closure over time), Eye Aspect Ratio (EAR), and Mouth Aspect Ratio (MAR, for yawn detection), fused into a rolling drowsiness score.
2. **Personal calibration** — a 10-second baseline capture at the start of a session, so alert thresholds adapt to the driver's own eye shape and resting blink rate instead of a fixed value.
3. **Escalating alert tiers** — mild (micro-break nudge) → moderate (audio + vibration) → critical (full-screen red overlay, synthesized siren via Web Audio, repeating bilingual voice alert, and automatic rest-stop lookup).
4. **Bilingual voice alerts** — spoken in English and Tamil, using the browser's built-in speech synthesis. Repeats every 6 seconds while a critical alert is active.
5. **Nearby rest-stop finder** — uses your device location and the OpenStreetMap Overpass API to surface real rest areas, fuel stations, and cafés nearby, with one-tap directions.
6. **Emergency contacts with auto-notify** — save any number of trusted contacts. Once 3 or more are saved, a critical alert automatically opens your device's messaging app pre-addressed to all of them (comma-separated recipients) with your live location, so it's a single tap to send rather than one message per contact. You can also trigger "Notify all contacts now" manually at any time.
7. **Session summary report** — a post-drive card with a safe-driving score, alert counts, and a full timeline, downloadable as a text report.
8. **Run Demo Scenario** — replays a scripted drowsiness episode without needing a camera, so the pitch demo works reliably regardless of stage lighting or Wi-Fi.
9. **Installable, offline-capable** — a manifest + service worker cache the app shell (and the face-detection library, best-effort) on first load, so it works as an installed PWA without a live connection after that. Chrome will prompt to install once it's served over HTTPS (e.g. GitHub Pages) — there's also an in-app "Install App" button that triggers the same native prompt. Location-dependent features (rest stops, SMS location tag) still need a connection when used.
10. **Night mode** — dims and warms the whole UI (red/amber, reduced brightness) to protect the driver's night vision and cut windshield glare, the same principle used in real cockpit displays. It also runs the actual detection frame through a brightness/contrast boost before it reaches the face detector — a genuine low-light detection aid, not just a cosmetic filter on the preview.

## Running it

No build step — it's plain HTML/CSS/JS.

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

Or deploy straight to **GitHub Pages**:

1. Push this folder to a GitHub repo.
2. Repo Settings → Pages → Deploy from branch → `main` / root.
3. Camera access requires HTTPS — GitHub Pages serves over HTTPS by default, so this works out of the box.

## How detection works

- Face landmarks come from [MediaPipe FaceMesh](https://developers.google.com/mediapipe), loaded from a CDN at runtime.
- **EAR** (Eye Aspect Ratio) = ratio of eye height to eye width across 6 landmark points per eye; it drops sharply when eyes close.
- **PERCLOS** (Percentage of Eye Closure) = share of the last 30 seconds where EAR was below the closed-eye threshold, defined as `T_closed / T_total × 100` — one of the most widely used metrics in computer-vision drowsiness research.
- **MAR** (Mouth Aspect Ratio) flags yawning as a secondary fatigue signal.

## Research basis for the thresholds

Instead of hand-picked numbers, the defaults are set from published drowsiness-detection literature, then personalized per driver through the 10-second calibration step:

| Parameter | Value used | Source |
|---|---|---|
| EAR closed-eye threshold | 0.25 (confirmed over 20 consecutive frames) | *Real-Time Drowsiness Detection Using Eye Aspect Ratio and Facial Landmark Detection* (arXiv:2408.05836) |
| PERCLOS moderate/alarm threshold | 15% | PERCLOS-based driver eye-tracking system evaluated on the **NTHU Driver Drowsiness Detection (NTHU-DDD)** dataset, which reports up to 99% detection accuracy for EAR/MAR/head-pose classifiers |
| PERCLOS critical threshold | 30% | *Association of Visual-Based Signals with EEG Patterns in Drowsiness Detection* — PERCLOS ≥30% validated against six-channel EEG across 50 drivers in a 50-minute driving simulation (PMC11055081) |
| Personal calibration ratio | 0.82 × driver's own baseline EAR | Derived from the gap between typical open-eye EAR (~0.30) and the closed-eye threshold above |

So the pitch answer to "how was this trained/validated" is: the detection architecture and its thresholds are grounded in peer-reviewed drowsiness research validated on real driver datasets (NTHU-DDD) and against physiological ground truth (EEG), then adapted per-driver via on-device calibration — rather than a single black-box model trained by us from scratch in a weekend.

## Notes for the judges' round

- This app doesn't run its own trained classifier — it applies literature-backed thresholds, personalized live per driver. That's a legitimate, citable design choice; be upfront about it if asked, rather than implying a custom-trained model.
- Not yet tested by us against sunglasses, poor lighting, extreme head angles, or night driving.
- The rest-stop finder depends on OpenStreetMap data completeness, which varies by region — worth a quick venue test beforehand.

## A note on "automatic" emergency messages

At 3+ saved contacts, a critical alert automatically **opens** your messaging app with all contacts and your location pre-filled — that part is real and automatic. No website (this one included) can silently transmit an SMS without your final tap on Send in your own messaging app, or without a paid backend SMS gateway (like Twilio) that this static, client-side app deliberately doesn't depend on. That's a browser/OS security boundary that protects you from sites texting people on your behalf without consent — worth explaining exactly this way if a judge asks, rather than claiming full auto-send.

## Project structure

```
drowsy-guard/
├── index.html      # UI structure
├── style.css        # Dashboard visual design
├── app.js           # Detection logic, alerts, contacts, rest stops, summary
├── manifest.json     # PWA manifest (installable app)
├── sw.js             # Service worker (offline app-shell caching)
├── icon.svg          # App icon
└── README.md
```
