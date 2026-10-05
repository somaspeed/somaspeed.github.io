'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const svgNS = 'http://www.w3.org/2000/svg';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  let selectedModel = 'molmoact2';
  let metric = 'throughput';
  let meshMode = 'hsdp';
  let optimizerMode = 'fused';
  let kernel = 0;
  let attentionPass = 'forward';
  let chartAnimation = 0;

  // Source: somaspeed/results/tuned.json and the corresponding eight-GPU configs.
  const benchmarks = {
    molmoact2: {
      name: 'MolmoAct2', native: 4.864916988734362, soma: 45.28448036138989, speedup: 9.308376785514469,
      axis: 50,
      rows: [
        ['Parallelism', 'LeRobot DDP', 'HSDP · 4 replicas × 2 shards'],
        ['Batch per GPU', '32', '24'], ['Global batch', '256', '192'],
        ['Activation checkpointing', 'Full', 'None'],
        ['Optimizer', 'Upstream AdamW', 'Dense fused AdamW'],
        ['Frozen-weight retention', 'Disabled', 'Enabled'],
        ['Preprocessing in workers', 'Disabled', 'Enabled'],
        ['Compute precision', 'BF16', 'BF16'],
        ['Gradient accumulation', '1', '1'], ['Steady measured updates', '127', '1,626']
      ],
      note: 'MolmoAct2 uses eight flow timesteps. The two runs share the same model recipe, with preprocessing moved to data-loader workers in SomaSpeed.'
    },
    groot: {
      name: 'GR00T N1.7', native: 86.53746490731848, soma: 240.5713279256343, speedup: 2.7799673607643336,
      axis: 300,
      rows: [
        ['Parallelism', 'HF Trainer · ZeRO-2', 'FSDP · 8 shards'],
        ['Batch per GPU', '80', '640'], ['Global batch', '640', '5,120'],
        ['Activation checkpointing', 'None', 'Full'],
        ['Optimizer', 'Upstream AdamW', 'Dense fused AdamW'],
        ['Frozen-weight retention', 'Disabled', 'Enabled'],
        ['Reshard after forward', 'Upstream default', 'Disabled'],
        ['Compute precision', 'BF16', 'BF16'],
        ['Gradient accumulation', '1', '1'], ['Steady measured updates', '917', '316']
      ],
      note: 'GR00T uses FSDP across all eight GPUs, full activation checkpointing, and keeps gathered parameters after forward. The tuned SomaSpeed global batch is larger.'
    },
    pi05: {
      name: 'π0.5', native: 44.79680292087416, soma: 108.53553775184172, speedup: 2.4228411555072595,
      axis: 150,
      rows: [
        ['Parallelism', 'LeRobot DDP', 'HSDP · 2 replicas × 4 shards'],
        ['Batch per GPU', '8', '128'], ['Global batch', '64', '1,024'],
        ['Activation checkpointing', 'Full', 'None'],
        ['Optimizer', 'Upstream AdamW', 'Dense fused AdamW'],
        ['Frozen-weight retention', 'Disabled', 'Enabled'],
        ['Attention', 'Upstream attention', 'Frozen-prefix Triton'],
        ['Compute / parameter storage', 'BF16 / BF16', 'BF16 / FP32'],
        ['Execution', 'Compiled', 'Eager'],
        ['Gradient accumulation', '1', '1'], ['Steady measured updates', '4,338', '717']
      ],
      note: 'π0.5 is expert-only fine-tuning with a frozen vision-language prefix. Native uses BF16 parameter storage and compilation; SomaSpeed uses FP32 parameter storage and eager execution. Both use BF16 compute.'
    }
  };

  function node(tag, attrs = {}, parent) {
    const element = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    if (parent) parent.appendChild(element);
    return element;
  }
  function text(parent, x, y, value, attrs = {}) {
    const element = node('text', { x, y, 'font-size': 10, ...attrs }, parent);
    element.textContent = value;
    return element;
  }
  function activate(buttons, active, attribute) {
    buttons.forEach(button => {
      const selected = button.dataset[attribute] === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function synchronizeMotion() {
    document.body.classList.toggle('motion-paused', paused);
    const button = $('.motion-toggle');
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Resume animations' : 'Pause animations');
    button.title = paused ? 'Resume animations' : 'Pause animations';
  }
  $('.motion-toggle').addEventListener('click', () => { paused = !paused; synchronizeMotion(); });
  reducedMotion.addEventListener('change', event => { paused = event.matches; synchronizeMotion(); });
  synchronizeMotion();

  // Progressive reveals keep every section readable without JavaScript.
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    }), { threshold: .07 });
    document.body.classList.add('js-ready');
    reveals.forEach(element => revealObserver.observe(element));
  }

  const progress = $('.scroll-progress');
  let scrollFrame = false;
  function updateScroll() {
    const height = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${height > 0 ? window.scrollY / height : 0})`;
    scrollFrame = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollFrame) { scrollFrame = true; requestAnimationFrame(updateScroll); }
  }, { passive: true });
  window.addEventListener('resize', updateScroll);
  updateScroll();
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        $$('.site-header nav a').forEach(link => link.classList.toggle('current', link.hash === `#${entry.target.id}`));
      }
    }), { rootMargin: '-15% 0px -55% 0px' });
    ['results', 'method', 'next'].forEach(id => sectionObserver.observe(document.getElementById(id)));
  }

  function updateChart() {
    const model = benchmarks[selectedModel];
    const relative = metric === 'relative';
    const values = relative ? [1, model.speedup] : [model.native, model.soma];
    const max = relative ? (selectedModel === 'molmoact2' ? 10 : 5) : model.axis;
    const bars = [$('.native-bar'), $('.soma-bar')];
    const labels = bars.map(bar => $('.bar-value', bar));
    cancelAnimationFrame(chartAnimation);
    const starts = labels.map(label => parseFloat(label.textContent) || 0);
    const start = performance.now();
    const duration = reducedMotion.matches || paused ? 0 : 650;
    function count(now) {
      const fraction = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - (1 - fraction) ** 3;
      labels.forEach((label, i) => label.textContent = (starts[i] + (values[i] - starts[i]) * eased).toFixed(2) + (relative ? '×' : ''));
      if (fraction < 1) chartAnimation = requestAnimationFrame(count);
    }
    chartAnimation = requestAnimationFrame(count);
    bars.forEach((bar, i) => { bar.style.width = `${values[i] / max * 100}%`; });
    $$('.chart-axis span').forEach((label, i) => { label.textContent = `${max / 5 * i}${relative ? '×' : ''}`; });
    $('#chart-model-name').textContent = model.name;
    $('.chart-summary').textContent = `${model.speedup.toFixed(2)}× more samples per second`;
    $('.chart').setAttribute('aria-label', `${model.name} throughput: native ${model.native.toFixed(2)} samples per second; SomaSpeed ${model.soma.toFixed(2)} samples per second; ${model.speedup.toFixed(2)} times faster. Displaying ${relative ? 'relative speed' : 'samples per second'}.`);
    $('#benchmark-panel').setAttribute('aria-labelledby', `tab-${selectedModel}`);
    const tbody = $('#config-table');
    tbody.replaceChildren();
    model.rows.forEach(values => {
      const row = document.createElement('tr');
      values.forEach((value, index) => {
        const cell = document.createElement(index ? 'td' : 'th');
        if (!index) cell.scope = 'row';
        cell.textContent = value;
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    $('#config-special').textContent = model.note;
    $('#native-config-link').href = `assets/configs/${selectedModel}-native.toml`;
    $('#soma-config-link').href = `assets/configs/${selectedModel}-somaspeed.toml`;
  }
  const modelTabs = $$('.result-model');
  function selectModel(button) {
    selectedModel = button.dataset.model;
    modelTabs.forEach(tab => {
      const selected = tab === button;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    updateChart();
  }
  modelTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectModel(button));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % modelTabs.length;
      if (event.key === 'ArrowLeft') next = (index + modelTabs.length - 1) % modelTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = modelTabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectModel(modelTabs[next]); modelTabs[next].focus(); }
    });
  });
  const metricButtons = $$('[data-metric]');
  metricButtons.forEach(button => button.addEventListener('click', () => {
    metric = button.dataset.metric;
    activate(metricButtons, metric, 'metric');
    updateChart();
  }));
  updateChart();

  // GPU mesh: a colored segment denotes the local parameter/state shard.
  function drawMesh() {
    const drawing = $('#mesh-drawing');
    drawing.replaceChildren();
    const hybrid = meshMode === 'hsdp';
    const shardCount = hybrid ? 4 : 8;
    text(drawing, 260, 34, hybrid ? 'REPLICA AXIS ↓   /   SHARD AXIS →' : 'ONE SHARD GROUP ACROSS EIGHT GPUs', { 'text-anchor': 'middle', 'font-size': 8, 'letter-spacing': 1.3 });
    for (let row = 0; row < 2; row++) {
      if (hybrid) node('rect', { x: 35, y: 49 + row * 110, width: 450, height: 95, rx: 9, fill: '#f3e5df', stroke: '#dfc9be', 'stroke-dasharray': '3 4' }, drawing);
      for (let column = 0; column < 4; column++) {
        const x = 51 + column * 108;
        const y = 64 + row * 110;
        const id = row * 4 + column;
        node('rect', { x, y, width: 95, height: 66, rx: 6, fill: '#fcf7f3', stroke: '#d8bcb0' }, drawing);
        text(drawing, x + 13, y + 20, `GPU ${id + 1}`, { 'font-size': 8 });
        node('circle', { cx: x + 80, cy: y + 17, r: 2.2, fill: '#be8968', class: 'mesh-pulse', style: `animation-delay:-${id * .45}s` }, drawing);
        const segmentWidth = (69 - (shardCount - 1) * 2) / shardCount;
        for (let part = 0; part < shardCount; part++) {
          const local = part === (hybrid ? column : id);
          node('rect', { x: x + 13 + part * (segmentWidth + 2), y: y + 34, width: segmentWidth, height: 18, rx: 1.3, fill: local ? '#d49389' : '#e9dfd7' }, drawing);
        }
        if (column < 3) node('path', { d: `M${x + 95} ${y + 30}h13`, fill: 'none', stroke: '#d5b49a', 'stroke-width': 1.1 }, drawing);
      }
    }
    if (hybrid) {
      for (let column = 0; column < 4; column++) node('path', { d: `M${98 + column * 108} 144v15`, stroke: '#c7a386', 'stroke-dasharray': '2 3' }, drawing);
    } else {
      node('path', { d: 'M470 97h19v110H38v-32', fill: 'none', stroke: '#d5b49a', 'stroke-width': 1.1 }, drawing);
    }
    node('rect', { x: 138, y: 282, width: 8, height: 8, rx: 1, fill: '#d49389' }, drawing);
    text(drawing, 154, 289, 'Local shard', { 'font-size': 8 });
    node('rect', { x: 271, y: 282, width: 8, height: 8, rx: 1, fill: '#e9dfd7' }, drawing);
    text(drawing, 287, 289, 'On other GPUs', { 'font-size': 8 });
    $('#mesh-svg').setAttribute('aria-label', hybrid ? 'Hybrid sharding: two replicated groups of four GPU shards' : 'Fully sharded training: one model spread over eight GPU shards');
    $('#mesh-caption').textContent = hybrid ? '4 shards × 2 replicas' : '8 shards × 1 replica';
    $('#mesh-explanation').textContent = hybrid ? 'Each row holds one complete model, distributed across four GPUs. The two rows are replicas.' : 'All eight GPUs form one shard group. Each GPU owns one eighth of the sharded parameters and state.';
  }
  const meshButtons = $$('[data-mesh]');
  meshButtons.forEach(button => button.addEventListener('click', () => { meshMode = button.dataset.mesh; activate(meshButtons, meshMode, 'mesh'); drawMesh(); }));
  drawMesh();

  const kernelDescriptions = [
    'Tiles read normalized gradients and sum their squares, across all active parameter tensors.',
    'Tile partials reduce to per-parameter sums. Shard groups then all-reduce these sums across GPUs.',
    'One kernel derives the global gradient norm, clipping factor, and AdamW step scalars.',
    'The update kernel normalizes and clips gradients, then updates weights and moment state together.'
  ];
  function drawOptimizer() {
    const drawing = $('#optimizer-drawing');
    drawing.replaceChildren();
    const fused = optimizerMode === 'fused';
    const names = fused ? ['Tile norms', 'Reduce', 'Clip factor', 'AdamW'] : ['Normalize', 'Norm', 'Clip', 'AdamW'];
    text(drawing, 260, 31, fused ? 'SHARED LAUNCHES ACROSS DENSE TENSORS' : 'REPEATED OPERATIONS FOR EACH TENSOR', { 'text-anchor': 'middle', 'font-size': 8, 'letter-spacing': 1 });
    names.forEach((name, i) => text(drawing, 139 + i * 93, 65, name, { 'text-anchor': 'middle', 'font-size': 8 }));
    for (let tensor = 0; tensor < 3; tensor++) {
      text(drawing, 36, 104 + tensor * 45, `Tensor ${String.fromCharCode(65 + tensor)}`, { 'font-size': 8 });
      node('path', { d: `M91 ${100 + tensor * 45}H461`, stroke: '#dec8b2', 'stroke-width': 1 }, drawing);
      for (let step = 0; step < 4; step++) {
        node('rect', { x: 112 + step * 93, y: 85 + tensor * 45, width: 55, height: 30, rx: 4, fill: fused && step === kernel ? '#dda197' : '#ead8cf', stroke: fused && step === kernel ? '#bd805e' : '#d6b9ac', class: 'optimizer-tile' }, drawing);
        for (let tile = 0; tile < 3; tile++) node('rect', { x: 120 + step * 93 + tile * 13, y: 95 + tensor * 45, width: 8, height: 10, rx: 1, fill: '#fffaf1', opacity: .6 }, drawing);
      }
    }
    if (fused) {
      for (let tensor = 0; tensor < 3; tensor++) node('circle', { cx: 91, cy: 100 + tensor * 45, r: 2.2, fill: '#b97269', class: 'optimizer-signal', style: `animation-delay:-${tensor * 1.1}s` }, drawing);
      names.forEach((name, step) => {
        node('rect', { x: 105 + step * 93, y: 78, width: 69, height: 135, rx: 7, fill: 'none', stroke: step === kernel ? '#b47b56' : '#c9a581', 'stroke-width': step === kernel ? 1.6 : 1, 'stroke-dasharray': '3 4', class: 'optimizer-tile' }, drawing);
        text(drawing, 139 + step * 93, 231, `${step + 1} launch`, { 'text-anchor': 'middle', 'font-size': 7 });
      });
      node('path', { d: 'M281 218v27h-47', fill: 'none', stroke: '#b89978', 'stroke-dasharray': '2 3' }, drawing);
      text(drawing, 260, 265, 'Shard-axis norm reduction between launches 2 and 3', { 'text-anchor': 'middle', 'font-size': 7 });
    } else {
      text(drawing, 260, 243, 'Multiple tensor-level operations and intermediate writes', { 'text-anchor': 'middle', 'font-size': 9 });
      text(drawing, 260, 266, 'Conceptual baseline; exact fusion depends on the upstream trainer', { 'text-anchor': 'middle', 'font-size': 7 });
    }
    $('.kernel-steps').hidden = !fused;
    $('.kernel-explanation').textContent = fused ? kernelDescriptions[kernel] : 'A conceptual per-tensor update repeats work across parameters. SomaSpeed coordinates dense tensors through four shared launches.';
    $('#optimizer-svg').setAttribute('aria-label', fused ? `Four shared Triton launches. Selected launch ${kernel + 1}: ${names[kernel]}.` : 'Conceptual per-tensor baseline: normalization, gradient norm, clipping, and AdamW operations repeated for each parameter tensor.');
    activate($$('[data-kernel]'), String(kernel), 'kernel');
  }
  const optimizerButtons = $$('[data-optimizer]');
  optimizerButtons.forEach(button => button.addEventListener('click', () => { optimizerMode = button.dataset.optimizer; activate(optimizerButtons, optimizerMode, 'optimizer'); drawOptimizer(); }));
  $$('[data-kernel]').forEach(button => button.addEventListener('click', () => { kernel = Number(button.dataset.kernel); drawOptimizer(); }));
  drawOptimizer();

  function drawAttention() {
    const drawing = $('#attention-drawing');
    drawing.replaceChildren();
    const backward = attentionPass === 'backward';
    const x = 186, y = 92, cell = 21, gap = 3;
    text(drawing, 260, 30, backward ? 'GRADIENTS FOLLOW THE TRAINABLE PATH' : 'TWO STREAMS. ONE ATTENTION OUTPUT.', { 'text-anchor': 'middle', 'font-size': 8, 'letter-spacing': 1 });
    text(drawing, x + 71, 62, 'Prefix K / V', { 'text-anchor': 'middle', 'font-size': 9 });
    text(drawing, x + 179, 62, 'Action K / V', { 'text-anchor': 'middle', 'font-size': 9, style: 'fill:#b17468' });
    node('path', { d: `M${x} 77h140m4 0h69`, stroke: '#d0b499', 'stroke-width': 1 }, drawing);
    text(drawing, 166, 162, 'Prefix Q', { 'text-anchor': 'end', 'font-size': 9 });
    text(drawing, 166, 267, 'Action Q', { 'text-anchor': 'end', 'font-size': 9, style: 'fill:#b17468' });
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 9; column++) {
        const prefixQ = row < 6;
        const prefixKV = column < 6;
        const masked = prefixQ && !prefixKV;
        const fill = masked ? 'url(#masked-hatch)' : prefixQ ? '#ddd1c6' : prefixKV ? '#e9c6bd' : '#d89b8d';
        node('rect', { x: x + column * (cell + gap), y: y + row * (cell + gap), width: cell, height: cell, rx: 2, fill, opacity: backward && prefixQ ? .3 : 1, class: 'attention-cell' }, drawing);
      }
    }
    node('rect', { x, y: y + 6 * (cell + gap), width: 69, height: 45, rx: 3, fill: 'none', stroke: '#af7064', 'stroke-width': 1.5, class: 'attention-scan', id: 'attention-scanner' }, drawing);
    if (backward) {
      text(drawing, x + 71, 320, 'read for dQ only', { 'text-anchor': 'middle', 'font-size': 7 });
      text(drawing, x + 179, 320, 'dQ · dK · dV', { 'text-anchor': 'middle', 'font-size': 7, style: 'fill:#ad7250' });
    } else {
      text(drawing, 292, 320, 'Online softmax combines streamed tiles', { 'text-anchor': 'middle', 'font-size': 8 });
    }
    $('.attention-explanation').textContent = backward ? 'Both streams contribute to action-query gradients (dQ). K/V gradients are computed only for trainable action tokens.' : 'Action queries read two K/V streams, tile by tile. Prefix queries only attend to the frozen prefix.';
    $('#attention-svg').setAttribute('aria-label', backward ? 'Backward: prefix queries are frozen. Action-query gradients use both streams. Key and value gradients are computed only for trainable action tokens.' : 'Forward: frozen prefix queries read prefix keys; action queries read both frozen prefix and trainable action keys.');
  }
  const attentionButtons = $$('[data-attention]');
  attentionButtons.forEach(button => button.addEventListener('click', () => { attentionPass = button.dataset.attention; activate(attentionButtons, attentionPass, 'attention'); drawAttention(); }));
  drawAttention();

  // Native SVG teaser: particles follow paths; a two-link arm follows a pick/place arc.
  const gpuGroup = $('#hero-gpus');
  for (let id = 0; id < 8; id++) {
    const x = 457 + (id % 4) * 52, y = 125 + Math.floor(id / 4) * 54;
    const group = node('g', { class: 'hero-gpu', style: `animation-delay:-${id * .4}s` }, gpuGroup);
    node('rect', { x, y, width: 43, height: 41, rx: 5, fill: '#f8ede6', stroke: '#d7b9a9' }, group);
    node('rect', { x: x + 11, y: y + 9, width: 21, height: 20, rx: 3, fill: '#edd1c5', stroke: '#c79887' }, group);
    for (let pin = 0; pin < 3; pin++) {
      node('path', { d: `M${x + 16 + pin * 5} ${y + 5}v4m0 20v4M${x + 7} ${y + 14 + pin * 5}h4m21 0h4`, fill: 'none', stroke: '#c79887', 'stroke-width': 1 }, group);
    }
    node('circle', { cx: x + 36, cy: y + 35, r: 1.5, class: 'hero-gpu-led' }, group);
  }
  const paths = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => $(`#stream-${id}`));
  const particles = [];
  paths.forEach((path, index) => {
    for (let i = 0; i < 3; i++) particles.push({ path, length: path.getTotalLength(), phase: i / 3 + index * .12, speed: index < 3 ? .2 : .38, circle: node('circle', { r: index < 3 ? 2.5 : 2, fill: '#bf7e70', opacity: .7 }, $('#stream-particles')) });
  });
  const teaser = $('.teaser');
  const compactTeaser = window.matchMedia('(max-width: 600px)');
  const originalPaths = paths.map(path => path.getAttribute('d'));
  const stageLabels = $$('.teaser-stage-labels text');
  const originalLabels = stageLabels.map(label => [label.getAttribute('x'), label.getAttribute('y')]);
  function arrangeTeaser() {
    const compact = compactTeaser.matches;
    $('.teaser-svg').setAttribute('viewBox', compact ? '0 0 600 540' : '0 0 1120 350');
    const artwork = [$('.observation-art'), $('.teaser-engine'), $('.robot-art')];
    const transforms = ['translate(20 -20) scale(.85)', 'translate(-259 190)', 'translate(-355 -10) scale(.85)'];
    artwork.forEach((group, index) => {
      if (compact) group.setAttribute('transform', transforms[index]);
      else group.removeAttribute('transform');
    });
    const compactPaths = [
      'M264 94C307 94 159 233 175 326',
      'M264 148C281 185 130 306 175 365',
      'M283 187C302 255 130 325 175 404',
      'M425 326C473 326 466 219 325 151',
      'M425 365C511 365 528 223 330 177',
      'M425 404C560 404 580 294 336 204'
    ];
    paths.forEach((path, index) => path.setAttribute('d', compact ? compactPaths[index] : originalPaths[index]));
    particles.forEach(particle => { particle.length = particle.path.getTotalLength(); });
    const compactLabels = [[183, 226], [300, 508], [441, 255]];
    stageLabels.forEach((label, index) => {
      const position = compact ? compactLabels[index] : originalLabels[index];
      label.setAttribute('x', position[0]); label.setAttribute('y', position[1]);
    });
    const grid = $('.teaser-svg > rect');
    grid.setAttribute('width', compact ? 600 : 1120);
    grid.setAttribute('height', compact ? 540 : 350);
  }
  compactTeaser.addEventListener('change', arrangeTeaser);
  arrangeTeaser();
  let teaserVisible = true;
  let attentionVisible = false;
  if ('IntersectionObserver' in window) {
    const motionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.target === teaser) teaserVisible = entry.isIntersecting;
      else attentionVisible = entry.isIntersecting;
    }));
    motionObserver.observe(teaser);
    motionObserver.observe($('.attention-visual'));
  }
  const armShadow = $('#robot-arm-shadow'), arm = $('#robot-arm'), elbow = $('#robot-elbow'), gripper = $('#robot-gripper'), cube = $('#robot-cube');
  function robotAt(time) {
    const phase = (time / 8500) % 1;
    const smooth = x => x * x * (3 - 2 * x);
    let targetX, targetY, holding = false;
    if (phase < .2) { const p = smooth(phase / .2); targetX = 954 + 38 * p; targetY = 134 + 47 * p; }
    else if (phase < .58) { const p = smooth((phase - .2) / .38); targetX = 992 - 64 * p; targetY = 181 - 72 * Math.sin(Math.PI * p); holding = true; }
    else if (phase < .73) { const p = smooth((phase - .58) / .15); targetX = 928 + 26 * p; targetY = 181 - 47 * p; }
    else { targetX = 954; targetY = 134; }
    const bx = 870, by = 201, l1 = 89, l2 = 89;
    const dx = targetX - bx, dy = targetY - by;
    const angle2 = Math.acos(Math.max(-1, Math.min(1, (dx * dx + dy * dy - l1 * l1 - l2 * l2) / (2 * l1 * l2))));
    const angle1 = Math.atan2(dy, dx) - Math.atan2(l2 * Math.sin(angle2), l1 + l2 * Math.cos(angle2));
    const ex = bx + l1 * Math.cos(angle1), ey = by + l1 * Math.sin(angle1);
    const d = `M${bx} ${by} ${ex.toFixed(2)} ${ey.toFixed(2)} ${targetX.toFixed(2)} ${targetY.toFixed(2)}`;
    armShadow.setAttribute('d', d); arm.setAttribute('d', d);
    elbow.setAttribute('cx', ex); elbow.setAttribute('cy', ey);
    gripper.setAttribute('transform', `translate(${targetX} ${targetY})`);
    const cubeX = holding ? targetX : phase >= .58 && phase < .9 ? 928 : 992;
    const cubeY = holding ? targetY + 27 : 208;
    cube.setAttribute('transform', `translate(${cubeX} ${cubeY})`);
  }
  let activeTime = 0, previousTime = 0, lastScan = -1;
  function animate(now) {
    if (previousTime) {
      const delta = Math.min(now - previousTime, 50);
      if (!paused && !document.hidden) activeTime += delta;
    }
    previousTime = now;
    if (teaserVisible && !paused && !document.hidden) {
      particles.forEach(particle => {
        const fraction = (activeTime / 1000 * particle.speed + particle.phase) % 1;
        const point = particle.path.getPointAtLength(fraction * particle.length);
        particle.circle.setAttribute('cx', point.x);
        particle.circle.setAttribute('cy', point.y);
        particle.circle.setAttribute('opacity', Math.sin(fraction * Math.PI) * .75);
      });
      robotAt(activeTime);
    }
    if (attentionVisible && !paused && !document.hidden) {
      const scan = Math.floor(activeTime / 1800) % 3;
      if (scan !== lastScan) {
        const scanner = $('#attention-scanner');
        if (scanner) scanner.style.transform = `translateX(${scan * 72}px)`;
        lastScan = scan;
      }
    }
    requestAnimationFrame(animate);
  }
  robotAt(0);
  particles.forEach(particle => {
    const point = particle.path.getPointAtLength((particle.phase % 1) * particle.length);
    particle.circle.setAttribute('cx', point.x); particle.circle.setAttribute('cy', point.y);
  });
  requestAnimationFrame(animate);
})();
