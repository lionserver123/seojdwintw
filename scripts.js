// ====== DOM ======
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const reloadBtn = document.getElementById('reloadBtn');
const statusEl = document.getElementById('status');
const rowCountEl = document.getElementById('row-count');

const sheetIdInput = document.getElementById('sheetId');
const gidInput = document.getElementById('gid');
const workerCountInput = document.getElementById('workerCount');
const launchGapInput = document.getElementById('launchGap');
const reloadEveryInput = document.getElementById('reloadEvery');

// ====== 狀態 ======
let running = false;
let workers = [];
let logBuffer = [];
let lastIndexes = [];
let sheetPairs = []; // [{ src, dest }]
let runCounter = 0;  // 🔥 完成次數計數器（全域）
let reloading = false; // [{ src, dest }]

// ====== 工具 ======
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const isHttp = (url) => /^https?:\/\//i.test(url || '');
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logBuffer.push(`[${ts}] ${msg}`);

  // 最多保留 20 行
  if (logBuffer.length > 12) {
    logBuffer.shift(); // 移除最舊的一行
  }

  statusEl.textContent = logBuffer.join("\n");
  statusEl.scrollTop = statusEl.scrollHeight;
}
function toggleButtons() {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}
function pickRandomIndex(len, avoid = -1) {
  if (len <= 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * len); } while (idx === avoid);
  return idx;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

async function maybeReloadSheetPairs() {
  const reloadEvery = Math.max(1, parseInt(reloadEveryInput.value, 10) || 20);
  if (runCounter > 0 && runCounter % reloadEvery === 0) {
    if (reloading) {
      log(`另一個重新載入正在進行中，略過此次觸發。`);
      return;
    }
    try {
      reloading = true;
      log(`🔄 達到 ${reloadEvery} 次，重新載入 Google Sheet…`);
      await loadSheetPairs();
      // 如果資料長度改變，重置 lastIndexes 以避免索引重複或越界
      lastIndexes = new Array(lastIndexes.length).fill(-1);
      log(`✅ 重新載入完成。`);
    } catch (e) {
      log(`❌ 重新載入失敗：${e?.message || e}`);
    } finally {
      reloading = false;
    }
  }
}

