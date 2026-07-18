/* =========================================================================
   RADAR WIDGET — script.js
   Pure vanilla ES6, Canvas API only. No external libraries.

   Architecture (top to bottom):
     1. Constants & DOM references
     2. State (single source of truth) + persistence (localStorage)
     3. Color utilities (HEX / RGB / HSL parsing + conversion)
     4. Skills panel UI (build/sync editable rows: name, slider, delete)
     5. Settings panel UI (open/close, color pickers <-> text inputs)
     6. Canvas / Radar chart renderer (grid, polygon, vertices, labels)
     7. Animation loop (value smoothing + hover easing)
     8. Resize handling
     9. Init
   ========================================================================= */

(() => {
  'use strict';

  /* ======================= 1. CONSTANTS & DOM REFS ====================== */

  const STORAGE_KEY = 'radarWidget.state.v1';
  const MAX_VALUE = 100;          // scale used for sliders & radar rings
  const GRID_LEVELS = 5;          // number of concentric polygon rings
  const LERP_SPEED = 0.18;        // animation smoothing factor (0-1)
  const HOVER_RADIUS = 14;        // px, distance threshold to trigger hover
  const VERTEX_RADIUS = 4;        // base dot radius
  const VERTEX_RADIUS_HOVER = 7;  // dot radius when hovered

  const dom = {
    canvas: document.getElementById('radarChart'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    closePanel: document.getElementById('closePanel'),

    fillColorPicker: document.getElementById('fillColorPicker'),
    fillColorCode: document.getElementById('fillColorCode'),
    lineColorPicker: document.getElementById('lineColorPicker'),
    lineColorCode: document.getElementById('lineColorCode'),
    gridColorPicker: document.getElementById('gridColorPicker'),
    gridColorCode: document.getElementById('gridColorCode'),
    textColorPicker: document.getElementById('textColorPicker'),
    textColorCode: document.getElementById('textColorCode'),

    skillsContainer: document.getElementById('skillsContainer'),
    addSkillBtn: document.getElementById('addSkill'),
  };

  const ctx = dom.canvas.getContext('2d');

  /* ======================= 2. STATE & PERSISTENCE ======================= */

  /**
   * Default state used the very first time the widget runs
   * (or if localStorage is unavailable/corrupted).
   */
  function defaultState() {
    return {
      colors: {
        fill: '#8B5CF6',
        line: '#A78BFA',
        grid: '#FFFFFF40',
        text: '#FFFFFF',
      },
      skills: [
        { id: uid(), name: 'HTML', value: 90 },
        { id: uid(), name: 'CSS', value: 80 },
        { id: uid(), name: 'JavaScript', value: 75 },
        { id: uid(), name: 'Design', value: 60 },
        { id: uid(), name: 'Backend', value: 55 },
      ],
    };
  }

  /** Generates a short unique id for a skill (name-independent, stable key). */
  function uid() {
    return 'sk_' + Math.random().toString(36).slice(2, 10);
  }

  let state = loadState();

  /** Loads state from localStorage, falling back to defaults on any error. */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.skills) || !parsed.colors) {
        return defaultState();
      }
      return parsed;
    } catch (err) {
      console.warn('RadarWidget: failed to load saved state, using defaults.', err);
      return defaultState();
    }
  }

  /** Debounced auto-save so rapid slider/color changes don't spam localStorage. */
  let saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('RadarWidget: failed to save state.', err);
      }
    }, 150);
  }

  /* ======================= 3. COLOR UTILITIES ============================ */

  /**
   * Parses a manually-typed color string (HEX, RGB(A), or HSL(A)) and
   * returns a normalized 6-digit HEX string, or null if invalid.
   */
  function parseColorToHex(input) {
    if (!input) return null;
    const str = input.trim();

    // HEX: #abc, #aabbcc, #aabbccdd
    const hexMatch = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      return '#' + hex.slice(0, 6).toUpperCase();
    }

    // RGB / RGBA: rgb(255, 0, 0) or rgba(255,0,0,0.5)
    const rgbMatch = str.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i
    );
    if (rgbMatch) {
      const [, r, g, b] = rgbMatch;
      return rgbToHex(clamp255(r), clamp255(g), clamp255(b));
    }

    // HSL / HSLA: hsl(260, 80%, 65%) or hsla(260,80%,65%,0.5)
    const hslMatch = str.match(
      /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/i
    );
    if (hslMatch) {
      const [, h, s, l] = hslMatch;
      const [r, g, b] = hslToRgb(parseFloat(h), parseFloat(s), parseFloat(l));
      return rgbToHex(r, g, b);
    }

    return null;
  }

  function clamp255(v) {
    return Math.max(0, Math.min(255, parseInt(v, 10)));
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  /**
   * Converts a hex color (#RRGGBB or #RRGGBBAA) to an rgba() string with a
   * custom alpha override. Used for translucent grid/fill strokes.
   */
  function hexToRgba(hex, alpha) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) {
      // already has an alpha channel baked in — honor it unless overridden
      const a = alpha ?? parseInt(h.slice(6, 8), 16) / 255;
      h = h.slice(0, 6);
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha ?? 1})`;
  }

  /* ======================= 4. SKILLS PANEL UI ============================ */

  /**
   * Rebuilds the skills editor rows to match `state.skills`.
   * Each row: editable name input, range slider, live value badge, delete btn.
   * Rebuilding (instead of patching) keeps this simple and duplication-free;
   * cost is negligible since skill lists are small.
   */
  function renderSkillRows() {
    dom.skillsContainer.innerHTML = '';

    state.skills.forEach((skill) => {
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.dataset.id = skill.id;
      row.style.cssText = `
        display:flex; align-items:center; gap:10px;
        margin-bottom:12px; flex-wrap:wrap;
      `;

      // --- Skill name (editable) ---
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = skill.name;
      nameInput.setAttribute('aria-label', 'Skill name');
      nameInput.style.cssText = 'flex:1 1 120px; min-width:90px;';
      nameInput.addEventListener('input', () => {
        skill.name = nameInput.value || 'Skill';
        saveState();
        requestDraw();
      });

      // --- Value slider ---
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = String(MAX_VALUE);
      slider.value = String(skill.value);
      slider.style.cssText = 'flex:2 1 120px;';
      slider.setAttribute('aria-label', `${skill.name} value`);

      // --- Live numeric badge ---
      const valueLabel = document.createElement('span');
      valueLabel.textContent = skill.value;
      valueLabel.style.cssText = 'width:32px; text-align:right; opacity:.85; font-size:14px;';

      slider.addEventListener('input', () => {
        skill.value = Number(slider.value);
        valueLabel.textContent = skill.value;
        saveState();
        // no full redraw call needed: animation loop reads state.skills live
      });

      // --- Delete button ---
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete skill';
      deleteBtn.style.cssText = `
        width:32px; height:32px; border:none; border-radius:8px;
        background:rgba(255,255,255,.08); color:white; cursor:pointer;
        flex:0 0 auto;
      `;
      deleteBtn.addEventListener('click', () => {
        state.skills = state.skills.filter((s) => s.id !== skill.id);
        // dropping the displayed-value cache entry avoids stale animation data
        displayedValues.delete(skill.id);
        renderSkillRows();
        saveState();
        requestDraw();
      });

      row.append(nameInput, slider, valueLabel, deleteBtn);
      dom.skillsContainer.appendChild(row);
    });
  }

  /** Adds a brand-new skill with a sensible default and re-renders. */
  function addSkill() {
    state.skills.push({ id: uid(), name: 'New Skill', value: 50 });
    renderSkillRows();
    saveState();
    requestDraw();
  }

  dom.addSkillBtn.addEventListener('click', addSkill);

  /* ======================= 5. SETTINGS PANEL UI =========================== */

  // --- Open / close glass panel ---
  function openPanel() {
    dom.settingsPanel.classList.add('open');
    dom.settingsPanel.setAttribute('aria-hidden', 'false');
  }
  function closePanel() {
    dom.settingsPanel.classList.remove('open');
    dom.settingsPanel.setAttribute('aria-hidden', 'true');
  }
  dom.settingsBtn.addEventListener('click', () => {
    dom.settingsPanel.classList.contains('open') ? closePanel() : openPanel();
  });
  dom.closePanel.addEventListener('click', closePanel);

  /**
   * Wires a color <input type="color"> + its paired text input so either one
   * updates the other, updates state, persists, and redraws instantly.
   * Centralizing this avoids duplicating the same logic four times.
   */
  function bindColorControl(pickerEl, codeEl, stateKey) {
    // Picker → text + state
    pickerEl.addEventListener('input', () => {
      const hex = pickerEl.value.toUpperCase();
      codeEl.value = hex;
      state.colors[stateKey] = hex;
      saveState();
      requestDraw();
    });

    // Manual text (HEX/RGB/HSL) → picker + state
    codeEl.addEventListener('change', () => {
      const hex = parseColorToHex(codeEl.value);
      if (!hex) {
        // invalid input: revert the text box to the last known-good value
        codeEl.value = state.colors[stateKey];
        return;
      }
      codeEl.value = hex;
      pickerEl.value = hex;
      state.colors[stateKey] = hex;
      saveState();
      requestDraw();
    });
  }

  bindColorControl(dom.fillColorPicker, dom.fillColorCode, 'fill');
  bindColorControl(dom.lineColorPicker, dom.lineColorCode, 'line');
  bindColorControl(dom.gridColorPicker, dom.gridColorCode, 'grid');
  bindColorControl(dom.textColorPicker, dom.textColorCode, 'text');

  /** Pushes current state colors into the four controls (used on init). */
  function syncColorControlsFromState() {
    dom.fillColorPicker.value = normalizeForPicker(state.colors.fill);
    dom.fillColorCode.value = state.colors.fill;
    dom.lineColorPicker.value = normalizeForPicker(state.colors.line);
    dom.lineColorCode.value = state.colors.line;
    dom.gridColorPicker.value = normalizeForPicker(state.colors.grid);
    dom.gridColorCode.value = state.colors.grid;
    dom.textColorPicker.value = normalizeForPicker(state.colors.text);
    dom.textColorCode.value = state.colors.text;
  }

  /** <input type="color"> only accepts 6-digit hex — strip any alpha suffix. */
  function normalizeForPicker(hex) {
    return '#' + hex.replace('#', '').slice(0, 6).padEnd(6, '0');
  }

  /* ======================= 6. RADAR CHART RENDERER ======================== */

  // Values currently on screen, eased toward each skill's target value.
  // Keyed by skill id so animation survives reordering/adding/deleting.
  const displayedValues = new Map();

  // Hover state: id of the vertex currently under the pointer (or null),
  // plus an eased "hover amount" per id for a smooth grow/shrink pop.
  let hoveredId = null;
  const hoverAmount = new Map();

  /** Resizes the canvas backing store to match its CSS size at devicePixelRatio. */
  function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dom.canvas.width = Math.round(rect.width * dpr);
    dom.canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixel units
    requestDraw();
  }

  /** Returns the { x, y, cssWidth, cssHeight, cx, cy, radius } geometry for this frame. */
  function getGeometry() {
    const rect = dom.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    // Leave room for labels/values around the outside edge.
    const radius = Math.min(cx, cy) - 44;
    return { cx, cy, radius, width: rect.width, height: rect.height };
  }

  /** Computes the on-canvas point for a given skill index/value fraction (0-1). */
  function pointFor(index, count, fraction, geo) {
    const angle = angleFor(index, count);
    return {
      x: geo.cx + Math.cos(angle) * geo.radius * fraction,
      y: geo.cy + Math.sin(angle) * geo.radius * fraction,
      angle,
    };
  }

  /** Angle (radians) for skill `index` out of `count`, starting at top (-90°). */
  function angleFor(index, count) {
    return (Math.PI * 2 * index) / count - Math.PI / 2;
  }

  /** Draws the concentric polygon grid + spokes. */
  function drawGrid(geo, count) {
    const gridColor = state.colors.grid;

    for (let level = 1; level <= GRID_LEVELS; level++) {
      const fraction = level / GRID_LEVELS;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const p = pointFor(i, count, fraction, geo);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = gridColor.length > 7 ? gridColor : hexToRgba(gridColor, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Spokes from center to each outer vertex.
    for (let i = 0; i < count; i++) {
      const p = pointFor(i, count, 1, geo);
      ctx.beginPath();
      ctx.moveTo(geo.cx, geo.cy);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = gridColor.length > 7 ? gridColor : hexToRgba(gridColor, 0.25);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Draws the filled + stroked data polygon using the (eased) displayed values. */
  function drawDataPolygon(geo, skills) {
    if (skills.length < 3) {
      // A polygon needs at least 3 points to be meaningful; fewer than that,
      // just draw the vertices/spokes handled elsewhere and skip the fill.
      if (skills.length === 0) return;
    }

    ctx.beginPath();
    skills.forEach((skill, i) => {
      const fraction = (displayedValues.get(skill.id) ?? skill.value) / MAX_VALUE;
      const p = pointFor(i, skills.length, fraction, geo);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();

    ctx.fillStyle = hexToRgba(state.colors.fill, 0.35);
    ctx.fill();
    ctx.strokeStyle = state.colors.line;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /** Draws each vertex dot (with hover grow effect), the skill name, and its value. */
  function drawVerticesAndLabels(geo, skills) {
    skills.forEach((skill, i) => {
      const fraction = (displayedValues.get(skill.id) ?? skill.value) / MAX_VALUE;
      const vertex = pointFor(i, skills.length, fraction, geo);
      const hover = hoverAmount.get(skill.id) ?? 0;

      // --- Vertex dot ---
      const r = VERTEX_RADIUS + (VERTEX_RADIUS_HOVER - VERTEX_RADIUS) * hover;
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, r, 0, Math.PI * 2);
      ctx.fillStyle = state.colors.line;
      ctx.shadowColor = hover > 0.01 ? state.colors.line : 'transparent';
      ctx.shadowBlur = 12 * hover;
      ctx.fill();
      ctx.shadowBlur = 0;

      // --- Value beside the vertex ---
      const valuePoint = pointFor(i, skills.length, fraction, geo);
      const labelOffset = 16 + hover * 4;
      const vx = valuePoint.x + Math.cos(valuePoint.angle) * labelOffset;
      const vy = valuePoint.y + Math.sin(valuePoint.angle) * labelOffset;
      ctx.font = `600 ${12 + hover * 2}px Inter, sans-serif`;
      ctx.fillStyle = state.colors.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(displayedValues.get(skill.id) ?? skill.value), vx, vy);

      // --- Skill name, anchored just outside the outer ring ---
      const namePoint = pointFor(i, skills.length, 1.16, geo);
      ctx.font = '500 13px Inter, sans-serif';
      ctx.fillStyle = state.colors.text;
      ctx.textAlign = alignForAngle(namePoint.angle);
      ctx.fillText(skill.name, namePoint.x, namePoint.y);
    });
  }

  /** Picks left/center/right text alignment so labels don't overhang the canvas edge. */
  function alignForAngle(angle) {
    const cos = Math.cos(angle);
    if (cos > 0.3) return 'left';
    if (cos < -0.3) return 'right';
    return 'center';
  }

  /** Full redraw of one frame: clear, grid, data polygon, vertices/labels. */
  function draw() {
    const geo = getGeometry();
    ctx.clearRect(0, 0, geo.width, geo.height);

    const skills = state.skills;
    if (skills.length === 0) {
      ctx.fillStyle = state.colors.text;
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add a skill to get started', geo.cx, geo.cy);
      return;
    }

    drawGrid(geo, skills.length);
    drawDataPolygon(geo, skills);
    drawVerticesAndLabels(geo, skills);
  }

  // A dirty-flag lets external handlers (color/slider changes) request a
  // redraw without fighting the continuous animation loop below.
  let needsDraw = true;
  function requestDraw() {
    needsDraw = true;
  }

  /* ======================= 7. ANIMATION LOOP ============================== */

  /** Linear interpolation helper. */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Single continuous rAF loop drives both:
   *   - smooth easing of displayed slider values toward their targets
   *   - smooth easing of hover "pop" amount toward 0 or 1
   * Running one loop (instead of separate timers) keeps everything in sync
   * and avoids duplicated animation-frame logic.
   */
  function tick() {
    let stillAnimating = false;

    state.skills.forEach((skill) => {
      const current = displayedValues.has(skill.id)
        ? displayedValues.get(skill.id)
        : skill.value;
      const next = lerp(current, skill.value, LERP_SPEED);
      const settled = Math.abs(next - skill.value) < 0.05;
      displayedValues.set(skill.id, settled ? skill.value : next);
      if (!settled) stillAnimating = true;

      const targetHover = skill.id === hover
      const targetHover = skill.id === hoveredId ? 1 : 0;
      const currentHover = hoverAmount.get(skill.id) ?? 0;
      const nextHover = lerp(currentHover, targetHover, 0.2);
      const hoverSettled = Math.abs(nextHover - targetHover) < 0.01;
      hoverAmount.set(skill.id, hoverSettled ? targetHover : nextHover);
      if (!hoverSettled) stillAnimating = true;
    });

    if (stillAnimating || needsDraw) {
      draw();
      needsDraw = false;
    }

    requestAnimationFrame(tick);
  }

  /* ======================= 8. HOVER + RESIZE HANDLING ====================== */

  /** Finds the skill whose current vertex is within HOVER_RADIUS of the pointer. */
  function updateHoverFromPointer(clientX, clientY) {
    const rect = dom.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const geo = getGeometry();

    let closestId = null;
    let closestDist = HOVER_RADIUS;

    state.skills.forEach((skill, i) => {
      const fraction = (displayedValues.get(skill.id) ?? skill.value) / MAX_VALUE;
      const p = pointFor(i, state.skills.length, fraction, geo);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = skill.id;
      }
    });

    if (closestId !== hoveredId) {
      hoveredId = closestId;
      requestDraw();
    }
  }

  dom.canvas.addEventListener('mousemove', (e) => {
    updateHoverFromPointer(e.clientX, e.clientY);
  });
  dom.canvas.addEventListener('mouseleave', () => {
    hoveredId = null;
    requestDraw();
  });

  // Responsive canvas: watch the element's own box (handles panel open/close,
  // container resizes, orientation changes) rather than only `window.resize`.
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(dom.canvas);
  window.addEventListener('resize', resizeCanvas);

  /* ======================= 9. INIT ========================================= */

  function init() {
    // Seed the animation cache so the very first frame doesn't "grow from 0".
    state.skills.forEach((skill) => displayedValues.set(skill.id, skill.value));

    syncColorControlsFromState();
    renderSkillRows();
    resizeCanvas(); // also triggers the first requestDraw()
    requestAnimationFrame(tick);
  }

  init();
})();
