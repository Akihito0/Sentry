// Sentry Content Script: Scans page content and blocks inappropriate material
// CSS files are loaded via the manifest.json content_scripts section

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

// NSFW Detection Configuration
// Use backend API with the .keras model (most accurate)
const USE_BACKEND_NSFW = true;

/**
 * Converts an image element to base64 using canvas
 * @param {HTMLImageElement} imgElement - The image element
 * @returns {string|null} Base64 string or null if failed
 */
function imageToBase64(imgElement) {
  try {
    // Create canvas and draw image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Use natural dimensions for better quality
    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    
    // Draw image to canvas
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    
    // Get base64 (JPEG for smaller size)
    const base64 = canvas.toDataURL('image/jpeg', 0.9);
    return base64;
  } catch (error) {
    // CORS error likely - can't access cross-origin images
    console.warn('Sentry: Cannot convert image to base64 (CORS):', error.message);
    return null;
  }
}

/**
 * Analyzes an image using the backend NSFW model (.keras)
 * This is the most accurate method - uses your trained model
 * @param {HTMLImageElement} imgElement - The image element to analyze
 * @param {string} imageUrl - The URL of the image
 * @param {string} context - Surrounding text context
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeImageWithBackendNSFW(imgElement, imageUrl, context) {
  try {
    console.log(`🔍 Sentry: Analyzing image with backend NSFW model: ${imageUrl.substring(0, 50)}...`);
    const startTime = performance.now();
    
    // Try to convert image to base64 first (works for social media CDNs that block external requests)
    let requestBody;
    const base64Data = imageToBase64(imgElement);
    
    if (base64Data) {
      console.log(`📸 Sentry: Using base64 encoding for image analysis`);
      requestBody = { image_base64: base64Data };
    } else {
      // Fallback to URL (may not work for some CDNs)
      console.log(`🔗 Sentry: Using URL for image analysis (base64 failed)`);
      requestBody = { image_url: imageUrl };
    }
    
    const response = await fetch(`${BACKEND_URL}/analyze-image-nsfw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      console.error(`Sentry: Backend NSFW API error: ${response.status}`);
      // Fall back to Vision API
      return analyzeImageWithVisionAPI(imgElement, imageUrl, context);
    }
    
    const result = await response.json();
    const analysisTime = (performance.now() - startTime).toFixed(2);
    
    console.log(`⚡ Sentry: Backend NSFW analysis completed in ${analysisTime}ms`);
    console.log(`   Result: ${result.safe ? '✅ Safe' : '🔞 Unsafe'} (${result.confidence}% confidence)`);
    
    // If unsafe, add lazy loading context for on-demand educational explanation
    if (!result.safe) {
      result.originalContent = `NSFW image detected with ${result.confidence}% confidence`;
      result.imageContext = { 
        source: 'nsfw_model', 
        confidence: result.confidence,
        url: imageUrl.substring(0, 100),
        surroundingText: context.substring(0, 150)
      };
      // Override generic messages with lazy loading prompts
      result.title = result.title || "Inappropriate Image Blocked";
      result.reason = "Click to learn why this image was blocked.";
      result.what_to_do = "Tap to see details.";
      result.category = "explicit_image";
    }
    
    return result;
    
  } catch (error) {
    console.error('Sentry: Backend NSFW analysis error:', error);
    // Fall back to Vision API
    return analyzeImageWithVisionAPI(imgElement, imageUrl, context);
  }
}

// Social media detection
const isInstagram = window.location.hostname.includes('instagram.com');
const isFacebook = window.location.hostname.includes('facebook.com');
const isTwitter = window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com');
const isSocialMedia = isInstagram || isFacebook || isTwitter;

const SCAN_DEBOUNCE_TIME = isSocialMedia ? 2000 : 1200; // MUCH longer for social media (DOM changes constantly)
const SCAN_COOLDOWN_TIME = isSocialMedia ? 5000 : 4000; // Longer cooldown for social media
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
        reason: "Click to learn why this image was blocked.",
        what_to_do: "Tap to see details.",
        category: "explicit_image",
        confidence: 99,
        originalContent: `Image from: ${domain}`,
        imageContext: { source: 'porn_domain', domain: domain, url: imgSrc.substring(0, 100) }
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
      reason: "Click to learn why this image was blocked.",
      what_to_do: "Tap to see details.",
      category: "explicit_image",
      confidence: 95,
      originalContent: `Image URL contains explicit keywords`,
      imageContext: { source: 'explicit_url', url: imgSrc.substring(0, 100) }
    };
  }
  
  // 3. SUSPICIOUS FILE NAMES
  const suspiciousFilePattern = /\b(nude|naked|sexy|porn|xxx|boobs|tits|ass|pussy|dick|cock|fuck|sex)\b.*\.(jpg|jpeg|png|gif|webp)/i;
  if (suspiciousFilePattern.test(imgSrc)) {
    console.log("⚡ Sentry: INSTANT IMAGE BLOCK - Suspicious filename");
    return {
      safe: false,
      title: "Suspicious Image Blocked",
      reason: "Click to learn why this image was blocked.",
      what_to_do: "Tap to see details.",
      category: "explicit_image",
      confidence: 85,
      originalContent: `Image filename suggests explicit content`,
      imageContext: { source: 'suspicious_filename', url: imgSrc.substring(0, 100) }
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
      reason: "Click to learn why this image was blocked.",
      what_to_do: "Tap to see details.",
      category: "explicit_image",
      confidence: 90,
      originalContent: `Image description contains explicit keywords`,
      imageContext: { source: 'explicit_alt', altText: altText.substring(0, 100) }
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
      reason: "Click to learn why this image was blocked.",
      what_to_do: "Tap to see details.",
      category: "explicit_image",
      confidence: 85,
      originalContent: `Image context suggests explicit content`,
      imageContext: { source: 'explicit_context', context: combinedText.substring(0, 150) }
    };
  }
  
  // 6. SOCIAL MEDIA CDN IMAGES - NOW ANALYZED VIA BASE64!
  // Previously we skipped these, but now we convert to base64 and analyze with NSFW model
  // So we return null to let them go through to PHASE 2 (backend NSFW analysis)
  
  // No instant decision - needs Backend NSFW model analysis
  return null;
}

/**
 * Fetches an educational explanation for blocked content
 * Uses the dedicated /educational-reason endpoint with the ACTUAL blocked content
 * Gemini AI analyzes the real content to provide insightful, context-aware reasons
 * @param {string} contentText - The ACTUAL blocked content text
 * @param {string} category - The category of the block (profanity, scam, etc.)
 * @returns {Promise<Object>} The educational response from Gemini AI
 */
