/**
 * 台股選股機器人 v3.0 — Node.js 後端
 * 完整 REST API：篩選 / 回測 / 設定 / LINE / 排程 / Excel
 */
const http     = require('http');
const { spawn, exec } = require('child_process');
const fs       = require('fs');
const path     = require('path');
const url      = require('url');
const readline = require('readline');

const PORT      = 3000;
const BASE_DIR  = __dirname;
const DATA_DIR  = path.join(BASE_DIR, 'data');
const PY_DIR    = path.join(BASE_DIR, 'python');
const PUBLIC_DIR= path.join(BASE_DIR, 'public');
const LOG_DIR   = path.join(BASE_DIR, 'logs');

[DATA_DIR, LOG_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── 狀態 ──────────────────────────────────────────────
const state = {
  isScreening:  false,
  isBacktesting: false,
  screenPid:    null,
  backtestPid:  null,
  screenLog:    [],   // 最近100行篩選log
  backtestLog:  [],
  scheduleInfo: null,
};

// ── 工具 ──────────────────────────────────────────────
const readJSON = (p, def={}) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
};
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
const mime = ext => ({
  '.html':'text/html;charset=utf-8','.css':'text/css',
  '.js':'application/javascript','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.ico':'image/svg+xml',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.woff2':'font/woff2', '.svg':'image/svg+xml',
}[ext] || 'application/octet-stream');

const RESULT_FILE   = path.join(DATA_DIR, 'screening_result.json');
const BACKTEST_FILE = path.join(DATA_DIR, 'backtest_result.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  line_token: '', finmind_token: '',
  schedule_enabled: false, schedule_time: '18:00',
  schedule_days: ['Mon','Tue','Wed','Thu','Fri'],
  max_workers: 6, stock_pool_size: 500,
  notify_min_gates: 2,
  filters: { drop_60d_min:30, debt_ratio_max:50,
             require_dividend:true, require_eps_positive:true },
};

function loadConfig() {
  const cfg = readJSON(CONFIG_FILE, {});
  return Object.assign({}, DEFAULT_CONFIG, cfg,
    { filters: Object.assign({}, DEFAULT_CONFIG.filters, cfg.filters || {}) });
}

// ── Python 執行器 ──────────────────────────────────────
function runPython(args, logArr, onDone) {
  const proc = spawn('python3', [path.join(PY_DIR, 'screener.py'), ...args], {
    cwd: BASE_DIR, env: { ...process.env }
  });
  proc.stdout.on('data', d => {
    const lines = d.toString().split('\n').filter(Boolean);
    lines.forEach(l => { logArr.push({ t: Date.now(), msg: l }); if (logArr.length > 200) logArr.shift(); });
    process.stdout.write(d);
  });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.on('close', code => onDone(code));
  return proc;
}

