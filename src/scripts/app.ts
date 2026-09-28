/**
 * 首页交互逻辑（纯浏览器端）
 *
 * 设计原则：打开页面立刻能看到时间表（忙碌 / 空闲），不需要先输入姓名。
 * 姓名验证是「可选」的一步：验证通过后才把「忙碌」换成具体活动名称。
 */
import { resolveLevel, type Visitor } from '../lib/access';
import {
  buildTimeline,
  formatDateLabel,
  hasSchedule,
  isValidDateKey,
  shiftDateKey,
  todayKey,
  type BusyEntry,
  type DayRange,
} from '../lib/schedule';

interface AppData {
  schedule: BusyEntry[];
  visitors: Visitor[];
  range: DayRange;
}

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

const BASE_ROW = 'flex items-stretch gap-3 rounded-xl border p-3 sm:gap-4 sm:p-4 transition-colors';

/** 生成一行时间线 */
function renderSlot(
  slot: { start: string; end: string; busy: boolean; title: string },
  authorized: boolean,
): HTMLLIElement {
  const li = make(
    'li',
    slot.busy
      ? `${BASE_ROW} border-slate-200 bg-white shadow-sm`
      : `${BASE_ROW} border-dashed border-slate-200 bg-white/50`,
  );

  // 左侧颜色条：忙碌 = 玫红，空闲 = 浅灰
  li.appendChild(make('span', `w-1.5 shrink-0 rounded-full ${slot.busy ? 'bg-rose-400' : 'bg-slate-200'}`));

  const body = make('div', 'min-w-0 flex-1');
  body.appendChild(
    make('div', 'font-mono text-xs tabular-nums text-slate-500 sm:text-sm', `${slot.start} – ${slot.end}`),
  );

  if (slot.busy) {
    body.appendChild(
      make(
        'div',
        'mt-1 truncate text-base font-medium text-slate-900 sm:text-lg',
        authorized ? slot.title : '忙碌',
      ),
    );
    body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', authorized ? '安排' : '这段时间没空'));
  } else {
    body.appendChild(make('div', 'mt-1 text-base font-medium text-slate-400 sm:text-lg', '空闲'));
    body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', '可以约'));
  }

  li.appendChild(body);
  return li;
}

export function initApp(): void {
  const data = readData();

  const todayLine = byId<HTMLElement>('today-line');
  const dateLabel = byId<HTMLElement>('date-label');
  const datePicker = byId<HTMLInputElement>('date-picker');
  const timeline = byId<HTMLUListElement>('timeline');
  const notice = byId<HTMLElement>('notice');
  const todayButton = byId<HTMLButtonElement>('today-button');

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
    !data || !dateLabel || !datePicker || !timeline || !notice ||
    !authGuest || !authFull || !guestHint || !authToggle || !form || !input
  ) {
    return;
  }

  const today = todayKey();
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

  const isAuthorized = (): boolean => name.trim() !== '' && resolveLevel(name, data.visitors) === 'full';

  // 用浏览器本地日期覆盖构建时写死的日期
  if (todayLine) todayLine.textContent = formatDateLabel(today);

  function renderTimeline(): void {
    const authorized = isAuthorized();
    timeline!.replaceChildren();
    for (const slot of buildTimeline(data!.schedule, date, data!.range)) {
      timeline!.appendChild(renderSlot(slot, authorized));
    }

    if (hasSchedule(data!.schedule, date)) {
      notice!.textContent = '';
      notice!.className = 'hidden';
    } else {
      notice!.textContent = date === today ? '今天没有安排 · 全天空闲' : '这一天没有安排 · 全天空闲';
      notice!.className =
        'mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm text-slate-500';
    }
  }

  function renderHeader(): void {
    dateLabel!.textContent = formatDateLabel(date);
    datePicker!.value = date;
    if (todayButton) todayButton.hidden = date === today;
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
    renderHeader();
    renderTimeline();
    renderAuth();
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

    if (resolveLevel(value, data.visitors) === 'full') {
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

  // 日期切换
  byId<HTMLButtonElement>('prev-day')?.addEventListener('click', () => {
    date = shiftDateKey(date, -1);
    renderHeader();
    renderTimeline();
  });

  byId<HTMLButtonElement>('next-day')?.addEventListener('click', () => {
    date = shiftDateKey(date, 1);
    renderHeader();
    renderTimeline();
  });

  datePicker.addEventListener('change', () => {
    if (isValidDateKey(datePicker.value)) {
      date = datePicker.value;
      renderHeader();
      renderTimeline();
    } else {
      datePicker.value = date;
    }
  });

  todayButton?.addEventListener('click', () => {
    date = today;
    renderHeader();
    renderTimeline();
  });

  render();
}
