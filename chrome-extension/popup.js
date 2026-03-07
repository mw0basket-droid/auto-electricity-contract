// popup.js v15
// データの受け渡し方法:
//   popup.js → background.js (saveAppData) → content.js (getAppData)
//   background.js が Service Worker として常駐し、データを一時保存する。
//   content.js はページ読み込み後に background.js に問い合わせてデータを取得する。

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/mw0basket-droid/auto-electricity-contract/main/pending_applications.json';
const PINT_SUPPLYPOINT_URL = 'https://kentaku.pint-cloud.com/supplypoint/';

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = 'msg-' + type;
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 8000);
}

function renderApplications(data) {
  const list = document.getElementById('app-list');
  const dateEl = document.getElementById('target-date');
  if (data.target_date) {
    dateEl.textContent = '対象日: ' + data.target_date;
  }
  if (!data.applications || data.applications.length === 0) {
    list.innerHTML = '<div class="empty-state">明日の申請予定はありません</div>';
    return;
  }
  list.innerHTML = '';
  data.applications.forEach((app, index) => {
    const item = document.createElement('div');
    item.className = 'application-item';
    item.innerHTML = `
      <div class="app-title">${app.title}</div>
      <div class="app-detail">地点コード: ${app.chiten_code}</div>
      <div class="app-detail">補足1: ${app.hosoku1}</div>
      <div class="app-detail">通電開始: ${app.power_on}</div>
      <div class="app-detail">通電停止: ${app.power_off}</div>
      <button class="btn btn-primary" data-index="${index}">PinTで自動入力を開始</button>
    `;
    list.appendChild(item);
  });
  document.querySelectorAll('.btn-primary').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      startAutoFill(data.applications[idx]);
    });
  });
}

async function startAutoFill(app) {
  showMessage('処理を開始しています...', 'info');
  console.log('[popup v15] startAutoFill app=' + JSON.stringify(app));

  // Step1: background.js にデータを保存する
  try {
    const saveResp = await chrome.runtime.sendMessage({ action: 'saveAppData', data: app });
    console.log('[popup v15] saveAppData応答: ' + JSON.stringify(saveResp));
  } catch (e) {
    console.log('[popup v15] saveAppData失敗: ' + e.message);
    showMessage('エラー: データ保存失敗 (' + e.message + ')', 'error');
    return;
  }

  // Step2: PinT タブを探す or 作成する
  const tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });
  let targetTabId;
  let targetTabUrl;

  if (tabs.length === 0) {
    console.log('[popup v15] PinTタブなし → 新規作成');
    showMessage('でんき地点管理ページを開いています...', 'info');
    const newTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    targetTabId = newTab.id;
    await waitForTabLoad(targetTabId);
    const updatedTab = await chrome.tabs.get(targetTabId);
    targetTabUrl = updatedTab.url || '';
    console.log('[popup v15] 新規タブURL=' + targetTabUrl);
  } else {
    targetTabId = tabs[0].id;
    targetTabUrl = tabs[0].url || '';
    await chrome.tabs.update(targetTabId, { active: true });
    console.log('[popup v15] PinTタブ発見 tabId=' + targetTabId + ' url=' + targetTabUrl);
  }

  // Step3: /supplypoint/ 系にいない場合のみ移動する
  const isSupplyPointPage = targetTabUrl.includes('kentaku.pint-cloud.com/supplypoint');
  if (!isSupplyPointPage) {
    console.log('[popup v15] /supplypoint/ 以外にいるため移動: ' + targetTabUrl);
    showMessage('でんき地点管理ページに移動中...', 'info');
    await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
    await waitForTabLoad(targetTabId);
    const updatedTab = await chrome.tabs.get(targetTabId);
    targetTabUrl = updatedTab.url || '';
    console.log('[popup v15] 移動後URL=' + targetTabUrl);
  } else {
    console.log('[popup v15] /supplypoint/ 系にいます: ' + targetTabUrl);
  }

  // Step4: content.js に startFill メッセージを送る
  // content.js は background.js にデータを問い合わせて処理を開始する
  console.log('[popup v15] sendMessage送信 tabId=' + targetTabId);
  let messageSent = false;
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'startFill' });
    console.log('[popup v15] sendMessage応答: ' + JSON.stringify(response));
    messageSent = true;
    showMessage('自動入力を開始しました！', 'success');
  } catch (e) {
    console.log('[popup v15] sendMessage失敗（content.jsが未ロードの可能性）: ' + e.message);
  }

  // sendMessage が失敗した場合はリロードで対応
  if (!messageSent) {
    console.log('[popup v15] リロードで対応します');
    showMessage('自動入力を開始しました！（ページをリロードします）', 'info');
    await chrome.tabs.reload(targetTabId);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 800);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

async function loadData() {
  const list = document.getElementById('app-list');
  list.innerHTML = '<div class="loading">データを読み込み中...</div>';
  try {
    const response = await fetch(GITHUB_RAW_URL + '?t=' + Date.now());
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    renderApplications(data);
  } catch (e) {
    list.innerHTML = '<div class="empty-state">データの読み込みに失敗しました<br>' + e.message + '</div>';
  }
}

document.getElementById('btn-refresh').addEventListener('click', loadData);
document.addEventListener('DOMContentLoaded', loadData);
loadData();
