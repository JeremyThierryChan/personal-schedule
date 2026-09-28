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
  /** 事务类型，例如「学习」「会议」（可选，周视图的摘要用） */
  type?: string;
  /** 地址 / 地点，例如「线上 Zoom」（可选，周视图的摘要用） */
  location?: string;
  /** 具体做什么（可选，只在日视图里显示） */
  details?: string;
}

/** 时间线上的一段：忙碌（有安排） / 休息（个人时间，不算空闲） / 空闲（可以约） */
export type SlotKind = 'busy' | 'rest' | 'free';

export interface Slot {
  start: string;
  end: string;
  kind: SlotKind;
  /** 仅忙碌时段有，其他为空字符串 */
  title: string;
}

/** 一天的起止范围，默认 00:00 - 23:59 */
export interface DayRange {
  start: string;
  end: string;
}

/** 每天的休息时段，例如 22:00 → 次日 08:00（start > end 表示跨午夜） */
export interface RestWindow {
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

/** 分钟区间 */
interface Interval {
  start: number;
  end: number;
}

/** 合并重叠/相接的区间（输入不必有序） */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

/** 从一组区间里挖掉另一组，返回剩下的部分 */
function subtractIntervals(base: Interval[], holes: Interval[]): Interval[] {
  let result = base.map((i) => ({ ...i }));
  for (const hole of mergeIntervals(holes)) {
    const next: Interval[] = [];
    for (const item of result) {
      if (hole.end <= item.start || hole.start >= item.end) {
        next.push(item); // 不相交，原样保留
        continue;
      }
      if (hole.start > item.start) next.push({ start: item.start, end: hole.start });
      if (hole.end < item.end) next.push({ start: hole.end, end: item.end });
    }
    result = next;
  }
  return result.filter((i) => i.end > i.start);
}

/**
 * 休息时段在「一天」里对应哪几段。
 * 因为时间轴是一整天（00:00–23:59），22:00→次日 08:00 会被拆成
 * [00:00–08:00] 和 [22:00–24:00] 两段。
 */
export function restWindows(range: DayRange, rest: RestWindow): Interval[] {
  const start = parseTime(rest.start);
  const end = parseTime(rest.end);
  if (start === end) return []; // 起止相同 = 没有休息时段

  const rangeStart = parseTime(range.start);
  const rangeEnd = parseTime(range.end);
  const raw: Interval[] =
    start < end
      ? [{ start, end }] // 不跨午夜，例如 12:00–13:00
      : [
          { start, end: 24 * 60 }, // 22:00 → 午夜
          { start: 0, end }, // 午夜 → 08:00
        ];

  return raw
    .map((w) => ({ start: Math.max(w.start, rangeStart), end: Math.min(w.end, rangeEnd) }))
    .filter((w) => w.end > w.start);
}

/** 当天所有忙碌日程（已裁剪到范围、已合并真正重叠的部分） */
function busyIntervals(
  entries: BusyEntry[],
  date: string,
  range: DayRange,
): { start: number; end: number; title: string }[] {
  const rangeStart = parseTime(range.start);
  const rangeEnd = parseTime(range.end);

  const blocks = entriesForDate(entries, date)
    .map((e) => ({
      start: Math.max(parseTime(e.start), rangeStart),
      end: Math.min(parseTime(e.end), rangeEnd),
      title: e.title,
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  // 合并真正重叠的（首尾相接的仍然是两条）
  const merged: { start: number; end: number; title: string }[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.start < last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

/**
 * 计算一天的时间线，分成三类：忙碌 / 休息 / 空闲。
 *
 * - **忙碌**：schedule.json 里的安排（已经合并重叠的部分）
 * - **休息**：每天固定的个人时间（例如 22:00–次日 08:00），**不算空闲**
 * - **空闲**：剩下的部分，也就是真正可以约的时间
 *
 * 安排和休息重叠时以安排为准（例如上课上到 23:00，那 22:00–23:00 算忙碌）。
 */
export function buildTimeline(
  entries: BusyEntry[],
  date: string,
  range: DayRange = { start: '00:00', end: '24:00' },
  rest?: RestWindow,
): Slot[] {
  const rangeStart = parseTime(range.start);
  const rangeEnd = parseTime(range.end);
  const busy = busyIntervals(entries, date, range);
  const busySpans = busy.map((b) => ({ start: b.start, end: b.end }));

  // 休息时段要挖掉当天的安排
  const restBlocks = rest ? subtractIntervals(restWindows(range, rest), busySpans) : [];

  // 空闲 = 一整天 − 安排 − 休息
  const free = subtractIntervals([{ start: rangeStart, end: rangeEnd }], [...busySpans, ...restBlocks]);

  // 先按分钟数排好，最后再格式化成 "HH:MM"
  const timeline: { start: number; end: number; kind: SlotKind; title: string }[] = [
    ...busy.map((b) => ({ start: b.start, end: b.end, kind: 'busy' as const, title: b.title })),
    ...restBlocks.map((b) => ({ start: b.start, end: b.end, kind: 'rest' as const, title: '' })),
    ...free.map((b) => ({ start: b.start, end: b.end, kind: 'free' as const, title: '' })),
  ];

  timeline.sort((a, b) => a.start - b.start);
  return timeline.map((slot) => ({
    ...slot,
    start: formatTime(slot.start),
    end: formatTime(slot.end),
  }));
}

/* ---------- 日期辅助函数（全部用本地时间，避免 UTC 偏移） ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> "2026-09-28" */
export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 今天的日期 key（按访客本机时区） */
export function todayKey(): string {
  return formatDateKey(new Date());
}

/*
 * 日程数据是按「北京时间」存的（Apple 日历导出的 TZID=Asia/Shanghai）。
 * 所以「今天」和「现在红线」都必须按北京时间算，
 * 否则国外访客会看到红线画错位置、甚至算成另一天。
 * 中国自 1991 年后没有夏令时，固定 UTC+8，用 UTC getter 读偏移后的时间即可，不需要任何库。
 */
const BEIJING_OFFSET_MINUTES = 8 * 60;

/** 把时间戳挪到北京时区，之后用 getUTC* 读出来的就是北京时间 */
function toBeijing(now: Date): Date {
  return new Date(now.getTime() + BEIJING_OFFSET_MINUTES * 60_000);
}

/** 北京时间的今天，例如 "2026-09-28" */
export function beijingTodayKey(now: Date = new Date()): string {
  const d = toBeijing(now);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 北京时间现在是几点（从 0 点算起的分钟数），例如 18:30 -> 1110 */
export function beijingMinutesOfDay(now: Date = new Date()): number {
  const d = toBeijing(now);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
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

/** 把一组时间线拆成忙碌段 / 休息段 / 空闲段 */
export function splitSlots(slots: Slot[]): { busy: Slot[]; rest: Slot[]; free: Slot[] } {
  return {
    busy: slots.filter((s) => s.kind === 'busy'),
    rest: slots.filter((s) => s.kind === 'rest'),
    free: slots.filter((s) => s.kind === 'free'),
  };
}

/** 计算总时长（分钟） */
export function totalMinutes(slots: Slot[]): number {
  return slots.reduce((sum, s) => sum + (parseTime(s.end) - parseTime(s.start)), 0);
}

/** 把分钟数拆成小时 + 分钟：95 -> { hours: 1, minutes: 35 } */
function splitHM(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * 把分钟数显示成 "1小时30分钟" / "14小时" / "45分钟"。
 * 整点时不写多余的 "0分钟"，因为大部分时段都是整小时的。
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0分钟';
  const { hours, minutes: mins } = splitHM(minutes);
  return [hours ? `${hours}小时` : '', mins ? `${mins}分钟` : ''].join('');
}

/** 紧凑写法，给月视图那种很窄的格子用："1时30分" / "14时" / "45分" */
export function formatDurationShort(minutes: number): string {
  if (minutes <= 0) return '0分';
  const { hours, minutes: mins } = splitHM(minutes);
  return [hours ? `${hours}时` : '', mins ? `${mins}分` : ''].join('');
}

/**
 * 算出时间轴范围。默认就是完整的一天：00:00 – 24:00。
 *
 * 内部用 24:00（=1440 分钟，整整 1440 分钟）而不是 23:59，
 * 这样每个时段的时长都是精确的，不会出现「休息 9小时59分钟」这种尾巴；
 * 界面上会把它显示成 "23:59"（见 app.ts 里的 timeLabel）。
 * 万一数据里真有超出这个范围的安排，会自动扩到整点，保证不会把安排裁掉。
 */
export function computeRange(entries: BusyEntry[], fallback: DayRange = { start: '00:00', end: '24:00' }): DayRange {
  let start = parseTime(fallback.start);
  let end = parseTime(fallback.end);
  for (const entry of entries) {
    start = Math.min(start, Math.floor(parseTime(entry.start) / 60) * 60);
    end = Math.max(end, Math.ceil(parseTime(entry.end) / 60) * 60);
  }
  return {
    start: formatTime(Math.max(0, start)),
    end: formatTime(Math.min(24 * 60, end)),
  };
}

/* ---------- 日历网格布局（Apple 日历那种：位置 + 高度表示时间） ---------- */

/** 一个已经算好位置和大小的日程方块，数值都是相对整个时间轴的百分比 */
export interface PositionedBlock {
  title: string;
  /** 事务类型（周视图摘要用） */
  type: string;
  /** 地址 / 地点（周视图摘要用） */
  location: string;
  /** 具体事项（日视图用） */
  details: string;
  start: string;
  end: string;
  /** 距离时间轴顶部的位置，0-100 */
  top: number;
  /** 高度，0-100 */
  height: number;
  /** 横向位置，0-100（处理时间重叠时并排显示） */
  left: number;
  /** 横向宽度，0-100 */
  width: number;
  /** 时长（分钟），用来决定方块里能不能放下文字 */
  duration: number;
}

/** 摘要：类型 · 地点，例如「学习 · 线上 Zoom」；两者都没有时返回空字符串 */
export function blockSummary(block: { type: string; location: string }): string {
  return [block.type, block.location].filter(Boolean).join(' · ');
}

/**
 * 把某一天的日程排成日历方块。
 *
 * - top / height 按时间比例计算，所以「方块大小 = 占用时间长短」
 * - 时间重叠的日程会横向并排（同一簇里平分宽度），不会互相盖住
 */
export function layoutDay(entries: BusyEntry[], date: string, range: DayRange): PositionedBlock[] {
  const rangeStart = parseTime(range.start);
  const rangeEnd = parseTime(range.end);
  const total = rangeEnd - rangeStart;
  if (total <= 0) return [];

  const blocks = entriesForDate(entries, date)
    .map((e) => ({
      title: e.title,
      type: e.type ?? '',
      location: e.location ?? '',
      details: e.details ?? '',
      start: Math.max(parseTime(e.start), rangeStart),
      end: Math.min(parseTime(e.end), rangeEnd),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // 1. 按「互相重叠」分成若干簇
  const clusters: (typeof blocks)[number][][] = [];
  let cluster: (typeof blocks)[number][] = [];
  let clusterEnd = -1;
  for (const block of blocks) {
    if (cluster.length && block.start >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length) clusters.push(cluster);

  // 2. 簇内尽量塞进已有的列，塞不下就新开一列
  const result: PositionedBlock[] = [];
  for (const group of clusters) {
    const columnEnds: number[] = [];
    const placed: { block: (typeof group)[number]; column: number }[] = [];

    for (const block of group) {
      let column = columnEnds.findIndex((end) => end <= block.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = block.end;
      placed.push({ block, column });
    }

    const columns = columnEnds.length;
    for (const { block, column } of placed) {
      result.push({
        title: block.title,
        type: block.type,
        location: block.location,
        details: block.details,
        start: formatTime(block.start),
        end: formatTime(block.end),
        top: ((block.start - rangeStart) / total) * 100,
        height: ((block.end - block.start) / total) * 100,
        left: (column / columns) * 100,
        width: 100 / columns,
        duration: block.end - block.start,
      });
    }
  }

  return result;
}

/** 把某个时间点换算成时间轴上的百分比位置（0-100） */
export function timePercent(time: string, range: DayRange): number {
  const start = parseTime(range.start);
  const end = parseTime(range.end);
  return ((parseTime(time) - start) / (end - start)) * 100;
}

/** 时间轴上要显示的整点，例如 ['08:00', '09:00', ...] */
export function hourMarks(range: DayRange): { time: string; top: number }[] {
  const start = parseTime(range.start);
  const end = parseTime(range.end);
  const total = end - start;
  const first = Math.ceil(start / 60) * 60;
  const marks: { time: string; top: number }[] = [];
  for (let m = first; m <= end; m += 60) {
    marks.push({ time: formatTime(m), top: ((m - start) / total) * 100 });
  }
  // 末尾不落在整点时（例如有人把 range 改成 00:00–23:59）也补一个刻度，底部才不会空一块没标记
  const last = marks[marks.length - 1];
  if (!last || last.time !== range.end) {
    marks.push({ time: range.end, top: 100 });
  }
  return marks;
}

/**
 * 「现在」红线在时间轴上的位置（0-100），不在当天范围内就返回 null。
 * minutesOfDay 必须是**北京时间**的分钟数，用 beijingMinutesOfDay() 拿。
 */
export function nowPosition(range: DayRange, minutesOfDay: number = beijingMinutesOfDay()): number | null {
  const start = parseTime(range.start);
  const end = parseTime(range.end);
  if (minutesOfDay < start || minutesOfDay > end) return null;
  return ((minutesOfDay - start) / (end - start)) * 100;
}
