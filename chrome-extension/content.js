// PinT自動入力 content script v15
// データ取得方法:
//   chrome.runtime.sendMessage({ action: 'getAppData' }) で
//   background.js からデータを取得する。
//   background.js は Service Worker として常駐し、ページ遷移をまたいでデータを保持する。

let _running = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== background.js からデータを取得 =====
async function getAppData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAppData' });
    console.log('[PinT] getAppData応答: ' + JSON.stringify(response));
    return response && response.data ? response.data : null;
  } catch (e) {
    console.log('[PinT] getAppData失敗:', e);
    return null;
  }
}

async function clearAppData() {
  try {
    await chrome.runtime.sendMessage({ action: 'clearAppData' });
    _running = false;
    console.log('[PinT] appDataクリア');
  } catch (e) {
    console.log('[PinT] appDataクリア失敗:', e);
  }
}

// ===== フォーム要素取得（IDにスペースが含まれる場合も対応）=====
function getFormElement(idWithSpaces) {
  const idUnderscore = idWithSpaces.replace(/ /g, '_');
  let el = document.getElementById(idUnderscore);
  if (el) return el;
  el = document.querySelector('[id="' + idWithSpaces + '"]');
  if (el) return el;
  for (const candidate of document.querySelectorAll('input, select, textarea')) {
    if (candidate.id && candidate.id.replace(/_/g, ' ') === idWithSpaces) {
      return candidate;
    }
  }
  return null;
}

// ===== ページ種別を URL で判定 =====
function getPageType() {
  const url = location.href;
  if (/\/supplypoint\/\d+\/turn_and_termination_vacancy/.test(url)) {
    return 'date_form';
  }
  if (/\/supplypoint\/\?/.test(url)) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const originCode = params.get('origin_code');
    if (originCode && originCode.length > 0) {
      return 'search_result';
    }
    return 'search_form';
  }
  if (/\/supplypoint\/?$/.test(url.split('?')[0])) {
    return 'search_form';
  }
  return 'other';
}

// ===== ステップ1: 地点コード・補足1を入力して絞込 =====
async function fillSupplyPointPage(app) {
  console.log('[PinT] fillSupplyPointPage開始 chiten=' + app.chiten_code);

  let chitenInput = null;
  let hosokuInput = null;
  for (let i = 0; i < 30; i++) {
    chitenInput = document.getElementById('id_origin_code');
    hosokuInput = document.getElementById('id_supplement1');
    if (chitenInput && hosokuInput) break;
    await sleep(200);
  }

  if (!chitenInput || !hosokuInput) {
    console.log('[PinT] 地点コード/補足1フィールドが見つかりません');
    document.querySelectorAll('input').forEach(el => {
      console.log('  id=' + el.id + ' name=' + el.name);
    });
    await clearAppData();
    return;
  }

  chitenInput.focus();
  chitenInput.value = '';
  chitenInput.value = app.chiten_code;
  chitenInput.dispatchEvent(new Event('input', { bubbles: true }));
  chitenInput.dispatchEvent(new Event('change', { bubbles: true }));
  chitenInput.blur();
  await sleep(300);

  hosokuInput.focus();
  hosokuInput.value = '';
  hosokuInput.value = app.hosoku1;
  hosokuInput.dispatchEvent(new Event('input', { bubbles: true }));
  hosokuInput.dispatchEvent(new Event('change', { bubbles: true }));
  hosokuInput.blur();
  await sleep(300);

  let filterBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.trim() === '絞込') {
      filterBtn = btn;
      break;
    }
  }
  if (!filterBtn) filterBtn = document.querySelector('button[type="submit"]');

  if (filterBtn) {
    console.log('[PinT] 絞込ボタンをクリック（ページ遷移後に自動再開）');
    filterBtn.click();
    // ページ遷移 → content.js 再起動 → resumeFromBackground() → waitForVacancyButton
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
    await clearAppData();
  }
}

