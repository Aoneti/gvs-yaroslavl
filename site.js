'use strict';
// Общее для всех страниц: SVG-иконки и динамический год в подвале.
// Подключается раньше остальных скриптов страницы (app-*.js используют GVS_UI.icon).
(function () {
  const SPRITE = 'assets/icons.svg';   // относительный путь: сайт живёт в подпапке /gvs-yaroslavl/

  /**
   * Разметка иконки из спрайта: icon('search') → <svg class="icon"><use href="assets/icons.svg#i-search"/></svg>.
   * Второй аргумент — дополнительные классы, например icon('loader', 'icon--spin state-icon').
   */
  function icon(name, extraClass) {
    return '<svg class="icon' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true" focusable="false">' +
      '<use href="' + SPRITE + '#i-' + name + '"></use></svg>';
  }

  window.GVS_UI = { icon };

  // Год в подвале: <span data-year>2026</span> → текущий год (без JS остаётся то, что написано в разметке)
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
}());
