# Debugging Guide

If the extension is not extracting posts, follow these steps:

## 1. Check Console Logs

1. Open Facebook in Chrome
2. Press `F12` to open Developer Tools
3. Go to the **Console** tab
4. Look for messages starting with `[Extractor Agent]`
5. You should see:
   - "Facebook Post Extractor Agent initialized"
   - "Processing initial posts..."
   - "Found X elements with selector: ..."
   - "Extracted post: ..."

## 2. Verify Extension is Running

1. Check if the extension icon appears in Chrome toolbar
2. Click the extension icon to open popup
3. If popup shows "No posts extracted yet", the extension is running but not finding posts

## 3. Test Post Detection

In the browser console (F12), run:

```javascript
// Check if posts are being found
document.querySelectorAll('[role="article"]').length

// Check feed container
document.querySelector('[role="main"]') || document.querySelector('[role="feed"]')
```

## 4. Manual Test Extraction

In the browser console, you can manually trigger extraction:

```javascript
// This will be available if content script is loaded
// Check if the extractor is initialized
console.log('Check for [Extractor Agent] logs above')
```

## 5. Common Issues

### Issue: No posts found
**Solution**: 
- Make sure you're on the Facebook feed (not a profile page)
- Scroll down to load more posts
- Refresh the page and try again

### Issue: Posts found but not extracted
**Solution**:
- Check console for errors
- Posts need both author AND (text OR images) to be extracted
- Some posts might be filtered out if they don't meet criteria

### Issue: Author shows as "Unknown Author"
**Solution**:
- Facebook's DOM structure may have changed
- Check console logs to see which selectors are working
- The extension will still extract text and images even if author is unknown

## 6. Enable More Debugging

To see more detailed logs, the extension has `DEBUG: true` in `content.js`. You can modify it to see more/less information.

## 7. Check Storage

In the browser console:

```javascript
// Check stored posts
chrome.storage.local.get(['extracted_posts'], (result) => {
  console.log('Stored posts:', result.extracted_posts);
  console.log('Count:', result.extracted_posts?.length || 0);
});
```

## 8. Reset Extension

If nothing works:
1. Open extension popup
2. Click "Clear All" to reset storage
3. Refresh Facebook page
4. Scroll through feed
5. Check console logs again

