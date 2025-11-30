// This script is dedicated to creating and managing the floating chatbot UI.
/*global chrome */

// ⚠️ DO NOT RUN CHATBOT ON LOCALHOST DEV SITES
if (window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('localhost:')) {
  console.log("Sentry Chatbot: Skipping on localhost/dashboard");
  throw new Error("Sentry chatbot intentionally disabled on localhost");
}

function createChatbot() {
  // --- 1. Create UI Elements ---
  const chatButton = document.createElement('div');
  chatButton.id = 'sentry-chat-button';
  const robotImage = document.createElement('img');
  robotImage.src = chrome.runtime.getURL('images/NOBG/Sentry_Chat.png'); 
  robotImage.alt = 'Sentry Chatbot';
  chatButton.appendChild(robotImage);

  const chatWindow = document.createElement('div');
  chatWindow.id = 'sentry-chat-window';
  // --- CODE INSERTION: Added message area and input form ---
  chatWindow.innerHTML = `
    <div id="sentry-chat-header">
      <h3>Sentry AI</h3>
      <button id="sentry-chat-close-btn">&times;</button>
    </div>
    <div id="sentry-chat-messages"></div>
    <form id="sentry-chat-input-form">
      <textarea id="sentry-chat-input" placeholder="Ask Sentry anything..." rows="1"></textarea>
      <button id="sentry-chat-send-btn" type="submit" title="Send" disabled>&#10148;</button>
    </form>
  `;

  document.body.appendChild(chatButton);
  document.body.appendChild(chatWindow);

  // Get new elements
  const closeButton = document.getElementById('sentry-chat-close-btn');
  const messagesContainer = document.getElementById('sentry-chat-messages');
  const inputForm = document.getElementById('sentry-chat-input-form');
  const inputField = document.getElementById('sentry-chat-input');
  const sendButton = document.getElementById('sentry-chat-send-btn');
  
  let hasWelcomed = false; // To show welcome message only once per session
  let chatHistory = []; // Store chat messages

  // --- 2. Idle Timer Logic ---
  let idleTimer;

  function startIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!chatWindow.classList.contains('visible')) {
        chatButton.classList.add('idle');
      }
    }, 3500);
  }

  function resetIdleState() {
    clearTimeout(idleTimer);
    chatButton.classList.remove('idle');
  }

  // --- 3. Dragging Logic ---
  let isDragging = false;
  let offsetX, offsetY;

  chatButton.addEventListener('mousedown', (e) => {
    resetIdleState();
    isDragging = false;
    offsetX = e.clientX - chatButton.getBoundingClientRect().left;
    offsetY = e.clientY - chatButton.getBoundingClientRect().top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    isDragging = true;
    chatButton.classList.add('dragging');
    chatButton.style.right = 'auto';
    chatButton.style.bottom = 'auto';
    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;
    const buttonRect = chatButton.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, window.innerWidth - buttonRect.width));
    newY = Math.max(0, Math.min(newY, window.innerHeight - buttonRect.height));
    chatButton.style.left = `${newX}px`;
    chatButton.style.top = `${newY}px`;
  }

  function onMouseUp() {
    chatButton.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (isDragging) {
      snapToCorner();
    }
    startIdleTimer(); 
  }
  
  // --- 4. Hover Logic ---
  chatButton.addEventListener('mouseenter', resetIdleState);
  chatButton.addEventListener('mouseleave', startIdleTimer);

  // --- 5. Click vs. Drag & Main Chat Logic (UPDATED) ---
  chatButton.addEventListener('click', (e) => {
    if (isDragging) {
      e.preventDefault();
      return;
    }
    toggleChatWindow();
  });

  closeButton.addEventListener('click', () => {
    toggleChatWindow();
  });

  // --- NEW: Handle form submission ---
  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSendMessage();
  });
  
  // --- NEW: Auto-resize textarea and enable/disable send button ---
  inputField.addEventListener('input', () => {
    // Enable/disable send button
    sendButton.disabled = inputField.value.trim() === '';
    
    // Auto-resize logic
    inputField.style.height = 'auto';
    inputField.style.height = `${inputField.scrollHeight}px`;
  });
  
  // --- NEW: Allow sending with Enter key ---
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendButton.disabled) {
        handleSendMessage();
      }
    }
  });

  // --- 6. Helper Functions (UPDATED) ---

  // --- NEW: Appends a message to the chat window ---
  function appendMessage(text, sender, skipSave = false) {
    const messageElement = document.createElement('div');
    
    // Fix for the InvalidCharacterError by cleaning up the class name
    if (sender === 'sentry typing') {
      messageElement.classList.add('sentry-message', 'sentry', 'typing');
    } else {
      messageElement.classList.add('sentry-message', sender);
    }
    
    messageElement.textContent = text;
    messagesContainer.appendChild(messageElement);
    // Scroll to the bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Save message to storage and history (unless it's a typing indicator or loading from storage)
    if (!skipSave && sender !== 'sentry typing') {
      const message = { text, sender, timestamp: Date.now() };
      chatHistory.push(message);
      saveChatHistory();
    }
    
    return messageElement;
  }
  
  // --- NEW: Save chat history to Chrome storage ---
  function saveChatHistory() {
    chrome.storage.local.set({ sentryChat: chatHistory }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error saving chat history:", chrome.runtime.lastError);
      }
    });
  }
  
  // --- NEW: Load chat history from Chrome storage ---
  function loadChatHistory() {
    chrome.storage.local.get(['sentryChat'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error loading chat history:", chrome.runtime.lastError);
        return;
      }
      
      if (result.sentryChat && Array.isArray(result.sentryChat)) {
        chatHistory = result.sentryChat;
        
        // Display all saved messages
        chatHistory.forEach(msg => {
          appendMessage(msg.text, msg.sender, true); // skipSave = true to avoid duplicate saving
        });
        
        // Mark as welcomed if there are any messages
        if (chatHistory.length > 0) {
          hasWelcomed = true;
        }
      }
    });
  }
  
  // --- NEW: Handles the process of sending a message to the AI ---
  async function handleSendMessage() {
    const userInput = inputField.value.trim();
    if (userInput === '') return;

    appendMessage(userInput, 'user');
    
    // Clear input and disable send button
    inputField.value = '';
    sendButton.disabled = true;
    inputField.style.height = 'auto'; // Reset height

    // Show typing indicator
    const typingIndicator = appendMessage('Sentry is typing...', 'sentry typing');
    
    console.log("Sending message to AI:", userInput); // Add logging
    
    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: userInput })
      });

      // Remove the typing indicator as soon as we get a response
      typingIndicator.remove();

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI server responded with status: ${response.status}. Details: ${errorText}`);
      }

      const aiData = await response.json();
      
      // --- THIS IS THE FIX ---
      // Make sure the AI returned a 'reply' and then display it.
      if (aiData.reply) {
        appendMessage(aiData.reply, 'sentry'); // This line was missing
      } else {
        throw new Error("AI response did not contain a 'reply' field.");
      }

    } catch (error) {
      console.error("Sentry: Error communicating with chat AI.", error);
      console.log("Failed with endpoint: http://localhost:8000/chat");
      // If an error occurs, make sure the typing indicator is gone before showing the error message.
      if (typingIndicator) typingIndicator.remove();
      appendMessage("Sorry, I'm having trouble connecting to my brain right now. Please check the backend server and try again.", 'sentry');
    }
    // The finally block is no longer needed as we handle removal in the try/catch blocks.
  }

  function snapToCorner() {
    const buttonRect = chatButton.getBoundingClientRect();
    const cornerMargin = 20;
    const isLeftSide = (buttonRect.left + buttonRect.width / 2) < window.innerWidth / 2;
    const isTopSide = (buttonRect.top + buttonRect.height / 2) < window.innerHeight / 2;
    chatButton.style.top = 'auto';
    chatButton.style.left = 'auto';
    chatButton.style.right = 'auto';
    chatButton.style.bottom = 'auto';
    if (isTopSide) {
      chatButton.style.top = `${cornerMargin}px`;
    } else {
      chatButton.style.bottom = `${cornerMargin}px`;
    }
    if (isLeftSide) {
      chatButton.style.left = `${cornerMargin}px`;
    } else {
      chatButton.style.right = `${cornerMargin}px`;
    }
  }

  function toggleChatWindow() {
    const isVisible = chatWindow.classList.toggle('visible');
    
    if (isVisible) {
      resetIdleState();
      // --- NEW: Load chat history when opening for the first time ---
      if (!hasWelcomed) {
        loadChatHistory();
        // Show welcome message only if no history exists
        setTimeout(() => {
          if (chatHistory.length === 0) {
            appendMessage("Hello! I'm Sentry, your AI guardian for a safer web browsing experience. How can I assist you today?", 'sentry');
          }
          hasWelcomed = true;
        }, 100);
      }
    } else {
      startIdleTimer();
    }

    if (isVisible) {
      positionChatWindow();
    }
  }

  function positionChatWindow() {
    const buttonRect = chatButton.getBoundingClientRect();
    const windowMargin = 10;
    chatWindow.style.top = 'auto';
    chatWindow.style.left = 'auto';
    chatWindow.style.right = 'auto';
    chatWindow.style.bottom = 'auto';
    const isLeftSide = buttonRect.left < window.innerWidth / 2;
    const isTopSide = buttonRect.top < window.innerHeight / 2;
    if (isTopSide) {
      chatWindow.style.top = `${buttonRect.bottom + windowMargin}px`;
    } else {
      chatWindow.style.bottom = `${window.innerHeight - buttonRect.top + windowMargin}px`;
    }
    if (isLeftSide) {
      chatWindow.style.left = `${buttonRect.left}px`;
    } else {
      chatWindow.style.right = `${window.innerWidth - buttonRect.right}px`;
    }
  }

  // --- 7. Initial Start ---
  startIdleTimer();
  console.log('Sentry floating chatbot UI injected and ready.');
}

createChatbot();