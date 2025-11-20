// Sentry Content Script: Scans page content and blocks inappropriate material
// CSS files are loaded via the manifest.json content_scripts section

/**
 * A helper function to prevent a function from being called too frequently.
 * This is essential for performance with MutationObserver.
 * @param {Function} func The function to debounce
 * @param {number} delay The debounce delay in milliseconds
 * @returns {Function} A new function that will only run after the delay
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
 * Optimized for performance on dynamic sites like Facebook Messenger.
 * @returns {Promise<void>} A promise that resolves when the scan is complete
 */
async function scanPageWithSentryAI() {
  // On regular sites, limit scanning when notifications exist
  // For Messenger, allow additional scans even with existing notifications
  if (document.querySelectorAll('.sentry-notification').length > 0 && !isMessenger) {
    // Too many notifications would be distracting, limit to 3 max on screen
    if (activeNotifications.length >= 3) {
      console.log("Sentry: Maximum notifications reached. Halting further scans.");
      hasActiveNotification = true;
      return;
    }
  }
  
  // SIMPLIFIED CONTENT EXTRACTION - use direct approach
  let contentToScan = "";
  
  try {
    // Direct method - get all visible text on the page
    // This is more reliable than trying to be clever with DOM manipulation
    contentToScan = document.body.innerText || "";
    
    // If we didn't get anything, try another approach
    if (!contentToScan || contentToScan.trim().length < 10) {
      // Try getting from all paragraph elements
      const paragraphs = document.querySelectorAll('p, div, span, h1, h2, h3, h4, h5');
      let paragraphTexts = [];
      
      paragraphs.forEach(p => {
        if (p.innerText && p.innerText.trim().length > 0) {
          paragraphTexts.push(p.innerText.trim());
        }
      });
      
      contentToScan = paragraphTexts.join(' ');
    }
    
    // Last resort - get from textContent
    if (!contentToScan || contentToScan.trim().length < 10) {
      contentToScan = document.body.textContent || "";
    }
    
    // Debug information about content extraction
    console.log(`Sentry: Extracted ${contentToScan ? contentToScan.trim().length : 0} characters of content`);
  } catch (error) {
    console.error("Sentry: Error extracting content", error);
    contentToScan = "";
  }

  // Use adjusted minimum length based on site context (reduced to just 20 chars)
  if (!contentToScan || contentToScan.trim().length < 20) {
    console.log(`Sentry: Not enough meaningful text found to scan (${contentToScan ? contentToScan.trim().length : 0} chars).`);
    return;
  }

  console.log("Sentry: Scanning page content...");

  try {
    // Special handling for Facebook Messenger messages
    if (isMessenger) {
      // Try to find the direct message containers currently visible
      const messengerBlurResult = handleMessengerScamDetection(contentToScan);
      if (messengerBlurResult.scamDetected) {
        console.log("Sentry: Facebook Messenger scam detected and handled directly");
        return; // Skip the rest of the processing
      }
    }
    
    // Enhanced content filtering before sending to backend
    // Check for multiple types of problematic content
    
    // 1. Check for vulgar/explicit content
    const vulgarRegex = /\b(fuck|shit|bitch|asshole|cunt|dick|pussy|rape|kill|die|porn|sex|xxx|nude)\b/i;
    
    // 2. Check for scam patterns (job offers, financial promises, contact requests)
    const scamRegex = /\b(job opportunity|congratulations|you have (won|received)|opportunity|salary range|daily salary|contact us|whatsapp contact|representative|recruiter|step by step|get started|HR representative)\b/i;
    const suspiciousContactRegex = /\b(wa\.me|whatsapp|telegram|contact|t\.me|click here)\b/i;
    const moneyRegex = /\b(\$|USD|EUR|dollar|€|£|salary|income|earn|profit|payment|invest|[0-9]{3,})\b/i;
    
    // Score-based approach for scam detection
    let scamScore = 0;
    
    // Check for scam indicators
    if (scamRegex.test(contentToScan)) scamScore += 3;
    if (suspiciousContactRegex.test(contentToScan)) scamScore += 2;
    if (moneyRegex.test(contentToScan)) scamScore += 1;
    
    // Look for particularly suspicious patterns
    if (/opportunity|job|position/.test(contentToScan) && /salary|income|earn/.test(contentToScan)) {
      scamScore += 3;
    }
    
    if (/congratulations|received|selected|chosen/.test(contentToScan) && /contact|click|link|wa\.me/.test(contentToScan)) {
      scamScore += 4;
    }
    
    // Check for suspicious URLs/links
    const urlRegex = /(https?:\/\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+)/gi;
    const urls = contentToScan.match(urlRegex) || [];
    
    if (urls.length > 0) {
      scamScore += 1;
      
      // Check if URLs contain suspicious patterns
      for (const url of urls) {
        if (/wa\.me|t\.me|bit\.ly|goo\.gl|tinyurl|short|click/i.test(url)) {
          scamScore += 3; // Higher score for shortened/suspicious links
        }
      }
    }
    
    // For Messenger, boost the scam score
    if (isMessenger) {
      scamScore += 2;
    }
    
    // Handle vulgar content detection
    if (hasObviousVulgarContent) {
      console.warn("Sentry: Detected obvious vulgar content, applying immediate filter");
      const badWords = contentToScan.match(vulgarRegex);
      const mockResponse = {
        detected: true,
        suggested_action: "block",
        category: "explicit language",
        summary: `Detected inappropriate language: ${badWords ? badWords.join(', ') : 'vulgar content'}`,
        bad_words: badWords || ["explicit"]
      };
      
      applySentryAction(mockResponse);
      hasActiveNotification = true;
    }
    
    // Handle scam content detection
    if (scamScore >= SCAM_DETECTION_THRESHOLD) {
      console.warn(`Sentry: Detected potential scam content (score: ${scamScore}), applying immediate filter`);
      
      // Extract relevant patterns to display in notification
      const scamIndicators = [];
      if (scamRegex.test(contentToScan)) scamIndicators.push("suspicious job offer");
      if (suspiciousContactRegex.test(contentToScan)) scamIndicators.push("suspicious contact information");
      if (moneyRegex.test(contentToScan)) scamIndicators.push("financial promises");
      if (urls.length > 0) scamIndicators.push("suspicious links");
      
      // Add site-specific context to improve the alert
      let siteContext = '';
      if (isMessenger) {
        siteContext = ' on Facebook Messenger';
      } else if (isSocialMedia) {
        siteContext = ' on this social media platform';
      }
      
      const mockResponse = {
        detected: true,
        suggested_action: "block",
        category: "potential scam",
        summary: `Detected potential scam content${siteContext}: ${scamIndicators.join(', ')}. Be careful with links and personal information.`,
        bad_words: ["scam", "phishing", "suspicious"]
      };
      
      applySentryAction(mockResponse);
      hasActiveNotification = true;
    }
    
    // Always send to backend as well for thorough analysis
    // For Messenger, prioritize speed by limiting content size further
    const contentLimit = isMessenger ? 5000 : 10000;
    
    const response = await fetch(`${BACKEND_URL}/analyze-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: contentToScan.slice(0, contentLimit)
      })
    });

    // Even if response is not OK, we'll try to parse it as our backend now returns useful JSON even on errors
    const aiResponse = await response.json();
    console.log("Sentry AI Response:", aiResponse);

    // Convert backend response format to frontend expected format
    if (aiResponse.safe === false) {
      const frontendResponse = {
        detected: true,
        suggested_action: "block",
        category: aiResponse.category || "unsafe content",
        summary: aiResponse.reason || aiResponse.title || "Inappropriate content detected",
        bad_words: [aiResponse.category || "unsafe"]
      };
      console.warn("Sentry: Inappropriate content detected!", frontendResponse.summary);
      applySentryAction(frontendResponse);
      hasActiveNotification = true;
      significantChanges = false; // Reset flag as we've processed the changes
    } else {
      console.log("Sentry: Content is safe.");
    }
  } catch (err) {
    console.error('Sentry: Failed to connect to the backend or parse the response.', err);
    
    // Don't create notifications for connection errors - just log them
    // This helps prevent error popups
  } finally {
    // Signal that scanning is complete
    isScanning = false;
  }
}

/**
 * Checks if content should be excluded from scanning based on whitelists
 * @param {Element} element - DOM element to check
 * @param {string} content - Text content to check
 * @returns {boolean} - True if content should be excluded
 */
function isWhitelistedContent(element, content) {
  // Skip scanning elements that are likely to be false positives
  
  // 1. Check for common UI elements that shouldn't be blurred
  if (element) {
    // Skip navigation elements
    if (element.closest('nav, [role="navigation"], header, footer')) {
      return true;
    }
    
    // Skip code blocks, typically safe even with matching keywords
    if (element.closest('pre, code, .code, .syntax, .highlight')) {
      return true;
    }
    
    // Skip form inputs like search bars
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return true;
    }
    
    // Skip elements with certain common classes
    const classList = element.classList || [];
    const skipClasses = ['search', 'navigation', 'breadcrumb', 'menu', 'toolbar'];
    
    for (const cls of skipClasses) {
      if (classList.contains(cls)) {
        return true;
      }
    }
  }
  
  // 2. Content-based whitelisting for common false positives
  if (content) {
    // Skip content that's likely part of legitimate UI
    if (/search results for|showing results for|found \d+ results/i.test(content)) {
      return true;
    }
    
    // Skip content that appears to be code samples or technical documentation
    if (/function|var |const |let |import |export |class |interface /i.test(content) && 
        /[{}();]/.test(content)) {
      return true;
    }
    
    // Skip content in AI chat responses (context-aware)
    const aiResponsePatterns = [
      /as an ai language model/i,
      /i cannot provide|i'm not able to provide/i,
      /is against my ethical guidelines/i,
      /i don't have the ability to/i
    ];
    
    for (const pattern of aiResponsePatterns) {
      if (pattern.test(content)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Analyzes the page to find potentially problematic content based on keywords
 * and applies selective blurring to those elements.
 * @param {object} ai - The JSON response from the AI.
 */
function applySentryAction(ai) {
  const keywords = ai.bad_words || [];
  const category = ai.category || "unsafe content";
  const summary = ai.summary || "This content has been identified as potentially sensitive or inappropriate.";
  const isScamDetection = category.includes('scam') || keywords.some(word => ['scam', 'phishing', 'suspicious'].includes(word));

  const title = `Content Warning: ${category}`;
  const reason = summary;
  const whatToDo = "Click 'Continue' to view the content, or 'Cancel' to keep it hidden.";

  // Find elements to block
  const textNodes = findTextNodesToBlur(keywords);
  const imageNodes = isScamDetection ? [] : findImagesToBlur();

  let contentBlocked = false;

  // Block problematic text
  textNodes.forEach(nodeInfo => {
    const { node, parent } = nodeInfo;
    if (!node || !parent || !document.body.contains(parent)) return;

    const wrapper = document.createElement('span');
    const newTextNode = document.createTextNode(node.nodeValue);
    wrapper.appendChild(newTextNode);

    try {
      parent.replaceChild(wrapper, node);
      blockContent(wrapper, title, reason, whatToDo);
      contentBlocked = true;
    } catch (err) {
      console.error("Sentry: Error applying block to text node", err);
    }
  });

  // Block problematic images
  imageNodes.forEach(img => {
    if (!document.body.contains(img)) return;
    blockContent(img, title, reason, whatToDo);
    contentBlocked = true;
  });

  // Special handling for Messenger scams
  if (isScamDetection && isMessenger) {
    const messageContainers = document.querySelectorAll('.x78zum5, .xcrwhx7, [role="row"], .message-container');
    messageContainers.forEach(container => {
      let containerText = container.innerText || '';
      const hasScamIndicators = /job opportunity|congratulations|salary range|contact us|whatsapp|wa\.me|t\.me/i.test(containerText);
      if (hasScamIndicators) {
        blockContent(container, title, reason, whatToDo);
        contentBlocked = true;
      }
    });
  }

  if (contentBlocked) {
    console.log("Sentry: Content has been blocked.");
  }
}

/**
 * Creates a text-only notification box for content warnings.
 * This updated version removes the robot mascot and supports stacking multiple notifications.
 * @param {object} ai - The JSON response from the AI.
 * @param {string} category - The category of problematic content.
 */
function createNotificationBubble(ai, category) {
  // Increment notification count for this session
  notificationCount++;
  
  // Create the notification container
  const notification = document.createElement('div');
  notification.id = `sentry-notification-${notificationCount}`;
  notification.className = 'sentry-notification';
  notification.setAttribute('role', 'alertdialog');
  notification.setAttribute('aria-labelledby', `sentry-alert-title-${notificationCount}`);
  notification.setAttribute('aria-describedby', `sentry-alert-description-${notificationCount}`);
  
  // Position based on existing notifications (stacking)
  const existingNotifications = document.querySelectorAll('.sentry-notification');
  const position = existingNotifications.length + 1;
  
  // Add position class for stacking (CSS will handle positioning)
  notification.classList.add(`sentry-notification-position-${position > 3 ? 3 : position}`);
  
  // Determine category for styling
  let categoryClass, iconSymbol;
  
  if (category.includes('scam') || category.includes('phishing')) {
    // Scam/Phishing notification style
    categoryClass = 'scam';
    iconSymbol = '🛑';
  } else if (category.includes('explicit') || category.includes('porn')) {
    // Explicit content notification style
    categoryClass = 'explicit';
    iconSymbol = '⚠️';
  } else {
    // Default notification style
    categoryClass = 'security';
    iconSymbol = '⚠️';
  }
  
  // Add category-specific border class
  notification.classList.add(`sentry-notification-border-${categoryClass}`);
  
  // Create the close button
  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.className = 'sentry-notification-close';
  closeButton.setAttribute('aria-label', 'Close notification');
  
  // Create notification header
  const notificationHeader = document.createElement('div');
  notificationHeader.className = 'sentry-notification-header';
  
  // Add warning icon
  const warningIcon = document.createElement('div');
  warningIcon.innerHTML = iconSymbol;
  warningIcon.className = 'sentry-notification-icon';
  
  // Create header title
  const headerTitle = document.createElement('div');
  headerTitle.id = `sentry-alert-title-${notificationCount}`;
  headerTitle.className = `sentry-notification-title sentry-notification-title-${categoryClass}`;
  
  // Set appropriate title based on content category
  if (category.includes('scam') || category.includes('phishing')) {
    headerTitle.textContent = 'Scam Warning';
  } else if (category.includes('explicit') || category.includes('porn')) {
    headerTitle.textContent = 'Content Warning';
  } else {
    headerTitle.textContent = 'Security Alert';
  }
  
  // Combine header elements
  notificationHeader.appendChild(warningIcon);
  notificationHeader.appendChild(headerTitle);
  
  // Add explanation text
  const explanation = document.createElement('p');
  explanation.id = `sentry-alert-description-${notificationCount}`;
  explanation.className = 'sentry-notification-message';
  
  // Customize explanation based on content type
  if (ai.summary) {
    explanation.textContent = ai.summary;
  } else if (category.includes('scam') || category.includes('phishing')) {
    explanation.textContent = `Possible scam detected! This content appears to be a phishing attempt or fraudulent offer. Be careful with any links or contact information.`;
  } else {
    explanation.textContent = `I've detected and blurred some ${category} on this page. Click on blurred content to view it at your own risk.`;
  }
  
  // Add actions
  const actions = document.createElement('div');
  actions.className = 'sentry-notification-actions';
  
  // Customize buttons based on content type
  let primaryButton, secondaryButton;
  
  if (category.includes('scam') || category.includes('phishing')) {
    // For scams, offer to block or report
    primaryButton = document.createElement('button');
    primaryButton.textContent = 'Block All';
    primaryButton.className = `sentry-notification-action-primary sentry-notification-action-primary-${categoryClass}`;
    primaryButton.setAttribute('aria-label', 'Block all suspicious content');
    
    secondaryButton = document.createElement('button');
    secondaryButton.textContent = 'View Anyway';
    secondaryButton.className = 'sentry-notification-action-secondary';
    secondaryButton.setAttribute('aria-label', 'View the content anyway');
  } else {
    // Standard reveal/block buttons for other content
    primaryButton = document.createElement('button');
    primaryButton.textContent = 'Block All';
    primaryButton.className = `sentry-notification-action-primary sentry-notification-action-primary-${categoryClass}`;
    primaryButton.setAttribute('aria-label', 'Block all sensitive content');
    
    secondaryButton = document.createElement('button');
    secondaryButton.textContent = 'Reveal All';
    secondaryButton.className = 'sentry-notification-action-secondary';
    secondaryButton.setAttribute('aria-label', 'Reveal all blurred content');
  }
  
  // Add buttons to action container
  actions.appendChild(secondaryButton);
  actions.appendChild(primaryButton);
  
  // Assemble all elements
  notification.appendChild(closeButton);
  notification.appendChild(notificationHeader);
  notification.appendChild(explanation);
  notification.appendChild(actions);
  
  // Add notification to body
  document.body.appendChild(notification);
  
  // Track this notification in our global array
  activeNotifications.push({
    id: notificationCount,
    element: notification,
    category: category
  });
  
  // Add event listeners
  closeButton.addEventListener('click', () => {
    removeNotification(notification, notificationCount);
    clearTimeout(notificationTimeout); // Clear auto-removal timeout
  });
  
  // Button event handlers based on content type
  if (category.includes('scam') || category.includes('phishing')) {
    // For scams
    primaryButton.addEventListener('click', () => {
      document.querySelectorAll('.sentry-blurred-content').forEach(el => {
        el.style.filter = el.nodeName.toLowerCase() === 'img' ? 'blur(20px)' : 'blur(8px)';
      });
    });
    
    secondaryButton.addEventListener('click', () => {
      document.querySelectorAll('.sentry-blurred-content').forEach(el => {
        el.style.filter = 'none';
      });
    });
  } else {
    // For other content
    primaryButton.addEventListener('click', () => {
      document.querySelectorAll('.sentry-blurred-content').forEach(el => {
        el.style.filter = el.nodeName.toLowerCase() === 'img' ? 'blur(10px)' : 'blur(5px)';
      });
    });
    
    secondaryButton.addEventListener('click', () => {
      document.querySelectorAll('.sentry-blurred-content').forEach(el => {
        el.style.filter = 'none';
      });
    });
  }
  
  // Set up auto-cleanup after 30 seconds
  const notificationTimeout = setTimeout(() => {
    if (notification.parentNode) {
      removeNotification(notification, notificationCount);
      console.log("Sentry: Auto-removed notification after timeout");
    }
  }, 30000);

  reportFlaggedContent(ai || {}, category, {
    notificationId: notificationCount,
    explanation: explanation.textContent
  });
  
  return notificationCount; // Return the ID for future reference
}

/**
 * Removes a notification and updates global tracking
 * @param {Element} notification - The notification DOM element to remove
 * @param {number} id - The ID of the notification
 */
function removeNotification(notification, id) {
  // Remove the DOM element
  if (notification.parentNode) {
    notification.remove();
  }
  
  // Update tracking arrays
  activeNotifications = activeNotifications.filter(item => item.id !== id);
  
  // Update global flag if no notifications remain
  if (activeNotifications.length === 0) {
    hasActiveNotification = false;
    console.log("Sentry: All notifications cleared");
  }
  
  // Reposition remaining notifications
  repositionNotifications();
}

/**
 * Repositions the stack of notifications after one is removed
 */
function repositionNotifications() {
  // Remove all position classes first
  activeNotifications.forEach((item) => {
    if (item.element) {
      item.element.classList.remove('sentry-notification-position-1');
      item.element.classList.remove('sentry-notification-position-2');
      item.element.classList.remove('sentry-notification-position-3');
    }
  });
  
  // Add appropriate position class based on index
  activeNotifications.forEach((item, index) => {
    if (item.element) {
      const position = index + 1;
      const posClass = position > 3 ? 3 : position;
      item.element.classList.add(`sentry-notification-position-${posClass}`);
    }
  });
}

/**
 * Finds text nodes in the document containing any of the specified keywords.
 * @param {Array} keywords - Keywords to search for in text nodes.
 * @returns {Array} - Array of objects with node and parent properties.
 */
function findTextNodesToBlur(keywords) {
  if (!keywords || keywords.length === 0) {
    // If no keywords, use more comprehensive defaults based on common problematic content
    keywords = [
      // Explicit content keywords
      'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'cock', 
      'rape', 'kill', 'die', 'porn', 'sex', 'xxx', 'nude', 'naked',
      'password', 'credit card', 'social security', 'explicit', 'nsfw',
      'whore', 'slut', 'bastard', 'damn', 'hell',
      
      // Scam and phishing related keywords
      'job opportunity', 'congratulations', 'received an', 'HR representative',
      'salary ranges', 'daily salary', 'contact us', 'WhatsApp Contact',
      'opportunity', 'performance', 'recruiter', 'guide you', 'step by step',
      'get started', 'wa.me', 't.me', 'click here', 'urgent', 'limited time',
      'won a prize', 'lottery', 'inheritance', 'investment opportunity',
      'make money', 'work from home', 'earn extra', 'passive income', 'easy money'
    ];
  }
  
  // Convert array to string for regex, escape special regex characters
  const escapedKeywords = keywords.map(keyword => 
    keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  
  const keywordRegex = new RegExp('\\b(' + escapedKeywords.join('|') + ')\\b', 'i');
  const result = [];
  
  // Use TreeWalker for more efficient DOM traversal
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip empty nodes and those in our exclusion list
        if (!node.textContent.trim() || 
            node.parentNode.nodeName.toLowerCase() === 'script' ||
            node.parentNode.nodeName.toLowerCase() === 'style' || 
            node.parentNode.classList?.contains('sentry-blurred-content') ||
            node.parentNode.id?.startsWith('sentry-')) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Apply whitelist to avoid false positives
        if (isWhitelistedContent(node.parentNode, node.textContent)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Accept nodes with our keywords
        if (keywordRegex.test(node.textContent)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        
        return NodeFilter.FILTER_SKIP;
      }
    },
    false
  );
  
  // Collect matched nodes
  let currentNode = walker.nextNode();
  while (currentNode) {
    // Double check that parent exists
    if (currentNode.parentNode) {
      result.push({
        node: currentNode,
        parent: currentNode.parentNode
      });
    }
    // Move to next node
    currentNode = walker.nextNode();
  }
  
  console.log(`Sentry: Found ${result.length} text nodes with sensitive content`);
  return result;
}

/**
 * Finds images that might contain problematic content.
 * Enhanced version that checks for suspicious patterns in URLs and context.
 * @returns {Array} - Array of img elements.
 */
function findImagesToBlur() {
  // More comprehensive list of suspicious words/patterns
  const suspiciousWords = [
    'explicit', 'nude', 'nsfw', 'xxx', 'adult', 'porn', 'sex', 
    'naked', '18+', 'fuck', 'ass', 'pussy', 'cock', 'dick', 
    'boob', 'tit', 'cunt', 'vagina', 'penis'
  ];
  
  // Suspicious domains list
  const suspiciousDomains = [
    'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 
    'brazzers', 'onlyfans', 'adult', 'xxx', 'nsfw', 'sex'
  ];
  
  // Create regex patterns
  const wordRegex = new RegExp('\\b(' + suspiciousWords.join('|') + ')\\b', 'i');
  const domainRegex = new RegExp('(' + suspiciousDomains.join('|') + ')', 'i');
  
  // Check the page URL - if we're on a suspicious domain, blur more aggressively
  const onSuspiciousSite = domainRegex.test(window.location.hostname);
  
  // Get all images
  const images = Array.from(document.querySelectorAll('img'));
  console.log(`Sentry: Checking ${images.length} images for suspicious content`);
  
  return images.filter(img => {
    try {
      // Skip tiny images and icons
      if (img.width < 60 || img.height < 60) return false;
      
      // Skip images we've already processed
      if (img.classList.contains('sentry-blurred-content')) return false;
      
      const alt = img.alt || '';
      const src = img.src || '';
      const width = img.width || 0;
      const height = img.height || 0;
      
      // Check for suspicious text in alt or src
      const hasSuspiciousText = wordRegex.test(alt) || wordRegex.test(src);
      
      // Check if image is from a suspicious domain
      const hasSuspiciousDomain = domainRegex.test(src);
      
      // Large images are more likely to contain problematic content
      const isLargeImage = width > 200 && height > 200;
      
      // Check aspect ratio - certain ratios common in adult content
      const aspectRatio = width / height;
      const hasSuspiciousRatio = (aspectRatio > 0.6 && aspectRatio < 0.8) || 
                                (aspectRatio > 1.2 && aspectRatio < 1.5);
      
      // For images on suspicious sites, be more aggressive with blurring
      const blurThreshold = onSuspiciousSite ? 0.5 : 0.2;
      const randomBlur = Math.random() < blurThreshold && isLargeImage;
      
      return hasSuspiciousText || hasSuspiciousDomain || 
             (isLargeImage && (hasSuspiciousRatio || randomBlur));
    } catch (err) {
      console.error("Sentry: Error checking image", err);
      return false;
    }
  });
}

// --- Main Execution ---

// Global flags to prevent duplicate notifications and track notification stacks
let isScanning = false;
let hasActiveNotification = false;
let scanTimeout = null;
let activeNotifications = []; // Track multiple notification instances
let notificationCount = 0;    // Used for stacking notifications
const BACKEND_URL = 'http://localhost:8000';
const FLAGGED_EVENTS_ENDPOINT = `${BACKEND_URL}/flagged-events`;
const SENTRY_SESSION_ID = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

// Site detection for optimized scanning
const isMessenger = window.location.hostname.includes('messenger.com') || 
                   (window.location.hostname.includes('facebook.com') && 
                    window.location.pathname.includes('/messages'));
const isSocialMedia = isMessenger || 
                     window.location.hostname.includes('twitter.com') || 
                     window.location.hostname.includes('instagram.com') ||
                     window.location.hostname.includes('facebook.com') ||
                     window.location.hostname.includes('linkedin.com');
const isSearchEngine = window.location.hostname.includes('google.com') ||
                      window.location.hostname.includes('bing.com') ||
                      window.location.hostname.includes('duckduckgo.com') ||
                      window.location.hostname.includes('search.');

// Site-specific detection preferences
const siteConfig = {
  // Social media - prioritize scam detection
  social: {
    prioritizeScamDetection: true,
    scanFrequency: 'high',
    blurIntensity: 'medium',
    keywordThreshold: 'low' // Be more sensitive to suspicious content
  },
  // Search engines - focus on adult content and scams
  search: {
    prioritizeScamDetection: false,
    scanFrequency: 'medium',
    blurIntensity: 'high',
    keywordThreshold: 'medium'
  },
  // Default for other sites
  default: {
    prioritizeScamDetection: false,
    scanFrequency: 'low',
    blurIntensity: 'medium',
    keywordThreshold: 'high'
  }
};

// Get the right config for the current site
const currentSiteConfig = isSocialMedia ? siteConfig.social : 
                         isSearchEngine ? siteConfig.search : 
                         siteConfig.default;

// Adjust scanning parameters based on site
const SCAN_DEBOUNCE_TIME = isSocialMedia ? 1000 : (isSearchEngine ? 1500 : 2000);
const SCAN_COOLDOWN_TIME = isSocialMedia ? 2000 : (isSearchEngine ? 3000 : 5000);
const MIN_TEXT_LENGTH = isSocialMedia ? 20 : (isSearchEngine ? 30 : 50);

// Apply site-specific detection sensitivity
const SCAM_DETECTION_THRESHOLD = currentSiteConfig.prioritizeScamDetection ? 4 : 5; // Lower threshold = more sensitive

function normalizeExcerpt(rawText = '') {
  if (!rawText) return '';
  return rawText.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function inferSeverityFromCategory(category = '', confidence = 50) {
  const lowered = (category || '').toLowerCase();
  if (lowered.includes('scam') || lowered.includes('phish')) return 'high';
  if (lowered.includes('explicit') || lowered.includes('violence')) {
    return confidence >= 60 ? 'high' : 'medium';
  }
  if (confidence >= 85) return 'high';
  if (confidence <= 45) return 'low';
  return 'medium';
}

async function reportFlaggedContent(ai = {}, category = 'unsafe_content', options = {}) {
  if (!FLAGGED_EVENTS_ENDPOINT || typeof fetch !== 'function') return;
  
  const normalizedCategory = category || ai.category || 'unsafe_content';
  const summary = ai.summary || ai.title || ai.reason || `Potential ${normalizedCategory} content detected`;
  const severityLabel = (ai.severity || inferSeverityFromCategory(normalizedCategory, ai.confidence || 50)).toString().toLowerCase();
  const contentExcerpt = normalizeExcerpt(options.explanation || ai.reason || ai.summary || summary);
  
  const payload = {
    category: normalizedCategory,
    summary,
    reason: ai.reason || summary,
    what_to_do: ai.what_to_do || 'Proceed with caution.',
    page_url: window.location.href,
    source: window.location.hostname,
    content_excerpt: contentExcerpt,
    severity: severityLabel,
    detected_at: new Date().toISOString(),
    user_id: options.userId || null,
    metadata: {
      sessionId: SENTRY_SESSION_ID,
      notificationId: options.notificationId || null,
      confidence: ai.confidence ?? null
    }
  };
  
  if (payload.metadata) {
    Object.keys(payload.metadata).forEach((key) => {
      if (payload.metadata[key] === null || payload.metadata[key] === undefined) {
        delete payload.metadata[key];
      }
    });
    if (Object.keys(payload.metadata).length === 0) {
      delete payload.metadata;
    }
  }
  
  try {
    await fetch(FLAGGED_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('Sentry: Unable to sync flagged notification', error);
  }
}

// Track consecutive skipped scans to avoid log spam
let consecutiveSkippedScans = 0;
let lastMessageTime = 0;
let lastScanTime = 0;
let significantChanges = false;

// Create a more controlled debounced scan that respects our flags
const debouncedScan = debounce(() => {
  const currentTime = Date.now();
  
  // Always allow a scan if it's been more than 10 seconds since the last one
  const forceTimedScan = currentTime - lastScanTime > 10000;
  
  // Check if scan or notification is already active
  if ((!isScanning && !hasActiveNotification && !scanTimeout) || 
      (forceTimedScan && significantChanges)) {
    
    // Reset counters when we actually run a scan
    consecutiveSkippedScans = 0;
    significantChanges = false;
    lastScanTime = currentTime;
    isScanning = true;
    
    // Run the scan
    scanPageWithSentryAI().finally(() => {
      isScanning = false;
      // Set a cooldown period before allowing another scan
      scanTimeout = setTimeout(() => {
        scanTimeout = null;
      }, SCAN_COOLDOWN_TIME);
    });
  } else {
    // Only log skipped scans occasionally to avoid console spam
    consecutiveSkippedScans++;
    
    // Log only on the 1st, 5th, and every 10th skipped scan, or after 30 seconds
    if (consecutiveSkippedScans === 1 || 
        consecutiveSkippedScans === 5 || 
        consecutiveSkippedScans % 10 === 0 ||
        currentTime - lastMessageTime > 30000) {
      
      console.log(`Sentry: Scan already in progress or notification active. Skipping scan. (${consecutiveSkippedScans} consecutive skips)`);
      lastMessageTime = currentTime;
    }
  }
}, SCAN_DEBOUNCE_TIME);

// 2. Set up the MutationObserver with smarter change detection
const observer = new MutationObserver((mutations) => {
  // For Facebook Messenger, use a specialized approach
  if (isMessenger) {
    handleMessengerMutations(mutations);
    return;
  }
  
  // Default handling for other sites
  // Ignore mutations that are likely caused by our own elements
  const relevantChanges = mutations.filter(mutation => {
    // Skip our own elements
    if (mutation.target.id?.startsWith('sentry-') || 
        mutation.target.classList?.contains('sentry-blurred-content')) {
      return false;
    }
    
    // Skip style changes and attribute modifications
    if (mutation.type === 'attributes') {
      return false;
    }
    
    // Skip text changes in our elements
    if (mutation.type === 'characterData' && 
        (mutation.target.parentNode?.id?.startsWith('sentry-') || 
         mutation.target.parentNode?.classList?.contains('sentry-blurred-content'))) {
      return false;
    }
    
    return true;
  });
  
  if (relevantChanges.length > 0 && !scanTimeout) {
    console.log("Sentry: Detected relevant page change, queueing scan.");
    debouncedScan();
  }
});

/**
 * Special handler for Facebook Messenger mutations
 * Uses a more targeted approach to avoid excessive scanning
 * @param {MutationRecord[]} mutations - The array of mutations observed
 */
function handleMessengerMutations(mutations) {
  // Skip if we're already scanning or in cooldown
  if (isScanning || scanTimeout) {
    return;
  }

  // For Messenger, we care most about:
  // 1. New message containers added
  // 2. Significant text content changes
  
  let shouldScan = false;
  let foundSignificantChange = false;
  
  // Look for message containers that might be scams
  const checkForScamIndicators = (node) => {
    // Quick check for obvious scam indicators in any new content
    if (node.innerText && /job opportunity|congratulations|salary|wa\.me|contact us|whatsapp/i.test(node.innerText)) {
      console.log("Sentry: Potential scam content detected in new message, prioritizing scan");
      shouldScan = true;
      foundSignificantChange = true;
      return true;
    }
    return false;
  };
  
  for (const mutation of mutations) {
    // Skip our own elements
    if (mutation.target.id?.startsWith('sentry-') || 
        mutation.target.classList?.contains('sentry-blurred-content') ||
        mutation.target.closest('[id^="sentry-"]')) {
      continue;
    }
    
    // Direct check on mutation target for scam indicators
    if (mutation.target.nodeType === Node.ELEMENT_NODE && checkForScamIndicators(mutation.target)) {
      break;
    }
    
    // Check for message bubbles being added
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Look for added messages or message containers
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // First check for scam indicators
          if (checkForScamIndicators(node)) {
            break;
          }
          
          // Check if this is a message container or has message content
          if (node.classList?.contains('x78zum5') || // Message container class
              node.classList?.contains('xcrwhx7') || // Message bubble class
              node.getAttribute('role') === 'row' || // Message row
              node.querySelector('[role="row"]') ||  // Contains message rows
              node.innerText?.length > 20) {         // Has substantial text
            
            shouldScan = true;
            foundSignificantChange = true;
            break;
          }
        }
      }
    }
    
    // If we already decided to scan, no need to check more mutations
    if (shouldScan) break;
  }
  
  // If we found changes that warrant scanning
  if (shouldScan) {
    // Set flag for significant changes - this affects scan priority
    significantChanges = foundSignificantChange;
    console.log("Sentry: Detected relevant Messenger content change, queueing scan.");
    debouncedScan();
  }
}

