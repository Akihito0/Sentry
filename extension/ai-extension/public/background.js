// Sentry Background Service Worker
// Handles user identification and activity logging
// Logs are stored locally AND synced to backend for parent viewing

/*global chrome*/

// Backend URL for syncing activity logs
const BACKEND_URL = 'http://localhost:8000';

// Default configurable keywords for detection
const DEFAULT_KEYWORDS = [
  // English explicit
  'porn', 'xxx', 'nude', 'naked', 'sex', 'nsfw', 'adult content', 'explicit',
  // English violence/harmful
  'suicide', 'self harm', 'kill myself', 'how to kill',
  // Filipino/Tagalog
  'putangina', 'gago', 'bobo', 'tanga', 'puta', 'kantot', 'jakol',
  // Cebuano/Bisaya
  'yawa', 'buang', 'bilat', 'iyot',
  // Scam keywords
  'free money', 'you won', 'claim prize', 'lottery winner', 'investment opportunity'
];

// Common search engine patterns
const SEARCH_ENGINE_PATTERNS = [
  { host: 'google.com', param: 'q' },
  { host: 'google.', param: 'q' },
  { host: 'bing.com', param: 'q' },
  { host: 'duckduckgo.com', param: 'q' },
  { host: 'yahoo.com', param: 'p' },
  { host: 'yandex.', param: 'text' },
  { host: 'baidu.com', param: 'wd' },
  { host: 'ecosia.org', param: 'q' },
  { host: 'brave.com', param: 'q' }
];

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['currentUserEmail', 'familyId', 'keywords', 'activityLogs'], (result) => {
    if (!result.currentUserEmail) {
      chrome.storage.local.set({ currentUserEmail: '' });
    }
    if (!result.familyId) {
      chrome.storage.local.set({ familyId: '' });
    }
    if (!result.keywords) {
      chrome.storage.local.set({ keywords: DEFAULT_KEYWORDS });
    }
    if (!result.activityLogs) {
      chrome.storage.local.set({ activityLogs: [] });
    }
  });
  console.log('Sentry: Background service initialized');
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SET_CURRENT_USER':
      setCurrentUser(message.email, message.familyId).then(sendResponse);
      return true;

    case 'GET_CURRENT_USER':
      getCurrentUser().then(sendResponse);
      return true;

    case 'SET_FAMILY_ID':
      setFamilyId(message.familyId).then(sendResponse);
      return true;

    case 'GET_FAMILY_ID':
      getFamilyId().then(sendResponse);
      return true;

    case 'GET_KEYWORDS':
      getKeywords().then(sendResponse);
      return true;

    case 'SET_KEYWORDS':
      setKeywords(message.keywords).then(sendResponse);
      return true;

    case 'LOG_DETECTION':
      logDetection(message.detection).then(sendResponse);
      return true;

    case 'GET_LOGS':
      getLogs().then(sendResponse);
      return true;

    case 'CLEAR_LOGS':
      clearLogs().then(sendResponse);
      return true;

    case 'EXPORT_LOGS':
      exportLogs().then(sendResponse);
      return true;

    case 'IMPORT_LOGS':
      importLogs(message.logs).then(sendResponse);
      return true;

    case 'CHECK_SEARCH_QUERY':
      checkSearchQuery(message.url, sender.tab?.id).then(sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

// Current user management (stored locally - user sets their email)
async function setCurrentUser(email, familyId = '') {
  try {
    const updates = { currentUserEmail: email.toLowerCase() };
    if (familyId) {
      updates.familyId = familyId;
      
      // Auto-register this member with the family
      registerMemberWithFamily(email.toLowerCase(), familyId);
    }
    await chrome.storage.local.set(updates);
    console.log('Sentry: Set current user:', email, 'Family:', familyId);
    return { success: true };
  } catch (error) {
    console.error('Sentry: Error setting current user:', error);
    return { success: false, error: error.message };
  }
}

// Register member with family (adds to Firestore via backend)
async function registerMemberWithFamily(email, familyId) {
  try {
    const response = await fetch(`${BACKEND_URL}/register-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familyId: familyId,
        email: email,
        name: email.split('@')[0]
      })
    });
    
    if (response.ok) {
      console.log('Sentry: Member registration sent to backend');
      
      // Also sync any existing logs
      syncAllLogsToBackend();
    }
  } catch (error) {
    console.error('Sentry: Failed to register member:', error);
  }
}

async function getCurrentUser() {
  try {
    const result = await chrome.storage.local.get(['currentUserEmail', 'familyId']);
    return { 
      success: true, 
      email: result.currentUserEmail || '',
      familyId: result.familyId || ''
    };
  } catch (error) {
    console.error('Sentry: Error getting current user:', error);
    return { success: false, error: error.message, email: '', familyId: '' };
  }
}

async function setFamilyId(familyId) {
  try {
    await chrome.storage.local.set({ familyId });
    console.log('Sentry: Set family ID:', familyId);
    return { success: true };
  } catch (error) {
    console.error('Sentry: Error setting family ID:', error);
    return { success: false, error: error.message };
  }
}

async function getFamilyId() {
  try {
    const result = await chrome.storage.local.get(['familyId']);
    return { success: true, familyId: result.familyId || '' };
  } catch (error) {
    console.error('Sentry: Error getting family ID:', error);
    return { success: false, error: error.message, familyId: '' };
  }
}

// Keywords management
async function getKeywords() {
  try {
    const result = await chrome.storage.local.get(['keywords']);
    return { success: true, keywords: result.keywords || DEFAULT_KEYWORDS };
  } catch (error) {
    console.error('Sentry: Error getting keywords:', error);
    return { success: false, error: error.message, keywords: DEFAULT_KEYWORDS };
  }
}

async function setKeywords(keywords) {
  try {
    await chrome.storage.local.set({ keywords });
    console.log('Sentry: Updated keywords list');
    return { success: true };
  } catch (error) {
    console.error('Sentry: Error setting keywords:', error);
    return { success: false, error: error.message };
  }
}

// Activity logging functions (stored locally AND synced to backend)
async function logDetection(detection) {
  try {
    const result = await chrome.storage.local.get(['activityLogs', 'currentUserEmail', 'familyId']);
    const logs = result.activityLogs || [];
    const familyId = result.familyId || '';
    
    const logEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      userEmail: result.currentUserEmail || 'unknown',
      familyId: familyId,
      url: detection.url,
      type: detection.type, // 'search' or 'content'
      excerpt: detection.excerpt?.substring(0, 500) || '',
      matchedKeywords: detection.matchedKeywords || [],
      pageTitle: detection.pageTitle || ''
    };
    
    logs.push(logEntry);
    
    // Keep only last 1000 logs to prevent storage overflow
    const trimmedLogs = logs.slice(-1000);
    
    await chrome.storage.local.set({ activityLogs: trimmedLogs });
    console.log('Sentry: Logged detection:', logEntry.type, logEntry.excerpt.substring(0, 50));
    
    // Sync to backend if familyId is set (so parents can see activity)
    if (familyId) {
      syncLogToBackend(logEntry);
    }
    
    return { success: true, log: logEntry };
  } catch (error) {
    console.error('Sentry: Error logging detection:', error);
    return { success: false, error: error.message };
  }
}

// Sync a single log to backend (fire and forget)
async function syncLogToBackend(logEntry) {
  try {
    const response = await fetch(`${BACKEND_URL}/activity-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    });
    if (response.ok) {
      console.log('Sentry: Log synced to backend');
    }
  } catch (error) {
    console.error('Sentry: Failed to sync log to backend:', error);
    // Log is still saved locally, sync will happen on next detection
  }
}

