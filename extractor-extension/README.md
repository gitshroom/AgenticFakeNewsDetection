# Facebook Post Extractor Agent

A Chrome Extension (Manifest v3) that automatically extracts Facebook post content (text + image URLs) as you scroll through your Facebook feed. This is **Agent 1** of the Multi-Modal Agentic AI Approach for Fake News Detection on Facebook.

## 🎯 Features

- **Automatic Extraction**: Detects and extracts posts as they enter the viewport while scrolling
- **Multi-Modal Content**: Captures both text content and all image URLs from posts
- **Duplicate Prevention**: Each post is captured only once using unique post IDs
- **Local Storage**: All extracted data is stored locally using `chrome.storage.local`
- **Popup Viewer**: Beautiful UI to view all extracted posts with thumbnails
- **JSON Export**: Export all captured posts as a JSON file for further processing

## 📦 Installation

### Step 1: Download/Clone the Extension

1. Ensure all files are in the `extractor-extension` folder:
   ```
   extractor-extension/
   ├── manifest.json
   ├── content.js
   ├── background.js
   ├── popup.html
   ├── popup.js
   ├── popup.css
   └── README.md
   ```

### Step 2: Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extractor-extension` folder
5. The extension should now appear in your extensions list

### Step 3: Pin the Extension (Optional)

1. Click the puzzle piece icon (🧩) in Chrome's toolbar
2. Find "Facebook Post Extractor Agent"
3. Click the pin icon to keep it visible

## 🚀 Usage

### Extracting Posts

1. Navigate to **https://www.facebook.com**
2. Log in to your Facebook account
3. Scroll through your feed normally
4. The extension automatically detects and extracts posts as they appear
5. Posts are stored locally - no data is sent to external servers

### Viewing Extracted Posts

1. Click the extension icon in your Chrome toolbar
2. The popup will show:
   - **Total Posts**: Number of posts extracted
   - **With Images**: Number of posts containing images
   - **Post Cards**: Scrollable list of all extracted posts
3. Click on any image thumbnail to view it in a new tab

### Exporting Data

1. Open the extension popup
2. Click **"📥 Export JSON"** button
3. A JSON file will be downloaded with all extracted posts
4. The file format is:
   ```json
   [
     {
       "timestamp": "2024-01-15T10:30:00.000Z",
       "postId": "post_1234567890",
       "text": "Post text content here...",
       "images": [
         "https://scontent.xx.fbcdn.net/...",
         "https://scontent.xx.fbcdn.net/..."
       ],
       "url": "https://www.facebook.com/..."
     }
   ]
   ```

### Clearing Data

1. Open the extension popup
2. Click **"🗑️ Clear All"** button
3. Confirm the action
4. All stored posts will be deleted

## 🔧 How It Works

### Architecture

```
┌─────────────────┐
│  Facebook.com   │
│  (Content Page) │
└────────┬────────┘
         │
         │ content.js injected
         ▼
┌─────────────────┐
│  Content Script │
│  - Detects posts│
│  - Extracts data│
│  - Sends to bg  │
└────────┬────────┘
         │
         │ chrome.runtime.sendMessage
         ▼
┌─────────────────┐
│ Background.js    │
│ (Service Worker)│
│  - Stores posts │
│  - Manages data │
└────────┬────────┘
         │
         │ chrome.storage.local
         ▼
┌─────────────────┐
│  Local Storage   │
└─────────────────┘
         │
         │ GET_POSTS message
         ▼
┌─────────────────┐
│  Popup UI       │
│  - Displays     │
│  - Exports      │
└─────────────────┘
```

### Post Detection

1. **MutationObserver**: Watches for new DOM elements added to the feed
2. **IntersectionObserver**: Detects when posts enter the viewport
3. **Scroll Events**: Throttled scroll handler processes visible posts
4. **Multiple Selectors**: Uses various CSS selectors to catch different Facebook layouts:
   - `article[role="article"]`
   - `div[role="article"]`
   - `[data-pagelet*="FeedUnit"]`
   - `[data-pagelet*="Story"]`

### Post Extraction

1. **Text Extraction**: 
   - Tries multiple selectors for post text
   - Falls back to extracting all text from post container
   - Removes UI elements (buttons, links) before extraction

2. **Image Extraction**:
   - Scans all `<img>` tags within the post
   - Filters out profile pictures, icons, and emojis
   - Extracts background images from divs
   - Cleans URLs (removes size parameters)

