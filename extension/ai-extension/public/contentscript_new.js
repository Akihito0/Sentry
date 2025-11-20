// Sentry Content Script: Scans page content and blocks inappropriate material
// CSS files are loaded via the manifest.json content_scripts section

// ⚠️ CRITICAL: DO NOT SCAN OUR OWN DASHBOARD OR LOCALHOST DEV SITES
// This prevents the extension from flagging content on the Sentry dashboard itself
if (window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.port === '5173' || 
    window.location.port === '5174' ||
    window.location.port === '5175') {
  console.log("Sentry: Content scanning disabled on localhost dashboard");
  // Stop execution immediately - don't run any scanning code
  throw new Error("Sentry content script intentionally disabled on localhost");
}

/**
 * Debounce function to prevent excessive function calls
 * @param {Function} func The function to debounce
 * @param {number} delay The debounce delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

// Configuration
const BACKEND_URL = 'http://localhost:8000';
const isInstagram = window.location.hostname.includes('instagram.com');
const isFacebook = window.location.hostname.includes('facebook.com');
const SCAN_DEBOUNCE_TIME = (isInstagram || isFacebook) ? 2000 : 1200; // MUCH longer for social media (DOM changes constantly)
const SCAN_COOLDOWN_TIME = (isInstagram || isFacebook) ? 5000 : 4000; // Longer cooldown for social media
const MIN_CONTENT_LENGTH = 5; // Very low to catch short profanity like "fuck", "shit"

// Global state
let isScanning = false;
let lastScanTime = 0;
let scanTimeout = null;
let blockedElements = new Map(); // Store blocked elements with their AI responses
let contentCache = new Map(); // Cache AI responses to avoid re-scanning
let scannedElements = new WeakSet(); // Track which elements we've already scanned
let intersectionObserver = null; // Observer to re-apply blur when scrolling back
const SENTRY_SESSION_ID = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const FLAGGED_EVENTS_ENDPOINT = `${BACKEND_URL}/flagged-events`;

function normalizeExcerpt(rawText = "") {
  if (!rawText) return "";
  return rawText.replace(/\s+/g, " ").trim().slice(0, 280);
}

function inferSeverityFromCategory(category = "", confidence = 50) {
  const lowered = (category || "").toLowerCase();
  if (lowered.includes("scam") || lowered.includes("phish")) return "high";
  if (lowered.includes("explicit") || lowered.includes("violence")) {
    return confidence >= 60 ? "high" : "medium";
  }
  if (confidence >= 85) return "high";
  if (confidence <= 45) return "low";
  return "medium";
}

async function reportFlaggedContentToBackend(aiResponse = {}, options = {}) {
  if (!FLAGGED_EVENTS_ENDPOINT || typeof fetch !== "function") return;

  const summary =
    aiResponse.title ||
    aiResponse.summary ||
    aiResponse.reason ||
    "Potentially unsafe content blocked";

  const payload = {
    category: aiResponse.category || options.category || "unsafe_content",
    summary,
    reason: aiResponse.reason || aiResponse.summary || summary,
    what_to_do: aiResponse.what_to_do || "Proceed with caution.",
    page_url: window.location.href,
    source: window.location.hostname || options.source || null,
    content_excerpt: normalizeExcerpt(options.contentExcerpt || summary),
    severity: (options.severity ||
      inferSeverityFromCategory(aiResponse.category, aiResponse.confidence || 50)
    ).toLowerCase(),
    detected_at: new Date().toISOString(),
    user_id: options.userId || null,
    metadata: {
      sessionId: SENTRY_SESSION_ID,
      elementTag: options.elementTag || null,
      pageTitle: document.title || null,
      confidence: aiResponse.confidence ?? null,
    },
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("Sentry: Unable to sync flagged content report", error);
  }
}

/**
 * Analyzes image content using Google Vision API (via backend)
 * @param {HTMLImageElement} imgElement The image element to analyze
 * @param {string} imageUrl The URL of the image
 * @param {string} context Surrounding text context
 * @returns {Promise<Object>} AI response object
 */
