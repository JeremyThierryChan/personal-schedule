/**
 * 首页交互逻辑（纯浏览器端）
 *
 * 设计原则：
 * 1. 打开页面立刻能看到时间表（忙碌 / 空闲），不需要先输入姓名。
 * 2. 姓名验证是「可选」的一步：验证通过后才把「忙碌」换成具体活动名称。
 * 3. 日 / 周 是时间轴网格（方块的高度和位置 = 占用时间的长短，苹果日历那样），
 *    月 是日历格子。颜色语言统一：玫红 = 忙碌，浅绿 = 空闲。
 */
import { resolveLevel, type Visitor } from '../lib/access';
import {
  addMonths,
  beijingMinutesOfDay,
  beijingTodayKey,
  blockSummary,
  buildTimeline,
  formatDateLabel,
  formatDuration,
  formatDurationShort,
  formatMonthLabel,
  formatWeekLabel,
  hourMarks,
  isValidDateKey,
  layoutDay,
  monthGrid,
  monthKey,
  nowPosition,
  parseTime,
  shiftDateKey,
  splitSlots,
  timePercent,
  weekDates,
  weekdayName,
  type BusyEntry,
  type DayRange,
  type RestWindow,
  type PositionedBlock,
} from '../lib/schedule';

interface AppData {
  schedule: BusyEntry[];
  visitors: Visitor[];
  range: DayRange;
  /** 每天的休息时段（可选）：不算空闲 */
  rest?: RestWindow;
}

type View = 'day' | 'week' | 'month';

const STORAGE_KEY = 'personal-schedule:name';

/**
 * 时间轴容器高度：一整天 24 小时（00:00–23:59）按比例铺开。
 * 手机 940px ≈ 每小时 39px，桌面 1100px ≈ 每小时 46px —— 和之前 22 小时版本
 * 每小时的像素高度基本一致，换成全天以后方块不会变小。
 * 高度固定，所以内部不会出现纵向滚动条（要滚动就滚整个页面）。
 */
const GRID_HEIGHT = 'h-[940px] sm:h-[1100px]';

/**
 * 周视图表头高度。左边时间轴要留出同样高度的空位，
 * 两边才能对齐 —— 所以这里用固定高度，而不是靠内边距撑。
 */
const HEAD_HEIGHT = 'h-9';

/** 从 <script id="app-data"> 里读取数据 */
function readData(): AppData | null {
  const node = document.getElementById('app-data');
  const raw = node?.textContent;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppData;
  } catch {
    return null;
  }
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * 时间显示：一天在内部算到 24:00（这样每个时段的时长都是精确的），
 * 但界面上把 24:00 写成 23:59 —— 也就是「一天到 23:59 结束」。
 */
function timeLabel(time: string): string {
  return time === '24:00' ? '23:59' : time;
}

/** 小工具：创建元素，避免用 innerHTML 拼接用户输入 */
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 用百分比定位一个方块 */
function place(el: HTMLElement, top: number, height: number, left?: number, width?: number): void {
  el.style.top = `${top}%`;
  el.style.height = `${height}%`;
  if (left !== undefined && width !== undefined) {
    el.style.left = `calc(${left}% + 2px)`;
    el.style.width = `calc(${width}% - 4px)`;
  }
}

/* ================= 日视图 / 周视图：时间轴网格 ================= */

/**
 * 生成一个日程方块。
 * - 日视图：写得详细（活动名 + 时间 + 类型/地点 + 具体事项）
 * - 周视图：只写摘要（活动名 + 类型 · 地点）
 * - 访客：一律只写「忙碌」和时间段
 */
