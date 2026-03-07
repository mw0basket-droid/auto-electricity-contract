// popup.js v11
// 設計方針:
//   ページ移動を極力しない。
//   PinT タブが /supplypoint/ 系にいる場合はそのまま sessionStorage を書き込んで sendMessage。
//   /supplypoint/ 系にいない場合のみ /supplypoint/ に移動する。
//   sendMessage が失敗した場合はリロードで対応。
//
//   content.js は現在のページ種別に応じて処理を開始する:
//     search_form  → 地点コード入力 → 絞込
//     search_result → 空室プランボタン待機 → クリック
//     date_form    → 日付フォーム入力

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/mw0basket-droid/auto-electricity-contract/main/pending_applications.json';
const STORAGE_KEY = 'pint_auto_fill';
const PINT_SUPPLYPOINT_URL = 'https://kentaku.pint-cloud.com/supplypoint/';

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = 'msg-' + type;
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 6000);
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

  // Step1: PinT タブを探す or 作成する
  const tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });
  let targetTabId;
  let targetTabUrl;

  if (tabs.length === 0) {
    // PinT タブがない → 新規作成して /supplypoint/ に移動
    console.log('[popup v11] PinTタブなし → 新規作成');
    showMessage('でんき地点管理ページを開いています...', 'info');
    const newTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    targetTabId = newTab.id;
    await waitForTabLoad(targetTabId);
    const updatedTab = await chrome.tabs.get(targetTabId);
    targetTabUrl = updatedTab.url || '';
  } else {
    targetTabId = tabs[0].id;
    targetTabUrl = tabs[0].url || '';
    await chrome.tabs.update(targetTabId, { active: true });
    console.log('[popup v11] PinTタブ発見 url=' + targetTabUrl);
  }

  // Step2: /supplypoint/ 系にいない場合のみ移動する
  const isSupplyPointPage = targetTabUrl.includes('kentaku.pint-cloud.com/supplypoint');
  if (!isSupplyPointPage) {
    console.log('[popup v11] /supplypoint/ 以外にいるため移動: ' + targetTabUrl);
    showMessage('でんき地点管理ページに移動中...', 'info');
    await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
    await waitForTabLoad(targetTabId);
    const updatedTab = await chrome.tabs.get(targetTabId);
    targetTabUrl = updatedTab.url || '';
    console.log('[popup v11] 移動後URL=' + targetTabUrl);
  } else {
    console.log('[popup v11] /supplypoint/ 系にいます: ' + targetTabUrl);
  }

  // Step3: sessionStorage に申請データを書き込む（MAIN world）
  // step: 'auto' → content.js が現在のページ種別を判定して適切な処理を開始する
  const stateData = JSON.stringify({ step: 'auto', app: app });
  let writeResult = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: 'MAIN',
      func: (key, value) => {
        try {
          sessionStorage.setItem(key, value);
          const check = sessionStorage.getItem(key);
          return check === value ? 'ok' : 'mismatch:got=' + check;
        } catch (e) {
          return 'error:' + e.message;
        }
      },
      args: [STORAGE_KEY, stateData]
    });
    writeResult = results && results[0] && results[0].result;
    console.log('[popup v11] sessionStorage書き込み結果: ' + writeResult);
  } catch (e) {
    console.log('[popup v11] executeScript失敗: ' + e.message);
    writeResult = 'error:' + e.message;
  }

  if (writeResult !== 'ok') {
    showMessage('エラー: sessionStorage書き込み失敗 (' + writeResult + ')', 'error');
    return;
  }

  // Step4: sendMessage で content.js に処理開始を通知する
  // content.js は sessionStorage を読んで現在のページ種別に応じた処理を開始する
  let messageSent = false;
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'startFill' });
    console.log('[popup v11] sendMessage応答: ' + JSON.stringify(response));
    messageSent = true;
    showMessage('自動入力を開始しました！', 'success');
  } catch (e) {
    console.log('[popup v11] sendMessage失敗: ' + e.message);
  }

  // sendMessage が失敗した場合はリロードで対応
  // （sessionStorage は書き込み済みなので、リロード後に content.js が自動的に処理を開始する）
  if (!messageSent) {
    console.log('[popup v11] リロードで対応します');
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