async function analyzeImageWithVisionAPI(imgElement, imageUrl, context) {
  try {
    console.log(`Sentry: Analyzing image with Vision API: ${imageUrl.substring(0, 50)}...`);
    
    const response = await fetch(`${BACKEND_URL}/analyze-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        context: context
      })
    });
    
    if (!response.ok) {
      console.error(`Sentry: Vision API error: ${response.status}`);
      // Return safe default on error
      return {
        safe: true,
        title: "Analysis Error",
        reason: "We couldn't analyze this image.",
        what_to_do: "Proceed with caution.",
        category: "error",
        confidence: 30
      };
    }
    
    const result = await response.json();
    console.log(`Sentry: Vision API result for image - Safe: ${result.safe}, Category: ${result.category}`);
    return result;
    
  } catch (error) {
    console.error("Sentry: Error calling Vision API:", error);
    // Return safe default on error
    return {
      safe: true,
      title: "Analysis Error",
      reason: "We couldn't analyze this image.",
      what_to_do: "Proceed with caution.",
      category: "error",
      confidence: 30
    };
  }
}

/**
 * PHASE 3: Instant image URL/domain blocking - blocks obvious images without Vision API
 * Checks domain, URL patterns, and alt text for instant decisions
 * @param {HTMLImageElement} imgElement - Image element to check
 * @param {string} imgSrc - Image source URL
 * @param {string} context - Surrounding text context
 * @returns {Object|null} - Block response if should be blocked, null if unclear
 */
function instantImageBlock(imgElement, imgSrc, context) {
  // 1. KNOWN PORN DOMAINS (highest confidence)
  const pornDomains = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com', 'youporn.com',
    'xhamster.com', 'tube8.com', 'spankbang.com', 'txxx.com', 'eporner.com',
    'porn.com', 'sex.com', 'xxx.com', 'hentai.', 'rule34.'
  ];
  
  for (const domain of pornDomains) {
    if (imgSrc.toLowerCase().includes(domain)) {
      console.log(`⚡ Sentry: INSTANT IMAGE BLOCK - Known porn domain: ${domain}`);
      return {
        safe: false,
        title: "Explicit Content Blocked",
        reason: "This image is from an adult content website and has been automatically blocked.",
        what_to_do: "Please navigate away from this content.",
        category: "explicit_content",
        confidence: 99
      };
    }
  }
  
  // 2. EXPLICIT URL PATTERNS
  const explicitUrlPattern = /\b(porn|xxx|nude|naked|sex|nsfw|explicit|adult|erotic|hentai|rule34|lewds?|onlyfans|patreon.*nsfw)\b/i;
  if (explicitUrlPattern.test(imgSrc)) {
    console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Explicit URL pattern");
    return {
      safe: false,
      title: "Inappropriate Image Blocked",
      reason: "The image URL contains explicit keywords and has been blocked.",
      what_to_do: "This content is not appropriate for viewing.",
      category: "explicit_content",
      confidence: 95
    };
  }
  
  // 3. SUSPICIOUS FILE NAMES
  const suspiciousFilePattern = /\b(nude|naked|sexy|porn|xxx|boobs|tits|ass|pussy|dick|cock|fuck|sex)\b.*\.(jpg|jpeg|png|gif|webp)/i;
  if (suspiciousFilePattern.test(imgSrc)) {
    console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Suspicious filename");
    return {
      safe: false,
      title: "Suspicious Image Blocked",
      reason: "The image filename suggests explicit content.",
      what_to_do: "Use caution when viewing this content.",
      category: "explicit_content",
      confidence: 85
    };
  }
  
  // 4. ALT TEXT WITH EXPLICIT KEYWORDS
  const altText = (imgElement.alt || '').toLowerCase();
  const explicitAltPattern = /\b(nude|naked|porn|xxx|sex|explicit|nsfw|adult content|18\+)\b/i;
  if (explicitAltPattern.test(altText)) {
    console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Explicit alt text");
    return {
      safe: false,
      title: "Inappropriate Image Blocked",
      reason: "The image description contains explicit keywords.",
      what_to_do: "This content has been flagged as inappropriate.",
      category: "explicit_content",
      confidence: 90
    };
  }
  
  // 5. CONTEXT HAS EXPLICIT KEYWORDS (combined with image)
  const combinedText = `${altText} ${context}`.toLowerCase();
  const explicitContextPattern = /\b(view my nudes|send nudes|naked pics?|dick pics?|porn link|sex video|adult video|xxx video|explicit content|check out.*naked|check out.*porn)\b/i;
  if (explicitContextPattern.test(combinedText)) {
    console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Explicit context with image");
    return {
      safe: false,
      title: "Suspicious Content Blocked",
      reason: "The image context strongly suggests explicit content.",
      what_to_do: "Please be cautious with this content.",
      category: "explicit_content",
      confidence: 85
    };
  }
  
  // 6. SOCIAL MEDIA CDN IMAGES - Skip Vision API but check context
  const isInstagramCDN = imgSrc.includes('fbcdn.net') || imgSrc.includes('cdninstagram.com');
  const isFacebookCDN = imgSrc.includes('fbcdn.net') || imgSrc.includes('facebook.com/rsrc.php');
  
  if (isInstagramCDN || isFacebookCDN) {
    // Check if context has profanity/explicit keywords
    const profanityInContext = /\b(fuck|shit|bitch|pussy|cock|dick|sexy|hot af|damn|ass)\b/i.test(combinedText);
    
    if (profanityInContext) {
      console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Social media image with explicit context");
      return {
        safe: false,
        title: "Potentially Inappropriate Content",
        reason: "This social media image has explicit language in its context.",
        what_to_do: "Click to view if you trust the source.",
        category: "explicit_content",
        confidence: 75
      };
    }
    
    // For social media CDN, we can't analyze with Vision API - mark as safe to skip
    // (Unless you want to be very strict and block all social media images)
    return { safe: true, skipVisionAPI: true };
  }
  
  // No instant decision - needs Vision API
  return null;
}

/**
 * PHASE 1: Instant local blocking - blocks obvious content without API
 * This runs BEFORE any API calls for maximum speed
 * @param {HTMLElement} element - Element to check
 * @param {string} contentText - Text content to analyze
 * @returns {Object|null} - Block response if should be blocked, null if unclear
 */
function instantLocalBlock(element, contentText) {
  const content = contentText.toLowerCase().trim();
  
  // Skip if too short
  if (content.length < 5) return null;
  
  // 1. PROFANITY CHECK (most common)
  const profanityPattern = /\b(fuck|fucking|fucker|fucked|motherfucker|mother fucker|shit|bitch|ass|asshole|bastard|damn|hell|cunt|whore|slut|dick|pussy|cock|cum|orgasm|putang ina|putangina|gago|bobo|tanga|ulol|tarantado|leche|puta|tangina|pokpok|pakshet|pakyu|hayop|siraulo|shunga|buwisit)\b/i;
  
  if (profanityPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Profanity detected (0ms)");
    return {
      safe: false,
      title: "Inappropriate Language Detected",
      reason: "This message contains offensive language or profanity that may be hurtful or inappropriate.",
      what_to_do: "Consider the impact of such language. Click to view if you choose to proceed.",
      category: "profanity",
      confidence: 95
    };
  }
  
  // 2. RACIAL SLURS (highest priority)
  const racialSlurPattern = /\b(nigger|nigga|chink|spic|wetback|kike|raghead|gook|beaner)\b/i;
  
  if (racialSlurPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Racial slur detected (0ms)");
    return {
      safe: false,
      title: "Hate Speech Detected",
      reason: "This content contains racial slurs or hate speech that is deeply offensive and harmful.",
      what_to_do: "This type of content violates community standards. Consider reporting it.",
      category: "hate_speech",
      confidence: 99
    };
  }
  
  // 3. EXPLICIT SEXUAL CONTENT
  const explicitSexPattern = /\b(porn|pornhub|xvideos|xnxx|xxx|nude|naked|sex video|adult content|hardcore|masturbat|blowjob|handjob|anal sex|erotic|nsfw|18\+)\b/i;
  
  if (explicitSexPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Explicit sexual content (0ms)");
    return {
      safe: false,
      title: "Adult Content Detected",
      reason: "This content contains or references explicit adult material that is not appropriate for general viewing.",
      what_to_do: "Please navigate away from this content. Click to view if you're certain you want to proceed.",
      category: "explicit_content",
      confidence: 95
    };
  }
  
  // 4. SUICIDE/SELF-HARM (critical priority)
  const suicidePattern = /\b(suicide|kill myself|kill yourself|self harm|self-harm|cut myself|end my life|want to die|better off dead|hang myself|overdose|slit wrist|jump off|commit suicide|suicidal thought)\b/i;
  
  if (suicidePattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Suicide/self-harm content (0ms)");
    return {
      safe: false,
      title: "Sensitive Content Warning",
      reason: "This content discusses self-harm or suicide. If you or someone you know is struggling, please reach out for help.",
      what_to_do: "National Suicide Prevention Lifeline: 988 (US) or find local resources. Click only if you feel emotionally prepared.",
      category: "self_harm",
      confidence: 99
    };
  }
  
  // 5. SCAM/PHISHING PATTERNS
  const scamPattern = /\b(congratulations.*won|claim your prize|urgent.*act now|click here.*whatsapp|wa\.me|telegram.*money|earn \$\d+|get rich quick|investment opportunity.*guaranteed|free money|work from home.*\$\d+)\b/i;
  
  if (scamPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Scam/phishing detected (0ms)");
    return {
      safe: false,
      title: "Potential Scam Detected",
      reason: "This content matches patterns commonly used in scams or phishing attempts.",
      what_to_do: "Do not share personal information or send money. Report this content if it's suspicious.",
      category: "scam",
      confidence: 85
    };
  }
  
  // 6. KNOWN EXPLICIT DOMAINS (for images)
  if (element.tagName === 'IMG') {
    const imgSrc = element.src || '';
    const explicitDomainPattern = /(pornhub|xvideos|xnxx|redtube|youporn|porn|xxx|nude|naked|sex|nsfw|explicit|adult|erotic)/i;
    
    if (explicitDomainPattern.test(imgSrc)) {
      console.log("⚡ Sentry: INSTANT BLOCK - Explicit domain in image URL (0ms)");
      return {
        safe: false,
        title: "Inappropriate Image Blocked",
        reason: "This image appears to be from an adult or explicit website.",
        what_to_do: "Please navigate away from this content.",
        category: "explicit_content",
        confidence: 99
      };
    }
  }
  
  // No instant block needed - content is unclear, requires AI analysis
  return null;
}

/**
 * Main scanning function that analyzes page content using GEMINI AI
 * Now with caching and incremental scanning
 * @returns {Promise<void>}
 */
async function scanPageContent() {
  const currentTime = Date.now();
  
  // Prevent scanning if already in progress or within cooldown
  if (isScanning || (currentTime - lastScanTime < SCAN_COOLDOWN_TIME)) {
    console.log("Sentry: Scan skipped (in progress or cooldown)");
    return;
  }

  // Get individual content elements to scan incrementally
  const elementsToScan = getContentElements();
  
  if (elementsToScan.length === 0) {
    console.log("Sentry: No new content to scan");
    return;
  }

  isScanning = true;
  lastScanTime = currentTime;
  console.log(`Sentry: Scanning ${elementsToScan.length} content elements...`);
  
  // Performance tracking
  let instantBlockCount = 0;
  let instantImageBlockCount = 0;
  let visionAPICallCount = 0;
  let apiCallCount = 0;
  const scanStartTime = performance.now();
  
  // Scam/phishing keywords with better detection (used for container targeting)
  const scamKeywords = /\b(job opportunity|congratulations|you'?ve? won|claim your prize|urgent|act now|limited time|click here|whatsapp|wa\.me|telegram|t\.me|contact us|work from home|earn \$|salary range|daily income|free money|get rich|investment opportunity)\b/i;

  try {
    // DISABLED: Real-time text wrapping causes stacking issues on social media
    // Instead, we rely on instant blocking which handles profanity detection
    // in the element-by-element scan below
    
    // ONLY wrap text on non-social media sites
    if (!isInstagram && !isFacebook) {
      const profanityKeywords = [
        'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker',
        'shit', 'bitch', 'ass', 'asshole', 'bastard', 'damn',
        'cunt', 'whore', 'slut', 'nigger', 'nigga', 'dick', 'pussy',
        'putangina', 'putang ina', 'gago', 'bobo', 'tanga', 'ulol',
        'tarantado', 'leche', 'puta', 'tangina', 'hayop', 'shunga'
      ];
      
      const wrappedTextNodes = findAndWrapTextNodes(profanityKeywords);
      
      // Block wrapped text nodes immediately
      wrappedTextNodes.forEach(wrapper => {
        const profanityResponse = {
          safe: false,
          title: "Inappropriate Language Detected",
          reason: "This message contains offensive language or profanity that may be hurtful or inappropriate.",
          what_to_do: "Consider the impact of such language. Click to view if you choose to proceed.",
          category: "profanity",
          confidence: 95
        };
        blockSpecificElement(wrapper, profanityResponse);
        instantBlockCount++;
      });
    }
    
    // SECOND: Find and block suspicious images (like contentscript.js)
    const suspiciousImages = findSuspiciousImages();
    suspiciousImages.forEach(img => {
      const imageResponse = {
        safe: false,
        title: "Potentially Inappropriate Image",
        reason: "This image has been flagged based on its description or source. It may contain inappropriate content.",
        what_to_do: "Click to view if you trust the source.",
        category: "explicit_content",
        confidence: 75
      };
      blockSpecificElement(img, imageResponse);
    });
    
    // THIRD: Batch process remaining elements that need AI analysis
    const elementsNeedingAI = [];
    const elementsMetadata = [];
    
    for (const element of elementsToScan) {
      // Skip if already scanned
      if (scannedElements.has(element)) continue;
      
      // Skip if already wrapped/blocked by instant blocking
      if (element.classList?.contains('sentry-text-wrapper') ||
          element.classList?.contains('sentry-blocked-content')) {
        scannedElements.add(element);
        continue;
      }
      
      // CRITICAL: Never scan Sentry's own UI elements
      if (element.closest('.sentry-confirmation-overlay') ||
          element.closest('.sentry-confirmation-popup') ||
          element.classList.contains('sentry-confirmation-overlay') ||
          element.classList.contains('sentry-confirmation-popup') ||
          element.id?.startsWith('sentry-') ||
          Array.from(element.classList || []).some(cls => cls.startsWith('sentry-'))) {
        scannedElements.add(element);
        continue;
      }
      
      // Handle images specially - check alt text, URL, and surrounding text
      let contentToScan = "";
      
      if (element.tagName === 'IMG') {
        const altText = element.alt || "";
        const imgSrc = element.src || "";
        const imgTitle = element.title || "";
        
        // Get surrounding text context (parent element or nearby text)
        const parentText = element.parentElement?.innerText?.substring(0, 200) || "";
        const nearbyText = element.closest('div, article, section')?.innerText?.substring(0, 200) || "";
        
        // Special handling for Instagram - look for more context
        let instagramContext = "";
        if (window.location.hostname.includes('instagram.com')) {
          // Instagram-specific selectors for captions and descriptions
          const caption = element.closest('article')?.querySelector('h1')?.innerText || "";
          const description = element.closest('article')?.querySelector('[class*="Caption"]')?.innerText || "";
          instagramContext = `${caption} ${description}`.substring(0, 300);
          console.log("Sentry: Instagram image detected, enhanced context:", instagramContext.substring(0, 100));
        }
        
        // Combine all image-related text
        contentToScan = `${altText} ${imgTitle} ${parentText} ${nearbyText} ${instagramContext}`.trim();
        
        // Check cache first
        const imageHash = simpleHash(imgSrc);
        if (contentCache.has(imageHash)) {
          const cachedResult = contentCache.get(imageHash);
          if (!cachedResult.safe) {
            blockSpecificElement(element, cachedResult);
          }
          scannedElements.add(element);
          continue;
        }
        
        // PHASE 3: Try instant image blocking first (⚡ FASTEST - 0ms)
        const instantImageResult = instantImageBlock(element, imgSrc, contentToScan);
        
        if (instantImageResult) {
          // Check if it's a "skip Vision API" signal
          if (instantImageResult.skipVisionAPI) {
            // Social media CDN image with no red flags - skip analysis
            scannedElements.add(element);
            continue;
          }
          
          // Image blocked instantly!
          instantBlockCount++;
          instantImageBlockCount++;
          blockSpecificElement(element, instantImageResult);
          scannedElements.add(element);
          contentCache.set(imageHash, instantImageResult);
          continue;
        }
        
        // Send image to Vision API for deep analysis (async)
        visionAPICallCount++;
        console.log(`Sentry: Sending image to Vision API for analysis... (${visionAPICallCount} images)`);
        
        analyzeImageWithVisionAPI(element, imgSrc, contentToScan).then(result => {
          // Only block if result is confidently unsafe (not errors)
          if (!result.safe && result.category !== 'error' && result.confidence > 50) {
            console.log(`Sentry: Vision API found unsafe image - blocking! Category: ${result.category}`);
            blockSpecificElement(element, result);
            contentCache.set(imageHash, result);
          } else if (result.category === 'error') {
            // If Vision API failed, try instant image block as fallback
            console.log("Sentry: Vision API failed, trying instant image analysis...");
            const fallbackResult = instantImageBlock(element, imgSrc, contentToScan);
            
            if (fallbackResult && !fallbackResult.skipVisionAPI) {
              blockSpecificElement(element, fallbackResult);
              contentCache.set(imageHash, fallbackResult);
            }
          }
          scannedElements.add(element);
        }).catch(err => {
          console.error("Sentry: Error analyzing image:", err);
          scannedElements.add(element);
        });
        
        // Mark as scanned to avoid re-checking while API call is in progress
        scannedElements.add(element);
        continue;
      } else {
        contentToScan = element.innerText || element.textContent || "";
      }
      
      if (!contentToScan || contentToScan.trim().length < MIN_CONTENT_LENGTH) continue;
      
      // Debug: Log text content being scanned (first 50 chars)
      if (contentToScan.trim().length > 0 && contentToScan.trim().length < 100) {
        console.log(`Sentry: Scanning text: "${contentToScan.trim().substring(0, 50)}..."`);
      }
      
      // Skip if content is just a date/time (common false positive)
      const dateTimePattern = /^[\d\s:/\-,]+$/;
      if (dateTimePattern.test(contentToScan.trim()) && contentToScan.trim().length < 50) {
        scannedElements.add(element);
        continue;
      }
      
      // PHASE 1: Try instant local blocking first (⚡ FASTEST - 0ms)
      const instantBlockResult = instantLocalBlock(element, contentToScan);
      if (instantBlockResult) {
        // Content blocked instantly without API call!
        instantBlockCount++;
        blockSpecificElement(element, instantBlockResult);
        scannedElements.add(element);
        
        // Cache this result
        const contentHash = simpleHash(contentToScan.trim());
        contentCache.set(contentHash, instantBlockResult);
        continue; // Skip API call completely
      }
      
      // PHASE 2: If instant blocking didn't match, add to batch for AI analysis
      const contentHash = simpleHash(contentToScan.trim());
      
      // Check cache first
      if (contentCache.has(contentHash)) {
        const cachedResponse = contentCache.get(contentHash);
        if (cachedResponse.safe === false) {
          blockSpecificElement(element, cachedResponse);
        }
        scannedElements.add(element);
        continue;
      }
      
      // Add to batch for AI processing
      elementsNeedingAI.push(element);
      elementsMetadata.push({
        content: contentToScan.substring(0, 1000), // Limit to 1000 chars per element
        contentHash: contentHash
      });
      

      
      // Check for alcohol/scam - these go through instant block now
      // (Keeping just for scam container targeting logic)
      if (scamKeywords.test(contentToScan)) {
        let targetElement = element;
        if (element.tagName === 'A') {
          const messageContainer = element.closest('.message, .chat-message, .post, [role="article"], div[class*="message"], p');
          if (messageContainer) targetElement = messageContainer;
        }
        
        const scamBlockResponse = {
          safe: false,
          title: "Suspicious Offer Detected",
          reason: "This message shows signs of being a scam or phishing attempt.",
          what_to_do: "Do not click any links or share personal information.",
          category: "scam",
          confidence: 90
        };
        
        instantBlockCount++;
        blockSpecificElement(targetElement, scamBlockResponse);
        scannedElements.add(element);
        scannedElements.add(targetElement);
        continue;
      }
    }
    
    // PHASE 2: BATCH API PROCESSING (10x faster!)
    if (elementsNeedingAI.length > 0) {
      console.log(`⚡ Sentry: Sending ${elementsNeedingAI.length} elements to AI in ONE batch call...`);
      
      try {
        const batchStartTime = performance.now();
        
        // Extract just the content strings
        const contents = elementsMetadata.map(meta => meta.content);
        
        // Make ONE API call for all elements
        const response = await fetch(`${BACKEND_URL}/analyze-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents })
        });
        
        const batchResponse = await response.json();
        const results = batchResponse.results || [];
        
        const batchDuration = (performance.now() - batchStartTime).toFixed(2);
        console.log(`⚡ Batch API completed in ${batchDuration}ms for ${results.length} elements!`);
        
        // Process results and block unsafe elements
        for (let i = 0; i < elementsNeedingAI.length && i < results.length; i++) {
          const element = elementsNeedingAI[i];
          const metadata = elementsMetadata[i];
          const aiResponse = results[i];
          
          // Cache the response
          contentCache.set(metadata.contentHash, aiResponse);
          
          // Mark as scanned
          scannedElements.add(element);
          
          // Block if unsafe
          if (aiResponse.safe === false) {
            console.warn(`Sentry: AI flagged content ${i+1} as unsafe:`, aiResponse.title);
            blockSpecificElement(element, aiResponse);
          }
        }
        
        apiCallCount = 1; // Only 1 API call for everything!
        
      } catch (err) {
        console.error('Sentry: Batch API failed:', err);
        // Mark all as scanned anyway to avoid retry loops
        elementsNeedingAI.forEach(el => scannedElements.add(el));
      }
    }

  } catch (err) {
    console.error('Sentry: Failed to connect to backend or parse response.', err);
  } finally {
    isScanning = false;
    
    // Performance summary
    const scanDuration = (performance.now() - scanStartTime).toFixed(2);
    const totalElements = instantBlockCount + apiCallCount + visionAPICallCount;
    
    console.log(`⚡ Sentry Performance Summary:`);
    console.log(`   Total time: ${scanDuration}ms`);
    console.log(`   Instant blocks: ${instantBlockCount} (${instantImageBlockCount} images)`);
    console.log(`   Batch API calls: ${apiCallCount}`);
    console.log(`   Vision API calls: ${visionAPICallCount}`);
    
    if (totalElements > 0) {
      const instantPercent = Math.round((instantBlockCount / totalElements) * 100);
      const avgTime = (scanDuration / totalElements).toFixed(2);
      console.log(`   ✅ ${instantPercent}% instant | Avg: ${avgTime}ms per element`);
      
      if (instantImageBlockCount > 0) {
        console.log(`   🖼️ ${instantImageBlockCount} images blocked without Vision API!`);
      }
    }
    
    // Set cooldown
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
    }, SCAN_COOLDOWN_TIME);
  }
}

