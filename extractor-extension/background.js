/**
 * Facebook Post Extractor Agent - Background Service Worker
 * Handles storage of extracted posts
 */

// Storage key
const STORAGE_KEY = 'extracted_posts';

/**
 * Initialize storage on install
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Facebook Post Extractor Agent installed');
  
  // Initialize storage if needed
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
  });
});

/**
 * Handle messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STORE_POST') {
    storePost(message.data)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error storing post:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }

  if (message.type === 'GET_POSTS') {
    getPosts()
      .then((posts) => {
        sendResponse({ success: true, posts });
      })
      .catch((error) => {
        console.error('Error getting posts:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }

  if (message.type === 'CLEAR_POSTS') {
    clearPosts()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error clearing posts:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
});

/**
 * Store a post in chrome.storage.local
 */
async function storePost(postData) {
  return new Promise((resolve, reject) => {
    console.log('[Background] Storing post:', {
      postId: postData.postId?.substring(0, 15),
      author: postData.author?.substring(0, 20),
      textLength: postData.text?.length || 0,
      imageCount: postData.images?.length || 0
    });

    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Error getting storage:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const posts = result[STORAGE_KEY] || [];
      console.log('[Background] Current stored posts:', posts.length);
      
      // Check if post already exists (by postId)
      const existingIndex = posts.findIndex(p => p.postId === postData.postId);
      
      if (existingIndex >= 0) {
        // Update existing post
        console.log('[Background] Updating existing post at index:', existingIndex);
        posts[existingIndex] = postData;
      } else {
        // Add new post
        console.log('[Background] Adding new post. Total will be:', posts.length + 1);
        posts.push(postData);
      }

      // Store back
      chrome.storage.local.set({ [STORAGE_KEY]: posts }, () => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error setting storage:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log('[Background] ✅ Post stored successfully. Total posts:', posts.length);
          resolve();
        }
      });
    });
  });
}

/**
 * Get all stored posts
 */
async function getPosts() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        const posts = result[STORAGE_KEY] || [];
        // Sort by timestamp (newest first)
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(posts);
      }
    });
  });
}

/**
 * Clear all stored posts
 */
async function clearPosts() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

