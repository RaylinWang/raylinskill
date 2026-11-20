// 章节进度条出片。无头 Chrome 逐帧画 renderer.html，ffmpeg 编码。
//
//   node render.mjs 配置.json --check 检查图.jpg        安全区检查 + 3 张检查帧拼图（出片前先跑这个）
//   node render.mjs 配置.json --still 秒 检查帧.png     单张检查帧（有 video 就叠在那一帧上，画安全框；--no-guides 不画框）
//                                                       --check / --still 可加 --bg 图片：叠在一张截图上看（没有视频时很好用）
//   node render.mjs 配置.json --over 成片.mp4           叠到 video 上出成片（Agent 剪辑用，音频原样带上）
//   node render.mjs 配置.json                           透明底 MOV（ProRes 4444），全画幅，拖进剪辑软件直接对齐
//   node render.mjs 配置.json --green 绿幕.mp4          绿幕 MP4，给不认透明视频的软件（剪映手机版用「色度抠图」抠掉）
//
// 配置字段见 SKILL.md。依赖：Google Chrome（或 CHROME 环境变量指向的 Chromium）、node ≥ 22、ffmpeg / ffprobe。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { openBrowser, fileUrl } from './browser.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(HERE);
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const after = (f, i = 1) => args[args.indexOf(f) + i];
if (!args[0] || args[0].startsWith('--')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 9).join('\n')); process.exit(1); }
const die = m => { console.error('✗ ' + m); process.exit(2); };

// ───────── 读配置 ─────────
const cfgPath = path.resolve(args[0]);
const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const cfgDir = path.dirname(cfgPath);
const rel = p => (p == null ? p : path.isAbsolute(p) ? p : path.resolve(cfgDir, p.replace(/^~(?=\/)/, os.homedir())));
const cfg = { ...raw };

cfg.style = String(raw.style || '').toUpperCase();
if (!['A', 'B', 'C', 'D'].includes(cfg.style)) die('style 要填 A / B / C / D（A 空心横条、B 分段细条、C 手绘条 + 走路角色、D 美式复古条 + 表情角色）');
if (!Array.isArray(raw.segments) || !raw.segments.length) die('segments 不能为空：每章 {label, start, end}，单位秒');
raw.segments.forEach((s, i) => {
  if (!s.label) die(`第 ${i + 1} 章没有 label`);
  if (!(+s.end > +s.start)) die(`第 ${i + 1} 章「${s.label}」的 end 要大于 start`);
  if (i && +s.start < +raw.segments[i - 1].end - 1e-6) die(`第 ${i + 1} 章「${s.label}」和上一章时间重叠`);
});

// 画幅：有 video 读 video；没有就必须填 aspect（导出时由用户选）
const ASPECT = { '9:16': [1080, 1920], '3:4': [1080, 1440], '4:5': [1080, 1350], '1:1': [1080, 1080], '4:3': [1440, 1080], '16:9': [1920, 1080] };
cfg.video = rel(raw.video);
if (cfg.video) {
  if (!fs.existsSync(cfg.video)) die('找不到 video：' + cfg.video);
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration', '-of', 'json', cfg.video]).toString());
  const st = p.streams[0]; let [w, h] = [st.width, st.height];
  const rot = Math.abs(+(st.side_data_list?.[0]?.rotation || 0)); if (rot === 90 || rot === 270) [w, h] = [h, w];
  cfg.width ??= w; cfg.height ??= h; cfg.duration ??= +p.format.duration;
  const [a, b] = st.r_frame_rate.split('/').map(Number); cfg.fps ??= Math.round((a / (b || 1)) * 100) / 100;
} else {
  if (!raw.width || !raw.height) {
    if (!raw.aspect) die('没有 video 时要选画幅：aspect 填 9:16 / 3:4 / 4:5 / 1:1 / 4:3 / 16:9 之一（或直接填 width、height）');
    if (!ASPECT[raw.aspect]) die('aspect 只能是 ' + Object.keys(ASPECT).join(' / '));
    [cfg.width, cfg.height] = ASPECT[raw.aspect];
  }
  cfg.duration ??= +raw.segments.at(-1).end + 1;
}
cfg.fps ??= 30;
if (cfg.width % 2 || cfg.height % 2) die('宽高要是偶数');

