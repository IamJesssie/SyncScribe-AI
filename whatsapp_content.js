/**
 * ZeroScribe AI - WhatsApp Web Content Helper
 * Ensures pre-filled transcript summary is ready in chat input box
 */

(function () {
  'use strict';

  if (window.__zeroScribeWhatsAppInitialized) return;
  window.__zeroScribeWhatsAppInitialized = true;

  console.log('[ZeroScribe AI] WhatsApp Web Helper Active');

  // Display top notification toast on WhatsApp Web
  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 12px 24px;
      border-radius: 30px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: fadeInDown 0.4s ease;
    `;

    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M22 11.08V12a10 10 10 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  // Focus WhatsApp text box when loaded
  function focusChatInput() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const chatInput = document.querySelector('footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]');
      if (chatInput) {
        clearInterval(interval);
        chatInput.focus();
        showToast('ZeroScribe AI Summary pre-filled! Press Enter to send.');
      }
      if (attempts > 30) clearInterval(interval);
    }, 1000);
  }

  window.addEventListener('load', focusChatInput);
  focusChatInput();
})();
