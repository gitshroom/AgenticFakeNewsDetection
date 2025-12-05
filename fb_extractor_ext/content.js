// content.js
// Injects into Facebook pages, detects focused post (role="article" or nearest post container), extracts DOM text and image URLs and listens for messages from popup/background.
// Utilities
// content.js
// ===============
// FIND FOCUSED POST
// ===============
function findFocusedPost() {
    return (
        document.querySelector("[data-testid='photo-permalink-story']") ||
        document.querySelector("[role='article']") ||
        document.querySelector("div[data-ft]") ||
        null
    );
}

// ===============
// CONVERT IMAGE TO BASE64
// ===============
function imgToBase64(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
}

// ===============
// EXTRACT POST
// ===============
function extractPost(article) {
    if (!article) return null;

    const text = article.innerText || "";

    let images = [];
    const imgs = article.querySelectorAll("img");
    imgs.forEach(img => {
        try {
            images.push(imgToBase64(img));
        } catch (e) {
            console.warn("Failed to read image:", e);
        }
    });

    return { text, images };
}

// ===============
// MESSAGE HANDLER
// ===============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "EXTRACT_FOCUSED_POST") {
        const post = findFocusedPost();
        if (!post) {
            sendResponse({ success: false, error: "No post found" });
            return true;
        }

        const data = extractPost(post);
        sendResponse({ success: true, extracted: data });
    }
    return true;
});