// ===== ステップ2: 「空室プランの開始/停止」ボタンを待つ =====
async function waitForVacancyButton(app) {
  console.log('[PinT] 空室プランボタンを待機中...');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const btn = findVacancyButton();
    if (btn) {
      console.log('[PinT] 空室プランボタン発見、クリック');
      btn.click();
      // ページ遷移 → content.js 再起動 → resumeFromBackground() → waitForDateForm
      return;
    }
  }
  console.log('[PinT] 空室プランボタンが見つかりませんでした（タイムアウト）');
  alert('[PinT] 「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
  await clearAppData();
}

function findVacancyButton() {
  for (const el of document.querySelectorAll('a, button')) {
    if (el.textContent.includes('空室プランの開始')) {
      return el;
    }
  }
  return null;
}

// ===== ステップ3: 日付入力フォームを待つ =====
async function waitForDateForm(app) {
  console.log('[PinT] 日付入力フォームを待機中...');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const fpInput = getFormElement('formtools vacancy use period');
    if (fpInput) {
      console.log('[PinT] 日付フォーム発見 id="' + fpInput.id + '"、fillDates実行');
      await fillDates(app);
      return;
    }
  }
  console.log('[PinT] 日付フォームが見つかりませんでした（タイムアウト）');
  document.querySelectorAll('input').forEach(el => {
    console.log('  id=' + el.id + ' type=' + el.type);
  });
  await clearAppData();
}

// ===== ステップ4: flatpickr カレンダーをクリック操作して日付を入力 =====
async function fillDates(app) {
  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  let fpInput = null;
  for (let i = 0; i < 30; i++) {
    fpInput = getFormElement('formtools vacancy use period');
    if (fpInput) break;
    await sleep(200);
  }

  if (!fpInput) {
    console.log('[PinT] 日付フォームが見つかりません');
    await clearAppData();
    return;
  }

  // カレンダーを開く
  console.log('[PinT] カレンダーを開く');
  fpInput.click();
  await sleep(600);

  let calendarEl = document.querySelector('.flatpickr-calendar.open');
  if (!calendarEl) {
    const fp = fpInput._flatpickr;
    if (fp) {
      fp.open();
      await sleep(600);
      calendarEl = document.querySelector('.flatpickr-calendar.open');
    }
  }

  if (!calendarEl) {
    console.log('[PinT] flatpickrカレンダーが開きませんでした');
    await clearAppData();
    return;
  }
  console.log('[PinT] カレンダーが開きました');

  const [sy, sm, sd] = app.power_on.split('-').map(Number);
  const [ey, em, ed] = app.power_off.split('-').map(Number);

  // 開始日をクリック
  const clickResult1 = await clickDateInCalendar(calendarEl, sy, sm, sd);
  if (!clickResult1) {
    console.log('[PinT] 開始日のクリックに失敗');
    await clearAppData();
    return;
  }
  await sleep(500);

  // 終了日をクリック
  calendarEl = document.querySelector('.flatpickr-calendar.open');
  if (!calendarEl) {
    console.log('[PinT] 開始日クリック後にカレンダーが閉じました（再度開く）');
    fpInput.click();
    await sleep(600);
    calendarEl = document.querySelector('.flatpickr-calendar.open');
  }

  if (calendarEl) {
    const clickResult2 = await clickDateInCalendar(calendarEl, ey, em, ed);
    if (!clickResult2) {
      console.log('[PinT] 終了日のクリックに失敗');
    }
    await sleep(500);
  } else {
    console.log('[PinT] 終了日入力用のカレンダーが開けませんでした');
  }

  // カレンダーを閉じる
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);

  // 設定後の値を確認
  const startEl = getFormElement('formtools vacancy use period start');
  const endEl = getFormElement('formtools vacancy use period end');
  const mainInput = getFormElement('formtools vacancy use period');
  console.log('[PinT] 設定後 start=' + (startEl ? startEl.value : 'N/A') +
              ' end=' + (endEl ? endEl.value : 'N/A') +
              ' main=' + (mainInput ? mainInput.value : 'N/A'));

  // 確認画面へボタンをクリック
  let confirmBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.includes('確認画面')) {
      confirmBtn = btn;
      break;
    }
  }
  if (!confirmBtn) confirmBtn = document.querySelector('button[type="submit"]');

  if (confirmBtn) {
    await clearAppData();
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
    await clearAppData();
  }
}