function renderBlock(block: PositionedBlock, authorized: boolean, mode: 'day' | 'week'): HTMLElement {
  const card = make(
    'div',
    // 手机上列很窄，内边距收窄一点，让标题多显示一两个字
    'absolute z-10 overflow-hidden rounded-md border border-rose-300 bg-rose-100 px-1 py-0.5 shadow-sm sm:px-1.5',
  );
  place(card, block.top, block.height, block.left, block.width);
  card.style.minHeight = '17px';
  card.dataset.block = '1';

  const time = `${timeLabel(block.start)}–${timeLabel(block.end)}`;
  const summary = blockSummary(block);
  const headline = authorized && block.title ? block.title : '忙碌';
  // hover 的原生 tooltip 给全量信息
  card.title = [time, headline, summary, block.details].filter(Boolean).join(' · ');

  card.appendChild(
    make(
      'div',
      `truncate font-medium leading-tight text-rose-900 ${
        mode === 'day' ? 'text-[11px] sm:text-sm' : 'text-[10px] sm:text-xs'
      }`,
      headline,
    ),
  );

  // 访客：只有时间段
  if (!authorized) {
    if (block.duration >= 60) {
      card.appendChild(
        make('div', 'truncate font-mono text-[9px] tabular-nums leading-tight text-rose-600/90 sm:text-[10px]', time),
      );
    }
    return card;
  }

  // 周视图：只写摘要（类型 · 地点），没有摘要就退回时间段
  if (mode === 'week') {
    if (block.duration >= 60) {
      card.appendChild(
        make('div', 'truncate text-[9px] leading-tight text-rose-600/90 sm:text-[10px]', summary || time),
      );
    }
    return card;
  }

  // 日视图：活动名 + 时间 + 类型/地点 + 具体事项
  // （1 小时 ≈ 桌面 46px，正好放得下标题 + 一行小字；更短的就只写标题，免得被裁）
  if (block.duration >= 60) {
    card.appendChild(
      make(
        'div',
        'truncate text-[9px] leading-tight text-rose-600/90 sm:text-[11px]',
        [time, summary].filter(Boolean).join(' · '),
      ),
    );
  }
  if (block.details && block.duration >= 90) {
    card.appendChild(
      make('div', 'mt-0.5 line-clamp-2 text-[9px] leading-snug text-rose-800/80 sm:text-[11px]', block.details),
    );
  }
  return card;
}

/**
 * 画一个时间轴网格。
 * days.length === 1 是日视图（一列），=== 7 是周视图（七列横向铺开）。
 */