/**
 * Simple hash function for caching
 * @param {string} str String to hash
 * @returns {number} Hash value
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Gets the main content area container for social media platforms
 * Returns the specific div that contains ONLY the chat/feed area
 * @returns {Element|null} The main content container or null
 */
function getMainContentArea() {
  // Facebook Messenger - Chat area only (middle section)
  if (isFacebook && window.location.pathname.includes('/messages/')) {
    // Try multiple selectors for Messenger chat area
    const messengerSelectors = [
      '[role="main"]', // Main chat area
      'div[class*="conversation"]',
      'div[class*="messaging"]'
    ];
    
    for (const selector of messengerSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Messenger chat area: ${selector}`);
        return container;
      }
    }
  }
  
  // Facebook Feed - Newsfeed only (middle section)
  if (isFacebook && !window.location.pathname.includes('/messages/')) {
    const feedSelectors = [
      '[role="feed"]', // Main newsfeed
      'div[id*="stream"]'
    ];
    
    for (const selector of feedSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Facebook feed area: ${selector}`);
        return container;
      }
    }
  }
  
  // Instagram Feed - Posts only (middle section)
  if (isInstagram && window.location.pathname === '/') {
    const instaFeedSelectors = [
      'main[role="main"]', // Main Instagram feed
      'section > div > div'
    ];
    
    for (const selector of instaFeedSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Instagram feed area: ${selector}`);
        return container;
      }
    }
  }
  
  // Instagram DMs - Chat area only (middle section)
  if (isInstagram && window.location.pathname.includes('/direct/')) {
    const instaDMSelectors = [
      'div[class*="x1n2onr6"]', // Instagram DM container
      'section[class*="message"]',
      'main[role="main"]'
    ];
    
    for (const selector of instaDMSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Instagram DM area: ${selector}`);
        return container;
      }
    }
  }
  
  // Default: return document.body for other sites
  console.log("Sentry: Using full page scan (not social media)");
  return document.body;
}

