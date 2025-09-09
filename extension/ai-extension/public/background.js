/* global chrome */
// Listens for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Check if the message is the one we're expecting
  if (message.type === 'ANALYZE_CONTENT') {
    const pageText = message.text;

    // Call our FastAPI backend
    fetch('http://127.0.0.1:8000/analyze-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: pageText }),
    })
    .then(response => response.json())
    .then(data => {
      // Send the analysis result back to the content script
      sendResponse({ status: 'complete', result: data });
    })
    .catch(error => {
      console.error('Error calling Sentry AI backend:', error);
      sendResponse({ status: 'error', error: error.message });
    });

    // Return true to indicate that we will send a response asynchronously
    return true;
  }
});