function renderTimeGrid(
  days: string[],
  opts: { authorized: boolean; today: string; schedule: BusyEntry[]; range: DayRange; rest?: RestWindow },
): HTMLElement {
  const { authorized, today, schedule, range, rest } = opts;
  const multi = days.length > 1;
  const marks = hourMarks(range);

  // 外层：左边固定时间轴，右边是可横向滑动的日期列
  const outer = make('div', 'flex');

  /* ---- 左：时间刻度（横向滑动时保持不动，随时能看到时间参照）---- */
  const gutter = make('div', 'flex w-10 shrink-0 flex-col sm:w-12');
  if (multi) gutter.appendChild(make('div', HEAD_HEIGHT)); // 和右边表头对齐的空位
  const gutterMarks = make('div', 'relative flex-1');
  for (const [i, mark] of marks.entries()) {
    // 首尾两个刻度不能做成「上下居中」，否则会超出容器、撑出滚动条
    const align = i === 0 ? '' : i === marks.length - 1 ? '-translate-y-full' : '-translate-y-1/2';
    const label = make(
      'div',
      `absolute right-1.5 font-mono text-[10px] tabular-nums text-slate-400 sm:text-xs ${align}`,
      timeLabel(mark.time),
    );
    label.style.top = `${mark.top}%`;
    label.dataset.hourLabel = '1';
    // 手机上隔一小时显示一个刻度，免得挤在一起；最后一个（23:59）例外，它是结束标记
    if (Number(mark.time.slice(0, 2)) % 2 !== 0 && i !== marks.length - 1) {
      label.classList.add('hidden', 'sm:block');
    }
    gutterMarks.appendChild(label);
  }
  gutter.appendChild(gutterMarks);
  outer.appendChild(gutter);

  /* ---- 右：日期列 ----
   * 手机：每列占屏幕 1/3（一屏正好 3 天），7 列总宽 7/3 = 233.333%，可以左右滑
   * 桌面：7 列平分宽度，全部铺满，不滚动、没有滑块
   */
  const scroller = make(
    'div',
    multi
      ? 'min-w-0 flex-1 overflow-x-auto overflow-y-hidden sm:overflow-visible'
      : 'min-w-0 flex-1',
  );
  const columns = make('div', `flex flex-col ${multi ? 'w-[233.333%] sm:w-full' : 'w-full'}`);
  scroller.appendChild(columns);
  outer.appendChild(scroller);

  // ---- 表头（只有周视图需要，日视图的日期在导航栏里）----
  if (multi) {
    const headRow = make('div', `flex shrink-0 items-center ${HEAD_HEIGHT}`);
    for (const d of days) {
      const isToday = d === today;
      const btn = make(
        'button',
        `flex h-full min-w-0 flex-1 flex-col items-center justify-center border-b-2 transition-colors hover:bg-slate-50 ${
          isToday ? 'border-rose-400' : 'border-transparent'
        }`,
      );
      btn.type = 'button';
      btn.dataset.date = d;
      btn.appendChild(make('div', 'text-[10px] leading-none text-slate-400 sm:text-xs', weekdayName(d)));
      btn.appendChild(
        make(
          'div',
          `mt-0.5 text-xs font-semibold leading-none sm:text-sm ${isToday ? 'text-rose-600' : 'text-slate-900'}`,
          `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`,
        ),
      );
      headRow.appendChild(btn);
    }
    columns.appendChild(headRow);
  }

  // ---- 网格主体 ----
  const body = make('div', `relative flex ${GRID_HEIGHT}`);

  // 整点横线
  for (const mark of marks) {
    const line = make('div', 'pointer-events-none absolute inset-x-0 z-0 border-t border-slate-100');
    line.style.top = `${mark.top}%`;
    body.appendChild(line);
  }

  // 每一天一列
  for (const d of days) {
    const isToday = d === today;
    const col = make(
      'div',
      `relative min-w-0 flex-1 border-l border-slate-100 first:border-l-0 ${isToday ? 'bg-rose-50/40' : ''}`,
    );
    if (multi) col.dataset.date = d; // 周视图：点某一列跳到那天

    // 1) 背景层：休息时段（靛蓝）+ 空闲时段（浅绿）
    const { free, rest: restSlots } = splitSlots(buildTimeline(schedule, d, range, rest));

    for (const slot of restSlots) {
      const top = timePercent(slot.start, range);
      const height = timePercent(slot.end, range) - top;
      const minutes = parseTime(slot.end) - parseTime(slot.start);

      const restBox = make(
        'div',
        'absolute inset-x-0.5 z-0 overflow-hidden rounded-md bg-indigo-100/70 ring-1 ring-indigo-200/70',
      );
      restBox.dataset.rest = '1';
      place(restBox, top, height);
      if (height >= 2.5) {
        restBox.appendChild(
          make(
            'div',
            'truncate px-1 pt-0.5 text-[10px] font-medium text-indigo-500/90 sm:px-1.5',
            `休息 ${formatDuration(minutes)}`,
          ),
        );
        if (height >= 6) {
          restBox.appendChild(
            make(
              'div',
              'truncate px-1.5 font-mono text-[9px] tabular-nums text-indigo-400/90 sm:text-[10px]',
              `${timeLabel(slot.start)}–${timeLabel(slot.end)}`,
            ),
          );
        }
      }
      col.appendChild(restBox);
    }

    for (const slot of free) {
      const top = timePercent(slot.start, range);
      const height = timePercent(slot.end, range) - top;
      const minutes = parseTime(slot.end) - parseTime(slot.start);

      const freeBox = make(
        'div',
        'absolute inset-x-0.5 z-0 overflow-hidden rounded-md bg-emerald-50 ring-1 ring-emerald-100',
      );
      freeBox.dataset.free = '1';
      place(freeBox, top, height);
      // 24 小时制下 1 小时 = 4.17%，阈值按像素高度定：
      // 2.5% ≈ 手机 24px / 桌面 28px，放得下一行；6% 能放两行
      if (height >= 2.5) {
        // 标明空闲了多久
        freeBox.appendChild(
          make(
            'div',
            'truncate px-1 pt-0.5 text-[10px] font-medium text-emerald-700/90 sm:px-1.5',
            `空闲 ${formatDuration(minutes)}`,
          ),
        );
        // 够高的话把具体时间段也写上（6% ≈ 手机上 43px，放得下两行）
        if (height >= 6) {
          freeBox.appendChild(
            make(
              'div',
              'truncate px-1.5 font-mono text-[9px] tabular-nums text-emerald-600/80 sm:text-[10px]',
              `${timeLabel(slot.start)}–${timeLabel(slot.end)}`,
            ),
          );
        }
      }
      col.appendChild(freeBox);
    }

    // 2) 前景层：日程方块（高度和位置 = 占用的时间长短）
    for (const block of layoutDay(schedule, d, range)) {
      col.appendChild(renderBlock(block, authorized, multi ? 'week' : 'day'));
    }

    // 3) 今天：一条「现在」的红线（按北京时间算）
    if (isToday) {
      const pos = nowPosition(range);
      if (pos !== null) {
        const nowLine = make('div', 'pointer-events-none absolute inset-x-0 z-20 border-t-2 border-rose-500');
        nowLine.dataset.nowLine = '1';
        nowLine.style.top = `${pos}%`;
        nowLine.appendChild(make('span', 'absolute -left-[3px] -top-[4px] h-2 w-2 rounded-full bg-rose-500'));
        col.appendChild(nowLine);
      }
    }

    body.appendChild(col);
  }

  columns.appendChild(body);
  return outer;
}

