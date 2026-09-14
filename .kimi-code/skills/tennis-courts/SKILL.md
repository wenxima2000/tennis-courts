---
name: tennis-courts
description: 查看悉尼网球场空闲时段（Centennial Park / Moore Park / Jensens 各场地 / Sydney Uni Sport，intrac 和 PerfectMind 预订系统）
whenToUse: 当用户想查网球场有没有空位、什么时候空闲、订场前查看可订时段时使用
arguments:
  - date
  - site
  - location
  - days
---

用户想查看网球场空闲情况。运行项目根目录下的脚本：

```bash
node check-courts.mjs [--date YYYY-MM-DD] [--site parklands|jensens|susf|all] [--location <名称>] [--days N] [--headless]
```

参数说明：
- `--date`：悉尼当地日期，默认今天。用户说"明天"就换算成对应日期。
- `--site`：`parklands`（Centennial Park / Moore Park）、`jensens`（Surry Hills、Alexandria、Beaconsfield、Glebe、Rosebery）、`susf`（悉尼大学 Sports and Aquatic Centre 的 6 片网球场），默认 `all`。
- `--location`：按名称模糊过滤场地，如 `--location alexandria`。
- `--days`：连续查几天，默认 1。
- `--headless`：无窗口运行。Parklands 和 SUSF 总是可以无头；Jensens 需要登录，只有在会话还有效时才能无头。

行为要点：
- 两个 intrac 站都在 AWS WAF 后面，必须用脚本里的 Playwright 浏览器，不要用 curl/FetchURL。
- SUSF（susf.perfectmind.com）是 PerfectMind 系统，用 config.json 里的 `susfEmail`/`susfPassword` 自动登录，无人工介入；未登录也能查但时段可能不全。
- Jensens 登录有 reCAPTCHA，自动提交常被拦。脚本会从 `config.json`（或环境变量 `INTRAC_FAMILY_NAME` / `INTRAC_EMAIL`）读取账号并自动填写提交；若被拦，会弹出浏览器窗口等用户手动点 "Log In"（会话保存在 .browser-profile/，之后很长一段时间不用再登）。此时请告诉用户去弹窗里点一下登录。
- 用户参数：$ARGUMENTS
- 运行完把输出整理成简洁的中文结果报给用户，按场地和时段列出空闲时间；用户通常关心黄金时段（工作日 18:00 后、周末白天），可以顺带指出。
- 如果脚本报错，先看项目根目录的 `debug-<site>.png` 截图诊断。
