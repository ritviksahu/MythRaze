# Mythraze

Mythraze is a complete web-based submission for **"Fake Content Detection Assistant"**. It helps reviewers analyze suspicious images and videos, generate an explainable fake-content risk verdict, inspect stored investigations, and export reports from a polished moderation-style interface.

## Overview

The assigned problem statement focuses on detecting fake or manipulated images and videos such as deepfakes, synthetic portraits, edited visuals, and suspicious clips. The goal is not only to label media as suspicious, but to build a usable real-world system that:

- accepts real image and video inputs
- analyzes them end to end
- explains why a file looks suspicious
- works across multiple clients
- feels like a usable product instead of a one-screen prototype

Mythraze addresses that by combining client-side media analysis, a backend verdict engine, shared-case storage, demo investigations, and an explainable review workflow.

## What Mythraze Does

Mythraze is designed as a moderation and verification dashboard for suspicious media.

Users can:

- upload an image or video
- analyze it through the browser and backend pipeline
- view a fake-risk verdict with signal breakdowns
- read investigation notes and next-step recommendations
- reopen stored cases
- view full images and playable videos inside the UI
- export a JSON report

The product also includes a curated demo investigation gallery so judges or guides can explore the system even before running their own uploads.

## Core Features Implemented

- End-to-end web product with frontend, backend, API, and persistent local data
- Support for both images and videos
- Drag-and-drop upload plus file-picker upload
- Browser-side forensic feature extraction for speed and privacy
- Backend verdict engine with explainable risk scoring
- Four-signal forensic ensemble:
  - artifact risk
  - compression risk
  - consistency risk
  - temporal risk for video
- Shared API cache using media fingerprints for faster repeated analyses
- Multi-client support over the same local network
- Auto-persisted stored investigations on the backend
- Separate `Your Search History` and `Demo Investigations` sections
- Session-only user upload history that clears on refresh
- Curated local demo gallery backed by files in `Images_videos/`
- Full-media viewer modal for both images and videos
- Downloadable JSON investigation reports
- Backend health/status panel in the UI
- Light-themed, judge-friendly interface with responsive layout
- Automatic port fallback if `3000` is already in use

## How Detection Works

Mythraze uses an ensemble-style forensic workflow.

### 1. Client-side extraction

When a user uploads media, the browser extracts visual features such as:

- smoothing and noise behavior
- blockiness and banding
- edge irregularity
- local texture variation
- spatial symmetry and region consistency
- frame-to-frame instability for video

### 2. Backend scoring

The backend receives the extracted metrics and builds a case record with:

- risk score
- verdict label
- signal cards
- investigation notes
- recommendations
- pipeline stages

### 3. Explainable output

Instead of only showing one percentage, Mythraze shows:

- which forensic signals are elevated
- why the media may be suspicious
- what reviewers should check next
- whether the case was fresh, cached, or loaded from history

## Product Workflow

1. Open the app in the browser.
2. Upload an image or video.
3. Click `Analyze Media`.
4. The browser extracts forensic features locally.
5. The backend generates or reuses a shared verdict.
6. The result is shown with summary, confidence, signal cards, and review notes.
7. The case appears in the history area for the current session.
8. Full media can be reopened from the analyzer or from stored cards.
9. A JSON report can be downloaded for documentation or submission.

## Multi-Client Behavior

Mythraze is built so multiple users can use the same API instance.

- repeated uploads of the same media are deduplicated by media fingerprint
- cached results are reused to speed up repeat requests
- the backend exposes CORS headers
- LAN mode lets other devices access the same server
- persistence is queued asynchronously to keep responses fast

This makes the product feel more like a shared moderation tool than a single-user demo.

## Demo Investigation System

The project includes a built-in demo gallery for presentation use.

- demo assets are stored in `Images_videos/`
- saved demo case records are stored in `data/demo-investigations.json`
- demo items stay separate from personal upload history
- each demo case includes a verdict, confidence, description, and notes

This helps judges review the platform immediately without preparing their own files first.

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js HTTP server
- Storage: local JSON files
- Media processing: browser APIs and local server orchestration

No database, cloud service, or external paid API is required.

## Project Structure

- Project root: `MythRaze/`
- `server.js` - backend server, static hosting, API routes, shared cache, and demo asset serving
- `lib/analysis-engine.js` - main forensic scoring and case-generation logic
- `public/index.html` - app layout and UI structure
- `public/styles.css` - complete responsive styling
- `public/app.js` - upload flow, local media extraction, UI rendering, and modal viewer
- `data/analyses.json` - stored user-side backend analyses
- `data/demo-investigations.json` - curated demo case records
- `Images_videos/` - local demo images and videos

## How To Run

### Prerequisites

- Node.js installed

This project has no external npm dependencies, so there is no `npm install` step required for the current setup.

### Run locally

```bash
cd MythRaze
npm start
```

Then open the URL shown in the terminal.

Usually:

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

If `3000` is busy, Mythraze automatically tries the next free port like `3001` or `3002`.

### Run for multiple devices on the same network

```bash
cd MythRaze
npm run start:network
```

Then open:

- `http://<your-local-ip>:3000`

or whatever port is printed by the server.


## API Routes

- `GET /api/health` - backend status, cache stats, engine info
- `POST /api/analyze` - submit a forensic analysis payload
- `GET /api/analyses` - fetch user and demo case summaries
- `GET /api/analyses/:id` - fetch a full stored investigation
- `GET /api/analyses/:id/report` - download a JSON report for one case
- `GET /investigation-assets/:file` - serve local demo images and videos

## Environment Notes

Useful runtime behavior:

- default host: `127.0.0.1`
- network host in LAN mode: `0.0.0.0`
- default port: `3000`
- automatic port fallback is enabled
- demo images that are AVIF-backed are served correctly through content detection in the server

## What Makes This Submission Strong

- It is a complete product, not just a model script
- It supports both images and videos
- It has a real UI for reviewers
- It gives explainable output, not only a score
- It supports multiple users through a shared API
- It includes persistent demo investigations for presentation
- It runs locally with minimal setup
- It is usable for hackathon judging, classroom review, and moderation demos

## Known Scope

Mythraze is currently built as an explainable forensic ensemble system. It does not rely on heavyweight external deepfake APIs or cloud-hosted foundation models. That makes it fast, lightweight, and easy to run locally, while still giving a strong end-to-end fake-content detection workflow for the hackathon submission.

## Quick Demo Script

If you are presenting the project live:

1. Start the app with `npm start`.
2. Open the homepage and show the product dashboard.
3. Open `Demo Investigations` and inspect stored fake samples.
4. Click `View Media` to open a full image or video.
5. Open a demo case and explain the verdict notes and risk signals.
6. Upload your own image or video.
7. Run analysis and show how it appears in `Your Search History`.
8. Export the JSON report.
