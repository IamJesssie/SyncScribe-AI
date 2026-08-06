/**
 * SyncScribe AI - Service Worker & State Manager
 * Handles transcript storage, OpenRouter AI summarization, and WhatsApp deep-linking
 * 
 * Architecture: Sidecue-style tabCapture with user gesture preservation
 */

const DEFAULT_SYSTEM_PROMPT = `You are SyncScribe AI, an expert meeting note taker. Your task is to analyze the following live meeting transcript and produce a clean, structured summary optimized for WhatsApp messaging.

Strict WhatsApp Formatting Rules:
1. Use single asterisks for bold headers and key terms (e.g. *Meeting Executive Summary*).
2. Use bullet points with emojis (📌, 🎯, 🚀, 💡, ⚡, 👥).
3. Section Headers to include:
   - 📌 *Meeting Overview & Agenda*
   - 🎯 *Key Decisions Made*
   - ⚡ *Action Items & Next Steps* (Assign to specific team members if mentioned)
   - 👥 *Departmental Breakdown* (Software Engineering & Clinical / Business Reviewers)
4. Keep the summary concise, actionable, and visually clear for easy reading on mobile WhatsApp screens.`;

const DEFAULT_SETTINGS = {
  openRouterApiKey: '',
  selectedModel: 'meta-llama/llama-3.3-70b-instruct:free',
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
  chrome.storage.local.get(['syncscribe_captions', 'syncscribe_settings'], (result) => {
    if (!result.syncscribe_captions) {
      chrome.storage.local.set({ syncscribe_captions: [] });
    }
    if (!result.syncscribe_settings) {
      chrome.storage.local.set({ syncscribe_settings: DEFAULT_SETTINGS });
    }
  });

  // SidePanel: open on action click is FALSE so we can use action.onClicked for tab capture
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

// ── CRITICAL: Capture tab audio on icon click (preserves user gesture!) ──
// This is the Sidecue pattern: tabCapture.getMediaStreamId MUST be called
// inside action.onClicked to preserve Chrome's user gesture context.
chrome.action.onClicked.addListener((tab) => {
  // Must call synchronously (no await) to preserve user gesture
  startCaptureFlow(tab);
});

function isUncapturableUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|file|view-source|devtools):/.test(url) ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com');
}

function startCaptureFlow(tab) {
  if (!tab || !tab.id || isUncapturableUrl(tab.url)) {
    // Can't capture this tab, just open side panel
    chrome.sidePanel.open({ windowId: tab?.windowId }).catch(() => {});
    return;
  }

  // If already capturing this tab, just open the side panel
  if (pendingStreamId && capturedTabId === tab.id) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }

  // Release old stream if capturing a different tab
  if (captureActive && capturedTabId !== tab.id) {
    chrome.runtime.sendMessage({ action: 'ENGINE_STOP', target: 'offscreen' }).catch(() => {});
    clearCaptureState();
  }

  // Get stream ID synchronously within user gesture context
  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    if (chrome.runtime.lastError || !streamId) {
      console.warn('[SyncScribe AI] tabCapture failed:', chrome.runtime.lastError?.message);
      // Still open side panel so user can use other features
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      return;
    }

    pendingStreamId = streamId;
    capturedTabId = tab.id;
    capturedTabTitle = tab.title || 'Active Tab';

    console.log(`[SyncScribe AI] Tab audio captured: "${capturedTabTitle}" (streamId: ${streamId.substring(0, 20)}...)`);

    // Immediately claim the stream in offscreen (streamId has ~5s TTL)
    claimStreamInOffscreen(streamId).then(() => {
      // Open side panel
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

      // Broadcast capture info to sidepanel/popup
      broadcastToRuntime({
        action: 'TAB_CAPTURED',
        capturedTabId: tab.id,
        capturedTabTitle: capturedTabTitle,
        streamId: streamId
      });
    }).catch(err => {
      console.error('[SyncScribe AI] Failed to claim stream:', err);
      clearCaptureState();
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    });
  });
}

async function claimStreamInOffscreen(streamId) {
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'CLAIM_STREAM',
      target: 'offscreen',
      streamId: streamId
    }, resolve);
  });

  if (!response || !response.success) {
    throw new Error(response?.error || 'Failed to claim audio stream in offscreen document.');
  }
}

function clearCaptureState() {
  pendingStreamId = null;
  capturedTabId = null;
  capturedTabTitle = null;
  captureActive = false;
}

