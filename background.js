/**
 * ZeroScribe AI - Service Worker & State Manager
 * Handles transcript storage, OpenRouter AI summarization, and multi-channel dispatch
 * 
 * Architecture: TabCapture with Web Audio API mixing (offscreen.js)
 */

const DEFAULT_SYSTEM_PROMPT = `You are an expert Executive AI Assistant for software engineering, clinical review, and operations teams building healthcare and enterprise platforms.

INSTRUCTIONS FOR HIGH-PRECISION SUMMARY GENERATION:

1. DYNAMIC MEETING CLASSIFICATION:
   - Identify Meeting Title, Category, Date/Time, and Duration.
   - Identify Key Hosts & Presenters with exact titles.
   - Group participants into functional roles (e.g. Software Engineers, Clinical Reviewers, Operations Leads, Project Managers).

2. EXHAUSTIVE TECHNICAL SPEC & CODE EXTRACTION (NEVER OMIT METRICS):
   - Retain ALL exact numbers, dates, deadlines, equipment specs (e.g., 27-34" monitors), tools (Reach 360, Claude AI, Digital Donor, Tactiq), and codes.
   - List EVERY product code, legacy code, donor sequence format, and numerical threshold mentioned (e.g. B0108, B0105, V0108, V0105, V003, V004, B0070, B0076, W4129, >2,800 cells, <12 hrs, <7 days).
   - Capture third-party names, upcoming meetings, and department contacts mentioned even if not present on the call (e.g., Araceli for Family Services, Nathan & Trish for processing, Sila for LMS IT support, Dor/Dhore for Executive direction).

3. STRICT ANTI-HALLUCINATION GUARDRAILS:
   - NEVER invent or expand medical/technical acronyms (e.g. PKP, DMEC, LMS, QA) unless the exact expansion was explicitly spoken by a participant in the transcript text.
   - Strictly reflect the direction of data flow and logistics (e.g. do not confuse importing corneas to San Diego vs importing from San Diego).

4. ADAPTIVE TOPIC SECTIONS (Create 2-5 custom sections based ONLY on what was discussed):
   - 🏢 *OFFICE, HARDWARE & ONBOARDING LOGISTICS* (Hardware specs, LMS access, holiday schedules, HR forms).
   - 💻 *SOFTWARE PLATFORM & SYSTEM ARCHITECTURE* (Technical specifications, doctor parameter matching, priority tier systems, product codes, API integrations).
   - 🩺 *CLINICAL REVIEW & WORKFLOWS* (Chart screening, tissue verification, Claude AI projects, Digital Donor medical records).
   - ⚙️ *DEPARTMENTAL OPERATIONAL RULES & METRICS* (Exact metrics, cell counts, age limits, cut thickness, shipping rules, QA 3-month tracking).

5. FORMATTING:
   - Use WhatsApp markdown (*bold* for key terms), section emojis, bullet points, and solid line dividers (──────────).

EXPECTED STRUCTURE TEMPLATE:

──────────
### 📌 [DYNAMICALLY DETECTED MEETING TITLE & CATEGORY]
📅 Date: [Date/Time] | ⏱ Duration: [Duration]
👥 Key Speakers: [Host Names & Titles]
📍 Participants: [Software Engineers] | [Clinical Reviewers] | [Operations Leads]
──────────
[DYNAMIC SECTION 1 - e.g. 🎯 CORE PURPOSE & BUSINESS CONTEXT or 🏢 ONBOARDING LOGISTICS]
[Detailed breakdown of the primary operational topics discussed]

──────────
[DYNAMIC SECTION 2 - e.g. 💻 SOFTWARE ENGINEERING FOCUS & ARCHITECTURE]
• [Bullet points of technical requirements, product code rules, matching engine specs, and developer assignments]

──────────
[DYNAMIC SECTION 3 - e.g. 🩺 CLINICAL REVIEW & CHART SCREENING WORKFLOWS]
• [Bullet points of clinical review tasks, Claude AI project setups, training steps]

──────────
[DYNAMIC SECTION 4 - e.g. ⚙️ DEPARTMENTAL OPERATIONAL METRICS & SPECIFICATIONS]
• [Exhaustive metrics table or bullet list of numerical parameters, thresholds, and tracking rules]

──────────
### 🚀 ACTION ITEMS & IMMEDIATE NEXT STEPS
1. 📚 [Immediate tasks with dates, deadlines, and responsible owners]
2. 🗓 [Upcoming orientation meetings & schedule]

──────────
📌 Note: [Key availability, support contacts, or next-step notes]`;

