/**
 * 首页交互逻辑（纯浏览器端）
 *
 * 设计原则：
 * 1. 打开页面立刻能看到时间表（忙碌 / 空闲），不需要先输入姓名。
 * 2. 姓名验证是「可选」的一步：验证通过后才把「忙碌」换成具体活动名称。
 * 3. 支持 日 / 周 / 月 三种视图，共用一个「锚点日期」。
 */
import { resolveLevel, type Visitor } from '../lib/access';
import {
  addMonths,
  buildTimeline,
  formatDateLabel,
  formatDuration,
  formatMonthLabel,
  formatWeekLabel,
  isValidDateKey,
  monthGrid,
  monthKey,
  shiftDateKey,
  splitSlots,
  todayKey,
  totalMinutes,
  weekDates,
  weekdayName,
  type BusyEntry,
  type DayRange,
  type Slot,
} from '../lib/schedule';

interface AppData {
  schedule: BusyEntry[];
  visitors: Visitor[];
  range: DayRange;
}

type View = 'day' | 'week' | 'month';

const STORAGE_KEY = 'personal-schedule:name';

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

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/* ---------------- 日视图：一行时间线 ---------------- */

function renderSlot(slot: Slot, authorized: boolean): HTMLLIElement {
  const li = make(
    'li',
    slot.busy
      ? `flex items-stretch gap-3 border-slate-200 bg-white p-3 shadow-sm transition-colors sm:gap-4 sm:p-4 ${CARD}`
      : 'flex items-stretch gap-3 rounded-xl border border-dashed border-slate-200 bg-white/50 p-3 sm:gap-4 sm:p-4',
  );

  // 左侧颜色条：忙碌 = 玫红，空闲 = 浅灰
  li.appendChild(make('span', `w-1.5 shrink-0 rounded-full ${slot.busy ? 'bg-rose-400' : 'bg-slate-200'}`));

  const body = make('div', 'min-w-0 flex-1');
  body.appendChild(
    make('div', 'font-mono text-xs tabular-nums text-slate-500 sm:text-sm', `${slot.start} – ${slot.end}`),
  );

  if (slot.busy) {
    body.appendChild(
      make('div', 'mt-1 truncate text-base font-medium text-slate-900 sm:text-lg', authorized ? slot.title : '忙碌'),
    );
    body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', authorized ? '安排' : '这段时间没空'));
  } else {
    body.appendChild(make('div', 'mt-1 text-base font-medium text-slate-400 sm:text-lg', '空闲'));
    body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', '可以约'));
  }

  li.appendChild(body);
  return li;
}

/* ---------------- 周 / 月视图 ---------------- */

/** 周视图里的一天 */
function renderWeekCard(date: string, authorized: boolean, today: string, slots: Slot[]): HTMLButtonElement {
  const card = make('button', `${CARD} w-full p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50`);
  card.type = 'button';
  card.dataset.date = date;
  if (date === today) card.classList.add('ring-1', 'ring-rose-300');

  const { busy, free } = splitSlots(slots);

  const head = make('div', 'flex items-baseline justify-between gap-2');
  head.appendChild(
    make(
      'span',
      `text-sm font-medium ${date === today ? 'text-rose-600' : 'text-slate-900'}`,
      `${weekdayName(date)} ${date.slice(5)}`,
    ),
  );
  head.appendChild(
    make('span', 'shrink-0 text-xs text-slate-400', busy.length ? `忙碌 ${formatDuration(totalMinutes(busy))}` : '全天空闲'),
  );
  card.appendChild(head);

  if (busy.length) {
    const chips = make('div', 'mt-2 flex flex-wrap gap-1.5');
    for (const slot of busy) {
      chips.appendChild(
        make(
          'span',
          'rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-100',
          `${slot.start}–${slot.end} ${authorized && slot.title ? slot.title : '忙碌'}`,
        ),
      );
    }
    card.appendChild(chips);
  }

  if (free.length) {
    card.appendChild(
      make('div', 'mt-1.5 text-xs leading-relaxed text-slate-400', `空闲 ${free.map((s) => `${s.start}–${s.end}`).join(' · ')}`),
    );
  }

  return card;
}

/** 月视图里的一格 */
function renderMonthCell(
  cell: { date: string; inMonth: boolean },
  authorized: boolean,
  today: string,
  slots: Slot[],
): HTMLButtonElement {
  const btn = make(
    'button',
    `flex min-h-[3.25rem] flex-col items-stretch rounded-lg border p-1.5 text-left transition-colors sm:min-h-[4.5rem] ${
      cell.inMonth ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50' : 'border-transparent bg-slate-50/50'
    }`,
  );
  btn.type = 'button';
  btn.dataset.date = cell.date;
  if (!cell.inMonth) btn.classList.add('opacity-50');

  const { busy } = splitSlots(slots);

  const top = make('div', 'flex items-center justify-between gap-1');
  const dayNumber = Number(cell.date.slice(8));
  top.appendChild(
    make(
      'span',
      cell.date === today
        ? 'flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-semibold text-white'
        : 'text-[11px] font-medium text-slate-600 sm:text-xs',
      String(dayNumber),
    ),
  );
  if (busy.length) {
    top.appendChild(
      make(
        'span',
        'text-[9px] leading-none text-rose-400 sm:text-[10px]',
        busy.length > 3 ? '●●●+' : '●'.repeat(busy.length),
      ),
    );
  }
  btn.appendChild(top);

  // 手机屏幕太窄，活动名称只在 sm 以上显示
  if (authorized && busy[0]?.title) {
    btn.appendChild(make('span', 'mt-1 hidden truncate text-[10px] text-slate-500 sm:block', busy[0].title));
  } else if (!busy.length) {
    btn.appendChild(make('span', 'mt-1 hidden text-[10px] text-slate-300 sm:block', '空闲'));
  }

  return btn;
}

