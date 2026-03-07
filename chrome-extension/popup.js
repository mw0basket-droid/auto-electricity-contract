// popup.js v9
// 設計方針（シンプル・確実・安全）:
//   現在どのページにいても、必ず /supplypoint/ に移動してから処理を開始する。
//   これにより「絞込後ページでリロード → sessionStorageが消える」問題を完全に回避する。
//
// 処理フロー:
//   1. PinTタブを /supplypoint/ に移動（現在のURLに関わらず常に移動）
//   2. ページ読み込み完了を待つ（800ms余裕を持つ）
//   3. executeScript (world: MAIN) で sessionStorage に書き込む
//   4. chrome.tabs.reload() でリロードする
//   → content.js がリロード後に sessionStorage を読んで処理を開始する
//
// sendMessage は使わない（タイミング問題が発生するため廃止）

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

  // Step1: PinTタブを探す or 作成する
  const tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });
  let targetTabId;

  if (tabs.length === 0) {
    const newTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    targetTabId = newTab.id;
    showMessage('PinTを開いています...', 'info');
    await waitForTabLoad(targetTabId);
  } else {
    targetTabId = tabs[0].id;
    await chrome.tabs.update(targetTabId, { active: true });

    // 現在のURLに関わらず、必ず /supplypoint/ に移動する
    // これにより「絞込後ページでリロード → sessionStorageが消える」問題を回避
    const currentUrl = tabs[0].url || '';
    console.log('[popup v9] 現在のURL: ' + currentUrl + ' → /supplypoint/ に移動します');
    await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
    showMessage('でんき地点管理ページに移動中...', 'info');
    await waitForTabLoad(targetTabId);
  }

  // Step2: MAIN world で sessionStorage に書き込む
  // world: 'MAIN' を指定することで、content script (ISOLATED world) からも
  // 同じ window.sessionStorage を参照できる
  const stateData = JSON.stringify({ step: 'search', app: app });
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
    const result = results && results[0] && results[0].result;
    console.log('[popup v9] sessionStorage書き込み結果: ' + result);
    if (result !== 'ok') {
      showMessage('エラー: sessionStorage書き込み失敗 (' + result + ')', 'error');
      return;
    }
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
    return;
  }

  // Step3: リロードする
  // /supplypoint/ にいる状態でリロードするため、sessionStorage は確実に保持される
  console.log('[popup v9] リロードします → content.js が sessionStorage を読んで処理開始');
  showMessage('自動入力を開始しました！', 'success');
  await chrome.tabs.reload(targetTabId);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // ページのJSが初期化されるまで少し待つ
        setTimeout(resolve, 800);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // タイムアウト: 15秒
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
