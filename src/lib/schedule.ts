/**
 * 时间计算工具（纯函数，前后端都能用）
 *
 * 核心思路：schedule.json 里只需要写「忙碌」的时段，
 * 「空闲」时段由 buildTimeline() 自动推导出来。
 */

/** 一条忙碌日程 */
export interface BusyEntry {
  /** 日期，格式 YYYY-MM-DD */
  date: string;
  /** 开始时间，格式 HH:MM */
  start: string;
  /** 结束时间，格式 HH:MM */
  end: string;
  /** 活动名称（只有已授权访客能看到） */
  title: string;
}

/** 时间线上的一段（空闲或忙碌） */
export interface Slot {
  start: string;
  end: string;
  busy: boolean;
  /** 仅忙碌时段有，空闲时段为空字符串 */
  title: string;
}

/** 一天的起止范围，默认 08:00 - 23:00 */
export interface DayRange {
  start: string;
  end: string;
}

/** 把 "09:30" 转成从 0 点开始的分钟数 -> 570 */
export function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 把分钟数转回 "09:30" */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 取某一天的所有忙碌日程 */
export function entriesForDate(entries: BusyEntry[], date: string): BusyEntry[] {
  return entries.filter((e) => e.date === date);
}

/** 这一天是否有任何安排 */
export function hasSchedule(entries: BusyEntry[], date: string): boolean {
  return entriesForDate(entries, date).length > 0;
}

/**
 * 计算一天的时间线：忙碌 + 自动补齐的间空闲。
 *
 * 会做三件事：
 * 1. 丢掉超出当天范围的时段（例如 00:30-01:00 会被忽略）
 * 2. 合并真正重叠的时段（首尾相接的不合并，仍然是两行）
 * 3. 用空闲把中间的缝隙和首尾补满
 */
export function buildTimeline(
  entries: BusyEntry[],
  date: string,
  range: DayRange = { start: '08:00', end: '23:00' },
): Slot[] {
  const rangeStart = parseTime(range.start);
  const rangeEnd = parseTime(range.end);

  // 1. 裁剪到当天范围内
  const blocks = entriesForDate(entries, date)
    .map((e) => ({
      start: Math.max(parseTime(e.start), rangeStart),
      end: Math.min(parseTime(e.end), rangeEnd),
      title: e.title,
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  // 2. 合并重叠的时段（09:00-11:00 + 10:00-12:00 -> 09:00-12:00）
  const merged: { start: number; end: number; title: string }[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.start < last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  // 3. 用空闲补满
  const timeline: Slot[] = [];
  let cursor = rangeStart;

  for (const block of merged) {
    if (block.start > cursor) {
      timeline.push({ start: formatTime(cursor), end: formatTime(block.start), busy: false, title: '' });
    }
    timeline.push({ start: formatTime(block.start), end: formatTime(block.end), busy: true, title: block.title });
    cursor = block.end;
  }

  if (cursor < rangeEnd) {
    timeline.push({ start: formatTime(cursor), end: formatTime(rangeEnd), busy: false, title: '' });
  }

  return timeline;
}

/* ---------- 日期辅助函数（全部用本地时间，避免 UTC 偏移） ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> "2026-09-28" */
export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 今天的日期 key */
export function todayKey(): string {
  return formatDateKey(new Date());
}

/** "2026-09-28" -> Date（本地时间当天 0 点） */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 是否合法的 YYYY-MM-DD */
export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return formatDateKey(parseDateKey(key)) === key;
}

/** 前后挪动天数，返回新的日期 key */
export function shiftDateKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

/** 显示用的日期，例如 2026-09-28 周一 */
export function formatDateLabel(key: string): string {
  return `${key} ${weekdayName(key)}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 只要星期，例如 周一 */
export function weekdayName(key: string): string {
  return WEEKDAYS[parseDateKey(key).getDay()]!;
}

/* ---------- 周视图 / 月视图用的辅助函数 ---------- */

/** 该日期所在周的周一（周一为一周的第一天） */
export function startOfWeek(key: string): string {
  const day = parseDateKey(key).getDay(); // 0 = 周日
  return shiftDateKey(key, day === 0 ? -6 : 1 - day);
}

/** 该日期所在周的 7 天（周一 -> 周日） */
export function weekDates(anchor: string): string[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(start, i));
}

/** 月份加减，例如 addMonths('2026-01-31', 1) -> '2026-02-28' */
export function addMonths(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(y!, m! - 1 + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d!, lastDay));
  return formatDateKey(target);
}

/** "2026-09-28" -> "2026-09" */
export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** 月视图的 6×7 网格（周一开始），inMonth 表示是否属于当月 */
export function monthGrid(anchor: string): { date: string; inMonth: boolean }[] {
  const current = monthKey(anchor);
  const start = startOfWeek(`${current}-01`);
  return Array.from({ length: 42 }, (_, i) => {
    const date = shiftDateKey(start, i);
    return { date, inMonth: monthKey(date) === current };
  });
}

/** 导航栏上的标题：周视图显示范围，月视图显示月份 */
export function formatWeekLabel(anchor: string): string {
  const days = weekDates(anchor);
  const from = days[0]!;
  const to = days[6]!;
  return `${from.slice(5)} – ${to.slice(5)}`;
}

/** "2026-09-28" -> "2026年9月" */
export function formatMonthLabel(anchor: string): string {
  const [y, m] = anchor.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 把一组时间线拆成忙碌段和空闲段 */
export function splitSlots(slots: Slot[]): { busy: Slot[]; free: Slot[] } {
  return {
    busy: slots.filter((s) => s.busy),
    free: slots.filter((s) => !s.busy),
  };
}

/** 计算总时长（分钟） */
export function totalMinutes(slots: Slot[]): number {
  return slots.reduce((sum, s) => sum + (parseTime(s.end) - parseTime(s.start)), 0);
}

/** 把分钟数显示成 "5.5 小时" / "45 分钟" */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 分钟';
  const hours = minutes / 60;
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
  return `${minutes} 分钟`;
}
