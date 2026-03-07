// PinT自動入力 content script v14
// 変更点:
//   flatpickr の日付入力を「実際のクリック操作」で再現するように変更。
//   - 入力フィールドをクリックしてカレンダーを開く
//   - 月またぎの場合は「>」ボタンをクリックして次月に移動
//   - 対象の日付セルをクリック（無効セルは除外）
//   - 開始日クリック後、終了日をクリック

const STORAGE_KEY = 'pint_auto_fill';
let _running = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== chrome.storage.session 操作 =====
async function getState() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const state = result[STORAGE_KEY] || null;
    console.log('[PinT] storage読み取り: ' + JSON.stringify(state));
    return state;
  } catch (e) {
    console.log('[PinT] storage読み取り失敗:', e);
    return null;
  }
}

async function setState(state) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
    console.log('[PinT] state保存: step=' + state.step);
  } catch (e) {
    console.log('[PinT] state保存失敗:', e);
  }
}

async function clearState() {
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
    _running = false;
    console.log('[PinT] stateクリア');
  } catch (e) {
    console.log('[PinT] stateクリア失敗:', e);
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
  await setState({ step: 'search', app: app });

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
    await clearState();
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
    await setState({ step: 'click_vacancy', app: app });
    console.log('[PinT] 絞込ボタンをクリック → step=click_vacancy');
    filterBtn.click();
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
    await clearState();
  }
}

// ===== ステップ2: 「空室プランの開始/停止」ボタンを待つ =====
async function waitForVacancyButton(app) {
  console.log('[PinT] 空室プランボタンを待機中...');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const btn = findVacancyButton();
    if (btn) {
      console.log('[PinT] 空室プランボタン発見、クリック → step=fill_dates');
      await setState({ step: 'fill_dates', app: app });
      btn.click();
      return;
    }
  }
  console.log('[PinT] 空室プランボタンが見つかりませんでした（タイムアウト）');
  alert('[PinT] 「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
  await clearState();
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
  await clearState();
}

// ===== ステップ4: flatpickr カレンダーをクリック操作して日付を入力 =====
async function fillDates(app) {
  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  // 入力フィールドが現れるまで待つ
  let fpInput = null;
  for (let i = 0; i < 30; i++) {
    fpInput = getFormElement('formtools vacancy use period');
    if (fpInput) break;
    await sleep(200);
  }

  if (!fpInput) {
    console.log('[PinT] 日付フォームが見つかりません');
    await clearState();
    return;
  }

  // カレンダーを開く（入力フィールドをクリック）
  console.log('[PinT] カレンダーを開く');
  fpInput.click();
  await sleep(600);

  // カレンダーが開いたか確認
  let calendarEl = document.querySelector('.flatpickr-calendar.open');
  if (!calendarEl) {
    // _flatpickr API で強制的に開く
    const fp = fpInput._flatpickr;
    if (fp) {
      fp.open();
      await sleep(600);
      calendarEl = document.querySelector('.flatpickr-calendar.open');
    }
  }

  if (!calendarEl) {
    console.log('[PinT] flatpickrカレンダーが開きませんでした');
    await clearState();
    return;
  }
  console.log('[PinT] カレンダーが開きました');

  // 開始日をクリック
  const [sy, sm, sd] = app.power_on.split('-').map(Number);
  const [ey, em, ed] = app.power_off.split('-').map(Number);

  const clickResult1 = await clickDateInCalendar(calendarEl, sy, sm, sd);
  if (!clickResult1) {
    console.log('[PinT] 開始日のクリックに失敗');
    await clearState();
    return;
  }
  await sleep(500);

  // 終了日をクリック（カレンダーはまだ開いているはず）
  calendarEl = document.querySelector('.flatpickr-calendar.open');
  if (!calendarEl) {
    // 閉じてしまった場合は再度開く
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

  // カレンダーを閉じる（Escape キー）
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
    await clearState();
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
    await clearState();
  }
}

// ===== flatpickr カレンダーで指定日をクリック（月またぎ対応）=====
async function clickDateInCalendar(calendarEl, year, month, day) {
  console.log('[PinT] 日付クリック開始: ' + year + '-' + month + '-' + day);

  // 最大 6 ヶ月分ナビゲートして対象月を表示する
  for (let attempt = 0; attempt < 6; attempt++) {
    // 現在表示中の年月を取得
    const monthSelect = calendarEl.querySelector('.flatpickr-monthDropdown-months');
    const yearInput = calendarEl.querySelector('.numInputWrapper input.cur-year');
    let currentMonth = -1;
    let currentYear = -1;
    if (monthSelect) currentMonth = parseInt(monthSelect.value) + 1; // 0-indexed → 1-indexed
    if (yearInput) currentYear = parseInt(yearInput.value);

    console.log('[PinT] 現在: ' + currentYear + '年' + currentMonth + '月 → 目標: ' + year + '年' + month + '月');

    if (currentYear === year && currentMonth === month) {
      // 対象月を表示中 → 日付セルをクリック
      const dayCell = findDayCell(calendarEl, day);
      if (dayCell) {
        console.log('[PinT] 日付セルクリック: ' + day + '日');
        dayCell.click();
        return true;
      } else {
        console.log('[PinT] 日付セルが見つかりません（無効な日付の可能性）: ' + day + '日');
        // 無効セルも含めて探す（デバッグ用）
        const allCells = calendarEl.querySelectorAll('.flatpickr-day');
        allCells.forEach(c => {
          if (parseInt(c.textContent.trim()) === day) {
            console.log('[PinT] 無効セル発見: class=' + c.className);
          }
        });
        return false;
      }
    } else {
      // 次の月へ移動（「>」ボタンをクリック）
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
  console.log('[PinT] 対象月に到達できませんでした（6ヶ月分ナビゲート失敗）');
  return false;
}

// カレンダー内の日付セルを探す（無効セルは除外）
function findDayCell(calendarEl, day) {
  // 有効なセルのみ（flatpickr-disabled, prevMonthDay, nextMonthDay を除外）
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

// ===== メイン処理: chrome.storage.session を確認して処理を振り分ける =====
async function resumeFromStorage() {
  if (_running) {
    console.log('[PinT] 既に実行中のためスキップ');
    return;
  }

  const state = await getState();
  if (!state || !state.app) {
    console.log('[PinT] 再開する処理なし');
    return;
  }

  _running = true;
  const pageType = getPageType();
  const app = state.app;
  console.log('[PinT] 処理再開 step=' + state.step + ' pageType=' + pageType + ' url=' + location.href);

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
    await clearState();
  }
}

// ===== startFill メッセージリスナー =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'startFill') {
    console.log('[PinT] startFillメッセージ受信 url=' + location.href);
    sendResponse({ status: 'started' });
    _running = false;
    setTimeout(() => resumeFromStorage(), 0);
    return true;
  }
});

// ===== 初期化 =====
console.log('[PinT] content.js v14 読み込み完了 url=' + location.href);
setTimeout(resumeFromStorage, 300);