const DEFAULT_SETTINGS = {
  openRouterApiKey: '',
  selectedModel: 'inclusionai/ling-3.0-flash',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  useAutoMetaPrompt: true,
  sttProvider: 'webspeech',
  sttApiKey: '',
  targetPhone: '',
  slackWebhookUrl: '',
  teamsWebhookUrl: ''
};

// ── State Variables ─────────────────────────────────────────────────────
let pendingStreamId = null;
let capturedTabId = null;
let capturedTabTitle = null;
let captureActive = false;

// ── Initialize Storage & SidePanel on install ───────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['zeroscribe_captions', 'syncscribe_captions', 'zeroscribe_settings', 'syncscribe_settings'], (result) => {
    if (!result.zeroscribe_captions && !result.syncscribe_captions) {
      chrome.storage.local.set({ zeroscribe_captions: [] });
    }
    if (!result.zeroscribe_settings && !result.syncscribe_settings) {
      chrome.storage.local.set({ zeroscribe_settings: DEFAULT_SETTINGS });
    }
  });

  // SidePanel: open on action click is FALSE so we can use action.onClicked for tab capture
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

// Helper to retrieve settings with migration fallback
async function getStoredSettings() {
  const data = await chrome.storage.local.get(['zeroscribe_settings', 'syncscribe_settings']);
  return data.zeroscribe_settings || data.syncscribe_settings || DEFAULT_SETTINGS;
}

// Helper to retrieve captions with migration fallback
async function getCaptions() {
  const data = await chrome.storage.local.get(['zeroscribe_captions', 'syncscribe_captions']);
  return data.zeroscribe_captions || data.syncscribe_captions || [];
}

async function saveCaptions(captions) {
  await chrome.storage.local.set({ zeroscribe_captions: captions });
}

// ── Action Click Handler (Toolbar Icon Click) ───────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  // Open side panel for current window
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (e) {
      console.warn('[ZeroScribe AI] SidePanel open warning:', e.message);
    }
  }

  // Toggle Tab Capture Audio Transcription
  if (captureActive) {
    await stopAudioCapture();
  } else {
    try {
      await startAudioCaptureForTab(tab);
    } catch (err) {
      console.error('[ZeroScribe AI] Audio capture failed:', err);
      broadcastToRuntime({ action: 'CAPTURE_ERROR', error: err.message });
    }
  }
});

// ── Start Audio Capture ────────────────────────────────────────────────
async function startAudioCaptureForTab(tab) {
  capturedTabId = tab.id;
  capturedTabTitle = tab.title || 'Live Meeting';

  // Request stream ID from tabCapture
  pendingStreamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: capturedTabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        return reject(new Error(chrome.runtime.lastError?.message || 'Failed to capture tab audio stream.'));
      }
      resolve(streamId);
    });
  });

  console.log(`[ZeroScribe AI] Tab audio captured: "${capturedTabTitle}" (streamId: ${pendingStreamId.substring(0, 20)}...)`);

  // Ensure offscreen document exists
  await ensureOffscreenDocument();

  // Wait for offscreen document to report ready
  await waitForOffscreenReady();

  // Claim stream in offscreen document
  try {
    const claimRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'CLAIM_STREAM',
        target: 'offscreen',
        streamId: pendingStreamId
      }, resolve);
    });
    if (!claimRes || !claimRes.success) {
      console.error('[ZeroScribe AI] Failed to claim stream:', claimRes?.error);
    }
  } catch (err) {
    console.warn('[ZeroScribe AI] Claim stream warning:', err.message);
  }

  // Start transcription engine
  const settings = await getStoredSettings();

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'ENGINE_START',
      target: 'offscreen',
      streamId: pendingStreamId,
      sttApiKey: settings.sttApiKey,
      sttProvider: settings.sttProvider
    }, resolve);
  });

  if (!response || !response.success) {
    throw new Error(response?.error || 'Failed to start transcription engine.');
  }

  captureActive = true;
  broadcastToRuntime({ action: 'CAPTURE_STATUS', active: true, tabTitle: capturedTabTitle });
}