// Track when notifications are created and removed
document.addEventListener('DOMNodeInserted', (event) => {
  if (event.target.classList && event.target.classList.contains('sentry-notification')) {
    hasActiveNotification = true;
  }
});

document.addEventListener('DOMNodeRemoved', (event) => {
  if (event.target.classList && event.target.classList.contains('sentry-notification')) {
    // Only update flag if there are no other active notifications
    const remainingNotifications = document.querySelectorAll('.sentry-notification');
    if (remainingNotifications.length === 0) {
      hasActiveNotification = false;
      // Allow a new scan after notification is closed
      console.log("Sentry: All notifications closed, will allow new scans after cooldown.");
    }
  }
});

// 3. Start observing the entire document body for added nodes and subtree changes.
function startObserver() {
    observer.observe(document.body, {
        childList: true, // Watch for direct children being added or removed
        subtree: true,   // Watch all descendants of the body
        characterData: true // Watch for text changes
    });
    console.log("Sentry: Real-time content observer is now active.");
}

// 4. Run an initial scan on page load, and then start the observer.
window.addEventListener('load', () => {
    // Remove any existing notifications first (in case of page refresh)
    const existingNotifications = document.querySelectorAll('.sentry-notification');
    existingNotifications.forEach(notification => notification.remove());
    
    // Reset notification tracking
    activeNotifications = [];
    hasActiveNotification = false;
    
    // Initialize on site type
    console.log(`Sentry: Initializing on ${isMessenger ? 'Facebook Messenger' : 'regular website'}`);
    
    scanPageWithSentryAI(); // Initial scan for static content
    startObserver();        // Start watching for dynamic changes
});

