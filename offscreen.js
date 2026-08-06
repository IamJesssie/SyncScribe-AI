/**
 * SyncScribe AI - Offscreen Tab Audio Processing Engine
 * Captures tab audio via streamId, plays audio back to user,
 * and runs real-time Speech-to-Text via Web Speech API or Deepgram WebSocket.
 */

let mediaStream = null;
let audioContext = null;
let recognition = null;
let deepgramSocket = null;
let isTranscribing = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen') return;

  if (request.action === 'OFFSCREEN_PING') {
    sendResponse({ ready: true });
    return true;
  }

  if (request.action === 'START_TAB_CAPTURE') {
    startTabAudioCapture(request.streamId, request.sttApiKey, request.sttProvider)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'START_MIC_CAPTURE') {
    startMicAudioCapture(request.sttApiKey, request.sttProvider)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'STOP_TAB_CAPTURE') {
    stopTabAudioCapture();
    sendResponse({ success: true });
    return true;
  }
});

async function startMicAudioCapture(apiKey, provider) {
  stopTabAudioCapture();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    isTranscribing = true;

    if (provider === 'deepgram' && apiKey && apiKey.trim() !== '') {
      startDeepgramWebSocket(mediaStream, apiKey.trim());
    } else {
      startWebSpeechRecognition(mediaStream);
    }
  } catch (err) {
    console.warn('[SyncScribe Offscreen] Mic access error, launching Web Speech API fallback:', err.message);
    isTranscribing = true;
    startWebSpeechRecognition(null);
  }
}

async function startTabAudioCapture(streamId, apiKey, provider) {
  stopTabAudioCapture();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // Playback captured audio to speaker so user can hear call normally
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    isTranscribing = true;

    if (provider === 'deepgram' && apiKey && apiKey.trim() !== '') {
      startDeepgramWebSocket(mediaStream, apiKey.trim());
    } else {
      startWebSpeechRecognition(mediaStream);
    }
  } catch (err) {
    console.error('[SyncScribe Offscreen] Error starting capture:', err);
    throw err;
  }
}

function startWebSpeechRecognition(stream) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[SyncScribe Offscreen] Web Speech API not supported in offscreen.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        const transcriptText = event.results[i][0].transcript.trim();
        if (transcriptText.length > 0) {
          sendNewCaption('Speaker', transcriptText);
        }
      }
    }
  };

  recognition.onerror = (err) => {
    console.warn('[SyncScribe Offscreen] Speech Recognition error:', err.error);
    if (err.error === 'not-allowed') {
      console.warn('[SyncScribe Offscreen] Microphone/Speech permission not granted yet. Please click "Capture Live Tab Audio" in Popup to grant permission.');
      isTranscribing = false;
      return;
    }
    if (isTranscribing && err.error !== 'no-speech' && err.error !== 'aborted') {
      setTimeout(() => {
        if (isTranscribing && recognition) {
          try { recognition.start(); } catch (e) {}
        }
      }, 1500);
    }
  };

  recognition.onend = () => {
    if (isTranscribing) {
      try { recognition.start(); } catch (e) {}
    }
  };

  try {
    recognition.start();
    console.log('[SyncScribe Offscreen] Web Speech API STT started!');
  } catch (e) {}
}

function startDeepgramWebSocket(stream, apiKey) {
  const wsUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&encoding=linear16&sample_rate=16000';
  deepgramSocket = new WebSocket(wsUrl, ['token', apiKey]);

  deepgramSocket.onopen = () => {
    console.log('[SyncScribe Offscreen] Deepgram WebSocket Connected!');
    setupMediaRecorder(stream, deepgramSocket);
  };

  deepgramSocket.onmessage = (message) => {
    try {
      const data = JSON.parse(message.data);
      const utterance = data.channel?.alternatives?.[0]?.transcript;
      if (data.is_final && utterance && utterance.trim().length > 0) {
        const speakerId = data.channel?.alternatives?.[0]?.words?.[0]?.speaker;
        const speakerName = speakerId !== undefined ? `Speaker ${speakerId + 1}` : 'Participant';
        sendNewCaption(speakerName, utterance.trim());
      }
    } catch (e) {}
  };

  deepgramSocket.onerror = (err) => {
    console.warn('[SyncScribe Offscreen] Deepgram WS error, falling back to Web Speech API:', err);
    startWebSpeechRecognition(stream);
  };
}

function setupMediaRecorder(stream, ws) {
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  };
  mediaRecorder.start(250);
}

function stopTabAudioCapture() {
  isTranscribing = false;
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  if (deepgramSocket) {
    try { deepgramSocket.close(); } catch (e) {}
    deepgramSocket = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
}

function sendNewCaption(speaker, text) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  chrome.runtime.sendMessage({
    action: 'NEW_CAPTION',
    payload: {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      platform: 'Tab Audio STT',
      speaker: speaker || 'Speaker',
      text: text,
      timestamp: timestamp,
      rawTime: Date.now()
    }
  }).catch(() => {});
}
