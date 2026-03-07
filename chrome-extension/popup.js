// popup.js v10
// 設計方針（シンプル・確実・安全）:
//
// 問題: chrome.tabs.reload() は「現在のタブのURL」をリロードする。
//       tabs.update(url) で /supplypoint/ に移動した後、waitForTabLoad が
//       完了する前に reload() が呼ばれると、古いURL（/turn_and_termination_vacancy）が
//       リロードされてしまう。
//
// 解決: reload() を廃止する。代わりに以下の2段階ナビゲーションを使う:
//   1. tabs.update(url: /supplypoint/) → waitForTabLoad → executeScript(sessionStorage書き込み)
//   2. tabs.update(url: /supplypoint/) → waitForTabLoad → content.js が sessionStorage を読む
//
// つまり /supplypoint/ に2回ナビゲートする。
// 1回目: ページを確実に /supplypoint/ にする
// 2回目: sessionStorage書き込み済みの状態で /supplypoint/ を再度読み込む
//        → content.js が起動して sessionStorage を確認 → 処理開始

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
  } else {
    targetTabId = tabs[0].id;
    await chrome.tabs.update(targetTabId, { active: true });
  }

  // Step2: 1回目のナビゲーション → /supplypoint/ に確実に移動する
  console.log('[popup v10] 1回目: /supplypoint/ に移動します');
  showMessage('でんき地点管理ページに移動中...', 'info');
  await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
  await waitForTabLoad(targetTabId);
  console.log('[popup v10] 1回目のナビゲーション完了');

  // Step3: MAIN world で sessionStorage に書き込む
  // /supplypoint/ に確実にいる状態で書き込む
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
    console.log('[popup v10] sessionStorage書き込み結果: ' + result);
    if (result !== 'ok') {
      showMessage('エラー: sessionStorage書き込み失敗 (' + result + ')', 'error');
      return;
    }
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
    return;
  }

  // Step4: 2回目のナビゲーション → sessionStorage書き込み済みの状態で /supplypoint/ を再度読み込む
  // reload() ではなく tabs.update(url) を使うことで、確実に /supplypoint/ が読み込まれる
  console.log('[popup v10] 2回目: sessionStorage書き込み済みで /supplypoint/ に再ナビゲート');
  showMessage('自動入力を開始しました！', 'success');
  await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
  // content.js が起動して sessionStorage を読んで処理を開始する
  // （popup.js はここで待機不要）
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
