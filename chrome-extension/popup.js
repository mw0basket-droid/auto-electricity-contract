// popup.js v18
// 追加機能:
//   「✓ 完了」ボタンを追加。
//   押すと GitHub API で pending_applications.json から該当申請を削除する。
//   GitHub Personal Access Token は chrome.storage.local に保存する。

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/mw0basket-droid/auto-electricity-contract/main/pending_applications.json';
const GITHUB_API_URL = 'https://api.github.com/repos/mw0basket-droid/auto-electricity-contract/contents/pending_applications.json';
const PINT_SUPPLYPOINT_URL = 'https://kentaku.pint-cloud.com/supplypoint/';

// ===== メッセージ表示 =====
function showMessage(text, type) {
  const msg = document.getElementById('message');
  msg.textContent = text;
  msg.className = 'msg-' + type;
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 8000);
}

// ===== GitHub Token の保存・読み込み =====
async function loadToken() {
  const result = await chrome.storage.local.get('github_token');
  return result.github_token || '';
}

async function saveToken(token) {
  await chrome.storage.local.set({ github_token: token });
}

// ===== Token 設定 UI の初期化 =====
async function initTokenSection() {
  const token = await loadToken();
  const input = document.getElementById('github-token');
  const section = document.getElementById('token-section');

  if (token) {
    // Token が設定済みの場合は入力欄を折りたたむ
    input.value = token;
    section.style.display = 'none';
  }

  document.getElementById('btn-save-token').addEventListener('click', async () => {
    const val = input.value.trim();
    if (!val) {
      showMessage('Tokenを入力してください', 'error');
      return;
    }
    await saveToken(val);
    document.getElementById('token-saved').style.display = 'block';
    setTimeout(() => {
      section.style.display = 'none';
    }, 1000);
  });
}

// ===== 申請リストの表示 =====
function renderApplications(data) {
  const list = document.getElementById('app-list');
  const dateEl = document.getElementById('target-date');
  if (data.target_date) {
    dateEl.textContent = '対象日: ' + data.target_date;
  }
  if (!data.applications || data.applications.length === 0) {
    list.innerHTML = '<div class="empty-state">申請予定はありません</div>';
    return;
  }
  list.innerHTML = '';
  data.applications.forEach((app, index) => {
    const item = document.createElement('div');
    item.className = 'application-item';
    item.dataset.index = index;
    item.innerHTML = `
      <div class="app-title">${app.title}</div>
      <div class="app-detail">地点コード: ${app.chiten_code}</div>
      <div class="app-detail">補足1: ${app.hosoku1}</div>
      <div class="app-detail">通電開始: ${app.power_on}</div>
      <div class="app-detail">通電停止: ${app.power_off}</div>
      <button class="btn btn-primary btn-start" data-index="${index}">PinTで自動入力を開始</button>
      <button class="btn btn-done btn-complete" data-index="${index}">✓ 申請完了（リストから削除）</button>
    `;
    list.appendChild(item);
  });

  // 自動入力ボタン
  document.querySelectorAll('.btn-start').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      startAutoFill(data.applications[idx]);
    });
  });

  // 完了ボタン
  document.querySelectorAll('.btn-complete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      await markComplete(data, idx, e.target);
    });
  });
}

// ===== 完了ボタン: GitHub API で申請を削除 =====
async function markComplete(data, index, btn) {
  // Tokenを取得し、前後の空白・改行を除去
  const rawToken = await loadToken();
  const token = rawToken.replace(/[^\x20-\x7E]/g, '').trim();
  console.log('[popup] loadToken rawLen=' + rawToken.length + ' cleanLen=' + token.length + ' starts=' + token.substring(0, 6));
  if (!token) {
    document.getElementById('token-section').style.display = 'block';
    showMessage('GitHub Tokenを設定してください', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '削除中...';

  try {
    // 現在のファイルの SHA を取得（更新に必要）
    const shaResp = await fetch(GITHUB_API_URL, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!shaResp.ok) throw new Error('ファイル情報の取得失敗: HTTP ' + shaResp.status);
    const shaData = await shaResp.json();
    const sha = shaData.sha;

    // 該当申請を削除した新しいデータを作成
    const newApplications = data.applications.filter((_, i) => i !== index);
    const newData = { ...data, applications: newApplications };
    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(newData, null, 2) + '\n')));

    // GitHub API でファイルを更新
    const updateResp = await fetch(GITHUB_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        message: 'complete: ' + data.applications[index].title,
        content: newContent,
        sha: sha
      })
    });
    if (!updateResp.ok) {
      const errBody = await updateResp.text();
      throw new Error('ファイル更新失敗: HTTP ' + updateResp.status + ' ' + errBody);
    }

    // リストを再描画（削除後の最新データで）
    const updatedData = { ...data, applications: newApplications };
    renderApplications(updatedData);
    showMessage('リストから削除しました', 'success');

  } catch (e) {
    console.log('[popup v18] markComplete失敗: ' + e.message);
    btn.disabled = false;
    btn.textContent = '✓ 申請完了（リストから削除）';
    showMessage('削除失敗: ' + e.message, 'error');
  }
}

// ===== 自動入力開始 =====
async function startAutoFill(app) {
  showMessage('処理を開始しています...', 'info');
  console.log('[popup v18] startAutoFill app=' + JSON.stringify(app));

  // background.js にデータを保存
  try {
    const saveResp = await chrome.runtime.sendMessage({ action: 'saveAppData', data: app });
    console.log('[popup v18] saveAppData応答: ' + JSON.stringify(saveResp));
  } catch (e) {
    showMessage('エラー: データ保存失敗 (' + e.message + ')', 'error');
    return;
  }

  // PinT タブを探す or 作成する
  const tabs = await chrome.tabs.query({ url: 'https://kentaku.pint-cloud.com/*' });
  let targetTabId;
  let targetTabUrl;

  if (tabs.length === 0) {
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
  }

  // /supplypoint/ 系にいない場合のみ移動
  const isSupplyPointPage = targetTabUrl.includes('kentaku.pint-cloud.com/supplypoint');
  if (!isSupplyPointPage) {
    showMessage('でんき地点管理ページに移動中...', 'info');
    await chrome.tabs.update(targetTabId, { url: PINT_SUPPLYPOINT_URL });
    await waitForTabLoad(targetTabId);
  }

  // content.js に startFill メッセージを送る
  let messageSent = false;
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'startFill' });
    console.log('[popup v18] sendMessage応答: ' + JSON.stringify(response));
    messageSent = true;
    showMessage('自動入力を開始しました！', 'success');
  } catch (e) {
    console.log('[popup v18] sendMessage失敗: ' + e.message);
  }

  if (!messageSent) {
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

// ===== データ読み込み =====
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

// ===== 初期化 =====
document.getElementById('btn-refresh').addEventListener('click', loadData);
// DOMContentLoadedのみで初期化（二重呼び出しを防ぐ）
document.addEventListener('DOMContentLoaded', async () => {
  await initTokenSection();
  await loadData();
});
