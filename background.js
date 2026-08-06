/**
 * SyncScribe AI - Service Worker & State Manager
 * Handles transcript storage, OpenRouter AI summarization, and WhatsApp deep-linking
 */

const DEFAULT_SETTINGS = {
  openRouterApiKey: '',
  selectedModel: 'meta-llama/llama-3.3-70b-instruct:free',
  targetPhone: '',
  autoOpenWhatsApp: true
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
    generateOpenRouterSummary(request.customApiKey, request.customModel)
      .then(summary => sendResponse({ success: true, summary }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'SEND_TO_WHATSAPP') {
    openWhatsAppRelay(request.text, request.phone)
      .then(res => sendResponse({ success: true }))
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

// Generate Summary using OpenRouter Free Models
async function generateOpenRouterSummary(overrideKey, overrideModel) {
  const captions = await getCaptions();
  if (captions.length === 0) {
    throw new Error('No transcript data captured yet. Please record some meeting text first.');
  }

  const settingsData = await chrome.storage.local.get(['syncscribe_settings']);
  const settings = settingsData.syncscribe_settings || DEFAULT_SETTINGS;

  const apiKey = overrideKey || settings.openRouterApiKey;
  const model = overrideModel || settings.selectedModel || 'meta-llama/llama-3.3-70b-instruct:free';

  // Format transcript plain text
  const fullTranscript = captions.map(c => `[${c.timestamp}] ${c.speaker}: ${c.text}`).join('\n');

  const systemPrompt = `You are SyncScribe AI, an expert meeting note taker. Your task is to analyze the following live meeting transcript and produce a clean, structured summary optimized for WhatsApp messaging.

Strict WhatsApp Formatting Rules:
1. Use single asterisks for bold headers and key terms (e.g. *Meeting Executive Summary*).
2. Use bullet points with emojis (📌, 🎯, 🚀, 💡, ⚡, 👥).
3. Section Headers to include:
   - 📌 *Meeting Overview & Agenda*
   - 🎯 *Key Decisions Made*
   - ⚡ *Action Items & Next Steps* (Assign to specific team members if mentioned)
   - 👥 *Departmental Breakdown* (Software Engineering & Clinical / Business Reviewers)
4. Keep the summary concise, actionable, and visually clear for easy reading on mobile WhatsApp screens.`;

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here is the meeting transcript:\n\n${fullTranscript}` }
    ],
    temperature: 0.4
  };

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/SyncScribeAI',
    'X-Title': 'SyncScribe AI Extension'
  };

  if (apiKey && apiKey.trim() !== '') {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  console.log(`[SyncScribe AI] Calling OpenRouter Model: ${model}`);

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

// Deep-link launch to WhatsApp Web
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

  // Create new tab with pre-filled WhatsApp link
  await chrome.tabs.create({ url: whatsappUrl });
  return true;
}
