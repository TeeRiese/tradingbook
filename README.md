<div align="center">

<img src="screenshots/dashboard-en.png" alt="TradingBook dashboard" width="800">

# TradingBook

**A local-first trading journal that never leaves your machine.**

No account. No cloud. No install. Your trade history lives in a single JSON file you control.

[![Live Demo](https://img.shields.io/badge/demo-trading--book.de-6c8cff?style=flat-square)](https://trading-book.de)
[![License: MIT](https://img.shields.io/badge/license-MIT-22e0c2?style=flat-square)](LICENSE)
[![No build step](https://img.shields.io/badge/build_step-none-eef1f5?style=flat-square)](#tech-stack)

[**🚀 Try it live**](https://trading-book.de) · [Deutsche Version](README.de.md) · [Features](#features) · [Quick start](#quick-start)

</div>

---

## Why TradingBook

Most trading journals are SaaS products: you sign up, they host your trade history, and you hope they stay in business. TradingBook takes the opposite approach — it's a single static web page. Open it in your browser, pick (or create) a JSON file on your disk, and that file *is* your database. Nothing is ever uploaded anywhere. Close the tab, and your data is exactly where you left it, on your own hard drive.

- **Private by construction** — there's no server for your data to go to. Everything runs client-side in the browser.
- **No install, no build step** — it's plain HTML/CSS/JavaScript. Open `index.html`, or just use the [hosted version](https://trading-book.de).
- **Your file, your rules** — a portable `.json` you can back up, version, sync, or inspect yourself at any time.
- **Bilingual** — full German/English UI, switchable instantly, no reload.

## Features

- **Dashboard** — total P&L, win rate, profit factor, expectancy, max drawdown, margin in use, an equity curve, and a rolling list of recent trades.
- **Trades table** — sortable, filterable (symbol, tag, direction, status, date range), paginated — stays fast even at tens of thousands of trades.
- **Statistics** — a date-range filter, a GitHub-style P&L calendar heatmap, breakdowns by symbol/tag/weekday, a P&L distribution chart, and R-multiple per trade (for trades with a stop-loss set).
- **Monthly goal tracking** — set a target return %, watch progress with a month-by-month history over the last 24 months.
- **Leverage & risk tools** — track leverage or a manual margin per trade (fits CFD/Forex/crypto-margin *and* futures/options), with an approximate liquidation price and automatic warnings when a stop-loss sits past it or leverage runs high.
- **Fees, tracked everywhere** — every P&L figure (dashboard, equity curve, drawdown, calendar, goal tracking, R-multiples) is net of fees, not just the raw price move.
- **Mobile-ready** — on phones the UI switches to a bottom tab bar, trade cards instead of a wide table, a filter sheet and a full-screen trade form; saving goes through the share sheet ("Save to Files").
- **Undo-friendly** — deleting a trade shows a toast with an undo option instead of a confirmation dialog.

## Screenshots

<table>
<tr>
<td><img src="screenshots/dashboard-de.png" alt="Dashboard"></td>
<td><img src="screenshots/trades-de.png" alt="Trades table"></td>
</tr>
<tr>
<td><img src="screenshots/stats-de.png" alt="Statistics"></td>
<td><img src="screenshots/dashboard-en.png" alt="Dashboard, English"></td>
</tr>
</table>

## Quick start

**Use it hosted, no download needed:** [**trading-book.de**](https://trading-book.de) — your data still never leaves your browser; the site just serves the static files.

**Or run it yourself:**

```bash
git clone https://github.com/TeeRiese/tradingbook.git
cd tradingbook/app
python3 -m http.server 8080   # any static file server works
```

Then open `http://localhost:8080` in Chrome or Edge. (Opening `app/index.html` directly via `file://` also works, but a couple of browser features — like reconnecting to a file automatically after a reload — need a real HTTP origin.)

A sample dataset (`app/data/beispiel.json`, ~5,000 trades) is included — pick it from the "Open existing file" screen to explore the app with realistic data before entering your own.

## Browser support

Full functionality (direct read/write to your file, no download prompts) needs the **File System Access API** — currently **Chrome or Edge**. Safari and Firefox work too, with saving falling back to a regular file download instead of an in-place write. On phones, saving opens the system share sheet where supported, and your session is additionally cached in the browser — export your file regularly.

## Tech stack

Vanilla HTML/CSS/JavaScript, no framework, no build step, one vendored dependency ([Chart.js](https://www.chartjs.org/)).

## License

[MIT](LICENSE) — do what you like with it.