async function fetchEducationalReason(contentText, category) {
  console.log(`📚 Sentry: Fetching educational reason from Gemini AI for ${category}...`);
  console.log(`📝 Content being analyzed: "${contentText?.substring(0, 100)}..."`);
  
  try {
    // Send the ACTUAL blocked content to Gemini for insightful analysis
    const response = await fetch(`${BACKEND_URL}/educational-reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: category,
        blocked_content: contentText || "",  // Send the FULL content (backend will truncate if needed)
        is_image: false
      })
    });
    
    if (response.ok) {
      const aiResponse = await response.json();
      console.log(`✅ Sentry: Educational reason fetched from Gemini AI`);
      return aiResponse;
    } else {
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error) {
    console.log(`⚠️ Sentry: Could not fetch educational reason: ${error.message}, using fallback`);
    // Fallback to pre-defined responses if API fails
    return getFallbackEducationalResponse(category);
  }
}

/**
 * Returns a fallback educational response when API fails
 * @param {string} category - The content category
 * @returns {Object} Fallback educational response
 */
function getFallbackEducationalResponse(category) {
  const fallbackResponses = {
    'profanity': {
      title: "Inappropriate Language Detected",
      reason: "This content contains words that are considered offensive or vulgar. Such language can be hurtful to others and creates a negative online environment.",
      what_to_do: "Consider how words affect others. Respectful communication builds better relationships."
    },
    'hate_speech': {
      title: "Hate Speech Detected",
      reason: "This content contains discriminatory language that targets people based on their identity. Everyone deserves to be treated with dignity and respect.",
      what_to_do: "Report hateful content when you see it. Stand up against discrimination when it's safe to do so."
    },
    'explicit_content': {
      title: "Adult Content Detected",
      reason: "This content is intended for adult audiences only. Exposure to such content can impact mental wellbeing, especially for younger viewers.",
      what_to_do: "Navigate away from this content. If you're underage, this content is not appropriate for you."
    },
    'explicit_image': {
      title: "Inappropriate Image Blocked",
      reason: "This image may contain content unsuitable for all audiences. Exposure to explicit imagery can negatively impact mental wellbeing.",
      what_to_do: "Practice safe browsing. If you encounter inappropriate images unexpectedly, close the page."
    },
    'sexual_conversation': {
      title: "Inappropriate Message Detected",
      reason: "This message contains inappropriate content that may make you uncomfortable. Such messages can be a form of harassment.",
      what_to_do: "Don't respond to unwanted messages. Block the sender and talk to a trusted adult if you feel unsafe."
    },
    'predatory': {
      title: "Warning: Unsafe Interaction",
      reason: "This content shows warning signs of manipulative behavior. Predators use flattery and secrecy to build trust.",
      what_to_do: "Never share personal information with strangers online. Tell a trusted adult if someone makes you uncomfortable."
    },
    'violent': {
      title: "Violent Content Detected",
      reason: "This content contains violence that can be disturbing and affect your mental wellbeing.",
      what_to_do: "Skip this content to protect your peace of mind. Report violent threats to authorities if needed."
    },
    'harassment': {
      title: "Harassment Detected",
      reason: "This content is designed to hurt or intimidate someone. Cyberbullying can have serious effects on mental health.",
      what_to_do: "Save evidence, report the content, and block the person. Talk to someone you trust."
    },
    'self_harm': {
      title: "Sensitive Content Warning",
      reason: "This content discusses topics that may be triggering. If you're struggling, help is available.",
      what_to_do: "HOPELINE Philippines: 0917-558-4673 | US: 988 | Crisis Text Line: Text HOME to 741741"
    },
    'alcohol_drugs': {
      title: "Substance-Related Content",
      reason: "This content involves alcohol or drugs. Substance use can have serious health consequences.",
      what_to_do: "Be aware of the risks. If you need help, reach out to a counselor or trusted adult."
    },
    'scam': {
      title: "Potential Scam Detected",
      reason: "This message shows signs of a scam. Scammers use promises of easy money to trick people.",
      what_to_do: "Do not click links or share personal information. Report and block the sender."
    },
    'fraud': {
      title: "Fraud Attempt Detected",
      reason: "This appears to be an attempt to steal your information. Scammers often pretend to be from trusted companies.",
      what_to_do: "Never share passwords or financial details via message. Contact companies through official channels."
    }
  };
  
  const response = fallbackResponses[category] || {
    title: getGenericTitle(category),
    reason: getGenericReason(category),
    what_to_do: getGenericGuidance(category)
  };
  
  return {
    safe: false,
    title: response.title,
    reason: response.reason,
    what_to_do: response.what_to_do,
    category: category,
    confidence: 90
  };
}

/**
 * Fetches an educational explanation for BLOCKED IMAGES
 * Uses the dedicated /educational-reason endpoint with Gemini AI
 * Sends actual image context (URL, alt text, surrounding text) for insightful analysis
 * @param {Object} imageContext - Context about why the image was blocked (contains actual data)
 * @param {string} category - The category (explicit_image, nsfw, etc.)
 * @returns {Promise<Object>} The educational response from Gemini AI
 */
async function fetchImageEducationalReason(imageContext, category) {
  console.log(`🖼️ Sentry: Fetching educational reason from Gemini AI for blocked image...`);
  
  // Build a detailed content description from the ACTUAL image context
  const source = imageContext?.source || 'unknown';
  let blockedContent = "";
  
  // Include actual data from the image context for Gemini to analyze
  switch (source) {
    case 'porn_domain':
      blockedContent = `Image from adult website. URL pattern: ${imageContext.url || 'adult content domain'}`;
      break;
    case 'explicit_url':
      blockedContent = `Image URL contains explicit keywords: ${imageContext.url || 'explicit URL pattern detected'}`;
      break;
    case 'suspicious_filename':
      blockedContent = `Image filename: ${imageContext.filename || 'suspicious filename pattern'}`;
      break;
    case 'explicit_alt':
      blockedContent = `Image description/alt text: "${imageContext.altText || 'explicit description'}"`;
      break;
    case 'explicit_context':
      blockedContent = `Image with surrounding text context: "${imageContext.context || 'explicit surrounding text'}"`;
      break;
    case 'nsfw_model':
      blockedContent = `AI NSFW model detected inappropriate content with ${imageContext.confidence || 'high'}% confidence. Image classification: potentially explicit visual content.`;
      break;
    default:
      blockedContent = `Image flagged as potentially inappropriate. Context: ${JSON.stringify(imageContext) || 'no additional context'}`;
  }
  
  console.log(`📝 Image context being analyzed: "${blockedContent.substring(0, 100)}..."`);
  
  try {
    // Send the ACTUAL image context to Gemini for insightful analysis
    const response = await fetch(`${BACKEND_URL}/educational-reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: category || 'explicit_image',
        blocked_content: blockedContent,  // Send the ACTUAL context data
        context: `Blocking source: ${source}`,
        is_image: true
      })
    });
    
    if (response.ok) {
      const aiResponse = await response.json();
      console.log(`✅ Sentry: Image educational reason fetched from Gemini AI`);
      return aiResponse;
    } else {
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error) {
    console.log(`⚠️ Sentry: Could not fetch image educational reason: ${error.message}, using fallback`);
    // Fallback to pre-defined response if API fails
    return getImageFallbackResponse(source);
  }
}

