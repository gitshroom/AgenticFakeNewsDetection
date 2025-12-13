/**
 * Facebook Post Extractor Agent - Content Script
 * Revamped to capture the post a user pauses on (text + images)
 */

(() => {
  'use strict';

  const CONFIG = {
    DEBUG: true,
    VISIBILITY_THRESHOLD: 0.6, // fraction of post visible to consider "focused"
    SCROLL_IDLE_MS: 600,       // wait time after scroll stops before extracting
    INIT_DELAY_MS: 800,
    RECHECK_MS: 3000,
    MAX_POSTS_PER_PASS: 12
  };

  const state = {
    initialized: false,
    processedKeys: new Set(),
    visiblePosts: new Map(), // element => { ratio, lastSeen }
    observer: null,
    mutationObserver: null,
    scrollIdleTimer: null,
    url: location.href
  };

  const log = (...args) => {
    if (CONFIG.DEBUG) console.log('[Extractor Agent]', ...args);
  };

  const hashString = (input) => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  };

  const now = () => Date.now();

  const isComment = (el) => {
    if (el.closest('[data-pagelet*="comment"], [aria-label*="comment"], [data-testid*="comment"]')) {
      return true;
    }
    const nestedArticle = el.parentElement?.closest('[role="article"]');
    return !!(nestedArticle && nestedArticle !== el);
  };

  const isLikelyPost = (el) => {
    if (!el) return false;
    if (!(el.matches('[role="article"]') || el.matches('div[aria-posinset][aria-labelledby]'))) {
      return false;
    }
    if (isComment(el)) return false;
    const pagelet = el.getAttribute('data-pagelet') || '';
    if (/Ad|Sponsored/i.test(pagelet) || /sponsored/i.test(el.innerText || '')) return false;
    return true;
  };

  const getExpandedClone = (el) => {
    // Work on a detached clone to avoid user-visible clicks
    const clone = el.cloneNode(true);

    // Remove "see more"/"show more" nodes from clone so text can flow
    clone.querySelectorAll('[role="button"], span, div').forEach((node) => {
      const txt = (node.innerText || node.textContent || '').trim().toLowerCase();
      if (!txt) return;
      if (['see more', 'show more'].some(k => txt === k || txt.startsWith(k))) {
        node.remove();
      }
    });

    // Relax common clamping styles inside the clone
    clone.querySelectorAll('[style]').forEach((node) => {
      const style = node.getAttribute('style') || '';
      if (/-webkit-line-clamp|max-height|overflow:hidden|text-overflow/.test(style)) {
        node.style.webkitLineClamp = 'unset';
        node.style.maxHeight = 'none';
        node.style.overflow = 'visible';
        node.style.textOverflow = 'unset';
        node.style.display = 'block';
        node.style.whiteSpace = 'normal';
      }
    });

    return clone;
  };

  const extractCaption = (el) => {
    const workingEl = getExpandedClone(el);
    const blocks = [];

    const strongText = workingEl.querySelector('[data-ad-preview="message"]');
    if (strongText?.innerText) blocks.push(strongText.innerText.trim());

    workingEl.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach((node) => {
      if (node.closest('header, h1, h2, h3')) return;
      if (node.closest('[data-pagelet*="comment"]')) return;
      const text = (node.innerText || '').trim();
      if (text && text.length >= 5) blocks.push(text);
    });

    const clean = Array.from(new Set(blocks))
      .map(t => t.replace(/\s+/g, ' ').trim())
      .filter(t => t && t.length >= 5);

    return clean.join('\n\n').trim();
  };

  const extractImages = (el) => {
    const urls = new Set();

    el.querySelectorAll('img').forEach((img) => {
      if (img.closest('header, h1, h2, h3')) return;
      if (img.closest('[data-pagelet*="comment"]')) return;

      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!src.startsWith('http')) return;

      const lower = src.toLowerCase();
      if (['profile', 'avatar', 'emoji', 'icon', 'reaction', 'sprite'].some(k => lower.includes(k))) return;

      const rect = img.getBoundingClientRect();
      if (rect.width < 80 && rect.height < 80) return;

      urls.add(src);
    });

    el.querySelectorAll('div[style*="background-image"]').forEach((div) => {
      if (div.closest('header, h1, h2, h3')) return;
      if (div.closest('[data-pagelet*="comment"]')) return;
      const style = div.getAttribute('style') || '';
      const match = style.match(/url\(["']?([^"')]+)["']?\)/);
      if (match && match[1].startsWith('http')) {
        urls.add(match[1]);
      }
    });

    return Array.from(urls);
  };

  const extractAuthor = (el) => {
    const selectors = [
      'h2 a[role="link"]',
      'h3 a[role="link"]',
      '[data-testid="story-subtitle"] a',
      'a[role="link"][href*="/profile.php"]',
      'a[role="link"][href*="/user/"]'
    ];

    for (const selector of selectors) {
      const node = el.querySelector(selector);
      const text = node?.innerText?.trim();
      if (text && text.length < 120) return text;
    }
    return 'Unknown Author';
  };

  const buildPostKey = (el) => {
    const candidates = [
      el.getAttribute('data-pagelet'),
      el.getAttribute('aria-labelledby'),
      el.getAttribute('aria-posinset'),
      el.getAttribute('data-testid'),
      el.id
    ].filter(Boolean).join('|');

    const textPreview = extractCaption(el).slice(0, 120);
    const firstImg = extractImages(el)[0] || '';

    return `post_${hashString(candidates + '|' + textPreview + '|' + firstImg)}`;
  };

  const extractPost = (el) => {
    const postId = buildPostKey(el);
    if (state.processedKeys.has(postId)) return null;

    const text = extractCaption(el);
    const images = extractImages(el);
    if (!text && images.length === 0) return null;

    return {
      timestamp: new Date().toISOString(),
      postId,
      author: extractAuthor(el),
      text,
      images,
      url: location.href
    };
  };

  const runtimeAvailable = () => {
    return typeof chrome !== 'undefined' &&
           chrome?.runtime &&
           !!chrome.runtime.id;
  };

  const sendPost = (post) => {
    if (!runtimeAvailable()) {
      log('Runtime unavailable or reloaded; skipping send');
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'STORE_POST', data: post }, (response) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.includes('context invalidated')) {
            log('Extension context invalidated; will skip this cycle');
            return;
          }
          console.error('[Extractor Agent] Storage error:', chrome.runtime.lastError);
          return;
        }
        if (response?.success) {
          state.processedKeys.add(post.postId);
          log('Stored post', post.postId);
        }
      });
    } catch (err) {
      if (err?.message?.includes('context invalidated')) {
        log('Extension context invalidated (catch); skipping send');
        return;
      }
      console.error('[Extractor Agent] sendPost error:', err);
    }
  };

  const processVisible = () => {
    const entries = Array.from(state.visiblePosts.entries())
      .filter(([, meta]) => meta.ratio >= CONFIG.VISIBILITY_THRESHOLD)
      .sort((a, b) => b[1].ratio - a[1].ratio)
      .slice(0, CONFIG.MAX_POSTS_PER_PASS);

    entries.forEach(([el]) => {
      if (!document.body.contains(el)) {
        state.visiblePosts.delete(el);
        return;
      }
      const post = extractPost(el);
      if (post) sendPost(post);
    });
  };

  const onScrollStop = () => {
    if (state.scrollIdleTimer) clearTimeout(state.scrollIdleTimer);
    state.scrollIdleTimer = setTimeout(processVisible, CONFIG.SCROLL_IDLE_MS);
  };

  const watchMutations = () => {
    if (state.mutationObserver) state.mutationObserver.disconnect();
    const root = document.querySelector('[role="feed"]') ||
                 document.querySelector('[role="main"]') ||
                 document.body;

    state.mutationObserver = new MutationObserver(() => {
      registerPosts();
      onScrollStop();
    });

    state.mutationObserver.observe(root, { childList: true, subtree: true });
  };

  const registerPosts = () => {
    const candidates = document.querySelectorAll('[role="article"], div[aria-posinset][aria-labelledby]');
    candidates.forEach((el) => {
      if (!isLikelyPost(el)) return;
      if (!state.observer) return;
      try {
        state.observer.observe(el);
      } catch (e) {
        // Ignore if already observed
      }
    });
  };

  const setupIntersectionObserver = () => {
    if (state.observer) state.observer.disconnect();
    state.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!isLikelyPost(entry.target)) return;
        state.visiblePosts.set(entry.target, { ratio: entry.intersectionRatio, lastSeen: now() });
      });
    }, {
      threshold: [0, 0.25, 0.5, 0.75, 1]
    });
  };

  const init = () => {
    if (state.initialized) return;
    if (!runtimeAvailable()) {
      log('Runtime not ready; delaying init');
      setTimeout(init, 500);
      return;
    }
    state.initialized = true;
    log('🚀 Extractor Agent ready');

    setupIntersectionObserver();
    registerPosts();
    watchMutations();

    window.addEventListener('scroll', onScrollStop, { passive: true });
    window.addEventListener('resize', onScrollStop, { passive: true });

    setTimeout(processVisible, CONFIG.INIT_DELAY_MS);
    setInterval(() => registerPosts(), CONFIG.RECHECK_MS);
  };

  const checkNavigation = () => {
    if (location.href !== state.url) {
      state.url = location.href;
      state.processedKeys.clear();
      state.visiblePosts.clear();
      setupIntersectionObserver();
      registerPosts();
      log('Navigation detected, state reset');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  setInterval(checkNavigation, 1000);
})();
