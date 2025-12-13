/**
 * Facebook Post Extractor Agent - Popup Script
 * Handles UI interactions and displays extracted posts
 */

// DOM elements
const postsContainer = document.getElementById('postsContainer');
const loading = document.getElementById('loading');
const emptyState = document.getElementById('emptyState');
const totalPostsEl = document.getElementById('totalPosts');
const postsWithImagesEl = document.getElementById('postsWithImages');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

/**
 * Render a single post card
 */
function renderPost(post) {
  const postCard = document.createElement('div');
  postCard.className = 'post-card';

  const hasText = post.text && post.text.trim().length > 0;
  const hasImages = post.images && post.images.length > 0;

  const author = post.author || 'Unknown Author';
  
  postCard.innerHTML = `
    <div class="post-header">
      <div class="post-author">👤 ${escapeHtml(author)}</div>
      <span class="post-timestamp">${formatTimestamp(post.timestamp)}</span>
    </div>
    ${hasText ? `<div class="post-text">${escapeHtml(post.text)}</div>` : '<div class="post-text empty">(No text content)</div>'}
    ${hasImages ? `
      <div class="post-images">
        ${post.images.slice(0, 4).map((imgUrl, idx) => `
          <img src="${imgUrl}" alt="Post image ${idx + 1}" class="post-image" 
               onclick="window.open('${imgUrl}', '_blank')" 
               onerror="this.style.display='none'">
        `).join('')}
      </div>
      ${post.images.length > 4 ? `<div class="image-count">+${post.images.length - 4} more images</div>` : ''}
    ` : ''}
    <div class="post-footer">
      <span class="post-id">ID: ${post.postId.substring(0, 12)}...</span>
    </div>
  `;

  return postCard;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Load and display posts
 */
async function loadPosts() {
  loading.style.display = 'block';
  emptyState.style.display = 'none';
  postsContainer.innerHTML = '';

  try {
    console.log('[Popup] Requesting posts from storage...');
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POSTS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] Error:', chrome.runtime.lastError);
          resolve({ success: false, posts: [] });
        } else {
          console.log('[Popup] Received response:', {
            success: response?.success,
            postCount: response?.posts?.length || 0
          });
          resolve(response);
        }
      });
    });

    if (response.success && response.posts) {
      const posts = response.posts;
      
      // Update stats
      totalPostsEl.textContent = posts.length;
      const withImages = posts.filter(p => p.images && p.images.length > 0).length;
      postsWithImagesEl.textContent = withImages;

      // Render posts
      if (posts.length === 0) {
        loading.style.display = 'none';
        emptyState.style.display = 'block';
      } else {
        posts.forEach(post => {
          postsContainer.appendChild(renderPost(post));
        });
        loading.style.display = 'none';
      }
    } else {
      loading.style.display = 'none';
      emptyState.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading posts:', error);
    loading.style.display = 'none';
    emptyState.style.display = 'block';
    postsContainer.innerHTML = `<div class="error">Error loading posts: ${error.message}</div>`;
  }
}

/**
 * Export posts as JSON
 */
async function exportPosts() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POSTS' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, posts: [] });
        } else {
          resolve(response);
        }
      });
    });

    if (response.success && response.posts) {
      const posts = response.posts;
      
      if (posts.length === 0) {
        alert('No posts to export.');
        return;
      }

      // Create JSON blob
      const json = JSON.stringify(posts, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `facebook_posts_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Show success message
      exportBtn.textContent = '✓ Exported!';
      setTimeout(() => {
        exportBtn.textContent = '📥 Export JSON';
      }, 2000);
    } else {
      alert('Failed to export posts.');
    }
  } catch (error) {
    console.error('Error exporting posts:', error);
    alert('Error exporting posts: ' + error.message);
  }
}

/**
 * Clear all posts
 */
async function clearPosts() {
  if (!confirm('Are you sure you want to clear all extracted posts? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CLEAR_POSTS' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false });
        } else {
          resolve(response);
        }
      });
    });

    if (response.success) {
      await loadPosts();
      clearBtn.textContent = '✓ Cleared!';
      setTimeout(() => {
        clearBtn.textContent = '🗑️ Clear All';
      }, 2000);
    } else {
      alert('Failed to clear posts.');
    }
  } catch (error) {
    console.error('Error clearing posts:', error);
    alert('Error clearing posts: ' + error.message);
  }
}

// Event listeners
refreshBtn.addEventListener('click', loadPosts);
exportBtn.addEventListener('click', exportPosts);
clearBtn.addEventListener('click', clearPosts);

// Load posts on popup open
loadPosts();

// Auto-refresh every 5 seconds when popup is open
setInterval(loadPosts, 5000);

