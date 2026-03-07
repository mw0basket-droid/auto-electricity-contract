
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/mw0basket-droid/auto-electricity-contract/main/pending_applications.json';

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

function startAutoFill(app) {
  showMessage('PinTタブを探しています...', 'info');
  
  chrome.tabs.query({url: 'https://kentaku.pint-cloud.com/*'}, (tabs) => {
    if (tabs.length === 0) {
      chrome.tabs.create({url: 'https://kentaku.pint-cloud.com/supplypoint/'}, (tab) => {
        setTimeout(() => {
          sendFillCommand(tab.id, app);
        }, 2000);
      });
    } else {
      const tab = tabs[0];
      chrome.tabs.update(tab.id, {active: true});
      chrome.tabs.sendMessage(tab.id, {action: 'startFill', app: app}, (response) => {
        if (chrome.runtime.lastError) {
          chrome.tabs.reload(tab.id, {}, () => {
            setTimeout(() => sendFillCommand(tab.id, app), 2000);
          });
        } else {
          showMessage('自動入力を開始しました！', 'success');
        }
      });
    }
  });
}

function sendFillCommand(tabId, app) {
  chrome.tabs.sendMessage(tabId, {action: 'startFill', app: app}, (response) => {
    if (chrome.runtime.lastError) {
      showMessage('エラー: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showMessage('自動入力を開始しました！', 'success');
    }
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