// ── Start Audio Capture from SidePanel Gesture ───────────────────────────
async function startAudioCaptureWithStreamId(streamId, tabTitle) {
  pendingStreamId = streamId;
  capturedTabTitle = tabTitle || 'Live Meeting';

  console.log(`[ZeroScribe AI] Starting capture with pre-acquired streamId: ${streamId.substring(0, 20)}...`);

  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'CLAIM_STREAM',
        target: 'offscreen',
        streamId: pendingStreamId
      }, resolve);
    });
  } catch (e) {
    console.warn('[ZeroScribe AI] Stream claim notice:', e.message);
  }

  const settings = await getStoredSettings();

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'ENGINE_START',
      target: 'offscreen',
      streamId: pendingStreamId,
      sttApiKey: settings.sttApiKey,
      sttProvider: settings.sttProvider
    }, resolve);
  });

  if (!response || !response.success) {
    throw new Error(response?.error || 'Failed to start transcription engine.');
  }

  captureActive = true;
  broadcastToRuntime({ action: 'CAPTURE_STATUS', active: true, tabTitle: capturedTabTitle });
}

// ── Stop Audio Capture ──────────────────────────────────────────────────
async function stopAudioCapture() {
  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'ENGINE_STOP', target: 'offscreen' }, resolve);
    });
  } catch (e) {
    console.warn('[ZeroScribe AI] Stop capture notice:', e.message);
  }

  captureActive = false;
  pendingStreamId = null;
  capturedTabId = null;
  capturedTabTitle = null;

  broadcastToRuntime({ action: 'CAPTURE_STATUS', active: false });
}

// ── Offscreen Document Management ───────────────────────────────────────
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture and process tab audio stream for live meeting transcription.'
    });
  }
}

async function waitForOffscreenReady(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_PING', target: 'offscreen' }, resolve);
      });
      if (res && res.pong) return true;
    } catch (e) {
      // Offscreen not ready yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// ── Broadcast Helper ────────────────────────────────────────────────────
function broadcastToRuntime(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup or sidepanel might be closed
  });
}

// ── Listen to incoming runtime messages ─────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Offscreen transcript relay
  if (request.action === 'ENGINE_TRANSCRIPT') {
    handleNewCaption({
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      platform: 'Tab Audio STT',
      speaker: request.speaker || 'Speaker',
      text: request.text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rawTime: Date.now()
    });
    return;
  }

  if (request.action === 'ENGINE_INTERIM') {
    broadcastToRuntime({
      action: 'INTERIM_TRANSCRIPT',
      text: request.text,
      speaker: request.speaker || 'Speaker'
    });
    return;
  }

  if (request.action === 'NEW_CAPTION') {
    handleNewCaption(request.data);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GET_CAPTIONS') {
    getCaptions().then((captions) => sendResponse({ captions }));
    return true;
  }

  if (request.action === 'CLEAR_TRANSCRIPT') {
    saveCaptions([]).then(() => {
      broadcastToRuntime({ action: 'TRANSCRIPT_UPDATED', captions: [] });
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'GENERATE_AI_SUMMARY') {
    handleGenerateAiSummary(request, sendResponse);
    return true;
  }

  if (request.action === 'ASK_AI_COPILOT') {
    handleAskAiCopilot(request, sendResponse);
    return true;
  }

  if (request.action === 'GENERATE_AUTO_SYSTEM_PROMPT' || request.action === 'SYNTHESIZE_SYSTEM_PROMPT') {
    handleGenerateAutoSystemPrompt(request, sendResponse);
    return true;
  }

  if (request.action === 'DISPATCH_WHATSAPP') {
    handleDispatchWhatsApp(request.phone, sendResponse);
    return true;
  }

  if (request.action === 'DISPATCH_SLACK') {
    handleDispatchSlack(request.webhookUrl, sendResponse);
    return true;
  }

  if (request.action === 'DISPATCH_TEAMS') {
    handleDispatchTeams(request.webhookUrl, sendResponse);
    return true;
  }

  if (request.action === 'START_LIVE_AUDIO_CAPTURE' || request.action === 'START_TAB_CAPTURE_VIA_GESTURE') {
    if (request.streamId) {
      startAudioCaptureWithStreamId(request.streamId, request.tabTitle)
        .then(() => sendResponse({ success: true, method: 'tabCapture' }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    } else {
      // Fallback: Notify active tab content script to start DOM Caption Scraper (Meet/Zoom/Teams)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'START_RECORDING' }, (res) => {
            if (chrome.runtime.lastError || !res) {
              sendResponse({ success: false, error: 'Please switch to a Google Meet, Zoom, or Teams tab to start live transcription!' });
            } else {
              captureActive = true;
              sendResponse({ success: true, method: 'DOM Caption Scraper' });
            }
          });
        } else {
          sendResponse({ success: false, error: 'No active meeting tab found.' });
        }
      });
    }
    return true;
  }

  if (request.action === 'STOP_LIVE_AUDIO_CAPTURE' || request.action === 'STOP_TAB_CAPTURE') {
    stopAudioCapture().then(() => sendResponse({ success: true }));
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_RECORDING' }).catch(() => {});
      }
    });
    return true;
  }

  if (request.action === 'GET_CAPTURE_STATUS') {
    sendResponse({ active: captureActive, tabTitle: capturedTabTitle });
    return true;
  }

  if (request.action === 'TRANSCRIBE_AUDIO') {
    handleTranscribeAudioFile(request, sendResponse);
    return true;
  }
});

