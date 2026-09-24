// Inline SVG icon set (stroke-based, 24x24, currentColor) — replaces emoji
// glyphs so nav/icons render identically and crisply across platforms.

const Icons = (() => {
  const PATHS = {
    dashboard: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    trades: '<path d="M6 20V10"/><rect x="4" y="6" width="4" height="6" rx="1"/><path d="M12 20V4"/><rect x="10" y="12" width="4" height="6" rx="1"/><path d="M18 20V13"/><rect x="16" y="8" width="4" height="7" rx="1"/>',
    stats: '<path d="M4 19h16"/><rect x="6" y="12" width="3" height="7" rx="1"/><rect x="11" y="7" width="3" height="12" rx="1"/><rect x="16" y="3" width="3" height="16" rx="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/>',
    danger: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    delete: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H8a2 2 0 0 0-1.94 1.51L4 19"/><path d="M3 7v10a2 2 0 0 0 2 2h13.5a2 2 0 0 0 1.94-1.51L22 12H6.5a2 2 0 0 0-1.94 1.51L3 19"/>',
    sparkle: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M6 6l2.5 2.5"/><path d="M15.5 15.5 18 18"/><path d="M18 6l-2.5 2.5"/><path d="M8.5 15.5 6 18"/><circle cx="12" cy="12" r="2.5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
    chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
    chevronRight: '<path d="M9 18l6-6-6-6"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  function icon(name, cls = '') {
    const body = PATHS[name];
    if (!body) return '';
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  return { icon };
})();
