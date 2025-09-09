/* global chrome */
// Sentry AI Content Script - Simplified & More Robust

// --- Configuration ---
const domainWhitelist = [
  '127.0.0.1',
  'localhost'
];
const ANALYSIS_INTERVAL = 3000; // Analyze the page every 3 seconds
const MIN_TEXT_LENGTH = 20;

// --- State ---
let isOverlayVisible = false;
let lastAnalyzedText = '';

// --- Main Function to Show Custom Warning Overlay ---
async function showWarningOverlay(reason) {
  if (isOverlayVisible || document.getElementById('sentry-ai-warning-overlay')) {
    return;
  }
  isOverlayVisible = true;

  try {
    const cssUrl = chrome.runtime.getURL('warning.css');
    const robotUrl = chrome.runtime.getURL('images/robot.png');
    const cssResponse = await fetch(cssUrl);
    const css = await cssResponse.text();

    const displayReason = (reason && reason !== 'AI_RESPONSE_FORMAT_ERROR') ? reason : "Potentially harmful content";

    const overlayHTML = `
      <div id="sentry-ai-warning-overlay">
        <div class="sentry-warning-box">
          <div class="sentry-robot-container">
            <img src="${robotUrl}" alt="Sentry AI Robot" draggable="false" />
          </div>
          <div class="sentry-text-content">
            <h1 class="sentry-warning-title">Whoops! Hold on...</h1>
            <p class="sentry-warning-reason">
              This page might contain content that isn't suitable right now because it appears to contain: <strong>${displayReason}</strong>
            </p>
            <div class="sentry-unlock-section">
              <p>Please ask a parent to enter their code to unlock.</p>
              <input type="password" id="sentry-unlock-input" class="sentry-unlock-input" placeholder="Enter Parent Code" />
              <button id="sentry-unlock-button" class="sentry-unlock-button">Unlock Page</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.appendChild(styleElement);

    const overlayElement = document.createElement('div');
    overlayElement.innerHTML = overlayHTML;
    document.body.appendChild(overlayElement);

    const unlockButton = document.getElementById('sentry-unlock-button');
    const unlockInput = document.getElementById('sentry-unlock-input');
    
    const handleUnlock = () => {
      if (unlockInput.value === '1234') {
        const overlay = document.getElementById('sentry-ai-warning-overlay');
        if (overlay) overlay.remove();
        window.location.reload();
      } else {
        unlockInput.value = '';
        unlockInput.placeholder = 'Incorrect code. Try again.';
        unlockInput.classList.add('sentry-input-error');
        setTimeout(() => unlockInput.classList.remove('sentry-input-error'), 500);
      }
    };
    
    unlockButton.addEventListener('click', handleUnlock);
    unlockInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handleUnlock();
    });

  } catch (error) {
    console.error('Sentry AI: CRITICAL - Failed to load custom warning overlay.', error);
    alert(`Sentry AI Critical Error: ${reason}`);
  }
}

// --- Function to Analyze Page Content ---
function analyzePageContent() {
  if (isOverlayVisible) return;

  const pageText = document.body.innerText;
  
  if (!pageText || pageText.trim().length < MIN_TEXT_LENGTH) {
    return;
  }
  
  // Only analyze if the text has actually changed
  if (pageText === lastAnalyzedText) {
    return;
  }
  lastAnalyzedText = pageText;

  console.log("Sentry AI: Analyzing page content...");
  chrome.runtime.sendMessage({ type: 'ANALYZE_CONTENT', text: pageText }, 
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Sentry AI Comms Error:', chrome.runtime.lastError.message);
        return;
      }
      
      if (!response) {
        console.error("Sentry AI: Received no response from background script.");
        return;
      }

      if (response.status === 'complete' && response.result && !response.result.is_safe) {
        showWarningOverlay(response.result.reason);
      } else if (response.status === 'error') {
        console.error('Sentry AI Server Error:', response.message);
        // Optionally show an overlay even for server errors
        // showWarningOverlay(`Server Error: ${response.message}`);
      } else {
        console.log("Sentry AI: Content analyzed and found to be safe.");
      }
    }
  );
}

// --- Main Initialization ---
function initializeSentry() {
  const currentHostname = window.location.hostname;
  if (domainWhitelist.some(domain => currentHostname.includes(domain))) {
    console.log(`Sentry AI: Disabled on whitelisted domain (${currentHostname}).`);
    return;
  }

  // Run an initial analysis when the page is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    analyzePageContent();
  } else {
    window.addEventListener('load', analyzePageContent, { once: true });
  }

  // Set up a recurring analysis to catch dynamic content
  setInterval(analyzePageContent, ANALYSIS_INTERVAL);
  
  console.log("Sentry AI initialized with a 3-second interval check.");
}

initializeSentry();