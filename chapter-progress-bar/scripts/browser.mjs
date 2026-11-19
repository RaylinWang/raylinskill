// 公用：起一个本地文件服务 + 无头 Chrome，通过 CDP 操作页面。render.mjs（出片）和 prepare_character.mjs（抠图）都用它。
// macOS / Windows / Linux 都能用；找不到 Chrome 时用环境变量 CHROME 指定。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 本机任意文件 → 页面里能用的地址（Windows 盘符路径也行）
export const fileUrl = p => '/file/' + encodeURIComponent(path.resolve(p));

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const L = process.env.LOCALAPPDATA || '', P = process.env.PROGRAMFILES || 'C:\\Program Files', P86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(P, 'Google/Chrome/Application/chrome.exe'), path.join(P86, 'Google/Chrome/Application/chrome.exe'), path.join(L, 'Google/Chrome/Application/chrome.exe'),
    path.join(P, 'Microsoft/Edge/Application/msedge.exe'), path.join(P86, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  ].find(p => p && fs.existsSync(p));
}

export async function openBrowser({ width = 1280, height = 720 } = {}) {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const f = u.startsWith('/file/') ? decodeURIComponent(u.slice(6)) : path.join(HERE, path.normalize(decodeURIComponent(u)));
    fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); res.end(buf); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const CHROME = findChrome();
  if (!CHROME) { server.close(); throw new Error('找不到 Chrome。装 Google Chrome（或 Edge / Chromium），或用环境变量 CHROME 指向它'); }
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cpb-'));
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const close = async () => {
    try { ws?.close(); } catch {}
    server.close();
    if (chrome.exitCode === null) { const gone = new Promise(r => chrome.once('exit', r)); chrome.kill(); await Promise.race([gone, new Promise(r => setTimeout(r, 3000))]); }
    try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  };
  let ws;
  try {
    const wsUrl = await new Promise((ok, bad) => {
      let buf = ''; const to = setTimeout(() => bad(new Error('Chrome 没起来。Agent 的沙盒里常常起不了 Chrome（比如 Claude 桌面端），请在终端里运行')), 20000);
      chrome.on('error', e => { clearTimeout(to); bad(new Error('启动 Chrome 失败：' + e.message)); });
      chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); ok(m[1]); } });
    });
    const tab = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('连不上 Chrome')); });
  } catch (e) { await close(); throw e; }

  let id = 0; const pending = new Map();
  ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; pending.set(i, d => (d.error ? bad(new Error(method + ': ' + d.error.message)) : ok(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const setSize = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  // 打开 scripts/ 下的页面，等到 window[ready] 出现
  const open = async (page, ready) => {
    await send('Page.enable');
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${page}` });
    for (let i = 0; i < 100 && !(await evaluate(`typeof window.${ready}==="function" && document.readyState==="complete"`).catch(() => false)); i++) await new Promise(r => setTimeout(r, 100));
  };
  await setSize(width, height);
  return { send, evaluate, setSize, open, close };
}
