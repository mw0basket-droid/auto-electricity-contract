// background.js (Service Worker) v17
// 役割:
//   popup.js と content.js の橋渡し役。
//   popup.js から 'saveAppData' メッセージでデータを受け取り、
//   content.js から 'getAppData' メッセージでデータを返す。
//   ページ遷移をまたいでもデータが保持される。
//
//   v17追加: 'fillDatesInMainWorld' メッセージで
//   chrome.scripting.executeScript(world: 'MAIN')を実行する。
//   flatpickrは MAIN worldのイベントにしか反応しないため。

let pendingAppData = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'saveAppData') {
    pendingAppData = message.data;
    console.log('[background] saveAppData: ' + JSON.stringify(pendingAppData));
    sendResponse({ status: 'saved' });
    return true;
  }

  if (message && message.action === 'getAppData') {
    console.log('[background] getAppData: ' + JSON.stringify(pendingAppData));
    sendResponse({ data: pendingAppData });
    return true;
  }

  if (message && message.action === 'clearAppData') {
    pendingAppData = null;
    console.log('[background] clearAppData');
    sendResponse({ status: 'cleared' });
    return true;
  }

  // content.js からタブIDを問い合わせる
  if (message && message.action === 'getCurrentTabId') {
    const tabId = sender.tab ? sender.tab.id : null;
    console.log('[background] getCurrentTabId: ' + tabId);
    sendResponse({ tabId: tabId });
    return true;
  }

  // content.js から呼び出され、MAIN world で日付入力を実行する
  if (message && message.action === 'fillDatesInMainWorld') {
    const { tabId, powerOn, powerOff } = message;
    console.log('[background] fillDatesInMainWorld tabId=' + tabId + ' powerOn=' + powerOn + ' powerOff=' + powerOff);

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: fillDatesMainWorld,
      args: [powerOn, powerOff]
    }).then(results => {
      console.log('[background] executeScript完了: ' + JSON.stringify(results));
      sendResponse({ status: 'done', results: results });
    }).catch(err => {
      console.log('[background] executeScriptエラー: ' + err.message);
      sendResponse({ status: 'error', message: err.message });
    });
    return true;  // 非同期応答
  }
});

// MAIN world で実行される日付入力関数
// 注意: この関数はシリアライズされてページに注入されるため、クロージャなどは使えない
function fillDatesMainWorld(powerOn, powerOff) {
  return new Promise(async (resolve) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function log(msg) { console.log('[PinT-MAIN] ' + msg); }

    // 入力エレメントを探す
    function findInput() {
      const byId = document.getElementById('formtools_vacancy_use_period');
      if (byId) return byId;
      const byAttr = document.querySelector('[id="formtools vacancy use period"]');
      if (byAttr) return byAttr;
      return document.querySelector('.flatpickr-input');
    }

    const fpInput = findInput();
    if (!fpInput) {
      log('入力エレメントが見つかりません');
      resolve({ success: false, reason: 'no_input' });
      return;
    }

    // flatpickr インスタンスを取得
    const fp = fpInput._flatpickr;
    if (!fp) {
      log('_flatpickrインスタンスが見つかりません');
      resolve({ success: false, reason: 'no_flatpickr' });
      return;
    }

    log('flatpickr発見、カレンダーを開く');
    fp.open();
    await sleep(400);

    const calendarEl = fp.calendarContainer;
    if (!calendarEl) {
      log('カレンダーコンテナが見つかりません');
      resolve({ success: false, reason: 'no_calendar' });
      return;
    }
    log('カレンダーコンテナ: ' + calendarEl.className);

    const [sy, sm, sd] = powerOn.split('-').map(Number);
    const [ey, em, ed] = powerOff.split('-').map(Number);

    // 日付セルをクリックする関数（月またぎ対応）
    async function clickDate(year, month, day) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const monthSel = calendarEl.querySelector('.flatpickr-monthDropdown-months');
        const yearInp = calendarEl.querySelector('.numInputWrapper input.cur-year');
        let curMonth = monthSel ? parseInt(monthSel.value) + 1 : -1;
        let curYear = yearInp ? parseInt(yearInp.value) : -1;
        log('現在: ' + curYear + '年' + curMonth + '月 目標: ' + year + '年' + month + '月');

        if (curYear === year && curMonth === month) {
          // 日付セルを探す
          const cells = calendarEl.querySelectorAll(
            '.flatpickr-day:not(.flatpickr-disabled):not(.prevMonthDay):not(.nextMonthDay)'
          );
          for (const cell of cells) {
            if (parseInt(cell.textContent.trim()) === day) {
              log('日付セルクリック: ' + day + '日');
              cell.click();
              return true;
            }
          }
          log('日付セルが見つかりません: ' + day + '日');
          return false;
        } else {
          const nextBtn = calendarEl.querySelector('.flatpickr-next-month');
          if (nextBtn) {
            log('次月へ移動');
            nextBtn.click();
            await sleep(300);
          } else {
            log('次月ボタンが見つかりません');
            return false;
          }
        }
      }
      return false;
    }

    // 開始日をクリック
    const r1 = await clickDate(sy, sm, sd);
    log('開始日クリック結果: ' + r1);
    await sleep(400);

    // 終了日をクリック
    const r2 = await clickDate(ey, em, ed);
    log('終了日クリック結果: ' + r2);
    await sleep(400);

    // カレンダーを閉じる
    fp.close();
    await sleep(200);

    log('完了 main=' + fpInput.value);
    resolve({ success: true, value: fpInput.value });
  });
}