3. **Post ID Generation**:
   - Creates a unique hash from post content and attributes
   - Prevents duplicate extraction of the same post

### Storage

- Uses `chrome.storage.local` API
- Each post stored with:
  - `timestamp`: ISO 8601 format
  - `postId`: Unique identifier
  - `text`: Post text content
  - `images`: Array of image URLs
  - `url`: Page URL where post was found

## 📝 Data Format

Each extracted post follows this structure:

```typescript
interface ExtractedPost {
  timestamp: string;      // ISO 8601 timestamp
  postId: string;         // Unique post identifier
  text: string;           // Post text content
  images: string[];       // Array of image URLs
  url: string;           // Facebook page URL
}
```

## 🛠️ Technical Details

### Manifest v3 Compliance

- Uses Service Worker (`background.js`) instead of background page
- Content script runs at `document_idle`
- Proper permissions: `storage`, `activeTab`
- Host permissions for Facebook domains

### Performance Optimizations

- **Throttled Scroll Events**: 500ms throttle to prevent excessive processing
- **IntersectionObserver**: Only processes posts when visible
- **Debounced MutationObserver**: 1s debounce for DOM changes
- **Duplicate Prevention**: Set-based tracking of processed posts
- **Efficient Selectors**: Uses native querySelector for fast DOM traversal

### Robustness

- **Multiple Selectors**: Handles different Facebook layouts
- **Fallback Logic**: Multiple extraction strategies
- **Error Handling**: Try-catch blocks and error logging
- **SPA Navigation**: Detects Facebook's single-page app navigation

## 🔒 Privacy & Security

- **Local Storage Only**: All data stays on your device
- **No External Communication**: No data sent to external servers
- **No Authentication**: Doesn't access Facebook API or credentials
- **XSS Protection**: HTML escaping in popup UI

## 🐛 Troubleshooting

### Posts Not Being Extracted

1. **Check Console**: Open DevTools (F12) and check for errors
2. **Refresh Page**: Reload Facebook page to reinitialize the extension
3. **Check Permissions**: Ensure extension has access to Facebook
4. **Scroll More**: Some posts only load when scrolled into view

### Images Not Showing

- Facebook images may require authentication
- Some images might be blocked by CORS
- Check browser console for image loading errors

### Storage Full

- Chrome storage has limits (~10MB for local storage)
- Use "Clear All" to free up space
- Export data regularly to prevent storage issues

## 📊 Sample Screenshot Mockup

```
┌─────────────────────────────────────────┐
│  📰 Post Extractor Agent                │
│  Extracted Facebook Posts               │
├─────────────────────────────────────────┤
│  Total Posts: 42    With Images: 28     │
├─────────────────────────────────────────┤
│  [🔄 Refresh] [📥 Export JSON] [🗑️ Clear]│
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐ │
│  │ ID: post_1234...    2h ago        │ │
│  │                                   │ │
│  │ This is a sample Facebook post    │ │
│  │ with some text content...         │ │
│  │                                   │ │
│  │ [IMG] [IMG] [IMG] [IMG]          │ │
│  │ +2 more images                    │ │
│  └───────────────────────────────────┘ │
│  ┌───────────────────────────────────┐ │
│  │ ID: post_5678...    5h ago        │ │
│  │ ...                               │ │
│  └───────────────────────────────────┘ │
│                                         │
│  (scrollable list continues...)        │
└─────────────────────────────────────────┘
```

## 🔮 Future Enhancements

The extension can be extended with:

- ✅ **Backend API Integration**: Send posts to a server endpoint
- ✅ **Analyzer Agent Integration**: Format data for next agent in pipeline
- ✅ **Embedding Generation**: Create embeddings for semantic search
- ✅ **Hash-based Deduplication**: Use content hashes for better duplicate detection
- ✅ **Real-time Processing**: Stream posts to analysis pipeline
- ✅ **Filtering Options**: Filter by date, content type, etc.

## 📄 License

This project is part of a thesis: "A Multi-Modal Agentic AI Approach for Fake News Detection on Facebook"

## 👤 Author

Created for the Multi-Modal Agentic AI Thesis Project

---

**Note**: This extension is for research purposes. Ensure compliance with Facebook's Terms of Service and applicable data protection regulations when using this tool.

