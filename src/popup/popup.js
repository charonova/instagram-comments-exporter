// Toolbar popup: opens the exporter on the current post, or says where it works.

const POST_URL = /^https:\/\/www\.instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/;
const INSTAGRAM_URL = /^https:\/\/www\.instagram\.com\//;

const message = document.getElementById('message');
const action = document.getElementById('action');

function offer(text, label, onClick) {
  message.textContent = text;
  action.hidden = !label;
  if (label) {
    action.textContent = label;
    action.onclick = onClick;
  }
}

async function openExporter(tabId) {
  // The exporter lives in the page's own world, so it is opened from there.
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => Boolean(window.__igce && window.__igce.ui && (window.__igce.ui.open(), true)),
  });
  if (result && result.result) window.close();
  else offer('The exporter is not loaded in this tab yet. Refresh the Instagram tab, then try again.');
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const url = (tab && tab.url) || '';

if (POST_URL.test(url)) {
  offer('Load, sort and download the comments on this post.', 'Open the exporter', () => openExporter(tab.id));
} else if (INSTAGRAM_URL.test(url)) {
  offer('Open a post or reel, then click Export comments at the bottom right of the page.');
} else {
  offer('This works on Instagram posts and reels.', 'Go to Instagram', () => {
    chrome.tabs.create({ url: 'https://www.instagram.com/' });
    window.close();
  });
}