function broadcastToRuntime(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Helper to get all stored captions ───────────────────────────────────
async function getCaptions() {
  const data = await chrome.storage.local.get(['syncscribe_captions']);
  return data.syncscribe_captions || [];
}

async function saveCaptions(captions) {
  await chrome.storage.local.set({ syncscribe_captions: captions });
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
    // Broadcast interim results to popup/sidepanel for live display
    broadcastToRuntime({
      action: 'INTERIM_TRANSCRIPT',
      speaker: request.speaker || 'Speaker',
      text: request.text
    });
    return;
  }

  if (request.action === 'NEW_CAPTION') {
    handleNewCaption(request.payload);
  } else if (request.action === 'CAPTION_UPDATED') {
    // Relay from content.js DOM scraper
    broadcastToRuntime({ action: 'CAPTION_UPDATED' });
  } else if (request.action === 'CLEAR_TRANSCRIPT') {
    saveCaptions([]).then(() => {
      sendResponse({ status: 'cleared' });
    });
    return true;
  } else if (request.action === 'GENERATE_AI_SUMMARY') {
    generateOpenRouterSummary(request.customApiKey, request.customModel, request.customSystemPrompt, request.useAutoMetaPrompt)
      .then(summary => sendResponse({ success: true, summary }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'SYNTHESIZE_SYSTEM_PROMPT') {
    handleSynthesizeSystemPrompt(request.customApiKey, request.customModel)
      .then(prompt => sendResponse({ success: true, systemPrompt: prompt }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'TRANSCRIBE_AUDIO') {
    handleTranscribeAudio(request.audioDataUrl, request.mimeType, request.fileName, request.customSttKey, request.customSttProvider)
      .then(items => sendResponse({ success: true, captions: items }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'START_LIVE_AUDIO_CAPTURE') {
    // Called from popup/sidepanel after tab is already captured
    handleStartLiveCapture(request).then(res => sendResponse(res)).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === 'STOP_LIVE_AUDIO_CAPTURE') {
    chrome.runtime.sendMessage({ action: 'ENGINE_STOP', target: 'offscreen' }).catch(() => {});
    captureActive = false;
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'GET_CAPTURE_INFO') {
    sendResponse({
      hasPendingCapture: !!pendingStreamId,
      capturedTabId,
      capturedTabTitle,
      captureActive
    });
    return true;
  } else if (request.action === 'SEND_TO_WHATSAPP') {
    openWhatsAppRelay(request.text, request.phone)
      .then(res => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === 'SEND_TO_SLACK') {
    sendSlackRelay(request.text, request.slackWebhookUrl)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === 'SEND_TO_TEAMS') {
    sendTeamsRelay(request.text, request.teamsWebhookUrl)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── Start live capture (uses already-claimed stream) ────────────────────
async function handleStartLiveCapture(request) {
  if (!pendingStreamId) {
    // No stream captured yet — try to capture now (may fail without gesture)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found. Click the SyncScribe AI icon on a meeting tab first.');
    }

    // Try tabCapture (may fail without user gesture)
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabs[0].id });
      if (streamId) {
        pendingStreamId = streamId;
        capturedTabId = tabs[0].id;
        capturedTabTitle = tabs[0].title || 'Active Tab';
        await claimStreamInOffscreen(streamId);
      }
    } catch (e) {
      console.warn('[SyncScribe AI] tabCapture requires clicking the extension icon. Falling back to mic.', e.message);
    }
  }

  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

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
  return { success: true, tabTitle: capturedTabTitle, method: response.method };
}

// ── Add caption to array with sentence smoothing & deduplication ────────
async function handleNewCaption(captionEntry) {
  if (!captionEntry || !captionEntry.text || captionEntry.text.trim() === '') return;
  const cleanText = captionEntry.text.trim();
  const captions = await getCaptions();
  const lastEntry = captions.length > 0 ? captions[captions.length - 1] : null;

  if (lastEntry && lastEntry.speaker === captionEntry.speaker && (cleanText.startsWith(lastEntry.text) || lastEntry.text.startsWith(cleanText))) {
    if (cleanText.length >= lastEntry.text.length) {
      lastEntry.text = cleanText;
      lastEntry.timestamp = captionEntry.timestamp;
      await saveCaptions(captions);
    }
  } else {
    captionEntry.text = cleanText;
    captions.push(captionEntry);
    await saveCaptions(captions);
  }

  broadcastToRuntime({
    action: 'CAPTION_UPDATED',
    captionsCount: captions.length,
    latestCaption: captionEntry
  });
}

// ── Stage 1: Meta-Prompt Synthesizer ────────────────────────────────────
async function synthesizeMetaPrompt(fullTranscript, apiKey, model, baseHeaders) {
  console.log('[SyncScribe AI] Stage 1: Synthesizing Dynamic Meta-Prompt...');
  
  const metaPromptInstruction = `You are an AI Meta-Prompt Generator. Analyze the following meeting transcript and generate a highly targeted, customized SYSTEM PROMPT for an Executive AI Note Taker summarizing this specific meeting.

The generated system prompt must instruct the AI to:
1. Dynamically classify the meeting title & category.
2. Group participants into their specific roles (e.g. Software Engineers, Clinical Reviewers, HR, Executive Stakeholders).
3. Create 3-5 adaptive sections based on the actual topics discussed (e.g. Hardware/Onboarding, Software Platform Requirements, Operational Rules).
4. Never omit exact numbers, dates, deadlines, metrics, product codes, or tool names.
5. Use WhatsApp formatting (*bolding*, emojis, bullet points, solid line dividers ──────────).

Output ONLY the custom system prompt text itself. Do not include markdown code block quotes or conversational intro.`;

  const metaRequestBody = {
    model: model,
    messages: [
      { role: 'system', content: metaPromptInstruction },
      { role: 'user', content: `Analyze this transcript and write the custom system prompt:\n\n${fullTranscript.slice(0, 12000)}` }
    ],
    temperature: 0.3
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(metaRequestBody)
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

// ── Standalone System Prompt Generator for Settings UI ──────────────────
async function handleSynthesizeSystemPrompt(overrideKey, overrideModel) {
  const captions = await getCaptions();
  if (captions.length === 0) {
    throw new Error('No transcript available to analyze. Please record or upload a transcript file first.');
  }

  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

  const apiKey = overrideKey || settings.openRouterApiKey;
  const model = overrideModel || settings.selectedModel || 'meta-llama/llama-3.3-70b-instruct:free';

  const fullTranscript = captions.map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`).join('\n');

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/SyncScribeAI',
    'X-Title': 'SyncScribe AI Extension'
  };

  if (apiKey && apiKey.trim() !== '') {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  const prompt = await synthesizeMetaPrompt(fullTranscript, apiKey, model, headers);
  if (!prompt) {
    throw new Error('Failed to generate dynamic system prompt from OpenRouter.');
  }
  return prompt;
}

// ── Stage 2: Generate Summary using OpenRouter Models ───────────────────
async function generateOpenRouterSummary(overrideKey, overrideModel, overrideSystemPrompt, overrideUseMetaPrompt) {
  const captions = await getCaptions();
  if (captions.length === 0) {
    throw new Error('No transcript data captured yet. Please record or upload transcript text first.');
  }

  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

  const apiKey = overrideKey || settings.openRouterApiKey;
  const model = overrideModel || settings.selectedModel || 'meta-llama/llama-3.3-70b-instruct:free';
  const useMetaPrompt = (overrideUseMetaPrompt !== undefined) ? overrideUseMetaPrompt : (settings.useAutoMetaPrompt !== false);

  const fullTranscript = captions.map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`).join('\n');

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/SyncScribeAI',
    'X-Title': 'SyncScribe AI Extension'
  };

  if (apiKey && apiKey.trim() !== '') {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  let effectiveSystemPrompt = overrideSystemPrompt || settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  if (useMetaPrompt) {
    try {
      const synthesizedPrompt = await synthesizeMetaPrompt(fullTranscript, apiKey, model, headers);
      if (synthesizedPrompt && synthesizedPrompt.trim().length > 50) {
        console.log('[SyncScribe AI] Stage 1 Meta-Prompt Synthesized Successfully!');
        effectiveSystemPrompt = synthesizedPrompt;
      }
    } catch (e) {
      console.warn('[SyncScribe AI] Stage 1 Meta-Prompt failed, falling back to base system prompt:', e);
    }
  }

  console.log(`[SyncScribe AI] Stage 2: Generating Summary with Model: ${model}`);

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: effectiveSystemPrompt },
      { role: 'user', content: `Here is the meeting transcript:\n\n${fullTranscript}` }
    ],
    temperature: 0.4
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedMsg = errorText;
    try {
      const errJson = JSON.parse(errorText);
      parsedMsg = errJson.error?.message || errorText;
    } catch (e) {}
    throw new Error(`OpenRouter API Error (${response.status}): ${parsedMsg}`);
  }

  const data = await response.json();
  const summaryText = data.choices?.[0]?.message?.content;
  if (!summaryText) {
    throw new Error('Received an empty response from OpenRouter AI.');
  }

  return summaryText;
}

// ── Relay: WhatsApp Web ─────────────────────────────────────────────────
async function openWhatsAppRelay(textSummary, overridePhone) {
  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

  const phone = (overridePhone !== undefined ? overridePhone : settings.targetPhone) || '';
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const encodedText = encodeURIComponent(textSummary);
  let whatsappUrl = `https://web.whatsapp.com/send?text=${encodedText}`;

  if (cleanPhone) {
    whatsappUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
  }

  await chrome.tabs.create({ url: whatsappUrl });
  return true;
}

// ── Relay: Slack Webhook / Web Link ─────────────────────────────────────
async function sendSlackRelay(textSummary, overrideWebhook) {
  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;
  const webhookUrl = overrideWebhook || settings.slackWebhookUrl;

  if (webhookUrl && webhookUrl.trim().startsWith('http')) {
    const response = await fetch(webhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textSummary })
    });
    if (!response.ok) throw new Error(`Slack Webhook HTTP Error ${response.status}`);
    return { success: true, method: 'webhook' };
  } else {
    await chrome.tabs.create({ url: 'https://app.slack.com/' });
    return { success: true, method: 'tab' };
  }
}

