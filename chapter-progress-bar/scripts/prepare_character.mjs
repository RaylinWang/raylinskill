// 把用户自己的图做成角色（C 的走路角色 / D 的表情角色）：抠透明底、去掉周围的装饰点和线、裁边，
// 存进角色库，出一张预览图。之后配置里写 "character": "名字" 就能用。
//
//   node prepare_character.mjs --type walk --facing right --name 小明走路 左脚在前.png 右脚在前.png
//   node prepare_character.mjs --type face --name 小明表情 坏笑.png 眨眼.png 嘟嘴.png
//   node prepare_character.mjs --list                       列出角色库里已有的角色
//
//   --type      walk（走路帧，配样式 C）或 face（表情，配样式 D）
//   --name      角色名，存到 角色库/<名字>/。角色库默认 ~/Documents/进度条角色，可用环境变量 CPB_CHARACTERS 改
//   --out       不想放进角色库时，直接指定文件夹（配置里就写这个路径）
//   --facing    走路角色原图面朝哪边：left / right（进度条往右走，面朝左会自动镜像）。face 不用填
//   --fps       走路每秒换几张，默认 2
//   --beat      表情每隔几秒甩一次头 + 换表情，默认 1.0
//   --threshold 白底阈值，默认 225（手绘线稿）；真人照片边缘发白时用 235
//   --no-cutout 图已经是干净的透明底 PNG，原样复制
//   --replace   同名角色已存在时替换（旧的留作备份：macOS 挪进废纸篓，其他系统改名成隐藏文件夹）
//
//   --engine    抠图方式：macos（系统自带 swift）或 chrome（无头 Chrome）。不填按设备选：macOS 用 macos，其他用 chrome
//
// 图的顺序就是播放顺序。Chrome 方式能打开 PNG、JPG、WebP、GIF、BMP、AVIF；macOS 方式还能打开 HEIC。
// 背景不是白色的照片，先用任意抠图工具（手机相册抠图、remove.bg、Photoshop、macOS 访达「移除背景」等）抠成透明 PNG。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowser, fileUrl } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = process.env.CPB_CHARACTERS || path.join(os.homedir(), 'Documents/进度条角色');
const argv = process.argv.slice(2);
const opt = {}, files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--no-cutout', '--replace', '--list'].includes(a)) opt[a.slice(2)] = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else files.push(path.resolve(a));
}
const die = m => { console.error('✗ ' + m); process.exit(2); };

if (opt.list) {
  const show = (title, d) => {
    const names = fs.existsSync(d) ? fs.readdirSync(d).filter(n => !n.startsWith('.') && fs.existsSync(path.join(d, n, '角色.json'))) : [];
    console.log(`${title}（${d}）：${names.length ? '' : '还没有'}`);
    for (const n of names) { const p = JSON.parse(fs.readFileSync(path.join(d, n, '角色.json'), 'utf8')); console.log(`  ${n}  ${p.type === 'walk' ? `走路（配 C），${p.frames.length} 张，每秒 ${p.fps} 张，原图面朝${p.facing === 'left' ? '左' : '右'}` : `表情（配 D），${p.frames.length} 张，每 ${p.beat} 秒换一个`}`); }
  };
  show('你的角色库', LIB);
  console.log('C 要至少一个走路角色、D 要至少一个表情角色才能出片。没有现成的图，把 prompts/形象生成提示词.md 里对应的那段提示词和你的正面照一起发给 AI 生图工具生成');
  process.exit(0);
}

if (!['walk', 'face'].includes(opt.type)) die('--type 要填 walk（走路，配样式 C）或 face（表情，配样式 D）');
if (!opt.name && !opt.out) die('--name 给角色起个名字（存进角色库），或用 --out 指定文件夹');
if (opt.name && /[\/\\]/.test(opt.name)) die('--name 里不能有斜杠');
if (!files.length) die('至少给一张图');
if (opt.type === 'walk' && !['left', 'right'].includes(opt.facing)) die('走路角色要说明原图面朝哪边：--facing left 或 --facing right');
files.forEach(f => { if (!fs.existsSync(f)) die('找不到图：' + f); });
if (opt.type === 'walk' && files.length === 1) console.warn('! 走路只有 1 张图，会原地一颠一颠地走；2 张迈步图（左脚在前、右脚在前）就够');
if (files.length > 12) console.warn(`! ${files.length} 张有点多，走路 2 张、表情 2–5 张就够`);

