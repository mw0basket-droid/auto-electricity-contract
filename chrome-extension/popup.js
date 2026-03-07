// popup.js v4
// 設計方針:
//   1. executeScript でタブの sessionStorage に申請データを書き込む
//   2. タブをリロードする（content.js が起動してsessionStorageを読み取る）
//   3. content.js は起動時に sessionStorage を確認して自動的に処理を開始する
//   ※ sendMessage は使わない（ページ遷移後にcontent.jsが再起動するため）

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
    // PinTタブがない場合: 新規作成して読み込み完了を待つ
    const newTab = await chrome.tabs.create({ url: PINT_SUPPLYPOINT_URL });
    targetTabId = newTab.id;
    showMessage('PinTを開いています...', 'info');
    await waitForTabLoad(targetTabId);
  } else {
    targetTabId = tabs[0].id;
    await chrome.tabs.update(targetTabId, { active: true });

    // supplypoint/ の検索フォームでない場合は移動
    const currentTab = tabs[0];
    const url = currentTab.url || '';
    const isSearchForm = url.startsWith(PINT_SUPPLYPOINT_URL) &&
      !/\/supplypoint\/\d+\//.test(url) &&
      !url.includes('/turn_and_termination');

    if (!isSearchForm) {
      await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
      showMessage('でんき地点管理ページに移動中...', 'info');
      await waitForTabLoad(targetTabId);
    }
  }

  // Step2: executeScript で sessionStorage に申請データを書き込む
  // （これはページ遷移後も保持される）
  const stateData = JSON.stringify({ step: 'search', app: app });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (key, value) => {
        sessionStorage.setItem(key, value);
        console.log('[PinT popup] sessionStorage書き込み完了: ' + value.substring(0, 50));
      },
      args: [STORAGE_KEY, stateData]
    });
    console.log('[popup] sessionStorage書き込み成功');
  } catch (e) {
    showMessage('エラー: sessionStorage書き込み失敗 - ' + e.message, 'error');
    return;
  }

  // Step3: ページをリロードして content.js を再起動させる
  // content.js は起動時に sessionStorage を確認して自動的に処理を開始する
  showMessage('自動入力を開始します...', 'success');
  await chrome.tabs.reload(targetTabId);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // ページが安定するまで少し待つ
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // タイムアウト（15秒）
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
