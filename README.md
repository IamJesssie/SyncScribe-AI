# SyncScribe AI 🚀

> **Unlimited Real-Time Meeting Transcriber & Instant WhatsApp Relay (Zero-Backend Architecture)**

SyncScribe AI is a 100% serverless, open-source Chrome Extension (Manifest V3) that transcribes **Google Meet**, **Zoom Web**, and **MS Teams** meetings in real time, generates structured AI summaries using **OpenRouter Free Models**, and relays formatted summaries directly to **WhatsApp Web** — **without requiring any local server, node processes, or cloud hosting**.

---

## 🌟 Key Features

* 🟢 **Zero-Backend & 100% Free:** No `npm start`, localhost servers, or backend hosting required. Everything runs inside your browser.
* 🎙️ **Universal Audio & DOM Transcriber:** Live closed caption scraper for Google Meet, Zoom, and Teams + **Audio File Speech-to-Text** for physical meeting recordings (`.m4a`, `.mp3`, `.wav`, `.aac`, `.ogg`) using **Deepgram Nova-2** with automatic speaker identification (`Speaker 1`, `Speaker 2`).
* 🤖 **OpenRouter AI Integration:** Generates executive summaries using top free models (`Meta Llama 3.3 70B`, `Google Gemini 2.0 Flash Lite`, `DeepSeek R1`, `Qwen 2.5 72B`, `Mistral Small 24B`).
* ✨ **Auto-Detect Persona & Meta-Prompting:** Automatically runs a 2-stage analysis pass over transcripts to dynamically detect meeting titles, participant roles (e.g. Software Engineers vs. Clinical Reviewers), operational rules, and key metrics.
* 💬 **Multi-Platform Dispatch Relay:** Instant dispatch to **WhatsApp Web** (chats or group picker), **Slack** (via Webhook or Web), and **MS Teams** (via Webhook or Web).
* 📁 **Transcript & Audio Upload Support:** Upload external `.txt`, `.vtt`, `.srt`, `.json`, `.mp3`, `.m4a`, or `.wav` files directly into the extension.
* 📄 **Multi-Format Document Exporter:** One-click exports for `.txt` plain text transcripts and formatted printable `.pdf` meeting reports.
* 🎨 **Ultra-Sleek Glassmorphism Dashboard:** Dark-mode popup UI with real-time sentence counter, live status indicators, tab navigation, and settings panel.

---

## 🏗️ Architecture Diagram

```
┌─────────────────────────────────────────┐
│     Chrome Extension (SyncScribe AI)    │
│  Captures Live Captions & Speaker Names │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           OpenRouter AI API             │
│   Generates WhatsApp-Formatted Summary  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│            WhatsApp Web Tab             │
│   Pre-filled summary ready to dispatch  │
└─────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```
SyncScribeAI/
├── manifest.json              # Chrome Extension Manifest V3
├── popup.html                 # Glassmorphism Dashboard UI
├── popup.js                   # Extension UI Controller & OpenRouter Handler
├── content.js                 # Universal DOM Caption Scraper (Meet, Zoom, Teams)
├── whatsapp_content.js        # WhatsApp Web helper content script
├── background.js              # State manager & WhatsApp Web deep-link worker
├── pdf_export.js              # PDF & TXT document exporter library
├── styles.css                 # Dark-mode glassmorphism styling
├── icons/                     # Extension branding icons (16x16, 48x48, 128x128)
├── Implementation_plan.md     # Architectural & build blueprint
├── .gitignore                 # Standard git ignore rules
├── LICENSE                    # MIT License
└── README.md                  # Project documentation
```

---

## 🚀 Quick Start & Installation

### Step 1: Clone / Download Repository
```bash
git clone https://github.com/SyncScribeAI/SyncScribeAI.git
```

### Step 2: Load Extension into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `SyncScribeAI` directory.
5. SyncScribe AI is now installed and active in your Chrome browser!

---

## 💡 How to Use SyncScribe AI

### 1. Start a Meeting
* Open **Google Meet**, **Zoom Web**, or **MS Teams**.
* Turn on **Closed Captions (CC)** in the meeting control bar.
* The SyncScribe floating badge will appear in the top-right corner of the meeting window, displaying live captured lines.

### 2. View Real-Time Transcript
* Click the **SyncScribe AI** extension icon in your Chrome toolbar.
### 3. Generate & Preview AI Summary
* Click **`⚡ Generate AI Summary Preview`**.
* The extension analyzes your meeting transcript (using Auto-Meta Prompting or your Custom System Prompt) and switches to the **AI Summary** tab to display a live preview!

### 4. Relay to WhatsApp, Slack, or Teams
* Review your generated summary preview.
* Click **`Send to WhatsApp`** (opens WhatsApp Web with pre-filled summary & group picker), **`Send to Slack`**, **`Send to Teams`**, or **`Copy Summary`**.

### 5. Export Transcripts & Files
* Click **Upload Transcript File** (`.txt`, `.vtt`, `.srt`, `.json`) to load external transcripts.
* Click **Download TXT** or **Download PDF** for local formatted exports.

---

## ⚙️ Extension Settings & Customization

### 💬 WhatsApp Group Chat Relay (No n8n / Automation Required)
* **Send to ANY WhatsApp Group:** Leave the `Target WhatsApp Phone Number` setting **BLANK**.
* When you click **Summarize & Send to WhatsApp**, WhatsApp Web opens with the **"Share to Contact or Group"** selection modal.
* Pick any group chat (e.g. *Engineering Team*, *Project Alpha*), and SyncScribe AI automatically pre-fills your summary into that group chat box ready to send!
* *(Optional)* Enter an international phone number (e.g. `+62812345678`) to send directly to an individual user chat.

### 🧠 Custom AI System Prompt
You can fully customize how the AI analyzes and formats your meeting summaries inside the **Settings** panel:
* Define custom personas, target languages, formatting guidelines, or bullet point rules.
* **Persistent Storage:** Your custom system prompt is saved locally in Chrome storage and loaded automatically every time.

### 🤖 OpenRouter AI Model Selection
SyncScribe AI gives you **100% full control** over which OpenRouter model processes your transcripts. Enter any valid OpenRouter model string manually, or select from built-in suggestions:

| Suggested Model | Provider | Type |
| :--- | :--- | :--- |
| `meta-llama/llama-3.3-70b-instruct:free` | Meta | Free (Default) |
| `google/gemini-2.0-flash-lite-preview-02-05:free` | Google | Free |
| `deepseek/deepseek-r1:free` | DeepSeek | Free |
| `qwen/qwen-2.5-72b-instruct:free` | Alibaba Qwen | Free |
| `mistralai/mistral-small-24b-instruct-2501:free` | Mistral AI | Free |
| `openai/gpt-4o-mini` | OpenAI | Paid |
| `anthropic/claude-3.5-sonnet` | Anthropic | Paid |

*Simply paste or type any model ID from [OpenRouter Models](https://openrouter.ai/models) into the model setting field!*

---

## 🛡️ Privacy & Security

* **100% Client-Side:** Your transcripts never leave your browser session except when sent to OpenRouter API for summarization.
* **No Database Storage:** No user tracking, credentials logging, or external database persistence.

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
