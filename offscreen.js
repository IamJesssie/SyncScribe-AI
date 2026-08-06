/**
 * SyncScribe AI - Offscreen Audio Processing Engine
 * 
 * Architecture (Sidecue-style):
 * 1. CLAIM_STREAM: Parks the tab MediaStream before the streamId expires
 * 2. ENGINE_START: Builds audio graph + starts STT engine
 * 3. ENGINE_STOP: Tears down everything cleanly
 * 
 * Supports:
 * - Web Speech API (FREE, no API key) — works with tab audio via AudioContext routing
 * - Deepgram Nova-2 WebSocket (paid, better quality + speaker diarization)
 */

// ── State ───────────────────────────────────────────────────────────────
let state = 'idle'; // idle | claiming | claimed | running | stopping
let tabStream = null;
let playbackContext = null;
let captureContext = null;
let recognition = null;
let deepgramSocket = null;
let mediaRecorder = null;

// ── Message Router ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen') return;

  if (request.action === 'OFFSCREEN_PING') {
    sendResponse({ ready: true });
    return true;
  }

  if (request.action === 'CLAIM_STREAM') {
    handleClaim(request.streamId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'ENGINE_START') {
    handleStart(request.streamId, request.sttApiKey, request.sttProvider)
      .then((result) => sendResponse({ success: true, method: result.method }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'ENGINE_STOP') {
    handleStop();
    sendResponse({ success: true });
    return true;
  }

  // Legacy compatibility
  if (request.action === 'START_TAB_CAPTURE') {
    handleClaim(request.streamId)
      .then(() => handleStart(request.streamId, request.sttApiKey, request.sttProvider))
      .then((result) => sendResponse({ success: true, method: result.method }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'START_MIC_CAPTURE') {
    handleMicCapture(request.sttApiKey, request.sttProvider)
      .then((result) => sendResponse({ success: true, method: result.method }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'STOP_TAB_CAPTURE') {
    handleStop();
    sendResponse({ success: true });
    return true;
  }
});

// ── CLAIM_STREAM: Park the MediaStream before streamId expires (~5s TTL) ──
async function handleClaim(streamId) {
  if (!streamId) throw new Error('Missing streamId for claim');

  // Clean up any existing stream
  handleStop();

  state = 'claiming';
  console.log('[SyncScribe Offscreen] Claiming tab audio stream...');

  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });
    state = 'claimed';
    console.log('[SyncScribe Offscreen] Tab stream claimed and parked!');
  } catch (err) {
    state = 'idle';
    console.error('[SyncScribe Offscreen] Failed to claim stream:', err);
    throw err;
  }
}

// ── ENGINE_START: Build audio graph + start STT ─────────────────────────
async function handleStart(streamId, apiKey, provider) {
  // If we don't have a claimed stream, try to claim now
  if (!tabStream && streamId) {
    await handleClaim(streamId);
  }

  if (!tabStream) {
    // No tab stream available — fall back to microphone
    return await handleMicCapture(apiKey, provider);
  }

  state = 'running';
  console.log('[SyncScribe Offscreen] Starting audio engine...');

  try {
    // ── Playback Context: User hears the tab audio at native sample rate ──
    playbackContext = new AudioContext();
    const playbackSource = playbackContext.createMediaStreamSource(tabStream);
    const gainNode = playbackContext.createGain();
    gainNode.gain.value = 1.0;
    playbackSource.connect(gainNode);
    gainNode.connect(playbackContext.destination);

    // ── Monitor for tab audio track ending ──
    const audioTrack = tabStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.addEventListener('ended', () => {
        console.warn('[SyncScribe Offscreen] Tab audio track ended');
        broadcast({ action: 'SESSION_ENDED', reason: 'tab_audio_lost' });
        handleStop();
      });
    }

    // ── Start STT engine ──
    const useDeepgram = provider === 'deepgram' && apiKey && apiKey.trim() !== '';

    if (useDeepgram) {
      startDeepgramSTT(tabStream, apiKey.trim());
      return { method: 'deepgram' };
    } else {
      startWebSpeechSTT(tabStream);
      return { method: 'webspeech' };
    }
  } catch (err) {
    console.error('[SyncScribe Offscreen] Engine start failed:', err);
    handleStop();
    throw err;
  }
}

// ── Microphone fallback capture ─────────────────────────────────────────
async function handleMicCapture(apiKey, provider) {
  handleStop();

  state = 'running';
  console.log('[SyncScribe Offscreen] Starting microphone capture...');

  try {
    tabStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.warn('[SyncScribe Offscreen] Mic access denied, trying Web Speech API without stream:', err.message);
    tabStream = null;
  }

  const useDeepgram = provider === 'deepgram' && apiKey && apiKey.trim() !== '';

  if (useDeepgram && tabStream) {
    startDeepgramSTT(tabStream, apiKey.trim());
    return { method: 'deepgram-mic' };
  } else {
    startWebSpeechSTT(tabStream);
    return { method: 'webspeech-mic' };
  }
}

// ── Web Speech API STT (FREE, no API key needed) ────────────────────────
function startWebSpeechSTT(stream) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[SyncScribe Offscreen] Web Speech API not available.');
    broadcast({ action: 'ENGINE_ERROR', error: 'Web Speech API not supported in this browser.' });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      const text = result[0].transcript ? result[0].transcript.trim() : '';
      if (text.length < 2) continue;

      if (result.isFinal) {
        // Final transcript — send as confirmed
        broadcast({ action: 'ENGINE_TRANSCRIPT', speaker: 'Speaker', text: text });
      } else {
        // Interim — send for live display
        broadcast({ action: 'ENGINE_INTERIM', speaker: 'Speaker', text: text });
      }
    }
  };

  recognition.onerror = (err) => {
    console.warn('[SyncScribe Offscreen] Speech Recognition error:', err.error);
    if (err.error === 'not-allowed') {
      broadcast({ action: 'ENGINE_ERROR', error: 'Microphone permission denied. Please allow microphone access.' });
      state = 'idle';
      return;
    }
    // Auto-retry for recoverable errors
    if (state === 'running' && err.error !== 'aborted') {
      setTimeout(() => {
        if (state === 'running' && recognition) {
          try { recognition.start(); } catch (e) {}
        }
      }, 1500);
    }
  };

  recognition.onend = () => {
    // Auto-restart if we're still supposed to be running
    if (state === 'running') {
      setTimeout(() => {
        if (state === 'running' && recognition) {
          try { recognition.start(); } catch (e) {}
        }
      }, 300);
    }
  };

  try {
    recognition.start();
    console.log('[SyncScribe Offscreen] Web Speech API STT started!');
    broadcast({ action: 'ENGINE_STATUS', status: 'listening' });
  } catch (e) {
    console.error('[SyncScribe Offscreen] Failed to start Web Speech API:', e);
  }
}

