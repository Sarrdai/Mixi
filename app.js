/**
 * Farbmisch-Welt - Haupt-Applikationslogik
 * Interaktives Farbmischen mit Drag & Drop und Click-Modus
 */
(() => {
  'use strict';

  // --- Konstanten ---
  const STORAGE_KEY = 'farbmisch-discovered';
  const SPLATTER_KEY = 'farbmisch-splatters';
  const MIX_STATE_KEY = 'farbmisch-mixpot';

  // --- DOM-Refs ---
  const playground = document.getElementById('playground');
  const colorPotsContainer = document.getElementById('color-pots');
  const mixingPot = document.getElementById('mixing-pot');
  const mixFill = document.getElementById('mix-fill');
  const mixRipple = document.getElementById('mix-ripple');
  const progressDots = document.getElementById('progress-dots');
  const sponge = document.getElementById('sponge-tool');
  const resetBtn = document.getElementById('reset-btn');
  const discoveryPopup = document.getElementById('discovery-popup');
  const popupColor = document.getElementById('popup-color');
  const popupTitle = document.getElementById('popup-title');
  const popupName = document.getElementById('popup-name');
  const popupClose = document.getElementById('popup-close');
  const rewardOverlay = document.getElementById('reward-overlay');
  const rewardColors = document.getElementById('reward-colors');
  const rewardClose = document.getElementById('reward-close');
  const resetModal = document.getElementById('reset-modal');
  const resetInput = document.getElementById('reset-input');
  const resetConfirm = document.getElementById('reset-confirm');
  const resetCancel = document.getElementById('reset-cancel');
  const splatterCanvas = document.getElementById('splatter-canvas');
  const splatterCtx = splatterCanvas.getContext('2d');

  // --- State ---
  let discoveredColors = new Set();
  let selectedPotId = null;
  let mixPotColorId = null;
  let potElements = {};
  let potHomePositions = {};
  let dragging = null; // { el, offsetX, offsetY, startX, startY, type:'pot'|'sponge' }
  let splatters = []; // Saved splatter data
  let rewardShown = false;
  let layoutMode = 'radial'; // 'radial' | 'linear'

  // --- Init ---
  function init() {
    loadState();
    setupSplatterCanvas();
    renderPots();
    renderProgress();
    updateMixPotVisual();
    layoutPots();
    bindEvents();
    restoreSplatters();
  }

  // --- Persistence ---
  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        discoveredColors = new Set(arr);
      }
      const mixState = localStorage.getItem(MIX_STATE_KEY);
      if (mixState) {
        mixPotColorId = JSON.parse(mixState);
      }
      const splatterState = localStorage.getItem(SPLATTER_KEY);
      if (splatterState) {
        splatters = JSON.parse(splatterState);
      }
    } catch (e) {
      discoveredColors = new Set();
    }
    // Ensure primaries are always discovered
    ColorEngine.getPrimaryColors().forEach(c => discoveredColors.add(c.id));
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...discoveredColors]));
    localStorage.setItem(MIX_STATE_KEY, JSON.stringify(mixPotColorId));
    localStorage.setItem(SPLATTER_KEY, JSON.stringify(splatters));
  }

  // --- Splatter canvas ---
  function setupSplatterCanvas() {
    const resize = () => {
      splatterCanvas.width = playground.clientWidth;
      splatterCanvas.height = playground.clientHeight;
      redrawSplatters();
    };
    resize();
    window.addEventListener('resize', resize);
  }

  function addSplatter(x, y, color, size) {
    // Store random seed offsets for consistent redrawing
    const offsets = [];
    for (let i = 0; i < 8; i++) offsets.push(0.7 + Math.random() * 0.6);
    const splat = { x, y, color, size: size || 15 + Math.random() * 25, offsets };
    splatters.push(splat);
    drawSplatter(splat);
    saveState();
  }

  function drawSplatter(s) {
    splatterCtx.save();
    splatterCtx.globalAlpha = 0.35;
    splatterCtx.fillStyle = s.color;
    splatterCtx.beginPath();
    const points = 8;
    const offsets = s.offsets || [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = s.size * (offsets[i] || 1);
      const px = s.x + Math.cos(angle) * r;
      const py = s.y + Math.sin(angle) * r;
      if (i === 0) splatterCtx.moveTo(px, py);
      else splatterCtx.lineTo(px, py);
    }
    splatterCtx.closePath();
    splatterCtx.fill();
    splatterCtx.restore();
  }

  function redrawSplatters() {
    splatterCtx.clearRect(0, 0, splatterCanvas.width, splatterCanvas.height);
    splatters.forEach(drawSplatter);
  }

  function restoreSplatters() {
    redrawSplatters();
  }

  function clearSplattersNear(x, y, radius) {
    const before = splatters.length;
    splatters = splatters.filter(s => {
      const dx = s.x - x;
      const dy = s.y - y;
      return Math.sqrt(dx * dx + dy * dy) > radius;
    });
    if (splatters.length < before) {
      redrawSplatters();
      saveState();
    }
  }

  // --- Render pots ---
  function renderPots() {
    colorPotsContainer.innerHTML = '';
    potElements = {};

    const discovered = [...discoveredColors];
    discovered.forEach(id => {
      const color = ColorEngine.getColor(id);
      if (!color) return;

      const pot = document.createElement('div');
      pot.className = 'pot color-pot';
      pot.dataset.colorId = id;
      pot.setAttribute('role', 'button');
      pot.setAttribute('aria-label', `${color.name} Farbtopf`);

      pot.innerHTML = `
        <div class="pot-body">
          <div class="pot-fill" style="background-color: ${color.hex}"></div>
        </div>
        <div class="pot-label">${color.name}</div>
      `;

      colorPotsContainer.appendChild(pot);
      potElements[id] = pot;
    });
  }

  // --- Layout ---
  function layoutPots() {
    const rect = playground.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const potSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));
    const mixSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mix-pot-size'));

    const centerX = W / 2;
    const centerY = H / 2;

    // Place mixing pot at center
    mixingPot.style.left = (centerX - mixSize / 2) + 'px';
    mixingPot.style.top = (centerY - mixSize / 2) + 'px';

    const ids = [...discoveredColors];
    const n = ids.length;

    // Determine if we use radial or row layout
    const isNarrow = W < 500;

    if (isNarrow && n > 6) {
      layoutLinear(ids, W, H, potSize, mixSize, centerX, centerY);
    } else {
      layoutRadial(ids, W, H, potSize, mixSize, centerX, centerY);
    }
  }

  function layoutRadial(ids, W, H, potSize, mixSize, centerX, centerY) {
    const n = ids.length;
    // Calculate radius to fit all pots
    const minDist = potSize * 1.3;
    const circumference = n * minDist;
    let radius = Math.max(mixSize / 2 + potSize, circumference / (2 * Math.PI));

    // Ensure pots stay within bounds with padding
    const maxRadius = Math.min(W / 2 - potSize, H / 2 - potSize - 20);
    if (radius > maxRadius) {
      // Auto-zoom: shrink pot size via scale
      const scale = maxRadius / radius;
      radius = maxRadius;
      Object.values(potElements).forEach(el => {
        el.style.transform = `scale(${Math.max(0.5, scale)})`;
      });
    } else {
      Object.values(potElements).forEach(el => {
        el.style.transform = '';
      });
    }

    ids.forEach((id, i) => {
      const el = potElements[id];
      if (!el) return;

      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius - potSize / 2;
      const y = centerY + Math.sin(angle) * radius - potSize / 2;

      el.style.left = x + 'px';
      el.style.top = y + 'px';

      potHomePositions[id] = { x, y };
    });
  }

  function layoutLinear(ids, W, H, potSize, mixSize, centerX, centerY) {
    const n = ids.length;
    const cols = Math.ceil(Math.sqrt(n * (W / H)));
    const topCount = Math.ceil(n / 2);
    const bottomCount = n - topCount;

    const topY = 20;
    const bottomY = H - potSize - 30;
    const mixTopBound = centerY - mixSize / 2;
    const mixBotBound = centerY + mixSize / 2;

    // Top row
    const topIds = ids.slice(0, topCount);
    const topSpacing = Math.min(potSize * 1.3, (W - 20) / topCount);
    const topStartX = centerX - (topCount * topSpacing) / 2 + topSpacing / 2 - potSize / 2;

    topIds.forEach((id, i) => {
      const el = potElements[id];
      if (!el) return;
      const x = topStartX + i * topSpacing;
      const y = topY;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      potHomePositions[id] = { x, y };
    });

    // Bottom row
    const botIds = ids.slice(topCount);
    const botSpacing = Math.min(potSize * 1.3, (W - 20) / Math.max(bottomCount, 1));
    const botStartX = centerX - (bottomCount * botSpacing) / 2 + botSpacing / 2 - potSize / 2;

    botIds.forEach((id, i) => {
      const el = potElements[id];
      if (!el) return;
      const x = botStartX + i * botSpacing;
      const y = bottomY;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      potHomePositions[id] = { x, y };
    });
  }

  // --- Progress ---
  function renderProgress() {
    progressDots.innerHTML = '';
    const total = ColorEngine.getTotalDiscoverable();
    const allIds = ColorEngine.getAllColorIds();

    allIds.forEach(id => {
      const dot = document.createElement('div');
      dot.className = 'progress-dot';
      const color = ColorEngine.getColor(id);
      if (discoveredColors.has(id)) {
        dot.classList.add('filled');
        dot.style.backgroundColor = color.hex;
      }
      dot.title = discoveredColors.has(id) ? color.name : '???';
      progressDots.appendChild(dot);
    });
  }

  // --- Mix pot visual ---
  function updateMixPotVisual() {
    if (mixPotColorId) {
      const c = ColorEngine.getColor(mixPotColorId);
      mixFill.style.backgroundColor = c ? c.hex : 'transparent';
    } else {
      mixFill.style.backgroundColor = 'transparent';
    }
  }

  function animateMixFill() {
    mixFill.classList.remove('mix-fill-animate');
    void mixFill.offsetWidth; // force reflow
    mixFill.classList.add('mix-fill-animate');
  }

  function showRipple(color) {
    mixRipple.style.backgroundColor = color;
    mixRipple.classList.remove('active');
    void mixRipple.offsetWidth;
    mixRipple.classList.add('active');
    setTimeout(() => mixRipple.classList.remove('active'), 800);
  }

  // --- Core: Add color to mix ---
  function addToMix(colorId, sourceEl) {
    // Pour animation on source pot
    if (sourceEl) {
      sourceEl.classList.add('pouring');
      setTimeout(() => sourceEl.classList.remove('pouring'), 600);
    }

    const incomingColor = ColorEngine.getColor(colorId);

    // Random splatter near mix pot
    const mixRect = mixingPot.getBoundingClientRect();
    const pgRect = playground.getBoundingClientRect();
    const splashX = (mixRect.left - pgRect.left) + mixRect.width / 2 + (Math.random() - 0.5) * 80;
    const splashY = (mixRect.top - pgRect.top) + mixRect.height / 2 + (Math.random() - 0.5) * 80;
    if (Math.random() > 0.4) {
      addSplatter(splashX, splashY, incomingColor.hex);
    }

    if (!mixPotColorId) {
      // First color in the pot
      mixPotColorId = colorId;
      showRipple(incomingColor.hex);
      animateMixFill();
      updateMixPotVisual();
      saveState();
      return;
    }

    // Mix two colors
    const result = ColorEngine.mix(mixPotColorId, colorId);
    if (!result) return;

    showRipple(incomingColor.hex);

    setTimeout(() => {
      mixPotColorId = result.id;
      animateMixFill();
      updateMixPotVisual();
      saveState();

      // Check if this is a new discovery
      if (!discoveredColors.has(result.id)) {
        discoveredColors.add(result.id);
        saveState();
        renderPots();
        layoutPots();

        // Animate the new pot
        const newPot = potElements[result.id];
        if (newPot) {
          newPot.classList.add('new-discovery');
          setTimeout(() => newPot.classList.remove('new-discovery'), 800);
        }

        // Update progress
        const dot = progressDots.querySelector(`.progress-dot:nth-child(${ColorEngine.getAllColorIds().indexOf(result.id) + 1})`);
        if (dot) {
          dot.classList.add('filled', 'just-found');
          dot.style.backgroundColor = result.color.hex;
          dot.title = result.color.name;
          setTimeout(() => dot.classList.remove('just-found'), 600);
        } else {
          renderProgress();
        }

        // Show discovery popup
        showDiscoveryPopup(result.color);

        // Check for full completion
        if (discoveredColors.size >= ColorEngine.getTotalDiscoverable() && !rewardShown) {
          setTimeout(() => showReward(), 1500);
        }
      }
    }, 300);
  }

  // --- Clear mix pot ---
  function clearMixPot() {
    mixPotColorId = null;
    mixFill.style.backgroundColor = 'transparent';
    animateMixFill();
    saveState();
  }

  // --- Discovery popup ---
  function showDiscoveryPopup(color) {
    popupColor.style.backgroundColor = color.hex;
    popupTitle.textContent = 'Neue Farbe entdeckt!';
    popupName.textContent = color.name;
    discoveryPopup.classList.remove('hidden');
  }

  // --- Reward ---
  function showReward() {
    rewardShown = true;
    rewardColors.innerHTML = '';
    const allIds = ColorEngine.getAllColorIds();
    allIds.forEach((id, i) => {
      const c = ColorEngine.getColor(id);
      const dot = document.createElement('div');
      dot.className = 'reward-color-dot';
      dot.style.backgroundColor = c.hex;
      dot.style.animationDelay = (i * 0.08) + 's';
      rewardColors.appendChild(dot);
    });

    rewardOverlay.classList.remove('hidden');
    spawnConfetti();
  }

  function spawnConfetti() {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#cc5de8'];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + '%';
      el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      el.style.animationDelay = (Math.random() * 1.5) + 's';
      el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
      el.style.width = (6 + Math.random() * 8) + 'px';
      el.style.height = (6 + Math.random() * 8) + 'px';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(el);
    }
  }

  // --- Event binding ---
  function bindEvents() {
    // Pointer events for drag & drop and click
    playground.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    // Click on mixing pot (for click-mode)
    mixingPot.addEventListener('pointerup', onMixPotClick);

    // Popup close
    popupClose.addEventListener('click', () => discoveryPopup.classList.add('hidden'));
    discoveryPopup.addEventListener('click', (e) => {
      if (e.target === discoveryPopup) discoveryPopup.classList.add('hidden');
    });

    // Reward close
    rewardClose.addEventListener('click', () => rewardOverlay.classList.add('hidden'));

    // Reset
    resetBtn.addEventListener('click', () => {
      resetModal.classList.remove('hidden');
      resetInput.value = '';
      resetConfirm.disabled = true;
      setTimeout(() => resetInput.focus(), 100);
    });

    resetInput.addEventListener('input', () => {
      resetConfirm.disabled = resetInput.value.trim().toUpperCase() !== 'RESET';
    });

    resetConfirm.addEventListener('click', performReset);
    resetCancel.addEventListener('click', () => resetModal.classList.add('hidden'));
    resetModal.addEventListener('click', (e) => {
      if (e.target === resetModal) resetModal.classList.add('hidden');
    });

    // Resize
    window.addEventListener('resize', () => {
      layoutPots();
      setupSplatterCanvas();
    });
  }

  // --- Pointer handlers ---
  function onPointerDown(e) {
    // Find if we clicked a color pot
    const pot = e.target.closest('.color-pot');
    const isSponge = e.target.closest('.tool-sponge');

    if (pot) {
      e.preventDefault();
      const id = pot.dataset.colorId;
      const rect = pot.getBoundingClientRect();
      const pgRect = playground.getBoundingClientRect();

      dragging = {
        el: pot,
        type: 'pot',
        colorId: id,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        startX: rect.left - pgRect.left,
        startY: rect.top - pgRect.top,
        moved: false,
      };

      pot.classList.add('dragging');
      pot.classList.remove('returning');
      pot.setPointerCapture(e.pointerId);
    } else if (isSponge) {
      e.preventDefault();
      const rect = sponge.getBoundingClientRect();
      const pgRect = playground.getBoundingClientRect();

      dragging = {
        el: sponge,
        type: 'sponge',
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        startX: rect.left - pgRect.left,
        startY: rect.top - pgRect.top,
        moved: false,
      };

      sponge.classList.add('dragging');
      sponge.classList.remove('returning');
      sponge.setPointerCapture(e.pointerId);

      // Remove bottom/right positioning so we can use left/top
      sponge.style.bottom = 'auto';
      sponge.style.right = 'auto';
      sponge.style.left = (rect.left - pgRect.left) + 'px';
      sponge.style.top = (rect.top - pgRect.top) + 'px';
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();

    const pgRect = playground.getBoundingClientRect();
    const x = e.clientX - pgRect.left - dragging.offsetX;
    const y = e.clientY - pgRect.top - dragging.offsetY;

    dragging.el.style.left = x + 'px';
    dragging.el.style.top = y + 'px';
    dragging.moved = true;

    // Highlight mix pot when hovering
    if (dragging.type === 'pot') {
      const mixRect = mixingPot.getBoundingClientRect();
      const overMix = isOverElement(e.clientX, e.clientY, mixRect);
      mixingPot.classList.toggle('highlight', overMix);
    }

    // Sponge: wipe splatters and mix pot
    if (dragging.type === 'sponge') {
      const spongeX = e.clientX - pgRect.left;
      const spongeY = e.clientY - pgRect.top;
      clearSplattersNear(spongeX, spongeY, 40);

      // Check if sponge is over mix pot
      const mixRect = mixingPot.getBoundingClientRect();
      if (isOverElement(e.clientX, e.clientY, mixRect)) {
        mixingPot.classList.add('highlight');
      } else {
        mixingPot.classList.remove('highlight');
      }
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;

    const pgRect = playground.getBoundingClientRect();
    mixingPot.classList.remove('highlight');

    if (dragging.type === 'pot') {
      const pot = dragging.el;
      const colorId = dragging.colorId;
      pot.classList.remove('dragging');

      if (dragging.moved) {
        // Check if dropped on mix pot
        const mixRect = mixingPot.getBoundingClientRect();
        if (isOverElement(e.clientX, e.clientY, mixRect)) {
          addToMix(colorId, pot);
          deselectAll();
        }

        // Return to home position
        returnPotHome(colorId, pot);
      } else {
        // Click mode: select/deselect
        handlePotClick(colorId, pot);
      }
    } else if (dragging.type === 'sponge') {
      sponge.classList.remove('dragging');

      // Check if dropped on mix pot
      const mixRect = mixingPot.getBoundingClientRect();
      if (dragging.moved && isOverElement(e.clientX, e.clientY, mixRect)) {
        sponge.classList.add('wiping');
        setTimeout(() => sponge.classList.remove('wiping'), 400);
        clearMixPot();
      }

      // Return sponge to home
      returnSpongeHome();
    }

    dragging = null;
  }

  function onMixPotClick(e) {
    // If a pot is selected (click mode) and we click the mix pot
    if (selectedPotId && !dragging) {
      const sourceEl = potElements[selectedPotId];
      addToMix(selectedPotId, sourceEl);
      deselectAll();
    }
  }

  function handlePotClick(colorId, potEl) {
    if (selectedPotId === colorId) {
      // Deselect
      deselectAll();
    } else {
      deselectAll();
      selectedPotId = colorId;
      potEl.classList.add('selected');
    }
  }

  function deselectAll() {
    selectedPotId = null;
    document.querySelectorAll('.pot.selected').forEach(el => el.classList.remove('selected'));
  }

  function returnPotHome(colorId, pot) {
    const home = potHomePositions[colorId];
    if (home) {
      pot.classList.add('returning');
      pot.style.left = home.x + 'px';
      pot.style.top = home.y + 'px';
      setTimeout(() => pot.classList.remove('returning'), 500);
    }
  }

  function returnSpongeHome() {
    sponge.classList.add('returning');
    // Reset to CSS-defined position
    sponge.style.left = '';
    sponge.style.top = '';
    sponge.style.bottom = '20px';
    sponge.style.right = '20px';
    setTimeout(() => sponge.classList.remove('returning'), 400);
  }

  function isOverElement(clientX, clientY, rect) {
    return clientX >= rect.left && clientX <= rect.right &&
           clientY >= rect.top && clientY <= rect.bottom;
  }

  // --- Reset ---
  function performReset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SPLATTER_KEY);
    localStorage.removeItem(MIX_STATE_KEY);
    discoveredColors = new Set();
    mixPotColorId = null;
    splatters = [];
    rewardShown = false;
    selectedPotId = null;

    splatterCtx.clearRect(0, 0, splatterCanvas.width, splatterCanvas.height);

    resetModal.classList.add('hidden');
    loadState();
    renderPots();
    renderProgress();
    updateMixPotVisual();
    layoutPots();
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
