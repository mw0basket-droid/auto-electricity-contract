// PinT自動入力 content script v9
// 設計方針:
//   popup.js が sessionStorage に書き込んでから sendMessage(startFill) を送る
//   content.js は startFill を受け取って即時実行する
//   ページ遷移後は sessionStorage を確認して自動再開する
//   startFill メッセージが届かなかった場合は sessionStorage から自動再開する（フォールバック）

const STORAGE_KEY = 'pint_auto_fill';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== sessionStorage 操作 =====
function getState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function setState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log('[PinT] state保存: step=' + state.step);
  } catch(e) { console.log('[PinT] state保存失敗:', e); }
}
function clearState() {
  sessionStorage.removeItem(STORAGE_KEY);
  console.log('[PinT] stateクリア');
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

// ===== ページ種別を URL で厳密に判定 =====
function getPageType() {
  const url = location.href;
  if (/\/supplypoint\/\d+\/turn_and_termination_vacancy/.test(url)) {
    return 'date_form';
  }
  if (/\/supplypoint\/\?/.test(url)) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    if (params.get('origin_code') && params.get('origin_code').length > 0) {
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
  setState({ step: 'search', app: app });

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
    clearState();
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
    setState({ step: 'click_vacancy', app: app });
    console.log('[PinT] 絞込ボタンをクリック → step=click_vacancy');
    filterBtn.click();
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
    clearState();
  }
}

// ===== ステップ2: 「空室プランの開始/停止」ボタンが現れるのを待つ =====
async function waitForVacancyButton(app) {
  console.log('[PinT] 空室プランボタンを待機中...');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const btn = findVacancyButton();
    if (btn) {
      console.log('[PinT] 空室プランボタン発見、クリック → step=fill_dates');
      setState({ step: 'fill_dates', app: app });
      btn.click();
      return;
    }
  }
  console.log('[PinT] 空室プランボタンが見つかりませんでした（タイムアウト）');
  alert('[PinT] 「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
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

// ===== ステップ3: 日付入力フォームが現れるのを待つ =====
async function waitForDateForm(app) {
  console.log('[PinT] 日付入力フォームを待機中...');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const fpInput = getFormElement('formtools vacancy use period');
    if (fpInput) {
      console.log('[PinT] 日付フォーム発見 id="' + fpInput.id + '"、fillDates実行');
      fillDates(app);
      return;
    }
  }
  console.log('[PinT] 日付フォームが見つかりませんでした（タイムアウト）');
  console.log('[PinT] ページ上のinput要素:');
  document.querySelectorAll('input').forEach(el => {
    console.log('  id=' + el.id + ' type=' + el.type + ' value=' + el.value.substring(0, 30));
  });
  clearState();
}

// ===== ステップ4: 日付を設定して確認画面へ =====
async function fillDates(app) {
  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  let fpInput = null;
  let fp = null;
  for (let i = 0; i < 30; i++) {
    fpInput = getFormElement('formtools vacancy use period');
    if (fpInput && fpInput._flatpickr) {
      fp = fpInput._flatpickr;
      break;
    }
    await sleep(200);
  }

  if (!fpInput) {
    console.log('[PinT] 日付フォームが見つかりません');
    clearState();
    return;
  }

  if (fp) {
    console.log('[PinT] flatpickr発見、日付を設定します');
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
    console.log('[PinT] 設定後 start=' + (startEl ? startEl.value : 'N/A') + ' end=' + (endEl ? endEl.value : 'N/A'));
  } else {
    console.log('[PinT] flatpickrなし、直接入力します');
    const startInput = getFormElement('formtools vacancy use period start');
    const endInput = getFormElement('formtools vacancy use period end');
    if (startInput) {
      startInput.removeAttribute('readonly');
      startInput.value = app.power_on;
      startInput.dispatchEvent(new Event('input', { bubbles: true }));
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(200);
    if (endInput) {
      endInput.removeAttribute('readonly');
      endInput.value = app.power_off;
      endInput.dispatchEvent(new Event('input', { bubbles: true }));
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

// ===== メイン処理: sessionStorage と URL を確認して処理を振り分ける =====
async function resumeFromStorage() {
  const state = getState();
  if (!state || !state.app) {
    console.log('[PinT] 再開する処理なし');
    return;
  }
  const pageType = getPageType();
  const app = state.app;
  console.log('[PinT] 処理再開 step=' + state.step + ' pageType=' + pageType);

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
    console.log('[PinT] ページ種別不明 pageType=' + pageType + ' → stateクリア');
    clearState();
  }
}

// ===== メッセージリスナー（popup.jsからの startFill 指示）=====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFill') {
    console.log('[PinT] startFill受信 → resumeFromStorage実行');
    sendResponse({ status: 'started' });
    // 非同期で実行（sendResponseの後）
    setTimeout(() => resumeFromStorage(), 0);
  }
  return true;
});

// ===== 初期化: ページ読み込み時に sessionStorage を確認 =====
console.log('[PinT] content.js v9 読み込み完了 url=' + location.href);
// sendMessage が届かなかった場合のフォールバック（ページ遷移後の自動再開）
setTimeout(resumeFromStorage, 500);