// ── JSON 回應 ──────────────────────────────────────────
function respond(res, data, status=200) {
  res.writeHead(status, {
    'Content-Type':'application/json;charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ══════════════════════════════════════════════════════
// HTTP 伺服器
// ══════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
    });
    return res.end();
  }

  // ── GET /api/status ──────────────────────────────────
  if (pathname === '/api/status' && method === 'GET') {
    const cfg = loadConfig();
    return respond(res, {
      screening:    state.isScreening,
      backtesting:  state.isBacktesting,
      dataExists:   fs.existsSync(RESULT_FILE),
      backtestExists: fs.existsSync(BACKTEST_FILE),
      scheduleEnabled: cfg.schedule_enabled,
      scheduleTime:    cfg.schedule_time,
      scheduleDays:    cfg.schedule_days,
      lastRun:         cfg.last_run || null,
    });
  }

  // ── GET /api/results ────────────────────────────────
  if (pathname === '/api/results' && method === 'GET') {
    if (!fs.existsSync(RESULT_FILE)) return respond(res, { status:'no_data' });
    return respond(res, readJSON(RESULT_FILE));
  }

  // ── GET /api/backtest ───────────────────────────────
  if (pathname === '/api/backtest' && method === 'GET') {
    if (!fs.existsSync(BACKTEST_FILE)) return respond(res, { status:'no_data' });
    return respond(res, readJSON(BACKTEST_FILE));
  }

  // ── GET /api/log/screen ─────────────────────────────
  if (pathname === '/api/log/screen' && method === 'GET') {
    return respond(res, { logs: state.screenLog.slice(-100) });
  }

  // ── GET /api/log/backtest ───────────────────────────
  if (pathname === '/api/log/backtest' && method === 'GET') {
    return respond(res, { logs: state.backtestLog.slice(-100) });
  }

  // ── GET /api/config ──────────────────────────────────
  if (pathname === '/api/config' && method === 'GET') {
    const cfg = loadConfig();
    // 安全：隱藏 token 部分
    const safe = JSON.parse(JSON.stringify(cfg));
    if (safe.line_token)     safe.line_token_set = true;
    if (safe.finmind_token)  safe.finmind_token_set = true;
    return respond(res, safe);
  }

  // ── POST /api/config ─────────────────────────────────
  if (pathname === '/api/config' && method === 'POST') {
    const body = await parseBody(req);
    const cfg  = loadConfig();
    // 合併（不覆蓋空 token）
    if (body.line_token !== undefined)    cfg.line_token    = body.line_token;
    if (body.finmind_token !== undefined) cfg.finmind_token = body.finmind_token;
    if (body.schedule_enabled !== undefined) cfg.schedule_enabled = body.schedule_enabled;
    if (body.schedule_time)   cfg.schedule_time  = body.schedule_time;
    if (body.schedule_days)   cfg.schedule_days  = body.schedule_days;
    if (body.max_workers)     cfg.max_workers     = parseInt(body.max_workers);
    if (body.stock_pool_size) cfg.stock_pool_size = parseInt(body.stock_pool_size);
    if (body.notify_min_gates !== undefined) cfg.notify_min_gates = parseInt(body.notify_min_gates);
    if (body.filters)         cfg.filters = Object.assign(cfg.filters || {}, body.filters);
    writeJSON(CONFIG_FILE, cfg);

    // 如果排程設定改變，重新啟動排程（透過 Python）
    if (body.schedule_enabled !== undefined || body.schedule_time || body.schedule_days) {
      state.scheduleInfo = { enabled: cfg.schedule_enabled, time: cfg.schedule_time };
    }
    return respond(res, { ok: true, config: cfg });
  }

  // ── POST /api/screen ─────────────────────────────────
  if (pathname === '/api/screen' && method === 'POST') {
    if (state.isScreening) return respond(res, { status:'running', msg:'篩選進行中' });
    state.isScreening = true;
    state.screenLog = [];
    const proc = runPython([], state.screenLog, (code) => {
      state.isScreening = false;
      state.screenPid   = null;
      console.log(`[Server] 篩選完成 exit=${code}`);
    });
    state.screenPid = proc.pid;
    return respond(res, { status:'started', pid: proc.pid });
  }

  // ── POST /api/screen/stop ────────────────────────────
  if (pathname === '/api/screen/stop' && method === 'POST') {
    if (state.screenPid) {
      try { process.kill(state.screenPid, 'SIGTERM'); } catch {}
      state.isScreening = false;
    }
    return respond(res, { ok: true });
  }

  // ── POST /api/backtest ───────────────────────────────
  if (pathname === '/api/backtest' && method === 'POST') {
    if (state.isBacktesting) return respond(res, { status:'running', msg:'回測進行中' });
    const body = await parseBody(req);
    const hold = body.hold_days || 60;
    state.isBacktesting = true;
    state.backtestLog   = [];
    const proc = runPython(['backtest', String(hold)], state.backtestLog, (code) => {
      state.isBacktesting = false;
      state.backtestPid   = null;
      console.log(`[Server] 回測完成 exit=${code}`);
    });
    state.backtestPid = proc.pid;
    return respond(res, { status:'started', pid: proc.pid });
  }

  // ── POST /api/backtest/stop ──────────────────────────
  if (pathname === '/api/backtest/stop' && method === 'POST') {
    if (state.backtestPid) {
      try { process.kill(state.backtestPid, 'SIGTERM'); } catch {}
      state.isBacktesting = false;
    }
    return respond(res, { ok: true });
  }

  // ── POST /api/line/test ──────────────────────────────
  if (pathname === '/api/line/test' && method === 'POST') {
    const proc = runPython(['line_test'], [], (code) => {});
    return respond(res, { status:'sent', msg:'LINE 測試訊息已送出' });
  }

  // ── POST /api/line/send ──────────────────────────────
  if (pathname === '/api/line/send' && method === 'POST') {
    if (!fs.existsSync(RESULT_FILE)) return respond(res, { error:'無篩選結果' }, 400);
    // 手動觸發推播
    exec(`python3 -c "
import sys; sys.path.insert(0,'${PY_DIR}')
from screener import *
cfg = load_config()
with open('${RESULT_FILE}','r') as f:
    summary = __import__('json').load(f)
msg = build_line_message(summary, cfg.get('notify_min_gates',2))
ok = send_line_notify(cfg.get('line_token',''), msg)
print('ok' if ok else 'fail')
"`, { cwd: BASE_DIR }, (err, stdout, stderr) => {});
    return respond(res, { status:'sent' });
  }

  // ── GET /api/export/excel ────────────────────────────
  if (pathname === '/api/export/excel' && method === 'GET') {
    const files = fs.existsSync(DATA_DIR)
      ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx'))
          .map(f => ({ name:f, mt: fs.statSync(path.join(DATA_DIR,f)).mtime }))
          .sort((a,b) => b.mt - a.mt)
      : [];

    if (files.length) {
      const xlPath = path.join(DATA_DIR, files[0].name);
      res.writeHead(200, {
        'Content-Type': mime('.xlsx'),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(files[0].name)}`,
        'Access-Control-Allow-Origin': '*',
      });
      return fs.createReadStream(xlPath).pipe(res);
    }

    // 產出新 Excel
    exec(`python3 -c "
import sys; sys.path.insert(0,'${PY_DIR}')
from screener import export_excel; export_excel()
"`, { cwd: BASE_DIR }, (err, stdout, stderr) => {
      if (err) return respond(res, { error:'Excel 產生失敗' }, 500);
      const newFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx'));
      if (!newFiles.length) return respond(res, { error:'檔案未找到' }, 500);
      const xlPath = path.join(DATA_DIR, newFiles[0]);
      res.writeHead(200, {
        'Content-Type': mime('.xlsx'),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(newFiles[0])}`,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(xlPath).pipe(res);
    });
    return;
  }

  // ── 靜態檔案 ─────────────────────────────────────────
  if (pathname.startsWith('/static/')) {
    const fp = path.join(PUBLIC_DIR, pathname);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': mime(path.extname(fp)) });
      return fs.createReadStream(fp).pipe(res);
    }
  }

  // ── favicon ──────────────────────────────────────────
  if (pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><text x="16" y="23" font-size="18" text-anchor="middle">🤖</text></svg>');
  }

  // ── 主頁（SPA） ───────────────────────────────────────
  if (pathname === '/' || !pathname.startsWith('/api')) {
    const htmlPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end(fs.readFileSync(htmlPath, 'utf8'));
    }
  }

  respond(res, { error: 'Not found' }, 404);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 台股低基期選股機器人 v3.0`);
  console.log(`📡 http://0.0.0.0:${PORT}`);
  console.log(`\nAPI 端點：`);
  console.log(`  GET  /api/status          狀態`);
  console.log(`  GET  /api/results         篩選結果`);
  console.log(`  POST /api/screen          啟動篩選`);
  console.log(`  GET  /api/backtest        回測結果`);
  console.log(`  POST /api/backtest        啟動回測`);
  console.log(`  GET  /api/config          設定`);
  console.log(`  POST /api/config          更新設定`);
  console.log(`  POST /api/line/test       LINE測試`);
  console.log(`  POST /api/line/send       手動推播`);
  console.log(`  GET  /api/export/excel    下載Excel\n`);
});
