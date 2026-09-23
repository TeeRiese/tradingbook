// Thin wrappers around Chart.js configured to match the Neo-Broker dark theme.

const Charts = (() => {
  const colors = {
    green: '#00d68f',
    red: '#ff5c72',
    accent: '#6c8cff',
    grid: '#1c212a',
    text: '#8b93a1',
  };

  Chart.defaults.color = colors.text;
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif";
  Chart.defaults.font.size = 11;

  const instances = new Map();

  function destroy(id) {
    if (instances.has(id)) {
      instances.get(id).destroy();
      instances.delete(id);
    }
  }

  function equityCurve(canvasId, points) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const values = points.map(p => p.value);
    const positive = values.length && values[values.length - 1] >= values[0];
    const lineColor = positive ? colors.green : colors.red;

    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, positive ? 'rgba(0,214,143,0.25)' : 'rgba(255,92,114,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    const dated = points.filter(p => p.date);
    const spanMs = dated.length > 1 ? new Date(dated[dated.length - 1].date) - new Date(dated[0].date) : 0;
    const spansMultipleYears = spanMs > 340 * 24 * 60 * 60 * 1000;
    const dateFmt = spansMultipleYears
      ? { day: '2-digit', month: '2-digit', year: '2-digit' }
      : { day: '2-digit', month: '2-digit' };

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map(p => p.date ? new Date(p.date).toLocaleDateString(I18n.locale(), dateFmt) : ''),
        datasets: [{
          data: values,
          borderColor: lineColor,
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#14181e',
            borderColor: '#232830',
            borderWidth: 1,
            titleColor: '#eef1f5',
            bodyColor: '#eef1f5',
            padding: 10,
            callbacks: {
              label: (ctx) => ' ' + ctx.parsed.y.toLocaleString(I18n.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            },
          },
        },
        scales: {
          x: { grid: { color: colors.grid, display: false }, ticks: { maxTicksLimit: 6 } },
          y: { grid: { color: colors.grid }, ticks: { callback: v => v.toLocaleString(I18n.locale()) } },
        },
      },
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function barByGroup(canvasId, groups) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: groups.map(g => g.key),
        datasets: [{
          data: groups.map(g => g.totalPnl),
          backgroundColor: groups.map(g => g.totalPnl >= 0 ? colors.green : colors.red),
          borderRadius: 6,
          maxBarThickness: 34,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#14181e', borderColor: '#232830', borderWidth: 1,
            titleColor: '#eef1f5', bodyColor: '#eef1f5', padding: 10,
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: colors.grid } },
        },
      },
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function distributionBars(canvasId, buckets) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [{
          data: buckets.map(b => b.count),
          backgroundColor: buckets.map(b => b.bucket >= 0 ? colors.green : colors.red),
          borderRadius: 4,
          maxBarThickness: 26,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: colors.grid }, ticks: { stepSize: 1 } },
        },
      },
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function rMultipleScatter(canvasId, points) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: points.map(p => p.symbol),
        datasets: [{
          data: points.map(p => p.r),
          backgroundColor: points.map(p => p.r >= 0 ? colors.green : colors.red),
          borderRadius: 4,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { display: false } },
          y: { grid: { color: colors.grid }, title: { display: true, text: 'R', color: colors.text } },
        },
      },
    });
    instances.set(canvasId, chart);
    return chart;
  }

  function monthlyGoalHistory(canvasId, months, target) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      data: {
        labels: months.map(m => m.label),
        datasets: [
          {
            type: 'bar',
            label: I18n.t('goal.monthlyPnl'),
            data: months.map(m => m.pnl),
            backgroundColor: months.map(m => {
              if (m.reached) return colors.green;
              return m.pnl >= 0 ? 'rgba(0, 214, 143, 0.35)' : colors.red;
            }),
            borderRadius: 4,
            maxBarThickness: 22,
            order: 2,
          },
          {
            type: 'line',
            label: I18n.t('goal.target'),
            data: months.map(() => target),
            borderColor: colors.accent,
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#14181e',
            borderColor: '#232830',
            borderWidth: 1,
            titleColor: '#eef1f5',
            bodyColor: '#eef1f5',
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString(I18n.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { grid: { color: colors.grid } },
        },
      },
    });
    instances.set(canvasId, chart);
    return chart;
  }

  return { equityCurve, barByGroup, distributionBars, rMultipleScatter, monthlyGoalHistory, destroy };
})();
