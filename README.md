# tennis-courts

查看悉尼网球场空闲时段的小工具。基于 Playwright 自动打开 intrac 预订网站，抓取各球场的可订时段。

覆盖场地：

- **Centennial Parklands**（parklands.intrac.com.au）：Centennial Park - Tennis、Moore Park - Tennis
- **Jensen's Tennis / City Community Tennis**（jensenstennis.intrac.com.au）：Surry Hills、Alexandria、Beaconsfield、Glebe、Rosebery
- **Sydney Uni Sport**（susf.perfectmind.com）：Tennis Hard Court 1–3、Tennis Synthetic Court 4–6（Sports and Aquatic Centre）

## 安装

需要 Node.js 18+：

```bash
git clone https://github.com/wenxima2000/tennis-courts.git
cd tennis-courts
npm install
npx playwright install chromium
```

## 配置账号

Parklands 不登录也能查；Jensens 必须登录。复制配置文件并填入你在 intrac 注册的姓和邮箱（没有密码，登录靠邮箱 + 人机验证）：

```bash
cp config.example.json config.json   # 然后编辑 config.json
```

也可以用环境变量：`INTRAC_FAMILY_NAME` 和 `INTRAC_EMAIL`。

Sydney Uni Sport 用邮箱+密码登录（可选，不配置也能匿名查，但登录后看到的可订时段更全）：`susfEmail` / `susfPassword` 或环境变量 `SUSF_EMAIL` / `SUSF_PASSWORD`。

## 使用

```bash
node check-courts.mjs                        # 所有场地，今天
node check-courts.mjs --date 2026-09-16      # 指定日期（悉尼时区）
node check-courts.mjs --days 3               # 从今天起连查 3 天
node check-courts.mjs --site parklands       # 只查 Parklands
node check-courts.mjs --location alexandria  # 按名称过滤场地
node check-courts.mjs --headless             # 不弹浏览器窗口（Jensens 需登录态有效）
```

输出示例：

```
== Jensen's Tennis — Alexandria (Wed, 16 Sept 2026) ==
  Court 1: 06:00-09:30, 12:00-14:00 free
  Court 2: no free slots
```

## 首次登录说明

Jensens 的登录有无形 reCAPTCHA。第一次运行时脚本会弹出浏览器窗口、自动填好账号并尝试提交；如果被人机验证拦住，**在弹窗里手动点一下 "Log In"** 即可（脚本会等你 5 分钟）。登录态保存在 `.browser-profile/` 目录，之后运行不用再登录，可以直接加 `--headless`。

SUSF 是普通的邮箱+密码登录，脚本会自动完成，无需人工介入。

## 注意

- 两个 intrac 网站在 AWS WAF 后面，脚本已做对应处理（真实浏览器 + 常规 UA），不要用 curl 直接抓。
- 别把 `config.json` 和 `.browser-profile/` 提交进 git（已在 .gitignore 里）。
- 仅查看空闲情况，不会帮你下单订场。
