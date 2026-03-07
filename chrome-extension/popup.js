// popup.js v5
// 設計方針:
//   sessionStorage はページ遷移（別URLへの移動）でもオリジンが同じなら保持される。
//   しかし chrome.tabs.update(url) → waitForTabLoad → executeScript → reload の順では
//   「移動後のページ」に書き込んでからリロードするため二重リロードになる。
//
//   新方式:
//   1. タブを /supplypoint/ に移動させる（必要な場合のみ）
//   2. 移動完了後、executeScript で sessionStorage に書き込む
//   3. リロードは行わない（content.js は既に起動済みで startFill メッセージを受け取れる）
//   4. sendMessage で startFill を送る
//   5. content.js が startFill を受け取れなかった場合（タイムアウト）はリロードする
//
//   ただし、今回の根本問題は「1回目のボタン押下時に content.js が startFill を受け取れない」こと。
//   これは /supplypoint/ に移動した直後に sendMessage しているためで、
//   content.js の起動が完了する前にメッセージが届いている。
//
//   最終解決策:
//   - /supplypoint/ に移動してページ読み込み完了を待つ
//   - executeScript で sessionStorage に書き込む（これはページ読み込み完了後なので確実）
//   - さらに executeScript で resumeFromStorage() を直接呼び出す
//   - これにより sendMessage もリロードも不要になる

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
    const isSearchForm = currentUrl.startsWith(PINT_SUPPLYPOINT_URL) &&
      !/\/supplypoint\/\d+\//.test(currentUrl) &&
      !currentUrl.includes('/turn_and_termination');

    if (!isSearchForm) {
      // 別ページにいる場合: /supplypoint/ に移動してから処理
      await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
      showMessage('でんき地点管理ページに移動中...', 'info');
      await waitForTabLoad(targetTabId);
    }

    await chrome.tabs.update(targetTabId, { active: true });
  }

  // Step2: executeScript で sessionStorage に書き込む
  // （ページ読み込み完了後なので確実に書き込める）
  const stateData = JSON.stringify({ step: 'search', app: app });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (key, value) => {
        sessionStorage.setItem(key, value);
        console.log('[PinT popup] sessionStorage書き込み完了');
        // 確認
        const check = sessionStorage.getItem(key);
        console.log('[PinT popup] 確認: ' + (check ? '成功 len=' + check.length : '失敗'));
      },
      args: [STORAGE_KEY, stateData]
    });
    console.log('[popup] sessionStorage書き込み成功');
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
    return;
  }

  // Step3: executeScript で content.js の resumeFromStorage を直接呼び出す
  // これにより sendMessage もリロードも不要
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => {
        // content.js が定義した resumeFromStorage を呼び出す
        if (typeof resumeFromStorage === 'function') {
          console.log('[PinT popup] resumeFromStorage を直接呼び出し');
          resumeFromStorage();
          return 'called';
        } else {
          console.log('[PinT popup] resumeFromStorage が見つからない → sendMessage にフォールバック');
          return 'not_found';
        }
      }
    });

    const result = results && results[0] && results[0].result;
    if (result === 'called') {
      showMessage('自動入力を開始しました！', 'success');
    } else {
      // content.js がまだ起動していない場合は sendMessage を試みる
      showMessage('自動入力を開始します...', 'success');
      try {
        await chrome.tabs.sendMessage(targetTabId, { action: 'startFill', app: app });
      } catch (e2) {
        // sendMessage も失敗した場合はリロード
        console.log('[popup] sendMessage失敗、リロードします');
        await chrome.tabs.reload(targetTabId);
      }
    }
  } catch (e) {
    showMessage('エラー: ' + e.message, 'error');
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
