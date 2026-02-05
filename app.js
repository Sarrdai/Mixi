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
  const FLY_DURATION = 700;
  const SPONGE_RUB_THRESHOLD = 120; // cumulative px movement to clear mixer

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
  let potElements = {};
  let potHomePositions = {};
  let dragging = null;
  let splatters = [];
  let rewardShown = false;
  let hintTimer = null;
  let activeHintId = null;
  let currentScale = 1;

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
    const splat = { x, y, color, size: size || 8 + Math.random() * 14, offsets };
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

    const allIds = ColorEngine.getWheelOrder();

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
        `;
      } else {
        pot.className = 'pot empty-pot';
        pot.innerHTML = `
          <div class="pot-body">
            <div class="pot-fill"></div>
          </div>
        `;
      }

      colorPotsContainer.appendChild(pot);
      potElements[id] = pot;
    });
  }

  // --- Color Wheel Layout (fills available space, scales mixer too) ---
  function layoutPots() {
    const rect = playground.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const basePotSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));
    const baseMixSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mix-pot-size'));

    const centerX = W / 2;
    const centerY = H / 2;

    // Available space from center to edge
    const halfMin = Math.min(W / 2, H / 2);

    // We need the outer ring (primary) to fit with pots fully visible.
    // outerRadius + potSize/2 + margin <= halfMin
    // We want to maximize usage of space.
    const margin = 8;
    const outerRadius = halfMin - basePotSize / 2 - margin;

    // Ring ratios relative to outer
    const ringRadii = {
      1: outerRadius,
      2: outerRadius * 0.67,
      3: outerRadius * 0.38,
    };

    // Check if inner ring has enough room for the mixer
    // innerRadius must be > mixSize/2 + potSize/2 + gap
    const innerGap = basePotSize * 0.3;
    const neededInner = baseMixSize / 2 + basePotSize / 2 + innerGap;

    // Scale everything uniformly if inner ring is too cramped
    let scale = 1;
    if (ringRadii[3] < neededInner) {
      scale = ringRadii[3] / neededInner;
    }
    // Also ensure outer pots don't overlap (12 pots on outer+mid+inner)
    // The tightest ring is ring 3 with 6 items at 60° spacing
    const minArcDist = basePotSize * scale * 0.9;
    const ring3Circ = 2 * Math.PI * ringRadii[3];
    const ring3Spacing = ring3Circ / 6;
    if (ring3Spacing < minArcDist) {
      scale = Math.min(scale, ring3Spacing / (basePotSize * 0.9));
    }

    scale = Math.max(0.4, Math.min(1, scale));
    currentScale = scale;

    const potSize = basePotSize * scale;
    const mixSize = baseMixSize * scale;

    // Scale mixing pot
    mixingPot.style.left = (centerX - mixSize / 2) + 'px';
    mixingPot.style.top = (centerY - mixSize / 2) + 'px';
    mixingPot.style.width = mixSize + 'px';
    mixingPot.style.height = mixSize + 'px';

    // Place all pots on the wheel
    const allIds = ColorEngine.getAllColorIds();
    allIds.forEach(id => {
      const el = potElements[id];
      if (!el) return;
      const color = ColorEngine.getColor(id);

      const radius = ringRadii[color.ring] || ringRadii[1];
      const angleRad = (color.wheelAngle - 90) * (Math.PI / 180);
      const x = centerX + Math.cos(angleRad) * radius - potSize / 2;
      const y = centerY + Math.sin(angleRad) * radius - potSize / 2;

      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = potSize + 'px';
      el.style.height = potSize + 'px';
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

    const basePotSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));
    const halfPot = basePotSize * currentScale / 2;

    const actionableRecipes = color.recipes.filter(([a, b]) =>
      discoveredColors.has(a) && discoveredColors.has(b)
    );

    actionableRecipes.forEach(([a, b]) => {
      const posA = potHomePositions[a];
      const posB = potHomePositions[b];
      const posT = potHomePositions[targetId];
      if (!posA || !posB || !posT) return;

      const colorA = ColorEngine.getColor(a);
      const colorB = ColorEngine.getColor(b);

      const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line1.setAttribute('x1', posA.x + halfPot);
      line1.setAttribute('y1', posA.y + halfPot);
      line1.setAttribute('x2', posT.x + halfPot);
      line1.setAttribute('y2', posT.y + halfPot);
      line1.setAttribute('class', 'hint-line visible');
      line1.setAttribute('stroke', colorA ? colorA.hex : '#888');
      hintSvg.appendChild(line1);

      const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line2.setAttribute('x1', posB.x + halfPot);
      line2.setAttribute('y1', posB.y + halfPot);
      line2.setAttribute('x2', posT.x + halfPot);
      line2.setAttribute('y2', posT.y + halfPot);
      line2.setAttribute('class', 'hint-line visible');
      line2.setAttribute('stroke', colorB ? colorB.hex : '#888');
      hintSvg.appendChild(line2);

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
  // Uses JS animation (requestAnimationFrame) for reliable, smooth motion
  function flyColorToTarget(colorId, hexColor, callback) {
    const targetHome = potHomePositions[colorId];
    if (!targetHome) {
      if (callback) callback();
      return;
    }

    const pgRect = playground.getBoundingClientRect();
    const mixRect = mixingPot.getBoundingClientRect();
    const basePotSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pot-size'));
    const potSize = basePotSize * currentScale;

    const blob = document.createElement('div');
    blob.className = 'color-fly-blob';
    blob.style.backgroundColor = hexColor;
    blob.style.position = 'absolute';
    blob.style.pointerEvents = 'none';
    blob.style.borderRadius = '50%';
    blob.style.zIndex = '100';

    const startSize = potSize * 0.45;
    const endSize = potSize * 0.6;
    const startX = (mixRect.left - pgRect.left) + mixRect.width / 2 - startSize / 2;
    const startY = (mixRect.top - pgRect.top) + mixRect.height / 2 - startSize / 2;
    const endX = targetHome.x + potSize / 2 - endSize / 2;
    const endY = targetHome.y + potSize / 2 - endSize / 2;

    blob.style.width = startSize + 'px';
    blob.style.height = startSize + 'px';
    blob.style.left = startX + 'px';
    blob.style.top = startY + 'px';
    blob.style.opacity = '1';
    blob.style.border = '3px solid ' + getComputedStyle(document.documentElement).getPropertyValue('--pot-border').trim();
    playground.appendChild(blob);

    const startTime = performance.now();
    const duration = FLY_DURATION;

    // Drop splatters along the path randomly
    let lastSplatTime = 0;

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      const cx = startX + (endX - startX) * ease;
      const cy = startY + (endY - startY) * ease;
      const cs = startSize + (endSize - startSize) * ease;

      blob.style.left = cx + 'px';
      blob.style.top = cy + 'px';
      blob.style.width = cs + 'px';
      blob.style.height = cs + 'px';
      blob.style.opacity = String(1 - t * 0.3);

      // Random drip along path
      if (now - lastSplatTime > 100 && Math.random() < 0.15) {
        const offsetX = (Math.random() - 0.5) * 20;
        const offsetY = (Math.random() - 0.5) * 20;
        addSplatter(cx + cs / 2 + offsetX, cy + cs / 2 + offsetY, hexColor, 5 + Math.random() * 8);
        lastSplatTime = now;
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        blob.remove();
        if (callback) callback();
      }
    }

    requestAnimationFrame(animate);
  }

  // --- Core: Add color to mix ---
  function addToMix(colorId, sourceEl) {
    if (!discoveredColors.has(colorId)) return;

    if (sourceEl) {
      sourceEl.classList.add('pouring');
      setTimeout(() => sourceEl.classList.remove('pouring'), 600);
    }

    const incomingColor = ColorEngine.getColor(colorId);

    if (!mixPotColorId) {
      mixPotColorId = colorId;
      showRipple(incomingColor.hex);
      animateMixFill();
      updateMixPotVisual();
      saveState();
      return;
    }

    const result = ColorEngine.mix(mixPotColorId, colorId);
    if (!result) return;

    showRipple(incomingColor.hex);

    setTimeout(() => {
      const isNewDiscovery = !discoveredColors.has(result.id);
      const resultHex = result.color.hex;

      mixPotColorId = result.id;
      animateMixFill();
      updateMixPotVisual();
      saveState();

      if (isNewDiscovery) {
        discoveredColors.add(result.id);
        saveState();
        showDiscoveryPopup(result.color, result.id);
      } else {
        // Already known: fly to pot and clear
        flyColorToTarget(result.id, resultHex, () => {
          const targetEl = potElements[result.id];
          if (targetEl) {
            targetEl.classList.add('new-discovery');
            setTimeout(() => targetEl.classList.remove('new-discovery'), 600);
          }
        });
        setTimeout(() => clearMixPot(), 100);
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

    setTimeout(() => {
      discoveryPopup.classList.add('hidden');
      discoveryPopup.classList.remove('auto-dismiss');

      renderAllPots();
      layoutPots();

      flyColorToTarget(colorId, color.hex, () => {
        const newPot = potElements[colorId];
        if (newPot) {
          newPot.classList.add('new-discovery');
          setTimeout(() => newPot.classList.remove('new-discovery'), 800);
        }
      });

      setTimeout(() => clearMixPot(), 100);
      renderProgress();

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

    discoveryPopup.addEventListener('click', (e) => {
      if (e.target === discoveryPopup) {
        discoveryPopup.classList.add('hidden');
        discoveryPopup.classList.remove('auto-dismiss');
      }
    });

    rewardClose.addEventListener('click', () => rewardOverlay.classList.add('hidden'));

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

      // Show hints on long-press for filled pots too
      hintTimer = setTimeout(() => {
        showHints(id);
      }, 300);

      dragging = {
        el: pot,
        type: 'pot',
        colorId: id,
        color: ColorEngine.getColor(id),
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        startX: rect.left - pgRect.left,
        startY: rect.top - pgRect.top,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };

      pot.classList.add('dragging');
      pot.classList.remove('returning');
      pot.setPointerCapture(e.pointerId);

    } else if (emptyPot) {
      e.preventDefault();
      const id = emptyPot.dataset.colorId;
      emptyPot.setPointerCapture(e.pointerId);

      hintTimer = setTimeout(() => {
        showHints(id);
      }, 300);

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
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        rubDistance: 0,       // cumulative distance while over mixer
        overMixer: false,
        mixerCleared: false,
      };

      sponge.classList.add('dragging');
      sponge.classList.remove('returning');
      sponge.setPointerCapture(e.pointerId);

      sponge.style.bottom = 'auto';
      sponge.style.right = 'auto';
      sponge.style.left = (rect.left - pgRect.left) + 'px';
      sponge.style.top = (rect.top - pgRect.top) + 'px';

    } else {
      clearHints();
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;

    if (dragging.type === 'empty-hint') {
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
      // Clear hint timer once user starts dragging
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
      if (activeHintId) clearHints();

      const mixRect = mixingPot.getBoundingClientRect();
      const overMix = isOverElement(e.clientX, e.clientY, mixRect);
      mixingPot.classList.toggle('highlight', overMix);

      // Random drip while dragging a color pot
      const dx = e.clientX - dragging.lastX;
      const dy = e.clientY - dragging.lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 8 && Math.random() < 0.08) {
        const dropX = e.clientX - pgRect.left + (Math.random() - 0.5) * 15;
        const dropY = e.clientY - pgRect.top + (Math.random() - 0.5) * 15;
        addSplatter(dropX, dropY, dragging.color.hex, 4 + Math.random() * 8);
      }
      dragging.lastX = e.clientX;
      dragging.lastY = e.clientY;
    }

    if (dragging.type === 'sponge') {
      const spongeX = e.clientX - pgRect.left;
      const spongeY = e.clientY - pgRect.top;
      clearSplattersNear(spongeX, spongeY, 40);

      const mixRect = mixingPot.getBoundingClientRect();
      const overMix = isOverElement(e.clientX, e.clientY, mixRect);
      mixingPot.classList.toggle('highlight', overMix);

      // Track rubbing distance while over mixer
      const dx = e.clientX - dragging.lastX;
      const dy = e.clientY - dragging.lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (overMix && !dragging.mixerCleared) {
        dragging.rubDistance += dist;
        dragging.overMixer = true;

        // Wiggle animation while rubbing
        if (dist > 3) {
          sponge.classList.add('wiping');
          clearTimeout(dragging.wiggleTimeout);
          dragging.wiggleTimeout = setTimeout(() => sponge.classList.remove('wiping'), 200);
        }

        if (dragging.rubDistance >= SPONGE_RUB_THRESHOLD && mixPotColorId) {
          clearMixPot();
          dragging.mixerCleared = true;
          dragging.rubDistance = 0;
          // Feedback
          sponge.classList.add('wiping');
          setTimeout(() => sponge.classList.remove('wiping'), 400);
        }
      } else if (!overMix) {
        dragging.overMixer = false;
        // Reset rub distance when leaving mixer
        dragging.rubDistance = 0;
      }

      dragging.lastX = e.clientX;
      dragging.lastY = e.clientY;
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;

    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }

    if (dragging.type === 'empty-hint') {
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
        clearHints();
        const mixRect = mixingPot.getBoundingClientRect();
        if (isOverElement(e.clientX, e.clientY, mixRect)) {
          addToMix(colorId, pot);
          deselectAll();
        }
        returnPotHome(colorId, pot);
      } else {
        // If hints are showing, dismiss them on tap release; otherwise handle click
        if (activeHintId) {
          setTimeout(clearHints, 200);
        }
        handlePotClick(colorId, pot);
      }
    } else if (dragging.type === 'sponge') {
      sponge.classList.remove('dragging', 'wiping');
      if (dragging.wiggleTimeout) clearTimeout(dragging.wiggleTimeout);
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