/**
 * Returns a fallback educational response for images when API fails
 * @param {string} source - The source that triggered the block
 * @returns {Object} Fallback educational response
 */
function getImageFallbackResponse(source) {
  const fallbackResponses = {
    'porn_domain': {
      reason: "This image was blocked because it comes from a website known for hosting adult content. Such websites contain material that is inappropriate for most audiences.",
      what_to_do: "Avoid visiting adult content websites. Consider enabling parental controls on your devices."
    },
    'explicit_url': {
      reason: "This image was blocked because its web address contains keywords associated with explicit content.",
      what_to_do: "Be cautious of links containing explicit terms. Report suspicious content to the platform."
    },
    'suspicious_filename': {
      reason: "This image was blocked because its filename suggests it may contain inappropriate content.",
      what_to_do: "Be careful when viewing images with suspicious filenames. When in doubt, don't click."
    },
    'explicit_alt': {
      reason: "This image was blocked because its description indicates it contains adult or explicit content.",
      what_to_do: "Pay attention to image descriptions. They can help you avoid inappropriate content."
    },
    'explicit_context': {
      reason: "This image was blocked because the surrounding text suggests it contains inappropriate content.",
      what_to_do: "Be aware of the context around images. If nearby text seems inappropriate, the images likely are too."
    },
    'nsfw_model': {
      reason: "This image was blocked because our AI safety system detected it likely contains inappropriate visual content.",
      what_to_do: "Trust the safety system - it's designed to protect your wellbeing."
    }
  };
  
  const response = fallbackResponses[source] || {
    reason: "This image was blocked because it may contain content that is not suitable for all audiences.",
    what_to_do: "Practice safe browsing by being cautious about the images you view online."
  };
  
  return {
    safe: false,
    title: "Inappropriate Image Blocked",
    reason: response.reason,
    what_to_do: response.what_to_do,
    category: "explicit_image",
    confidence: 90
  };
}

/**
 * Gets a generic title for a category (fallback when API fails)
 * @param {string} category The content category
 * @returns {string} Generic title
 */
function getGenericTitle(category) {
  const titles = {
    'profanity': 'Inappropriate Language Detected',
    'hate_speech': 'Hate Speech Detected',
    'explicit_content': 'Adult Content Detected',
    'explicit_image': 'Inappropriate Image Blocked',
    'sexual_conversation': 'Inappropriate Message Detected',
    'predatory': 'Warning: Potentially Unsafe Interaction',
    'violent': 'Violent Content Detected',
    'harassment': 'Harmful Content Detected',
    'self_harm': 'Sensitive Content Warning',
    'alcohol_drugs': 'Substance-Related Content Detected',
    'scam': 'Potential Scam Detected',
    'fraud': 'Fraud Attempt Detected'
  };
  return titles[category] || 'Content Warning';
}

/**
 * Gets a generic reason for a category (fallback when API fails)
 * @param {string} category The content category
 * @returns {string} Generic reason
 */
function getGenericReason(category) {
  const reasons = {
    'profanity': 'This content contains language that may be offensive or hurtful to others. Using respectful communication helps create a positive online environment.',
    'hate_speech': 'This content contains discriminatory language that targets individuals based on their identity. Such language contributes to harm and exclusion.',
    'explicit_content': 'This content appears to contain adult material that is not appropriate for all audiences and may be restricted.',
    'explicit_image': 'This image was blocked because it may contain content that is not suitable for all audiences. Exposure to explicit imagery can negatively impact mental wellbeing and is often age-restricted for good reason.',
    'sexual_conversation': 'This message contains inappropriate content. If you receive unwanted messages like this, you can report and block the sender.',
    'predatory': 'This content shows warning signs of potentially manipulative behavior. Be cautious of anyone trying to establish secret or inappropriate relationships.',
    'violent': 'This content contains threats or violent language. Such content can cause harm and is often against platform policies.',
    'harassment': 'This content contains language designed to hurt, intimidate, or belittle someone. Everyone deserves to be treated with respect.',
    'self_harm': 'This content discusses self-harm or suicide. If you or someone you know is struggling, please reach out for help.',
    'alcohol_drugs': 'This content promotes or discusses substance use. Be aware of the risks associated with alcohol and drug consumption.',
    'scam': 'This message shows common signs of a scam, such as promises of easy money or prizes. Legitimate opportunities rarely come unsolicited.',
    'fraud': 'This appears to be an attempt to steal personal information. Never share passwords, OTPs, or financial details with strangers.'
  };
  return reasons[category] || 'This content has been flagged as potentially harmful or inappropriate.';
}

/**
 * Gets generic guidance for a category (fallback when API fails)
 * @param {string} category The content category
 * @returns {string} Generic guidance
 */
function getGenericGuidance(category) {
  const guidance = {
    'profanity': 'Consider how your words affect others. Click Cancel to continue without viewing, or Continue if you understand the content.',
    'hate_speech': 'Report this content if it violates platform policies. Do not engage with or share hateful content.',
    'explicit_content': 'This content is age-restricted. Navigate away if you are not of legal age.',
    'explicit_image': 'Practice safe browsing by avoiding websites known for adult content. If you encounter inappropriate images unexpectedly, close the page and consider reporting the content.',
    'sexual_conversation': 'If this is unwanted, block the sender and report the message. Talk to a trusted adult if you feel uncomfortable.',
    'predatory': 'Never share personal information or meet strangers alone. Tell a trusted adult if someone makes you uncomfortable.',
    'violent': 'Report violent threats to the platform and authorities if necessary. Your safety is important.',
    'harassment': "You don't deserve to be treated this way. Report, block, and talk to someone you trust.",
    'self_harm': 'HOPELINE Philippines: 0917-558-4673 | US: 988 | You are not alone. Please talk to someone who cares about you.',
    'alcohol_drugs': 'If you or someone you know needs help with substance use, reach out to a counselor or helpline.',
    'scam': 'Do not click any links or share personal information. Report and block the sender.',
    'fraud': 'Never share sensitive information. Legitimate companies will never ask for passwords or OTPs via message.'
  };
  return guidance[category] || 'Consider whether you need to view this content. Your wellbeing matters.';
}

