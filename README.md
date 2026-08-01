# DrowsyGuard

DrowsyGuard is a browser-based driver drowsiness detection application that helps identify signs of fatigue using only a webcam. Everything runs directly in the browser, so no wearable devices, mobile applications, or cloud servers are required.

Unlike many AI-powered solutions that send video to remote servers, DrowsyGuard performs all processing on the user's device. The webcam feed never leaves the browser, making the system faster, more private, and suitable even when internet connectivity is limited.

---

# Features

## Real-Time Drowsiness Detection

The application continuously monitors multiple facial fatigue indicators instead of relying on just one measurement.

It tracks:

- Eye Aspect Ratio (EAR)
- PERCLOS (Percentage of Eye Closure)
- Mouth Aspect Ratio (MAR) for yawn detection

These values are combined into a rolling drowsiness score to provide more reliable detection.

---

## Personalized Calibration

Every driver's face is different.

Before monitoring begins, DrowsyGuard spends around 10 seconds learning the driver's normal eye position and blink pattern. This personalized baseline helps reduce false alarms and makes detection more accurate than using fixed thresholds for everyone.

---

## Smart Alert Levels

Instead of immediately triggering a loud alarm, the system responds gradually depending on the driver's condition.

### Mild

A gentle reminder encourages the driver to stay alert or take a short break.

### Moderate

The application plays an audio alert and activates device vibration (where supported).

### Critical

When serious drowsiness is detected:

- Full-screen warning appears
- Loud siren is generated
- Voice alert repeats in English and Tamil
- Nearby rest stops are suggested automatically

---

## Bilingual Voice Assistance

Critical warnings are spoken using the browser's built-in speech synthesis.

Languages supported:

- English
- Tamil

The warning repeats every six seconds until the driver's condition improves.

---

## Nearby Rest Stops

When internet and location services are available, DrowsyGuard searches for nearby:

- Fuel stations
- Cafés
- Rest areas

Results are fetched using OpenStreetMap and can be opened directly in navigation apps.

---

## Emergency Contact Support

Users can save multiple emergency contacts.

When three or more contacts are available and a critical alert occurs, DrowsyGuard automatically opens the phone's messaging application with:

- All contacts selected
- Driver's current location
- Pre-written emergency message

The driver only needs to press **Send**.

A manual **Notify All Contacts** button is also available.

---

## Session Summary

After every drive, the application generates a summary that includes:

- Safe Driving Score
- Total alerts
- Alert timeline
- Session statistics

The report can be downloaded as a text file.

---

## Demo Mode

A built-in demo simulates a complete drowsiness event without requiring a webcam.

This is especially useful during presentations, project demonstrations, or competitions.

---

## Progressive Web App (PWA)

DrowsyGuard works as an installable Progressive Web App.

After the first visit, important application files are cached so the app continues working even without internet access.

Internet is only required for:

- Rest-stop search
- GPS location sharing

---

## Night Mode

Night driving presents additional challenges for both drivers and computer vision systems.

Night Mode helps by:

- Reducing screen brightness
- Using warm colors to minimize glare
- Improving webcam brightness and contrast before face detection

This improves visibility while reducing eye strain.

---

# Running the Project

No installation or build process is required.

Start a simple local server:

```bash
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000
```

---

# Deploying to GitHub Pages

Deployment only takes a few steps.

1. Push the project to GitHub.
2. Open Repository Settings.
3. Navigate to **Pages**.
4. Select **Deploy from Branch**.
5. Choose the **main** branch.

GitHub Pages automatically serves the application over HTTPS, allowing webcam access without extra configuration.

---

# How It Works

DrowsyGuard uses **MediaPipe FaceMesh** to detect facial landmarks from the webcam.

Three important measurements are calculated continuously.

## Eye Aspect Ratio (EAR)

EAR measures how open the eyes are.

When the eyes remain closed for longer than normal, the EAR value drops significantly.

---

## PERCLOS

PERCLOS measures the percentage of time the driver's eyes remain closed over a rolling 30-second window.

It is one of the most commonly used indicators in driver fatigue research.

---

## Mouth Aspect Ratio (MAR)

MAR measures mouth opening.

A large increase usually indicates yawning, which contributes to the overall fatigue score.

---

# Research Background

Rather than creating our own machine learning model, DrowsyGuard follows values reported in published driver monitoring research.

The default thresholds are based on peer-reviewed studies and are then adjusted using the driver's personal calibration.

This approach keeps the application lightweight while still following established research.

---

# Current Limitations

Although the application performs well under normal conditions, there are situations that still need further testing.

Examples include:

- Very Poor lighting conditions
- Extreme head movements

Nearby rest-stop recommendations also depend on the availability of OpenStreetMap data in the current location.

---

# Emergency Messaging

For privacy and security reasons, modern web browsers do not allow websites to send SMS messages automatically.

Instead, DrowsyGuard prepares the message with:

- Emergency contacts
- Current location
- Emergency text

The user simply confirms the message by pressing **Send**.

---

# Privacy

Privacy is one of the main goals of this project.

- Webcam video is never uploaded.
- No facial images are stored.
- All detection happens locally in the browser.
- Personal data remains on the user's device.

---

# Project Structure

```
drowsy-guard/
│
├── index.html
├── style.css
├── app.js
├── manifest.json
├── sw.js
├── icon.svg
└── README.md
```

---

# Future Improvements

Some ideas for future development include:

- Better low-light performance
- Accurate Head pose estimation
- Steering behavior analysis 
- Integration with vehicle sensors
- AI-based fatigue prediction using deep learning
- Cloud synchronization of driving reports

---

# Acknowledgements

This project uses:

- MediaPipe FaceMesh for facial landmark detection
- OpenStreetMap Overpass API for nearby location search
- Browser APIs including Speech Synthesis, Geolocation, Web Audio, Service Workers, and the PWA framework.

---

## Team Note

DrowsyGuard was developed as a practical demonstration of how modern web technologies can be used to improve road safety. Instead of depending on expensive hardware or cloud-based AI services, the project focuses on creating a lightweight, privacy-friendly solution that runs entirely inside a web browser while still providing meaningful real-time driver assistance.
