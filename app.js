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
  const rewardOverlay = document.getElementById('reward-overlay');
  const rewardColors = document.getElementById('reward-colors');
  const rewardClose = document.getElementById('reward-close');
  const resetModal = document.getElementById('reset-modal');
  const resetInput = document.getElementById('reset-input');
  const resetConfirm = document.getElementById('reset-confirm');
  const resetCancel = document.getElementById('reset-cancel');
  const splatterCanvas = document.getElementById('splatter-canvas');
  const splatterCtx = splatterCanvas.getContext('2d');
  const hintSvg = document.getElementById('hint-lines');

  // --- State ---
  let discoveredColors = new Set();
  let selectedPotId = null;
  let mixPotColorId = null;
  let potElements = {};       // All pots (discovered + empty)
  let potHomePositions = {};   // Pixel positions for every pot slot
  let dragging = null;
  let splatters = [];
  let rewardShown = false;
  let hintTimer = null;        // Long-press timer for hints
  let activeHintId = null;     // Currently showing hints for this color

  // --- Init ---
  function init() {
    loadState();
    setupSplatterCanvas();
    renderAllPots();
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
        discoveredColors = new Set(JSON.parse(saved));
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

  // --- Render ALL pots (discovered + empty) ---
  function renderAllPots() {
    colorPotsContainer.innerHTML = '';
    potElements = {};

    // Wheel colors (ring > 0)
    const wheelIds = ColorEngine.getWheelOrder();
    // Center colors (ring 0, e.g. braun)
    const centerIds = ColorEngine.getCenterColors();
    const allIds = [...wheelIds, ...centerIds];

    allIds.forEach(id => {
      const color = ColorEngine.getColor(id);
      if (!color) return;
      const isDiscovered = discoveredColors.has(id);

      const pot = document.createElement('div');
      pot.dataset.colorId = id;
      pot.setAttribute('aria-label', `${isDiscovered ? color.name : '???'} Farbtopf`);

      if (isDiscovered) {
        pot.className = 'pot color-pot';
        pot.setAttribute('role', 'button');
        pot.innerHTML = `
          <div class="pot-body">
            <div class="pot-fill" style="background-color: ${color.hex}"></div>
          </div>
          <div class="pot-label">${color.name}</div>
        `;
      } else {
        pot.className = 'pot empty-pot';
        pot.innerHTML = `
          <div class="pot-body">
            <div class="pot-fill"></div>
          </div>
          <div class="pot-label">???</div>
        `;
      }

      colorPotsContainer.appendChild(pot);
      potElements[id] = pot;
    });
  }

  // --- Color Wheel Layout ---
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

    // Determine available radius
    const maxAvail = Math.min(W / 2, H / 2) - potSize * 0.7;

    // Ring radii: outer (primary), middle (secondary), inner (tertiary)
    const ringRadii = {
      1: maxAvail * 0.92,  // Primary: outermost
      2: maxAvail * 0.62,  // Secondary: middle
      3: maxAvail * 0.35,  // Tertiary: inner
    };

    // Auto-scale if too cramped
    let scale = 1;
    const minRadius = mixSize / 2 + potSize * 0.6;
    if (ringRadii[3] < minRadius) {
      scale = Math.max(0.5, minRadius / (maxAvail * 0.35));
      // Don't scale up, only apply scaling to pots if space is too small
      scale = Math.min(1, 1 / scale);
    }

    const allIds = ColorEngine.getAllColorIds();

    allIds.forEach(id => {
      const el = potElements[id];
      if (!el) return;
      const color = ColorEngine.getColor(id);

      if (color.ring === 0) {
        // Center color (braun) - place near mixing pot, offset below
        const x = centerX - potSize / 2;
        const y = centerY + mixSize / 2 + 10;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        potHomePositions[id] = { x, y };
        el.style.transform = scale < 1 ? `scale(${scale})` : '';
        return;
      }

      const radius = ringRadii[color.ring] || ringRadii[1];
      // Convert wheelAngle to radians; 0° = top (12 o'clock), clockwise
      const angleRad = (color.wheelAngle - 90) * (Math.PI / 180);
      const x = centerX + Math.cos(angleRad) * radius - potSize / 2;
      const y = centerY + Math.sin(angleRad) * radius - potSize / 2;

      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.transform = scale < 1 ? `scale(${scale})` : '';
      potHomePositions[id] = { x, y };
    });
  }

  // --- Hint system: show recipe connections ---
  function showHints(targetId) {
    clearHints();
    activeHintId = targetId;
    const color = ColorEngine.getColor(targetId);
    if (!color || !color.recipes || color.recipes.length === 0) return;

    const targetEl = potElements[targetId];
    if (targetEl) targetEl.classList.add('hint-active');

    const potSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));
    const halfPot = potSize / 2;

    color.recipes.forEach(([a, b]) => {
      const posA = potHomePositions[a];
      const posB = potHomePositions[b];
      const posT = potHomePositions[targetId];
      if (!posA || !posB || !posT) return;

      const colorA = ColorEngine.getColor(a);
      const colorB = ColorEngine.getColor(b);

      // Line from A to target
      const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line1.setAttribute('x1', posA.x + halfPot);
      line1.setAttribute('y1', posA.y + halfPot);
      line1.setAttribute('x2', posT.x + halfPot);
      line1.setAttribute('y2', posT.y + halfPot);
      line1.setAttribute('class', 'hint-line visible');
      line1.setAttribute('stroke', colorA ? colorA.hex : '#888');
      hintSvg.appendChild(line1);

      // Line from B to target
      const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line2.setAttribute('x1', posB.x + halfPot);
      line2.setAttribute('y1', posB.y + halfPot);
      line2.setAttribute('x2', posT.x + halfPot);
      line2.setAttribute('y2', posT.y + halfPot);
      line2.setAttribute('class', 'hint-line visible');
      line2.setAttribute('stroke', colorB ? colorB.hex : '#888');
      hintSvg.appendChild(line2);

      // Highlight source pots
      const elA = potElements[a];
      const elB = potElements[b];
      if (elA) elA.classList.add('hint-active');
      if (elB) elB.classList.add('hint-active');
    });
  }

  function clearHints() {
    activeHintId = null;
    hintSvg.innerHTML = '';
    document.querySelectorAll('.pot.hint-active').forEach(el => el.classList.remove('hint-active'));
  }

  // --- Progress ---
  function renderProgress() {
    progressDots.innerHTML = '';
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
    void mixFill.offsetWidth;
    mixFill.classList.add('mix-fill-animate');
  }

  function showRipple(color) {
    mixRipple.style.backgroundColor = color;
    mixRipple.classList.remove('active');
    void mixRipple.offsetWidth;
    mixRipple.classList.add('active');
    setTimeout(() => mixRipple.classList.remove('active'), 800);
  }

  // --- Fly color blob from mix pot to target pot ---
  function flyColorToTarget(colorId, callback) {
    const color = ColorEngine.getColor(colorId);
    const targetHome = potHomePositions[colorId];
    if (!color || !targetHome) {
      if (callback) callback();
      return;
    }

    const pgRect = playground.getBoundingClientRect();
    const mixRect = mixingPot.getBoundingClientRect();
    const potSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));

    const blob = document.createElement('div');
    blob.className = 'color-fly-blob';
    blob.style.backgroundColor = color.hex;

    // Start at mix pot center
    const startSize = 40;
    const startX = (mixRect.left - pgRect.left) + mixRect.width / 2 - startSize / 2;
    const startY = (mixRect.top - pgRect.top) + mixRect.height / 2 - startSize / 2;
    blob.style.width = startSize + 'px';
    blob.style.height = startSize + 'px';
    blob.style.left = startX + 'px';
    blob.style.top = startY + 'px';
    playground.appendChild(blob);

    // Animate to target pot
    requestAnimationFrame(() => {
      blob.style.left = (targetHome.x + potSize / 2 - potSize * 0.3) + 'px';
      blob.style.top = (targetHome.y + potSize / 2 - potSize * 0.3) + 'px';
      blob.style.width = (potSize * 0.6) + 'px';
      blob.style.height = (potSize * 0.6) + 'px';
      blob.style.opacity = '0.7';
    });

    setTimeout(() => {
      blob.remove();
      if (callback) callback();
    }, 750);
  }

  // --- Core: Add color to mix ---
  function addToMix(colorId, sourceEl) {
    // Only allow dragging discovered colors
    if (!discoveredColors.has(colorId)) return;

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
      const isNewDiscovery = !discoveredColors.has(result.id);

      mixPotColorId = result.id;
      animateMixFill();
      updateMixPotVisual();
      saveState();

      if (isNewDiscovery) {
        // --- New color discovered ---
        discoveredColors.add(result.id);
        saveState();

        // Show auto-dismissing popup
        showDiscoveryPopup(result.color, result.id);

      } else {
        // --- Already known color: fly to pot and clear mix ---
        flyColorToTarget(result.id, () => {
          // Briefly highlight the target pot
          const targetEl = potElements[result.id];
          if (targetEl) {
            targetEl.classList.add('new-discovery');
            setTimeout(() => targetEl.classList.remove('new-discovery'), 600);
          }
        });

        // Clear mix pot after flying
        setTimeout(() => {
          clearMixPot();
        }, 200);
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

  // --- Discovery popup (auto-dismiss, then fly to pot) ---
  function showDiscoveryPopup(color, colorId) {
    popupColor.style.backgroundColor = color.hex;
    popupTitle.textContent = 'Neue Farbe entdeckt!';
    popupName.textContent = color.name;

    discoveryPopup.classList.remove('hidden', 'auto-dismiss');
    void discoveryPopup.offsetWidth;
    discoveryPopup.classList.add('auto-dismiss');

    // After popup fades out (~2s), update pots and fly color to its slot
    setTimeout(() => {
      discoveryPopup.classList.add('hidden');
      discoveryPopup.classList.remove('auto-dismiss');

      // Re-render to convert empty pot to filled
      renderAllPots();
      layoutPots();

      // Fly the color blob from mix pot to the new pot
      flyColorToTarget(colorId, () => {
        const newPot = potElements[colorId];
        if (newPot) {
          newPot.classList.add('new-discovery');
          setTimeout(() => newPot.classList.remove('new-discovery'), 800);
        }
      });

      // Clear the mix pot
      setTimeout(() => {
        clearMixPot();
      }, 100);

      // Update progress
      renderProgress();

      // Check for full completion
      if (discoveredColors.size >= ColorEngine.getTotalDiscoverable() && !rewardShown) {
        setTimeout(() => showReward(), 1500);
      }
    }, 2000);
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
    playground.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    mixingPot.addEventListener('pointerup', onMixPotClick);

    // Popup: click backdrop to dismiss early
    discoveryPopup.addEventListener('click', (e) => {
      if (e.target === discoveryPopup) {
        discoveryPopup.classList.add('hidden');
        discoveryPopup.classList.remove('auto-dismiss');
      }
    });

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

    window.addEventListener('resize', () => {
      layoutPots();
      setupSplatterCanvas();
    });
  }

  // --- Pointer handlers ---
  function onPointerDown(e) {
    const pot = e.target.closest('.color-pot');
    const emptyPot = e.target.closest('.empty-pot');
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

    } else if (emptyPot) {
      // Long-press on empty pot: start hint timer
      e.preventDefault();
      const id = emptyPot.dataset.colorId;
      emptyPot.setPointerCapture(e.pointerId);

      // Show hints immediately on press-and-hold
      hintTimer = setTimeout(() => {
        showHints(id);
      }, 300);

      // Also store info to clear on release
      dragging = {
        el: emptyPot,
        type: 'empty-hint',
        colorId: id,
        moved: false,
      };

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

      sponge.style.bottom = 'auto';
      sponge.style.right = 'auto';
      sponge.style.left = (rect.left - pgRect.left) + 'px';
      sponge.style.top = (rect.top - pgRect.top) + 'px';

    } else {
      // Clicked on empty space: clear hints
      clearHints();
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;

    if (dragging.type === 'empty-hint') {
      // Cancel hint if finger moves
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
      return;
    }

    e.preventDefault();

    const pgRect = playground.getBoundingClientRect();
    const x = e.clientX - pgRect.left - dragging.offsetX;
    const y = e.clientY - pgRect.top - dragging.offsetY;

    dragging.el.style.left = x + 'px';
    dragging.el.style.top = y + 'px';
    dragging.moved = true;

    if (dragging.type === 'pot') {
      const mixRect = mixingPot.getBoundingClientRect();
      const overMix = isOverElement(e.clientX, e.clientY, mixRect);
      mixingPot.classList.toggle('highlight', overMix);
    }

    if (dragging.type === 'sponge') {
      const spongeX = e.clientX - pgRect.left;
      const spongeY = e.clientY - pgRect.top;
      clearSplattersNear(spongeX, spongeY, 40);

      const mixRect = mixingPot.getBoundingClientRect();
      mixingPot.classList.toggle('highlight', isOverElement(e.clientX, e.clientY, mixRect));
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;

    // Clear hint timer if any
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }

    if (dragging.type === 'empty-hint') {
      // Release from empty pot: clear hints after a short delay
      setTimeout(clearHints, 200);
      dragging = null;
      return;
    }

    mixingPot.classList.remove('highlight');

    if (dragging.type === 'pot') {
      const pot = dragging.el;
      const colorId = dragging.colorId;
      pot.classList.remove('dragging');

      if (dragging.moved) {
        const mixRect = mixingPot.getBoundingClientRect();
        if (isOverElement(e.clientX, e.clientY, mixRect)) {
          addToMix(colorId, pot);
          deselectAll();
        }
        returnPotHome(colorId, pot);
      } else {
        handlePotClick(colorId, pot);
      }
    } else if (dragging.type === 'sponge') {
      sponge.classList.remove('dragging');

      const mixRect = mixingPot.getBoundingClientRect();
      if (dragging.moved && isOverElement(e.clientX, e.clientY, mixRect)) {
        sponge.classList.add('wiping');
        setTimeout(() => sponge.classList.remove('wiping'), 400);
        clearMixPot();
      }

      returnSpongeHome();
    }

    dragging = null;
  }

  function onMixPotClick(e) {
    if (selectedPotId && !dragging) {
      const sourceEl = potElements[selectedPotId];
      addToMix(selectedPotId, sourceEl);
      deselectAll();
    }
  }

  function handlePotClick(colorId, potEl) {
    if (selectedPotId === colorId) {
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
    clearHints();

    resetModal.classList.add('hidden');
    loadState();
    renderAllPots();
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
