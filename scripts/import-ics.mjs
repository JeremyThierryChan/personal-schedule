#!/usr/bin/env node
/**
 * 把「日历」文件夹里的 .ics（Apple 日历导出）转换成 src/data/schedule.json
 *
 * 用法：
 *   npm run import-ics        （或者 node scripts/import-ics.mjs）
 *
 * 说明：
 * - 「日历」文件夹已经加进 .gitignore，不会 push；但生成出来的
 *   src/data/schedule.json 是要提交的，这样 GitHub Actions 才拿得到数据。
 * - 时区固定按 Asia/Shanghai (+08:00) 处理。
 * - 支持重复规则 RRULE 的 FREQ=DAILY / WEEKLY（含 INTERVAL、COUNT、UNTIL、BYDAY），
 *   以及 EXDATE 排除日期。MONTHLY / YEARLY 不支持，只会保留第一次，并给出警告。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CALENDAR_DIR = join(ROOT, '日历');
const OUT_FILE = join(ROOT, 'src/data/schedule.json');

/** 固定按东八区处理 */
const TZ_OFFSET_MINUTES = 8 * 60;
/** 无限重复的事件最多展开多少个实例 */
const MAX_OCCURRENCES = 400;
/** 无限重复的事件最多展开多少天 */
const HORIZON_DAYS = 365;
/** 默认的一天范围，超出范围的安排会在报告里标出来 */
const DEFAULT_RANGE = { start: '08:00', end: '23:00' };

const DAY_MINUTES = 24 * 60;
const pad = (n) => String(n).padStart(2, '0');

/* ---------------- iCalendar 解析 ---------------- */

/** RFC5545 折行：以空格或 Tab 开头的行是上一行的延续 */
function unfold(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** 拆成 { name, params, value }，冒号要跳过参数里的引号 */
function parseProperty(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const [name, ...rest] = line.slice(0, colon).split(';');
  const params = {};
  for (const item of rest) {
    const eq = item.indexOf('=');
    if (eq > -1) params[item.slice(0, eq).toUpperCase()] = item.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** TEXT 值里的转义：\, \; \n \\ */
function unescapeText(value = '') {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * 日期时间 -> 绝对分钟数（以 UTC 数学运算模拟东八区，避免受本机时区影响）
 * 支持 20260905T130000 / 20260905T130000Z / 20260905
 */
function parseDateTime(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec((value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d)) / 60000;
  if (h === undefined) return { abs: base, dateOnly: true };
  let minutes = Number(h) * 60 + Number(mi);
  if (z === 'Z') minutes += TZ_OFFSET_MINUTES; // UTC -> +08:00
  return { abs: base + minutes, dateOnly: false };
}

/** 绝对分钟数 -> { date: 'YYYY-MM-DD', time: 'HH:MM' } */
function absToDateTime(abs) {
  const dt = new Date(abs * 60000);
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
  };
}

function parseRRule(value) {
  const rule = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > -1) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return rule;
}

/** 读一个 .ics，返回事件数组 */
function readIcs(file) {
  const lines = unfold(readFileSync(file, 'utf8'));
  const calendarName = (() => {
    const line = lines.find((l) => l.startsWith('X-WR-CALNAME'));
    const prop = line ? parseProperty(line) : null;
    return prop ? unescapeText(prop.value) : '';
  })();

  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { exdates: [], calendarName };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = parseProperty(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'DTSTART':
        current.start = parseDateTime(prop.value, prop.params);
        break;
      case 'DTEND':
        current.end = parseDateTime(prop.value, prop.params);
        break;
      case 'SUMMARY':
        current.title = unescapeText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value);
        break;
      case 'RRULE':
        current.rrule = parseRRule(prop.value);
        break;
      case 'EXDATE':
        // 可能用逗号分隔多个日期
        for (const v of prop.value.split(',')) {
          const dt = parseDateTime(v, prop.params);
          if (dt) current.exdates.push(dt.abs);
        }
        break;
      default:
        break;
    }
  }
  return { calendarName, events };
}

