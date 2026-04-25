'use strict';
const GVS_CONFIG = {
  // Пагинация и лимиты
  PER_PAGE: 20,           // карточек на странице в списке
  MAX_LIST_ITEMS: 200,    // максимум элементов в списке на карте
  
  // Статусы и тайминги
  SOON_DAYS: 7,           // дней до начала
  FETCH_TIMEOUT_MS: 12000,// таймаут запроса данных 
  
  // Карта
  MAP_CENTER: [57.6261, 39.8845],  // центр Ярославля
  MAP_ZOOM_DEFAULT: 12,
  MAP_ZOOM_FOCUS: 16,
  CLUSTER_RADIUS: 50,
  
  // Bottom-sheet (mobile)
  SHEET_SNAP_SMALL:  0.30,
  SHEET_SNAP_MEDIUM: 0.60,
  SHEET_SNAP_LARGE:  0.85,
  
  // Mobile breakpoint
  MOBILE_BREAKPOINT: 640,
  
  // Виджеты
  WIDGET_TRACKER_DELAY: 2500,
  WIDGET_SOCIAL_DELAY:  3500,
  
  // Retry configuration
  FETCH_RETRY_COUNT: 3,
  FETCH_RETRY_DELAY: 1000,  // базовая задержка, увеличивается экспоненциально
};

// Экспорт для использования в других модулях
if (typeof window !== 'undefined') {
  window.GVS_CONFIG = GVS_CONFIG;
}