/**
 * Gets content elements from the page for incremental scanning
 * Prioritizes specific elements over large containers
 * ONLY scans within the main content area (not sidebars/navigation)
 * @returns {Array} Array of elements to scan
 */
function getContentElements() {
  const elements = [];
  
  // Get the main content area (chat/feed only, NOT sidebars!)
  const contentArea = getMainContentArea();
  if (!contentArea) {
    console.warn("Sentry: No content area found, skipping scan");
    return elements;
  }
  
  // Priority 1: Specific, small elements (most likely to contain isolated problematic content)
  const prioritySelectors = [
    // Search result specific
    'div.g', 'div[data-sokoban-container]', 
    // Links and titles
    'a[href*="wa.me"]', 'a[href*="t.me"]', 'a', 'h1', 'h2', 'h3',
    // Specific content
    '.result', '.search-result', '[role="article"]',
    'article', 'li.result', 'li.search-result',
    // Chat/message containers (for Instagram/Facebook/Messenger)
    '.message', '.chat-message', '[class*="message"]', '[class*="post"]',
    '[class*="Message"]', 'div[dir="auto"]', 'span[dir="auto"]',
    // Instagram specific
    '[class*="x1lliihq"]', '[class*="_a9zr"]', '[class*="_aacl"]',
    // Facebook/Messenger specific  
    '[data-scope="messages_table"]', '[role="row"]', 'div[role="gridcell"]'
  ];
  
  // Priority 2: Medium elements
  const mediumSelectors = [
    'p', 'blockquote', 'span.description', 
    '.message', '.post', '.comment', '.chat-message',
    'div[class*="message"]', 'div[class*="post"]'
  ];
  
  // Priority 3: Larger containers (only if no children match)
  const containerSelectors = [
    'div[class*="content"]', 'section', 'td'
  ];
  
  // Scan priority elements first (ONLY within content area!)
  const allPriorityElements = contentArea.querySelectorAll(prioritySelectors.join(','));
  allPriorityElements.forEach(el => addElementIfValid(el, elements));
  
  // Then medium elements (ONLY within content area!)
  const allMediumElements = contentArea.querySelectorAll(mediumSelectors.join(','));
  allMediumElements.forEach(el => addElementIfValid(el, elements));
  
  // Finally containers, but be selective (ONLY within content area!)
  const allContainers = contentArea.querySelectorAll(containerSelectors.join(','));
  allContainers.forEach(el => {
    // Only add containers if they're small or we haven't scanned their children
    if (el.children.length < 5 || !hasScannedChildren(el, elements)) {
      addElementIfValid(el, elements);
    }
  });
  
  // Also check for images - with enhanced detection (ONLY within content area!)
  const images = contentArea.querySelectorAll('img');
  images.forEach(img => {
    // Skip if already scanned or is a Sentry element
    if (scannedElements.has(img) ||
        img.closest('.sentry-confirmation-overlay') ||
        img.classList.contains('sentry-blocked-content')) {
      return;
    }
    
    // Check if image is visible and large enough
    if (img.offsetParent !== null && // Image is visible
        img.width > 100 && 
        img.height > 100) {
      elements.push(img);
    }
  });
  
  const areaName = isInstagram || isFacebook ? 'main content area (NO sidebars!)' : 'full page';
  console.log(`Sentry: Found ${elements.length} elements to scan in ${areaName} (including ${images.length} images)`);
  return elements;
}

/**
 * Checks if element is a social media UI element that should be skipped
 * @param {Element} el Element to check
 * @returns {boolean} True if should be skipped
 */
function isSocialMediaUIElement(el) {
  if (!isInstagram && !isFacebook) return false;
  
  // Skip if element is too small (likely UI element)
  const rect = el.getBoundingClientRect();
  if (rect.width < 50 && rect.height < 50) return true;
  
  // Skip Facebook/Instagram UI selectors
  const uiSelectors = [
    '[role="navigation"]',
    '[role="banner"]',
    '[role="search"]',
    '[aria-label*="Navigation"]',
    '[aria-label*="Menu"]',
    '[aria-label*="Search"]',
    'nav',
    'header',
    'footer',
    '[class*="navigation"]',
    '[class*="toolbar"]',
    '[class*="sidebar"]',
    '[data-pagelet*="LeftRail"]',
    '[data-pagelet*="RightRail"]'
  ];
  
  for (const selector of uiSelectors) {
    if (el.matches(selector) || el.closest(selector)) {
      return true;
    }
  }
  
  // Skip if no actual text content (just icons/buttons)
  const textContent = (el.innerText || el.textContent || '').trim();
  if (textContent.length === 0) return true;
  
  return false;
}

/**
 * Checks if an element is valid for scanning and adds it to the list
 * @param {Element} el Element to check
 * @param {Array} elements Array to add to
 */
