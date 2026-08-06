/**
 * SyncScribe AI - Extension UI Controller & Handler
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const transcriptContainer = document.getElementById('transcript-container');
  const summaryContainer = document.getElementById('summary-container');
  const lineCountBadge = document.getElementById('line-count');
  const statusLabel = document.getElementById('status-label');
  const platformLabel = document.getElementById('platform-label');
  const statusDot = document.getElementById('status-dot');
  const statusRing = document.getElementById('status-ring');

  // Form Elements
  const apiKeyInput = document.getElementById('setting-apikey');
  const modelSelect = document.getElementById('setting-model');
  const systemPromptInput = document.getElementById('setting-systemprompt');
  const autoMetaPromptCheckbox = document.getElementById('setting-auto-metaprompt');
  const sttProviderSelect = document.getElementById('setting-stt-provider');
  const sttApiKeyInput = document.getElementById('setting-stt-key');
  const phoneInput = document.getElementById('setting-phone');
  const slackInput = document.getElementById('setting-slack');
  const teamsInput = document.getElementById('setting-teams');
  const saveSettingsBtn = document.getElementById('btn-save-settings');

  // Action Buttons
  const toggleRecordingBtn = document.getElementById('btn-toggle-recording');
  const toggleTabAudioBtn = document.getElementById('btn-toggle-tab-audio');
  const generateSystemPromptBtn = document.getElementById('btn-generate-systemprompt');
  const generateSummaryBtn = document.getElementById('btn-generate-summary');
  const dispatchWhatsappBtn = document.getElementById('btn-dispatch-whatsapp');
  const dispatchSlackBtn = document.getElementById('btn-dispatch-slack');
  const dispatchTeamsBtn = document.getElementById('btn-dispatch-teams');
  const copySummaryBtn = document.getElementById('btn-copy-summary');
  const exportTxtBtn = document.getElementById('btn-export-txt');
  const exportPdfBtn = document.getElementById('btn-export-pdf');
  const clearTranscriptBtn = document.getElementById('btn-clear-transcript');
  const uploadFileBtn = document.getElementById('btn-upload-file');
  const uploadFileInput = document.getElementById('input-upload-file');

  let currentCaptions = [];
  let isRecording = true;
  let isAudioCapturing = false;

  // Toast System
  function showToast(message, isError = false) {
    const toast = document.getElementById('app-toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.innerText = message;

    if (isError) {
      toast.style.borderColor = 'rgba(244, 63, 94, 0.6)';
    } else {
      toast.style.borderColor = 'rgba(99, 102, 241, 0.6)';
    }

    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // Tab Navigation
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
    });
  });

  // Load Preferences
  async function loadSettings() {
    const data = await chrome.storage.local.get(['syncscribe_settings']);
    if (data.syncscribe_settings) {
      const s = data.syncscribe_settings;
      if (s.openRouterApiKey) apiKeyInput.value = s.openRouterApiKey;
      if (s.selectedModel) modelSelect.value = s.selectedModel;
      if (s.systemPrompt) systemPromptInput.value = s.systemPrompt;
      if (s.useAutoMetaPrompt !== undefined) autoMetaPromptCheckbox.checked = s.useAutoMetaPrompt;
      if (s.sttProvider) sttProviderSelect.value = s.sttProvider;
      if (s.sttApiKey) sttApiKeyInput.value = s.sttApiKey;
      if (s.targetPhone) phoneInput.value = s.targetPhone;
      if (s.slackWebhookUrl) slackInput.value = s.slackWebhookUrl;
      if (s.teamsWebhookUrl) teamsInput.value = s.teamsWebhookUrl;
    }
  }

  // Save Preferences
  saveSettingsBtn.addEventListener('click', async () => {
    const modelVal = modelSelect.value.trim() || 'meta-llama/llama-3.3-70b-instruct:free';
    const settings = {
      openRouterApiKey: apiKeyInput.value.trim(),
      selectedModel: modelVal,
      systemPrompt: systemPromptInput.value.trim(),
      useAutoMetaPrompt: autoMetaPromptCheckbox.checked,
      sttProvider: sttProviderSelect.value,
      sttApiKey: sttApiKeyInput.value.trim(),
      targetPhone: phoneInput.value.trim(),
      slackWebhookUrl: slackInput.value.trim(),
      teamsWebhookUrl: teamsInput.value.trim()
    };
    await chrome.storage.local.set({ syncscribe_settings: settings });
    showToast('Preferences saved successfully!');
  });

  // Render Transcript UI
  function renderTranscript(captions) {
    currentCaptions = captions || [];
    lineCountBadge.innerText = `${currentCaptions.length} lines`;

    if (currentCaptions.length === 0) {
      transcriptContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <div>No meeting captions recorded yet.</div>
          <div style="font-size: 11px; color: var(--text-subtle);">Open Google Meet, Zoom, or Teams and turn on Closed Captions (CC).</div>
        </div>
      `;
      return;
    }

    let html = '';
    currentCaptions.forEach(item => {
      html += `
        <div class="transcript-item">
          <div class="transcript-header">
            <span class="speaker-tag">${escapeHtml(item.speaker)}</span>
            <span class="time-tag">${escapeHtml(item.timestamp)}</span>
          </div>
          <div class="transcript-body">${escapeHtml(item.text)}</div>
        </div>
      `;
    });

    transcriptContainer.innerHTML = html;
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }

  // Fetch initial captions
  async function loadInitialCaptions() {
    const data = await chrome.storage.local.get(['syncscribe_captions']);
    renderTranscript(data.syncscribe_captions || []);
  }

  // Check Active Meeting Status
  async function checkActiveTabStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' }, (res) => {
          if (chrome.runtime.lastError || !res) {
            platformLabel.innerText = 'Platform: Web Meeting';
            return;
          }
          isRecording = res.isRecording;
          platformLabel.innerText = `Platform: ${res.platform}`;
          updateRecordingUI(isRecording);
        });
      }
    } catch (e) {}
  }

  function updateRecordingUI(recording) {
    if (recording) {
      statusLabel.innerText = 'Listening for captions...';
      statusDot.style.background = '#10b981';
      statusRing.style.borderColor = '#10b981';
    } else {
      statusLabel.innerText = 'Recording Paused';
      statusDot.style.background = '#f59e0b';
      statusRing.style.borderColor = '#f59e0b';
    }
  }

  // Listen for real-time update broadcasts
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'CAPTION_UPDATED') {
      loadInitialCaptions();
    }
  });

  // Action Button: Auto-Generate System Prompt from Active Transcript
  generateSystemPromptBtn.addEventListener('click', async () => {
    if (currentCaptions.length === 0) {
      showToast('No transcript available to analyze! Record or upload a transcript file first.', true);
      return;
    }

    try {
      generateSystemPromptBtn.disabled = true;
      generateSystemPromptBtn.innerText = '✨ Analyzing & Synthesizing Prompt...';
      showToast('Analyzing transcript & synthesizing system prompt...');

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'SYNTHESIZE_SYSTEM_PROMPT',
          customApiKey: apiKeyInput.value.trim(),
          customModel: modelSelect.value
        }, resolve);
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to synthesize system prompt.');
      }

      systemPromptInput.value = response.systemPrompt;

      // Automatically save synthesized prompt in settings
      const settings = {
        openRouterApiKey: apiKeyInput.value.trim(),
        selectedModel: modelSelect.value.trim() || 'meta-llama/llama-3.3-70b-instruct:free',
        systemPrompt: response.systemPrompt,
        useAutoMetaPrompt: autoMetaPromptCheckbox.checked,
        targetPhone: phoneInput.value.trim(),
        slackWebhookUrl: slackInput.value.trim(),
        teamsWebhookUrl: teamsInput.value.trim()
      };
      await chrome.storage.local.set({ syncscribe_settings: settings });

      showToast('Dynamic System Prompt generated & saved in Settings!');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      generateSystemPromptBtn.disabled = false;
      generateSystemPromptBtn.innerText = '✨ Auto-Generate Prompt from Transcript';
    }
  });

  // Helper to generate summary preview
  async function generateSummary() {
    if (currentCaptions.length === 0) {
      throw new Error('No transcript available to summarize! Record or upload text first.');
    }

    const aiResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'GENERATE_AI_SUMMARY',
        customApiKey: apiKeyInput.value.trim(),
        customModel: modelSelect.value,
        customSystemPrompt: systemPromptInput.value.trim(),
        useAutoMetaPrompt: autoMetaPromptCheckbox.checked
      }, resolve);
    });

    if (!aiResponse || !aiResponse.success) {
      throw new Error(aiResponse?.error || 'Failed to generate AI summary.');
    }

    summaryContainer.innerText = aiResponse.summary;
    document.querySelector('[data-tab="tab-summary"]').click();
    return aiResponse.summary;
  }

  // Action Button: Generate AI Summary Preview
  generateSummaryBtn.addEventListener('click', async () => {
    try {
      generateSummaryBtn.disabled = true;
      generateSummaryBtn.innerHTML = `Generating AI Summary...`;
      await generateSummary();
      showToast('AI Summary preview generated! Review and click Send below.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      generateSummaryBtn.disabled = false;
      generateSummaryBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        Generate AI Summary Preview
      `;
    }
  });

  // Action Button: Toggle Live Tab Audio Capture (Direct STT)
  toggleTabAudioBtn.addEventListener('click', async () => {
    if (!isAudioCapturing) {
      toggleTabAudioBtn.disabled = true;
      toggleTabAudioBtn.innerText = '🎙️ Requesting Permission & Connecting...';

      // Ensure extension origin has audio permission for Web Speech API
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(t => t.stop());
      } catch (permErr) {
        console.warn('Audio permission prompt result:', permErr.message);
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'START_LIVE_AUDIO_CAPTURE' }, resolve);
      });
      toggleTabAudioBtn.disabled = false;

      if (response && response.success) {
        isAudioCapturing = true;
        toggleTabAudioBtn.innerText = '⏹️ Stop Live Tab Audio Capture';
        toggleTabAudioBtn.style.background = 'rgba(239, 68, 68, 0.25)';
        toggleTabAudioBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        toggleTabAudioBtn.style.color = '#f87171';
        showToast(`Capturing live tab audio from "${response.tabTitle || 'active tab'}"!`);
      } else {
        showToast(response?.error || 'Failed to capture tab audio.', true);
      }
    } else {
      chrome.runtime.sendMessage({ action: 'STOP_LIVE_AUDIO_CAPTURE' });
      isAudioCapturing = false;
      toggleTabAudioBtn.innerText = '🎙️ Capture Live Tab Audio (Direct Speech STT)';
      toggleTabAudioBtn.style.background = 'rgba(236, 72, 153, 0.18)';
      toggleTabAudioBtn.style.borderColor = 'rgba(236, 72, 153, 0.5)';
      toggleTabAudioBtn.style.color = '#f472b6';
      showToast('Live tab audio capture stopped.');
    }
  });

  // Dispatch Button: Send to WhatsApp Web
  dispatchWhatsappBtn.addEventListener('click', async () => {
    const summaryText = summaryContainer.innerText;
    if (!summaryText || summaryText.includes('Click "Generate AI Summary Preview"')) {
      showToast('Please generate an AI Summary Preview first!', true);
      return;
    }

    try {
      showToast('Opening WhatsApp Web...');
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'SEND_TO_WHATSAPP',
          text: summaryText,
          phone: phoneInput.value.trim()
        }, resolve);
      });
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Dispatch Button: Send to Slack
  dispatchSlackBtn.addEventListener('click', async () => {
    const summaryText = summaryContainer.innerText;
    if (!summaryText || summaryText.includes('Click "Generate AI Summary Preview"')) {
      showToast('Please generate an AI Summary Preview first!', true);
      return;
    }

    try {
      showToast('Relaying to Slack...');
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'SEND_TO_SLACK',
          text: summaryText,
          slackWebhookUrl: slackInput.value.trim()
        }, resolve);
      });
      if (res && res.success) {
        showToast(res.method === 'webhook' ? 'Posted directly to Slack Webhook!' : 'Opening Slack Web...');
      } else {
        throw new Error(res?.error || 'Failed to send to Slack');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Dispatch Button: Send to MS Teams
  dispatchTeamsBtn.addEventListener('click', async () => {
    const summaryText = summaryContainer.innerText;
    if (!summaryText || summaryText.includes('Click "Generate AI Summary Preview"')) {
      showToast('Please generate an AI Summary Preview first!', true);
      return;
    }

    try {
      showToast('Relaying to MS Teams...');
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'SEND_TO_TEAMS',
          text: summaryText,
          teamsWebhookUrl: teamsInput.value.trim()
        }, resolve);
      });
      if (res && res.success) {
        showToast(res.method === 'webhook' ? 'Posted directly to MS Teams Webhook!' : 'Opening MS Teams Web...');
      } else {
        throw new Error(res?.error || 'Failed to send to MS Teams');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Action Button: Copy Summary
  copySummaryBtn.addEventListener('click', () => {
    const summaryText = summaryContainer.innerText;
    if (!summaryText || summaryText.includes('Click "Generate AI Summary Preview"')) {
      showToast('No summary content to copy!', true);
      return;
    }

    navigator.clipboard.writeText(summaryText).then(() => {
      showToast('Summary copied to clipboard!');
    }).catch(() => {
      showToast('Failed to copy to clipboard', true);
    });
  });

  // Action Button: Download TXT
  exportTxtBtn.addEventListener('click', () => {
    SyncScribeExporter.exportTXT(currentCaptions);
  });

  // Action Button: Download PDF
  exportPdfBtn.addEventListener('click', () => {
    SyncScribeExporter.exportPDF(currentCaptions);
  });

  // Action Button: Upload Transcript File
  uploadFileBtn.addEventListener('click', () => {
    uploadFileInput.click();
  });

  uploadFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const isAudio = file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'webm', 'flac'].includes(ext);

    if (isAudio) {
      // Audio File Transcription via Deepgram Speech-to-Text
      uploadFileBtn.disabled = true;
      uploadFileBtn.innerText = '🎙️ Transcribing Audio via Deepgram AI...';
      showToast(`Transcribing audio file "${file.name}"... This takes a few seconds.`);

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const audioDataUrl = evt.target.result;
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'TRANSCRIBE_AUDIO',
              audioDataUrl: audioDataUrl,
              mimeType: file.type || `audio/${ext}`,
              fileName: file.name,
              customSttKey: sttApiKeyInput.value.trim(),
              customSttProvider: sttProviderSelect.value
            }, resolve);
          });

          if (!response || !response.success) {
            throw new Error(response?.error || 'Audio transcription failed.');
          }

          const parsedItems = response.captions || [];
          if (parsedItems.length === 0) {
            throw new Error('No speech detected in uploaded audio file.');
          }

          currentCaptions = [...currentCaptions, ...parsedItems];
          await chrome.storage.local.set({ syncscribe_captions: currentCaptions });

          renderTranscript(currentCaptions);
          showToast(`Transcribed ${parsedItems.length} utterances from "${file.name}"!`);
        } catch (err) {
          showToast(err.message, true);
        } finally {
          uploadFileBtn.disabled = false;
          uploadFileBtn.innerText = '📁 Upload Transcript or Audio File (.m4a, .mp3, .wav, .txt)';
          uploadFileInput.value = '';
        }
      };

      reader.readAsDataURL(file);
    } else {
      // Text File Parsing (.txt, .vtt, .srt, .json)
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const fileText = evt.target.result;
        const parsedItems = parseUploadedTranscript(fileText, file.name);

        if (parsedItems.length === 0) {
          showToast('No valid transcript lines found in uploaded file.', true);
          return;
        }

        currentCaptions = [...currentCaptions, ...parsedItems];
        await chrome.storage.local.set({ syncscribe_captions: currentCaptions });

        renderTranscript(currentCaptions);
        showToast(`Uploaded ${parsedItems.length} lines from "${file.name}"!`);
        uploadFileInput.value = '';
      };

      reader.readAsText(file);
    }
  });

  // Action Button: Clear Transcript
  clearTranscriptBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear the current meeting transcript?')) {
      await chrome.runtime.sendMessage({ action: 'CLEAR_TRANSCRIPT' });
      renderTranscript([]);
      summaryContainer.innerText = 'Transcript cleared.';
      showToast('Live transcript cleared.');
    }
  });

  // Init
  await loadSettings();
  await loadInitialCaptions();
  await checkActiveTabStatus();
});

function parseUploadedTranscript(fileContent, fileName) {
  if (!fileContent || fileContent.trim() === '') return [];

  // Attempt JSON parsing first
  try {
    const json = JSON.parse(fileContent);
    if (Array.isArray(json)) {
      return json.map(item => ({
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        platform: 'Uploaded File',
        speaker: item.speaker || item.name || 'Speaker',
        text: item.text || item.content || item.line || '',
        timestamp: item.timestamp || item.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })).filter(i => i.text && i.text.trim() !== '');
    }
  } catch (e) {
    // Fallback to text parsing
  }

  const lines = fileContent.split(/\r?\n/);
  const items = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // Ignore VTT/SRT headers or timestamp index lines
    if (trimmed.startsWith('WEBVTT') || /^\d+$/.test(trimmed) || /^\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      return;
    }

    let speaker = 'Uploaded File';
    let text = trimmed;
    let timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Match [Timestamp] Speaker: Content
    const bracketMatch = trimmed.match(/^\[(.*?)\]\s*([^:]+):\s*(.*)$/);
    if (bracketMatch) {
      timestamp = bracketMatch[1].trim();
      speaker = bracketMatch[2].trim();
      text = bracketMatch[3].trim();
    } else {
      // Match Speaker: Content
      const colonMatch = trimmed.match(/^([A-Z][a-zA-Z0-9\s]{1,20}):\s*(.*)$/);
      if (colonMatch) {
        speaker = colonMatch[1].trim();
        text = colonMatch[2].trim();
      }
    }

    if (text.length > 0) {
      items.push({
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        platform: `Uploaded (${fileName})`,
        speaker: speaker,
        text: text,
        timestamp: timestamp
      });
    }
  });

  return items;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
