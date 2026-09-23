// Statistics engine: derives all metrics from the raw trades array.
// Nothing here mutates state; every function takes trades in and returns
// plain numbers/arrays so the UI layer can just render.

const Stats = (() => {
  function pnl(trade) {
    if (trade.exitPrice == null || trade.entryPrice == null || trade.quantity == null) return null;
    const gross = trade.direction === 'short'
      ? (trade.entryPrice - trade.exitPrice) * trade.quantity
      : (trade.exitPrice - trade.entryPrice) * trade.quantity;
    return gross - (trade.fees || 0);
  }

  function pnlPercent(trade) {
    const p = pnl(trade);
    if (p == null) return null;
    const basis = trade.entryPrice * trade.quantity;
    return basis ? (p / basis) * 100 : null;
  }

  function rMultiple(trade) {
    const p = pnl(trade);
    if (p == null || trade.stopLoss == null || trade.entryPrice == null) return null;
    const riskPerUnit = Math.abs(trade.entryPrice - trade.stopLoss);
    if (!riskPerUnit) return null;
    const riskTotal = riskPerUnit * trade.quantity;
    return riskTotal ? p / riskTotal : null;
  }

  // Notional = volle Positionsgröße. Margin = tatsächlich gebundenes Kapital:
  // entweder manuell hinterlegt (Futures/Optionen) oder aus Hebel abgeleitet (CFD/Forex/Krypto-Margin).
  function notional(trade) {
    if (trade.entryPrice == null || trade.quantity == null) return null;
    return trade.entryPrice * trade.quantity;
  }

  function marginUsed(trade) {
    if (trade.margin != null) return trade.margin;
    const n = notional(trade);
    if (n == null) return null;
    const lev = trade.leverage && trade.leverage > 0 ? trade.leverage : 1;
    return n / lev;
  }

  function returnOnMargin(trade) {
    const p = pnl(trade);
    if (p == null) return null;
    const m = marginUsed(trade);
    if (!m) return null;
    return (p / m) * 100;
  }

  // Effektiver Hebel = Positionsgröße / gebundene Margin, unabhängig davon, ob der
  // Hebel explizit gesetzt oder über eine manuelle Margin (Futures/Optionen) impliziert ist.
  function impliedLeverage(trade) {
    const n = notional(trade);
    const m = marginUsed(trade);
    if (!n || !m) return null;
    return n / m;
  }

  const HIGH_LEVERAGE_THRESHOLD = 10;

  function isHighLeverage(trade) {
    const lev = impliedLeverage(trade);
    return lev != null && lev >= HIGH_LEVERAGE_THRESHOLD;
  }

  // Näherungsweiser Liquidationspreis: die Kursbewegung, bei der die gesamte
  // eingesetzte Margin aufgezehrt ist. Ignoriert Maintenance-Margin-Puffer und
  // Gebühren – dient als grobe Risiko-Orientierung, nicht als exakter Broker-Wert.
  function liquidationPrice(trade) {
    if (trade.leverage == null && trade.margin == null) return null; // ungehebelter Cash-Trade: kein Margin-Call möglich
    const m = marginUsed(trade);
    if (m == null || trade.entryPrice == null || !trade.quantity) return null;
    const distance = m / trade.quantity;
    return trade.direction === 'short' ? trade.entryPrice + distance : trade.entryPrice - distance;
  }

  // true, wenn der Stop-Loss den Liquidationspreis nicht mehr rechtzeitig erreicht
  // (Position würde liquidiert, bevor der Stop greift).
  function stopBeyondLiquidation(trade) {
    const liq = liquidationPrice(trade);
    if (liq == null || trade.stopLoss == null) return false;
    return trade.direction === 'short' ? trade.stopLoss >= liq : trade.stopLoss <= liq;
  }

  function closedTrades(trades) {
    return trades.filter(t => t.status === 'closed' && pnl(t) != null);
  }

  function sortByCloseDate(trades) {
    return [...trades].sort((a, b) => new Date(a.exitDate || a.date) - new Date(b.exitDate || b.date));
  }

  function summary(trades, startingCapital = 0) {
    const closed = closedTrades(trades);
    const n = closed.length;
    const pnls = closed.map(pnl);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const winRate = n ? (wins.length / n) * 100 : 0;
    const avgWin = wins.length ? grossWin / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0);
    const expectancy = n ? totalPnl / n : 0;
    const { equityCurve, maxDrawdown, maxDrawdownPct } = equity(trades, startingCapital);
    const best = n ? pnls.reduce((a, b) => Math.max(a, b), pnls[0]) : 0;
    const worst = n ? pnls.reduce((a, b) => Math.min(a, b), pnls[0]) : 0;
    const openTradesList = trades.filter(t => t.status === 'open');
    const openCount = openTradesList.length;
    const openMargin = openTradesList.reduce((sum, t) => sum + (marginUsed(t) || 0), 0);
    const returnsOnMargin = closed.map(returnOnMargin).filter(r => r != null);
    const avgReturnOnMargin = returnsOnMargin.length ? returnsOnMargin.reduce((a, b) => a + b, 0) / returnsOnMargin.length : null;
    const totalFees = closed.reduce((sum, t) => sum + (t.fees || 0), 0);

    return {
      totalTrades: trades.length,
      closedTrades: n,
      openTrades: openCount,
      openMargin,
      avgReturnOnMargin,
      totalFees,
      totalPnl,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      best,
      worst,
      maxDrawdown,
      maxDrawdownPct,
      equityCurve,
      currentEquity: startingCapital + totalPnl,
    };
  }

  // Reduziert eine Punktreihe für die Chart-Darstellung auf maxPoints, ohne den
  // ersten/letzten Punkt zu verlieren. Drawdown-Kennzahlen werden VOR dem Downsampling
  // aus der vollen Reihe berechnet, bleiben also exakt.
  function downsample(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const step = points.length / maxPoints;
    const out = [];
    for (let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i * step)]);
    out.push(points[points.length - 1]);
    return out;
  }

  const EQUITY_CHART_MAX_POINTS = 400;

  function equity(trades, startingCapital = 0) {
    const closed = sortByCloseDate(closedTrades(trades));
    let running = startingCapital;
    let peak = startingCapital;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    const curve = [{ date: closed.length ? closed[0].date : null, value: startingCapital, label: 'Start' }];

    for (const t of closed) {
      running += pnl(t);
      peak = Math.max(peak, running);
      const dd = peak - running;
      const ddPct = peak ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      curve.push({ date: t.exitDate || t.date, value: running, label: t.symbol });
    }

    return { equityCurve: downsample(curve, EQUITY_CHART_MAX_POINTS), maxDrawdown, maxDrawdownPct };
  }

  function groupBy(trades, keyFn) {
    const closed = closedTrades(trades);
    const map = new Map();
    for (const t of closed) {
      const key = keyFn(t) || '__other__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    const result = [];
    for (const [key, list] of map.entries()) {
      const pnls = list.map(pnl);
      const total = pnls.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(p => p > 0).length;
      result.push({
        key,
        count: list.length,
        totalPnl: total,
        winRate: list.length ? (wins / list.length) * 100 : 0,
      });
    }
    return result.sort((a, b) => b.totalPnl - a.totalPnl);
  }

  function bySymbol(trades) {
    return groupBy(trades, t => t.symbol);
  }

  function byTag(trades) {
    const closed = closedTrades(trades);
    const map = new Map();
    for (const t of closed) {
      const tags = (t.tags && t.tags.length) ? t.tags : ['__untagged__'];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push(t);
      }
    }
    const result = [];
    for (const [key, list] of map.entries()) {
      const pnls = list.map(pnl);
      const total = pnls.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(p => p > 0).length;
      result.push({ key, count: list.length, totalPnl: total, winRate: list.length ? (wins / list.length) * 100 : 0 });
    }
    return result.sort((a, b) => b.totalPnl - a.totalPnl);
  }

  // Locale-independent weekday keys (getDay(): 0 = Sunday) — app.js translates
  // these for display, keeping this module free of any language dependency.
  function byWeekday(trades) {
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return groupBy(trades, t => keys[new Date(t.exitDate || t.date).getDay()]);
  }

  // Tages-P&L als Map<'YYYY-MM-DD', {pnl, count}> — Basis für die Kalender-Heatmap.
  function pnlByDay(trades) {
    const closed = closedTrades(trades);
    const map = new Map();
    for (const t of closed) {
      const day = t.exitDate || t.date;
      const p = pnl(t);
      const entry = map.get(day) || { pnl: 0, count: 0 };
      entry.pnl += p;
      entry.count += 1;
      map.set(day, entry);
    }
    return map;
  }

  function monthToDatePnl(trades, year, month) {
    const closed = closedTrades(trades);
    let total = 0;
    for (const t of closed) {
      const d = new Date(t.exitDate || t.date);
      if (d.getFullYear() === year && d.getMonth() === month) total += pnl(t);
    }
    return total;
  }

  // P&L je Kalendermonat als Map<'YYYY-M', number> in einem einzigen Durchlauf —
  // deutlich schneller als monthToDatePnl() N-mal hintereinander aufzurufen
  // (z.B. für einen 24-Monats-Chart: ein Scan statt 24).
  function pnlByMonth(trades) {
    const closed = closedTrades(trades);
    const map = new Map();
    for (const t of closed) {
      const d = new Date(t.exitDate || t.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      map.set(key, (map.get(key) || 0) + pnl(t));
    }
    return map;
  }

  function pnlDistribution(trades, bucketSize = null) {
    const closed = closedTrades(trades);
    const pnls = closed.map(pnl);
    if (!pnls.length) return [];
    const max = pnls.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
    const size = bucketSize || Math.max(1, Math.ceil(max / 10));
    const buckets = new Map();
    for (const p of pnls) {
      const bucket = Math.floor(p / size) * size;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, count]) => ({ bucket, count, label: `${bucket >= 0 ? '+' : ''}${bucket}` }));
  }

  const R_CHART_MAX_POINTS = 300;

  function rMultipleDistribution(trades) {
    const closed = closedTrades(trades).filter(t => rMultiple(t) != null);
    const points = closed.map(t => ({ symbol: t.symbol, date: t.exitDate || t.date, r: rMultiple(t) }));
    // Ein Balken pro Trade skaliert nicht auf tausende Trades (Chart.js wird dann
    // sehr langsam und die Balken sind ohnehin nicht mehr einzeln lesbar).
    return downsample(points, R_CHART_MAX_POINTS);
  }

  return {
    pnl,
    pnlPercent,
    rMultiple,
    notional,
    marginUsed,
    returnOnMargin,
    impliedLeverage,
    isHighLeverage,
    liquidationPrice,
    stopBeyondLiquidation,
    HIGH_LEVERAGE_THRESHOLD,
    closedTrades,
    summary,
    equity,
    bySymbol,
    byTag,
    byWeekday,
    pnlByDay,
    monthToDatePnl,
    pnlByMonth,
    pnlDistribution,
    rMultipleDistribution,
  };
})();
