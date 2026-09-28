// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本地开发用 "/"，GitHub Actions 构建时用 "/personal-schedule/"
const base = process.env.BASE_PATH || '/';

const CALENDAR_DIR = fileURLToPath(new URL('./日历', import.meta.url));
const SCHEDULE_JSON = fileURLToPath(new URL('./src/data/schedule.json', import.meta.url));

/**
 * 「日历」文件夹里所有 .ics 的指纹（文件名 + 大小 + 修改时间）。
 * 文件系统可能对同一次保存发出好几个事件，靠它来判断是不是真的有变化。
 */
function calendarSignature() {
  if (!existsSync(CALENDAR_DIR)) return '';
  return readdirSync(CALENDAR_DIR)
    .filter((f) => f.toLowerCase().endsWith('.ics'))
    .sort()
    .map((f) => {
      const stat = statSync(join(CALENDAR_DIR, f));
      return `${f}:${stat.size}:${stat.mtimeMs}`;
    })
    .join('|');
}

/**
 * 开发用的小插件：盯着「日历」文件夹，一有新文件或文件被改动，
 * 就自动重新跑一遍导入脚本，页面跟着刷新。
 *
 * 只在 `npm run dev` 时生效（astro:server:setup 是 dev 专属钩子），
 * 不会影响 GitHub Actions 的构建。
 *
 * 注意：只在 .ics 真的变化时才导入 ——
 * 手动改过 schedule.json 的话，不会在你启动 dev 时被覆盖。
 */
function watchCalendarFolder() {
  return {
    name: 'watch-calendar-folder',
    hooks: {
      /** @param {{ server: any, logger: any }} ctx */
      'astro:server:setup': ({ server, logger }) => {
        if (!existsSync(CALENDAR_DIR)) return;

        server.watcher.add(CALENDAR_DIR);
        logger.info('正在监听「日历」文件夹，.ics 有变化会自动重新导入');

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        let lastSignature = calendarSignature();
        server.watcher.on('all', (
          /** @type {string} */ event,
          /** @type {string} */ filePath,
        ) => {
          if (typeof filePath !== 'string' || !filePath.startsWith(CALENDAR_DIR)) return;
          if (!filePath.toLowerCase().endsWith('.ics')) return;

          clearTimeout(timer);
          timer = setTimeout(() => {
            // 一次保存往往触发好几个事件，指纹没变就跳过，避免重复导入
            const signature = calendarSignature();
            if (signature === lastSignature) return;
            lastSignature = signature;

            const before = existsSync(SCHEDULE_JSON) ? readFileSync(SCHEDULE_JSON, 'utf8') : '';
            logger.info(`「日历」有变化（${event}），重新导入…`);

            const result = spawnSync(process.execPath, ['scripts/import-ics.mjs'], {
              cwd: process.cwd(),
              encoding: 'utf8',
            });
            const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
            if (output) for (const line of output.split('\n')) logger.info(line);

            if (result.status !== 0) {
              logger.error('导入失败，schedule.json 没有变动');
              return;
            }

            const after = readFileSync(SCHEDULE_JSON, 'utf8');
            if (after === before) {
              logger.info('导入完成，日程没有变化');
              return;
            }
            logger.info('日程已更新，刷新页面');
            server.ws.send({ type: 'full-reload' });
          }, 300); // 防抖：一次保存可能触发多个事件
        });
      },
    },
  };
}

export default defineConfig({
  site: 'https://jeremythierrychan.github.io',
  base,
  integrations: [watchCalendarFolder()],
  vite: {
    plugins: [tailwindcss()],
  },
});