/**
 * Special handler for Facebook Messenger scam detection
 * Directly blurs suspicious message containers
 * @param {string} contentToScan - The content that triggered scanning
 * @returns {object} - Result object with scamDetected flag
 */
function handleMessengerScamDetection() {
  let result = {
    scamDetected: false
  };
  
  // Skip if we're not in Messenger
  if (!isMessenger) return result;
  
  // Look for common Messenger message containers
  const messageContainers = document.querySelectorAll(
    // Typical Messenger message container selectors
    '[role="row"], ' +  
    '.x78zum5, ' +      // Message container
    '.xcrwhx7, ' +      // Message bubble
    '[data-testid="message-container"], ' + 
    '[aria-label*="message from"], ' + 
    '[data-scope="messages_table"] > div'
  );
  
  // No containers found
  if (messageContainers.length === 0) return result;
  
  console.log(`Sentry: Checking ${messageContainers.length} Messenger message containers for scams`);
  
  // Define strong scam indicators for Messenger
  const strongScamIndicators = [
    /job opportunity/i,
    /congratulations.*received/i, 
    /HR representative/i,
    /salary range/i, 
    /wa\.me\//i,
    /WhatsApp Contact/i,
    /depending on your performance/i
  ];
  
  // Define moderate scam indicators
  const moderateScamIndicators = [
    /opportunity/i,
    /congratulations/i,
    /received an/i,
    /contact us/i,
    /guide you/i,
    /step by step/i,
    /recruiter/i
  ];
  
  let scamMessageContainers = [];
  
  // Check each container for scam content
  messageContainers.forEach(container => {
    // Skip already blurred containers
    if (container.classList.contains('sentry-blurred-content')) return;
    
    // Get the text content of this specific container
    const text = container.innerText || '';
    if (text.length < 20) return; // Skip short messages
    
    // Score this container
    let containerScamScore = 0;
    
    // Check for strong indicators (higher weight)
    strongScamIndicators.forEach(regex => {
      if (regex.test(text)) containerScamScore += 4;
    });
    
    // Check for moderate indicators
    moderateScamIndicators.forEach(regex => {
      if (regex.test(text)) containerScamScore += 2;
    });
    
    // Check for common patterns
    if (/job|opportunity|position/i.test(text) && /salary|income|earn/i.test(text)) {
      containerScamScore += 3;
    }
    
    // Check for suspicious URLs in this container specifically
    const containerUrls = text.match(/(https?:\/\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+)/gi) || [];
    if (containerUrls.length > 0) containerScamScore += 2;
    
    // If this container has suspicious content, blur it
    if (containerScamScore >= 4) {
      scamMessageContainers.push({
        element: container,
        score: containerScamScore
      });
    }
  });
  
  // If we found suspicious containers, blur them and create notification
  if (scamMessageContainers.length > 0) {
    console.log(`Sentry: Found ${scamMessageContainers.length} suspicious message containers in Messenger`);
    
    // Blur each container
    scamMessageContainers.forEach(item => {
      const container = item.element;
      
      // Apply blur effect
      container.classList.add('sentry-blurred-content');
      container.style.cssText = `
        filter: blur(8px);
        position: relative;
        cursor: help;
        transition: filter 0.3s ease;
      `;
      
      // Add click handler to toggle blur
      container.addEventListener('click', (e) => {
        e.stopPropagation();
        container.style.filter = container.style.filter === 'none' ? 'blur(8px)' : 'none';
      });
    });
    
    // Create a notification for the scam
    const mockResponse = {
      detected: true,
      suggested_action: "block",
      category: "potential scam",
      summary: `Detected potential scam message on Facebook Messenger: suspicious contact information, financial promises. Be careful with links and personal information.`,
      bad_words: ["scam", "phishing", "suspicious"]
    };
    
    createNotificationBubble(mockResponse, "potential scam");
    hasActiveNotification = true;
    result.scamDetected = true;
  }
  
  return result;
}

// Clean up when page is unloaded
window.addEventListener('beforeunload', () => {
    // Stop observing
    if (observer) {
        observer.disconnect();
    }
    
    // Clear any pending timeouts
    if (scanTimeout) {
        clearTimeout(scanTimeout);
    }
});