/* ================= 月视图 ================= */

function renderMonthCell(
  cell: { date: string; inMonth: boolean },
  today: string,
  freeMinutes: number,
  busy: boolean,
): HTMLButtonElement {
  const isToday = cell.date === today;

  const btn = make(
    'button',
    `flex min-h-[3.25rem] flex-col rounded-lg border p-1 text-left transition-colors sm:min-h-[5.5rem] ${
      cell.inMonth
        ? busy
          ? 'border-slate-200 bg-white hover:border-slate-300'
          : 'border-emerald-100 bg-emerald-50/70 hover:border-emerald-200'
        : 'border-transparent bg-slate-50 opacity-50'
    }`,
  );
  btn.type = 'button';
  btn.dataset.date = cell.date;

  btn.appendChild(
    make(
      'div',
      isToday
        ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[11px] font-semibold text-white'
        : 'text-[11px] font-medium text-slate-600 sm:text-xs',
      String(Number(cell.date.slice(8, 10))),
    ),
  );

  // 月视图只显示「这一天空闲多久」——不列具体日程
  if (cell.inMonth) {
    // 手机上格子窄，用「9时30分」这种紧凑写法
    btn.appendChild(
      make('div', 'mt-auto text-[9px] font-medium leading-none text-emerald-600/90 sm:hidden', formatDurationShort(freeMinutes)),
    );
    btn.appendChild(
      make(
        'div',
        'mt-auto hidden truncate text-[10px] leading-4 font-medium text-emerald-600/90 sm:block',
        `空闲 ${formatDuration(freeMinutes)}`,
      ),
    );
  }

  return btn;
}

/* ================= 主逻辑 ================= */