// ── Relay: MS Teams Webhook / Web Link ──────────────────────────────────
async function sendTeamsRelay(textSummary, overrideWebhook) {
  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;
  const webhookUrl = overrideWebhook || settings.teamsWebhookUrl;

  if (webhookUrl && webhookUrl.trim().startsWith('http')) {
    const response = await fetch(webhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.2',
            body: [{ type: 'TextBlock', text: textSummary, wrap: true }]
          }
        }]
      })
    });
    if (!response.ok) throw new Error(`Teams Webhook HTTP Error ${response.status}`);
    return { success: true, method: 'webhook' };
  } else {
    await chrome.tabs.create({ url: 'https://teams.microsoft.com/' });
    return { success: true, method: 'tab' };
  }
}

// ── Handle Audio File Speech-to-Text Transcription ──────────────────────
async function handleTranscribeAudio(audioDataUrl, mimeType, fileName, customSttKey, customSttProvider) {
  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

  const sttKey = customSttKey || settings.sttApiKey;
  const sttProvider = customSttProvider || settings.sttProvider || 'deepgram';

  if (sttProvider === 'deepgram' || (sttKey && sttKey.trim().length > 10)) {
    if (!sttKey || sttKey.trim() === '') {
      throw new Error('Deepgram API Key is required for Deepgram Nova-2 Audio Transcription. Please enter your key in Settings or sign up at console.deepgram.com ($200 free credit!).');
    }
    return await transcribeDeepgram(audioDataUrl, mimeType, sttKey.trim(), fileName);
  } else {
    throw new Error('Please configure a Deepgram or Speech-to-Text API Key in Settings to transcribe audio files.');
  }
}

