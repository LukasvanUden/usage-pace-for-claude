// Content script for https://claude.ai inside the Claude desktop app. Reads
// plan usage through claude.ai's own API and shows it in two places: a
// collapsible "Usage" row below "More" in the sidebar, and Claude's own usage
// popover. Above each usage bar, a time line shows how far the window has
// progressed: grey where usage and time agree, then green for time still
// ahead of usage, or orange for usage ahead of time. A settings row in the
// popover turns either place on or off.
(function () {
  const WIDGET_ID = 'usage-pace';
  const HOUR_MS = 3_600_000;
  const WINDOW_MS = { session: 5 * HOUR_MS, weekly_all: 7 * 24 * HOUR_MS, weekly_scoped: 7 * 24 * HOUR_MS };
  const ON_PACE_POINTS = 3;
  const POLL_MS = 60_000;
  const NAME = 'Usage Pace';
  const GAUGE_PATHS = ['M3.8 14.2a6.8 6.8 0 1 1 12.4 0', 'M10 11.2l3.2-3.4'];

  const STRINGS = {
    en: {
      title: 'Usage',
      fiveHour: 'Session limit',
      weekly: (name) => 'Weekly · ' + name,
      allModels: 'all models',
      hoursMinutes: (h, m) => (h > 0 ? h + ' hr ' : '') + m + ' min',
      over: (d) => d + '% over pace',
      under: (d) => d + '% under pace',
      onPace: 'On pace',
      sidebar: 'Sidebar',
      popover: 'Popover',
      uninstall: 'Uninstall…',
      confirmUninstall: 'Remove Usage Pace from Claude?',
      cancel: 'Cancel',
      remove: 'Remove',
      removed: 'Hidden. To remove Usage Pace completely, open the Usage Pace app in Applications or move it to the Trash.',
    },
    de: {
      title: 'Nutzung',
      fiveHour: '5-Stunden-Limit',
      weekly: (name) => 'Wöchentlich · ' + name,
      allModels: 'alle Modelle',
      hoursMinutes: (h, m) => (h > 0 ? h + ' Std. ' : '') + m + ' Min.',
      over: (d) => d + ' % über Plan',
      under: (d) => d + ' % unter Plan',
      onPace: 'Im Plan',
      sidebar: 'Seitenleiste',
      popover: 'Popover',
      uninstall: 'Deinstallieren…',
      confirmUninstall: 'Usage Pace aus Claude entfernen?',
      cancel: 'Abbrechen',
      remove: 'Entfernen',
      removed: 'Ausgeblendet. Zum vollständigen Entfernen die App „Usage Pace“ in Programme öffnen oder in den Papierkorb legen.',
    },
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatReset(resetAt, kind, now, strings, locale) {
    if (resetAt === null) return null;
    if (kind === 'session') {
      const minutes = Math.max(1, Math.ceil((resetAt - now) / 60_000));
      return strings.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
    }
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      .format(new Date(resetAt));
  }

  // Same rows as Claude's own usage popover, which reads the `limits` list;
  // older responses only have the five_hour and seven_day windows.
  function limitsOf(usage) {
    if (Array.isArray(usage?.limits)) return usage.limits;
    return [
      { kind: 'session', percent: usage?.five_hour?.utilization, resets_at: usage?.five_hour?.resets_at },
      { kind: 'weekly_all', percent: usage?.seven_day?.utilization, resets_at: usage?.seven_day?.resets_at },
    ];
  }

  function buildView(usage, now, lang, locale) {
    if (!usage) return null;
    const strings = STRINGS[lang] ?? STRINGS.en;
    let pace = null;
    const rows = limitsOf(usage).flatMap((limit) => {
      const windowMs = WINDOW_MS[limit?.kind];
      const model = String(limit?.scope?.model?.display_name ?? '').trim();
      if (!windowMs || !Number.isFinite(limit.percent) || (limit.kind === 'weekly_scoped' && !model)) return [];

      const label = limit.kind === 'session'
        ? strings.fiveHour
        : strings.weekly(limit.kind === 'weekly_all' ? strings.allModels : model);
      const used = clamp(Math.floor(limit.percent), 0, 100);
      const parsedReset = Date.parse(limit.resets_at ?? '');
      const resetAt = Number.isFinite(parsedReset) ? parsedReset : null;
      const elapsed = resetAt === null ? null : clamp(100 - ((resetAt - now) / windowMs) * 100, 0, 100);

      if (limit.kind === 'weekly_all' && elapsed !== null) {
        const delta = Math.round(used - elapsed);
        pace = Math.abs(delta) <= ON_PACE_POINTS ? strings.onPace : delta > 0 ? strings.over(delta) : strings.under(-delta);
      }
      const time = elapsed === null
        ? null
        : { shared: Math.min(used, elapsed), end: Math.max(used, elapsed), over: used > elapsed };
      const reset = formatReset(resetAt, limit.kind, now, strings, locale);
      return [{ label, used, time, meta: (reset ? reset + ' · ' : '') + used + '%' }];
    });
    return { rows, pace };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { buildView };
  }
  if (typeof document === 'undefined') return;

  const SECTION_HEADERS = /^(Projects|Projekte|Pinned|Angeheftet|Recents|Zuletzt verwendet|Ungrouped|Nicht gruppiert)$/i;
  const MORE = /^(More|Mehr)$/i;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Preferences live in claude.ai's localStorage; everything defaults to on.
  function stored(key) {
    try {
      return localStorage.getItem('usage-pace:' + key);
    } catch {
      return null;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem('usage-pace:' + key, typeof value === 'string' ? value : value ? '1' : '0');
    } catch {}
  }

  // Every install stamps a new id into the manifest, so "Uninstall…" hides
  // the extension until Usage Pace is installed again.
  const INSTALL_ID = (() => {
    try {
      return chrome.runtime.getManifest().version_name ?? '';
    } catch {
      return '';
    }
  })();

  const settings = { sidebar: stored('sidebar') !== '0', popover: stored('popover') !== '0' };
  let removed = stored('removed') === INSTALL_ID;
  let collapsed = stored('collapsed') === '1';
  let usage = null;
  let view = null;
  let version = 0;
  let widget = null;
  let header = null;
  let headerLabel = null;
  let headerPace = null;
  let rows = null;
  let before = null;
  let scheduled = null;
  let timer = null;

  function strings() {
    return STRINGS[language()] ?? STRINGS.en;
  }

  function language() {
    return (document.documentElement.lang || navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function findLabel(pattern) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('#' + WIDGET_ID)) continue;
      if (pattern.test(node.nodeValue.trim()) && visible(parent)) return parent;
    }
    return null;
  }

  // Grey up to where usage and time agree; the colored segment below it
  // spans to whichever of the two is further along.
  function timeLine(time, className) {
    const line = element('div', 'up-time ' + className);
    line.dataset.version = String(version);
    if (time) {
      const difference = element('div', 'up-segment ' + (time.over ? 'up-segment-over' : 'up-segment-buffer'));
      difference.style.width = time.end + '%';
      const shared = element('div', 'up-segment up-segment-elapsed');
      shared.style.width = time.shared + '%';
      line.append(difference, shared);
    }
    return line;
  }

  // Sidebar -----------------------------------------------------------------

  // The widget goes right before the sidebar's recents/projects block. Claude's
  // layout classes work in every language; the English and German labels are
  // the fallback: the lowest container holding "More" and the first section
  // header, right before the block with that header.
  function findSlot() {
    const recents = document.querySelector('.dframe-nav-scroll > .dframe-recents-by-mode');
    const label = recents?.querySelector('.df-label-inset span');
    if (recents && label && visible(label)) return { parent: recents.parentElement, before: recents, header: label };

    const more = findLabel(MORE);
    const sectionHeader = more && findLabel(SECTION_HEADERS);
    if (!sectionHeader) return null;
    let parent = more.parentElement;
    while (parent && !parent.contains(sectionHeader)) parent = parent.parentElement;
    if (!parent) return null;
    let block = sectionHeader;
    while (block.parentElement !== parent) block = block.parentElement;
    return { parent, before: block, header: sectionHeader };
  }

  function setCollapsed(value) {
    collapsed = value;
    store('collapsed', value);
    widget.classList.toggle('up-collapsed', value);
    header?.setAttribute('aria-expanded', String(!value));
  }

  function gaugeIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('fill', 'none');
    svg.append(...GAUGE_PATHS.map((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      return path;
    }));
    return svg;
  }

  // "Usage" is a copy of the sidebar's last row ("More"), so it looks and
  // hovers like its neighbours. React ignores the copy, so clicks stay ours.
  function buildHeader(group) {
    const template = [...(group?.querySelectorAll('button') ?? [])].pop();
    const button = template ? template.cloneNode(true) : element('button');
    // Claude draws icons with an icon font: the gauge replaces the glyph and
    // takes its size from the icon's font size.
    const icon = button.querySelector('[data-cds="Icon"], svg');
    const gauge = gaugeIcon();
    if (icon instanceof SVGElement) icon.replaceWith(gauge);
    else if (icon) icon.replaceChildren(gauge);
    else button.prepend(gauge);
    for (const node of [button, ...button.querySelectorAll('*')]) {
      for (const { name } of [...node.attributes]) {
        if (name === 'id' || name.startsWith('aria-') || name.startsWith('data-')) node.removeAttribute(name);
      }
    }
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.trim()) texts.push(node);
    texts.slice(1).forEach((node) => node.remove());
    headerLabel = texts[0]?.parentElement ?? button.appendChild(element('span'));
    headerPace = element('span', 'up-pace');
    button.append(headerPace);
    button.type = 'button';
    button.classList.add('up-header');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(!collapsed);
    });
    return button;
  }

  function renderSidebar() {
    if (!widget) {
      widget = element('div');
      widget.id = WIDGET_ID;
      rows = element('div', 'up-rows');
      widget.append(rows);
    }
    rows.replaceChildren(...view.rows.map((row) => {
      const top = element('div', 'up-top');
      top.append(element('span', 'up-label', row.label), element('span', 'up-meta', row.meta));
      const track = element('div', 'up-track');
      const fill = element('div', 'up-fill');
      fill.style.width = row.used + '%';
      track.append(fill);
      const container = element('div', 'up-row');
      container.append(top, timeLine(row.time, 'up-in-sidebar'), track);
      return container;
    }));
    if (header) {
      headerLabel.textContent = strings().title;
      headerPace.textContent = view.pace ?? '';
    }
  }

  function place() {
    if (!widget) return;
    if (removed || !settings.sidebar) {
      widget.remove();
      return;
    }
    if (widget.isConnected && before?.isConnected && widget.nextElementSibling === before) return;
    const slot = findSlot();
    if (!slot) {
      widget.remove();
      return;
    }
    before = slot.before;
    if (!header) {
      const group = before.previousElementSibling === widget ? widget.previousElementSibling : before.previousElementSibling;
      header = buildHeader(group);
      widget.prepend(header);
      setCollapsed(collapsed);
      renderSidebar();
    }
    const inset = slot.header.getBoundingClientRect().left - slot.parent.getBoundingClientRect().left;
    rows.style.padding = '0 ' + Math.max(8, Math.round(inset)) + 'px';
    slot.parent.insertBefore(widget, before);
  }

  // Popover -----------------------------------------------------------------

  // Claude's usage popover: its section header links to /settings/usage, and
  // each limit is a progressbar labelled by its row title.
  function usageSection() {
    const root = document.getElementById('portal-root') ?? document.body;
    const link = root.querySelector('[data-cds="Popover"] a[href="/settings/usage"]');
    const headerRow = link?.parentElement;
    const list = headerRow?.nextElementSibling;
    return list ? { link, headerRow, list } : null;
  }

  function uninstall(row) {
    removed = true;
    store('removed', INSTALL_ID);
    row.classList.add('up-removed');
    row.replaceChildren(element('span', null, strings().removed));
    place();
    enhancePopover();
  }

  function buildSettings() {
    const row = element('div', 'up-settings');
    row.append(element('span', 'up-settings-name', NAME));
    for (const name of ['sidebar', 'popover']) {
      const toggle = element('label', 'up-toggle');
      const input = element('input');
      input.type = 'checkbox';
      input.checked = settings[name];
      input.dataset.setting = name;
      input.addEventListener('change', () => {
        settings[name] = input.checked;
        store(name, input.checked);
        place();
        enhancePopover();
      });
      toggle.append(input, element('span', null, strings()[name]));
      row.append(toggle);
    }
    row.append(linkButton('up-uninstall', strings().uninstall, () => confirmUninstall(row)));
    return row;
  }

  function linkButton(className, text, onClick) {
    const button = element('button', 'up-link ' + className, text);
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  // "Uninstall…" asks first, in the same row.
  function confirmUninstall(row) {
    row.replaceChildren(
      element('span', 'up-confirm-question', strings().confirmUninstall),
      linkButton('up-confirm-cancel', strings().cancel, () => row.replaceWith(buildSettings())),
      linkButton('up-confirm-remove', strings().remove, () => uninstall(row)),
    );
  }

  // Runs on every DOM change, so it only touches what is missing or outdated
  // and never triggers itself again.
  function enhancePopover() {
    const section = usageSection();
    if (!section) return;
    const { link, headerRow, list } = section;
    const settingsRow = list.querySelector(':scope > .up-settings');
    // After "Uninstall…", only the hint stays until the popover closes.
    if (removed) {
      if (settingsRow && !settingsRow.classList.contains('up-removed')) settingsRow.remove();
    } else if (!settingsRow) {
      list.append(buildSettings());
    }

    const bars = [...list.querySelectorAll('[role="progressbar"]')];
    let pace = headerRow.querySelector(':scope > .up-popover-pace');
    if (removed || !settings.popover || !view) {
      pace?.remove();
      bars.forEach((bar) => bar.previousElementSibling?.classList.contains('up-time') && bar.previousElementSibling.remove());
      return;
    }

    if (!pace) {
      pace = element('span', (headerRow.firstElementChild?.className ?? '') + ' up-popover-pace');
      headerRow.insertBefore(pace, link);
    }
    if (pace.textContent !== (view.pace ?? '')) pace.textContent = view.pace ?? '';

    bars.forEach((bar, index) => {
      const title = document.getElementById(bar.getAttribute('aria-labelledby') ?? '')?.textContent.trim();
      const row = view.rows.find((candidate) => candidate.label === title)
        ?? (bars.length === view.rows.length ? view.rows[index] : null);
      const current = bar.previousElementSibling?.classList.contains('up-time') ? bar.previousElementSibling : null;
      if (!row?.time) {
        current?.remove();
        return;
      }
      let line = current;
      if (current?.dataset.version !== String(version)) {
        line = timeLine(row.time, 'up-in-popover');
        if (current) current.replaceWith(line);
        else bar.before(line);
      }
      // Near the limit Claude paints its bar in a warning color instead of
      // the accent; the "over" segment then turns red to stay distinct.
      // (.up-time carries the accent as its invisible outline color.)
      const fill = bar.firstElementChild;
      const warning = Boolean(fill) && getComputedStyle(fill).backgroundColor !== getComputedStyle(line).outlineColor;
      line.classList.toggle('up-on-warning', warning);
    });
  }

  // Data --------------------------------------------------------------------

  function render() {
    view = buildView(usage, Date.now(), language(), document.documentElement.lang || undefined) ?? view;
    if (!view) return;
    version += 1;
    renderSidebar();
    place();
    enhancePopover();
  }

  async function fetchJson(path) {
    const response = await fetch(path, { credentials: 'include' });
    return response.ok ? response.json() : null;
  }

  async function organizationId() {
    const fromCookie = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
    if (fromCookie) return decodeURIComponent(fromCookie);
    const organizations = await fetchJson('/api/organizations');
    return organizations?.[0]?.uuid ?? null;
  }

  async function refresh() {
    clearTimeout(timer);
    if (!document.hidden) {
      try {
        const organization = await organizationId();
        const next = organization && await fetchJson('/api/organizations/' + encodeURIComponent(organization) + '/usage');
        if (next) usage = next;
      } catch {}
      render();
    }
    timer = setTimeout(refresh, POLL_MS);
  }

  // React re-renders the sidebar and mounts the popover on demand. The
  // popover is enhanced before it paints; the sidebar is re-placed shortly after.
  new MutationObserver(() => {
    enhancePopover();
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      place();
    }, 250);
  }).observe(document.body, { childList: true, subtree: true });

  // Follow Claude's language setting right away.
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('visibilitychange', () => document.hidden || refresh());
  refresh();
})();