export function initApp(): void {
  const data = readData();

  const todayLine = byId<HTMLElement>('today-line');
  const dateLabel = byId<HTMLElement>('date-label');
  const datePicker = byId<HTMLInputElement>('date-picker');
  const navDay = byId<HTMLElement>('nav-day');
  const navRange = byId<HTMLElement>('nav-range');
  const rangeLabel = byId<HTMLElement>('range-label');
  const rangeSub = byId<HTMLElement>('range-sub');
  const dayView = byId<HTMLElement>('day-view');
  const weekView = byId<HTMLElement>('week-view');
  const monthView = byId<HTMLElement>('month-view');
  const monthGridEl = byId<HTMLElement>('month-grid');
  const notice = byId<HTMLElement>('notice');
  const todayButton = byId<HTMLButtonElement>('today-button');
  const prevButton = byId<HTMLButtonElement>('prev-day');
  const nextButton = byId<HTMLButtonElement>('next-day');

  // 姓名验证相关
  const authGuest = byId<HTMLElement>('auth-guest');
  const authFull = byId<HTMLElement>('auth-full');
  const guestHint = byId<HTMLElement>('guest-hint');
  const authToggle = byId<HTMLButtonElement>('auth-toggle');
  const authExit = byId<HTMLButtonElement>('auth-exit');
  const authCancel = byId<HTMLButtonElement>('auth-cancel');
  const form = byId<HTMLFormElement>('name-form');
  const input = byId<HTMLInputElement>('name-input');
  const error = byId<HTMLElement>('name-error');

  if (
    !data || !dateLabel || !datePicker || !dayView || !weekView || !monthView || !monthGridEl ||
    !notice || !navDay || !navRange || !rangeLabel || !prevButton || !nextButton ||
    !authGuest || !authFull || !guestHint || !authToggle || !form || !input
  ) {
    return;
  }

  const app = data;
  /** 「今天」按北京时间算：日程数据是北京时间的，不能跟着访客本机时区跑 */
  const today = beijingTodayKey();
  /** 默认打开周视图 */
  let view: View = 'week';
  let date = today;
  let formOpen = false;
  let name = '';
  /** 访客条上的提示文字（例如「未找到 XXX」），空字符串表示用默认文案 */
  let hint = '';

  try {
    name = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    name = '';
  }

  const isAuthorized = (): boolean => name.trim() !== '' && resolveLevel(name, app.visitors) === 'full';

  // 用浏览器本地日期覆盖构建时写死的日期
  if (todayLine) todayLine.textContent = formatDateLabel(today);

  /* ---------------- 渲染 ---------------- */

  function renderDay(): void {
    const blocks = layoutDay(app.schedule, date, app.range);
    dayView!.replaceChildren(
      renderTimeGrid([date], {
        authorized: isAuthorized(),
        today,
        schedule: app.schedule,
        range: app.range,
        rest: app.rest,
      }),
    );

    const { free, rest: restSlots } = splitSlots(buildTimeline(app.schedule, date, app.range, app.rest));
    const total = (slots: { start: string; end: string }[]) =>
      slots.reduce((sum, s) => sum + (parseTime(s.end) - parseTime(s.start)), 0);
    const busyMinutes = blocks.reduce((sum, b) => sum + b.duration, 0);
    const freeMinutes = total(free);
    const restMinutes = total(restSlots);

    // 没有安排的那天就不写「忙碌 0分钟」了
    const parts: string[] = [];
    if (blocks.length) parts.push(`忙碌 ${formatDuration(busyMinutes)}（${blocks.length} 段）`);
    if (restMinutes > 0) parts.push(`休息 ${formatDuration(restMinutes)}`);
    parts.push(`可约 ${formatDuration(freeMinutes)}`);
    const prefix = blocks.length ? '' : `${date === today ? '今天' : '这一天'}没有安排 · `;
    notice!.textContent = prefix + parts.join(' · ');
    notice!.className = 'mb-3 text-xs text-slate-400';
  }

  function renderWeek(): void {
    weekView!.replaceChildren(
      renderTimeGrid(weekDates(date), {
        authorized: isAuthorized(),
        today,
        schedule: app.schedule,
        range: app.range,
        rest: app.rest,
      }),
    );
  }

  function renderMonth(): void {
    monthGridEl!.replaceChildren();
    for (const cell of monthGrid(date)) {
      // 月视图里的「空闲」= 真正能约的时间，休息时段已经扣掉了
      const { free } = splitSlots(buildTimeline(app.schedule, cell.date, app.range, app.rest));
      const freeMinutes = free.reduce((sum, f) => sum + (parseTime(f.end) - parseTime(f.start)), 0);
      const busy = layoutDay(app.schedule, cell.date, app.range).length > 0;
      monthGridEl!.appendChild(renderMonthCell(cell, today, freeMinutes, busy));
    }
  }

  function renderNav(): void {
    navDay!.hidden = view !== 'day';
    navRange!.hidden = view === 'day';

    if (view === 'day') {
      dateLabel!.textContent = formatDateLabel(date);
      datePicker!.value = date;
    } else if (view === 'week') {
      rangeLabel!.textContent = formatWeekLabel(date);
      rangeSub!.textContent = `${date.slice(0, 4)}年 · 周一 – 周日`;
    } else {
      rangeLabel!.textContent = formatMonthLabel(date);
      rangeSub!.textContent = '点某一天查看当天详情';
    }

    prevButton!.setAttribute('aria-label', view === 'day' ? '前一天' : view === 'week' ? '前一周' : '前一月');
    nextButton!.setAttribute('aria-label', view === 'day' ? '后一天' : view === 'week' ? '后一周' : '后一月');

    const containsToday =
      view === 'day'
        ? date === today
        : view === 'week'
          ? weekDates(date).includes(today)
          : monthKey(date) === monthKey(today);
    if (todayButton) todayButton.hidden = containsToday;
  }

  function renderViewButtons(): void {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const active = btn.dataset.view === view;
      btn.className = `rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`;
      btn.setAttribute('aria-pressed', String(active));
    }
    dayView!.hidden = view !== 'day';
    weekView!.hidden = view !== 'week';
    monthView!.hidden = view !== 'month';
  }

  function renderAuth(): void {
    const authorized = isAuthorized();
    authGuest!.hidden = authorized || formOpen;
    form!.hidden = authorized || !formOpen;
    authFull!.hidden = !authorized;
    if (!authorized) {
      if (guestHint) guestHint.textContent = hint || '访客视图 · 只显示忙碌 / 空闲';
      input!.value = '';
    }
  }

  function renderContent(): void {
    renderNav();
    renderViewButtons();
    renderDay();
    renderWeek();
    renderMonth();
  }

  function render(): void {
    renderContent();
    renderAuth();
  }

  /* ---------------- 事件 ---------------- */

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    btn.addEventListener('click', () => {
      view = btn.dataset.view as View;
      renderContent();
    });
  }

  // 周视图：点表头或某一列 -> 跳到那天的日视图
  weekView.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-date]');
    if (!target?.dataset.date) return;
    date = target.dataset.date;
    view = 'day';
    renderContent();
  });

  // 月视图：点某一格 -> 跳到那天的日视图
  monthView.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-date]');
    if (!target?.dataset.date) return;
    date = target.dataset.date;
    view = 'day';
    renderContent();
  });

  authToggle.addEventListener('click', () => {
    formOpen = true;
    hint = '';
    renderAuth();
    input.focus();
  });

  authCancel?.addEventListener('click', () => {
    formOpen = false;
    if (error) error.hidden = true;
    renderAuth();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!value) {
      if (error) {
        error.textContent = '请输入姓名';
        error.hidden = false;
      }
      input.focus();
      return;
    }
    if (error) error.hidden = true;

    if (resolveLevel(value, app.visitors) === 'full') {
      name = value;
      hint = '';
      try {
        localStorage.setItem(STORAGE_KEY, name);
      } catch {
        /* 隐私模式下写不进去，忽略 */
      }
    } else {
      name = '';
      hint = `未找到「${value}」，只能查看忙碌 / 空闲`;
    }

    formOpen = false;
    render();
  });

  authExit?.addEventListener('click', () => {
    name = '';
    formOpen = false;
    hint = '';
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
    render();
  });

  // 导航：步长跟着视图走
  prevButton.addEventListener('click', () => {
    date = view === 'month' ? addMonths(date, -1) : shiftDateKey(date, view === 'week' ? -7 : -1);
    renderContent();
  });

  nextButton.addEventListener('click', () => {
    date = view === 'month' ? addMonths(date, 1) : shiftDateKey(date, view === 'week' ? 7 : 1);
    renderContent();
  });

  datePicker.addEventListener('change', () => {
    if (isValidDateKey(datePicker.value)) {
      date = datePicker.value;
      renderContent();
    } else {
      datePicker.value = date;
    }
  });

  todayButton?.addEventListener('click', () => {
    date = today;
    renderContent();
  });

  // 「预约我的时间」里的复制按钮（电话 / 微信号）
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', async () => {
      const original = button.textContent;
      let ok = false;
      try {
        await navigator.clipboard.writeText(button.dataset.copy ?? '');
        ok = true;
      } catch {
        ok = false; // 非 https 或老浏览器：让用户手动选中
      }
      button.textContent = ok ? '已复制 ✓' : '请手动复制';
      if (ok) button.classList.add('text-emerald-600');
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove('text-emerald-600');
      }, 1600);
    });
  }

  render();

  // 每分钟挪一下「现在」红线（只改位置、不重画，免得滚动位置跳回去）
  window.setInterval(() => {
    const pos = nowPosition(app.range);
    for (const el of document.querySelectorAll<HTMLElement>('[data-now-line]')) {
      if (pos === null) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
        el.style.top = `${pos}%`;
      }
    }
  }, 60_000);
}
