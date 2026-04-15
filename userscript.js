// ==UserScript==
// @name         YouTube Fullscreen Zoom + Pan
// @namespace    local.youtube.fullscreen.zoom
// @version      1.0.0
// @description  Масштабирование и панорамирование видео на YouTube в полноэкранном режиме
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    minScale: 1,
    maxScale: 4,
    wheelStep: 0.05,
    keyZoomStep: 0.10,
    keyPanStep: 40,
    requireAltForWheel: true,
    requireAltForDrag: true,
  };

  const state = {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    dragPointerId: null,
    dragStartClientX: 0,
    dragStartClientY: 0,
    dragStartX: 0,
    dragStartY: 0,
    hudTimer: null,
    rafScheduled: false,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      target.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT'
    );
  }

  function getPlayer() {
    return (
      document.querySelector('.html5-video-player.ytp-fullscreen') ||
      document.querySelector('#movie_player.html5-video-player') ||
      document.querySelector('.html5-video-player')
    );
  }

  function getVideo() {
    const player = getPlayer();
    return player ? player.querySelector('video.video-stream.html5-main-video') : null;
  }

  function isFullscreenPlayer(player = getPlayer()) {
    if (!player) return false;

    const fsEl = document.fullscreenElement;
    return (
      player.classList.contains('ytp-fullscreen') ||
      fsEl === player ||
      (!!fsEl && fsEl.contains(player))
    );
  }

  function saveOriginalStyles(video) {
    if (!video.dataset.tmZoomOriginalTransform) {
      video.dataset.tmZoomOriginalTransform = video.style.transform || '';
      video.dataset.tmZoomOriginalTransformOrigin = video.style.transformOrigin || '';
      video.dataset.tmZoomOriginalWillChange = video.style.willChange || '';
      video.dataset.tmZoomOriginalCursor = video.style.cursor || '';
    }
  }

  function restoreVideoStyles(video) {
    if (!video) return;

    if (video.dataset.tmZoomOriginalTransform !== undefined) {
      video.style.transform = video.dataset.tmZoomOriginalTransform;
      video.style.transformOrigin = video.dataset.tmZoomOriginalTransformOrigin || '';
      video.style.willChange = video.dataset.tmZoomOriginalWillChange || '';
      video.style.cursor = video.dataset.tmZoomOriginalCursor || '';

      delete video.dataset.tmZoomOriginalTransform;
      delete video.dataset.tmZoomOriginalTransformOrigin;
      delete video.dataset.tmZoomOriginalWillChange;
      delete video.dataset.tmZoomOriginalCursor;
    } else {
      video.style.transform = '';
      video.style.transformOrigin = '';
      video.style.willChange = '';
      video.style.cursor = '';
    }
  }

  function getHud(player) {
    let hud = player.querySelector('#tm-yt-zoom-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'tm-yt-zoom-hud';
      hud.style.cssText = [
        'position:absolute',
        'top:18px',
        'right:18px',
        'z-index:999999',
        'padding:8px 12px',
        'border-radius:10px',
        'background:rgba(0,0,0,0.72)',
        'color:#fff',
        'font:600 14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .18s ease',
        'white-space:pre-line',
        'backdrop-filter:blur(4px)',
      ].join(';');
      player.appendChild(hud);
    }
    return hud;
  }

  function hideHud() {
    document.querySelectorAll('#tm-yt-zoom-hud').forEach((el) => {
      el.style.opacity = '0';
    });
  }

  function showHud() {
    const player = getPlayer();
    if (!player || !isFullscreenPlayer(player)) return;

    const hud = getHud(player);
    hud.textContent =
      `Zoom ${state.scale.toFixed(2)}x\n` +
      `X ${Math.round(state.x)}  Y ${Math.round(state.y)}`;
    hud.style.opacity = '1';

    if (state.hudTimer) clearTimeout(state.hudTimer);
    state.hudTimer = setTimeout(() => {
      hud.style.opacity = '0';
    }, 1200);
  }

  function clampPanToBounds(video) {
    if (!video) return;

    const baseWidth = video.clientWidth || 0;
    const baseHeight = video.clientHeight || 0;

    if (!baseWidth || !baseHeight) return;

    const maxX = Math.max(0, ((baseWidth * state.scale) - baseWidth) / 2);
    const maxY = Math.max(0, ((baseHeight * state.scale) - baseHeight) / 2);

    state.x = clamp(state.x, -maxX, maxX);
    state.y = clamp(state.y, -maxY, maxY);

    if (state.scale <= 1.0001) {
      state.x = 0;
      state.y = 0;
    }
  }

  function applyTransform(show = false) {
    const player = getPlayer();
    const video = getVideo();

    document.querySelectorAll('video.video-stream.html5-main-video').forEach((v) => {
      if (v !== video) restoreVideoStyles(v);
    });

    if (!player || !video || !isFullscreenPlayer(player)) {
      if (video) restoreVideoStyles(video);
      hideHud();
      return;
    }

    saveOriginalStyles(video);
    clampPanToBounds(video);

    video.style.transformOrigin = 'center center';
    video.style.willChange = 'transform';
    video.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    video.style.cursor = state.dragging ? 'grabbing' : (state.scale > 1 ? 'grab' : '');

    if (show) showHud();
  }

  function resetTransform(show = true) {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    applyTransform(show);
  }

  function zoomBy(delta, show = true) {
    const next = clamp(
      +(state.scale + delta).toFixed(3),
      CONFIG.minScale,
      CONFIG.maxScale
    );
    state.scale = next;
    clampPanToBounds(getVideo());
    applyTransform(show);
  }

  function panBy(dx, dy, show = true) {
    if (state.scale <= 1) return;
    state.x += dx;
    state.y += dy;
    clampPanToBounds(getVideo());
    applyTransform(show);
  }

  function scheduleSync() {
    if (state.rafScheduled) return;
    state.rafScheduled = true;
    requestAnimationFrame(() => {
      state.rafScheduled = false;
      applyTransform(false);
    });
  }

  function onWheel(event) {
    const player = getPlayer();
    if (!player || !isFullscreenPlayer(player)) return;
    if (!player.contains(event.target)) return;
    if (CONFIG.requireAltForWheel && !event.altKey) return;

    event.preventDefault();
    event.stopPropagation();

    const delta = event.deltaY < 0 ? CONFIG.wheelStep : -CONFIG.wheelStep;
    zoomBy(delta, true);
  }

  function onKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    if (!isFullscreenPlayer()) return;

    let handled = false;

    if (event.altKey && (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd')) {
      zoomBy(CONFIG.keyZoomStep, true);
      handled = true;
    } else if (event.altKey && (event.key === '-' || event.code === 'NumpadSubtract')) {
      zoomBy(-CONFIG.keyZoomStep, true);
      handled = true;
    } else if (event.altKey && event.key === '0') {
      resetTransform(true);
      handled = true;
    } else if (event.altKey && event.key === 'ArrowLeft') {
      panBy(-CONFIG.keyPanStep, 0, true);
      handled = true;
    } else if (event.altKey && event.key === 'ArrowRight') {
      panBy(CONFIG.keyPanStep, 0, true);
      handled = true;
    } else if (event.altKey && event.key === 'ArrowUp') {
      panBy(0, -CONFIG.keyPanStep, true);
      handled = true;
    } else if (event.altKey && event.key === 'ArrowDown') {
      panBy(0, CONFIG.keyPanStep, true);
      handled = true;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onPointerDown(event) {
    const player = getPlayer();
    const video = getVideo();

    if (!player || !video || !isFullscreenPlayer(player)) return;
    if (!video.contains(event.target)) return;
    if (state.scale <= 1) return;
    if (CONFIG.requireAltForDrag && !event.altKey) return;
    if (event.button !== 0) return;

    state.dragging = true;
    state.dragPointerId = event.pointerId;
    state.dragStartClientX = event.clientX;
    state.dragStartClientY = event.clientY;
    state.dragStartX = state.x;
    state.dragStartY = state.y;

    video.style.cursor = 'grabbing';
    if (video.setPointerCapture) {
      try {
        video.setPointerCapture(event.pointerId);
      } catch (_) {}
    }

    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    if (state.dragPointerId !== event.pointerId) return;

    state.x = state.dragStartX + (event.clientX - state.dragStartClientX);
    state.y = state.dragStartY + (event.clientY - state.dragStartClientY);

    clampPanToBounds(getVideo());
    applyTransform(true);

    event.preventDefault();
    event.stopPropagation();
  }

  function stopDragging() {
    if (!state.dragging) return;
    state.dragging = false;
    state.dragPointerId = null;
    applyTransform(false);
  }

  function onPointerUp(event) {
    if (state.dragPointerId !== null && event.pointerId !== state.dragPointerId) return;
    stopDragging();
  }

  function onFullscreenChange() {
    stopDragging();
    applyTransform(false);
  }

  function onResize() {
    scheduleSync();
  }

  function initObservers() {
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('fullscreenchange', onFullscreenChange, true);
    document.addEventListener('yt-navigate-finish', scheduleSync, true);
    window.addEventListener('resize', onResize, true);
    window.addEventListener('blur', stopDragging, true);

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    scheduleSync();
  }

  initObservers();
})();