// ── Handle New Caption with Cross-Source Deduplication ───────────────────
async function handleNewCaption(newCap) {
  if (!newCap || !newCap.text || !newCap.text.trim()) return;

  const current = await getCaptions();
  const textTrimmed = newCap.text.trim();

  // Deduplication check: ignore identical text within 4 seconds
  const isDuplicate = current.some((c) => {
    const timeDiff = Math.abs(newCap.rawTime - c.rawTime);
    return timeDiff < 4000 && c.text.trim() === textTrimmed;
  });

  if (isDuplicate) return;

  const updated = [...current, newCap];
  await saveCaptions(updated);
  broadcastToRuntime({ action: 'NEW_CAPTION_ADDED', caption: newCap, totalCount: updated.length });
}

// ── Model Alias & Fuzzy Matching Dictionary ───────────────────────────
const MODEL_ALIASES = {
  'ling': 'inclusionai/ling-3.0-tiny:free',
  'ling-tiny': 'inclusionai/ling-3.0-tiny:free',
  'ling-flash': 'inclusionai/ling-3.0-flash',
  'llama': 'meta-llama/llama-3.3-70b-instruct:free',
  'llama-3.3': 'meta-llama/llama-3.3-70b-instruct:free',
  'gemini': 'google/gemini-2.0-flash-lite-preview-02-05:free',
  'gemini-flash': 'google/gemini-2.0-flash-lite-preview-02-05:free',
  'deepseek': 'deepseek/deepseek-r1:free'
};

function normalizeModelSlug(userSlug) {
  if (!userSlug) return 'inclusionai/ling-3.0-tiny:free';
  const clean = userSlug.trim();
  const cleanLower = clean.toLowerCase();
  if (MODEL_ALIASES[cleanLower]) return MODEL_ALIASES[cleanLower];
  return clean;
}

// ── Model Fallback Array ────────────────────────────────────────────────
const FREE_MODEL_FALLBACKS = [
  'inclusionai/ling-3.0-tiny:free',
  'inclusionai/ling-3.0-tiny',
  'inclusionai/ling-3.0-flash',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-lite-preview-02-05:free',
  'google/gemini-2.0-flash-exp:free',
  'deepseek/deepseek-r1:free'
];

