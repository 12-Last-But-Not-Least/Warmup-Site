/** Optional, per-chart width and fullscreen controls. */
export function addLayoutControls(container, onResize = () => {}, initialWidth = '960') {
  const toolbar = container.querySelector('.scatter-toolbar');
  if (!toolbar) return { getWidth: () => initialWidth, destroy() {} };
  const label = document.createElement('label'); label.className = 'chart-width'; label.append('Maximum width ');
  const width = document.createElement('select'); width.setAttribute('aria-label', 'Chart maximum width');
  for (const [value, text] of [['', 'Fit available width'], ['640', '640 px'], ['800', '800 px'], ['960', '960 px'], ['1200', '1200 px']]) width.add(new Option(text, value));
  const previousWidth = container.style.maxWidth;
  width.value = String(initialWidth);
  container.style.maxWidth = width.value ? `${width.value}px` : 'none';
  width.onchange = () => { container.style.maxWidth = width.value ? `${width.value}px` : 'none'; onResize(); };
  label.append(width);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-fullscreen'; button.textContent = 'Fullscreen';
  const status = document.createElement('span'); status.className = 'chart-layout-status'; status.setAttribute('role', 'status');
  let fallback = container.classList.contains('chart-expanded');
  let previousOverflow = container.dataset.previousOverflow ?? '';
  const expanded = () => document.fullscreenElement === container || fallback;
  function update() { button.textContent = expanded() ? 'Exit fullscreen' : 'Fullscreen'; button.setAttribute('aria-pressed', String(expanded())); onResize(); }
  function exitFallback() { if (!fallback) return; fallback = false; container.classList.remove('chart-expanded'); document.body.style.overflow = previousOverflow; delete container.dataset.previousOverflow; update(); button.focus(); }
  button.onclick = async () => {
    status.textContent = '';
    if (fallback) { exitFallback(); return; }
    if (document.fullscreenElement === container) { await document.exitFullscreen(); return; }
    try {
      if (!container.requestFullscreen) throw new Error('Native fullscreen is unavailable.');
      await container.requestFullscreen();
    } catch {
      previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; fallback = true;
      container.dataset.previousOverflow = previousOverflow;
      container.classList.add('chart-expanded'); update(); status.textContent = 'Expanded view. Press Escape to close.';
    }
  };
  const keydown = event => { if (event.key === 'Escape') exitFallback(); };
  document.addEventListener('fullscreenchange', update); document.addEventListener('keydown', keydown);
  toolbar.append(label, button, status);
  update();
  return { getWidth: () => width.value, destroy(preserveFullscreen = false) {
    if (!preserveFullscreen) exitFallback();
    if (!preserveFullscreen && document.fullscreenElement === container) document.exitFullscreen().catch(() => {});
    document.removeEventListener('fullscreenchange', update); document.removeEventListener('keydown', keydown);
    container.style.maxWidth = previousWidth; label.remove(); button.remove(); status.remove();
  } };
}