// ====== 載入 Google Sheet（E=來源、F=目的地）======
async function loadSheetPairs() {
  const SHEET_ID = sheetIdInput.value.trim();
  const GID = gidInput.value.trim();
  // 只抓 E/F，並忽略空的 E
  const QUERY = "select E,F where E is not null";
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tq=${encodeURIComponent(QUERY)}&gid=${encodeURIComponent(GID)}`;

  log('嘗試載入試算表資料…');
  const txt = await fetch(url).then(r => r.text());

  // gviz 回傳包在 setResponse(...) 裡面，取出 JSON
  const m = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
  if (!m) throw new Error('無法解析 gviz 回應');

  const json = JSON.parse(m[1]);
  const rows = (json.table?.rows || []).map(r => r.c.map(c => (c ? c.v : "")));

  // rows = [ [E, F], [E, F], ... ]；只保留 E 是 http(s)，F 可為空（之後用預設目的地）
  const pairs = rows
    .map(([e, f]) => [String(e || '').trim(), String(f || '').trim()])
    .filter(([e]) => isHttp(e))
    .map(([e, f]) => ({ src: e, dest: isHttp(f) ? f : '' }));

  sheetPairs = pairs;
  rowCountEl.textContent = `總列數：${sheetPairs.length}`;
  log(`資料載入完成，取得 ${sheetPairs.length} 列（E=來源，F=目的地）。`);
 /*  log(`資料載入完成，取得 ${sheetPairs.length} 列（忽略標題列）。`);

  // 🔎 額外列出所有 E 欄網址，方便檢查
  log("E 欄資料清單：");
  pairs.forEach((p, i) => {
    log(`第 ${i + 1} 列 E 欄 = ${p.src}`);
  }); */

  if (sheetPairs.length === 0) {
    log('⚠️ 沒有可用列（E 欄需為 http/https）。');
  }
}

// ====== 單次處理（使用一對 {src, dest}）======
async function processOnePair(pair, workerId) {
  const { src, dest } = pair;
  const destUrl = dest || 'https://www.google.com';

  log(`#${workerId} 開啟：${src}`);
  const win = window.open('about:blank', '_blank', "width=375,height=812,left=100,top=100");
  if (!win || win.closed) {
    log(`#${workerId} ⚠️ 無法開啟新分頁（可能被瀏覽器阻擋）`);
    return;
  }

  try {
    win.document.write(`
      <!doctype html><meta charset="utf-8">
      <title>載入中…</title>
      <style>body{font:14px/1.6 system-ui;margin:24px}</style>
      <body>#${workerId} 即將開啟：<code>${escapeHtml(src)}</code></body>
    `);
    win.document.close();
  } catch {}

  // 來源
  try { win.location.href = src; } catch {}

  const wait1 = randInt(70, 100);
  log(`#${workerId} 等待 ${wait1}s 後跳轉到目的地`);
  await sleep(wait1 * 1000);

  if (!running || win.closed) return;
  try { win.location.href = destUrl; } catch {}

  const wait2 = randInt(80, 100);
  log(`#${workerId} 已跳轉，等待 ${wait2}s 後關閉`);
  await sleep(wait2 * 1000);

  if (!running || win.closed) return;
  try { win.location.replace('about:blank'); } catch {}
  await sleep(1000);
  try { win.close(); } catch {}

  if (win.closed) {
    log(`#${workerId} ✅ 已關閉分頁`);
  } else {
    log(`#${workerId} ⚠️ 關閉失敗，可能要手動關閉`);
  }

  // 🔢 累計一次流程完成，必要時觸發重新載入
  runCounter++;
  maybeReloadSheetPairs();
}

// ====== Worker 迴圈：每輪都隨機抽一列（E/F）======
async function workerLoop(workerId) {
  while (running) {
    if (sheetPairs.length === 0) {
      log(`#${workerId} ⚠️ 無資料可用，停止該 worker`);
      return;
    }
    const idx = pickRandomIndex(sheetPairs.length, lastIndexes[workerId] ?? -1);
    lastIndexes[workerId] = idx;
    const pair = sheetPairs[idx];

    await processOnePair(pair, workerId);
    if (!running) break;

    const cooldown = randInt(100, 120);
    log(`#${workerId} 冷卻 ${cooldown}s 後挑下一列`);
    await sleep(cooldown * 1000);
  }
}

// ====== 事件 ======
startBtn.addEventListener('click', async () => {
  if (running) return;
  statusEl.textContent = '執行中…';
  running = true;
  toggleButtons();

  runCounter = 0;   // 🔁 重置計數
  reloading  = false;

  try {
    await loadSheetPairs();
  } catch (e) {
    log('❌ 載入失敗：' + (e?.message || e));
    running = false;
    toggleButtons();
    return;
  }
  if (sheetPairs.length === 0) {
    running = false;
    toggleButtons();
    return;
  }

  const workerCount = Math.max(1, parseInt(workerCountInput.value, 10) || 1);
  const launchGap = Math.max(0, parseInt(launchGapInput.value, 10) || 0);

  workers = [];
  lastIndexes = new Array(workerCount).fill(-1);

  log(`啟動 ${workerCount} 個流程，間隔 ${launchGap}ms…`);
  for (let i = 0; i < workerCount; i++) {
    workers.push(workerLoop(i + 1));
    if (launchGap > 0) await sleep(launchGap);
  }
});

stopBtn.addEventListener('click', () => {
  running = false;
  toggleButtons();
  log('收到停止指令，等待現有流程收尾…');
});

reloadBtn.addEventListener('click', async () => {
  try {
    await loadSheetPairs();
  } catch (e) {
    log('❌ 重新載入失敗：' + (e?.message || e));
  }
});












