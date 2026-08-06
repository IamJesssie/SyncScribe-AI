/**
 * SyncScribe AI - Universal DOM Caption Scraper
 * Supports Google Meet, Zoom Web, and MS Teams
 */

(function () {
  'use me strict';

  if (window.__syncScribeInitialized) return;
  window.__syncScribeInitialized = true;

  console.log('[SyncScribe AI] Universal Caption Scraper Initialized');

  let isRecording = false;
  let captionObserver = null;
  let lastCapturedText = '';
  let capturedCount = 0;
  let activePlatform = detectPlatform();

  // Floating Status Widget on Meeting Pages
  let overlayWidget = null;

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('meet.google.com')) return 'Google Meet';
    if (host.includes('zoom.us')) return 'Zoom Web';
    if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) return 'MS Teams';
    return 'Web Meeting';
  }

  // Create or update floating overlay indicator on meeting tab
  function createOverlayWidget() {
    if (document.getElementById('syncscribe-overlay')) return;

    overlayWidget = document.createElement('div');
    overlayWidget.id = 'syncscribe-overlay';
    overlayWidget.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 10px 16px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      user-select: none;
      transition: all 0.3s ease;
    `;

    overlayWidget.innerHTML = `
      <div id="syncscribe-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e;"></div>
      <div>
        <div style="font-weight: 600; font-size: 12px; letter-spacing: 0.5px; color: #94a3b8;">SYNCSCRIBE AI</div>
        <div id="syncscribe-status-text" style="font-weight: 500; font-size: 13px; color: #e2e8f0;">Listening (${activePlatform})...</div>
      </div>
      <div id="syncscribe-count-badge" style="background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #60a5fa; border-radius: 20px; padding: 2px 8px; font-weight: 600; font-size: 11px;">0 lines</div>
    `;

    document.body.appendChild(overlayWidget);
  }

  function updateOverlayCount(count) {
    const badge = document.getElementById('syncscribe-count-badge');
    if (badge) badge.innerText = `${count} lines`;
  }

  function updateOverlayStatus(text, color) {
    const statusText = document.getElementById('syncscribe-status-text');
    const statusDot = document.getElementById('syncscribe-status-dot');
    if (statusText) statusText.innerText = text;
    if (statusDot) {
      statusDot.style.background = color;
      statusDot.style.boxShadow = `0 0 8px ${color}`;
    }
  }

  // Handle caption additions with sentence smoothing & deduplication
  function processCaptionEntry(speaker, text) {
    if (!text || text.trim() === '') return;
    const cleanText = text.trim();

    if (cleanText === lastCapturedText) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Read storage to check if updating existing entry or creating new
    chrome.storage.local.get(['syncscribe_captions'], (res) => {
      let captions = res.syncscribe_captions || [];
      const lastEntry = captions.length > 0 ? captions[captions.length - 1] : null;

      // Merge incremental sentence extensions from same speaker
      if (lastEntry && lastEntry.speaker === speaker && (cleanText.startsWith(lastEntry.text) || lastEntry.text.startsWith(cleanText))) {
        if (cleanText.length >= lastEntry.text.length) {
          lastEntry.text = cleanText;
          lastEntry.timestamp = timestamp;
          chrome.storage.local.set({ syncscribe_captions: captions });
          chrome.runtime.sendMessage({ action: 'CAPTION_UPDATED' }).catch(() => {});
        }
        lastCapturedText = cleanText;
        return;
      }

      lastCapturedText = cleanText;
      const entry = {
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        platform: activePlatform,
        speaker: speaker || 'Speaker',
        text: cleanText,
        timestamp: timestamp,
        rawTime: Date.now()
      };

      captions.push(entry);
      capturedCount = captions.length;
      updateOverlayCount(capturedCount);

      chrome.storage.local.set({ syncscribe_captions: captions });
      chrome.runtime.sendMessage({ action: 'CAPTION_UPDATED' }).catch(() => {});
    });
  }

  // Universal Scraper for Google Meet
  function scrapeGoogleMeet() {
    // Select all potential caption container nodes in Google Meet
    const candidateNodes = document.querySelectorAll(`
      div[jsname="r4n84b"],
      div[jsname="YSStwy"],
      div[class*="a7vLMe"],
      div[class*="zT2df"],
      div[class*="NmH5Jf"],
      div[class*="bhZpf"],
      div[class*="cM9B2"],
      div[class*="iL4vfe"],
      div[class*="T4523c"],
      div[class*="nM4d2c"],
      div[class*="n74d0c"],
      div[data-sender-name],
      div[role="region"][aria-label*="caption" i]
    `);

    candidateNodes.forEach(node => {
      const rawText = node.innerText ? node.innerText.trim() : '';
      if (!rawText || rawText.length < 2) return;

      // Ignore UI buttons, call titles, and URL strings
      if (rawText.includes('meet.google.com') || rawText.includes('People') || rawText.includes('Mute all')) return;

      // Google Meet formats captions as "SpeakerName\nSpoken Text"
      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length >= 2) {
        // First line is speaker name (e.g. "You", "asda", "Jessie Noel Lapure")
        const possibleSpeaker = lines[0];
        const spokenText = lines.slice(1).join(' ');

        if (possibleSpeaker.length < 40 && spokenText.length > 1) {
          processCaptionEntry(possibleSpeaker, spokenText);
          return;
        }
      }

      // Fallback: try element selectors if text is single line
      const speakerEl = node.querySelector('div[class*="Yz62fc"], span.zs7W8d, div[class*="M4t5We"], div.Z6B62d, div[class*="T4523c"]');
      const speaker = speakerEl ? speakerEl.innerText.trim() : 'Speaker';
      const text = rawText.replace(speaker, '').trim();

      if (text && text.length > 1 && text !== speaker) {
        processCaptionEntry(speaker, text);
      }
    });
  }

  // Universal Scraper for Zoom Web
  function scrapeZoom() {
    const candidateNodes = document.querySelectorAll(`
      .caption-container,
      .transcript-item,
      .subtitle-container,
      div[class*="caption"],
      div[class*="transcript"],
      div[class*="subtitle"],
      div[class*="subtitles"],
      div[class*="zm-caption"],
      div[class*="zm-subtitle"],
      div[class*="closed-caption"]
    `);

    candidateNodes.forEach(node => {
      const rawText = node.innerText ? node.innerText.trim() : '';
      if (!rawText || rawText.length < 2) return;

      if (rawText.includes('zoom.us') || rawText.includes('Mute') || rawText.includes('Start Video')) return;

      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length >= 2) {
        const possibleSpeaker = lines[0];
        const spokenText = lines.slice(1).join(' ');
        if (possibleSpeaker.length < 40 && spokenText.length > 1) {
          processCaptionEntry(possibleSpeaker, spokenText);
          return;
        }
      }

      const speakerEl = node.querySelector('.speaker-name, .caption-speaker, div[class*="speaker"], span[class*="speaker"]');
      const speaker = speakerEl ? speakerEl.innerText.trim() : 'Speaker';
      const text = rawText.replace(speaker, '').trim();

      if (text && text.length > 1 && text !== speaker) {
        processCaptionEntry(speaker, text);
      }
    });
  }

  // Universal Scraper for MS Teams
  function scrapeMSTeams() {
    const candidateNodes = document.querySelectorAll(`
      div[data-tid="closed-captions-renderer"],
      div.ui-chat__item,
      div[class*="closed-captions"],
      div[class*="closed-caption"],
      div[class*="caption"]
    `);

    candidateNodes.forEach(node => {
      const rawText = node.innerText ? node.innerText.trim() : '';
      if (!rawText || rawText.length < 2) return;

      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length >= 2) {
        const possibleSpeaker = lines[0];
        const spokenText = lines.slice(1).join(' ');
        if (possibleSpeaker.length < 40 && spokenText.length > 1) {
          processCaptionEntry(possibleSpeaker, spokenText);
          return;
        }
      }

      const speakerEl = node.querySelector('span[data-tid="cc-speaker-name"], .ui-chat__message__author, span[class*="speaker"]');
      const speaker = speakerEl ? speakerEl.innerText.trim() : 'Speaker';
      const text = rawText.replace(speaker, '').trim();

      if (text && text.length > 1 && text !== speaker) {
        processCaptionEntry(speaker, text);
      }
    });
  }

  // Platform specific scraping runner
  function runScraper() {
    if (activePlatform === 'Google Meet') {
      scrapeGoogleMeet();
    } else if (activePlatform === 'Zoom Web') {
      scrapeZoom();
    } else if (activePlatform === 'MS Teams') {
      scrapeMSTeams();
    } else {
      // Generic fallback for open web meeting tools
      const ariaLiveElements = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]');
      ariaLiveElements.forEach(el => {
        if (el.innerText && el.innerText.length > 5) {
          processCaptionEntry('Participant', el.innerText.trim());
        }
      });
    }
  }

  // Throttled Scraper Runner to prevent CPU spikes and infinite loops
  let scrapeTimer = null;
  function scheduleScrape() {
    if (scrapeTimer) return;
    scrapeTimer = setTimeout(() => {
      scrapeTimer = null;
      runScraper();
    }, 400);
  }

  // Start DOM Observer
  function startObserving() {
    if (isRecording) return;
    isRecording = true;
    createOverlayWidget();
    updateOverlayStatus(`Listening (${activePlatform})...`, '#22c55e');

    captionObserver = new MutationObserver((mutations) => {
      // Ignore mutations originating from SyncScribe's own overlay widget
      const isExternalMutation = mutations.some(m => {
        const target = m.target;
        if (!target) return false;
        if (target.id === 'syncscribe-overlay' || (target.closest && target.closest('#syncscribe-overlay'))) {
          return false;
        }
        return true;
      });

      if (isExternalMutation) {
        scheduleScrape();
      }
    });

    captionObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Interval safety fallback (every 2 seconds)
    window.__syncScribeInterval = setInterval(scheduleScrape, 2000);
  }

  // Stop DOM Observer
  function stopObserving() {
    isRecording = false;
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    if (window.__syncScribeInterval) {
      clearInterval(window.__syncScribeInterval);
    }
    if (scrapeTimer) {
      clearTimeout(scrapeTimer);
      scrapeTimer = null;
    }
    updateOverlayStatus('Recording Paused', '#f59e0b');
  }

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_RECORDING') {
      startObserving();
      sendResponse({ status: 'started', platform: activePlatform, count: capturedCount });
    } else if (request.action === 'STOP_RECORDING') {
      stopObserving();
      sendResponse({ status: 'stopped', count: capturedCount });
    } else if (request.action === 'GET_STATUS') {
      sendResponse({
        isRecording,
        platform: activePlatform,
        capturedCount
      });
    }
    return true;
  });

  // Automatically start recording when meeting page loads
  startObserving();
})();