// 安全区
const zones = JSON.parse(fs.readFileSync(path.join(SKILL, 'safe-zones.json'), 'utf8'));
const vertical = cfg.width / cfg.height < 0.65;
const group = vertical ? zones.vertical : zones.other;
const plat = raw.platform || 'default';
if (vertical && !group[plat]) die('platform 只能是 ' + Object.keys(group).filter(k => !k.startsWith('_')).join(' / '));
const m = raw.safeZone || group[plat] || group.default;
cfg.safe = { x0: Math.round(cfg.width * m.left), y0: Math.round(cfg.height * m.top), x1: Math.round(cfg.width * (1 - m.right)), y1: Math.round(cfg.height * (1 - m.bottom)) };

// 配色：主题名，或 {base, 改几个色}；不填按样式默认（D 美式红蓝，其他深红奶油）
const themes = JSON.parse(fs.readFileSync(path.join(SKILL, 'themes/themes.json'), 'utf8'));
const defTheme = cfg.style === 'D' ? '美式红蓝' : '深红奶油';
let th = raw.theme ?? defTheme;
if (typeof th === 'string') { if (!themes[th]) die(`没有主题「${th}」，可选：${Object.keys(themes).filter(k => !k.startsWith('_')).join(' / ')}`); th = { ...themes[th] }; }
else { const base = themes[th.base || defTheme]; if (!base) die('theme.base 不存在：' + th.base); th = { ...base, ...th }; delete th.base; }
for (const [k, v] of Object.entries(th)) if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) die(`theme.${k} 要写成 #RRGGBB，现在是 ${v}`);
cfg.theme = th;

// 角色：C 走路、D 表情。必须是用户自己的形象（先用 prepare_character.mjs 做好），没有就不出片。
// skill 里 examples/示范形象/ 只是给用户看「该准备什么样的图」，不能拿来出片。
const asset = fileUrl;
let ch = { kind: 'none' };
if (cfg.style === 'C' || cfg.style === 'D') {
  const want = cfg.style === 'C' ? 'walk' : 'face';
  const zh = t => (t === 'walk' ? '走路' : '表情');
  const LIB = process.env.CPB_CHARACTERS || path.join(os.homedir(), 'Documents/进度条角色');
  const packs = (fs.existsSync(LIB) ? fs.readdirSync(LIB) : []).filter(n => !n.startsWith('.') && fs.existsSync(path.join(LIB, n, '角色.json')))
    .map(n => ({ n, t: JSON.parse(fs.readFileSync(path.join(LIB, n, '角色.json'), 'utf8')).type }));
  const ofType = packs.filter(p => p.t === want).map(p => p.n);
  const howTo = `样式 ${cfg.style} 要用你自己的${zh(want)}形象，请先做一个：准备${want === 'walk' ? ' 2 张同一个小人朝右走路的迈步图（左脚在前、右脚在前，全身）' : ' 1–5 张同一个人的不同表情（头像）'}，白底或透明底，然后运行\n  node prepare_character.mjs --type ${want}${want === 'walk' ? ' --facing right' : ''} --name 你的角色名 图1.png 图2.png …\n  没有现成的图，把 prompts/形象生成提示词.md 里对应的那段提示词和你的正面照一起发给 AI 生图工具生成`;
  let c = raw.character;
  if (c == null) {
    if (ofType.length === 1) { c = ofType[0]; console.log(`· 角色：${c}（你的角色库里唯一的${zh(want)}角色）`); }
    else if (ofType.length > 1) die(`你的角色库里有 ${ofType.length} 个${zh(want)}角色：${ofType.join('、')}。配置里用 "character" 写明用哪个`);
    else die(`还没有你自己的${zh(want)}形象。` + howTo);
  }
  if (c === 'builtin') die('C、D 不提供内置角色，要用你自己的形象。' + howTo);
  const isPath = /[\/\\]/.test(c) || c.startsWith('~') || c.startsWith('.');
  const dir = isPath ? rel(c) : path.join(LIB, c), mf = path.join(dir, '角色.json');
  if (path.resolve(dir).startsWith(SKILL + path.sep)) die('examples/示范形象/ 里的是示范图，不能拿来出片。' + howTo);
  if (!fs.existsSync(mf)) die(`找不到角色「${c}」。你的角色库（${LIB}）里的${zh(want)}角色：${ofType.length ? ofType.join('、') : '还没有'}。` + (ofType.length ? '' : howTo));
  const pk = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (pk.type !== want) die(`样式 ${cfg.style} 要「${zh(want)}」角色，「${c}」是${zh(pk.type)}角色（走路角色配 C，表情角色配 D）`);
  const frames = pk.frames.map(f => path.resolve(dir, f));
  frames.forEach(f => { if (!fs.existsSync(f)) die('角色图不存在：' + f); });
  ch = { kind: 'pack', type: want, frames: frames.map(asset), facing: pk.facing || 'right', fps: pk.fps, beat: pk.beat };
  if (raw.fps_character) ch.fps = raw.fps_character;
} else if (raw.character && raw.character !== 'none') console.warn(`! 样式 ${cfg.style} 不带角色，character 已忽略（走路角色配 C，表情角色配 D）`);
cfg.character = ch;
cfg.opaque = flag('--green');
cfg.fontUrl = asset(rel(raw.font) || path.join(SKILL, 'assets/fonts/NotoSansSC-VF.ttf'));

