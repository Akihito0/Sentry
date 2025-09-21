// Sentry Content Script: Scans static and dynamic page content for real-time protection.
/* global chrome */
/**
 * A helper function to prevent a function from being called too frequently.
 * This is essential for performance with MutationObserver.
 * @param {Function} func The function to debounce.
 * @param {number} delay The debounce delay in milliseconds.
 * @returns {Function} A new function that will only run after the delay.
 */
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

/**
 * Scans the visible text on the page and sends it to the Sentry backend for analysis.
 */
async function scanPageWithSentryAI() {
  // If the page is already blocked by our overlay, don't scan again.
  if (document.getElementById('sentry-overlay')) {
    console.log("Sentry: Page is already blocked. Halting further scans.");
    // If we are blocked, we should also stop the observer to save resources.
    if (observer) {
      observer.disconnect();
    }
    return;
  }
  
  const bodyText = document.body.innerText;

  if (!bodyText || bodyText.trim().length === 0) {
    console.log("Sentry: No text found to scan.");
    return;
  }

  console.log("Sentry: Scanning page content...");

  try {
    const response = await fetch('http://localhost:8000/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: bodyText })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Sentry: Backend returned an error.", errorData.detail);
      return;
    }

    const aiResponse = await response.json();
    console.log("Sentry AI Full Response (for future use):", aiResponse);

    if (aiResponse.detected && aiResponse.suggested_action !== "allow") {
      console.warn("Sentry: Inappropriate content detected!", aiResponse.summary);
      applySentryAction(aiResponse);
    } else {
      console.log("Sentry: Content is safe.");
    }
  } catch (err) {
    console.error('Sentry: Failed to connect to the backend or parse the response.', err);
  }
}

/**
 * Applies the visual block and displays the friendly overlay.
 * @param {object} ai - The JSON response from the AI.
 */
function applySentryAction(ai) {
  const contentWrapper = document.createElement('div');
  contentWrapper.id = 'sentry-content-wrapper';
  while (document.body.firstChild) {
    contentWrapper.appendChild(document.body.firstChild);
  }
  document.body.appendChild(contentWrapper);

  if (ai.suggested_action === "blur" || ai.suggested_action === "block") {
    contentWrapper.style.filter = 'blur(12px)';
    contentWrapper.style.pointerEvents = 'none';
  }

  const overlay = document.createElement('div');
  overlay.id = 'sentry-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(255, 255, 255, 0.9); z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', 'Roboto', Arial, sans-serif;
  `;

  const robotUrl = chrome.runtime.getURL('images/sentry_robot.png');

  overlay.innerHTML = `
    <div style="display: flex; align-items: center; background: #fff; border-radius: 20px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12); max-width: 550px; width: 90vw; padding: 2rem; border: 1px solid #eee;">
      <div style="flex-shrink: 0; margin-right: 2rem;">
        <img src="${robotUrl}" alt="Sentry Mascot" style="width: 120px; height: 120px;" />
      </div>
      <div style="text-align: left;">
        <h2 style="color: #1976d2; font-size: 1.6rem; margin: 0 0 0.5rem 0; font-weight: 700;">Content Alert</h2>
        <p style="color: #d32f2f; font-weight: 500; margin: 0 0 1.5rem 0; font-size: 1rem; line-height: 1.6;">
          ${ai.summary}
        </p>
        <button id="sentry-go-back" style="background: #2196F3; color: #fff; border: none; border-radius: 10px; padding: 0.8em 1.8em; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s ease;">
          Go Back
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#sentry-go-back').addEventListener('click', () => {
    window.history.back();
  });
}

// --- Main Execution ---

const debouncedScan = debounce(scanPageWithSentryAI, 1500);

// 2. Set up the MutationObserver to watch for changes in the page.
const observer = new MutationObserver(() => { // <-- THE FIX IS HERE
  // For any change, trigger our debounced scan.
  console.log("Sentry: Detected page change, queueing scan.");
  debouncedScan();
});

// 3. Start observing the entire document body for added nodes and subtree changes.
function startObserver() {
    observer.observe(document.body, {
        childList: true, // Watch for direct children being added or removed
        subtree: true,   // Watch all descendants of the body
    });
    console.log("Sentry: Real-time content observer is now active.");
}

// 4. Run an initial scan on page load, and then start the observer.
window.addEventListener('load', () => {
    scanPageWithSentryAI(); // Initial scan for static content
    startObserver();        // Start watching for dynamic changes
});