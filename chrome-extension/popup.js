// popup.js v7
// 設計方針:
//   1. PinTタブを /supplypoint/ に移動させる（必要な場合のみ）
//   2. ページ読み込み完了を待つ
//   3. executeScript で sessionStorage に書き込む
//   4. sendMessage(startFill) を送る → content.js が受け取って即時実行
//   ※ sendMessage が失敗する場合はない（ページ読み込み完了後に送るため）
//   ※ リロードは使わない（sessionStorage が消える可能性があるため）

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
  let tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });
  let targetTabId;

  if (tabs.length === 0) {
    // PinTタブがない場合: 新規作成
    const newTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    targetTabId = newTab.id;
    showMessage('PinTを開いています...', 'info');
    await waitForTabLoad(targetTabId);
  } else {
    targetTabId = tabs[0].id;
    const currentUrl = tabs[0].url || '';

    // /supplypoint/ の検索フォームでない場合は移動
    const isSearchForm = /^https:\/\/kentaku\.pint-cloud\.com\/supplypoint\/(\?.*)?$/.test(currentUrl) &&
      !/\/supplypoint\/\d+\//.test(currentUrl);

    if (!isSearchForm) {
      console.log('[popup] 現在のURL: ' + currentUrl + ' → /supplypoint/ に移動');
      await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
      showMessage('でんき地点管理ページに移動中...', 'info');
      await waitForTabLoad(targetTabId);
    } else {
      console.log('[popup] 既に /supplypoint/ にいます: ' + currentUrl);
    }

    await chrome.tabs.update(targetTabId, { active: true });
  }

  // Step2: executeScript で sessionStorage に書き込む
  // world: 'MAIN' を指定してページ本体の sessionStorage に書き込む
  // （デフォルトの ISOLATED world では content script から読めない）
  const stateData = JSON.stringify({ step: 'search', app: app });
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: 'MAIN',
      func: (key, value) => {
        sessionStorage.setItem(key, value);
        const check = sessionStorage.getItem(key);
        return check ? 'ok:' + check.length : 'fail';
      },
      args: [STORAGE_KEY, stateData]
    });
    const result = results && results[0] && results[0].result;
    console.log('[popup] sessionStorage書き込み結果: ' + result);
    if (!result || result === 'fail') {
      showMessage('エラー: sessionStorage書き込み失敗', 'error');
      return;
    }
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
    return;
  }

  // Step3: sendMessage で content.js に startFill を送る
  // （ページ読み込み完了後なので content.js は確実に起動している）
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'startFill', app: app });
    console.log('[popup] sendMessage応答: ' + JSON.stringify(response));
    showMessage('自動入力を開始しました！', 'success');
  } catch (e) {
    // sendMessage が失敗した場合（content.js が起動していない）
    console.log('[popup] sendMessage失敗: ' + e.message + ' → リロードします');
    showMessage('ページをリロードして再試行します...', 'info');
    await chrome.tabs.reload(targetTabId);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // ページが安定するまで待つ（content.js の起動を待つ）
        setTimeout(resolve, 1000);
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