// ───────── 无头 Chrome ─────────
let B;
try { B = await openBrowser({ width: cfg.width, height: cfg.height }); } catch (e) { die(e.message); }
const { send, evaluate } = B;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cpb-work-'));   // 检查帧的临时文件
const ff = (a, opts = {}) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit', ...opts });
const guides = `drawbox=x=${cfg.safe.x0}:y=${cfg.safe.y0}:w=${cfg.safe.x1 - cfg.safe.x0}:h=${cfg.safe.y1 - cfg.safe.y0}:color=0x35D0E0@0.95:t=${Math.max(2, Math.round(cfg.width / 360))}`;

let code = 0;
try {
  await B.open('renderer.html', 'setup');
  const info = await evaluate(`setup(${JSON.stringify(cfg)})`);
  const bandH = info.bandH;
  await send('Emulation.setDeviceMetricsOverride', { width: cfg.width, height: bandH, deviceScaleFactor: 1, mobile: false });
  const shot = async t => { await evaluate(`renderAt(${t})`); const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: cfg.width, height: bandH, scale: 1 } }); return Buffer.from(r.data, 'base64'); };

  // ── 安全区检查：每次出片前都做。取每章开头 / 中间 / 结尾，加上角色摆幅最大的几拍 ──
  const segs = raw.segments.map(s => ({ ...s, start: +s.start, end: +s.end }));
  const enter = cfg.enter ?? segs[0].start;
  const times = new Set();
  segs.forEach(s => { [s.start + 0.05, (s.start + s.end) / 2, s.end - 0.05].forEach(t => times.add(Math.max(t, enter + 0.45))); });
  for (let t = enter + 0.45; t < enter + 4.5; t += 1 / 12) times.add(t);
  let U = null;
  for (const t of [...times].filter(t => t <= cfg.duration).sort((a, b) => a - b)) {
    await evaluate(`renderAt(${t})`); const b = await evaluate('bounds()'); if (!b) continue;
    U = U ? { x0: Math.min(U.x0, b.x0), y0: Math.min(U.y0, b.y0), x1: Math.max(U.x1, b.x1), y1: Math.max(U.y1, b.y1) } : b;
  }
  const S = cfg.safe, over = [];
  if (U) {
    if (U.x0 < S.x0 - 1) over.push(`左边超出 ${Math.ceil(S.x0 - U.x0)}px`);
    if (U.x1 > S.x1 + 1) over.push(`右边超出 ${Math.ceil(U.x1 - S.x1)}px`);
    if (U.y0 < S.y0 - 1) over.push(`上边超出 ${Math.ceil(S.y0 - U.y0)}px`);
    if (U.y1 > S.y1 + 1) over.push(`下边超出 ${Math.ceil(U.y1 - S.y1)}px`);
  }
  const zoneName = vertical ? `竖屏 ${plat}` : '通用 90%';
  if (over.length) { code = 3; throw new Error(`进度条超出安全区（${zoneName}）：${over.join('，')}。缩短章节名、减少章节数，或调 offsetY / scale`); }
  console.log(`✓ 安全区（${zoneName}，x ${S.x0}–${S.x1}、y ${S.y0}–${S.y1}）：进度条占 x ${Math.round(U.x0)}–${Math.round(U.x1)}、y ${Math.round(U.y0)}–${Math.round(U.y1)}`);

  const bandPng = async (t, name) => { const f = path.join(prof, name); fs.writeFileSync(f, await shot(t)); return f; };
  const frameOn = (t, band, out, withGuides) => {
    const g = withGuides ? ',' + guides : '';
    const bgImg = flag('--bg') ? path.resolve(after('--bg')) : null;
    if (bgImg) ff(['-i', bgImg, '-i', band, '-filter_complex', `[0:v]scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height}[b];[b][1:v]overlay=0:0${g}`, '-frames:v', '1', out]);
    else if (cfg.video) ff(['-ss', String(t), '-i', cfg.video, '-i', band, '-filter_complex', `[0:v]scale=${cfg.width}:${cfg.height}[b];[b][1:v]overlay=0:0${g}`, '-frames:v', '1', out]);
    else ff(['-f', 'lavfi', '-i', `color=c=0x7A7A7A:s=${cfg.width}x${cfg.height}`, '-i', band, '-filter_complex', `[0:v][1:v]overlay=0:0${g}`, '-frames:v', '1', out]);
  };

  if (flag('--still')) {
    const t = +after('--still'), out = path.resolve(after('--still', 2) || `still_${t}.png`);
    frameOn(t, await bandPng(t, 'b.png'), out, !flag('--no-guides'));
    console.log('检查帧：' + out);
  } else if (flag('--check')) {
    const out = path.resolve(after('--check') || 'check.jpg');
    const ts = [segs[0].start + 0.6, (segs[Math.floor(segs.length / 2)].start + segs[Math.floor(segs.length / 2)].end) / 2, segs.at(-1).end - 0.3].map(t => Math.min(t, cfg.duration - 0.05));
    const fr = [];
    for (const [i, t] of ts.entries()) { const f = path.join(prof, `c${i}.png`); frameOn(t, await bandPng(t, `cb${i}.png`), f, true); fr.push(f); }
    const tw = cfg.width > cfg.height ? 640 : 360;
    ff([...fr.flatMap(f => ['-i', f]), '-filter_complex', `${fr.map((_, i) => `[${i}:v]scale=${tw}:-2[s${i}]`).join(';')};${fr.map((_, i) => `[s${i}]`).join('')}hstack=${fr.length}`, '-q:v', '3', out]);
    console.log(`检查图（${ts.map(t => t.toFixed(1) + 's').join(' / ')}，蓝框是安全区）：${out}`);
  } else {
    const N = Math.round(cfg.duration * cfg.fps);
    let outArgs, out;
    const pipeIn = ['-f', 'image2pipe', '-framerate', String(cfg.fps), '-c:v', 'png', '-i', '-'];
    if (flag('--over')) {
      if (!cfg.video) throw new Error('--over 需要 config.video');
      out = path.resolve(after('--over') || 'with_progress.mp4');
      outArgs = ['-i', cfg.video, ...pipeIn, '-filter_complex', `[0:v]scale=${cfg.width}:${cfg.height}[b];[b][1:v]overlay=0:0:eof_action=pass[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out];
    } else if (flag('--green')) {
      const green = Object.values(cfg.theme).find(c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.replace('#', '').padEnd(6, '0').slice(i - 1, i + 1), 16)); return g > 120 && g > r * 1.4 && g > b * 1.4; });
      if (green) console.warn(`! 配色里有偏绿的颜色 ${green}，绿幕抠像时会一起被抠掉，建议换色或用透明 MOV`);
      out = path.resolve(after('--green') || `progress_${cfg.style}_green.mp4`);
      outArgs = ['-f', 'lavfi', '-i', `color=c=0x00B140:s=${cfg.width}x${cfg.height}:r=${cfg.fps}`, ...pipeIn, '-filter_complex', '[0:v][1:v]overlay=0:0:shortest=1[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
    } else {
      out = raw.out ? rel(raw.out) : cfg.video ? path.join(path.dirname(cfg.video), `progress_${cfg.style}.mov`) : path.resolve(`progress_${cfg.style}.mov`);
      outArgs = [...pipeIn, '-vf', `format=rgba,pad=${cfg.width}:${cfg.height}:0:0:color=0x00000000`, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', out];
    }
    console.log(`出片：${N} 帧，${cfg.width}×${cfg.height}，${cfg.fps}fps → ${out}`);
    const enc = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...outArgs], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, bad) => enc.on('close', c => (c ? bad(new Error('ffmpeg 退出码 ' + c)) : ok())));
    const t0 = Date.now();
    for (let f = 0; f < N; f++) {
      const png = await shot(f / cfg.fps);
      if (!enc.stdin.write(png)) await new Promise(r => enc.stdin.once('drain', r));
      if (f % 150 === 0 || f === N - 1) process.stdout.write(`\r  ${f + 1}/${N} 帧  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    enc.stdin.end(); await done; console.log('\n完成：' + out);
  }
} catch (e) { console.error('✗ ' + e.message); code ||= 1; }
finally { await B.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }
process.exit(code);
