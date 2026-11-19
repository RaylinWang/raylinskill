#!/usr/bin/env node
// 只有字幕、没有视频时用：读 SRT / VTT / TXT 字幕，算出视频时长，找出章节，写一份配置草稿。
//
//   node subtitles.mjs 字幕.srt                          看字幕时长、章节候选和建议分段
//   node subtitles.mjs 字幕.srt --dump                    同时列出每句台词和时间（没有章节标题时，Agent 读这个自己分章）
//   node subtitles.mjs 字幕.srt --out 配置.json --style B --aspect 9:16    写配置草稿
//   node subtitles.mjs 文稿.txt --duration 4:24           纯文字稿（没有时间）必须给视频时长，按字数估时间
//
// 支持：SRT、VTT、带时间的 TXT（每行开头是 [00:12]、00:00:12、00:12.5 这类时间，或者整份就是 SRT 格式），
// 以及不带时间的纯文字稿。只用 node，沙盒里也能跑。
import fs from 'node:fs';
import path from 'node:path';

const die = m => { console.error('✗ ' + m); process.exit(1); };
const args = process.argv.slice(2);
const opt = {}; const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dump') opt.dump = true;
  else if (['--out', '--duration', '--style', '--aspect'].includes(a)) opt[a.slice(2)] = args[++i];
  else if (a.startsWith('--')) die('不认识的参数 ' + a);
  else files.push(a);
}
if (files.length !== 1) die('用法：node subtitles.mjs 字幕.srt|.vtt|.txt [--dump] [--duration 分:秒] [--out 配置.json] [--style A|B|C|D] [--aspect 9:16]');
const file = files[0].replace(/^~(?=\/|$)/, process.env.HOME);
if (!fs.existsSync(file)) die('找不到字幕文件：' + file);
let text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// 时间："01:02:03,456" "02:03.4" "2:03" "123.5"
function parseTime(s) {
  s = String(s).trim().replace(',', '.');
  const p = s.split(':').map(Number);
  if (p.some(isNaN) || !p.length || p.length > 3) return NaN;
  return p.reduce((acc, v) => acc * 60 + v, 0);
}
const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const clean = s => s.replace(/\{[^}]*\}|<[^>]*>/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s+/g, ' ').trim();

