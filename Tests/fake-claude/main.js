// Stand-in for the Claude desktop app: serves a fake https://claude.ai (a
// sidebar page, a usage popover modelled on Claude's, and the usage API) and
// loads Extension/ into the default session, as Claude does when started
// with REACT_PROFILE=1. Prints the widget state after each step.
const { app, BrowserWindow, protocol, session } = require('electron');
const path = require('path');

const PAGE = `<!doctype html><html lang="en" style="--cds-fill-accent:#2a78d6"><body style="width:300px;font:14px sans-serif">
<div class="dframe-nav-scroll">
  <div><a>Artifacts</a><a>Customize</a><button id="more" aria-expanded="false" class="nav-row"><span data-cds="Icon" aria-hidden="true" style="font-size:16px">&#xe000;</span><span class="text-muted">More</span></button></div>
  <div class="dframe-recents-by-mode"><div class="df-label-inset"><button><span>Projects</span></button></div><ul><li>Booking UI</li></ul></div>
</div>
<div id="portal-root"></div>
</body></html>`;

const POPOVER = `<div data-cds="Popover" role="dialog"><div>
  <div class="usage-header"><span class="text-footnote text-muted">Plan usage limits · Max (20x)</span><a href="/settings/usage">→</a></div>
  <div class="usage-list">
    ${['Session limit', 'Weekly · all models', 'Weekly · Fable'].map((label, index) => `
      <div><div><span id="limit-${index}">${label}</span><span>1%</span></div>
      <div role="progressbar" aria-labelledby="limit-${index}" style="margin-top:4px;height:4px"><div style="height:100%;width:1%;background:${index === 1 ? '#f5b83d' : 'var(--cds-fill-accent)'}"></div></div></div>`).join('')}
  </div>
</div></div>`;

function usage() {
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const week = at(6 * 86_400_000);
  return {
    limits: [
      { kind: 'session', percent: 9, resets_at: at((4 * 60 + 17) * 60_000) },
      { kind: 'weekly_all', percent: 30, resets_at: week },
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 4, resets_at: week },
    ],
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function state(contents) {
  return contents.executeJavaScript(`(async () => {
    const widget = document.getElementById('usage-pace');
    const header = widget?.querySelector('.up-header');
    const popover = document.querySelector('[data-cds="Popover"]');
    let mutations = 0;
    const counter = new MutationObserver((records) => { mutations += records.length; });
    counter.observe(document.body, { childList: true, subtree: true, characterData: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    counter.disconnect();
    return {
      sidebar: widget?.isConnected ? {
        header: header.innerText.replace(/\\s+/g, ' ').trim(),
        headerClasses: header.className,
        iconSize: [...header.querySelectorAll('svg')].map((svg) => Math.round(svg.getBoundingClientRect().width)),
        headerIds: widget.querySelectorAll('[id]').length,
        rowsVisible: widget.querySelector('.up-rows').getBoundingClientRect().height > 0,
        text: widget.querySelector('.up-rows').innerText,
        previous: widget.previousElementSibling.textContent.replace(/[^\\x20-\\x7e]/g, '').trim(),
        next: widget.nextElementSibling.className,
        over: widget.querySelectorAll('.up-in-sidebar .up-segment-over').length,
        buffer: widget.querySelectorAll('.up-in-sidebar .up-segment-buffer').length,
        styled: getComputedStyle(widget.querySelector('.up-track')).position === 'relative',
      } : null,
      popover: popover && {
        pace: popover.querySelector('.up-popover-pace')?.textContent ?? null,
        lines: [...popover.querySelectorAll('[role="progressbar"]')].map((bar) => bar.previousElementSibling.classList.contains('up-time')),
        overLines: popover.querySelectorAll('.up-in-popover .up-segment-over').length,
        onWarning: [...popover.querySelectorAll('.up-in-popover')].map((line) => line.classList.contains('up-on-warning')),
        settings: [...popover.querySelectorAll('.up-settings input')].map((input) => input.dataset.setting + ':' + input.checked),
        settingsText: popover.querySelector('.up-settings')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
        settingsRows: popover.querySelectorAll('.up-settings').length,
        removedHint: popover.querySelector('.up-settings.up-removed')?.innerText ?? null,
      },
      mutations,
    };
  })()`);
}

async function step(contents, name, script) {
  if (script) await contents.executeJavaScript(script);
  await delay(400);
  console.log(name + ' ' + JSON.stringify(await state(contents)));
}

app.whenReady().then(async () => {
  // The organization comes from the lastActiveOrg cookie, as on claude.ai;
  // /api/organizations lists another one to prove the cookie wins.
  protocol.handle('https', (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/organizations/org-active/usage') return Response.json(usage());
    if (pathname === '/api/organizations') return Response.json([{ uuid: 'org-other' }]);
    if (pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
  });
  await session.defaultSession.clearStorageData();
  await session.defaultSession.cookies.set({ url: 'https://claude.ai', name: 'lastActiveOrg', value: 'org-active' });
  await session.defaultSession.extensions.loadExtension(path.join(__dirname, '..', '..', 'Extension'));

  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const { webContents: contents } = win;
  await win.loadURL('https://claude.ai/epitaxy/test');
  await delay(1000);

  await step(contents, 'LOADED');
  await step(contents, 'POPOVER', `document.getElementById('portal-root').innerHTML = ${JSON.stringify(POPOVER)}`);
  await step(contents, 'COLLAPSED', `document.querySelector('#usage-pace .up-header').click()`);
  await step(contents, 'POPOVER_OFF', `document.querySelector('.up-settings input[data-setting="popover"]').click()`);
  await step(contents, 'SIDEBAR_OFF', `document.querySelector('.up-settings input[data-setting="sidebar"]').click()`);
  contents.reload();
  await delay(1000);
  await step(contents, 'RELOADED', `document.getElementById('portal-root').innerHTML = ${JSON.stringify(POPOVER)}`);
  await step(contents, 'SIDEBAR_ON', `document.querySelector('.up-settings input[data-setting="sidebar"]').click()`);
  await step(contents, 'CONFIRM', `document.querySelector('.up-uninstall').click()`);
  await step(contents, 'CANCELLED', `document.querySelector('.up-confirm-cancel').click()`);
  await step(contents, 'UNINSTALLED', `document.querySelector('.up-uninstall').click(); document.querySelector('.up-confirm-remove').click()`);
  contents.reload();
  await delay(1000);
  await step(contents, 'AFTER_UNINSTALL', `document.getElementById('portal-root').innerHTML = ${JSON.stringify(POPOVER)}`);
  app.quit();
});