// Sync all unsynced logs to backend (called periodically or on demand)
async function syncAllLogsToBackend() {
  try {
    const result = await chrome.storage.local.get(['activityLogs', 'familyId']);
    const logs = result.activityLogs || [];
    const familyId = result.familyId;
    
    if (!familyId || logs.length === 0) {
      return { success: true, synced: 0 };
    }
    
    const response = await fetch(`${BACKEND_URL}/activity-logs/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ familyId, logs })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Sentry: Batch synced', data.added, 'logs to backend');
      return { success: true, synced: data.added };
    }
    return { success: false, error: 'Backend sync failed' };
  } catch (error) {
    console.error('Sentry: Failed to batch sync logs:', error);
    return { success: false, error: error.message };
  }
}

async function getLogs() {
  try {
    const result = await chrome.storage.local.get(['activityLogs']);
    return { success: true, logs: result.activityLogs || [] };
  } catch (error) {
    console.error('Sentry: Error getting logs:', error);
    return { success: false, error: error.message, logs: [] };
  }
}

async function clearLogs() {
  try {
    await chrome.storage.local.set({ activityLogs: [] });
    console.log('Sentry: Cleared all logs');
    return { success: true };
  } catch (error) {
    console.error('Sentry: Error clearing logs:', error);
    return { success: false, error: error.message };
  }
}

async function exportLogs() {
  try {
    const result = await chrome.storage.local.get(['activityLogs', 'currentUserEmail']);
    const exportData = {
      exportedAt: new Date().toISOString(),
      currentUser: result.currentUserEmail || '',
      logs: result.activityLogs || []
    };
    return { success: true, data: exportData };
  } catch (error) {
    console.error('Sentry: Error exporting logs:', error);
    return { success: false, error: error.message };
  }
}

async function importLogs(importData) {
  try {
    if (!importData || !importData.logs) {
      return { success: false, error: 'Invalid import data' };
    }
    
    const result = await chrome.storage.local.get(['activityLogs']);
    const existingLogs = result.activityLogs || [];
    
    // Merge logs, avoiding duplicates by id
    const existingIds = new Set(existingLogs.map(l => l.id));
    const newLogs = importData.logs.filter(l => !existingIds.has(l.id));
    
    const mergedLogs = [...existingLogs, ...newLogs].slice(-1000);
    await chrome.storage.local.set({ activityLogs: mergedLogs });
    
    console.log('Sentry: Imported', newLogs.length, 'new logs');
    return { success: true, imported: newLogs.length };
  } catch (error) {
    console.error('Sentry: Error importing logs:', error);
    return { success: false, error: error.message };
  }
}

// Search query detection
async function checkSearchQuery(url, tabId) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Find matching search engine
    const searchEngine = SEARCH_ENGINE_PATTERNS.find(se => hostname.includes(se.host));
    
    if (!searchEngine) {
      return { success: true, detected: false };
    }
    
    const searchQuery = urlObj.searchParams.get(searchEngine.param);
    
    if (!searchQuery) {
      return { success: true, detected: false };
    }
    
    // Get keywords and check for matches
    const keywordsResult = await chrome.storage.local.get(['keywords']);
    const keywords = keywordsResult.keywords || DEFAULT_KEYWORDS;
    
    const queryLower = searchQuery.toLowerCase();
    const matchedKeywords = keywords.filter(kw => queryLower.includes(kw.toLowerCase()));
    
    if (matchedKeywords.length > 0) {
      // Log the detection
      await logDetection({
        url: url,
        type: 'search',
        excerpt: searchQuery,
        matchedKeywords: matchedKeywords,
        pageTitle: `Search: ${searchQuery.substring(0, 50)}`
      });
      
      return { success: true, detected: true, query: searchQuery, matchedKeywords };
    }
    
    return { success: true, detected: false };
  } catch (error) {
    console.error('Sentry: Error checking search query:', error);
    return { success: false, error: error.message, detected: false };
  }
}

// Listen for tab updates to detect search queries
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkSearchQuery(changeInfo.url, tabId);
  }
});

console.log('Sentry: Background service worker loaded');
