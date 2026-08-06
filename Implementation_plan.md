# Implementation Plan: WhatsApp Group Relay & Custom AI System Prompt 🚀

This document details the blueprint for implementing:
1. **Zero-Backend WhatsApp Group Chat Relay Strategy** (Explaining how SyncScribe AI relays to WhatsApp Groups without n8n or servers).
2. **Custom AI System Prompt Input & Storage** (Allowing users to customize, save, and persist system prompts used during OpenRouter AI summarization).

---

## 1. Zero-Backend WhatsApp Group Chat Strategy (No n8n / Automation Platform)

### Context & Challenge:
WhatsApp does not provide a free, serverless API for bot injection into group chats without WhatsApp Business API / Twilio / Meta Cloud API (which require servers and paid subscriptions).

### Solution: Direct WhatsApp Web Deep-Linking & Smart Group Relay
Without any backend or n8n, **SyncScribe AI** achieves 100% free group chat relay via Chrome Extension deep-linking:

```
┌──────────────────────────────────────┐
│  Chrome Extension (SyncScribe AI)    │
│  Generates AI Summary via OpenRouter │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│      WhatsApp Web Contact / Group    │
│            Selection Picker          │
│   https://web.whatsapp.com/send?text │
└──────────────────┬───────────────────┘
                   │ User selects target Group
                   ▼
┌──────────────────────────────────────┐
│      Target WhatsApp Group Chat      │
│  Pre-filled summary ready in group   │
│  input box (Click Enter to send)     │
└──────────────────────────────────────┘
```

1. **Group Picker Mode (No Phone Number):** When `Target WhatsApp Phone Number` is left blank in Settings, the extension opens `https://web.whatsapp.com/send?text=ENCODED_SUMMARY`. WhatsApp Web automatically presents a **"Share to Contact or Group"** picker modal. The user selects any group chat (e.g. *Engineering Team*, *Project Alpha*), and the summary is injected into that group's chat input box.
2. **Direct Group Chat Auto-Focus:** `whatsapp_content.js` detects when WhatsApp Web loads with pre-filled text, focuses the active group chat input box, and displays a floating notification: `"SyncScribe AI: Summary ready in Group Chat! Press Enter to send."`

---

## 2. Proposed Code Changes

### Component 1: Extension UI (`popup.html` & `styles.css`)
Add a new **Custom System Prompt** textarea in the Settings panel of `popup.html`, allowing users to define specific persona, format rules, or prompt guidelines.

#### [MODIFY] `popup.html`
- Add System Prompt textarea field with default placeholder & hint.

#### [MODIFY] `styles.css`
- Ensure textareas in the settings panel have sleek dark glassmorphism styling, resize handles, and smooth scrollbars.

---

### Component 2: UI Controller & Storage (`popup.js`)
- Bind `setting-systemprompt` DOM element.
- Load stored system prompt from `chrome.storage.local` (defaulting to structured WhatsApp template if unset).
- Save `systemPrompt` when the user clicks **Save Preferences**.
- Pass user's system prompt during OpenRouter summary generation.

#### [MODIFY] `popup.js`
- Include `systemPrompt` in `loadSettings()` and `btn-save-settings` event handler.

---

### Component 3: Background Worker & AI API (`background.js`)
- Read saved `systemPrompt` from `chrome.storage.local` inside `generateOpenRouterSummary()`.
- Use custom system prompt in the payload sent to OpenRouter API:
  ```json
  {
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "messages": [
      { "role": "system", "content": "USER_CUSTOM_SYSTEM_PROMPT" },
      { "role": "user", "content": "Transcript text..." }
    ]
  }
  ```

#### [MODIFY] `background.js`
- Update `DEFAULT_SETTINGS` object to include default system prompt string.
- Update `generateOpenRouterSummary()` to prioritize user-configured system prompt.

---

### Component 4: Documentation (`README.md`)
- Document the WhatsApp Group relay workflow and Custom System Prompt configuration.

#### [MODIFY] `README.md`

---

## 3. Verification Plan

### Manual Verification
1. **Test Custom System Prompt Persistence:**
   - Open Extension -> Settings tab.
   - Modify System Prompt (e.g., change to `"Summarize in 3 short bullet points with high urgency"`).
   - Click **Save Preferences**. Close & reopen extension to verify prompt persists.
2. **Test OpenRouter Generation with Custom Prompt:**
   - Click **Summarize & Send to WhatsApp**.
   - Verify generated summary in the AI Summary tab adheres to the customized system prompt instructions.
3. **Test WhatsApp Group Relay:**
   - Leave `Target Phone Number` blank in settings.
   - Click **Summarize & Send to WhatsApp**.
   - Verify WhatsApp Web opens with the group/contact selector or pre-filled message ready in the selected group chat.
