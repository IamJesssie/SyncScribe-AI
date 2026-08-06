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
  const phoneInput = document.getElementById('setting-phone');
  const saveSettingsBtn = document.getElementById('btn-save-settings');

  // Action Buttons
  const toggleRecordingBtn = document.getElementById('btn-toggle-recording');
  const summarizeWhatsappBtn = document.getElementById('btn-summarize-whatsapp');
  const exportTxtBtn = document.getElementById('btn-export-txt');
  const exportPdfBtn = document.getElementById('btn-export-pdf');
  const clearTranscriptBtn = document.getElementById('btn-clear-transcript');
  const uploadFileBtn = document.getElementById('btn-upload-file');
  const uploadFileInput = document.getElementById('input-upload-file');

  let currentCaptions = [];
  let isRecording = true;

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
      if (s.targetPhone) phoneInput.value = s.targetPhone;
    }
  }

  // Save Preferences
  saveSettingsBtn.addEventListener('click', async () => {
    const modelVal = modelSelect.value.trim() || 'meta-llama/llama-3.3-70b-instruct:free';
    const settings = {
      openRouterApiKey: apiKeyInput.value.trim(),
      selectedModel: modelVal,
      systemPrompt: systemPromptInput.value.trim(),
      targetPhone: phoneInput.value.trim()
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

  // Action Button: Summarize & WhatsApp
  summarizeWhatsappBtn.addEventListener('click', async () => {
    if (currentCaptions.length === 0) {
      showToast('No transcript available to summarize!', true);
      return;
    }

    // UI Loading state
    summarizeWhatsappBtn.disabled = true;
    summarizeWhatsappBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10"></path>
      </svg>
      Generating AI Summary...
    `;

    try {
      // 1. Trigger OpenRouter AI generation
      const aiResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'GENERATE_AI_SUMMARY',
          customApiKey: apiKeyInput.value.trim(),
          customModel: modelSelect.value,
          customSystemPrompt: systemPromptInput.value.trim()
        }, resolve);
      });

      if (!aiResponse || !aiResponse.success) {
        throw new Error(aiResponse?.error || 'Failed to generate AI summary.');
      }

      const summaryText = aiResponse.summary;

      // Update AI Summary tab view
      summaryContainer.innerText = summaryText;
      
      // Switch tab to summary tab
      document.querySelector('[data-tab="tab-summary"]').click();

      // 2. Relay directly to WhatsApp Web
      showToast('Opening WhatsApp Web tab...');
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'SEND_TO_WHATSAPP',
          text: summaryText,
          phone: phoneInput.value.trim()
        }, resolve);
      });

    } catch (err) {
      showToast(err.message, true);
    } finally {
      summarizeWhatsappBtn.disabled = false;
      summarizeWhatsappBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
        </svg>
        Summarize & Send to WhatsApp
      `;
    }
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

  uploadFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const fileText = evt.target.result;
      const parsedItems = parseUploadedTranscript(fileText, file.name);

      if (parsedItems.length === 0) {
        showToast('No valid transcript lines found in uploaded file.', true);
        return;
      }

      // Append parsed items to current captions
      currentCaptions = [...currentCaptions, ...parsedItems];
      await chrome.storage.local.set({ syncscribe_captions: currentCaptions });

      renderTranscript(currentCaptions);
      showToast(`Uploaded ${parsedItems.length} lines from "${file.name}"!`);
      uploadFileInput.value = '';
    };

    reader.readAsText(file);
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
