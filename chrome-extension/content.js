// PinT自動入力 content script

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== ステップ1: でんき地点管理ページで地点コード・補足1を入力して絞込 =====
async function fillSupplyPointPage(app) {
  await sleep(800);

  const chitenInput = document.getElementById('id_origin_code');
  const hosokuInput = document.getElementById('id_supplement1');

  if (!chitenInput || !hosokuInput) {
    console.log('[PinT] 地点コード/補足1フィールドが見つかりません');
    return;
  }

  // 地点コードを入力
  chitenInput.focus();
  chitenInput.value = app.chiten_code;
  chitenInput.dispatchEvent(new Event('input', { bubbles: true }));
  chitenInput.dispatchEvent(new Event('change', { bubbles: true }));
  chitenInput.blur();

  await sleep(200);

  // 補足1を入力
  hosokuInput.focus();
  hosokuInput.value = app.hosoku1;
  hosokuInput.dispatchEvent(new Event('input', { bubbles: true }));
  hosokuInput.dispatchEvent(new Event('change', { bubbles: true }));
  hosokuInput.blur();

  await sleep(300);

  // 絞込ボタンをクリック
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
    // セッションに保存してページ遷移後に継続
    sessionStorage.setItem('pint_auto_app', JSON.stringify(app));
    sessionStorage.setItem('pint_auto_step', 'find_vacancy_btn');
    console.log('[PinT] 絞込ボタンをクリック');
    filterBtn.click();
  } else {
    console.log('[PinT] 絞込ボタンが見つかりません');
  }
}

// ===== ステップ2: 検索結果から「空室プランの開始/停止」をクリック =====
async function clickVacancyButton(app) {
  await sleep(1500);

  let vacancyBtn = null;
  for (const el of document.querySelectorAll('a, button')) {
    if (el.textContent.includes('空室プランの開始')) {
      vacancyBtn = el;
      break;
    }
  }

  if (vacancyBtn) {
    sessionStorage.setItem('pint_auto_step', 'fill_dates');
    console.log('[PinT] 空室プランボタンをクリック');
    vacancyBtn.click();
  } else {
    alert('「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + ' / 補足1: ' + app.hosoku1);
    sessionStorage.removeItem('pint_auto_app');
    sessionStorage.removeItem('pint_auto_step');
  }
}

// ===== ステップ3: 空室プラン入力ページで日付を設定 =====
async function fillDates(app) {
  await sleep(1500);

  console.log('[PinT] 日付入力開始 power_on=' + app.power_on + ' power_off=' + app.power_off);

  const fpInput = document.getElementById('formtools_vacancy_use_period');

  if (!fpInput) {
    console.log('[PinT] flatpickr入力フィールドが見つかりません');
    return;
  }

  // flatpickrが初期化されるまで最大3秒待つ
  let fp = fpInput._flatpickr;
  let retry = 0;
  while (!fp && retry < 15) {
    await sleep(200);
    fp = fpInput._flatpickr;
    retry++;
  }

  if (fp) {
    console.log('[PinT] flatpickr発見、日付を設定します');

    // まずクリア
    fp.clear();
    await sleep(200);

    // parseDate で Date オブジェクトを生成（タイムゾーンずれ防止のため手動パース）
    const [sy, sm, sd] = app.power_on.split('-').map(Number);
    const [ey, em, ed] = app.power_off.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);

    fp.selectedDates = [startDate, endDate];
    fp.updateValue(true);

    // onChangeコールバックを手動で呼ぶ
    if (fp.config.onChange && fp.config.onChange.length > 0) {
      fp.config.onChange.forEach(fn => fn(fp.selectedDates, fp.input.value, fp));
    }

    await sleep(500);

    console.log('[PinT] 設定後の値: ' + fpInput.value);
    console.log('[PinT] start: ' + document.getElementById('formtools_vacancy_use_period_start')?.value);
    console.log('[PinT] end: ' + document.getElementById('formtools_vacancy_use_period_end')?.value);

  } else {
    console.log('[PinT] flatpickrが見つかりません、フォールバック処理');
    // フォールバック: readOnlyを外して直接入力
    const startInput = document.getElementById('formtools_vacancy_use_period_start');
    const endInput = document.getElementById('formtools_vacancy_use_period_end');
    if (startInput) {
      startInput.removeAttribute('readonly');
      startInput.value = app.power_on;
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
    sessionStorage.setItem('pint_auto_step', 'done');
    console.log('[PinT] 確認画面へボタンをクリック');
    confirmBtn.click();
  } else {
    console.log('[PinT] 確認画面へボタンが見つかりません');
  }

  setTimeout(() => {
    sessionStorage.removeItem('pint_auto_app');
    sessionStorage.removeItem('pint_auto_step');
  }, 3000);
}

// ===== ページ読み込み時に現在のURLに応じて処理を継続 =====
async function continueAutoFill() {
  const appData = sessionStorage.getItem('pint_auto_app');
  const step = sessionStorage.getItem('pint_auto_step');

  if (!appData || !step) return;

  const app = JSON.parse(appData);
  const url = location.href;

  console.log('[PinT] continueAutoFill step=' + step + ' url=' + url);

  if (step === 'find_vacancy_btn' && url.includes('/supplypoint/') && !url.includes('turn_and_termination')) {
    await clickVacancyButton(app);
  } else if (step === 'fill_dates' && url.includes('turn_and_termination_vacancy')) {
    await fillDates(app);
  }
}

// ===== メッセージリスナー（popup.jsからの指示） =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFill') {
    console.log('[PinT] startFill受信 app=' + JSON.stringify(message.app));
    fillSupplyPointPage(message.app);
    sendResponse({ status: 'started' });
  }
  return true;
});

// ===== ページ読み込み完了時に自動継続 =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', continueAutoFill);
} else {
  continueAutoFill();
}
window.addEventListener('load', continueAutoFill);
