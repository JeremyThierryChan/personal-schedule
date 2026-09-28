# Personal Schedule · 个人时间表

一个极简的静态「个人时间表」网站：**打开网页立刻就能看到忙碌 / 空闲时间**；在页面里输入姓名并验证通过后，才会显示**具体日程**。

- 技术栈：Astro + TypeScript + Tailwind CSS，纯静态，无后端 / 无数据库 / 无登录
- 部署：GitHub Pages（push 到 `main` 后由 GitHub Actions 自动构建部署）
- 平时只需要改两个文件：`src/data/schedule.json`、`src/data/visitors.json`

### 页面使用方式

1. 打开网站 → 直接看到时间表（只有「忙碌 / 空闲」，不需要输入任何东西）。
2. 想看到具体活动名称 → 点右上角的 **🔒 输入姓名** → 填名字 → 点「查看详细日程」。
3. 验证成功的姓名会记在浏览器本地（`localStorage`），下次打开直接显示具体日程；点 **退出** 可以回到访客视图。

### 三种视图

顶部 **日 / 周 / 月** 切换，都用同一个「锚点日期」，前后箭头按视图自动换步长（±1 天 / ±1 周 / ±1 月）：

| 视图 | 显示内容 | 前后箭头 |
| --- | --- | --- |
| **日** | 完整时间线：每一段忙碌 + 自动补齐的空闲 | ±1 天 |
| **周** | 一周 7 天（周一 → 周日），每天列出忙碌时段和空闲时段 | ±1 周 |
| **月** | 日历网格，有安排的日期显示圆点，没安排显示「空闲」 | ±1 月 |

- **周视图 / 月视图里点某一天，会跳到那天的日视图**（月视图点格子、周视图点整张卡片都行）。
- 周视图里，空闲时段也直接列出来，例如 `空闲 08:00–09:00 · 10:30–12:00 · 16:00–23:00`，不用自己算。
- 访客在周 / 月视图里同样只看得到「忙碌」，看不到活动名称。
- 离开今天所在的日 / 周 / 月时，会出现「回到今天」按钮。
- 月视图里，手机屏幕太窄，每格只显示日期和圆点；电脑上会额外显示第一个活动名称。

---

## 1. 本地运行

```bash
npm install
npm run dev        # http://localhost:4321
```

其他命令：

```bash
npm run build      # 类型检查 + 构建到 dist/
npm run preview    # 本地预览构建结果
```

---

## 2. 修改日程：`src/data/schedule.json`

**只写「忙碌」的时段**，空闲时间会自动算出来。

```json
[
  {
    "date": "2026-09-28",
    "start": "09:00",
    "end": "10:30",
    "title": "数学辅导"
  }
]
```

| 字段 | 说明 |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `start` / `end` | `HH:MM`，24 小时制 |
| `title` | 活动名称，**只有授权访客能看到**；访客只会看到「忙碌」 |

空闲时间自动计算示例（一天默认 `08:00–23:00`）：

```
写入：09:00-10:30 数学辅导、14:00-16:00 项目工作
自动生成：
  08:00-09:00  空闲
  09:00-10:30  数学辅导      （访客看到「忙碌」）
  10:30-14:00  空闲
  14:00-16:00  项目工作      （访客看到「忙碌」）
  16:00-23:00  空闲
```

注意：

- 一天没有写任何日程时，页面显示「今天没有安排 · 全天空闲」。
- 超出 `08:00–23:00` 的时段会被裁剪掉（例如写 `22:00-23:30`，只会显示到 `23:00`）。
  想改这个范围：打开 `src/pages/index.astro`，改顶部的 `const range = { start: '08:00', end: '23:00' }`。
- 两个时段首尾相接（`12:00-14:00` + `14:00-16:00`）会显示成两行；真正重叠的时段会自动合并。

---

## 3. 修改授权名单：`src/data/visitors.json`

```json
[
  { "name": "Jeremy", "level": "full" },
  { "name": "Alice", "level": "full" }
]
```

- 在名单里 → 能看到具体日程（`level: "full"`）
- 不在名单里 / 名字打错 → 只能看到「忙碌 / 空闲」
- 姓名匹配会忽略大小写和首尾空格（`jeremy`、` jeremy ` 都算 Jeremy）

---

## 4. 部署到 GitHub Pages

### 第一次

这个仓库已经配置好了：代码已推送，GitHub Pages 的 **Source 已设为 GitHub Actions**。

如果以后换了仓库，手动做两件事：

1. 新建仓库，仓库名要和 `.github/workflows/deploy.yml` 里的 `BASE_PATH` 一致（当前是 `/personal-schedule`）。
2. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。

### 之后更新网站（平时只需要这三行）

```bash
git add .
git commit -m "update schedule"
git push
```

推送后 GitHub Actions 会自动：`安装依赖 → astro build → 发布到 GitHub Pages`。
大约 1 分钟后刷新 `https://jeremythierrychan.github.io/personal-schedule/` 即可看到更新（也可以在仓库的 **Actions** 标签页看构建进度）。

> 换仓库名 / 换用户名：修改 `.github/workflows/deploy.yml` 里的 `BASE_PATH: /仓库名`，以及 `astro.config.mjs` 里的 `site`。

---

## 5. ⚠️ 重要限制（请务必读一下）

这是一个**半公开**的静态网站，姓名判断只是前端的显示逻辑，**不是真正的安全认证**：

- 所有日程数据（包括 `title`）都在页面源码里，懂技术的人打开「查看网页源代码」就能看到全部日程。
- 因此**不要在 `src/data/schedule.json` 里写高度敏感的私人信息**。

如果需要真正的访问控制，就必须要有后端或登录系统，那超出了本项目（纯静态）的范围。

---

## 6. 项目结构

```
├── .github/workflows/deploy.yml   # GitHub Actions：自动构建并部署到 Pages
├── public/.nojekyll               # 防止 GitHub Pages 的 Jekyll 忽略 _astro 目录
├── src
│   ├── data
│   │   ├── schedule.json          # ← 你平时改这里（忙碌日程）
│   │   └── visitors.json          # ← 你平时改这里（授权名单）
│   ├── lib
│   │   ├── schedule.ts            # 时间计算：忙碌/空闲时间线、日期工具
│   │   └── access.ts              # 姓名判断：full / guest
│   ├── scripts/app.ts             # 页面交互：输入姓名、切换日期、渲染时间线
│   ├── pages/index.astro          # 首页（唯一的页面）
│   └── styles/global.css          # Tailwind 入口
├── astro.config.mjs
└── package.json
```

## 7. 可以进一步优化的方向（现在都没做）

- 「复制空闲时间」「一键导出 .ics 日历」
- 用时间轴小时刻度（刻度尺）代替卡片列表，视觉上更直观
- 周视图画成 7 列的时间网格（现在是每天一张卡片的列表，手机上更好读）
- 给 `visitors.json` 加过期时间（例如某人的授权只到某个日期）
- 想提高一点门槛：把 `title` 用简单口令加密（AES），只有输入正确姓名时才在浏览器里解密 —— 但**仍然不是真正的安全**，前端密钥终究能被看到
- 把真实日程换成从 Google Calendar 导出的 `.ics` 自动生成 `schedule.json`（在 Actions 里跑一个脚本）
