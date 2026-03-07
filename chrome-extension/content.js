// PinT自動入力 content script v5
// sessionStorageを使ってページ再読み込み後も処理を継続する
const STORAGE_KEY = 'pint_auto_fill';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function setState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) {}
}

function clearState() {
  sessionStorage.removeItem(STORAGE_KEY);
}

// ===== ステップ1: 地点コード・補足1を入力して絞込 =====
async function fillSupplyPointPage(app) {
  console.log('[PinT] fillSupplyPointPage開始');
  setState({ step: 'search', app: app });

  // フィールドが現れるまで最大5秒待つ
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
    // ページ遷移する可能性があるのでstepを更新してからクリック
    setState({ step: 'click_vacancy', app: app });
    console.log('[PinT] 絞込ボタンをクリック → step=click_vacancy (sessionStorage保存済み)');
    filterBtn.click();
    // SPAの場合はページ遷移しないのでポーリングも続ける
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
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const fpInput = document.getElementById('formtools_vacancy_use_period');
    if (fpInput) {
      console.log('[PinT] 日付フォーム発見、fillDates実行');
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
    clearState();
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
    clearState();
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
    clearState();
  }
}

// ===== ページ読み込み時: sessionStorageを確認して処理を再開 =====
async function resumeFromStorage() {
  const state = getState();
  if (!state || !state.app) {
    console.log('[PinT] 再開する処理なし');
    return;
  }

  console.log('[PinT] sessionStorageから処理を再開 step=' + state.step);
  const app = state.app;

  if (state.step === 'search') {
    // 検索ページに戻ってきた場合は再入力
    await fillSupplyPointPage(app);
  } else if (state.step === 'click_vacancy') {
    // 絞込後のページ: 空室プランボタンを待つ
    console.log('[PinT] 絞込後ページ検出 → 空室プランボタンを待機');
    await waitForVacancyButton(app);
  } else if (state.step === 'fill_dates') {
    // 日付入力ページ: フォームを待って入力
    console.log('[PinT] 日付入力ページ検出 → フォームを待機');
    await waitForDateForm(app);
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

// ===== 初期化: ページ読み込み時に自動再開を試みる =====
console.log('[PinT] content.js v5 読み込み完了 url=' + location.href);
// 少し待ってからsessionStorageを確認（ページが安定してから）
setTimeout(resumeFromStorage, 1000);
