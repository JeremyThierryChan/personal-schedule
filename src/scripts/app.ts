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
  blockSummary,
  buildTimeline,
  formatDateLabel,
  formatDuration,
  formatHours,
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
  todayKey,
  weekDates,
  weekdayName,
  type BusyEntry,
  type DayRange,
  type PositionedBlock,
} from '../lib/schedule';

interface AppData {
  schedule: BusyEntry[];
  visitors: Visitor[];
  range: DayRange;
}

type View = 'day' | 'week' | 'month';

const STORAGE_KEY = 'personal-schedule:name';

/**
 * 时间轴容器高度：15 小时（08:00–23:00）按比例铺开。
 * 手机 860px ≈ 每小时 57px，桌面 1000px ≈ 每小时 67px，方块里放得下字。
 * 高度固定，所以内部不会出现纵向滚动条（要滚动就滚整个页面）。
 */
const GRID_HEIGHT = 'h-[860px] sm:h-[1000px]';

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

  const time = `${block.start}–${block.end}`;
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
  if (block.duration >= 30) {
    card.appendChild(
      make(
        'div',
        'truncate text-[9px] leading-tight text-rose-600/90 sm:text-[11px]',
        [time, summary].filter(Boolean).join(' · '),
      ),
    );
  }
  if (block.details && block.duration >= 60) {
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
  opts: { authorized: boolean; today: string; schedule: BusyEntry[]; range: DayRange },
): HTMLElement {
  const { authorized, today, schedule, range } = opts;
  const multi = days.length > 1;
  const marks = hourMarks(range);

  // 不套任何滚动容器：列宽永远按可用宽度平分，卡片里不会出现滑动条
  const inner = make('div', '');

  // ---- 表头（只有周视图需要，日视图的日期在导航栏里）----
  if (multi) {
    const head = make('div', 'flex items-end');
    head.appendChild(make('div', 'w-10 shrink-0 sm:w-12'));
    const headRow = make('div', 'flex flex-1');
    for (const d of days) {
      const isToday = d === today;
      const btn = make(
        'button',
        `flex-1 rounded-t-lg border-b-2 px-1 pb-1.5 pt-1 text-center transition-colors hover:bg-slate-50 ${
          isToday ? 'border-rose-400' : 'border-transparent'
        }`,
      );
      btn.type = 'button';
      btn.dataset.date = d;
      btn.appendChild(make('div', 'text-[10px] text-slate-400 sm:text-xs', weekdayName(d)));
      btn.appendChild(
        make(
          'div',
          `text-xs font-semibold sm:text-sm ${isToday ? 'text-rose-600' : 'text-slate-900'}`,
          `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`,
        ),
      );
      headRow.appendChild(btn);
    }
    head.appendChild(headRow);
    inner.appendChild(head);
  }

  // ---- 网格主体 ----
  const grid = make('div', `flex ${GRID_HEIGHT}`);

  // 左侧时间刻度
  const gutter = make('div', 'relative w-10 shrink-0 sm:w-12');
  for (const [i, mark] of marks.entries()) {
    // 首尾两个刻度不能做成「上下居中」，否则会超出容器、撑出滚动条
    const align = i === 0 ? '' : i === marks.length - 1 ? '-translate-y-full' : '-translate-y-1/2';
    const label = make(
      'div',
      `absolute right-1.5 font-mono text-[10px] tabular-nums text-slate-400 sm:text-xs ${align}`,
      mark.time,
    );
    label.style.top = `${mark.top}%`;
    label.dataset.hourLabel = '1';
    // 手机上隔一小时显示一个刻度，免得挤在一起
    if (Number(mark.time.slice(0, 2)) % 2 !== 0) label.classList.add('hidden', 'sm:block');
    gutter.appendChild(label);
  }
  grid.appendChild(gutter);

  // 右侧：所有列共用的容器
  const body = make('div', 'relative flex flex-1 border-t border-slate-100');

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

    // 1) 背景层：自动算出来的空闲时段（浅绿）
    const { free } = splitSlots(buildTimeline(schedule, d, range));
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
      if (height >= 5) {
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
              `${slot.start}–${slot.end}`,
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

    // 3) 今天：一条「现在」的红线
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

  grid.appendChild(body);
  inner.appendChild(grid);
  return inner;
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
    const hours = formatHours(freeMinutes);
    // 手机上格子窄，只写 "9.5h"
    btn.appendChild(make('div', 'mt-auto text-[9px] font-medium leading-none text-emerald-600/90 sm:hidden', `${hours}h`));
    btn.appendChild(
      make(
        'div',
        'mt-auto hidden text-[10px] leading-4 font-medium text-emerald-600/90 sm:block',
        `空闲 ${hours} 小时`,
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
  const today = todayKey();
  let view: View = 'day';
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
      renderTimeGrid([date], { authorized: isAuthorized(), today, schedule: app.schedule, range: app.range }),
    );

    const { free } = splitSlots(buildTimeline(app.schedule, date, app.range));
    const busyMinutes = blocks.reduce((sum, b) => sum + b.duration, 0);
    const freeMinutes = free.reduce((sum, f) => sum + (parseTime(f.end) - parseTime(f.start)), 0);

    if (blocks.length) {
      notice!.textContent =
        `忙碌 ${formatDuration(busyMinutes)}（${blocks.length} 段） · ` +
        `空闲 ${formatDuration(freeMinutes)}（${free.length} 段）`;
      notice!.className = 'mb-3 text-xs text-slate-400';
    } else {
      notice!.textContent = `${date === today ? '今天' : '这一天'}没有安排 · 全天空闲 ${formatDuration(freeMinutes)}`;
      notice!.className =
        'mb-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-center text-sm text-emerald-700';
    }
  }

  function renderWeek(): void {
    weekView!.replaceChildren(
      renderTimeGrid(weekDates(date), {
        authorized: isAuthorized(),
        today,
        schedule: app.schedule,
        range: app.range,
      }),
    );
  }

  function renderMonth(): void {
    monthGridEl!.replaceChildren();
    for (const cell of monthGrid(date)) {
      const { free } = splitSlots(buildTimeline(app.schedule, cell.date, app.range));
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

  render();

  // 每分钟挪一下「现在」红线（只改位置、不重画，免得周视图的横向滚动跳回去）
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