// ── Deepgram WebSocket STT (requires API key) ───────────────────────────
function startDeepgramSTT(stream, apiKey) {
  const wsUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&interim_results=true&utterance_end_ms=1500&vad_events=true&encoding=linear16&sample_rate=16000&channels=1';
  
  deepgramSocket = new WebSocket(wsUrl, ['token', apiKey]);

  deepgramSocket.onopen = () => {
    console.log('[SyncScribe Offscreen] Deepgram WebSocket Connected!');
    broadcast({ action: 'ENGINE_STATUS', status: 'listening' });
    setupPCMPipeline(stream);
  };

  deepgramSocket.onmessage = (message) => {
    try {
      const data = JSON.parse(message.data);
      
      // Handle VAD events
      if (data.type === 'UtteranceEnd') return;

      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript || transcript.trim().length === 0) return;

      const speakerId = data.channel?.alternatives?.[0]?.words?.[0]?.speaker;
      const speakerName = speakerId !== undefined ? `Speaker ${speakerId + 1}` : 'Participant';

      if (data.is_final) {
        broadcast({ action: 'ENGINE_TRANSCRIPT', speaker: speakerName, text: transcript.trim() });
      } else {
        broadcast({ action: 'ENGINE_INTERIM', speaker: speakerName, text: transcript.trim() });
      }
    } catch (e) {}
  };

  deepgramSocket.onerror = (err) => {
    console.warn('[SyncScribe Offscreen] Deepgram WebSocket error, falling back to Web Speech API:', err);
    if (deepgramSocket) {
      try { deepgramSocket.close(); } catch (e) {}
      deepgramSocket = null;
    }
    // Fallback to free Web Speech API
    startWebSpeechSTT(stream);
  };

  deepgramSocket.onclose = (event) => {
    console.log('[SyncScribe Offscreen] Deepgram WebSocket closed:', event.code, event.reason);
  };
}

// ── PCM Pipeline for Deepgram (16kHz linear16) ──────────────────────────
function setupPCMPipeline(stream) {
  try {
    // Create a 16kHz AudioContext for downsampling
    captureContext = new AudioContext({ sampleRate: 16000 });
    const source = captureContext.createMediaStreamSource(stream);
    
    // Use ScriptProcessorNode (widely supported) for PCM extraction
    const processor = captureContext.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (event) => {
      if (!deepgramSocket || deepgramSocket.readyState !== WebSocket.OPEN) return;
      
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      deepgramSocket.send(pcm16.buffer);
    };

    source.connect(processor);
    // Connect to destination with zero gain to prevent double playback
    const silentGain = captureContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(captureContext.destination);

    console.log('[SyncScribe Offscreen] PCM pipeline connected (16kHz)');
  } catch (err) {
    console.error('[SyncScribe Offscreen] PCM pipeline error:', err);
  }
}

// ── ENGINE_STOP: Full teardown ──────────────────────────────────────────
function handleStop() {
  if (state === 'idle' || state === 'stopping') return;
  state = 'stopping';
  console.log('[SyncScribe Offscreen] Stopping engine...');

  // Stop Speech Recognition
  if (recognition) {
    try { recognition.abort(); } catch (e) {}
    recognition = null;
  }

  // Close Deepgram WebSocket
  if (deepgramSocket) {
    try { deepgramSocket.close(); } catch (e) {}
    deepgramSocket = null;
  }

  // Stop MediaRecorder
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch (e) {}
    mediaRecorder = null;
  }

  // Close capture AudioContext
  if (captureContext) {
    try { captureContext.close(); } catch (e) {}
    captureContext = null;
  }

  // Close playback AudioContext
  if (playbackContext) {
    try { playbackContext.close(); } catch (e) {}
    playbackContext = null;
  }

  // Stop all media tracks
  if (tabStream) {
    tabStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    tabStream = null;
  }

  state = 'idle';
  console.log('[SyncScribe Offscreen] Engine stopped.');
}

// ── Broadcast helper ────────────────────────────────────────────────────
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