async function fetchOpenRouterWithFallback(apiKey, selectedModel, systemPrompt, userMessage) {
  const primaryModel = normalizeModelSlug(selectedModel);
  const modelList = [];

  if (primaryModel) {
    modelList.push(primaryModel);
    if (!primaryModel.endsWith(':free') && !primaryModel.includes('gpt-') && !primaryModel.includes('claude-')) {
      modelList.push(`${primaryModel}:free`);
    } else if (primaryModel.endsWith(':free')) {
      modelList.push(primaryModel.replace(':free', ''));
    }
  }

  FREE_MODEL_FALLBACKS.forEach((m) => {
    if (!modelList.includes(m)) modelList.push(m);
  });

  let primaryError = null;
  let lastError = null;

  for (let i = 0; i < modelList.length; i++) {
    const m = modelList[i];
    try {
      console.log(`[ZeroScribe AI] Requesting OpenRouter Model (${i + 1}/${modelList.length}): ${m}`);
      
      const reqHeaders = {
        'HTTP-Referer': 'https://github.com/ZeroScribeAI',
        'X-Title': 'ZeroScribe AI Extension',
        'Content-Type': 'application/json'
      };

      if (apiKey && apiKey.trim() !== '') {
        reqHeaders['Authorization'] = `Bearer ${apiKey.trim()}`;
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          model: m,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) {
          console.log(`[ZeroScribe AI] Successfully received response from model: ${m}`);
          return content.trim();
        }
      }

      const errText = await response.text().catch(() => '');
      let detail = errText;
      try {
        const parsed = JSON.parse(errText);
        detail = parsed.error?.message || errText;
      } catch (e) {}

      const errString = `Model "${m}" (${response.status}): ${detail}`;
      if (i === 0) {
        primaryError = errString;
      }
      lastError = errString;

      // Auto-extract recommended replacement slug if OpenRouter 404s with "use this slug instead: <slug>"
      const slugMatch = detail.match(/use this slug instead:\s*([a-zA-Z0-9_\-\.\/]+)/i);
      if (slugMatch && slugMatch[1]) {
        const suggestedSlug = slugMatch[1].trim();
        if (!modelList.includes(suggestedSlug)) {
          console.log(`[ZeroScribe AI] Auto-adding suggested replacement model slug: ${suggestedSlug}`);
          modelList.splice(i + 1, 0, suggestedSlug);
        }
      }

      console.warn(`[ZeroScribe AI] ${errString}`);
    } catch (e) {
      const errString = `Network exception trying model "${m}": ${e.message}`;
      if (i === 0) primaryError = errString;
      lastError = errString;
      console.warn(`[ZeroScribe AI] ${errString}`);
    }
  }

  const finalError = primaryError
    ? `Primary model "${selectedModel}" failed (${primaryError}). ${lastError !== primaryError ? 'Fallback error: ' + lastError : ''}`
    : lastError || 'All AI models failed to generate a response. Please check network or API key.';

  throw new Error(finalError);
}

