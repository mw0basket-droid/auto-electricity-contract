// PinT自動入力 content script v4
// URLとDOMの両方を監視して確実に全ステップを実行する

let autoFillApp = null;
let autoFillStep = null;  // null | 'search' | 'click_vacancy' | 'fill_dates'
let fillDatesExecuted = false;
let stepLock = false;  // 同時実行防止

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== ステップ1: 地点コード・補足1を入力して絞込 =====
async function fillSupplyPointPage(app) {
  console.log('[PinT] fillSupplyPointPage開始');
  await sleep(800);

  const chitenInput = document.getElementById('id_origin_code');
  const hosokuInput = document.getElementById('id_supplement1');

  if (!chitenInput || !hosokuInput) {
    console.log('[PinT] 地点コード/補足1フィールドが見つかりません、リトライ...');
    await sleep(1000);
    return fillSupplyPointPage(app);
  }

  chitenInput.focus();
  chitenInput.value = app.chiten_code;
  chitenInput.dispatchEvent(new Event('input', { bubbles: true }));
  chitenInput.dispatchEvent(new Event('change', { bubbles: true }));
  chitenInput.blur();

  await sleep(200);

  hosokuInput.focus();
  hosokuInput.value = app.hosoku1;
  hosokuInput.dispatchEvent(new Event('input', { bubbles: true }));
  hosokuInput.dispatchEvent(new Event('change', { bubbles: true }));
  hosokuInput.blur();

  await sleep(300);

  // 絞込ボタンを探す
  let filterBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.trim() === '絞込') {
      filterBtn = btn;
      break;
    }
  }
  if (!filterBtn) {
    filterBtn = document.querySelector('button[type="submit"]');
  }

  if (filterBtn) {
    autoFillStep = 'click_vacancy';
    console.log('[PinT] 絞込ボタンをクリック → step=click_vacancy');
    filterBtn.click();
    // 絞込後に空室プランボタンを待つ
    waitForVacancyButton(app);
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
    autoFillApp = null;
    autoFillStep = null;
  }
}

// ===== 絞込後に「空室プランの開始/停止」ボタンが現れるのを待つ =====
async function waitForVacancyButton(app) {
  console.log('[PinT] 空室プランボタンを待機中...');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const btn = findVacancyButton();
    if (btn) {
      console.log('[PinT] 空室プランボタン発見、クリック → step=fill_dates');
      autoFillStep = 'fill_dates';
      fillDatesExecuted = false;
      btn.click();
      // URL変化を待つ（SPAの場合はDOMが変わるのを待つ）
      waitForDateForm(app);
      return;
    }
  }
  console.log('[PinT] 空室プランボタンが見つかりませんでした');
  alert('「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
  autoFillApp = null;
  autoFillStep = null;
}

function findVacancyButton() {
  for (const el of document.querySelectorAll('a, button')) {
    if (el.textContent.includes('空室プランの開始')) {
      return el;
    }
  }
  return null;
}

// ===== 日付入力フォームが現れるのを待つ =====
async function waitForDateForm(app) {
  console.log('[PinT] 日付入力フォームを待機中...');
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const fpInput = document.getElementById('formtools_vacancy_use_period');
    if (fpInput) {
      console.log('[PinT] 日付フォーム発見、fillDates実行');
      fillDates(app);
      return;
    }
  }
  console.log('[PinT] 日付フォームが見つかりませんでした');
  autoFillApp = null;
  autoFillStep = null;
}

// ===== ステップ3: 日付を設定して確認画面へ =====
async function fillDates(app) {
  if (fillDatesExecuted) {
    console.log('[PinT] fillDates既に実行済み、スキップ');
    return;
  }
  fillDatesExecuted = true;

  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  // flatpickrが初期化されるまで最大5秒待つ
  let fpInput = null;
  let fp = null;
  for (let i = 0; i < 25; i++) {
    fpInput = document.getElementById('formtools_vacancy_use_period');
    if (fpInput && fpInput._flatpickr) {
      fp = fpInput._flatpickr;
      break;
    }
    await sleep(200);
  }

  if (!fpInput) {
    console.log('[PinT] flatpickr入力フィールドが見つかりません');
    fillDatesExecuted = false;
    return;
  }

  if (fp) {
    console.log('[PinT] flatpickr発見、日付を設定します');

    fp.clear();
    await sleep(300);

    // タイムゾーンずれ防止のため手動パース
    const [sy, sm, sd] = app.power_on.split('-').map(Number);
    const [ey, em, ed] = app.power_off.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);

    fp.selectedDates = [startDate, endDate];
    fp.updateValue(true);

    // onChangeコールバックを手動で呼ぶ
    if (fp.config && fp.config.onChange) {
      const cbs = Array.isArray(fp.config.onChange) ? fp.config.onChange : [fp.config.onChange];
      cbs.forEach(fn => {
        try { fn(fp.selectedDates, fp.input.value, fp); } catch(e) {}
      });
    }

    await sleep(500);

    const startVal = document.getElementById('formtools_vacancy_use_period_start')?.value;
    const endVal = document.getElementById('formtools_vacancy_use_period_end')?.value;
    console.log('[PinT] 設定後 start=' + startVal + ' end=' + endVal + ' input=' + fpInput.value);

  } else {
    console.log('[PinT] flatpickrが見つかりません、フォールバック処理');
    const startInput = document.getElementById('formtools_vacancy_use_period_start');
    const endInput = document.getElementById('formtools_vacancy_use_period_end');
    if (startInput) {
      startInput.removeAttribute('readonly');
      startInput.value = app.power_on;
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(200);
    if (endInput) {
      endInput.removeAttribute('readonly');
      endInput.value = app.power_off;
      endInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(500);
  }

  // 確認画面へボタンをクリック
  let confirmBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.includes('確認画面')) {
      confirmBtn = btn;
      break;
    }
  }
  if (!confirmBtn) {
    confirmBtn = document.querySelector('button[type="submit"]');
  }

  if (confirmBtn) {
    autoFillStep = null;
    autoFillApp = null;
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
    autoFillStep = null;
    autoFillApp = null;
  }
}

// ===== メッセージリスナー（popup.jsからの指示） =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFill') {
    console.log('[PinT] startFill受信 app=' + JSON.stringify(message.app));
    autoFillApp = message.app;
    autoFillStep = 'search';
    fillDatesExecuted = false;
    fillSupplyPointPage(message.app);
    sendResponse({ status: 'started' });
  }
  return true;
});

console.log('[PinT] content.js v4 読み込み完了 url=' + location.href);
