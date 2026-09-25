// App shell: state, view rendering, CRUD for trades, drawer form, filters.

const App = (() => {
  let book = null;
  let dirty = false;
  let currentView = 'dashboard';
  let editingId = null;
  let formTags = [];
  let filters = { search: '', symbol: '', tag: '', direction: '', status: '', from: '', to: '' };
  let statsFilter = { preset: 'all', from: '', to: '' };
  let tradesSort = { key: 'date', dir: 'desc' };
  let goalMonthOffset = 0;
  let tradesPage = 1;
  let filterSheetOpen = false; // phone-only bottom sheet holding the secondary trade filters
  let tradesPageSize = 50;
  let autosaveOk = true;
  let searchDebounceTimer = null;
  let backend = null; // optional external storage; see "Extension points" near the end of this file
  const settingsSections = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const icon = Icons.icon;
  const t = I18n.t;
  const fmtMoney = (v) => {
    const currency = book?.settings?.currency || 'EUR';
    return (v ?? 0).toLocaleString(I18n.locale(), { style: 'currency', currency, maximumFractionDigits: 2 });
  };
  const fmtPct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const fmtPrice = (v) => (v == null ? '–' : v.toLocaleString(I18n.locale(), { maximumFractionDigits: 4 }));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(I18n.locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'neutral');
  const uid = () => `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Everything that came from a file (symbols, tags, names, ids, even "numbers") is untrusted:
  // it is escaped wherever it is put into HTML and coerced to the expected types on load.
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  function sanitizeBook(b) {
    b.name = typeof b.name === 'string' ? b.name : 'Trading Book';
    b.tags = Array.isArray(b.tags) ? b.tags.map(String) : [];
    b.settings = (b.settings && typeof b.settings === 'object') ? b.settings : {};
    b.settings.startingCapital = numOrNull(b.settings.startingCapital) ?? 0;
    b.settings.currency = /^[A-Z]{3}$/.test(b.settings.currency) ? b.settings.currency : 'EUR'; // Intl throws on bad codes
    b.settings.monthlyGoalPct = numOrNull(b.settings.monthlyGoalPct);
    b.trades = Array.isArray(b.trades) ? b.trades.filter(tr => tr && typeof tr === 'object') : [];
    for (const tr of b.trades) {
      tr.id = tr.id == null ? uid() : String(tr.id);
      tr.symbol = String(tr.symbol ?? '');
      tr.direction = tr.direction === 'short' ? 'short' : 'long';
      tr.status = tr.status === 'open' ? 'open' : 'closed';
      tr.quantity = numOrNull(tr.quantity) ?? 0;
      tr.entryPrice = numOrNull(tr.entryPrice) ?? 0;
      tr.exitPrice = numOrNull(tr.exitPrice);
      tr.stopLoss = numOrNull(tr.stopLoss);
      tr.fees = numOrNull(tr.fees) ?? 0;
      tr.leverage = numOrNull(tr.leverage);
      tr.margin = numOrNull(tr.margin);
      tr.tags = Array.isArray(tr.tags) ? tr.tags.map(String) : [];
      tr.notes = String(tr.notes ?? '');
      tr.date = String(tr.date ?? '');
      tr.exitDate = tr.exitDate ? String(tr.exitDate) : null;
    }
    return b;
  }
  const tradeWord = (n) => (n === 1 ? t('common.trade') : t('common.trades'));

  // Group keys from Stats (weekday codes, '__untagged__', '__other__') are
  // locale-independent internal tokens — translate them here for display.
  // A real symbol/tag name passes through unchanged.
  const WEEKDAY_I18N_KEYS = { mon: 'weekday.mon', tue: 'weekday.tue', wed: 'weekday.wed', thu: 'weekday.thu', fri: 'weekday.fri', sat: 'weekday.sat', sun: 'weekday.sun' };
  function translateGroupKey(key) {
    if (key === '__other__') return t('common.other');
    if (key === '__untagged__') return t('common.noTag');
    if (WEEKDAY_I18N_KEYS[key]) return t(WEEKDAY_I18N_KEYS[key]);
    return key;
  }

  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = action
      ? `<span>${msg}</span><button type="button" class="toast-action" id="toast-action-btn">${action.label}</button>`
      : msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    if (action) {
      $('#toast-action-btn').onclick = () => {
        el.classList.remove('show');
        clearTimeout(toast._t);
        action.onClick();
      };
      toast._t = setTimeout(() => el.classList.remove('show'), 6000);
    } else {
      toast._t = setTimeout(() => el.classList.remove('show'), 2600);
    }
  }

  // Parsing/rendering a large book blocks the main thread with no other way
  // to show progress. Show the overlay, then wait two animation frames so the
  // browser actually paints it before the blocking work starts.
  function showLoading(text) {
    $('#loading-text').textContent = text;
    $('#loading-overlay').classList.add('show');
  }

  function hideLoading() {
    $('#loading-overlay').classList.remove('show');
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function markDirty() {
    dirty = true;
    if (backend) {
      // The backend owns persistence — deliberately no plaintext copy in localStorage.
      if (backend.onChange) backend.onChange(book);
    } else {
      const wasOk = autosaveOk;
      autosaveOk = Storage.cacheLocally(book);
      if (wasOk && !autosaveOk) {
        toast(t('app.autosaveFailed'));
      }
    }
    updateFileStatus();
  }

  function updateFileStatus(savedNow = false) {
    const wrap = $('#file-status');
    const text = $('#file-status-text');
    if (savedNow) {
      wrap.classList.remove('unsaved');
      text.textContent = t('app.savedAt', { time: new Date().toLocaleTimeString(I18n.locale(), { hour: '2-digit', minute: '2-digit' }) });
    } else if (dirty) {
      wrap.classList.add('unsaved');
      text.textContent = autosaveOk ? t('app.unsavedChanges') : t('app.unsavedAutosaveOff');
    } else {
      wrap.classList.remove('unsaved');
      text.textContent = t('app.ready');
    }
    wrap.title = text.textContent; // phones show only the dot; keep the text reachable
  }

  // ---------- i18n plumbing ----------

  // Translates every static (non-templated) piece of markup in index.html —
  // onboarding screen, sidebar nav, trade drawer form — via data-i18n(-*)
  // attributes. Dynamically rendered views (dashboard/trades/stats/settings)
  // just get rebuilt by their own render*() functions, which call t() fresh.
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  }

  function updateLangSwitchUI() {
    const lang = I18n.getLang();
    $$('[data-lang-switch] button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
      b.setAttribute('aria-label', t(b.dataset.lang === 'de' ? 'lang.switchToDe' : 'lang.switchToEn'));
    });
  }

  function bindLangSwitches() {
    $$('[data-lang-switch] button').forEach(b => {
      b.onclick = () => setLanguage(b.dataset.lang);
    });
  }

  function setLanguage(lang) {
    if (lang === I18n.getLang()) return;
    I18n.setLang(lang);
    document.documentElement.lang = lang;
    applyStaticI18n();
    updateLangSwitchUI();
    const resumeBtn = $('#btn-resume-session');
    if (resumeBtn) resumeBtn.innerHTML = `${icon('history', 'icon-xs')} ${t('app.resumeSession')}`;
    if (book) {
      updateBookNameDisplay();
      updateFileStatus();
      switchView(currentView);
      if ($('#trade-drawer').classList.contains('open')) {
        $('#drawer-title').textContent = editingId ? t('drawer.editTrade') : t('drawer.newTrade');
        updateLiqHint();
      }
    }
  }

  // ---------- Init / onboarding ----------

  function init() {
    document.documentElement.lang = I18n.getLang();
    applyStaticI18n();
    updateLangSwitchUI();
    bindLangSwitches();

    if (!Storage.supportsFSA) {
      $('#fsa-note').textContent = t('app.fsaNote');
    }
    // Cheap existence check only — no JSON.parse here, so this button shows
    // up immediately regardless of how large the cached book is. The actual
    // parse + render happens lazily on click, behind the loading overlay.
    if (Storage.hasLocalCache()) {
      const btn = document.createElement('button');
      btn.id = 'btn-resume-session';
      btn.className = 'btn btn-primary';
      btn.innerHTML = `${icon('history', 'icon-xs')} ${t('app.resumeSession')}`;
      btn.onclick = async () => {
        try {
          showLoading(t('loading.sessionLoading'));
          await nextPaint();
          const cached = Storage.readLocalCache();
          if (!cached) { toast(t('app.sessionLoadFailed')); return; }
          // Reconnect the on-disk file handle if one was stored (needs the
          // click's user gesture for the permission re-grant) so "Speichern"
          // writes straight back to the file instead of prompting again.
          const reconnectedName = await Storage.reconnectStoredHandle();
          loadBook(cached, true);
          if (reconnectedName) toast(t('app.reconnected', { name: esc(reconnectedName) }));
        } finally {
          hideLoading();
        }
      };
      $('#btn-open-file').classList.remove('btn-primary');
      $('#onboarding').insertBefore(btn, $('#btn-open-file'));
    }

    $('#btn-open-file').onclick = async () => {
      try {
        showLoading(t('loading.openingFile'));
        await nextPaint();
        const { data, fileName } = await Storage.openFile();
        showLoading(t('loading.bookLoading'));
        await nextPaint();
        loadBook(data, false, fileName);
      } catch (e) {
        if (e.name !== 'AbortError') toast(t('app.openFileFailed'));
      } finally {
        hideLoading();
      }
    };
    $('#btn-new-file').onclick = async () => {
      showLoading(t('loading.bookCreating'));
      await nextPaint();
      loadBook(Storage.emptyBook(), true);
      hideLoading();
    };

    $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    $('#btn-save').addEventListener('click', () => saveBook());
    $('#fab-add-trade').addEventListener('click', () => openDrawer());

    bindDrawer();

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function loadBook(data, unsavedByDefault = false, fileName = null) {
    book = sanitizeBook(data && typeof data === 'object' ? data : {});
    book.name ??= fileName || 'Trading Book';
    book.settings ??= { startingCapital: 10000, currency: 'EUR' };
    book.tags ??= [];
    book.trades ??= [];
    dirty = unsavedByDefault;
    tradesPage = 1;
    tradesSort = { key: 'date', dir: 'desc' };
    filters = { search: '', symbol: '', tag: '', direction: '', status: '', from: '', to: '' };
    statsFilter = { preset: 'all', from: '', to: '' };
    goalMonthOffset = 0;
    book.settings.monthlyGoalPct ??= null;
    // Cache immediately, not just on the first edit — keeps the autosave
    // cache in sync with whichever file/handle is currently active, so a
    // reload right after opening a file (before any edit) can't resume into
    // a stale cache from a previously opened book.
    autosaveOk = backend ? true : Storage.cacheLocally(book);
    $('#onboarding').style.display = 'none';
    $('#app').style.display = 'flex';
    updateBookNameDisplay();
    updateFileStatus();
    switchView('dashboard');
  }

  // The bundled demo files ship a fixed German `name` (data is data, not a UI
  // string) — map that one known literal back to a translated display name,
  // in whichever language is active. Any other name (the user's own, or one
  // they've since renamed via Settings) passes through unchanged.
  const DEMO_BOOK_NAME_KEYS = {
    'Beispiel Trading Book': 'demo.sampleBookName',
    'Stresstest (100.000 Trades)': 'demo.stressTestBookName',
  };
  function displayBookName(name) {
    return DEMO_BOOK_NAME_KEYS[name] ? t(DEMO_BOOK_NAME_KEYS[name]) : name;
  }

  function updateBookNameDisplay() {
    const name = displayBookName(book.name);
    document.title = `${name} – Trading Book`;
    $('#book-name-label').textContent = name;
  }

  async function saveBook(forcePicker = false) {
    if (backend) {
      try {
        await backend.save(book);
        dirty = false;
        updateFileStatus(true);
        toast(t('toast.bookSaved'));
      } catch (e) {
        toast(t('toast.saveFailed'));
      }
      return;
    }
    try {
      // Without the File System Access API, saving goes through the share
      // sheet, which must start inside the tap's user-activation window —
      // so skip the paint-wait there.
      if (Storage.supportsFSA) {
        showLoading(t('loading.saving'));
        await nextPaint();
      }
      await Storage.saveFile(book, forcePicker);
      dirty = false;
      updateFileStatus(true);
      toast(t('toast.bookSaved'));
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('toast.saveFailed'));
    } finally {
      hideLoading();
    }
  }

  // ---------- Navigation ----------

  function switchView(view) {
    currentView = view;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    ['dashboard', 'trades', 'stats', 'settings'].forEach(v => {
      $(`#view-${v}`).style.display = v === view ? 'block' : 'none';
    });
    // Floating add button — only rendered visible on phones (CSS), and only
    // on the views where adding a trade makes sense.
    $('#fab-add-trade').style.display = (view === 'dashboard' || view === 'trades') ? '' : 'none';
    if (view === 'dashboard') renderDashboard();
    if (view === 'trades') renderTrades();
    if (view === 'stats') renderStats();
    if (view === 'settings') renderSettings();
  }

  // ---------- Dashboard ----------

  function renderDashboard() {
    const s = Stats.summary(book.trades, book.settings.startingCapital);
    const el = $('#view-dashboard');
    el.innerHTML = `
      <div class="topbar">
        <div>
          <div class="page-title">${t('dashboard.title')}</div>
          <div class="page-subtitle">${t('dashboard.subtitle')}</div>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-primary" id="btn-add-trade-dash">${t('dashboard.newTrade')}</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.totalPnl')}</div>
          <div class="kpi-value ${signClass(s.totalPnl)}">${fmtMoney(s.totalPnl)}</div>
          <div class="kpi-sub">${t('dashboard.closedTradesCount', { count: s.closedTrades })}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.currentEquity')}</div>
          <div class="kpi-value">${fmtMoney(s.currentEquity)}</div>
          <div class="kpi-sub">${t('dashboard.startLabel', { amount: fmtMoney(book.settings.startingCapital) })}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.winRate')}</div>
          <div class="kpi-value">${s.closedTrades ? s.winRate.toFixed(1) + '%' : '–'}</div>
          <div class="kpi-sub">${t('dashboard.avgWinLoss', { win: fmtMoney(s.avgWin), loss: fmtMoney(-s.avgLoss) })}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.profitFactor')}</div>
          <div class="kpi-value">${isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</div>
          <div class="kpi-sub">${t('dashboard.expectancyPerTrade', { value: fmtMoney(s.expectancy) })}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.maxDrawdown')}</div>
          <div class="kpi-value neg">${fmtMoney(-s.maxDrawdown)}</div>
          <div class="kpi-sub">${t('dashboard.maxDrawdownSub', { pct: s.maxDrawdownPct.toFixed(1) })}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('dashboard.boundMargin')}</div>
          <div class="kpi-value">${fmtMoney(s.openMargin)}</div>
          <div class="kpi-sub">${t(s.openTrades === 1 ? 'dashboard.openPosition' : 'dashboard.openPositions', { count: s.openTrades })}</div>
        </div>
      </div>

      ${renderMonthlyGoal()}

      ${renderRiskWarnings()}

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">${t('dashboard.equityCurve')}</div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart-equity"></canvas></div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">${t('dashboard.recentTrades')}</div>
          <button class="btn btn-ghost btn-sm" id="btn-view-all-trades">${t('dashboard.viewAll')} ${icon('chevronRight', 'icon-xs')}</button>
        </div>
        ${renderTradesTable(recentTrades(8), false)}
      </div>
    `;
    Charts.equityCurve('chart-equity', s.equityCurve);
    $('#btn-add-trade-dash').onclick = () => openDrawer();
    $('#btn-view-all-trades').onclick = () => switchView('trades');
    const goalSettingsBtn = $('#btn-goto-goal-settings');
    if (goalSettingsBtn) goalSettingsBtn.onclick = () => switchView('settings');
    const goalPrevBtn = $('#btn-goal-prev-month');
    const goalNextBtn = $('#btn-goal-next-month');
    if (goalPrevBtn) goalPrevBtn.onclick = () => { goalMonthOffset -= 1; renderDashboard(); };
    if (goalNextBtn) goalNextBtn.onclick = () => { if (goalMonthOffset < 0) { goalMonthOffset += 1; renderDashboard(); } };
    bindTableRowActions(el);
  }

  function monthNames() {
    return Array.from({ length: 12 }, (_, i) => t(`month.${i}`));
  }

  function monthShortNames() {
    return Array.from({ length: 12 }, (_, i) => t(`monthShort.${i}`));
  }

  function renderMonthlyGoal() {
    const pct = book.settings.monthlyGoalPct;
    const now = new Date();

    if (!pct) {
      return `
        <div class="panel goal-panel">
          <div class="goal-empty-row">
            <div>
              <div class="panel-title">${icon('target')} ${t('goal.title')}</div>
              <div class="page-subtitle" style="margin-top:4px;">${t('goal.noGoalSet')}</div>
            </div>
            <button class="btn btn-sm" id="btn-goto-goal-settings">${t('goal.settings')}</button>
          </div>
        </div>`;
    }

    const viewDate = new Date(now.getFullYear(), now.getMonth() + goalMonthOffset, 1);
    const monthLabel = `${monthNames()[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
    const isCurrentMonth = goalMonthOffset === 0;

    const monthPnl = Stats.monthToDatePnl(book.trades, viewDate.getFullYear(), viewDate.getMonth());
    const target = book.settings.startingCapital * (pct / 100);
    const progressPct = target ? (monthPnl / target) * 100 : 0;
    const barWidth = Math.max(0, Math.min(100, progressPct));
    const reached = target > 0 && monthPnl >= target;

    return `
      <div class="panel goal-panel">
        <div class="panel-header">
          <div class="panel-title">${icon('target')} ${t('goal.title')}</div>
          <div class="goal-month-nav">
            <button type="button" class="icon-btn" id="btn-goal-prev-month" title="${t('goal.prevMonth')}">${icon('chevronLeft', 'icon-xs')}</button>
            <div class="page-subtitle" style="margin:0; min-width:110px; text-align:center;">${monthLabel}</div>
            <button type="button" class="icon-btn" id="btn-goal-next-month" title="${t('goal.nextMonth')}" ${isCurrentMonth ? 'disabled' : ''}>${icon('chevronRight', 'icon-xs')}</button>
          </div>
        </div>
        <div class="goal-row">
          <div class="goal-amounts">
            <span class="goal-amount ${signClass(monthPnl)}">${fmtMoney(monthPnl)}</span>
            <span class="page-subtitle" style="margin:0;">${t('goal.of', { target: fmtMoney(target), pct })}</span>
          </div>
          <div class="goal-pct ${reached ? 'pos' : 'neutral'}">${reached ? icon('check', 'icon-xs') : ''}${progressPct.toFixed(0)}%</div>
        </div>
        <div class="goal-track">
          <div class="goal-fill ${monthPnl >= 0 ? 'pos-fill' : 'neg-fill'}" style="width:${barWidth}%;"></div>
        </div>
      </div>`;
  }

  // Letzte 24 Kalendermonate (inkl. aktuellem, laufendem Monat) für den Verlaufs-Chart.
  function last24MonthsGoalData() {
    const pct = book.settings.monthlyGoalPct;
    const target = book.settings.startingCapital * (pct / 100);
    const now = new Date();
    const byMonth = Stats.pnlByMonth(book.trades);
    const shortNames = monthShortNames();
    const months = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const p = byMonth.get(`${d.getFullYear()}-${d.getMonth()}`) || 0;
      months.push({
        label: `${shortNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
        pnl: p,
        reached: target > 0 && p >= target,
      });
    }
    return { months, target };
  }

  function renderMonthlyGoalHistory() {
    const pct = book.settings.monthlyGoalPct;
    if (!pct) {
      return `
        <div class="panel">
          <div class="panel-header"><div class="panel-title">${t('goal.history')}</div></div>
          ${emptyMini(t('goal.noGoalSet'))}
        </div>`;
    }
    const { months } = last24MonthsGoalData();
    const hitCount = months.filter(m => m.reached).length;
    return `
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">${t('goal.history')}</div>
          <div class="page-subtitle" style="margin:0;">${t('goal.historyHit', { hit: hitCount })}</div>
        </div>
        <div class="chart-wrap"><canvas id="chart-goal-history"></canvas></div>
      </div>`;
  }

  function renderRiskWarnings() {
    const openTrades = book.trades.filter(t => t.status === 'open');
    const items = [];
    for (const tr of openTrades) {
      const unsafeStop = Stats.stopBeyondLiquidation(tr);
      const highLev = Stats.isHighLeverage(tr);
      const liq = Stats.liquidationPrice(tr);
      if (unsafeStop) {
        items.push({
          danger: true,
          symbol: tr.symbol,
          text: t('risk.stopBehindLiq', { stop: fmtPrice(tr.stopLoss), liq: fmtPrice(liq) }),
        });
      } else if (highLev && tr.stopLoss == null) {
        items.push({
          danger: false,
          symbol: tr.symbol,
          text: t('risk.highLevNoStop', { lev: Stats.impliedLeverage(tr).toFixed(1), liq: fmtPrice(liq) }),
        });
      } else if (highLev) {
        items.push({
          danger: false,
          symbol: tr.symbol,
          text: t('risk.highLev', { lev: Stats.impliedLeverage(tr).toFixed(1), liq: fmtPrice(liq) }),
        });
      }
    }
    if (!items.length) return '';
    const shown = items.slice(0, 10);
    const remaining = items.length - shown.length;
    return `
      <div class="panel risk-panel">
        <div class="panel-header">
          <div class="panel-title">${icon('warning')} ${t('risk.title')}</div>
        </div>
        ${shown.map(i => `
          <div class="risk-row ${i.danger ? 'danger' : ''}">
            <div class="risk-row-icon">${i.danger ? icon('danger') : icon('warning')}</div>
            <div>
              <div class="risk-row-main">${esc(i.symbol)}</div>
              <div class="risk-row-sub">${i.text}</div>
            </div>
          </div>`).join('')}
        ${remaining > 0 ? `<div class="risk-row-sub" style="padding:8px 4px 0;">${t(remaining === 1 ? 'risk.moreOpenPosition' : 'risk.moreOpenPositions', { count: remaining })}</div>` : ''}
      </div>`;
  }

  function recentTrades(n) {
    return [...book.trades]
      .sort((a, b) => new Date(b.exitDate || b.date) - new Date(a.exitDate || a.date))
      .slice(0, n);
  }

  // ---------- Trades view ----------

  function filteredTrades() {
    return book.trades.filter(t => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${t.symbol} ${t.notes || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.symbol && t.symbol !== filters.symbol) return false;
      if (filters.tag && !(t.tags || []).includes(filters.tag)) return false;
      if (filters.direction && t.direction !== filters.direction) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.from && new Date(t.date) < new Date(filters.from)) return false;
      if (filters.to && new Date(t.date) > new Date(filters.to)) return false;
      return true;
    });
  }

  function uniqueValues(key) {
    const set = new Set();
    book.trades.forEach(t => {
      if (key === 'tags') (t.tags || []).forEach(tag => set.add(tag));
      else if (t[key]) set.add(t[key]);
    });
    return [...set].sort();
  }

  // Re-rendering #view-trades replaces the filter inputs' DOM nodes, which would
  // otherwise drop focus/cursor position out of the search field on every keystroke.
  function captureFocus(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active) || !active.id) return null;
    return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }

  function restoreFocus(container, snapshot) {
    if (!snapshot) return;
    const el = container.querySelector(`#${snapshot.id}`);
    if (!el) return;
    el.focus();
    if (snapshot.start != null && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(snapshot.start, snapshot.end); } catch (e) { /* not a text input */ }
    }
  }

  function renderTrades() {
    const el = $('#view-trades');
    const focusSnapshot = captureFocus(el);
    const symbols = uniqueValues('symbol');
    const tags = uniqueValues('tags');
    const all = sortTrades(filteredTrades());
    const totalPages = Math.max(1, Math.ceil(all.length / tradesPageSize));
    tradesPage = Math.min(Math.max(1, tradesPage), totalPages);
    const start = (tradesPage - 1) * tradesPageSize;
    const pageItems = all.slice(start, start + tradesPageSize);

    el.innerHTML = `
      <div class="topbar">
        <div>
          <div class="page-title">${t('trades.title')}</div>
          <div class="page-subtitle">${t('trades.totalCount', { count: book.trades.length })}</div>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-primary" id="btn-add-trade">${t('dashboard.newTrade')}</button>
        </div>
      </div>

      <div class="filter-bar">
        <input type="text" id="filter-search" placeholder="${t('trades.searchPlaceholder')}" value="${esc(filters.search)}">
        <button type="button" class="btn filter-toggle" id="btn-filter-toggle">${icon('filter', 'icon-xs')} ${t('trades.filters')}${activeSecondaryFilters() ? ` <span class="filter-count">${activeSecondaryFilters()}</span>` : ''}</button>
        <select id="sort-select" class="sort-mobile" aria-label="${t('trades.sortBy')}">${sortOptionsHtml()}</select>
        <div class="filter-backdrop ${filterSheetOpen ? 'open' : ''}" id="filter-backdrop"></div>
        <div class="filter-sheet ${filterSheetOpen ? 'open' : ''}" id="filter-sheet">
          <div class="filter-sheet-head">
            <span>${t('trades.filters')}</span>
            <button type="button" class="icon-btn" id="btn-filter-close">${icon('close', 'icon-xs')}</button>
          </div>
          <select id="filter-symbol"><option value="">${t('trades.allSymbols')}</option>${symbols.map(s => `<option ${filters.symbol === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select id="filter-tag"><option value="">${t('trades.allTags')}</option>${tags.map(tag => `<option ${filters.tag === tag ? 'selected' : ''}>${esc(tag)}</option>`).join('')}</select>
          <select id="filter-direction">
            <option value="">${t('trades.longAndShort')}</option>
            <option value="long" ${filters.direction === 'long' ? 'selected' : ''}>Long</option>
            <option value="short" ${filters.direction === 'short' ? 'selected' : ''}>Short</option>
          </select>
          <select id="filter-status">
            <option value="">${t('trades.allStatus')}</option>
            <option value="closed" ${filters.status === 'closed' ? 'selected' : ''}>${t('trades.closedOption')}</option>
            <option value="open" ${filters.status === 'open' ? 'selected' : ''}>${t('trades.openOption')}</option>
          </select>
          <input type="date" id="filter-from" value="${esc(filters.from)}">
          <input type="date" id="filter-to" value="${esc(filters.to)}">
          <button class="btn btn-ghost btn-sm" id="btn-clear-filters" ${hasActiveFilters() ? '' : 'disabled'}>${icon('undo', 'icon-xs')} ${t('trades.resetFilters')}</button>
          <button type="button" class="btn btn-primary filter-done" id="btn-filter-done">${t('trades.showResults', { count: all.length })}</button>
        </div>
      </div>

      <div class="panel">
        ${renderTradesTable(pageItems, true, true)}
        ${renderPagination(all.length, totalPages)}
      </div>
    `;

    $('#btn-add-trade').onclick = () => openDrawer();
    $('#filter-search').oninput = (e) => {
      const value = e.target.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => { filters.search = value; tradesPage = 1; renderTrades(); }, 200);
    };
    $('#btn-filter-toggle').onclick = () => setFilterSheet(true);
    $('#btn-filter-close').onclick = () => setFilterSheet(false);
    $('#btn-filter-done').onclick = () => setFilterSheet(false);
    $('#filter-backdrop').onclick = () => setFilterSheet(false);
    $('#sort-select').onchange = (e) => {
      const [key, dir] = e.target.value.split(':');
      tradesSort = { key, dir };
      tradesPage = 1;
      renderTrades();
    };
    $('#filter-symbol').onchange = (e) => { filters.symbol = e.target.value; tradesPage = 1; renderTrades(); };
    $('#filter-tag').onchange = (e) => { filters.tag = e.target.value; tradesPage = 1; renderTrades(); };
    $('#filter-direction').onchange = (e) => { filters.direction = e.target.value; tradesPage = 1; renderTrades(); };
    $('#filter-status').onchange = (e) => { filters.status = e.target.value; tradesPage = 1; renderTrades(); };
    $('#filter-from').onchange = (e) => { filters.from = e.target.value; tradesPage = 1; renderTrades(); };
    $('#filter-to').onchange = (e) => { filters.to = e.target.value; tradesPage = 1; renderTrades(); };
    $('#btn-clear-filters').onclick = () => { filters = { search: '', symbol: '', tag: '', direction: '', status: '', from: '', to: '' }; tradesPage = 1; renderTrades(); };

    const prevBtn = $('#btn-page-prev');
    const nextBtn = $('#btn-page-next');
    if (prevBtn) prevBtn.onclick = () => { tradesPage -= 1; renderTrades(); };
    if (nextBtn) nextBtn.onclick = () => { tradesPage += 1; renderTrades(); };
    const pageSizeSelect = $('#page-size-select');
    if (pageSizeSelect) pageSizeSelect.onchange = (e) => { tradesPageSize = parseInt(e.target.value, 10); tradesPage = 1; renderTrades(); };

    bindTableRowActions(el);
    el.querySelectorAll('.th-sort').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.sortKey;
        if (tradesSort.key === key) {
          tradesSort.dir = tradesSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          tradesSort = { key, dir: 'desc' };
        }
        tradesPage = 1;
        renderTrades();
      };
    });
    restoreFocus(el, focusSnapshot);
  }

  function renderPagination(total, totalPages) {
    if (!total) return '';
    const start = (tradesPage - 1) * tradesPageSize + 1;
    const end = Math.min(total, tradesPage * tradesPageSize);
    return `
      <div class="pagination">
        <div class="pagination-info">${t('trades.paginationRange', { start, end, total })}</div>
        <div class="pagination-controls">
          <select id="page-size-select">
            ${[25, 50, 100, 200].map(n => `<option value="${n}" ${tradesPageSize === n ? 'selected' : ''}>${t('trades.perPage', { n })}</option>`).join('')}
          </select>
          <button class="btn btn-sm" id="btn-page-prev" ${tradesPage <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 'icon-xs')} ${t('trades.back')}</button>
          <div class="pagination-page">${t('trades.pageOf', { page: tradesPage, total: totalPages })}</div>
          <button class="btn btn-sm" id="btn-page-next" ${tradesPage >= totalPages ? 'disabled' : ''}>${t('trades.next')} ${icon('chevronRight', 'icon-xs')}</button>
        </div>
      </div>`;
  }

  function setFilterSheet(open) {
    filterSheetOpen = open;
    $('#filter-sheet').classList.toggle('open', open);
    $('#filter-backdrop').classList.toggle('open', open);
    document.body.classList.toggle('no-scroll', open);
  }

  // Filters other than the free-text search (which stays visible on phones).
  function activeSecondaryFilters() {
    return Object.entries(filters).filter(([k, v]) => k !== 'search' && v).length;
  }

  // Phones have no clickable table headers, so sorting moves into a dropdown.
  function sortOptionsHtml() {
    const keys = ['date', 'pnl', 'pnlPercent', 'symbol'];
    const cols = getTradeColumns().filter(c => keys.includes(c.key));
    return keys.flatMap(k => {
      const label = cols.find(c => c.key === k).label;
      return ['desc', 'asc'].map(dir => {
        const selected = tradesSort.key === k && tradesSort.dir === dir ? 'selected' : '';
        return `<option value="${k}:${dir}" ${selected}>${label} ${dir === 'desc' ? '↓' : '↑'}</option>`;
      });
    }).join('');
  }

  function hasActiveFilters() {
    return Object.values(filters).some(v => v);
  }

  function getTradeColumns() {
    return [
      { key: 'date', label: t('col.date'), get: tr => new Date(tr.exitDate || tr.date).getTime() },
      { key: 'symbol', label: t('col.symbol'), get: tr => tr.symbol },
      { key: 'direction', label: t('col.direction'), get: tr => tr.direction },
      { key: 'quantity', label: t('col.quantity'), get: tr => tr.quantity },
      { key: 'entryPrice', label: t('col.entryPrice'), get: tr => tr.entryPrice },
      { key: 'exitPrice', label: t('col.exitPrice'), get: tr => tr.exitPrice ?? -Infinity },
      { key: 'leverage', label: t('col.leverage'), get: tr => tr.leverage ?? 0 },
      { key: 'liqPrice', label: t('col.liqPrice'), title: t('risk.approxLiqPrice'), get: tr => Stats.liquidationPrice(tr) ?? -Infinity },
      { key: 'fees', label: t('col.fees'), get: tr => tr.fees || 0 },
      { key: 'pnl', label: t('col.pnl'), get: tr => Stats.pnl(tr) ?? -Infinity },
      { key: 'pnlPercent', label: t('col.pnlPercent'), title: t('col.priceMoveTitle'), get: tr => Stats.pnlPercent(tr) ?? -Infinity },
      { key: 'returnOnMargin', label: t('col.returnOnMargin'), title: t('col.returnOnMarginTitle'), get: tr => Stats.returnOnMargin(tr) ?? -Infinity },
    ];
  }

  function sortTrades(trades) {
    const columns = getTradeColumns();
    const col = columns.find(c => c.key === tradesSort.key) || columns[0];
    const dir = tradesSort.dir === 'asc' ? 1 : -1;
    return [...trades].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function renderTradesTable(trades, showFilterEmptyState, sortable = false) {
    if (!trades.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">${icon('trades')}</div>
          <h3>${showFilterEmptyState && hasActiveFilters() ? t('trades.noTradesFound') : t('trades.noTradesYet')}</h3>
          <p>${showFilterEmptyState && hasActiveFilters() ? t('trades.noTradesFoundHint') : t('trades.noTradesYetHint')}</p>
        </div>`;
    }
    const rows = trades.map(tr => {
      const pnl = Stats.pnl(tr);
      const pct = Stats.pnlPercent(tr);
      const romPct = Stats.returnOnMargin(tr);
      const liq = Stats.liquidationPrice(tr);
      const unsafeStop = Stats.stopBeyondLiquidation(tr);
      const highLev = Stats.isHighLeverage(tr);
      let liqCell = '–';
      if (liq != null) {
        const cls = unsafeStop ? 'neg' : (highLev ? 'warn' : 'neutral');
        const title = unsafeStop
          ? t('risk.stopBehindLiqTitle')
          : (highLev ? t('risk.highLevThresholdTitle', { threshold: Stats.HIGH_LEVERAGE_THRESHOLD }) : t('risk.approxLiqPrice'));
        const warnIcon = unsafeStop ? icon('warning', 'icon-xs') : '';
        liqCell = `<span class="${cls}" title="${title}">${warnIcon}${fmtPrice(liq)}</span>`;
      }
      return `
        <tr data-id="${esc(tr.id)}">
          <td>${fmtDate(tr.date)}</td>
          <td><strong>${esc(tr.symbol)}</strong></td>
          <td><span class="badge badge-${tr.direction}">${tr.direction === 'long' ? 'Long' : 'Short'}</span></td>
          <td>${esc(tr.quantity)}</td>
          <td>${esc(tr.entryPrice)}</td>
          <td>${esc(tr.exitPrice ?? '–')}</td>
          <td>${tr.leverage ? `<span class="badge badge-tag">${esc(tr.leverage)}x</span>` : '–'}</td>
          <td>${liqCell}</td>
          <td>${tr.fees ? fmtMoney(tr.fees) : '–'}</td>
          <td>${tr.status === 'open' ? `<span class="badge badge-open">${t('status.open')}</span>` : (pnl != null ? `<span class="${signClass(pnl)}">${fmtMoney(pnl)}</span>` : '–')}</td>
          <td title="${t('col.priceMoveTitle')}">${pct != null ? `<span class="${signClass(pct)}">${fmtPct(pct)}</span>` : '–'}</td>
          <td title="${t('col.returnOnMarginTitle')}">${romPct != null ? `<span class="${signClass(romPct)}">${fmtPct(romPct)}</span>` : '–'}</td>
          <td>${(tr.tags || []).map(tag => `<span class="badge badge-tag">${esc(tag)}</span>`).join('')}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn btn-edit" title="${t('action.edit')}">${icon('edit', 'icon-xs')}</button>
              <button class="icon-btn btn-delete" title="${t('action.delete')}">${icon('delete', 'icon-xs')}</button>
            </div>
          </td>
        </tr>`;
    }).join('');
    const cards = trades.map(tradeCardHtml).join('');
    const columns = getTradeColumns();
    const headCells = columns.map(c => {
      const titleAttr = c.title ? ` title="${c.title}"` : '';
      if (!sortable) return `<th${titleAttr}>${c.label}</th>`;
      const active = tradesSort.key === c.key;
      const arrow = active ? icon('chevronDown', `icon-xs sort-arrow${tradesSort.dir === 'asc' ? ' sort-asc' : ''}`) : '';
      return `<th${titleAttr}><button type="button" class="th-sort${active ? ' active' : ''}" data-sort-key="${c.key}">${c.label}${arrow}</button></th>`;
    }).join('');
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headCells}<th>${t('col.tags')}</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="trade-cards">${cards}</div>`;
  }

  // Phone layout of one trade: a tappable card instead of a 12-column table
  // row. Everything the table hides in tooltips is spelled out here.
  function tradeCardHtml(tr) {
    const pnl = Stats.pnl(tr);
    const pct = Stats.pnlPercent(tr);
    const liq = Stats.liquidationPrice(tr);
    const unsafeStop = Stats.stopBeyondLiquidation(tr);
    const valueHtml = tr.status === 'open'
      ? `<span class="badge badge-open">${t('status.open')}</span>`
      : (pnl != null ? `<span class="${signClass(pnl)}">${fmtMoney(pnl)}</span>` : '–');
    const liqHtml = liq != null
      ? `<span class="${unsafeStop ? 'neg' : (Stats.isHighLeverage(tr) ? 'warn' : '')}">${unsafeStop ? icon('warning', 'icon-xs') : ''}${t('trades.liqShort')} ${fmtPrice(liq)}</span>`
      : '';
    const tags = (tr.tags || []).map(tag => `<span class="badge badge-tag">${esc(tag)}</span>`).join('');
    return `
      <div class="trade-card" data-id="${esc(tr.id)}" role="button" tabindex="0">
        <div class="tc-top">
          <div class="tc-title">
            <strong>${esc(tr.symbol)}</strong>
            <span class="badge badge-${tr.direction}">${tr.direction === 'long' ? 'Long' : 'Short'}</span>
            ${tr.leverage ? `<span class="badge badge-tag">${esc(tr.leverage)}x</span>` : ''}
          </div>
          <div class="tc-pnl">${valueHtml}</div>
        </div>
        <div class="tc-meta">
          <span>${fmtDate(tr.exitDate || tr.date)}</span>
          <span>${esc(tr.quantity)} @ ${esc(tr.entryPrice)}${tr.exitPrice != null ? ` → ${esc(tr.exitPrice)}` : ''}</span>
          ${pct != null ? `<span class="${signClass(pct)}">${fmtPct(pct)}</span>` : ''}
          ${liqHtml}
        </div>
        ${tags ? `<div class="tc-tags">${tags}</div>` : ''}
      </div>`;
  }

  function bindTableRowActions(root) {
    // Touch tablets show the table but have no hover/precise edit button: let a row tap open the trade.
    root.querySelectorAll('tbody tr[data-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || !window.matchMedia('(pointer: coarse)').matches) return;
        openDrawer(row.dataset.id);
      });
    });
    root.querySelectorAll('.trade-card').forEach(card => {
      const open = () => openDrawer(card.dataset.id);
      card.onclick = open;
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    root.querySelectorAll('.btn-edit').forEach(btn => {
      btn.onclick = () => openDrawer(btn.closest('tr').dataset.id);
    });
    root.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => deleteTrade(btn.closest('tr').dataset.id);
    });
  }

  // ---------- Stats view ----------

  function getStatsPresets() {
    return [
      { value: 'all', label: t('preset.all') },
      { value: 'this_year', label: t('preset.thisYear') },
      { value: 'last_year', label: t('preset.lastYear') },
      { value: 'this_month', label: t('preset.thisMonth') },
      { value: 'last_month', label: t('preset.lastMonth') },
      { value: 'last_30', label: t('preset.last30') },
      { value: 'last_90', label: t('preset.last90') },
      { value: 'custom', label: t('preset.custom') },
    ];
  }

  // Lokale Kalenderdatum-Komponenten statt toISOString() (UTC) – sonst verschiebt
  // sich das Datum in Zeitzonen östlich von UTC (z.B. Deutschland) um einen Tag.
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function statsPresetRange(preset) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (preset) {
      case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
      case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
      case 'this_month': return { from: isoDate(new Date(y, m, 1)), to: isoDate(new Date(y, m + 1, 0)) };
      case 'last_month': return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
      case 'last_30': return { from: isoDate(new Date(now.getTime() - 30 * 86400000)), to: isoDate(now) };
      case 'last_90': return { from: isoDate(new Date(now.getTime() - 90 * 86400000)), to: isoDate(now) };
      default: return { from: '', to: '' };
    }
  }

  function filteredStatsTrades() {
    if (!statsFilter.from && !statsFilter.to) return book.trades;
    return book.trades.filter(t => {
      const d = new Date(t.exitDate || t.date);
      if (statsFilter.from && d < new Date(statsFilter.from)) return false;
      if (statsFilter.to && d > new Date(`${statsFilter.to}T23:59:59`)) return false;
      return true;
    });
  }

  function renderStats() {
    const el = $('#view-stats');
    const trades = filteredStatsTrades();
    const bySymbol = Stats.bySymbol(trades).slice(0, 10).map(g => ({ ...g, key: translateGroupKey(g.key) }));
    const byTag = Stats.byTag(trades).map(g => ({ ...g, key: translateGroupKey(g.key) }));
    const byWeekday = orderWeekdays(Stats.byWeekday(trades)).map(g => ({ ...g, key: translateGroupKey(g.key) }));
    const dist = Stats.pnlDistribution(trades);
    const rDist = Stats.rMultipleDistribution(trades);
    const s = Stats.summary(trades, book.settings.startingCapital);
    const rangeActive = !!(statsFilter.from || statsFilter.to);
    const presets = getStatsPresets();

    el.innerHTML = `
      <div class="topbar">
        <div>
          <div class="page-title">${t('stats.title')}</div>
          <div class="page-subtitle">${rangeActive ? t('stats.subtitleRange', { count: s.closedTrades }) : t('stats.subtitleDefault')}</div>
        </div>
      </div>

      <div class="filter-bar stats-filter">
        <select id="stats-preset">
          ${presets.map(p => `<option value="${p.value}" ${statsFilter.preset === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <input type="date" id="stats-from" value="${esc(statsFilter.from)}">
        <span class="page-subtitle" style="margin:0;">${t('stats.to')}</span>
        <input type="date" id="stats-to" value="${esc(statsFilter.to)}">
        ${rangeActive ? `<button class="btn btn-ghost btn-sm" id="btn-stats-reset">${t('stats.resetRange')}</button>` : ''}
      </div>

      <div class="kpi-grid" style="margin-bottom:20px;">
        <div class="kpi-card">
          <div class="kpi-label">${t('stats.bestTrade')}</div>
          <div class="kpi-value pos">${fmtMoney(s.best)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('stats.worstTrade')}</div>
          <div class="kpi-value neg">${fmtMoney(s.worst)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('stats.expectancyPerTrade')}</div>
          <div class="kpi-value ${signClass(s.expectancy)}">${fmtMoney(s.expectancy)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('stats.avgReturnOnMargin')}</div>
          <div class="kpi-value ${s.avgReturnOnMargin != null ? signClass(s.avgReturnOnMargin) : 'neutral'}">${s.avgReturnOnMargin != null ? fmtPct(s.avgReturnOnMargin) : '–'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t('stats.totalFees')}</div>
          <div class="kpi-value neutral">${fmtMoney(s.totalFees)}</div>
          <div class="kpi-sub">${s.closedTrades ? t('stats.avgPerTrade', { amount: fmtMoney(s.totalFees / s.closedTrades) }) : ''}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">${t('stats.pnlCalendar')}</div>
          <div class="page-subtitle" style="margin:0;">${t('stats.dailyResult')}</div>
        </div>
        ${renderCalendarHeatmap(trades)}
      </div>

      ${renderMonthlyGoalHistory()}

      <div class="grid-2">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">${t('stats.pnlBySymbol')}</div></div>
          ${bySymbol.length ? '<div class="chart-wrap"><canvas id="chart-symbol"></canvas></div>' : emptyMini()}
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title">${t('stats.pnlByTag')}</div></div>
          ${renderGroupList(byTag)}
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">${t('stats.performanceByWeekday')}</div></div>
          ${byWeekday.length ? '<div class="chart-wrap small"><canvas id="chart-weekday"></canvas></div>' : emptyMini()}
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title">${t('stats.pnlDistribution')}</div></div>
          ${dist.length ? '<div class="chart-wrap small"><canvas id="chart-dist"></canvas></div>' : emptyMini()}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">${t('stats.rMultiplePerTrade')}</div>
          <div class="page-subtitle" style="margin:0;">${t('stats.rMultipleSub')}</div>
        </div>
        ${rDist.length ? '<div class="chart-wrap"><canvas id="chart-r"></canvas></div>' : emptyMini(t('stats.rMultipleEmpty'))}
      </div>
    `;

    if (bySymbol.length) Charts.barByGroup('chart-symbol', bySymbol);
    if (byWeekday.length) Charts.barByGroup('chart-weekday', byWeekday);
    if (dist.length) Charts.distributionBars('chart-dist', dist);
    if (rDist.length) Charts.rMultipleScatter('chart-r', rDist);
    if (book.settings.monthlyGoalPct) {
      const { months, target } = last24MonthsGoalData();
      Charts.monthlyGoalHistory('chart-goal-history', months, target);
    }

    $('#stats-preset').onchange = (e) => {
      const preset = e.target.value;
      statsFilter = { preset, ...statsPresetRange(preset) };
      renderStats();
    };
    $('#stats-from').onchange = (e) => {
      statsFilter = { ...statsFilter, preset: 'custom', from: e.target.value };
      renderStats();
    };
    $('#stats-to').onchange = (e) => {
      statsFilter = { ...statsFilter, preset: 'custom', to: e.target.value };
      renderStats();
    };
    const statsResetBtn = $('#btn-stats-reset');
    if (statsResetBtn) statsResetBtn.onclick = () => { statsFilter = { preset: 'all', from: '', to: '' }; renderStats(); };
    bindHeatmap(el);
  }

  // Touch has no hover tooltips: tapping a day shows its result under the grid.
  // The grid also opens scrolled to the most recent weeks.
  function bindHeatmap(root) {
    const wrap = root.querySelector('.heat-grid-wrap');
    if (!wrap) return;
    wrap.scrollLeft = wrap.scrollWidth;
    const info = root.querySelector('.heat-info');
    wrap.querySelectorAll('.heat-cell[data-info]').forEach(cell => {
      cell.onclick = () => { info.textContent = cell.dataset.info; };
    });
  }

  function emptyMini(msg = null) {
    return `<div class="empty-state" style="padding:30px 10px;"><p style="margin:0;">${msg ?? t('stats.notEnoughData')}</p></div>`;
  }

  function orderWeekdays(groups) {
    const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    return groups.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  function renderCalendarHeatmap(trades) {
    const dayMap = Stats.pnlByDay(trades);
    if (!dayMap.size) return emptyMini(t('stats.noTradesInRange'));

    const tradedDays = [...dayMap.keys()].sort();
    let rangeStart = statsFilter.from ? new Date(statsFilter.from) : new Date(tradedDays[0]);
    let rangeEnd = statsFilter.to ? new Date(statsFilter.to) : new Date(tradedDays[tradedDays.length - 1]);
    if (!statsFilter.from && !statsFilter.to) {
      const capped = new Date(rangeEnd);
      capped.setDate(capped.getDate() - 364);
      if (capped > rangeStart) rangeStart = capped;
    }

    const gridStart = new Date(rangeStart);
    const startDow = (gridStart.getDay() + 6) % 7; // 0 = Montag
    gridStart.setDate(gridStart.getDate() - startDow);

    const maxAbs = [...dayMap.values()].reduce((m, v) => Math.max(m, Math.abs(v.pnl)), 0) || 1;
    const shortNames = monthShortNames();

    const weeks = [];
    const cursor = new Date(gridStart);
    while (cursor <= rangeEnd) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    const weekCols = weeks.map(week => {
      const label = week[0].getDate() <= 7 ? shortNames[week[0].getMonth()] : '';
      const cells = week.map(d => {
        if (d < rangeStart || d > rangeEnd) return '<div class="heat-cell heat-pad"></div>';
        const iso = isoDate(d);
        const entry = dayMap.get(iso);
        let style = '';
        let title;
        if (entry) {
          const intensity = (0.18 + 0.72 * Math.min(1, Math.abs(entry.pnl) / maxAbs)).toFixed(2);
          const rgb = entry.pnl >= 0 ? '0,214,143' : '255,92,114';
          style = ` style="background-color: rgba(${rgb}, ${intensity});"`;
          title = t('heat.dayFilled', { date: fmtDate(iso), amount: fmtMoney(entry.pnl), count: entry.count, tradeWord: tradeWord(entry.count) });
        } else {
          title = t('heat.dayEmpty', { date: fmtDate(iso) });
        }
        return `<div class="heat-cell"${style} title="${title}" data-info="${title}"></div>`;
      }).join('');
      return `<div class="heat-week"><div class="heat-month-label">${label}</div><div class="heat-days">${cells}</div></div>`;
    }).join('');

    return `<div class="heat-grid-wrap"><div class="heat-grid">${weekCols}</div></div><div class="heat-info" aria-live="polite"></div>`;
  }

  function renderGroupList(groups) {
    if (!groups.length) return emptyMini();
    const maxAbs = Math.max(...groups.map(g => Math.abs(g.totalPnl)), 1);
    return `<div class="list-rows">${groups.map(g => `
      <div class="list-row">
        <div style="min-width:90px;">
          <div class="list-row-main">${esc(g.key)}</div>
          <div class="list-row-sub">${t('stats.winRateOf', { count: g.count, tradeWord: tradeWord(g.count), winrate: g.winRate.toFixed(0) })}</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.abs(g.totalPnl) / maxAbs * 100}%; background:${g.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'};"></div></div>
        <div class="list-row-value ${signClass(g.totalPnl)}">${fmtMoney(g.totalPnl)}</div>
      </div>`).join('')}</div>`;
  }

  // ---------- Settings view ----------

  function renderSettings() {
    const el = $('#view-settings');
    el.innerHTML = `
      <div class="topbar">
        <div>
          <div class="page-title">${t('settings.title')}</div>
          <div class="page-subtitle">${t('settings.subtitle')}</div>
        </div>
      </div>

      <div class="panel mobile-only">
        <div class="list-row">
          <div class="list-row-main">${t('settings.language')}</div>
          <div class="lang-switch" data-lang-switch>
            <button type="button" data-lang="de">DE</button>
            <button type="button" data-lang="en">EN</button>
          </div>
        </div>
      </div>

      <div class="panel" id="settings-file-panel">
        <div class="panel-title" style="margin-bottom:14px;">${t('settings.file')}</div>
        <div class="list-rows">
          <div class="list-row">
            <div>
              <div class="list-row-main">${t('settings.currentFile')}</div>
              <div class="list-row-sub">${Storage.hasActiveHandle() ? t('settings.linkedToFile') : t('settings.notLinkedToFile')}</div>
            </div>
            <button class="btn btn-sm" id="btn-save-as">${t('settings.saveAs')}</button>
          </div>
          <div class="list-row">
            <div>
              <div class="list-row-main">${t('settings.openOtherFile')}</div>
              <div class="list-row-sub">${t('settings.openOtherFileHint')}</div>
            </div>
            <button class="btn btn-sm" id="btn-open-other">${t('settings.open')}</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title" style="margin-bottom:14px;">${t('settings.basicSettings')}</div>
        <div class="field">
          <label>${t('settings.bookName')}</label>
          <input type="text" id="s-book-name" value="${esc(displayBookName(book.name))}" placeholder="${t('settings.bookNamePlaceholder')}">
        </div>
        <div class="field-row">
          <div class="field">
            <label>${t('settings.startingCapital')}</label>
            <input type="number" id="s-capital" value="${book.settings.startingCapital}" step="any">
          </div>
          <div class="field">
            <label>${t('settings.currency')}</label>
            <select id="s-currency">
              ${['EUR', 'USD', 'GBP', 'CHF'].map(c => `<option ${book.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field" style="max-width:220px;">
          <label>${t('settings.monthlyGoalPct')}</label>
          <input type="number" id="s-monthly-goal" value="${book.settings.monthlyGoalPct ?? ''}" step="any" min="0" placeholder="${t('settings.monthlyGoalPlaceholder')}">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-save-settings">${t('settings.apply')}</button>
      </div>

      <div class="panel">
        <div class="panel-title" style="margin-bottom:14px;">${t('settings.usedTags')}</div>
        ${uniqueValues('tags').length
          ? `<div>${uniqueValues('tags').map(tag => `<span class="badge badge-tag" style="margin-bottom:6px;">${esc(tag)}</span>`).join('')}</div>`
          : `<p class="page-subtitle" style="margin:0;">${t('settings.noTagsYet')}</p>`}
      </div>
    `;

    updateLangSwitchUI();
    bindLangSwitches();
    settingsSections.forEach(fn => fn(el, book));
    $('#btn-save-as').onclick = () => saveBook(true);
    $('#btn-open-other').onclick = async () => {
      if (dirty && !confirm(t('settings.confirmOpenOther'))) return;
      try {
        showLoading(t('loading.openingFile'));
        await nextPaint();
        const { data, fileName } = await Storage.openFile();
        showLoading(t('loading.bookLoading'));
        await nextPaint();
        loadBook(data, false, fileName);
      } catch (e) { /* cancelled */ } finally {
        hideLoading();
      }
    };
    $('#btn-save-settings').onclick = () => {
      book.name = $('#s-book-name').value.trim() || 'Trading Book';
      book.settings.startingCapital = parseFloat($('#s-capital').value) || 0;
      book.settings.currency = $('#s-currency').value;
      const goalVal = $('#s-monthly-goal').value;
      book.settings.monthlyGoalPct = goalVal ? parseFloat(goalVal) : null;
      markDirty();
      updateBookNameDisplay();
      toast(t('settings.applied'));
      renderDashboard();
    };
  }

  // ---------- Trade drawer (add/edit) ----------

  function bindDrawer() {
    $('#drawer-overlay').onclick = closeDrawer;
    $('#btn-close-drawer').onclick = closeDrawer;
    $('#btn-cancel-drawer').onclick = closeDrawer;
    $('#btn-save-trade').onclick = submitTradeForm;
    $('#btn-delete-trade').onclick = () => { deleteTrade(editingId); closeDrawer(); };

    $$('#f-direction-seg button').forEach(b => b.onclick = () => {
      setSegmented('#f-direction-seg', b.dataset.value);
      updateLiqHint();
    });
    $$('#f-status-seg button').forEach(b => b.onclick = () => {
      setSegmented('#f-status-seg', b.dataset.value);
      toggleExitFieldsRequired(b.dataset.value);
    });

    ['#f-entryPrice', '#f-quantity', '#f-stopLoss', '#f-leverage', '#f-margin'].forEach(sel => {
      $(sel).addEventListener('input', updateLiqHint);
    });

    // Soft keyboards don't reliably report Enter/comma as key events, so a tag
    // is also committed on blur, on a typed comma and when the form is saved.
    const tagInput = $('#f-tag-input');
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitTagInput();
      }
    });
    tagInput.addEventListener('input', () => { if (tagInput.value.includes(',')) commitTagInput(); });
    tagInput.addEventListener('blur', commitTagInput);
  }

  function setSegmented(containerSel, value) {
    $$(`${containerSel} button`).forEach(b => b.classList.toggle('active', b.dataset.value === value));
  }

  function getSegmentedValue(containerSel) {
    return $(`${containerSel} button.active`).dataset.value;
  }

  function toggleExitFieldsRequired(status) {
    $('#f-exitPrice').required = status === 'closed';
  }

  function formDraftForRiskCheck() {
    return {
      direction: getSegmentedValue('#f-direction-seg'),
      quantity: parseFloat($('#f-quantity').value),
      entryPrice: parseFloat($('#f-entryPrice').value),
      stopLoss: $('#f-stopLoss').value ? parseFloat($('#f-stopLoss').value) : null,
      leverage: $('#f-leverage').value ? parseFloat($('#f-leverage').value) : null,
      margin: $('#f-margin').value ? parseFloat($('#f-margin').value) : null,
    };
  }

  function updateLiqHint() {
    const wrap = $('#liq-hint');
    const draft = formDraftForRiskCheck();
    if (!draft.entryPrice || !draft.quantity || (!draft.leverage && !draft.margin)) {
      wrap.style.display = 'none';
      return;
    }
    const liq = Stats.liquidationPrice(draft);
    if (liq == null) {
      wrap.style.display = 'none';
      return;
    }
    const lev = Stats.impliedLeverage(draft);
    const unsafeStop = Stats.stopBeyondLiquidation(draft);
    const highLev = Stats.isHighLeverage(draft);

    const lines = [`<div class="risk-line"><span>${t('risk.approxLiqPrice')}</span><strong>${fmtPrice(liq)}</strong></div>`];
    if (lev != null) lines.push(`<div class="risk-line"><span>${t('risk.effectiveLeverage')}</span><strong>${lev.toFixed(1)}x</strong></div>`);

    let extraClass = '';
    if (unsafeStop) {
      extraClass = ' risk-danger';
      lines.push(`<div>${icon('warning', 'icon-xs')} ${t('risk.stopBehindLiqFull')}</div>`);
    } else if (highLev) {
      extraClass = ' risk-warn';
      lines.push(`<div>${icon('warning', 'icon-xs')} ${t('risk.highLevWarnFull', { threshold: Stats.HIGH_LEVERAGE_THRESHOLD })}</div>`);
    }

    wrap.className = `risk-hint${extraClass}`;
    wrap.innerHTML = lines.join('');
    wrap.style.display = 'flex';
  }

  function renderTagChips() {
    const wrap = $('#tag-input-wrap');
    wrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
    formTags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${esc(tag)} <button type="button">${icon('close', 'icon-xs')}</button>`;
      chip.querySelector('button').onclick = () => { formTags.splice(i, 1); renderTagChips(); };
      wrap.insertBefore(chip, $('#f-tag-input'));
    });
  }

  function openDrawer(id = null) {
    editingId = id;
    const trade = id ? book.trades.find(tr => tr.id === id) : null;
    $('#drawer-title').textContent = trade ? t('drawer.editTrade') : t('drawer.newTrade');
    $('#btn-delete-trade').style.display = trade ? 'inline-flex' : 'none';

    $('#f-id').value = trade?.id || '';
    $('#f-symbol').value = trade?.symbol || '';
    $('#f-quantity').value = trade?.quantity ?? '';
    $('#f-date').value = trade?.date || new Date().toISOString().slice(0, 10);
    $('#f-exitDate').value = trade?.exitDate || '';
    $('#f-entryPrice').value = trade?.entryPrice ?? '';
    $('#f-exitPrice').value = trade?.exitPrice ?? '';
    $('#f-stopLoss').value = trade?.stopLoss ?? '';
    $('#f-fees').value = trade?.fees ?? '';
    $('#f-leverage').value = trade?.leverage ?? '';
    $('#f-margin').value = trade?.margin ?? '';
    $('#f-notes').value = trade?.notes || '';

    setSegmented('#f-direction-seg', trade?.direction || 'long');
    const status = trade?.status || 'closed';
    setSegmented('#f-status-seg', status);
    toggleExitFieldsRequired(status);

    formTags = trade?.tags ? [...trade.tags] : [];
    renderTagChips();
    updateLiqHint();

    $('#drawer-overlay').classList.add('open');
    $('#trade-drawer').classList.add('open');
    document.body.classList.add('no-scroll');
    // Don't pop the on-screen keyboard when merely opening an existing trade on a touch device.
    if (!trade || !window.matchMedia('(pointer: coarse)').matches) setTimeout(() => $('#f-symbol').focus(), 50);
  }

  function commitTagInput() {
    const input = $('#f-tag-input');
    const val = input.value.replace(/,/g, '').trim();
    input.value = '';
    if (val && !formTags.includes(val)) {
      formTags.push(val);
      renderTagChips();
    }
  }

  function closeDrawer() {
    $('#drawer-overlay').classList.remove('open');
    $('#trade-drawer').classList.remove('open');
    document.body.classList.remove('no-scroll');
    editingId = null;
  }

  function submitTradeForm() {
    commitTagInput();
    const form = $('#trade-form');
    if (!form.reportValidity()) return;

    const status = getSegmentedValue('#f-status-seg');
    const trade = {
      id: editingId || uid(),
      symbol: $('#f-symbol').value.trim().toUpperCase(),
      direction: getSegmentedValue('#f-direction-seg'),
      status,
      quantity: parseFloat($('#f-quantity').value),
      date: $('#f-date').value,
      exitDate: $('#f-exitDate').value || null,
      entryPrice: parseFloat($('#f-entryPrice').value),
      exitPrice: $('#f-exitPrice').value ? parseFloat($('#f-exitPrice').value) : null,
      stopLoss: $('#f-stopLoss').value ? parseFloat($('#f-stopLoss').value) : null,
      fees: $('#f-fees').value ? parseFloat($('#f-fees').value) : 0,
      leverage: $('#f-leverage').value ? parseFloat($('#f-leverage').value) : null,
      margin: $('#f-margin').value ? parseFloat($('#f-margin').value) : null,
      tags: [...formTags],
      notes: $('#f-notes').value.trim(),
    };

    if (status === 'closed' && !trade.exitPrice) {
      toast(t('drawer.exitPriceRequired'));
      return;
    }

    const idx = book.trades.findIndex(tr => tr.id === trade.id);
    if (idx >= 0) book.trades[idx] = trade;
    else book.trades.push(trade);

    markDirty();
    closeDrawer();
    toast(idx >= 0 ? t('drawer.tradeUpdated') : t('drawer.tradeCreated'));
    switchView(currentView);
  }

  function deleteTrade(id) {
    const idx = book.trades.findIndex(tr => tr.id === id);
    if (idx === -1) return;
    const [removed] = book.trades.splice(idx, 1);
    markDirty();
    switchView(currentView);
    toast(t('drawer.tradeDeleted'), {
      label: t('drawer.undo'),
      onClick: () => {
        book.trades.splice(idx, 0, removed);
        markDirty();
        switchView(currentView);
        toast(t('drawer.tradeRestored'));
      },
    });
  }

  // ---------- Extension points ----------
  // Small, generic hooks so additional storage locations can be plugged in without touching
  // the core app. A backend is { save(book): Promise, onChange?(book) }. While one is
  // attached, "Save" calls backend.save(), edits call backend.onChange(), and no plaintext
  // autosave copy is written to localStorage. Everything else works exactly as before.
  function attachBackend(b) {
    backend = b;
    Storage.clearHandle();
    document.body.classList.add('has-backend');
  }

  function detachBackend() {
    backend = null;
    document.body.classList.remove('has-backend');
  }

  function markSaved() {
    dirty = false;
    updateFileStatus(true);
  }

  return {
    init,
    loadBook: (data, opts = {}) => loadBook(data, !!opts.unsaved, opts.fileName || null),
    getBook: () => book,
    isDirty: () => dirty,
    markDirty,
    refresh: () => { if (book) switchView(currentView); },
    attachBackend,
    detachBackend,
    markSaved,
    registerSettingsSection: (fn) => { settingsSections.push(fn); },
    toast,
    showLoading,
    hideLoading,
    nextPaint,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