// 1. 解析成 cue：{ start, end, text }
let cues = [], estimated = false;
const TS = /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/;
const ARROW = new RegExp(`(${TS.source})\\s*-->\\s*(${TS.source})`);
if (ARROW.test(text)) {
  // SRT / VTT：按空行分块，每块里找 "a --> b"，后面的行是文字
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const k = lines.findIndex(l => ARROW.test(l));
    if (k < 0) continue;
    const m = lines[k].match(ARROW);
    const start = parseTime(m[1]), end = parseTime(m[3]);
    const t = clean(lines.slice(k + 1).join(' '));
    if (!isNaN(start) && !isNaN(end) && end > start && t) cues.push({ start, end, text: t });
  }
} else {
  // 带时间的 TXT：每行开头一个时间
  const LINE = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*[-–—:：|]?\s*(.*)$/;
  const rows = text.split('\n').map(l => l.match(LINE)).filter(Boolean).map(m => ({ start: parseTime(m[1]), text: clean(m[2]) })).filter(r => !isNaN(r.start));
  if (rows.length >= 3) {
    rows.sort((a, b) => a.start - b.start);
    const last = opt.duration ? parseTime(opt.duration) : rows[rows.length - 1].start + 3;
    rows.forEach((r, i) => { const end = i + 1 < rows.length ? rows[i + 1].start : last; if (r.text && end > r.start) cues.push({ start: r.start, end, text: r.text }); });
  } else {
    // 纯文字稿：没有时间，按字数平均分配到给定时长上
    if (!opt.duration) die('这份文字稿里没有时间，算不出每章在哪。请用户给出视频时长，加 --duration 4:24 重跑；或者请用户导出带时间的 SRT 字幕（剪映：导出 → 字幕 → SRT）');
    const total = parseTime(opt.duration); if (!(total > 0)) die('--duration 写成 分:秒，比如 4:24');
    const lines = text.split('\n').map(clean).filter(Boolean);
    const w = lines.map(l => [...l.replace(/[\s，。！？、,.!?：:；;“”"']/g, '')].length || 1);
    const sum = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    lines.forEach((l, i) => { const s = acc / sum * total; acc += w[i]; cues.push({ start: s, end: acc / sum * total, text: l }); });
    estimated = true;
  }
}
if (!cues.length) die('没有从这个文件里读到字幕');
cues.sort((a, b) => a.start - b.start || b.end - a.end);

// 2. 视频时长：字幕最后结束的时间（--duration 可以改）
const subEnd = Math.max(...cues.map(c => c.end));
let duration = opt.duration ? parseTime(opt.duration) : subEnd;
if (!(duration > 0)) die('--duration 写成 分:秒，比如 4:24');
if (duration < subEnd - 0.05) console.log(`! --duration ${fmt(duration)} 比字幕结束时间 ${fmt(subEnd)} 还短，超出部分的字幕会被忽略`);
duration = Math.round(duration * 1000) / 1000;

// 3. 找章节标题：
//    a) 编号开头的行（「一.」「1、」「第二章」「Part 3」等），或
//    b) 很长的叠加字幕：持续 ≥ 15 秒，期间盖住了 ≥ 3 条别的字幕（剪映里给每章挂的标题条常是这样）
const NUM = /^(第\s*[一二三四五六七八九十百\d]+\s*(?:部分|章|节|步|个|点|部)|[一二三四五六七八九十]+\s*[、.．:：]|\d{1,2}\s*[、.．:：)）]|Part\s*\d+|PART\s*\d+|Chapter\s*\d+)\s*/;
const inside = c => cues.filter(o => o !== c && o.start >= c.start - 0.05 && o.start < c.end).length;
const long = c => c.end - c.start;
let heads = cues.filter(c => (NUM.test(c.text) && (estimated || [...c.text].length <= 20 || long(c) >= 3 || inside(c) >= 1)) || (long(c) >= 15 && inside(c) >= 3));
// 同一时间段只留一个
heads = heads.filter((h, i) => !heads.some((o, j) => j < i && Math.abs(o.start - h.start) < 2));
const overlay = new Set(heads);
const isBar = h => long(h) >= 15 && inside(h) >= 3;  // 挂在画面上的章节标题条：结束时间就是这章的结束
// 普通字幕里也会挂一些长时间的叠加小标签（如「收集信息」），列台词时去掉盖住别人 ≥2 条的
const body = cues.filter(c => !overlay.has(c) && !(long(c) >= 3 && inside(c) >= 2));

const label = h => h.text.replace(NUM, '').replace(/[“”"'「」]/g, '').trim();
console.log(`字幕：${path.basename(file)}，${cues.length} 条${estimated ? '（纯文字稿，时间按字数估算，只是大概）' : ''}`);
console.log(`视频时长：${fmt(duration)}（${opt.duration ? '用 --duration 给的' : '按最后一条字幕结束的时间；实际视频更长就加 --duration 重跑'}）`);

// 4. 建议分段：章节标题之间连起来；第一章前面的开场 ≥ 3 秒就单列「开场」，最后一章后面 ≥ 5 秒就单列「总结」
let segs = [];
if (heads.length) {
  heads.sort((a, b) => a.start - b.start);
  console.log(`\n找到 ${heads.length} 个章节标题：`);
  heads.forEach((h, i) => console.log(`  ${i + 1}. ${fmt(h.start)}–${fmt(h.end)}  ${h.text}`));
  if (heads[0].start >= 3) segs.push({ label: '开场', start: 0, end: heads[0].start });
  heads.forEach((h, i) => {
    const start = segs.length ? segs[segs.length - 1].end : 0;
    const nextStart = i + 1 < heads.length ? heads[i + 1].start : null;
    // 最后一章：标题条有自己的结束时间就用它；普通的标题行一直到片尾
    let end = nextStart ?? (isBar(h) ? Math.min(h.end, duration) : duration);
    if (nextStart == null && duration - end < 5) end = duration;
    segs.push({ label: label(h), start: i === 0 && segs.length === 0 ? 0 : start, end });
  });
  const lastEnd = segs[segs.length - 1].end;
  if (duration - lastEnd >= 5) segs.push({ label: '总结', start: lastEnd, end: duration });
  else segs[segs.length - 1].end = duration;
  segs.forEach(s => { s.start = Math.round(s.start * 1000) / 1000; s.end = Math.round(s.end * 1000) / 1000; });
  console.log('\n建议分段（章节名要改短，2–6 个字最好；时间可以按台词微调）：');
  segs.forEach(s => console.log(`  ${fmt(s.start)}–${fmt(s.end)}  ${s.label}${[...s.label].length > 6 ? '   ← 太长，要改短' : ''}`));
} else {
  console.log('\n字幕里没有章节标题。用 --dump 列出台词，按内容自己分章，再把分段写进配置。');
}

if (opt.dump || !heads.length) {
  console.log('\n台词：');
  body.forEach(c => console.log(`  ${fmt(c.start)}  ${c.text}`));
}

if (opt.out) {
  const cfg = {};
  if (opt.style) cfg.style = opt.style.toUpperCase();
  if (opt.aspect) cfg.aspect = opt.aspect;
  cfg.duration = duration;
  cfg.segments = segs.length ? segs : [{ label: '待填', start: 0, end: duration }];
  const out = opt.out.replace(/^~(?=\/|$)/, process.env.HOME);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
  console.log('\n配置草稿已存：' + path.resolve(out));
  const miss = [!cfg.style && 'style', !cfg.aspect && 'aspect（没有视频，必须让用户选画幅）', !segs.length && 'segments'].filter(Boolean);
  if (miss.length) console.log('还要补：' + miss.join('、'));
}