// ── Deepgram Nova-2 Speech-to-Text with Speaker Diarization ─────────────
async function transcribeDeepgram(audioDataUrl, mimeType, apiKey, fileName) {
  console.log(`[SyncScribe AI] Sending audio file "${fileName}" to Deepgram Nova-2 API...`);

  const base64Part = audioDataUrl.split(',')[1];
  const binaryString = atob(base64Part);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const cleanMime = (mimeType && mimeType.includes('/')) ? mimeType.split(';')[0] : 'audio/mp3';
  const deepgramUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&utterances=true';

  const response = await fetch(deepgramUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': cleanMime
    },
    body: bytes.buffer
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errDetail = errorText;
    try {
      const errJson = JSON.parse(errorText);
      errDetail = errJson.err_msg || errJson.reason || errorText;
    } catch (e) {}
    throw new Error(`Deepgram API Error (${response.status}): ${errDetail}`);
  }

  const data = await response.json();
  const utterances = data.results?.utterances || [];

  if (utterances.length > 0) {
    return utterances.map(u => ({
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      platform: `Audio File (${fileName})`,
      speaker: `Speaker ${u.speaker !== undefined ? u.speaker + 1 : 1}`,
      timestamp: formatSecondsToTime(u.start),
      text: u.transcript ? u.transcript.trim() : ''
    })).filter(item => item.text !== '');
  }

  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  if (alt && alt.transcript && alt.transcript.trim() !== '') {
    return [{
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      platform: `Audio File (${fileName})`,
      speaker: 'Speaker 1',
      timestamp: '00:00',
      text: alt.transcript.trim()
    }];
  }

  throw new Error('No Speech-to-Text transcript returned from Deepgram.');
}

function formatSecondsToTime(seconds) {
  const secNum = parseInt(seconds, 10) || 0;
  const mins = Math.floor(secNum / 60);
  const secs = secNum % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── Ensure Offscreen Document exists ────────────────────────────────────
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Tab audio capture and real-time speech-to-text transcription'
  });
}

function waitForOffscreenReady(maxWait = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function ping() {
      if (Date.now() - start > maxWait) {
        reject(new Error('Offscreen document ready timeout'));
        return;
      }
      chrome.runtime.sendMessage({ action: 'OFFSCREEN_PING', target: 'offscreen' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ready) {
          setTimeout(ping, 100);
        } else {
          resolve();
        }
      });
    }
    ping();
  });
}

// ── Tab close auto-cleanup ──────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === capturedTabId) {
    chrome.runtime.sendMessage({ action: 'ENGINE_STOP', target: 'offscreen' }).catch(() => {});
    clearCaptureState();
    broadcastToRuntime({ action: 'SESSION_ENDED', reason: 'tab_closed' });
  }
});
