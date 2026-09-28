/**
 * 首页交互逻辑（纯浏览器端）
 *
 * 只做三件事：
 * 1. 读取页面里内嵌的 schedule.json / visitors.json
 * 2. 根据输入的姓名决定显示「忙碌/空闲」还是「具体日程」
 * 3. 处理日期切换
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

const BASE_ROW =
  'flex items-stretch gap-3 rounded-xl border p-3 sm:gap-4 sm:p-4 transition-colors';

/** 生成一行时间线 */
function renderSlot(slot: { start: string; end: string; busy: boolean; title: string }, authorized: boolean): HTMLLIElement {
  const li = make('li', slot.busy ? `${BASE_ROW} border-slate-200 bg-white shadow-sm` : `${BASE_ROW} border-dashed border-slate-200 bg-white/50`);

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
    if (authorized) {
      body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', '安排'));
    } else {
      body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', '这段时间没空'));
    }
  } else {
    body.appendChild(make('div', 'mt-1 text-base font-medium text-slate-400 sm:text-lg', '空闲'));
    body.appendChild(make('div', 'mt-0.5 text-xs text-slate-400', '可以约'));
  }

  li.appendChild(body);
  return li;
}

export function initApp(): void {
  const data = readData();
  const result = byId<HTMLElement>('result');
  const emptyState = byId<HTMLElement>('empty-state');
  const form = byId<HTMLFormElement>('name-form');
  const input = byId<HTMLInputElement>('name-input');
  const error = byId<HTMLElement>('name-error');
  const dateLabel = byId<HTMLElement>('date-label');
  const datePicker = byId<HTMLInputElement>('date-picker');
  const timeline = byId<HTMLUListElement>('timeline');
  const badge = byId<HTMLElement>('badge');
  const notice = byId<HTMLElement>('notice');
  const todayButton = byId<HTMLButtonElement>('today-button');

  if (!data || !result || !emptyState || !form || !input || !dateLabel || !datePicker || !timeline || !badge || !notice) {
    return;
  }

  const today = todayKey();
  let date = today;
  let name = '';

  // 用浏览器本地日期覆盖构建时写死的日期
  const todayLine = byId<HTMLElement>('today-line');
  if (todayLine) todayLine.textContent = formatDateLabel(today);

  try {
    name = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    name = '';
  }
  if (name) input.value = name;

  function renderTimeline(): void {
    const authorized = name.trim() !== '' && resolveLevel(name, data!.visitors) === 'full';
    const slots = buildTimeline(data!.schedule, date, data!.range);

    timeline!.replaceChildren();
    for (const slot of slots) {
      timeline!.appendChild(renderSlot(slot, authorized));
    }

    if (hasSchedule(data!.schedule, date)) {
      notice!.textContent = '';
      notice!.className = 'hidden';
    } else {
      notice!.textContent = date === today ? '今天没有安排 · 全天空闲' : '这一天没有安排 · 全天空闲';
      notice!.className =
        'mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 text-center';
    }
  }

  function renderHeader(): void {
    dateLabel!.textContent = formatDateLabel(date);
    datePicker!.value = date;
    if (todayButton) todayButton.hidden = date === today;
  }

  function renderBadge(): void {
    const authorized = resolveLevel(name, data!.visitors) === 'full';
    if (authorized) {
      badge!.textContent = '已授权访客 · 可以看到具体日程';
      badge!.className =
        'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200';
    } else {
      badge!.textContent = '访客模式 · 只显示忙碌 / 空闲';
      badge!.className =
        'inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200';
    }
  }

  function show(): void {
    const submitted = name.trim() !== '';
    emptyState!.hidden = submitted;
    result!.hidden = !submitted;
    if (!submitted) return;
    renderBadge();
    renderHeader();
    renderTimeline();
  }

  // 输入姓名 -> 查看时间
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      if (error) {
        error.textContent = '请输入你的姓名';
        error.hidden = false;
      }
      input.focus();
      return;
    }
    if (error) error.hidden = true;
    name = value;
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      /* 忽略：隐私模式下无法写入 */
    }
    show();
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

  show();
}
