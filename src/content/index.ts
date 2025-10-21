console.info('AIAutoFill content script loaded');

// Example: respond to messages from the extension
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_PAGE_INFO') {
    const title = document.title;
    sendResponse({ title });
  }
});
