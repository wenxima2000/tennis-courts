#!/usr/bin/env node
// check-courts.mjs — check tennis court availability on intrac booking sites.
//
// Usage:
//   node check-courts.mjs [--date YYYY-MM-DD] [--site parklands|jensens|all]
//                         [--location <name>] [--days N] [--headless]
//
// Notes:
// - Both sites sit behind AWS WAF; headless Chromium gets a hard 403, so the
//   script runs HEADED by default (a browser window briefly appears).
// - A persistent profile in .browser-profile/ keeps the WAF clearance cookie
//   and the "Remember me" login session across runs.

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const PROFILE_DIR = path.resolve('.browser-profile');

// Credentials: copy config.example.json to config.json, or set env vars.
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')); } catch {}
const FAMILY_NAME = process.env.INTRAC_FAMILY_NAME || cfg.familyName;
const EMAIL = process.env.INTRAC_EMAIL || cfg.email;

const SITES = {
  parklands: {
    name: 'Centennial Parklands Sports Centre',
    url: 'https://parklands.intrac.com.au/dashboard?page=space&location_id=',
    // location filter: only tennis locations
    locationFilter: (name) => /tennis/i.test(name),
  },
  jensens: {
    name: "Jensen's Tennis",
    url: 'https://jensenstennis.intrac.com.au/dashboard?page=space&location_id=',
    locationFilter: (name) => !/table tennis/i.test(name),
  },
};

// ---------- CLI args ----------
function parseArgs() {
  const a = process.argv.slice(2);
  const opt = { date: null, site: 'all', location: null, days: 1, headless: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--date') opt.date = a[++i];
    else if (a[i] === '--site') opt.site = a[++i];
    else if (a[i] === '--location') opt.location = a[++i];
    else if (a[i] === '--days') opt.days = parseInt(a[++i], 10);
    else if (a[i] === '--headless') opt.headless = true;
    else { console.error(`Unknown arg: ${a[i]}`); process.exit(2); }
  }
  if (!opt.date) {
    // today in Sydney
    opt.date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opt.date)) { console.error('--date must be YYYY-MM-DD'); process.exit(2); }
  return opt;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  return new Date(iso + 'T12:00:00+10:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
}

// ---------- helpers ----------
async function waitForApp(page, timeoutMs = 90000) {
  // Wait out the AWS WAF JS challenge + SPA boot: poll until we see real content.
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const state = await page.evaluate(() => ({
      title: document.title,
      len: document.body ? document.body.innerText.trim().length : 0,
      hasDropdown: !!document.querySelector('a.dropdown-item'),
      hasLogin: /Family name/i.test(document.body?.innerText || ''),
    })).catch(() => null);
    if (state && !/403|forbidden/i.test(state.title) && state.len > 30 && (state.hasDropdown || state.hasLogin)) return state;
    await page.waitForTimeout(3000);
  }
  throw new Error('Timed out waiting for site to load (WAF challenge not cleared?)');
}

async function ensureLogin(page, siteKey) {
  const isLogin = await page.evaluate(() => /Family name/i.test(document.body.innerText) && /Log In/i.test(document.body.innerText));
  if (!isLogin) return false;
  console.log(`[${siteKey}] login form detected, logging in...`);
  let submitted = false;
  if (FAMILY_NAME && EMAIL) {
    // Find the Family name + Email/Mobile inputs by their associated labels/text.
    const filled = await page.evaluate(({ family, email }) => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
      const inputs = [...document.querySelectorAll('input')].filter(i => vis(i) && ['text', 'email', 'tel', ''].includes(i.type));
      const labelFor = (input) => {
        let t = input.placeholder || '';
        let e = input.parentElement;
        for (let d = 0; e && d < 4; d++, e = e.parentElement) t += ' ' + (e.innerText || '');
        return t;
      };
      const fam = inputs.find(i => /family name/i.test(labelFor(i)));
      const em = inputs.find(i => /email or mobile/i.test(labelFor(i)));
      if (!fam || !em) return { ok: false, fam: !!fam, em: !!em };
      fam.value = family; fam.dispatchEvent(new Event('input', { bubbles: true })); fam.dispatchEvent(new Event('change', { bubbles: true }));
      em.value = email; em.dispatchEvent(new Event('input', { bubbles: true })); em.dispatchEvent(new Event('change', { bubbles: true }));
      const rem = document.querySelector('input#remember_me[type="checkbox"]');
      if (rem && !rem.checked) rem.click();
      return { ok: true };
    }, { family: FAMILY_NAME, email: EMAIL });
    if (!filled.ok) throw new Error(`Login form fields not found (family=${filled.fam}, email=${filled.em})`);
    // Click the Log In button
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a, input[type="submit"]')];
      const b = btns.find(x => /^\s*Log In\s*$/i.test(x.innerText || x.value || ''));
      if (b) b.click();
    });
    submitted = true;
    await page.waitForTimeout(10000);
  } else {
    console.log(`[${siteKey}] 未配置账号（config.json 或 INTRAC_FAMILY_NAME/INTRAC_EMAIL），请在浏览器窗口里手动登录。`);
  }
  let stillLogin = await page.evaluate(() => /Family name/i.test(document.body.innerText));
  if (stillLogin) {
    // reCAPTCHA may block the automated submit — let the user click Log In once.
    // The session persists in .browser-profile, so this is only needed occasionally.
    if (submitted) console.log(`[${siteKey}] 自动提交未通过人机验证。`);
    console.log(`[${siteKey}] 请在浏览器窗口里点击 "Log In"（必要时完成人机验证），等待最多 5 分钟…`);
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60 * 1000) {
      await page.waitForTimeout(2000);
      stillLogin = await page.evaluate(() => /Family name/i.test(document.body?.innerText || '')).catch(() => false);
      if (!stillLogin) break;
    }
  }
  if (stillLogin) throw new Error('Login failed — form still visible after submit');
  await waitForApp(page);
  console.log(`[${siteKey}] logged in.`);
  return true;
}

