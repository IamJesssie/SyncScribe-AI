# Implementation Plan: ZeroScribe AI

This document outlines the architectural strategy, module breakdown, and development phases for ZeroScribe AI.

## 1. System Architecture Overview

ZeroScribe AI operates entirely within the browser, functioning as a Manifest V3 extension.

### Core Components:
- **Background Service Worker (`background.js`):** Orchestrates API calls, manages the OpenRouter fallback chain, and handles the multi-channel dispatch webhooks.
- **Offscreen Document (`offscreen.js`):** Crucial for the Web Audio API. It captures and mixes Tab Audio (using `chrome.tabCapture`) and Microphone Audio (using `getUserMedia`), bypassing standard CC limitations.
- **Content Scripts (`content.js`):** Injected into meeting tabs (Meet, Zoom, Teams) to provide the UI overlay and extract DOM-level context if needed.
- **SidePanel / Popup UI:** The Raycast/Linear-style interface built with React/TailwindCSS (or vanilla JS/CSS) featuring custom SVG icons and keyboard-first navigation.

## 2. Module Breakdown

### 2.1 Audio Processing Engine (Offscreen)
- **Goal:** Capture high-fidelity dual audio.
- **Implementation:**
  - Request user media for mic.
  - Request tab capture.
  - Route both through `AudioContext` and mix via `GainNode`s.
  - Stream chunks to the configured STT provider (Deepgram/Whisper) or local transcriber.

### 2.2 Transcription & STT Pipeline
- **Goal:** Real-time, deduplicated text.
- **Implementation:**
  - Handle WebSocket connections for live streaming STT.
  - Implement a rolling buffer for speaker attribution.
  - Process offline files via a drag-and-drop zone using REST APIs.

### 2.3 AI Copilot & OpenRouter Fallback
- **Goal:** Resilient, high-quality AI assistance.
- **Implementation:**
  - Define the 2-Stage Meta-Prompting strategy (Stage 1: Entity extraction, Stage 2: Synthesis & Formatting).
  - Implement an asynchronous retry queue cascading through models: Llama 3.3 -> Gemini Flash -> DeepSeek R1 -> Qwen 2.5 -> Mistral.

### 2.4 Multi-Channel Relay
- **Goal:** Frictionless export and sharing.
- **Implementation:**
  - **WhatsApp:** Inject scripts into `web.whatsapp.com` to auto-focus and prefill chat boxes using URL schemes or DOM manipulation.
  - **Slack / Teams:** Configure standardized payload formats for incoming webhooks.
  - **Export Engine:** Use `jspdf` for PDF generation and standard Blobs for TXT files.

## 3. Development Phases

### Phase 1: Foundation & Audio Plumbing
- Scaffold Manifest V3 extension.
- Implement `offscreen.html` and `offscreen.js` for dual audio mixing.
- Verify audio stream extraction.

### Phase 2: STT & UI Prototyping
- Integrate Deepgram Nova-2 / Whisper STT.
- Build the Raycast/Linear aesthetic UI (dark mode, SVGs, keyboard shortcuts).
- Display live transcription with speaker diarization mockups.

### Phase 3: AI Copilot Integration
- Build the OpenRouter client with the fallback array logic.
- Design and test the 2-stage meta-prompts for "Quick Cues" and "Suggest Questions".
- Connect live STT transcript feed into the LLM context window.

### Phase 4: Relay & Export
- Implement Webhook dispatchers (Slack, Teams).
- Implement WhatsApp Web DOM injection.
- Add PDF/TXT export functionality.

### Phase 5: Polish & Advanced Features
- Refine the deduplication algorithms.
- Conduct extensive testing on Google Meet, Zoom, and Teams web clients.
- Finalize UI animations, focus states, and overall performance tuning.
- Lay groundwork for the Future Roadmap (Vector Brain / MemPalace).
