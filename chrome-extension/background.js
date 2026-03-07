// background.js (Service Worker) v15
// 役割:
//   popup.js と content.js の橋渡し役。
//   popup.js から 'saveAppData' メッセージでデータを受け取り、
//   content.js から 'getAppData' メッセージでデータを返す。
//   ページ遷移をまたいでもデータが保持される。

let pendingAppData = null;  // 一時保存する申請データ

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // popup.js からデータを受け取って保存する
  if (message && message.action === 'saveAppData') {
    pendingAppData = message.data;
    console.log('[background] saveAppData: ' + JSON.stringify(pendingAppData));
    sendResponse({ status: 'saved' });
    return true;
  }

  // content.js からデータを要求された場合に返す
  if (message && message.action === 'getAppData') {
    console.log('[background] getAppData: ' + JSON.stringify(pendingAppData));
    sendResponse({ data: pendingAppData });
    return true;
  }

  // content.js からデータをクリアする要求
  if (message && message.action === 'clearAppData') {
    pendingAppData = null;
    console.log('[background] clearAppData');
    sendResponse({ status: 'cleared' });
    return true;
  }
});