// ── OpenRouter AI Summarization ──────────────────────────────────────────
async function handleGenerateAiSummary(request, sendResponse) {
  try {
    const captions = await getCaptions();
    if (captions.length === 0) {
      return sendResponse({ success: false, error: 'No transcript lines captured yet.' });
    }

    const settings = await getStoredSettings();
    const apiKey = (request && request.customApiKey) || settings.openRouterApiKey;
    const selectedModel = (request && request.customModel) || settings.selectedModel;
    const customPrompt = (request && request.customSystemPrompt) || settings.systemPrompt;
    const useAutoMetaPrompt = request && request.useAutoMetaPrompt !== undefined ? request.useAutoMetaPrompt : settings.useAutoMetaPrompt;

    const formattedTranscript = captions
      .map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`)
      .join('\n');

    let systemPromptToUse = customPrompt || DEFAULT_SYSTEM_PROMPT;

    // Optional Stage 1: Auto Meta-Prompting
    if (useAutoMetaPrompt) {
      try {
        console.log('[ZeroScribe AI] Stage 1: Synthesizing Dynamic Meta-Prompt...');
        const metaPromptInput = `Analyze this live meeting transcript and extract:
1. Meeting Title & Domain
2. Key Participant Roles (e.g. Software Engineers, Clinical Reviewers, HR)
3. Operational Priorities & Requirements.

Then write a customized System Prompt for an AI meeting assistant that will format this meeting's final summary perfectly. Return ONLY the custom system prompt text.

Transcript:
${formattedTranscript.slice(0, 3000)}`;

        const generatedMetaPrompt = await fetchOpenRouterWithFallback(
          apiKey,
          selectedModel,
          "You are an expert prompt engineer specializing in meeting intelligence.",
          metaPromptInput
        );

        if (generatedMetaPrompt && generatedMetaPrompt.length > 50) {
          systemPromptToUse = generatedMetaPrompt + "\n\n" + DEFAULT_SYSTEM_PROMPT;
          console.log('[ZeroScribe AI] Stage 1 Meta-Prompt Synthesized Successfully!');
        }
      } catch (e) {
        console.warn('[ZeroScribe AI] Stage 1 Meta-Prompt failed, falling back to base system prompt:', e);
      }
    }

    const userPrompt = `Generate a structured meeting summary based on the transcript below:\n\n${formattedTranscript}`;

    const summaryText = await fetchOpenRouterWithFallback(
      apiKey,
      selectedModel,
      systemPromptToUse,
      userPrompt
    );

    sendResponse({ success: true, summary: summaryText });
  } catch (err) {
    console.error('[ZeroScribe AI] Summary Generation Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── AI Copilot Handler ───────────────────────────────────────────────────
async function handleAskAiCopilot(request, sendResponse) {
  try {
    const userQuestion = typeof request === 'string' ? request : (request && request.question);
    if (!userQuestion || !userQuestion.trim()) {
      return sendResponse({ success: false, error: 'Please enter a valid question for AI Copilot.' });
    }

    const captions = await getCaptions();
    const settings = await getStoredSettings();
    const apiKey = (request && request.customApiKey) || settings.openRouterApiKey;
    const selectedModel = (request && request.customModel) || settings.selectedModel;

    const formattedTranscript = captions.length > 0
      ? captions.map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`).join('\n')
      : '(No live captions recorded yet)';

    const systemInstruction = `You are ZeroScribe AI Copilot, a real-time intelligent meeting assistant for software engineers, clinical reviewers, and operations leads during corporate meetings (e.g. San Diego Eye Bank x Cebu Team).

Your objective:
- Provide direct, clear, high-confidence answers to help the user respond during the meeting.
- If asked "Suggest Questions to Ask", list 3-5 sharp, relevant questions based on what participants just said.
- Keep responses concise, well-formatted, and ready to read at a glance.`;

    const promptMessage = `Live Meeting Transcript Context:\n${formattedTranscript}\n\nUser Question / Quick Cue:\n${userQuestion}`;

    const answer = await fetchOpenRouterWithFallback(
      apiKey,
      selectedModel,
      systemInstruction,
      promptMessage
    );

    sendResponse({ success: true, answer: answer });
  } catch (err) {
    console.error('[ZeroScribe AI] Copilot Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Auto System Prompt Generator Handler ────────────────────────────────
async function handleGenerateAutoSystemPrompt(request, sendResponse) {
  try {
    const captions = await getCaptions();
    if (captions.length === 0) {
      return sendResponse({ success: false, error: 'No transcript recorded yet. Start live transcription or upload a file first.' });
    }

    const settings = await getStoredSettings();
    const apiKey = (request && request.customApiKey) || settings.openRouterApiKey;
    const selectedModel = (request && request.customModel) || settings.selectedModel;

    const formattedTranscript = captions
      .map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`)
      .join('\n')
      .slice(0, 4000);

    const promptInput = `You are an expert AI prompt engineer. Analyze this meeting transcript and output a customized, high-precision System Prompt for an AI meeting assistant that will format meeting summaries for this specific team context.

Transcript snippet:
${formattedTranscript}

Output ONLY the complete, ready-to-use System Prompt text. Include clear sections for Meeting Persona, Key Metrics to Track, Action Item Format, and Tone.`;

    const generatedPrompt = await fetchOpenRouterWithFallback(
      apiKey,
      selectedModel,
      "You are a master AI prompt engineer.",
      promptInput
    );

    sendResponse({ success: true, systemPrompt: generatedPrompt });
  } catch (err) {
    console.error('[ZeroScribe AI] System Prompt Generation Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Multi-Channel Dispatch Handlers ─────────────────────────────────────
async function handleDispatchWhatsApp(targetPhone, sendResponse) {
  try {
    const captions = await getCaptions();
    if (captions.length === 0) {
      return sendResponse({ success: false, error: 'No transcript captured to dispatch.' });
    }

    const settings = await getStoredSettings();

    const formattedTranscript = captions
      .map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`)
      .join('\n');

    const summaryText = await fetchOpenRouterWithFallback(
      settings.openRouterApiKey,
      settings.selectedModel,
      settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      `Format this meeting summary for WhatsApp dispatch:\n\n${formattedTranscript}`
    );

    const phone = targetPhone || settings.targetPhone || '';
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    const encodedText = encodeURIComponent(summaryText);
    const waUrl = cleanPhone
      ? `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
      : `https://web.whatsapp.com/send?text=${encodedText}`;

    chrome.tabs.create({ url: waUrl });
    sendResponse({ success: true, message: 'Opening WhatsApp Web...' });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDispatchSlack(webhookUrl, sendResponse) {
  try {
    const captions = await getCaptions();
    if (captions.length === 0) {
      return sendResponse({ success: false, error: 'No transcript captured to dispatch.' });
    }

    const settings = await getStoredSettings();
    const url = webhookUrl || settings.slackWebhookUrl;

    if (!url) {
      return sendResponse({ success: false, error: 'Slack Webhook URL is missing in Settings.' });
    }

    const formattedTranscript = captions
      .map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`)
      .join('\n');

    const summaryText = await fetchOpenRouterWithFallback(
      settings.openRouterApiKey,
      settings.selectedModel,
      settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      `Format this meeting summary for Slack posting:\n\n${formattedTranscript}`
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: summaryText })
    });

    if (res.ok) {
      sendResponse({ success: true, message: 'Dispatched to Slack successfully!' });
    } else {
      const errText = await res.text();
      sendResponse({ success: false, error: `Slack error: ${errText}` });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDispatchTeams(webhookUrl, sendResponse) {
  try {
    const captions = await getCaptions();
    if (captions.length === 0) {
      return sendResponse({ success: false, error: 'No transcript captured to dispatch.' });
    }

    const settings = await getStoredSettings();
    const url = webhookUrl || settings.teamsWebhookUrl;

    if (!url) {
      return sendResponse({ success: false, error: 'MS Teams Webhook URL is missing in Settings.' });
    }

    const formattedTranscript = captions
      .map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`)
      .join('\n');

    const summaryText = await fetchOpenRouterWithFallback(
      settings.openRouterApiKey,
      settings.selectedModel,
      settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      `Format this meeting summary for MS Teams posting:\n\n${formattedTranscript}`
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: summaryText })
    });

    if (res.ok) {
      sendResponse({ success: true, message: 'Dispatched to MS Teams successfully!' });
    } else {
      const errText = await res.text();
      sendResponse({ success: false, error: `MS Teams error: ${errText}` });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Audio File STT Handler (Deepgram Nova-2 / Whisper API) ─────────────
async function handleTranscribeAudioFile(request, sendResponse) {
  const { audioDataUrl, mimeType, fileName, customSttKey, customSttProvider } = request;

  try {
    const settings = await getStoredSettings();
    const provider = customSttProvider || settings.sttProvider || 'deepgram';
    const apiKey = customSttKey || settings.sttApiKey;

    if (provider === 'deepgram') {
      console.log(`[ZeroScribe AI] Sending audio file "${fileName}" to Deepgram Nova-2 API...`);
      
      const base64Data = audioDataUrl.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const headers = { 'Content-Type': mimeType || 'audio/mp3' };
      if (apiKey) {
        headers['Authorization'] = `Token ${apiKey}`;
      }

      const dgUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&smart_formatting=true';
      const response = await fetch(dgUrl, {
        method: 'POST',
        headers: headers,
        body: bytes.buffer
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Deepgram STT API Error (${response.status}): ${errText}`);
      }

      const dgResult = await response.json();
      const words = dgResult.results?.channels?.[0]?.alternatives?.[0]?.words || [];

      if (words.length === 0) {
        return sendResponse({ success: false, error: 'Deepgram found no spoken words in audio file.' });
      }

      // Diarization grouping by speaker
      const captions = [];
      let currentSpeaker = null;
      let currentText = '';
      let startTime = null;

      words.forEach((w) => {
        const speakerName = w.speaker !== undefined ? `Speaker ${w.speaker + 1}` : 'Speaker';
        if (currentSpeaker === null) {
          currentSpeaker = speakerName;
          startTime = w.start;
        }

        if (speakerName !== currentSpeaker) {
          captions.push({
            id: Date.now() + Math.random().toString(36).substr(2, 4),
            platform: 'Audio File (Deepgram)',
            speaker: currentSpeaker,
            text: currentText.trim(),
            timestamp: formatSecondsToTimestamp(startTime),
            rawTime: Date.now()
          });
          currentSpeaker = speakerName;
          currentText = w.punctuated_word || w.word;
          startTime = w.start;
        } else {
          currentText += ' ' + (w.punctuated_word || w.word);
        }
      });

      if (currentText.trim()) {
        captions.push({
          id: Date.now() + Math.random().toString(36).substr(2, 4),
          platform: 'Audio File (Deepgram)',
          speaker: currentSpeaker,
          text: currentText.trim(),
          timestamp: formatSecondsToTimestamp(startTime),
          rawTime: Date.now()
        });
      }

      sendResponse({ success: true, captions: captions });
    } else {
      sendResponse({ success: false, error: `STT Provider "${provider}" unsupported for direct file upload.` });
    }
  } catch (err) {
    console.error('[ZeroScribe AI] Audio File STT Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

function formatSecondsToTimestamp(seconds) {
  if (seconds === null || seconds === undefined) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
