// popup.js v3
// chrome.scripting.executeScriptでsessionStorageを直接書き込んでからページ遷移
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/mw0basket-droid/auto-electricity-contract/main/pending_applications.json';
const STORAGE_KEY = 'pint_auto_fill';
const PINT_SUPPLYPOINT_URL = 'https://kentaku.pint-cloud.com/supplypoint/';

function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = 'msg-' + type;
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 5000);
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
      const app = data.applications[idx];
      startAutoFill(app);
    });
  });
}

async function startAutoFill(app) {
  showMessage('処理を開始しています...', 'info');

  const tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });

  let targetTab;
  if (tabs.length === 0) {
    targetTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    showMessage('PinTを開いています...', 'info');
    await waitForTabLoad(targetTab.id);
    targetTab = await chrome.tabs.get(targetTab.id);
  } else {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });

    const isOnSearchForm = targetTab.url.startsWith(PINT_SUPPLYPOINT_URL) &&
      !targetTab.url.includes('/turn_and_termination_vacancy') &&
      !targetTab.url.includes('/turn_and_termination/') &&
      !/\/supplypoint\/\d+\//.test(targetTab.url);

    if (!isOnSearchForm) {
      await chrome.tabs.update(targetTab.id, { url: PINT_SUPPLYPOINT_URL });
      showMessage('でんき地点管理ページに移動中...', 'info');
      await waitForTabLoad(targetTab.id);
      targetTab = await chrome.tabs.get(targetTab.id);
    }
  }

  // sessionStorageに申請データを書き込む（executeScriptで直接操作）
  const stateData = JSON.stringify({ step: 'search', app: app });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: (key, value) => {
        sessionStorage.setItem(key, value);
        console.log('[PinT popup] sessionStorage書き込み完了');
      },
      args: [STORAGE_KEY, stateData]
    });
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
    return;
  }

  // content.jsにstartFillメッセージを送る
  try {
    await chrome.tabs.sendMessage(targetTab.id, { action: 'startFill', app: app });
    showMessage('自動入力を開始しました！', 'success');
  } catch (e) {
    // content.jsが準備できていない場合はページをリロードしてsessionStorageから自動再開
    showMessage('自動入力を開始します...', 'info');
    chrome.tabs.reload(targetTab.id);
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
    }, 10000);
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
