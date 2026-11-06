/* Light, dark, or the device appearance. Saved in this browser only. */
(() => {
  'use strict';
  const KEY = 'flipbook.theme';
  const CHOICES = ['light', 'dark', 'system'];
  const mq = matchMedia('(prefers-color-scheme: light)');

  function choice() {
    let value = 'system';
    try { value = localStorage.getItem(KEY) || 'system'; } catch (e) {}
    return CHOICES.includes(value) ? value : 'system';
  }

  function resolved(value) {
    if (value === 'light' || value === 'dark') return value;
    return mq.matches ? 'light' : 'dark';
  }

  function apply(value) {
    const theme = resolved(value);
    const root = document.documentElement;
    root.setAttribute('data-theme-choice', value);
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#efeae1' : '#0f1115');
    document.dispatchEvent(new CustomEvent('themechange', { detail: { choice: value, theme } }));
  }

  function set(value) {
    const next = CHOICES.includes(value) ? value : 'system';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
    return next;
  }

  const onScheme = () => { if (choice() === 'system') apply('system'); };
  if (mq.addEventListener) mq.addEventListener('change', onScheme);
  else if (mq.addListener) mq.addListener(onScheme);
  window.addEventListener('storage', (event) => { if (event.key === KEY) apply(choice()); });

  apply(choice());
  window.Theme = {
    get choice() { return choice(); },
    get theme() { return resolved(choice()); },
    set
  };
})();