/* ---------------- 重复规则展开 ---------------- */

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function expandEvent(event, warnings) {
  const { start, end } = event;
  if (!start || !end) return [];

  const duration = end.abs - start.abs;
  if (duration <= 0) return [];

  const rrule = event.rrule;
  const title = event.title || '(无标题)';
  const excluded = new Set(event.exdates);

  const make = (abs) => {
    if (excluded.has(abs)) return null;
    const from = absToDateTime(abs);
    const to = absToDateTime(abs + duration);
    return { date: from.date, start: from.time, end: to.time, title };
  };

  // 没有重复规则：就一条
  if (!rrule) {
    const one = make(start.abs);
    return one ? [one] : [];
  }

  const freq = (rrule.FREQ || '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    warnings.push(`「${title}」的重复规则 FREQ=${freq || '?'} 暂不支持，只保留了第一次（${absToDateTime(start.abs).date}）`);
    const one = make(start.abs);
    return one ? [one] : [];
  }

  const interval = Math.max(1, Number(rrule.INTERVAL || 1));
  const count = rrule.COUNT ? Number(rrule.COUNT) : null;
  const until = rrule.UNTIL ? parseDateTime(rrule.UNTIL)?.abs ?? null : null;
  const horizonEnd = start.abs + HORIZON_DAYS * DAY_MINUTES;
  const limit = count ?? MAX_OCCURRENCES;
  const timeOfDay = ((start.abs % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

  // 先算出所有「候选起点」
  const candidates = [];
  if (freq === 'DAILY') {
    for (let i = 0; i < limit; i++) {
      const abs = start.abs + i * interval * DAY_MINUTES;
      if (until !== null && abs > until) break;
      if (count === null && abs > horizonEnd) break;
      candidates.push(abs);
    }
  } else {
    // WEEKLY
    const byday = rrule.BYDAY
      ? rrule.BYDAY.split(',').map((d) => d.trim().toUpperCase().slice(-2)).filter((d) => DAY_NAMES.includes(d))
      : null;

    if (byday && byday.length) {
      const startDow = new Date(start.abs * 60000).getUTCDay();
      const weekStartAbs = start.abs - startDow * DAY_MINUTES - timeOfDay; // 该周周日 00:00
      for (let w = 0; candidates.length < limit; w++) {
        const base = weekStartAbs + w * interval * 7 * DAY_MINUTES;
        if (count === null && base > horizonEnd) break;
        if (until !== null && base - 7 * DAY_MINUTES > until) break;
        for (const code of byday) {
          const abs = base + DAY_NAMES.indexOf(code) * DAY_MINUTES + timeOfDay;
          if (abs < start.abs) continue; // 不早于 DTSTART
          if (until !== null && abs > until) continue;
          candidates.push(abs);
        }
      }
    } else {
      for (let i = 0; candidates.length < limit; i++) {
        const abs = start.abs + i * interval * 7 * DAY_MINUTES;
        if (until !== null && abs > until) break;
        if (count === null && abs > horizonEnd) break;
        candidates.push(abs);
      }
    }
  }

  // 没有结束条件的事件要提醒一下（不然用户会以为只有这几条）
  if (count === null && until === null && candidates.length > 0) {
    const lastDate = absToDateTime(candidates[candidates.length - 1]).date;
    warnings.push(`「${title}」没有结束日期（无限重复），只展开到 ${lastDate}（上限 ${HORIZON_DAYS} 天 / ${MAX_OCCURRENCES} 次）`);
  }

  return candidates.map(make).filter(Boolean);
}

/* ---------------- 主流程 ---------------- */

function main() {
  if (!existsSync(CALENDAR_DIR)) {
    console.error(`✗ 找不到「日历」文件夹：${CALENDAR_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(CALENDAR_DIR).filter((f) => f.toLowerCase().endsWith('.ics'));
  if (!files.length) {
    console.error(`✗ 「日历」文件夹里没有 .ics 文件`);
    process.exit(1);
  }

  const warnings = [];
  const parsed = files.map((f) => ({ file: f, ...readIcs(join(CALENDAR_DIR, f)) }));
  const multiCalendar = parsed.length > 1;

  const entries = [];
  for (const cal of parsed) {
    for (const event of cal.events) {
      for (const item of expandEvent(event, warnings)) {
        const entry = { date: item.date, start: item.start, end: item.end, title: item.title };
        // 只有多个日历时才写 type，免得单个日历每一条都重复同一个名字
        if (multiCalendar && cal.calendarName) entry.type = cal.calendarName;
        if (event.location) entry.location = event.location;
        if (event.description) entry.details = event.description;
        entries.push(entry);
      }
    }
  }

  // 排序 + 去重
  entries.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.title.localeCompare(b.title));
  const seen = new Set();
  const unique = entries.filter((e) => {
    const key = `${e.date}|${e.start}|${e.end}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');

  // ---- 报告 ----
  const dates = [...new Set(unique.map((e) => e.date))].sort();
  console.log(`✓ 读取 ${files.length} 个 .ics：${files.join('、')}`);
  console.log(`✓ 原始事件 ${parsed.reduce((n, c) => n + c.events.length, 0)} 条 → 展开后 ${entries.length} 条 → 去重后 ${unique.length} 条`);
  console.log(`✓ 覆盖日期：${dates[0]} → ${dates[dates.length - 1]}（共 ${dates.length} 天有安排）`);
  console.log(`✓ 已写入 ${OUT_FILE.replace(ROOT + '/', '')}`);

  const outside = unique.filter(
    (e) => e.start < DEFAULT_RANGE.start || (e.end > DEFAULT_RANGE.end && e.end !== '00:00'),
  );
  if (outside.length) {
    console.log(`\n⚠️  有 ${outside.length} 条不在默认范围 ${DEFAULT_RANGE.start}–${DEFAULT_RANGE.end} 内，时间轴会自动扩展以容纳它们：`);
    for (const e of outside.slice(0, 10)) console.log(`     ${e.date} ${e.start}–${e.end}  ${e.title}`);
    if (outside.length > 10) console.log(`     …还有 ${outside.length - 10} 条`);
  }
  if (warnings.length) {
    console.log(`\n⚠️  提示：`);
    for (const w of [...new Set(warnings)]) console.log(`     ${w}`);
  }
}

main();
