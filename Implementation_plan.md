# Implementation Plan: SyncScribe AI 🚀
### *Unlimited Meeting Transcriber & Instant WhatsApp Relay (Zero-Backend Architecture)*

This document details the updated blueprint for **SyncScribe AI** — a 100% serverless, open-source Chrome Extension that transcribes Google Meet, Zoom Web, and MS Teams in real time, generates AI summaries using OpenRouter free models, and relays summaries directly to WhatsApp Web **without requiring any local server, node processes, or cloud hosting**.

---

## 1. Zero-Backend Architecture Overview

By leveraging Chrome Extension APIs and direct WhatsApp Web deep-linking, **SyncScribe AI** operates with **zero server infrastructure**:

```
┌───────────────────────────────────┐      ┌───────────────────────────────────┐      ┌───────────────────────────────────┐
│ Chrome Extension (SyncScribe AI)  │ ───► │ OpenRouter AI API                 │ ───► │ WhatsApp Web Tab                  │
│ Captures Live Captions & Speakers │      │ (Free Models generate summary)    │      │ (Pre-filled summary ready to send)│
└───────────────────────────────────┘      └───────────────────────────────────┘      └───────────────────────────────────┘
```

### Why this architecture is ideal:
* 🟢 **No Localhost Required:** You never need to run terminal commands (`npm start` or Node.js) during meetings.
* 🟢 **100% Free & Serverless:** Zero hosting fees, zero server maintenance, zero API token costs (using OpenRouter free models).
* 🟢 **Maximum Privacy & Control:** Your data stays in your browser and your own WhatsApp account session.

---

## 2. Project Directory Structure (`SyncScribe-AI`)

```
SyncScribe-AI/
├── manifest.json              # Chrome Extension Manifest V3
├── popup.html                 # Glassmorphism Dashboard & Control Panel UI
├── popup.js                   # Extension UI Controller & OpenRouter Handler
├── content.js                 # Universal DOM Caption Scraper (Meet, Zoom, Teams)
├── background.js              # State manager & WhatsApp Web deep-link launcher
├── pdf_export.js              # PDF & TXT document exporter library
├── styles.css                 # Modern dark-mode glassmorphism styling
├── icons/                     # Extension branding icons
├── .gitignore
├── LICENSE (MIT)
└── README.md                  # Comprehensive GitHub documentation & usage guide
```

---

## 3. Extension User Interface (UI) Design

### Modern Glassmorphism Dashboard (`popup.html`):
* 🟢 **Live Status Banner:** Displays real-time recording state, meeting platform, and captured sentence count.
* 📜 **Live Transcript View:** Scrollable preview showing real-time timestamps and speaker names (e.g., `[10:02 AM] Claudia: ...`).
* 📄 **Instant Export Actions:**
  * 📄 `Download TXT` (One-click plain text transcript export)
  * 📕 `Download PDF` (Formatted PDF export via client-side jsPDF)
  * 🚀 `Summarize & Send to WhatsApp` (Generates OpenRouter AI summary and opens WhatsApp Web pre-filled)
* ⚙️ **Settings Panel:**
  * Save OpenRouter API Key (Supports free models: `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-lite-preview-02-05:free`, `deepseek/deepseek-r1:free`).
  * Target WhatsApp Chat / Phone Number (Optional pre-fill).

---

## 4. How the Zero-Backend WhatsApp Relay Works

1. **Step 1 (Summarize):** When the user clicks **Summarize & Send to WhatsApp**, `background.js` retrieves the live transcript from `chrome.storage.local`.
2. **Step 2 (AI Generation):** `background.js` sends the transcript to OpenRouter free API endpoint, formatting a structured summary with WhatsApp bolding (`*text*`), bullet points, and team section headers (Software Engineering & Clinical Reviewers).
3. **Step 3 (WhatsApp Launch):** The extension opens a new tab to:
   `https://web.whatsapp.com/send?text=ENCODED_SUMMARY_TEXT`
   * If a target phone number is saved in settings, it opens `https://web.whatsapp.com/send?phone=NUMBER&text=ENCODED_SUMMARY_TEXT`.
4. **Step 4 (Dispatch):** WhatsApp Web opens with the formatted summary pre-filled in the text box. The user simply presses **Enter** (or an injected content script on WhatsApp Web auto-triggers the send button).

---

## 5. Implementation & GitHub Push Plan

### Steps to Build:
1. Create project folder `SyncScribe-AI`.
2. Implement `manifest.json` (Manifest V3).
3. Implement `content.js` (DOM caption observer for Google Meet, Zoom Web, MS Teams).
4. Implement `background.js` & `popup.js` (OpenRouter integration, storage, WhatsApp link builder).
5. Implement `popup.html` & `styles.css` (Glassmorphism dark UI).
6. Implement `pdf_export.js` (TXT & PDF exports).
7. Create `README.md` & GitHub initial commit.

---

## Verification Plan

### Manual Verification
1. **Load Extension:** Load `SyncScribe-AI` folder in Chrome (`chrome://extensions` -> Developer Mode -> Load Unpacked).
2. **Test OpenRouter Summary:** Verify OpenRouter free model returns structured markdown summary.
3. **Test WhatsApp Web Direct Launch:** Confirm WhatsApp Web tab opens with pre-filled summary text formatted with `*bolding*` and emojis.
4. **Test Export Capabilities:** Confirm `.txt` and `.pdf` files download cleanly.