// ===== flatpickr カレンダーで指定日をクリック（月またぎ対応）=====
async function clickDateInCalendar(calendarEl, year, month, day) {
  console.log('[PinT] 日付クリック開始: ' + year + '-' + month + '-' + day);

  for (let attempt = 0; attempt < 6; attempt++) {
    const monthSelect = calendarEl.querySelector('.flatpickr-monthDropdown-months');
    const yearInput = calendarEl.querySelector('.numInputWrapper input.cur-year');
    let currentMonth = -1;
    let currentYear = -1;
    if (monthSelect) currentMonth = parseInt(monthSelect.value) + 1;
    if (yearInput) currentYear = parseInt(yearInput.value);

    console.log('[PinT] 現在: ' + currentYear + '年' + currentMonth + '月 → 目標: ' + year + '年' + month + '月');

    if (currentYear === year && currentMonth === month) {
      const dayCell = findDayCell(calendarEl, day);
      if (dayCell) {
        console.log('[PinT] 日付セルクリック: ' + day + '日');
        dayCell.click();
        return true;
      } else {
        console.log('[PinT] 日付セルが見つかりません（無効な日付の可能性）: ' + day + '日');
        const allCells = calendarEl.querySelectorAll('.flatpickr-day');
        allCells.forEach(c => {
          if (parseInt(c.textContent.trim()) === day) {
            console.log('[PinT] 無効セル発見: class=' + c.className);
          }
        });
        return false;
      }
    } else {
      const nextBtn = calendarEl.querySelector('.flatpickr-next-month');
      if (nextBtn) {
        console.log('[PinT] 次の月へ移動');
        nextBtn.click();
        await sleep(400);
      } else {
        console.log('[PinT] 次月ボタンが見つかりません');
        return false;
      }
    }
  }
  console.log('[PinT] 対象月に到達できませんでした');
  return false;
}

function findDayCell(calendarEl, day) {
  const cells = calendarEl.querySelectorAll(
    '.flatpickr-day:not(.flatpickr-disabled):not(.prevMonthDay):not(.nextMonthDay)'
  );
  for (const cell of cells) {
    if (parseInt(cell.textContent.trim()) === day) {
      return cell;
    }
  }
  return null;
}

// ===== メイン処理: background.js からデータを取得して処理を振り分ける =====
async function resumeFromBackground() {
  if (_running) {
    console.log('[PinT] 既に実行中のためスキップ');
    return;
  }

  const app = await getAppData();
  if (!app) {
    console.log('[PinT] 再開する処理なし（background.jsにデータなし）');
    return;
  }

  _running = true;
  const pageType = getPageType();
  console.log('[PinT] 処理再開 pageType=' + pageType + ' url=' + location.href);

  if (pageType === 'date_form') {
    console.log('[PinT] 日付入力ページ → フォームを待機');
    await waitForDateForm(app);
  } else if (pageType === 'search_result') {
    console.log('[PinT] 検索結果ページ → 空室プランボタンを待機');
    await waitForVacancyButton(app);
  } else if (pageType === 'search_form') {
    console.log('[PinT] 検索フォームページ → 地点コード入力');
    await fillSupplyPointPage(app);
  } else {
    console.log('[PinT] ページ種別不明 pageType=' + pageType + ' url=' + location.href);
    await clearAppData();
  }
}

// ===== startFill メッセージリスナー =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'startFill') {
    console.log('[PinT] startFillメッセージ受信 url=' + location.href);
    sendResponse({ status: 'started' });
    _running = false;
    setTimeout(() => resumeFromBackground(), 0);
    return true;
  }
});

// ===== 初期化 =====
console.log('[PinT] content.js v15 読み込み完了 url=' + location.href);
setTimeout(resumeFromBackground, 300);