function addElementIfValid(el, elements) {
  // Skip if already checked
  if (scannedElements.has(el)) return;
  
  // Skip our own elements - CRITICAL: Must check this thoroughly
  if (el.classList.contains('sentry-blocked-content') ||
      el.classList.contains('sentry-confirmation-overlay') ||
      el.classList.contains('sentry-confirmation-popup') ||
      el.classList.contains('sentry-popup-header') ||
      el.classList.contains('sentry-popup-content') ||
      el.classList.contains('sentry-popup-reason') ||
      el.classList.contains('sentry-popup-guidance') ||
      el.classList.contains('sentry-popup-actions') ||
      el.classList.contains('sentry-text-wrapper') ||
      el.hasAttribute('data-sentry-wrapped') ||
      el.id?.startsWith('sentry-') ||
      el.closest('.sentry-confirmation-overlay') ||
      el.closest('.sentry-confirmation-popup') ||
      el.closest('[class*="sentry-"]')) {
    return;
  }
  
  // Skip social media UI elements
  if (isSocialMediaUIElement(el)) {
    return;
  }
  
  // Skip navigation, headers, search bars, forms
  const skipTags = ['NAV', 'HEADER', 'FOOTER', 'INPUT', 'TEXTAREA', 'BUTTON', 'FORM'];
  if (skipTags.includes(el.tagName) ||
      el.closest('nav, header, footer, form, [role="search"], [role="navigation"], [role="banner"]')) {
    return;
  }
  
  // Get text content
  const text = el.innerText || el.textContent || '';
  const trimmedText = text.trim();
  
  // Only scan visible elements with substantial text
  if (el.offsetParent !== null && // Element is visible
      trimmedText.length > MIN_CONTENT_LENGTH) {
    
    // Avoid scanning parent if we already have child with same content
    const isDuplicate = elements.some(existingEl => {
      const existingText = (existingEl.innerText || existingEl.textContent || '').trim();
      return existingText === trimmedText && existingEl.contains(el);
    });
    
    if (!isDuplicate) {
      elements.push(el);
    }
  }
}

/**
 * Checks if any children of an element have been scanned
 * @param {Element} container Container element
 * @param {Array} scannedList List of scanned elements
 * @returns {boolean} True if any children are in the scanned list
 */
function hasScannedChildren(container, scannedList) {
  return scannedList.some(el => container.contains(el) && el !== container);
}

/**
 * Finds images associated with a text element (in the same container/parent)
 * @param {Element} textElement The text element that was blocked
 * @returns {Array<HTMLImageElement>} Array of associated images to block
 */
function findAssociatedImages(textElement) {
  const associatedImages = [];
  
  // Find the common parent container (article, post, message, div, etc.)
  let container = textElement;
  const containerSelectors = [
    'article', '[role="article"]', '.post', '.message', '.chat-message',
    '[class*="post"]', '[class*="message"]', '[class*="Message"]',
    'div[class*="content"]', 'section', 'li', 'td'
  ];
  
  // Try to find a meaningful container
  for (const selector of containerSelectors) {
    const foundContainer = textElement.closest(selector);
    if (foundContainer && foundContainer !== document.body) {
      container = foundContainer;
      break;
    }
  }
  
  // If no specific container found, use parent element (but limit depth)
  if (container === textElement) {
    let parent = textElement.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 3) {
      // Check if parent has multiple children (likely a container)
      if (parent.children.length > 1) {
        container = parent;
        break;
      }
      parent = parent.parentElement;
      depth++;
    }
    if (container === textElement && parent) {
      container = parent;
    }
  }
  
  // Find all images within the container
  const images = container.querySelectorAll('img');
  
  images.forEach(img => {
    // Skip if already blocked
    if (img.classList.contains('sentry-blocked-content') ||
        img.hasAttribute('data-sentry-blocked')) {
      return;
    }
    
    // Skip if image is too small (likely an icon)
    if (img.width < 100 || img.height < 100) {
      return;
    }
    
    // Skip if image is in Sentry UI
    if (img.closest('.sentry-confirmation-overlay') ||
        img.closest('.sentry-confirmation-popup') ||
        img.id?.startsWith('sentry-')) {
      return;
    }
    
    // Only include images that are visible
    if (img.offsetParent !== null) {
      associatedImages.push(img);
    }
  });
  
  return associatedImages;
}

/**
 * Blocks a specific element with blur effect and persistent tracking
 * @param {Element} element The element to block
 * @param {Object} aiResponse The AI response containing blocking information
 */
function blockSpecificElement(element, aiResponse) {
  if (!element || !document.body.contains(element)) return;
  
  // ⚡ ANTI-STACKING FIX #1: Skip if already blocked
  if (element.classList.contains('sentry-blocked-content')) {
    console.log("Sentry: Element already blocked, skipping to prevent stacking");
    return;
  }
  
  // ⚡ ANTI-STACKING FIX #2: Check if any ancestor is already blocked
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (ancestor.classList.contains('sentry-blocked-content') || 
        ancestor.hasAttribute('data-sentry-blocked')) {
      console.log("Sentry: Ancestor already blocked, skipping to prevent nested blur");
      return;
    }
    ancestor = ancestor.parentElement;
  }
  
  // ⚡ ANTI-STACKING FIX #3: Check if any child is already blocked
  const blockedChildren = element.querySelectorAll('.sentry-blocked-content, [data-sentry-blocked="true"]');
  if (blockedChildren.length > 0) {
    console.log("Sentry: Child already blocked, skipping parent to prevent double blur");
    return;
  }
  
  // Find the smallest element that should be blocked
  // This prevents blurring entire containers when only a small part is problematic
  const targetElement = findSmallestBlockableElement(element, aiResponse);
  
  if (!targetElement) return;
  
  // Apply blur effect with unique identifier
  targetElement.classList.add('sentry-blocked-content');
  targetElement.setAttribute('data-sentry-blocked', 'true');
  targetElement.setAttribute('data-sentry-category', aiResponse.category);
  
  if (!targetElement.hasAttribute('data-sentry-reported')) {
    const elementPreviewSource =
      targetElement.innerText ||
      targetElement.textContent ||
      targetElement.getAttribute?.('aria-label') ||
      targetElement.alt ||
      (targetElement.src ? `Media source: ${targetElement.src}` : '') ||
      aiResponse.summary ||
      aiResponse.reason ||
      '';
    const elementPreview = normalizeExcerpt(elementPreviewSource);
    targetElement.setAttribute('data-sentry-reported', 'true');
    reportFlaggedContentToBackend(aiResponse, {
      elementTag: targetElement.tagName,
      contentExcerpt: elementPreview || aiResponse.summary || aiResponse.reason || '',
    });
  }
  
  // Store the AI response for this element
  blockedElements.set(targetElement, aiResponse);
  
  // Add MULTIPLE click handlers to ensure popup shows (aggressive prevention)
  const clickHandler = (e) => {
    console.log("🔥 Sentry: Click detected on blocked element!", targetElement.tagName);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation(); // Stop ALL other handlers
    showConfirmationPopup(targetElement, aiResponse);
    return false; // Extra prevention
  };
  
  // Add multiple event listeners to catch all clicks
  targetElement.addEventListener('click', clickHandler, { capture: true });
  targetElement.addEventListener('click', clickHandler, { capture: false });
  targetElement.addEventListener('mousedown', clickHandler, { capture: true });
  targetElement.addEventListener('mouseup', clickHandler, { capture: true });
  
  // For images in links, prevent parent link from triggering
  if (targetElement.tagName === 'IMG' && targetElement.closest('a')) {
    const parentLink = targetElement.closest('a');
    const linkBlocker = (e) => {
      if (e.target === targetElement || targetElement.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showConfirmationPopup(targetElement, aiResponse);
        return false;
      }
    };
    parentLink.addEventListener('click', linkBlocker, { capture: true });
    targetElement._sentryLinkBlocker = linkBlocker;
  }
  
  // Store the handler for potential cleanup
  targetElement._sentryClickHandler = clickHandler;
  
  // Set up intersection observer to maintain blur when scrolling
  setupPersistentBlur(targetElement);
  
  console.log(`Sentry: Blocked specific element (${targetElement.tagName}) for ${aiResponse.category}`);
  
  // 🖼️ NEW: If blocking text content, also block associated images
  if (targetElement.tagName !== 'IMG') {
    const associatedImages = findAssociatedImages(targetElement);
    
    if (associatedImages.length > 0) {
      console.log(`🖼️ Sentry: Found ${associatedImages.length} associated image(s) with explicit text - blocking them too`);
      
      // Create image-specific blocking response (similar to text but for images)
      const imageBlockResponse = {
        safe: false,
        title: aiResponse.title || "Associated Content Blocked",
        reason: `This image is associated with content that contains ${aiResponse.category || 'inappropriate material'}.`,
        what_to_do: aiResponse.what_to_do || "This content has been flagged as inappropriate.",
        category: aiResponse.category || "explicit_content",
        confidence: aiResponse.confidence || 85
      };
      
      // Block each associated image
      associatedImages.forEach(img => {
        // Skip if already scanned or blocked
        if (scannedElements.has(img) || 
            img.classList.contains('sentry-blocked-content')) {
          return;
        }
        
        // Mark as scanned to avoid re-processing
        scannedElements.add(img);
        
        // Block the image
        blockSpecificElement(img, imageBlockResponse);
      });
    }
  }
}

/**
 * Finds the smallest element that should be blocked instead of a large container
 * @param {Element} element The element that was detected
 * @param {Object} aiResponse The AI response
 * @returns {Element|null} The best element to block
 */