async function getLocations(page, site) {
  return page.evaluate(() => [...document.querySelectorAll('a.dropdown-item')]
    .map(a => ({ name: a.textContent.trim(), id: a.dataset.intrac }))
    .filter(l => l.id));
}

async function loadGrid(page, baseUrl, locationId, dateIso) {
  await page.goto(`${baseUrl}${locationId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForApp(page);
  await page.waitForSelector('div.grid_view table tbody tr', { state: 'attached', timeout: 60000 });

  // Set the date via the flatpickr instance backing #calendar_main.
  await page.evaluate(async (iso) => {
    const fp = document.querySelector('#calendar_main')?._flatpickr;
    if (fp) fp.setDate(iso, true);
  }, dateIso);

  // Wait until the grid reflects the requested date.
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const cur = await page.evaluate(() => document.querySelector('#main_date')?.value || document.querySelector('#calendar_main')?.value);
    if (cur === dateIso) {
      // give the AJAX grid refresh a moment, then confirm rows exist
      await page.waitForTimeout(2500);
      const ok = await page.evaluate(() => !!document.querySelector('div.grid_view table tbody td.cell-many'));
      if (ok) return;
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(`Grid did not load for date ${dateIso}`);
}

async function extractAvailability(page) {
  return page.evaluate(() => {
    const table = document.querySelector('div.grid_view table');
    if (!table) return null;
    const interval = parseInt(table.dataset.intrac_interval || '30', 10);
    const courts = [...table.querySelectorAll('thead th.courts-many span.space_id')].map(s => s.textContent.trim());
    const free = courts.map(() => []); // per-court list of "HH:MM" start times
    for (const tr of table.querySelectorAll('tbody tr')) {
      const timeTxt = tr.querySelector('.time-column-many .time-shadow-wrapper')?.textContent.trim();
      if (!timeTxt) continue;
      const m = timeTxt.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) continue;
      let hh = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) hh += 12;
      const start = `${String(hh).padStart(2, '0')}:${m[2]}`;
      const cells = [...tr.querySelectorAll('td.cell-many')];
      cells.forEach((td, i) => {
        const box = td.querySelector('.section-box');
        if (!box) return;
        // booked/unavailable cells carry the "blocked" class (or no booking affordance)
        const isFree = !box.classList.contains('blocked') && /Book for/i.test(box.textContent);
        if (isFree && i < free.length) free[i].push(start);
      });
    }
    return { interval, courts, free };
  });
}

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

function mergeRanges(times, interval) {
  const mins = [...new Set(times.map(toMin))].sort((a, b) => a - b);
  const ranges = [];
  for (const t of mins) {
    const last = ranges[ranges.length - 1];
    if (last && t === last.end) last.end = t + interval;
    else ranges.push({ start: t, end: t + interval });
  }
  return ranges.map(r => `${toHHMM(r.start)}-${toHHMM(r.end)}`);
}

// ---------- main ----------
const opt = parseArgs();
const siteKeys = opt.site === 'all' ? Object.keys(SITES) : [opt.site];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: opt.headless,
  chromiumSandbox: false,
  args: ['--disable-blink-features=AutomationControlled'],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1400, height: 900 },
});
const page = ctx.pages()[0] || await ctx.newPage();

let failures = 0;
for (const key of siteKeys) {
  const site = SITES[key];
  if (!site) { console.error(`Unknown site: ${key}`); continue; }
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForApp(page);
    await ensureLogin(page, key);

    let locations = (await getLocations(page, site)).filter(l => site.locationFilter(l.name));
    if (opt.location) locations = locations.filter(l => l.name.toLowerCase().includes(opt.location.toLowerCase()));
    if (!locations.length) throw new Error('No matching locations found');

    for (const loc of locations) {
      for (let d = 0; d < opt.days; d++) {
        const date = addDays(opt.date, d);
        await loadGrid(page, site.url, loc.id, date);
        const data = await extractAvailability(page);
        console.log(`\n== ${site.name} — ${loc.name} (${prettyDate(date)}) ==`);
        if (!data) { console.log('  (no grid found)'); continue; }
        data.courts.forEach((court, i) => {
          const ranges = mergeRanges(data.free[i], data.interval);
          console.log(`  ${court}: ${ranges.length ? ranges.join(', ') + ' free' : 'no free slots'}`);
        });
      }
    }
  } catch (err) {
    failures++;
    console.error(`\n[${key}] ERROR: ${err.message}`);
    try {
      await page.screenshot({ path: `debug-${key}.png`, fullPage: true });
      console.error(`[${key}] screenshot saved to debug-${key}.png`);
    } catch {}
  }
}

await ctx.close();
process.exit(failures ? 1 : 0);