const out = path.resolve(opt.out || path.join(LIB, opt.name)), sub = opt.type === 'walk' ? 'walk' : 'faces';
if (fs.existsSync(out) && fs.readdirSync(out).length) {
  if (!opt.replace) die(`「${out}」已经有东西了。换个名字，或加 --replace 替换（旧的会留作备份）`);
  const old = `${path.basename(out)}_旧_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const trash = path.join(os.homedir(), '.Trash');
  let moved = false;
  if (process.platform === 'darwin' && fs.existsSync(trash)) { try { fs.renameSync(out, path.join(trash, old)); console.log('旧角色已挪进废纸篓：' + path.join(trash, old)); moved = true; } catch {} }
  if (!moved) { const keep = path.join(path.dirname(out), '.' + old); fs.renameSync(out, keep); console.log('旧角色已改名留作备份（隐藏文件夹，确认不要了可以自己删）：' + keep); }
}
fs.mkdirSync(path.join(out, sub), { recursive: true });

// 抠图方式按设备选：macOS 用系统自带的 swift（cutout.swift，不用开 Chrome，沙盒里也能跑）；
// Windows / Linux 用无头 Chrome（cutout.html）。两种算法一样。--engine macos|chrome 可以手动指定。
// macOS 上编译不了 swift（没装 Xcode 命令行工具）时，自动改用 Chrome。
const thr = +(opt.threshold || 225);
let engine = opt['no-cutout'] ? 'none' : (opt.engine || (process.platform === 'darwin' ? 'macos' : 'chrome'));
if (!['macos', 'chrome', 'none'].includes(engine)) die('--engine 只能是 macos 或 chrome');
let bin, B;
if (engine === 'macos') {
  if (process.platform !== 'darwin') die('--engine macos 只能在 macOS 上用，这台设备用 --engine chrome');
  const src = path.join(HERE, 'cutout.swift');
  bin = path.join(os.tmpdir(), `cpb-cutout-${fs.statSync(src).mtimeMs | 0}`);
  if (!fs.existsSync(bin)) {
    console.log('编译 macOS 抠图工具（第一次要十几秒）…');
    try { execFileSync('swiftc', ['-O', src, '-o', bin, '-module-cache-path', path.join(os.tmpdir(), 'cpb-swift-cache')], { stdio: ['ignore', 'ignore', 'ignore'] }); }
    catch { console.warn('! 这台 Mac 编译不了 swift（要 Xcode 命令行工具：xcode-select --install），这次改用 Chrome 抠图'); engine = 'chrome'; bin = null; }
  }
}
if (engine === 'chrome') {
  try { B = await openBrowser(); await B.open('cutout.html', 'cutout'); }
  catch (e) { die(e.message + '。也可以先自己抠成透明 PNG，加 --no-cutout'); }
}
if (engine !== 'none') console.log(`抠图方式：${engine === 'macos' ? 'macOS 自带（swift）' : 'Chrome'}`);
const pngSize = f => { const b = fs.readFileSync(f); if (b.toString('ascii', 1, 4) !== 'PNG') return null; return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const frames = [], sizes = [];
try {
  for (const [i, f] of files.entries()) {
    const name = `${sub}/${String(i + 1).padStart(2, '0')}.png`, dst = path.join(out, name);
    if (engine === 'none') { if (path.extname(f).toLowerCase() !== '.png') throw new Error('--no-cutout 只收透明底 PNG：' + f); fs.copyFileSync(f, dst); }
    else if (engine === 'macos') {
      try { execFileSync(bin, [f, dst, String(thr)], { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch { throw new Error(`${path.basename(f)} 抠图失败（macOS 打不开这张图？可以加 --engine chrome 再试）`); }
    } else {
      let r;
      try { r = await B.evaluate(`cutout(${JSON.stringify(fileUrl(f))}, ${thr})`); }
      catch (e) { throw new Error(`${path.basename(f)} 抠图失败：${e.message.split('\n')[0]}`); }
      fs.writeFileSync(dst, Buffer.from(r.png, 'base64'));
    }
    const s = pngSize(dst); sizes.push(s); frames.push(name);
    console.log(`  ${path.basename(f)} → ${name}  ${s[0]}×${s[1]}`);
  }
} catch (e) { await B?.close(); die(e.message); }
await B?.close();

// 检查：图太小会糊；走路帧高矮差太多会一跳一跳
const minH = Math.min(...sizes.map(s => s[1])), maxH = Math.max(...sizes.map(s => s[1]));
if (minH < 260) console.warn(`! 有的图抠完只有 ${minH}px 高，放到进度条上会糊，最好 400px 以上`);
if (opt.type === 'walk' && maxH / minH > 1.25) console.warn('! 几张走路图抠完高矮差得多（可能是姿势不同或周围有东西没抠掉），走起来会一跳一跳，看一下预览图');
const ratios = sizes.map(s => s[0] / s[1]);
if (Math.max(...ratios) / Math.min(...ratios) > 1.8) console.warn('! 有一张图宽高比和其他差很多，可能抠图时多留了东西，看一下预览图');

const pack = { name: opt.name || path.basename(out), type: opt.type, frames };
if (opt.type === 'walk') { pack.facing = opt.facing; pack.fps = +(opt.fps || 2); }
else pack.beat = +(opt.beat || 1.0);
fs.writeFileSync(path.join(out, '角色.json'), JSON.stringify(pack, null, 2) + '\n');

// 预览图：每张缩到同一高度，放在灰底上，透明的地方能看清有没有抠干净
const H = 360, pad = 24, ws = sizes.map(s => Math.round(s[0] * H / s[1]));
const W = ws.reduce((a, b) => a + b + pad, pad), preview = path.join(out, '预览.jpg');
let fc = `color=c=0x8E8E8E:s=${W}x${H + pad * 2}[bg]`, last = 'bg', x = pad;
frames.forEach((f, i) => { fc += `;[${i}:v]scale=-1:${H}[f${i}];[${last}][f${i}]overlay=${x}:${pad}${i === frames.length - 1 ? '' : `[o${i}]`}`; last = `o${i}`; x += ws[i] + pad; });
try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...frames.flatMap(f => ['-i', path.join(out, f)]), '-filter_complex', fc, '-frames:v', '1', '-q:v', '3', preview]); }
catch { console.warn('! 预览图没生成（需要 ffmpeg）'); }

const ref = opt.out ? out : opt.name;
console.log(`\n✓ 角色「${pack.name}」做好了：${out}\n  预览图：${preview}（先看抠得干不干净）\n  用法：样式 ${opt.type === 'walk' ? 'C' : 'D'} 的配置里写 "character": "${ref}"`);