function findSmallestBlockableElement(element, aiResponse) {
  // Never block input fields, search bars, navigation, headers, or footers
  const neverBlock = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'NAV', 'HEADER', 'FOOTER', 'FORM'];
  if (neverBlock.includes(element.tagName) ||
      element.closest('nav, header, footer, form, [role="search"], [role="navigation"]') ||
      element.hasAttribute('aria-label') && /search|navigation|menu/i.test(element.getAttribute('aria-label'))) {
    console.log("Sentry: Skipping UI element (search bar, nav, etc.)");
    return null;
  }
  
  // For images, always block the image itself
  // Make sure images are clickable by ensuring pointer-events
  if (element.tagName === 'IMG') {
    element.style.cursor = 'pointer';
    element.style.pointerEvents = 'auto';
    element.style.userSelect = 'none'; // Prevent selection
    
    // Prevent default image behaviors (like drag, right-click save)
    element.setAttribute('draggable', 'false');
    element.addEventListener('dragstart', (e) => e.preventDefault());
    
    return element;
  }
  
  // For text content, find the most specific element
  
  // If it's a small element already (span, a, h1-h6, etc.), block it directly
  const smallElements = ['SPAN', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'B', 'I', 'P'];
  if (smallElements.includes(element.tagName)) {
    return element;
  }
  
  // ⚡ IMPROVED: Aggressively find the innermost text container
  // For larger containers, drill down to find the ACTUAL text element
  const elementText = (element.innerText || element.textContent || '').trim();
  
  // Get all leaf elements (elements with no children or only text nodes)
  const leafElements = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        // Skip non-content elements
        if (['SCRIPT', 'STYLE', 'BR', 'HR'].includes(node.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Check if this is a leaf (no element children, only text)
        const hasElementChildren = Array.from(node.children).some(c => c.nodeType === Node.ELEMENT_NODE);
        if (!hasElementChildren) {
          const text = (node.innerText || node.textContent || '').trim();
          if (text.length >= MIN_CONTENT_LENGTH) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  
  let currentNode = walker.nextNode();
  while (currentNode) {
    leafElements.push(currentNode);
    currentNode = walker.nextNode();
  }
  
  // If we found leaf elements, use the one with the most content
  if (leafElements.length > 0) {
    // Sort by text length to find the most substantial leaf
    leafElements.sort((a, b) => {
      const aText = (a.innerText || a.textContent || '').trim().length;
      const bText = (b.innerText || b.textContent || '').trim().length;
      return bText - aText; // Longest first
    });
    
    // Return the first leaf that contains most of the parent's text
    for (const leaf of leafElements) {
      const leafText = (leaf.innerText || leaf.textContent || '').trim();
      // If this leaf contains at least 50% of the parent's text, it's the target
      if (leafText.length >= elementText.length * 0.5) {
        console.log(`Sentry: Found innermost element <${leaf.tagName}> instead of <${element.tagName}>`);
        return leaf;
      }
    }
    
    // If no single leaf dominates, use the first one
    return leafElements[0];
  }
  
  // Fallback: check direct children for problematic content
  const problematicKeywords = /\b(porn|xxx|sex videos?|nude|naked|adult content|pornhub|xvideos|xnxx|xhamster|redtube|youporn|explicit|nsfw|18\+|iinom|inuman|alak|drunk|job opportunity|whatsapp|wa\.me|scam)\b/i;
  
  const children = Array.from(element.children);
  
  // Look for direct children that contain the problematic content
  for (const child of children) {
    const childText = (child.innerText || child.textContent || '').trim();
    
    // If this child has the problematic content and is small enough, block it instead
    if (childText.length > 0 && 
        childText.length < 500 && 
        problematicKeywords.test(childText)) {
      
      // Recursively find the smallest element in this child
      return findSmallestBlockableElement(child, aiResponse);
    }
  }
  
  // For search results, try to find the specific result container
  if (element.classList.contains('g') || // Google search result
      element.hasAttribute('data-sokoban-container') ||
      element.tagName === 'LI' ||
      element.classList.contains('result')) {
    return element; // This is already a specific result
  }
  
  // If element has too many children (like body or main), don't block it
  if (children.length > 20) {
    console.warn("Sentry: Element has too many children, trying to find specific child");
    
    // Try to find the first child with problematic content
    for (const child of children) {
      const childText = (child.innerText || child.textContent || '').trim();
      if (childText.length > 20 && problematicKeywords.test(childText)) {
        return findSmallestBlockableElement(child, aiResponse);
      }
    }
    
    return null; // Don't block if we can't find a specific element
  }
  
  // For medium-sized elements (P, DIV with few children, ARTICLE), block them
  if (element.tagName === 'P' || 
      element.tagName === 'ARTICLE' ||
      (element.tagName === 'DIV' && children.length < 10)) {
    return element;
  }
  
  // Last resort: block the element if it's not huge
  const elementHeight = element.offsetHeight || 0;
  if (elementHeight < window.innerHeight * 0.5) { // Less than 50% of viewport
    return element;
  }
  
  return null; // Don't block if too large
}

/**
 * Sets up persistent blur that re-applies when element comes back into view
 * @param {Element} element The blocked element
 */
function setupPersistentBlur(element) {
  // Create intersection observer if not exists
  if (!intersectionObserver) {
    intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const el = entry.target;
        
        // When element comes into view, ensure it's still blurred if it should be
        if (entry.isIntersecting && el.getAttribute('data-sentry-blocked') === 'true') {
          if (!el.classList.contains('sentry-blocked-content')) {
            el.classList.add('sentry-blocked-content');
            console.log("Sentry: Re-applied blur to element that scrolled back into view");
          }
        }
      });
    }, {
      threshold: 0.1 // Trigger when 10% of element is visible
    });
  }
  
  // Observe this element
  intersectionObserver.observe(element);
}

/**
 * Shows a confirmation popup when user clicks on blocked content
 * @param {Element} element The blocked element
 * @param {Object} aiResponse The AI response with blocking details
 */
function showConfirmationPopup(element, aiResponse) {
  console.log("🚨 Sentry: POPUP TRIGGERED!", {
    element: element.tagName,
    category: aiResponse.category,
    title: aiResponse.title
  });
  
  // Remove any existing popups
  const existingPopup = document.querySelector('.sentry-confirmation-overlay');
  if (existingPopup) {
    existingPopup.remove();
  }
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'sentry-confirmation-overlay';
  
  // Create popup
  const popup = document.createElement('div');
  popup.className = `sentry-confirmation-popup sentry-popup-category-${aiResponse.category}`;
  
  // Create header
  const header = document.createElement('div');
  header.className = 'sentry-popup-header';
  
  const icon = document.createElement('div');
  icon.className = 'sentry-popup-icon';
  icon.textContent = getIconForCategory(aiResponse.category);
  
  const title = document.createElement('h2');
  title.className = 'sentry-popup-title';
  title.textContent = aiResponse.title || 'Content Warning';
  
  header.appendChild(icon);
  header.appendChild(title);
  
  // Create content area
  const content = document.createElement('div');
  content.className = 'sentry-popup-content';
  
  // Reason section
  const reasonSection = document.createElement('div');
  reasonSection.className = 'sentry-popup-reason';
  
  const reasonTitle = document.createElement('div');
  reasonTitle.className = 'sentry-popup-reason-title';
  reasonTitle.textContent = 'Why is this blocked?';
  
  const reasonText = document.createElement('p');
  reasonText.className = 'sentry-popup-reason-text';
  reasonText.textContent = aiResponse.reason || 'This content may not be appropriate.';
  
  reasonSection.appendChild(reasonTitle);
  reasonSection.appendChild(reasonText);
  
  // Guidance section
  const guidanceSection = document.createElement('div');
  guidanceSection.className = 'sentry-popup-guidance';
  
  const guidanceTitle = document.createElement('div');
  guidanceTitle.className = 'sentry-popup-guidance-title';
  guidanceTitle.textContent = 'What should you do?';
  
  const guidanceText = document.createElement('p');
  guidanceText.className = 'sentry-popup-guidance-text';
  guidanceText.textContent = aiResponse.what_to_do || 'Consider whether you really need to view this content.';
  
  guidanceSection.appendChild(guidanceTitle);
  guidanceSection.appendChild(guidanceText);
  
  content.appendChild(reasonSection);
  content.appendChild(guidanceSection);
  
  // Create actions
  const actions = document.createElement('div');
  actions.className = 'sentry-popup-actions';
  
  const cancelButton = document.createElement('button');
  cancelButton.className = 'sentry-popup-button sentry-popup-button-cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', () => {
    overlay.remove();
  });
  
  const continueButton = document.createElement('button');
  continueButton.className = 'sentry-popup-button sentry-popup-button-continue';
  continueButton.textContent = 'Continue';
  continueButton.addEventListener('click', () => {
    console.log("✅ Sentry: User clicked Continue - unblocking element");
    
    // Remove blur class
    element.classList.remove('sentry-blocked-content');
    
    // Remove Sentry attributes
    element.removeAttribute('data-sentry-blocked');
    element.removeAttribute('data-sentry-category');
    
    // Reset inline styles
    element.style.filter = 'none';
    element.style.cursor = '';
    element.style.pointerEvents = '';
    element.style.userSelect = '';
    element.style.zIndex = '';
    
    // For images, restore draggable attribute
    if (element.tagName === 'IMG') {
      element.removeAttribute('draggable');
    }
    
    // Remove event listeners
    if (element._sentryClickHandler) {
      element.removeEventListener('click', element._sentryClickHandler, { capture: true });
      element.removeEventListener('click', element._sentryClickHandler, { capture: false });
      element.removeEventListener('mousedown', element._sentryClickHandler, { capture: true });
      element.removeEventListener('mouseup', element._sentryClickHandler, { capture: true });
      delete element._sentryClickHandler;
    }
    
    // Remove parent link blocker if exists
    if (element._sentryLinkBlocker && element.closest('a')) {
      const parentLink = element.closest('a');
      parentLink.removeEventListener('click', element._sentryLinkBlocker, { capture: true });
      delete element._sentryLinkBlocker;
    }
    
    // Remove from blocked elements map
    blockedElements.delete(element);
    
    // Remove from scanned elements so it won't be re-checked
    // Note: WeakSet doesn't have delete method, but we can just leave it
    
    // Close popup
    overlay.remove();
    
    console.log("✅ Sentry: Element fully unblocked and accessible");
  });
  
  actions.appendChild(cancelButton);
  actions.appendChild(continueButton);
  
  // Assemble popup
  popup.appendChild(header);
  popup.appendChild(content);
  popup.appendChild(actions);
  overlay.appendChild(popup);
  
  // Add to page
  document.body.appendChild(overlay);
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
}

