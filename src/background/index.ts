chrome.runtime.onInstalled.addListener(() => {
  console.log('AIAutoFill extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ type: 'PONG' });
  }
});
