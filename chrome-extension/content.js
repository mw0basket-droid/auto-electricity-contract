
// PinT自動入力 content script

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fillSupplyPointPage(app) {
  // でんき地点管理ページかチェック
  if (!location.href.includes('/supplypoint/')) {
    location.href = 'https://kentaku.pint-cloud.com/supplypoint/';
    return;
  }
  
  await sleep(500);
  
  // 地点コードを入力
  const chitenInput = document.getElementById('id_origin_code');
  if (chitenInput) {
    chitenInput.value = app.chiten_code;
    chitenInput.dispatchEvent(new Event('input', {bubbles: true}));
    chitenInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  
  // 補足1を入力
  const hosokuInput = document.getElementById('id_supplement1');
  if (hosokuInput) {
    hosokuInput.value = app.hosoku1;
    hosokuInput.dispatchEvent(new Event('input', {bubbles: true}));
    hosokuInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  
  await sleep(300);
  
  // 絞込ボタンをクリック
  const buttons = document.querySelectorAll('button[type="submit"], input[type="submit"]');
  let filterBtn = null;
  for (const btn of buttons) {
    if (btn.textContent.includes('絞込') || btn.value === '絞込') {
      filterBtn = btn;
      break;
    }
  }
  if (!filterBtn) {
    // フォームのsubmitボタンを探す
    const form = document.querySelector('form');
    if (form) {
      const submitBtns = form.querySelectorAll('button, input[type="submit"]');
      filterBtn = submitBtns[submitBtns.length - 1];
    }
  }
  
  if (filterBtn) {
    // 申請データをsessionStorageに保存（ページ遷移後に使用）
    sessionStorage.setItem('pint_auto_app', JSON.stringify(app));
    sessionStorage.setItem('pint_auto_step', 'find_vacancy_btn');
    filterBtn.click();
  }
}

async function clickVacancyButton(app) {
  await sleep(1000);
  
  // 「空室プランの開始/停止」ボタンを探す
  const allButtons = document.querySelectorAll('a, button');
  let vacancyBtn = null;
  
  for (const btn of allButtons) {
    if (btn.textContent.includes('空室プラン')) {
      vacancyBtn = btn;
      break;
    }
  }
  
  if (vacancyBtn) {
    sessionStorage.setItem('pint_auto_step', 'fill_dates');
    vacancyBtn.click();
  } else {
    alert('「空室プランの開始/停止」ボタンが見つかりませんでした。\n地点コード: ' + app.chiten_code + '\n補足1: ' + app.hosoku1 + '\nで検索結果を確認してください。');
    sessionStorage.removeItem('pint_auto_app');
    sessionStorage.removeItem('pint_auto_step');
  }
}

async function fillDates(app) {
  await sleep(1000);
  
  // flatpickrインスタンスを取得して日付範囲を設定
  const fpInput = document.getElementById('formtools_vacancy_use_period');
  
  if (fpInput && fpInput._flatpickr) {
    const fp = fpInput._flatpickr;
    
    // parseDate で Date オブジェクトを生成
    const startDate = fp.parseDate(app.power_on, 'Y-m-d');
    const endDate = fp.parseDate(app.power_off, 'Y-m-d');
    
    if (startDate && endDate) {
      // selectedDates に直接セットして updateValue で反映
      fp.selectedDates = [startDate, endDate];
      fp.updateValue(true);
      
      // changeイベントも発火
      fpInput.dispatchEvent(new Event('change', {bubbles: true}));
      
      await sleep(500);
    } else {
      // fallback: 個別フィールドへの直接入力
      await fillDatesFallback(app);
      return;
    }
  } else {
    // flatpickrが見つからない場合のfallback
    await fillDatesFallback(app);
    return;
  }
  
  await sleep(500);
  
  // 確認画面へボタンをクリック
  const allBtns = document.querySelectorAll('button');
  let confirmBtn = null;
  for (const btn of allBtns) {
    if (btn.textContent.includes('確認画面')) {
      confirmBtn = btn;
      break;
    }
  }
  if (!confirmBtn) {
    confirmBtn = document.querySelector('button[type="submit"]');
  }
  
  if (confirmBtn) {
    sessionStorage.setItem('pint_auto_step', 'confirm');
    confirmBtn.click();
  }
  
  // セッションデータをクリア（確認画面に進んだ後）
  setTimeout(() => {
    sessionStorage.removeItem('pint_auto_app');
    sessionStorage.removeItem('pint_auto_step');
  }, 2000);
}

async function fillDatesFallback(app) {
  // flatpickrが使えない場合の代替処理
  const startInput = document.getElementById('formtools_vacancy_use_period_start');
  const endInput = document.getElementById('formtools_vacancy_use_period_end');
  
  if (startInput) {
    // readOnlyを一時的に解除して値を設定
    startInput.removeAttribute('readonly');
    startInput.value = app.power_on;
    startInput.dispatchEvent(new Event('input', {bubbles: true}));
    startInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  
  await sleep(300);
  
  if (endInput) {
    endInput.removeAttribute('readonly');
    endInput.value = app.power_off;
    endInput.dispatchEvent(new Event('input', {bubbles: true}));
    endInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  
  await sleep(500);
  
  // 確認画面へボタンをクリック
  const allBtns = document.querySelectorAll('button');
  let confirmBtn = null;
  for (const btn of allBtns) {
    if (btn.textContent.includes('確認画面')) {
      confirmBtn = btn;
      break;
    }
  }
  if (!confirmBtn) {
    confirmBtn = document.querySelector('button[type="submit"]');
  }
  
  if (confirmBtn) {
    sessionStorage.setItem('pint_auto_step', 'confirm');
    confirmBtn.click();
  }
  
  setTimeout(() => {
    sessionStorage.removeItem('pint_auto_app');
    sessionStorage.removeItem('pint_auto_step');
  }, 2000);
}

// ページ読み込み時に自動処理を継続
async function continueAutoFill() {
  const appData = sessionStorage.getItem('pint_auto_app');
  const step = sessionStorage.getItem('pint_auto_step');
  
  if (!appData || !step) return;
  
  const app = JSON.parse(appData);
  
  if (step === 'find_vacancy_btn' && location.href.includes('/supplypoint/')) {
    await clickVacancyButton(app);
  } else if (step === 'fill_dates' && location.href.includes('/turn_and_termination_vacancy')) {
    await fillDates(app);
  }
}

// メッセージリスナー（popup.jsからの指示を受け取る）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFill') {
    fillSupplyPointPage(message.app);
    sendResponse({status: 'started'});
  }
  return true;
});

// ページ読み込み時に自動処理を継続
window.addEventListener('load', () => {
  continueAutoFill();
});

// DOMContentLoadedでも試みる
document.addEventListener('DOMContentLoaded', () => {
  continueAutoFill();
});