/**
 * Gets an appropriate emoji icon for the content category
 * @param {string} category The content category
 * @returns {string} Emoji icon
 */
function getIconForCategory(category) {
  if (category.includes('explicit')) return '🔞';
  if (category.includes('violence')) return '⚠️';
  if (category.includes('scam') || category.includes('phishing')) return '🚫';
  if (category.includes('predatory')) return '🛡️';
  if (category.includes('hate')) return '❌';
  return '⚠️';
}

/**
 * ⚡ Finds the INNERMOST elements containing profanity (most precise targeting)
 * This prevents blocking large parent containers when only a small text span has profanity
 * @param {Element} rootElement The root element to search within
 * @returns {Array<Element>} Array of innermost elements with profanity
 */
function findProfanityElements(rootElement) {
  const profanityElements = [];
  const processedElements = new Set();
  
  // Get all text-containing elements
  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        // Skip already processed
        if (processedElements.has(node)) return NodeFilter.FILTER_REJECT;
        
        // Skip non-content elements
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'BR', 'HR'].includes(node.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Must have text content
        const text = (node.innerText || node.textContent || '').trim();
        if (text.length < MIN_CONTENT_LENGTH) {
          return NodeFilter.FILTER_SKIP;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  const candidates = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    candidates.push(currentNode);
    currentNode = walker.nextNode();
  }
  
  // Sort by depth (deepest first) to find innermost elements
  candidates.sort((a, b) => {
    const depthA = getElementDepth(a);
    const depthB = getElementDepth(b);
    return depthB - depthA; // Deepest first
  });
  
  // Find elements with profanity, preferring innermost ones
  for (const element of candidates) {
    const text = (element.innerText || element.textContent || '').trim();
    
    // Check if this element has profanity
    const hasInstantMatch = instantLocalBlock(element, text);
    
    if (hasInstantMatch) {
      // Check if we already have a child of this element
      const hasChildInList = profanityElements.some(el => element.contains(el));
      
      if (!hasChildInList) {
        // This is the innermost element with profanity, use it
        profanityElements.push(element);
        processedElements.add(element);
        
        // Mark all ancestors as processed to avoid blocking parent
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== rootElement) {
          processedElements.add(ancestor);
          ancestor = ancestor.parentElement;
        }
      }
    }
  }
  
  return profanityElements;
}

/**
 * Gets the depth of an element in the DOM tree
 * @param {Element} element 
 * @returns {number} Depth level
 */
function getElementDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

/**
 * Finds the smallest text container element for a given element
 * Used when blocking text nodes to target the most specific wrapper
 * @param {Element} element Starting element
 * @returns {Element} Smallest appropriate container
 */
function findSmallestTextContainer(element) {
  // If it's already a small inline element, use it
  const smallTags = ['SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'MARK', 'CODE'];
  if (smallTags.includes(element.tagName)) {
    return element;
  }
  
  // Check if element has only one child that's a small element
  const children = Array.from(element.children);
  if (children.length === 1 && smallTags.includes(children[0].tagName)) {
    return children[0];
  }
  
  // For larger containers, check if there's a specific span/div with the text
  const textElements = element.querySelectorAll('span, div, p');
  for (const textEl of textElements) {
    const text = (textEl.innerText || textEl.textContent || '').trim();
    if (text.length >= MIN_CONTENT_LENGTH && text.length < 200) {
      // Check if this is a direct text container (not a big wrapper)
      const childText = Array.from(textEl.children)
        .map(c => (c.innerText || c.textContent || '').trim())
        .join('');
      
      // If most of the text is direct text nodes (not nested), use this
      if (childText.length < text.length * 0.5) {
        return textEl;
      }
    }
  }
  
  return element; // Fallback to original
}

// Debounced scan function
const debouncedScan = debounce(() => {
  if (!isScanning && !scanTimeout) {
    scanPageContent();
  }
}, SCAN_DEBOUNCE_TIME);

// MutationObserver to watch for page changes - IMPROVED with better filtering
const observer = new MutationObserver((mutations) => {
  // First, maintain existing blurs
  mutations.forEach(mutation => {
    if (mutation.target.getAttribute?.('data-sentry-blocked') === 'true') {
      const element = mutation.target;
      if (!element.classList.contains('sentry-blocked-content')) {
        element.classList.add('sentry-blocked-content');
        console.log("Sentry: Re-applied blur to modified element");
      }
    }
    
    if (mutation.addedNodes) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.getAttribute?.('data-sentry-blocked') === 'true') {
          if (!node.classList.contains('sentry-blocked-content')) {
            node.classList.add('sentry-blocked-content');
          }
        }
      });
    }
  });
  
  // Check for relevant changes - with STRICT filtering to avoid mouse movement triggers
  const relevantChanges = mutations.filter(mutation => {
    // Skip Sentry elements
    if (mutation.target.id?.startsWith('sentry-') || 
        mutation.target.classList?.contains('sentry-blocked-content') ||
        mutation.target.classList?.contains('sentry-confirmation-overlay') ||
        mutation.target.closest('[id^="sentry-"]') ||
        mutation.target.closest('.sentry-confirmation-overlay')) {
      return false;
    }
    
    // IGNORE attribute-only changes (hover effects, style changes from mouse movement)
    if (mutation.type === 'attributes') {
      return false;
    }
    
    // IGNORE empty text changes
    if (mutation.type === 'characterData') {
      const text = mutation.target.textContent || '';
      if (text.trim().length < MIN_CONTENT_LENGTH) {
        return false;
      }
    }
    
    // IGNORE trivial node additions (tooltips, cursors, etc.)
    if (mutation.type === 'childList') {
      // Only care about substantial additions
      let hasSubstantialContent = false;
      
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const text = node.textContent || '';
          // Must have meaningful text (more than just a number or single word)
          if (text.trim().length >= MIN_CONTENT_LENGTH) {
            hasSubstantialContent = true;
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || '';
          if (text.trim().length >= MIN_CONTENT_LENGTH) {
            hasSubstantialContent = true;
          }
        }
      });
      
      if (!hasSubstantialContent) {
        return false;
      }
    }
    
    return true;
  });
  
  // ⚡ INSTANT SYNCHRONOUS BLOCKING (NEW - fixes delay issue!)
  // Block profanity IMMEDIATELY when it enters DOM, before debounced scan
  if (relevantChanges.length > 0) {
    console.log(`Sentry: ${relevantChanges.length} substantial changes detected`);
    
    let instantBlockedInObserver = 0;
    
    // Process added nodes SYNCHRONOUSLY for instant blocking
    relevantChanges.forEach(mutation => {
      if (mutation.addedNodes) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // ⚡ NEW APPROACH: Find the INNERMOST element with profanity
            // Instead of blocking parent + all children, find the smallest precise element
            
            const profanityElements = findProfanityElements(node);
            
            if (profanityElements.length > 0) {
              profanityElements.forEach(profanityEl => {
                // Skip if already processed
                if (scannedElements.has(profanityEl)) return;
                
                // Skip Sentry UI
                if (profanityEl.id?.startsWith('sentry-') || 
                    profanityEl.classList?.contains('sentry-blocked-content') ||
                    profanityEl.classList?.contains('sentry-confirmation-overlay')) {
                  return;
                }
                
                const textContent = profanityEl.innerText || profanityEl.textContent || '';
                const instantResult = instantLocalBlock(profanityEl, textContent);
                
                if (instantResult) {
                  blockSpecificElement(profanityEl, instantResult);
                  scannedElements.add(profanityEl);
                  instantBlockedInObserver++;
                  console.log(`⚡ INSTANT BLOCK (precise): <${profanityEl.tagName}> "${textContent.substring(0, 30)}..."`);
                }
              });
            }
            
          } else if (node.nodeType === Node.TEXT_NODE) {
            // Handle text nodes
            const textContent = node.textContent || '';
            if (textContent.trim().length >= MIN_CONTENT_LENGTH && node.parentNode) {
              const parent = node.parentNode;
              
              if (scannedElements.has(parent)) return;
              
              if (parent.id?.startsWith('sentry-') || 
                  parent.classList?.contains('sentry-blocked-content') ||
                  parent.classList?.contains('sentry-confirmation-overlay')) {
                return;
              }
              
              const instantResult = instantLocalBlock(parent, textContent);
              if (instantResult) {
                // For text nodes, find the smallest wrapping element
                const smallestElement = findSmallestTextContainer(parent);
                blockSpecificElement(smallestElement, instantResult);
                scannedElements.add(smallestElement);
                instantBlockedInObserver++;
                console.log(`⚡ INSTANT BLOCK (text node): <${smallestElement.tagName}> "${textContent.substring(0, 30)}..."`);
              }
            }
          }
        });
      }
    });
    
    if (instantBlockedInObserver > 0) {
      console.log(`⚡ Instantly blocked ${instantBlockedInObserver} elements in MutationObserver!`);
    }
    
    // Still schedule the debounced scan for AI analysis of unclear content
    debouncedScan();
  }
});

