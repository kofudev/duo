const nav = document.querySelector('#navigation');
const menu = document.querySelector('.menu-toggle');
function closeMenu() {
  menu.setAttribute('aria-expanded', 'false');
  nav.classList.remove('is-open');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
});
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab, focus = false) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      activateTab(tabs[next], true);
    }
  });
}
for (const button of document.querySelectorAll('[data-copy]'))
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copié';
      document.querySelector('#copy-status').textContent =
        `Commande copiée : ${button.dataset.copy}`;
      setTimeout(() => {
        button.textContent = 'Copier';
      }, 2200);
    } catch {
      document.querySelector('#copy-status').textContent =
        'Copie indisponible. Sélectionnez la commande et copiez-la manuellement.';
    }
  });
// Local manifest only. Downloads already work without JavaScript or this file.
fetch('release.json')
  .then((response) => {
    if (!response.ok) throw new Error('Manifest unavailable');
    return response.json();
  })
  .then((release) => {
    if (!/^\d+\.\d+\.\d+$/.test(release.version)) return;
    for (const node of document.querySelectorAll('[data-version]'))
      node.textContent = release.version;
    for (const [kind, asset] of Object.entries(release.assets || {})) {
      const url = new URL(asset.url);
      if (
        url.origin !== 'https://github.com' ||
        !url.pathname.startsWith('/kofudev/duo/releases/download/')
      )
        continue;
      for (const node of document.querySelectorAll(`[data-download="${kind}"]`))
        node.href = url.href;
      if (Number.isFinite(asset.bytes) && asset.bytes > 0)
        for (const node of document.querySelectorAll(`[data-size="${kind}"]`))
          node.textContent = `${kind === 'installer' ? '.exe' : '.zip'} · ${(asset.bytes / 1048576).toFixed(0)} Mo · Windows x64`;
    }
  })
  .catch(() => {});
