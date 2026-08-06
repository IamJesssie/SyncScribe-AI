/**
 * SyncScribe AI - Service Worker & State Manager
 * Handles transcript storage, OpenRouter AI summarization, and WhatsApp deep-linking
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
  targetPhone: '',
  slackWebhookUrl: '',
  teamsWebhookUrl: ''
};

// Initialize Storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['syncscribe_captions', 'syncscribe_settings'], (result) => {
    if (!result.syncscribe_captions) {
      chrome.storage.local.set({ syncscribe_captions: [] });
    }
    if (!result.syncscribe_settings) {
      chrome.storage.local.set({ syncscribe_settings: DEFAULT_SETTINGS });
    }
  });
});

// Helper to get all stored captions
async function getCaptions() {
  const data = await chrome.storage.local.get(['syncscribe_captions']);
  return data.syncscribe_captions || [];
}

// Helper to save captions
async function saveCaptions(captions) {
  await chrome.storage.local.set({ syncscribe_captions: captions });
}

// Listen to incoming runtime messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'NEW_CAPTION') {
    handleNewCaption(request.payload);
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

// Add caption to array
async function handleNewCaption(captionEntry) {
  const captions = await getCaptions();
  captions.push(captionEntry);
  await saveCaptions(captions);

  // Broadcast to open popup if active
  chrome.runtime.sendMessage({
    action: 'CAPTION_UPDATED',
    captionsCount: captions.length,
    latestCaption: captionEntry
  }).catch(() => {
    // Popup might not be open
  });
}

// Stage 1: Meta-Prompt Synthesizer
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

// Standalone System Prompt Generator for Settings UI
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

// Stage 2: Generate Summary using OpenRouter Models
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

  // Run Stage 1 Meta-Prompt Synthesis if enabled
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

// Relay: WhatsApp Web
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

// Relay: Slack Webhook / Web Link
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
    // Fallback: Copy to clipboard and open Slack Web
    await chrome.tabs.create({ url: 'https://app.slack.com/' });
    return { success: true, method: 'tab' };
  }
}

// Relay: MS Teams Webhook / Web Link
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