/**
 * Finds text nodes containing profanity/explicit keywords and wraps them for blocking
 * Adapted from contentscript.js for real-time text detection
 * @param {Array} keywords - Keywords to search for
 * @returns {Array} - Array of wrapped elements
 */
function findAndWrapTextNodes(keywords) {
  if (!keywords || keywords.length === 0) {
    // Default profanity keywords if none provided
    keywords = [
      'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'ass', 'asshole',
      'nigger', 'nigga', 'cunt', 'dick', 'pussy', 'porn', 'xxx',
      'putangina', 'gago', 'bobo', 'tanga', 'puta', 'leche'
    ];
  }
  
  const escapedKeywords = keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const keywordRegex = new RegExp('\\b(' + escapedKeywords.join('|') + ')\\b', 'i');
  const wrappedElements = [];
  
  // Use TreeWalker for efficient text node traversal
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip empty, script, style nodes
        if (!node.textContent.trim() ||
            node.parentNode.nodeName.toLowerCase() === 'script' ||
            node.parentNode.nodeName.toLowerCase() === 'style' ||
            node.parentNode.classList?.contains('sentry-blocked-content') ||
            node.parentNode.classList?.contains('sentry-text-wrapper') ||
            node.parentNode.hasAttribute?.('data-sentry-wrapped') ||
            node.parentNode.id?.startsWith('sentry-')) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip if any ancestor is already wrapped/blocked
        let ancestor = node.parentNode;
        while (ancestor && ancestor !== document.body) {
          if (ancestor.classList?.contains('sentry-blocked-content') ||
              ancestor.classList?.contains('sentry-text-wrapper') ||
              ancestor.hasAttribute?.('data-sentry-wrapped') ||
              ancestor.id?.startsWith('sentry-')) {
            return NodeFilter.FILTER_REJECT;
          }
          ancestor = ancestor.parentNode;
        }
        
        // Check for keywords
        if (keywordRegex.test(node.textContent)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        
        return NodeFilter.FILTER_SKIP;
      }
    },
    false
  );
  
  // Wrap matching text nodes
  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode.parentNode && document.body.contains(currentNode.parentNode)) {
      try {
        // Double-check parent isn't already wrapped (safety check)
        const parent = currentNode.parentNode;
        if (parent.classList?.contains('sentry-text-wrapper') ||
            parent.classList?.contains('sentry-blocked-content') ||
            parent.hasAttribute('data-sentry-wrapped')) {
          currentNode = walker.nextNode();
          continue;
        }
        
        const wrapper = document.createElement('span');
        wrapper.textContent = currentNode.nodeValue;
        wrapper.classList.add('sentry-text-wrapper');
        wrapper.setAttribute('data-sentry-wrapped', 'true'); // Mark as permanently wrapped
        
        currentNode.parentNode.replaceChild(wrapper, currentNode);
        wrappedElements.push(wrapper);
      } catch (err) {
        console.error("Sentry: Error wrapping text node:", err);
      }
    }
    currentNode = walker.nextNode();
  }
  
  console.log(`Sentry: Wrapped ${wrappedElements.length} text nodes with profanity`);
  return wrappedElements;
}

/**
 * Finds images with suspicious content
 * Adapted from contentscript.js
 * @returns {Array} - Array of suspicious images
 */
function findSuspiciousImages() {
  const suspiciousWords = [
    'explicit', 'nude', 'nsfw', 'xxx', 'adult', 'porn', 'sex',
    'naked', '18+', 'bikini', 'swimsuit', 'sexy'
  ];
  
  const suspiciousDomains = [
    'pornhub', 'xvideos', 'xnxx', 'porn', 'xxx', 'nsfw', 'sex'
  ];
  
  const wordRegex = new RegExp('\\b(' + suspiciousWords.join('|') + ')\\b', 'i');
  const domainRegex = new RegExp('(' + suspiciousDomains.join('|') + ')', 'i');
  
  const images = Array.from(document.querySelectorAll('img'));
  
  return images.filter(img => {
    try {
      // Skip small/icon images
      if (img.width < 100 || img.height < 100) return false;
      
      // Skip already blocked
      if (img.classList.contains('sentry-blocked-content')) return false;
      
      const alt = img.alt || '';
      const src = img.src || '';
      
      // Check for suspicious patterns
      return wordRegex.test(alt) || 
             wordRegex.test(src) || 
             domainRegex.test(src);
    } catch {
      return false;
    }
  });
}

/**
 * Starts the MutationObserver
 */
function startObserver() {
  observer.observe(document.body, {
    childList: true,      // Watch for added/removed nodes
    subtree: true,        // Watch entire tree
    characterData: true   // Watch for text changes
    // NOTE: Not watching attributes to avoid mouse movement triggers
  });
  console.log("Sentry: Real-time content observer started (childList + characterData only)");
}

/**
 * Maintains blur on all blocked elements (runs periodically)
 */
function maintainBlockedElements() {
  blockedElements.forEach((aiResponse, element) => {
    if (document.body.contains(element)) {
      // Ensure element still has the blocked class
      if (!element.classList.contains('sentry-blocked-content')) {
        element.classList.add('sentry-blocked-content');
        console.log("Sentry: Maintained blur on element");
      }
      
      // Ensure data attribute is still set
      if (element.getAttribute('data-sentry-blocked') !== 'true') {
        element.setAttribute('data-sentry-blocked', 'true');
        element.setAttribute('data-sentry-category', aiResponse.category);
      }
    } else {
      // Element no longer in DOM, remove from tracking
      blockedElements.delete(element);
    }
  });
}

/**
 * Checks page URL and title for explicit content indicators
 * @returns {boolean} True if page appears to be explicit
 */
function checkPageMetadata() {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const explicitPatterns = /pornhub|xvideos|xnxx|xhamster|porn|xxx|adult|sex|nude|explicit/i;
  
  return explicitPatterns.test(url) || explicitPatterns.test(title);
}

// Early initialization when DOM is ready (before images/styles load)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log("Sentry: DOM ready - starting early scan");
    
    // Check page metadata immediately
    if (checkPageMetadata()) {
      console.warn("Sentry: Page URL/title indicates adult content!");
      scanPageContent();
    }
    
    // Start observing right away
    if (document.body) {
      startObserver();
    }
  });
} else {
  // DOM already loaded
  console.log("Sentry: DOM already loaded - starting scan now");
  if (checkPageMetadata()) {
    console.warn("Sentry: Page URL/title indicates adult content!");
  }
  if (document.body) {
    scanPageContent();
    startObserver();
  }
}

// Full initialization on page load
window.addEventListener('load', () => {
  console.log("Sentry: Content blocking fully initialized");
  
  // Run another scan after full page load
  scanPageContent();
  
  // Periodically maintain blocked elements (every 2 seconds)
  setInterval(maintainBlockedElements, 2000);
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (observer) {
    observer.disconnect();
  }
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }
  if (scanTimeout) {
    clearTimeout(scanTimeout);
  }
  
  // Clear caches
  contentCache.clear();
  blockedElements.clear();
});