export function initApp(): void {
  const data = readData();

  const todayLine = byId<HTMLElement>('today-line');
  const dateLabel = byId<HTMLElement>('date-label');
  const datePicker = byId<HTMLInputElement>('date-picker');
  const navDay = byId<HTMLElement>('nav-day');
  const navRange = byId<HTMLElement>('nav-range');
  const rangeLabel = byId<HTMLElement>('range-label');
  const rangeSub = byId<HTMLElement>('range-sub');
  const timeline = byId<HTMLUListElement>('timeline');
  const weekView = byId<HTMLElement>('week-view');
  const monthGridEl = byId<HTMLElement>('month-grid');
  const monthView = byId<HTMLElement>('month-view');
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
    !data || !dateLabel || !datePicker || !timeline || !notice || !weekView || !monthView ||
    !monthGridEl || !navDay || !navRange || !rangeLabel || !prevButton || !nextButton ||
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
    const authorized = isAuthorized();
    const slots = buildTimeline(app.schedule, date, app.range);
    const { busy } = splitSlots(slots);

    timeline!.replaceChildren();
    for (const slot of slots) {
      timeline!.appendChild(renderSlot(slot, authorized));
    }

    if (busy.length) {
      notice!.textContent = `忙碌 ${formatDuration(totalMinutes(busy))}（${busy.length} 段安排）`;
      notice!.className = 'mb-3 text-xs text-slate-400';
    } else {
      notice!.textContent = date === today ? '今天没有安排 · 全天空闲' : '这一天没有安排 · 全天空闲';
      notice!.className =
        'mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm text-slate-500';
    }
  }

  function renderWeek(): void {
    const authorized = isAuthorized();
    weekView!.replaceChildren();
    for (const d of weekDates(date)) {
      weekView!.appendChild(renderWeekCard(d, authorized, today, buildTimeline(app.schedule, d, app.range)));
    }
  }

  function renderMonth(): void {
    const authorized = isAuthorized();
    monthGridEl!.replaceChildren();
    for (const cell of monthGrid(date)) {
      monthGridEl!.appendChild(
        renderMonthCell(cell, authorized, today, buildTimeline(app.schedule, cell.date, app.range)),
      );
    }
  }

  /** 导航栏中间的标题 + 前后按钮 */
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
      rangeSub!.textContent = '点击某一天查看当天详情';
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

  /** 视图切换按钮的高亮 */
  function renderViewButtons(): void {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const active = btn.dataset.view === view;
      btn.className = `rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`;
      btn.setAttribute('aria-pressed', String(active));
    }
    weekView!.hidden = view !== 'week';
    monthView!.hidden = view !== 'month';
    timeline!.hidden = view !== 'day';
  }

  /** 三种状态：访客条 / 展开的输入框 / 已授权条 */
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

  function render(): void {
    renderNav();
    renderViewButtons();
    renderDay();
    renderWeek();
    renderMonth();
    renderAuth();
  }

  /** 只重画内容，不动输入状态 */
  function renderContent(): void {
    renderNav();
    renderViewButtons();
    renderDay();
    renderWeek();
    renderMonth();
  }

  /* ---------------- 事件 ---------------- */

  // 视图切换
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    btn.addEventListener('click', () => {
      view = btn.dataset.view as View;
      renderContent();
    });
  }

  // 点周视图的某一天 / 月视图的某一格 -> 进入那天的日视图
  for (const container of [weekView, monthView]) {
    container.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-date]');
      if (!target?.dataset.date) return;
      date = target.dataset.date;
      view = 'day';
      renderContent();
    });
  }

  // 展开输入框
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

  // 提交姓名
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
      // 验证通过：记住姓名，下次打开直接显示具体日程
      name = value;
      hint = '';
      try {
        localStorage.setItem(STORAGE_KEY, name);
      } catch {
        /* 隐私模式下写不进去，忽略 */
      }
    } else {
      // 不在名单里：保持访客视图，给个提示，不记住
      name = '';
      hint = `未找到「${value}」，只能查看忙碌 / 空闲`;
    }

    formOpen = false;
    render();
  });

  // 退出授权，回到访客视图
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

  // 日期导航：步长跟着视图走
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
}
