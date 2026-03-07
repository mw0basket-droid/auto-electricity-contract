// PinT自動入力 content script v7
// URLパターンで正確にページを判定してsessionStorageを引き継ぐ
const STORAGE_KEY = 'pint_auto_fill';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function setState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log('[PinT] sessionStorage保存: step=' + state.step);
  } catch(e) { console.log('[PinT] sessionStorage保存失敗:', e); }
}

function clearState() {
  sessionStorage.removeItem(STORAGE_KEY);
  console.log('[PinT] sessionStorageクリア');
}

// フォーム要素を取得（IDにスペースが含まれる場合も対応）
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

// ページ種別を判定
function getPageType() {
  const url = location.href;
  // 日付入力ページ: /supplypoint/{id}/turn_and_termination_vacancy
  if (/\/supplypoint\/\d+\/turn_and_termination_vacancy/.test(url)) {
    return 'date_form';
  }
  // 絞込後の検索結果ページ: /supplypoint/?...origin_code=...
  if (/\/supplypoint\/\?/.test(url) && url.includes('origin_code=')) {
    return 'search_result';
  }
  // 検索フォームページ（パラメータなし or 空）
  if (/\/supplypoint\/$/.test(url) || /\/supplypoint\/\?status=&area_id=&supply_point_number=&customer_keywords=&zip_code=&prefecture_code=&city=&address=&building=&supply_start_date_from=&supply_start_date_to=&supply_end_date_from=&supply_end_date_to=&registration_date_from=&registration_date_to=&origin_code=&/.test(url)) {
    return 'search_form';
  }
  if (/\/supplypoint\//.test(url)) {
    return 'other';
  }
  return 'unknown';
}

// ===== ステップ1: 地点コード・補足1を入力して絞込 =====
async function fillSupplyPointPage(app) {
  console.log('[PinT] fillSupplyPointPage開始');
  setState({ step: 'search', app: app });

  let chitenInput = null;
  let hosokuInput = null;
  for (let i = 0; i < 25; i++) {
    chitenInput = document.getElementById('id_origin_code');
    hosokuInput = document.getElementById('id_supplement1');
    if (chitenInput && hosokuInput) break;
    await sleep(200);
  }

  if (!chitenInput || !hosokuInput) {
    console.log('[PinT] 地点コード/補足1フィールドが見つかりません');
    clearState();
    return;
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

  let filterBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.trim() === '絞込') {
      filterBtn = btn;
      break;
    }
  }
  if (!filterBtn) filterBtn = document.querySelector('button[type="submit"]');

  if (filterBtn) {
    setState({ step: 'click_vacancy', app: app });
    console.log('[PinT] 絞込ボタンをクリック → step=click_vacancy');
    filterBtn.click();
    // SPAの場合はポーリングも続ける
    waitForVacancyButton(app);
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
    clearState();
  }
}

// ===== 絞込後に「空室プランの開始/停止」ボタンが現れるのを待つ =====
async function waitForVacancyButton(app) {
  console.log('[PinT] 空室プランボタンを待機中...');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const btn = findVacancyButton();
    if (btn) {
      console.log('[PinT] 空室プランボタン発見、クリック → step=fill_dates');
      setState({ step: 'fill_dates', app: app });
      btn.click();
      waitForDateForm(app);
      return;
    }
  }
  console.log('[PinT] 空室プランボタンが見つかりませんでした（タイムアウト）');
  alert('「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
  clearState();
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
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const fpInput = getFormElement('formtools vacancy use period');
    if (fpInput) {
      console.log('[PinT] 日付フォーム発見 id=' + fpInput.id + '、fillDates実行');
      fillDates(app);
      return;
    }
  }
  console.log('[PinT] 日付フォームが見つかりませんでした（タイムアウト）');
  clearState();
}

// ===== ステップ3: 日付を設定して確認画面へ =====
async function fillDates(app) {
  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  let fpInput = null;
  let fp = null;
  for (let i = 0; i < 25; i++) {
    fpInput = getFormElement('formtools vacancy use period');
    if (fpInput && fpInput._flatpickr) {
      fp = fpInput._flatpickr;
      break;
    }
    await sleep(200);
  }

  if (!fpInput) {
    console.log('[PinT] flatpickr入力フィールドが見つかりません');
    clearState();
    return;
  }

  if (fp) {
    console.log('[PinT] flatpickr発見 id=' + fpInput.id + '、日付を設定します');
    fp.clear();
    await sleep(300);

    const [sy, sm, sd] = app.power_on.split('-').map(Number);
    const [ey, em, ed] = app.power_off.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);

    fp.selectedDates = [startDate, endDate];
    fp.updateValue(true);

    if (fp.config && fp.config.onChange) {
      const cbs = Array.isArray(fp.config.onChange) ? fp.config.onChange : [fp.config.onChange];
      cbs.forEach(fn => {
        try { fn(fp.selectedDates, fp.input.value, fp); } catch(e) {}
      });
    }

    await sleep(500);
    const startEl = getFormElement('formtools vacancy use period start');
    const endEl = getFormElement('formtools vacancy use period end');
    console.log('[PinT] 設定後 start=' + startEl?.value + ' end=' + endEl?.value + ' input=' + fpInput.value);
  } else {
    console.log('[PinT] flatpickrが見つかりません、フォールバック処理');
    const startInput = getFormElement('formtools vacancy use period start');
    const endInput = getFormElement('formtools vacancy use period end');
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

  let confirmBtn = null;
  for (const btn of document.querySelectorAll('button')) {
    if (btn.textContent.includes('確認画面')) {
      confirmBtn = btn;
      break;
    }
  }
  if (!confirmBtn) confirmBtn = document.querySelector('button[type="submit"]');

  if (confirmBtn) {
    clearState();
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
    clearState();
  }
}

// ===== ページ読み込み時: sessionStorageとURLを確認して処理を再開 =====
async function resumeFromStorage() {
  const state = getState();
  if (!state || !state.app) {
    console.log('[PinT] 再開する処理なし');
    return;
  }

  const pageType = getPageType();
  console.log('[PinT] sessionStorageから処理を再開 step=' + state.step + ' pageType=' + pageType);
  const app = state.app;

  if (pageType === 'date_form') {
    // 日付入力ページ（URLで確実に判定）
    console.log('[PinT] 日付入力ページ検出 → フォームを待機');
    setState({ step: 'fill_dates', app: app });
    await waitForDateForm(app);
  } else if (pageType === 'search_result') {
    // 絞込後の検索結果ページ
    console.log('[PinT] 検索結果ページ検出 → 空室プランボタンを待機');
    await waitForVacancyButton(app);
  } else if (pageType === 'search_form') {
    // 検索フォームページ（最初のページ）
    if (state.step === 'search') {
      console.log('[PinT] 検索フォームページ検出 → 再入力');
      await fillSupplyPointPage(app);
    } else {
      // 予期しない状態: クリア
      console.log('[PinT] 予期しない状態でsessionStorageをクリア');
      clearState();
    }
  } else {
    console.log('[PinT] ページ種別不明 pageType=' + pageType + ' → sessionStorageをクリア');
    clearState();
  }
}

// ===== メッセージリスナー（popup.jsからの指示） =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFill') {
    console.log('[PinT] startFill受信 app=' + JSON.stringify(message.app));
    clearState();
    fillSupplyPointPage(message.app);
    sendResponse({ status: 'started' });
  }
  return true;
});

// ===== 初期化 =====
console.log('[PinT] content.js v7 読み込み完了 url=' + location.href);
setTimeout(resumeFromStorage, 1000);
