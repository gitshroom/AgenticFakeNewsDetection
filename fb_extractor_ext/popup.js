// popup.js 
// Sends message to content script to extract the focused post, then sends that data to the backend
// popup.js
const extractBtn = document.getElementById("extractBtn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

let BACKEND_URL = prompt("Paste your Colab /process URL: hello?", "https://primly-nonshedding-korbin.ngrok-free.dev/process");

function setStatus(text) {
    statusEl.textContent = text;
}

async function sendToBackend(payload) {
    setStatus("Sending to backend...");

    const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const msg = await res.text();
        throw new Error("Server error " + res.status + ": " + msg);
    }

    return res.json();
}

extractBtn.addEventListener("click", async () => {
    setStatus("Extracting post...");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_FOCUSED_POST" }, async (response) => {
        if (!response || !response.success) {
            setStatus("No post found.");
            return;
        }

        const extracted = response.extracted;

        outputEl.textContent =
            "Extracted text:\n" +
            extracted.text.slice(0, 500) +
            "\n\nImages: " +
            extracted.images.length;

        try {
            const backendResp = await sendToBackend(extracted);
            setStatus("Backend OK");
            outputEl.textContent = JSON.stringify(backendResp, null, 2);
        } catch (err) {
            setStatus("Backend error: " + err.message);
        }
    });
});