/**
 * PHASE 1: Instant local blocking - blocks obvious content without API
 * This runs BEFORE any API calls for maximum speed
 * Now triggers background fetch for educational Gemini response
 * @param {HTMLElement} element - Element to check
 * @param {string} contentText - Text content to analyze
 * @returns {Object|null} - Block response if should be blocked, null if unclear
 */
function instantLocalBlock(element, contentText) {
  const content = contentText.toLowerCase().trim();
  
  // Skip if too short
  if (content.length < 5) return null;
  
  // 1. PROFANITY CHECK - English, Filipino, and Cebuano
  // English profanity
  const englishProfanity = /\b(fuck|fucking|fucker|fucked|motherfucker|mother fucker|shit|bitch|ass|asshole|bastard|damn|hell|cunt|whore|slut|dick|pussy|cock|cum|orgasm)\b/i;
  
  // Filipino/Tagalog profanity
  const filipinoProfanity = /\b(putang\s*ina|putangina|tangina|puta|gago|bobo|tanga|ulol|tarantado|leche|pokpok|pakshet|pakyu|hayop|siraulo|shunga|buwisit|punyeta|hinayupak|peste|kupal|gunggong|engot|inutil|burat|titi|puke|kantot|jakol|malibog|kalibugan|chupa|bolitas|libog|lintik|pesteng yawa|tang\s*ina|pota|potah|gagu|bwisit|kinangina|kingina|ampota|amputa|tangena|tanginamo|putanginamo|g@go|t@nga|put@ngina)\b/i;
  
  // Cebuano/Bisaya profanity  
  const cebuanoProfanity = /\b(yawa|buang|animal|bogo|bugo|pisti|piste|giatay|bilat|oten|bayot|unggoy|tanga|atay|tae|pisting\s*yawa|yawa\s*ka|buang\s*ka|animal\s*ka|iyot|hubog|libog|laway|hilabtan|hubo|way\s*buot|burot|ulaga|gagu|pisteng yawa|yawaon|yaw\s*a|bu@ng|ist@|g@go)\b/i;
  
  if (englishProfanity.test(content) || filipinoProfanity.test(content) || cebuanoProfanity.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Profanity detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Inappropriate Language Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "profanity",
      confidence: 95,
      originalContent: contentText.substring(0, 500) // Store for on-demand fetch
    };
  }
  
  // 2. RACIAL SLURS / HATE SPEECH - English and Filipino context
  const racialSlurPattern = /\b(nigger|nigga|chink|spic|wetback|kike|raghead|gook|beaner|intsik\s*beho|negrito|baluga|ita)\b/i;
  
  if (racialSlurPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Racial slur detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Hate Speech Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "hate_speech",
      confidence: 99,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 3. EXPLICIT SEXUAL CONTENT / SEXUAL CONVERSATION - All languages
  const explicitSexPattern = /\b(porn|pornhub|xvideos|xnxx|xxx|nude|naked|sex video|adult content|hardcore|masturbat|blowjob|handjob|anal sex|erotic|nsfw|18\+|kantot|jakol|chupa|iyot|malibog|kalibugan|libog|hubog|hubo|hilabtan|bolitas|manyak|bastos|send nudes|want to see you naked|show me your body|let's have sex|tara sex|g2sta kita|gusto kita kantutin)\b/i;
  
  if (explicitSexPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Explicit/sexual content (0ms)");
    const category = content.match(/send nudes|want to see|show me|let's have sex|tara sex|gusto kita/i) 
      ? 'sexual_conversation' 
      : 'explicit_content';
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: category === 'sexual_conversation' ? "Inappropriate Message Detected" : "Adult Content Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: category,
      confidence: 95,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 4. PREDATORY / GROOMING BEHAVIOR - All languages
  const predatoryPattern = /\b(you're mature for your age|our little secret|don't tell your parents|don't tell anyone|meet me alone|send me pictures|alam mo ba ikaw lang|huwag mong sabihin|secret lang natin|ayaw isulti sa imong mama|sekreto ra nato|tara private|private tayo|dm me baby|age is just a number|edad lang yan)\b/i;
  
  if (predatoryPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Predatory behavior detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Warning: Potentially Unsafe Interaction",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "predatory",
      confidence: 97,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 5. VIOLENT THREATS / VIOLENCE - All languages
  const violentPattern = /\b(i will kill you|i'll kill you|gonna kill you|want to kill|going to hurt you|beat you up|break your bones|you will die|you're dead|papatayin kita|patayin kita|sasaktan kita|babugbugin kita|patyon tika|samaran tika|bunalon tika|mamatay ka|dapat mamatay)\b/i;
  
  if (violentPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Violence/threats detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Violent Content Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "violent",
      confidence: 98,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 6. HARASSMENT / BULLYING - All languages
  const harassmentPattern = /\b(you're worthless|nobody likes you|everyone hates you|kill yourself|go die|you're ugly|you're fat|you're stupid|loser|pathetic|wala kang kwenta|pangit mo|walang nagmamahal sayo|mamatay ka na|dapat wala ka na|way pulos ka|pangit ka|walay nagmahal nimo|mamatay na lang ka)\b/i;
  
  if (harassmentPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Harassment detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Harmful Content Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "harassment",
      confidence: 96,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 7. SUICIDE/SELF-HARM - English and Filipino (critical priority)
  const suicidePattern = /\b(suicide|kill myself|kill yourself|self harm|self-harm|cut myself|end my life|want to die|better off dead|hang myself|overdose|slit wrist|jump off|commit suicide|suicidal thought|magpakamatay|papatayin ko sarili|gusto kong mamatay|ayoko na mabuhay|patyon nako akong kaugalingon|gusto ko mamatay|dili na ko ganahan mbuhi)\b/i;
  
  if (suicidePattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Suicide/self-harm content (0ms)");
    // For self-harm, we show crisis resources IMMEDIATELY - no need to fetch
    return {
      safe: false,
      title: "Sensitive Content Warning",
      reason: "This content discusses sensitive topics related to mental health and wellbeing. Help is available.",
      what_to_do: "HOPELINE Philippines: 0917-558-4673 | US: 988 | You are not alone. Please talk to someone who cares about you.",
      category: "self_harm",
      confidence: 99,
      originalContent: contentText.substring(0, 500),
      skipEducationalFetch: true // Already has crisis resources
    };
  }
  
  // 8. ALCOHOL & DRUGS - All languages
  const alcoholDrugsPattern = /\b(let's get drunk|get wasted|buy drugs|selling drugs|marijuana for sale|shabu|cocaine|heroin|meth|ecstasy|molly|weed for sale|inom tayo|tara inom|lasing na|mag-droga|bili ng droga|hubog na|tara shot|tagay tayo|walwal tayo|legit seller|dm for drugs)\b/i;
  
  if (alcoholDrugsPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Alcohol/drugs content (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Substance-Related Content Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "alcohol_drugs",
      confidence: 90,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 9. SCAM/PHISHING PATTERNS - English, Filipino, and Cebuano
  const scamPatternEnglish = /\b(congratulations.*won|claim your prize|urgent.*act now|click here.*whatsapp|wa\.me|telegram.*money|earn \$\d+|get rich quick|investment opportunity.*guaranteed|free money|work from home.*\$\d+|you have been selected|lottery winner|inheritance from|nigerian prince)\b/i;
  
  const scamPatternFilipino = /\b(nanalo ka|panalo ka|kunin ang premyo|trabaho sa bahay|malaking sweldo|kumita agad|i-click dito|dali lang|libre.*premyo|congratulations.*nanalo|selected ka|claim.*prize|swerte mo)\b/i;
  
  const scamPatternCebuano = /\b(daog ka|kuhaa ang premyo|trabaho sa balay|dako nga suweldo|kita dayon|i-click diri|pinduta|sayon ra|libre.*premyo|daog.*prize|swerte nimo)\b/i;
  
  if (scamPatternEnglish.test(content) || scamPatternFilipino.test(content) || scamPatternCebuano.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Scam/phishing detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Potential Scam Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "scam",
      confidence: 85,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 10. FRAUD / IDENTITY THEFT - All languages
  const fraudPattern = /\b(send your password|give me your otp|verify your account urgently|i'm from microsoft|irs calling|send money now|western union|money gram|bank transfer urgently|your account will be closed|ipadala ang password|ibigay ang otp|i-verify agad|ipadala ug kwarta|magpadala ug)\b/i;
  
  if (fraudPattern.test(content)) {
    console.log("⚡ Sentry: INSTANT BLOCK - Fraud detected (0ms)");
    // NO API CALL HERE - educational reason will be fetched ON-DEMAND when user clicks
    return {
      safe: false,
      title: "Fraud Attempt Detected",
      reason: "Click to learn why this content was blocked and get helpful information.",
      what_to_do: "Tap to see details about this content.",
      category: "fraud",
      confidence: 92,
      originalContent: contentText.substring(0, 500)
    };
  }
  
  // 11. KNOWN EXPLICIT DOMAINS (for images)
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
    
    // SECOND: Skip findSuspiciousImages - rely on backend NSFW model instead
    // The NSFW model is more accurate than keyword matching
    // (Disabled because keywords like 'bikini' cause false positives)
    /*
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
    */
    
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
        console.log(`Sentry: Sending image for analysis... (${visionAPICallCount} images)`);
        
        // Use backend NSFW model (most accurate) or fall back to Vision API
        const analyzeImage = USE_BACKEND_NSFW ? analyzeImageWithBackendNSFW : analyzeImageWithVisionAPI;
        
        analyzeImage(element, imgSrc, contentToScan).then(result => {
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
    // Limit batch size to avoid 400 errors (backend limit is 50)
    const MAX_BATCH_SIZE = 50;
    if (elementsNeedingAI.length > MAX_BATCH_SIZE) {
      console.log(`⚡ Sentry: Limiting batch from ${elementsNeedingAI.length} to ${MAX_BATCH_SIZE} elements`);
      elementsNeedingAI.length = MAX_BATCH_SIZE;
      elementsMetadata.length = MAX_BATCH_SIZE;
    }
    
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
  
  // Facebook Feed - Newsfeed only (middle section, NOT sidebar!)
  if (isFacebook && !window.location.pathname.includes('/messages/')) {
    const feedSelectors = [
      'div[role="feed"]', // Main newsfeed - most specific
      'div[role="main"] div[role="feed"]', // Feed inside main
      'div[data-pagelet="Feed"]', // Facebook pagelet feed
      'div[data-pagelet="MainFeed"]'
    ];
    
    for (const selector of feedSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Facebook feed area (center column): ${selector}`);
        return container;
      }
    }
    
    // Fallback: Try to find main content area excluding right sidebar
    const mainContent = document.querySelector('div[role="main"]');
    if (mainContent) {
      console.log(`✅ Sentry: Scanning Facebook main area (excluding sidebar)`);
      return mainContent;
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
  
  // Twitter/X - Main timeline only (center column)
  if (isTwitter) {
    const twitterSelectors = [
      'div[data-testid="primaryColumn"]', // Main timeline column
      'main[role="main"]',
      'section[role="region"]'
    ];
    
    for (const selector of twitterSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`✅ Sentry: Scanning ONLY Twitter/X main column: ${selector}`);
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
  // Check for data-sentry-ui attribute FIRST (fastest check)
  if (el.hasAttribute('data-sentry-ui') ||
      el.closest('[data-sentry-ui="true"]') ||
      el.classList.contains('sentry-blocked-content') ||
      el.classList.contains('sentry-confirmation-overlay') ||
      el.classList.contains('sentry-confirmation-popup') ||
      el.classList.contains('sentry-popup-header') ||
      el.classList.contains('sentry-popup-content') ||
      el.classList.contains('sentry-popup-reason') ||
      el.classList.contains('sentry-popup-guidance') ||
      el.classList.contains('sentry-popup-actions') ||
      el.classList.contains('sentry-popup-title') ||
      el.classList.contains('sentry-popup-reason-text') ||
      el.classList.contains('sentry-popup-guidance-text') ||
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
  
  // 🖼️ DISABLED: Associated image blocking causes false positives
  // Images should ONLY be blocked by the NSFW model, not by text association
  // This was blocking safe images just because they were near any flagged text
  /*
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
  */
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
    // Apply inline styles directly for maximum override (Twitter/X uses !important)
    element.style.setProperty('filter', 'blur(30px)', 'important');
    element.style.setProperty('cursor', 'pointer', 'important');
    element.style.setProperty('pointer-events', 'auto', 'important');
    element.style.setProperty('user-select', 'none', 'important');
    element.style.setProperty('transition', 'filter 0.3s ease', 'important');
    element.style.setProperty('opacity', '1', 'important');
    
    // Prevent default image behaviors (like drag, right-click save)
    element.setAttribute('draggable', 'false');
    element.addEventListener('dragstart', (e) => e.preventDefault());
    
    // For Twitter/X: Also blur parent containers that might contain the image
    if (isTwitter) {
      const twitterContainers = [
        element.closest('div[data-testid="tweetPhoto"]'),
        element.closest('div[data-testid="card.wrapper"]'),
        element.closest('a[href*="/photo/"]'),
        element.closest('div[style*="background-image"]')
      ];
      
      twitterContainers.forEach(container => {
        if (container && !container.classList.contains('sentry-image-wrapper-blocked')) {
          container.style.setProperty('filter', 'blur(30px)', 'important');
          container.style.setProperty('overflow', 'hidden', 'important');
          container.classList.add('sentry-image-wrapper-blocked');
          console.log(`🖼️ Sentry: Also blurred Twitter container`);
        }
      });
    }
    
    console.log(`🖼️ Sentry: Applied blur to image: ${element.src?.substring(0, 50)}...`);
    
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
 * LAZY LOADING: Fetches educational reason ON-DEMAND (only when user clicks)
 * This dramatically reduces API calls - no API call happens unless user clicks
 * @param {Element} element The blocked element
 * @param {Object} aiResponse The AI response with blocking details
 */
function showConfirmationPopup(element, aiResponse) {
  // Get the stored response for this element
  const storedResponse = blockedElements.get(element) || aiResponse;
  
  console.log("🚨 Sentry: POPUP TRIGGERED (lazy loading)!", {
    element: element.tagName,
    category: storedResponse.category,
    title: storedResponse.title,
    hasOriginalContent: !!storedResponse.originalContent,
    educationalFetched: storedResponse.educationalFetched || false,
    skipEducationalFetch: storedResponse.skipEducationalFetch || false
  });
  
  // Remove any existing popups
  const existingPopup = document.querySelector('.sentry-confirmation-overlay');
  if (existingPopup) {
    existingPopup.remove();
  }
  
  // Create overlay - mark as Sentry UI to prevent scanning
  const overlay = document.createElement('div');
  overlay.className = 'sentry-confirmation-overlay';
  overlay.setAttribute('data-sentry-ui', 'true');
  
  // Create popup - mark as Sentry UI to prevent scanning
  const popup = document.createElement('div');
  popup.className = `sentry-confirmation-popup sentry-popup-category-${storedResponse.category}`;
  popup.setAttribute('data-sentry-ui', 'true');
  
  // Create header - mark as Sentry UI
  const header = document.createElement('div');
  header.className = 'sentry-popup-header';
  header.setAttribute('data-sentry-ui', 'true');
  
  const icon = document.createElement('div');
  icon.className = 'sentry-popup-icon';
  icon.setAttribute('data-sentry-ui', 'true');
  icon.textContent = getIconForCategory(storedResponse.category);
  
  const title = document.createElement('h2');
  title.className = 'sentry-popup-title';
  title.setAttribute('data-sentry-ui', 'true');
  title.textContent = storedResponse.title || 'Content Warning';
  
  header.appendChild(icon);
  header.appendChild(title);
  
  // Create content area - mark as Sentry UI
  const content = document.createElement('div');
  content.className = 'sentry-popup-content';
  content.setAttribute('data-sentry-ui', 'true');
  
  // Reason section - mark as Sentry UI
  const reasonSection = document.createElement('div');
  reasonSection.className = 'sentry-popup-reason';
  reasonSection.setAttribute('data-sentry-ui', 'true');
  
  const reasonTitle = document.createElement('div');
  reasonTitle.className = 'sentry-popup-reason-title';
  reasonTitle.setAttribute('data-sentry-ui', 'true');
  reasonTitle.textContent = '📚 Why is this blocked?';
  
  const reasonText = document.createElement('p');
  reasonText.className = 'sentry-popup-reason-text';
  reasonText.setAttribute('data-sentry-ui', 'true');
  
  // Guidance section - mark as Sentry UI
  const guidanceSection = document.createElement('div');
  guidanceSection.className = 'sentry-popup-guidance';
  guidanceSection.setAttribute('data-sentry-ui', 'true');
  
  const guidanceTitle = document.createElement('div');
  guidanceTitle.className = 'sentry-popup-guidance-title';
  guidanceTitle.setAttribute('data-sentry-ui', 'true');
  guidanceTitle.textContent = '💡 What should you do?';
  
  const guidanceText = document.createElement('p');
  guidanceText.className = 'sentry-popup-guidance-text';
  guidanceText.setAttribute('data-sentry-ui', 'true');
  
  // 🚀 LAZY LOADING: Fetch educational content ON-DEMAND
  // Check if we already have the educational content fetched
  if (storedResponse.educationalFetched || storedResponse.skipEducationalFetch) {
    // Already have the full content (from previous fetch or self-harm which has immediate resources)
    reasonText.textContent = storedResponse.reason;
    guidanceText.textContent = storedResponse.what_to_do;
  } else if (storedResponse.originalContent || storedResponse.imageContext) {
    // Need to fetch educational content NOW (on-demand)
    reasonText.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div class="sentry-loading-spinner"></div>
        <em style="color: #666;">Preparing explanation...</em>
      </div>
    `;
    guidanceText.innerHTML = '<em style="color: #888;">Please wait...</em>';
    
    // Add loading spinner CSS if not already present
    if (!document.querySelector('#sentry-loading-styles')) {
      const style = document.createElement('style');
      style.id = 'sentry-loading-styles';
      style.textContent = `
        .sentry-loading-spinner {
          width: 20px;
          height: 20px;
          border: 3px solid #e0e0e0;
          border-top: 3px solid #4a90d9;
          border-radius: 50%;
          animation: sentry-spin 1s linear infinite;
        }
        @keyframes sentry-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // 🎯 FETCH EDUCATIONAL REASON ON-DEMAND
    // Use image-specific fetch if this is an image, otherwise use text fetch
    const isImageContent = storedResponse.imageContext || storedResponse.category === 'explicit_image';
    
    console.log(`📚 Sentry: Fetching educational reason ON-DEMAND for ${storedResponse.category} (${isImageContent ? 'IMAGE' : 'TEXT'})...`);
    
    const fetchPromise = isImageContent 
      ? fetchImageEducationalReason(storedResponse.imageContext || {}, storedResponse.category)
      : fetchEducationalReason(storedResponse.originalContent, storedResponse.category);
    
    fetchPromise
      .then(educationalResponse => {
        // Update the popup with the fetched content
        reasonText.textContent = educationalResponse.reason;
        guidanceText.textContent = educationalResponse.what_to_do;
        
        // Update the stored response so we don't fetch again
        const updatedResponse = {
          ...storedResponse,
          reason: educationalResponse.reason,
          what_to_do: educationalResponse.what_to_do,
          title: educationalResponse.title || storedResponse.title,
          educationalFetched: true
        };
        blockedElements.set(element, updatedResponse);
        
        // Update title if provided
        if (educationalResponse.title) {
          const titleEl = popup.querySelector('.sentry-popup-title');
          if (titleEl) {
            titleEl.textContent = educationalResponse.title;
          }
        }
        
        console.log(`✅ Sentry: Educational content loaded for ${storedResponse.category}`);
      })
      .catch(error => {
        console.error('Sentry: Error fetching educational reason:', error);
        // Use fallback generic content
        reasonText.textContent = getGenericReason(storedResponse.category);
        guidanceText.textContent = getGenericGuidance(storedResponse.category);
      });
  } else {
    // No original content stored (shouldn't happen, but fallback to generic)
    reasonText.textContent = getGenericReason(storedResponse.category);
    guidanceText.textContent = getGenericGuidance(storedResponse.category);
  }
  
  reasonSection.appendChild(reasonTitle);
  reasonSection.appendChild(reasonText);
  
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
  continueButton.textContent = 'I Understand';
  continueButton.addEventListener('click', () => {
    console.log("✅ Sentry: User acknowledged warning - keeping content blocked for safety");
    
    // Just close the popup - content stays blurred for protection
    // This aligns with the purpose of a content blocker:
    // educate the user, but still protect them from the content
    overlay.remove();
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

/**
 * 🖼️ DYNAMIC IMAGE SCANNER - Scans new images as they appear on the page
 * This handles dynamically loaded content (Facebook, Twitter, Instagram, etc.)
 * @param {HTMLImageElement} img - Image element to scan
 */
async function scanNewImage(img) {
  // Skip if already scanned or blocked
  if (scannedElements.has(img) || 
      img.classList.contains('sentry-blocked-content') ||
      img.hasAttribute('data-sentry-scanned')) {
    return;
  }
  
  // Mark as being scanned to prevent duplicate scans
  img.setAttribute('data-sentry-scanned', 'pending');
  
  // Skip tiny images (icons, avatars under 80px)
  if (img.naturalWidth < 80 || img.naturalHeight < 80) {
    if (img.width < 80 || img.height < 80) {
      img.setAttribute('data-sentry-scanned', 'skipped-small');
      return;
    }
  }
  
  // Skip Sentry UI images
  if (img.closest('.sentry-confirmation-overlay') ||
      img.closest('.sentry-confirmation-popup') ||
      img.id?.startsWith('sentry-')) {
    return;
  }
  
  const imgSrc = img.src || img.dataset?.src || img.getAttribute('data-src') || '';
  
  // Skip if no valid src
  if (!imgSrc || imgSrc.startsWith('data:image/svg') || imgSrc.includes('emoji')) {
    img.setAttribute('data-sentry-scanned', 'skipped-nosrc');
    return;
  }
  
  // Get context
  const altText = img.alt || '';
  const parentText = img.closest('article, div, section')?.innerText?.substring(0, 200) || '';
  const context = `${altText} ${parentText}`.trim();
  
  console.log(`🖼️ Sentry: Scanning new image: ${imgSrc.substring(0, 60)}...`);
  
  // PHASE 1: Try instant image blocking first (0ms)
  const instantResult = instantImageBlock(img, imgSrc, context);
  
  if (instantResult) {
    if (instantResult.skipVisionAPI) {
      img.setAttribute('data-sentry-scanned', 'safe');
      scannedElements.add(img);
      return;
    }
    
    // Instant block!
    console.log(`⚡ Sentry: INSTANT IMAGE BLOCK on dynamic image!`);
    blockSpecificElement(img, instantResult);
    img.setAttribute('data-sentry-scanned', 'blocked');
    scannedElements.add(img);
    return;
  }
  
  // PHASE 2: Send to backend NSFW model
  try {
    const result = await analyzeImageWithBackendNSFW(img, imgSrc, context);
    
    if (!result.safe && result.category !== 'error' && result.confidence > 50) {
      console.log(`🔞 Sentry: Backend NSFW detected unsafe image - blocking!`);
      blockSpecificElement(img, result);
      img.setAttribute('data-sentry-scanned', 'blocked');
    } else {
      img.setAttribute('data-sentry-scanned', 'safe');
    }
    
    scannedElements.add(img);
    
  } catch (error) {
    console.error('Sentry: Error scanning dynamic image:', error);
    img.setAttribute('data-sentry-scanned', 'error');
    scannedElements.add(img);
  }
}

/**
 * 🖼️ Scans all visible images on the page
 * Called on initial load and periodically
 */
function scanAllVisibleImages() {
  // On social media, only scan images in main content area (not sidebar)
  const contentArea = isSocialMedia ? getMainContentArea() : document.body;
  if (!contentArea) return;
  
  const images = contentArea.querySelectorAll('img');
  let scannedCount = 0;
  
  images.forEach(img => {
    // Only scan visible, unscanned, large enough images
    if (img.offsetParent !== null && 
        !img.hasAttribute('data-sentry-scanned') &&
        !scannedElements.has(img) &&
        img.width >= 80 && img.height >= 80) {
      
      // Check if image is loaded
      if (img.complete && img.naturalWidth > 0) {
        scanNewImage(img);
        scannedCount++;
      } else {
        // Wait for image to load
        img.addEventListener('load', () => scanNewImage(img), { once: true });
      }
    }
  });
  
  if (scannedCount > 0) {
    console.log(`🖼️ Sentry: Queued ${scannedCount} images for NSFW scanning`);
  }
}

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
        
        // 🖼️ DYNAMIC IMAGE DETECTION - Scan new images immediately!
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the node itself is an image
          if (node.tagName === 'IMG') {
            if (node.complete && node.naturalWidth > 0) {
              scanNewImage(node);
            } else {
              node.addEventListener('load', () => scanNewImage(node), { once: true });
            }
          }
          
          // Check for images inside the added node
          const newImages = node.querySelectorAll?.('img') || [];
          newImages.forEach(img => {
            if (img.complete && img.naturalWidth > 0) {
              scanNewImage(img);
            } else {
              img.addEventListener('load', () => scanNewImage(img), { once: true });
            }
          });
        }
      });
    }
  });
  
  // Check for relevant changes - with STRICT filtering to avoid mouse movement triggers
  const relevantChanges = mutations.filter(mutation => {
    // Skip if target is not an element (text nodes don't have closest)
    if (!mutation.target || mutation.target.nodeType !== Node.ELEMENT_NODE) {
      // For text nodes, check parent
      if (mutation.target?.parentElement) {
        const parent = mutation.target.parentElement;
        if (parent.id?.startsWith('sentry-') || 
            parent.classList?.contains('sentry-blocked-content')) {
          return false;
        }
      }
    }
    
    // Skip Sentry elements (only for element nodes)
    if (mutation.target.nodeType === Node.ELEMENT_NODE) {
      if (mutation.target.id?.startsWith('sentry-') || 
          mutation.target.classList?.contains('sentry-blocked-content') ||
          mutation.target.classList?.contains('sentry-confirmation-overlay') ||
          mutation.target.closest?.('[id^="sentry-"]') ||
          mutation.target.closest?.('.sentry-confirmation-overlay')) {
        return false;
      }
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
            // ⚡ SKIP SENTRY UI ELEMENTS COMPLETELY
            if (node.hasAttribute?.('data-sentry-ui') ||
                node.closest?.('[data-sentry-ui="true"]') ||
                node.classList?.contains('sentry-confirmation-overlay') ||
                node.classList?.contains('sentry-confirmation-popup')) {
              return;
            }
            
            // ⚡ NEW APPROACH: Find the INNERMOST element with profanity
            // Instead of blocking parent + all children, find the smallest precise element
            
            const profanityElements = findProfanityElements(node);
            
            if (profanityElements.length > 0) {
              profanityElements.forEach(profanityEl => {
                // Skip if already processed
                if (scannedElements.has(profanityEl)) return;
                
                // Skip Sentry UI - comprehensive check
                if (profanityEl.hasAttribute?.('data-sentry-ui') ||
                    profanityEl.closest?.('[data-sentry-ui="true"]') ||
                    profanityEl.id?.startsWith('sentry-') || 
                    profanityEl.classList?.contains('sentry-blocked-content') ||
                    profanityEl.classList?.contains('sentry-confirmation-overlay') ||
                    profanityEl.classList?.contains('sentry-confirmation-popup') ||
                    profanityEl.classList?.contains('sentry-popup-title') ||
                    profanityEl.classList?.contains('sentry-popup-reason-text') ||
                    profanityEl.classList?.contains('sentry-popup-guidance-text')) {
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
              
              // Skip Sentry UI - comprehensive check
              if (parent.hasAttribute?.('data-sentry-ui') ||
                  parent.closest?.('[data-sentry-ui="true"]') ||
                  parent.id?.startsWith('sentry-') || 
                  parent.classList?.contains('sentry-blocked-content') ||
                  parent.classList?.contains('sentry-confirmation-overlay') ||
                  parent.classList?.contains('sentry-confirmation-popup') ||
                  parent.classList?.contains('sentry-popup-title') ||
                  parent.classList?.contains('sentry-popup-reason-text') ||
                  parent.classList?.contains('sentry-popup-guidance-text')) {
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
            node.parentNode.hasAttribute?.('data-sentry-ui') ||
            node.parentNode.closest?.('[data-sentry-ui="true"]') ||
            node.parentNode.classList?.contains('sentry-blocked-content') ||
            node.parentNode.classList?.contains('sentry-text-wrapper') ||
            node.parentNode.classList?.contains('sentry-confirmation-overlay') ||
            node.parentNode.classList?.contains('sentry-confirmation-popup') ||
            node.parentNode.classList?.contains('sentry-popup-title') ||
            node.parentNode.classList?.contains('sentry-popup-reason-text') ||
            node.parentNode.classList?.contains('sentry-popup-guidance-text') ||
            node.parentNode.hasAttribute?.('data-sentry-wrapped') ||
            node.parentNode.id?.startsWith('sentry-')) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip if any ancestor is already wrapped/blocked or is Sentry UI
        let ancestor = node.parentNode;
        while (ancestor && ancestor !== document.body) {
          if (ancestor.hasAttribute?.('data-sentry-ui') ||
              ancestor.classList?.contains('sentry-blocked-content') ||
              ancestor.classList?.contains('sentry-text-wrapper') ||
              ancestor.classList?.contains('sentry-confirmation-overlay') ||
              ancestor.classList?.contains('sentry-confirmation-popup') ||
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
      
      // Force inline blur style to override any platform CSS changes
      const currentFilter = element.style.filter;
      if (!currentFilter || !currentFilter.includes('blur')) {
        element.style.filter = 'blur(30px)';
        element.style.setProperty('filter', 'blur(30px)', 'important');
      }
    } else {
      // Element no longer in DOM, remove from tracking
      blockedElements.delete(element);
    }
  });
  
  // Also re-apply blur to all elements with sentry-blocked-content class
  // (in case class exists but styles were stripped)
  document.querySelectorAll('.sentry-blocked-content').forEach(element => {
    const currentFilter = element.style.filter;
    if (!currentFilter || !currentFilter.includes('blur')) {
      element.style.filter = 'blur(30px)';
      element.style.setProperty('filter', 'blur(30px)', 'important');
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
  
  // 🖼️ Initial image scan
  scanAllVisibleImages();
  
  // Periodically maintain blocked elements (every 2 seconds)
  setInterval(maintainBlockedElements, 2000);
  
  // 🖼️ Periodically scan for new images (every 3 seconds) - catches lazy-loaded images
  setInterval(scanAllVisibleImages, 3000);
});

// 🖼️ Scan images when user scrolls (catches lazy-loaded content)
const debouncedScrollScan = debounce(() => {
  scanAllVisibleImages();
}, 500);

window.addEventListener('scroll', debouncedScrollScan, { passive: true });

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
