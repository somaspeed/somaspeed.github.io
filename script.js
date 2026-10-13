'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  let selectedModel = 'molmoact2';
  let metric = 'throughput';
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
    $$('#benchmark-panel .chart-axis span').forEach((label, i) => { label.textContent = `${max / 5 * i}${relative ? '×' : ''}`; });
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
  const modelTabs = $$('#results > .result-models .result-model');
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

  const scalingPlots = {"molmoact2":{"throughput":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"MolmoAct2 SomaSpeed SFT throughput: 1 GPU: 40.08 samples per second, 2 GPU: 75.56 samples per second, 4 GPU: 147.97 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0</text><path d=\"M48 158.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"162.33\" text-anchor=\"end\" class=\"plot-tick\">100</text><path d=\"M48 121.67H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"125.67\" text-anchor=\"end\" class=\"plot-tick\">200</text><path d=\"M48 85.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"89.00\" text-anchor=\"end\" class=\"plot-tick\">300</text><path d=\"M48 48.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"52.33\" text-anchor=\"end\" class=\"plot-tick\">400</text><path d=\"M48 180.306L154.5 167.295L261 140.746L261 195H48Z\" fill=\"#ab5d52\" opacity=\".06\"/><path d=\"M48 180.306L154.5 167.295L261 140.746\" fill=\"none\" stroke=\"#ab5d52\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"180.306\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"48\" y=\"167.306\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">40.08</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"167.295\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"154.5\" y=\"154.295\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">75.56</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"140.746\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"261\" y=\"127.746\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">147.97</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>","relative":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"MolmoAct2 SomaSpeed SFT throughput: 1 GPU: 40.08 samples per second, 2 GPU: 75.56 samples per second, 4 GPU: 147.97 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0×</text><path d=\"M48 157.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"161.50\" text-anchor=\"end\" class=\"plot-tick\">1×</text><path d=\"M48 120.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"124.00\" text-anchor=\"end\" class=\"plot-tick\">2×</text><path d=\"M48 82.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"86.50\" text-anchor=\"end\" class=\"plot-tick\">3×</text><path d=\"M48 45.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"49.00\" text-anchor=\"end\" class=\"plot-tick\">4×</text><path d=\"M48 157.50L154.5 120.00L261 45.00\" fill=\"none\" stroke=\"#c4b9ad\" stroke-dasharray=\"4 5\"/><path d=\"M48 157.500L154.5 124.296L261 56.542L261 195H48Z\" fill=\"#ab5d52\" opacity=\".06\"/><path d=\"M48 157.500L154.5 124.296L261 56.542\" fill=\"none\" stroke=\"#ab5d52\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"157.500\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"48\" y=\"144.500\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">1.00×</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"124.296\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"154.5\" y=\"111.296\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">1.89×</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"56.542\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#ab5d52\" stroke-width=\"2\"/><text x=\"261\" y=\"43.542\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#ab5d52\">3.69×</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>"},"groot":{"throughput":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"GR00T N1.7 SomaSpeed SFT throughput: 1 GPU: 115.44 samples per second, 2 GPU: 221.95 samples per second, 4 GPU: 380.11 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0</text><path d=\"M48 158.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"162.33\" text-anchor=\"end\" class=\"plot-tick\">100</text><path d=\"M48 121.67H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"125.67\" text-anchor=\"end\" class=\"plot-tick\">200</text><path d=\"M48 85.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"89.00\" text-anchor=\"end\" class=\"plot-tick\">300</text><path d=\"M48 48.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"52.33\" text-anchor=\"end\" class=\"plot-tick\">400</text><path d=\"M48 152.673L154.5 113.617L261 55.627L261 195H48Z\" fill=\"#65877d\" opacity=\".06\"/><path d=\"M48 152.673L154.5 113.617L261 55.627\" fill=\"none\" stroke=\"#65877d\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"152.673\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"48\" y=\"139.673\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">115.44</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"113.617\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"154.5\" y=\"100.617\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">221.95</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"55.627\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"261\" y=\"42.627\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">380.11</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>","relative":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"GR00T N1.7 SomaSpeed SFT throughput: 1 GPU: 115.44 samples per second, 2 GPU: 221.95 samples per second, 4 GPU: 380.11 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0×</text><path d=\"M48 157.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"161.50\" text-anchor=\"end\" class=\"plot-tick\">1×</text><path d=\"M48 120.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"124.00\" text-anchor=\"end\" class=\"plot-tick\">2×</text><path d=\"M48 82.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"86.50\" text-anchor=\"end\" class=\"plot-tick\">3×</text><path d=\"M48 45.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"49.00\" text-anchor=\"end\" class=\"plot-tick\">4×</text><path d=\"M48 157.50L154.5 120.00L261 45.00\" fill=\"none\" stroke=\"#c4b9ad\" stroke-dasharray=\"4 5\"/><path d=\"M48 157.500L154.5 122.898L261 71.521L261 195H48Z\" fill=\"#65877d\" opacity=\".06\"/><path d=\"M48 157.500L154.5 122.898L261 71.521\" fill=\"none\" stroke=\"#65877d\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"157.500\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"48\" y=\"144.500\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">1.00×</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"122.898\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"154.5\" y=\"109.898\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">1.92×</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"71.521\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#65877d\" stroke-width=\"2\"/><text x=\"261\" y=\"58.521\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#65877d\">3.29×</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>"},"pi05":{"throughput":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"π0.5 SomaSpeed SFT throughput: 1 GPU: 43.68 samples per second, 2 GPU: 79.92 samples per second, 4 GPU: 154.76 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0</text><path d=\"M48 158.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"162.33\" text-anchor=\"end\" class=\"plot-tick\">100</text><path d=\"M48 121.67H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"125.67\" text-anchor=\"end\" class=\"plot-tick\">200</text><path d=\"M48 85.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"89.00\" text-anchor=\"end\" class=\"plot-tick\">300</text><path d=\"M48 48.33H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"52.33\" text-anchor=\"end\" class=\"plot-tick\">400</text><path d=\"M48 178.986L154.5 165.695L261 138.256L261 195H48Z\" fill=\"#8b769e\" opacity=\".06\"/><path d=\"M48 178.986L154.5 165.695L261 138.256\" fill=\"none\" stroke=\"#8b769e\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"178.986\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"48\" y=\"165.986\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">43.68</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"165.695\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"154.5\" y=\"152.695\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">79.92</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"138.256\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"261\" y=\"125.256\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">154.76</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>","relative":"<svg viewBox=\"0 0 320 242\" role=\"img\" aria-label=\"π0.5 SomaSpeed SFT throughput: 1 GPU: 43.68 samples per second, 2 GPU: 79.92 samples per second, 4 GPU: 154.76 samples per second\"><path d=\"M48 195.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"199.00\" text-anchor=\"end\" class=\"plot-tick\">0×</text><path d=\"M48 157.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"161.50\" text-anchor=\"end\" class=\"plot-tick\">1×</text><path d=\"M48 120.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"124.00\" text-anchor=\"end\" class=\"plot-tick\">2×</text><path d=\"M48 82.50H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"86.50\" text-anchor=\"end\" class=\"plot-tick\">3×</text><path d=\"M48 45.00H280\" stroke=\"#e6ded5\"/><text x=\"36\" y=\"49.00\" text-anchor=\"end\" class=\"plot-tick\">4×</text><path d=\"M48 157.50L154.5 120.00L261 45.00\" fill=\"none\" stroke=\"#c4b9ad\" stroke-dasharray=\"4 5\"/><path d=\"M48 157.500L154.5 126.378L261 62.126L261 195H48Z\" fill=\"#8b769e\" opacity=\".06\"/><path d=\"M48 157.500L154.5 126.378L261 62.126\" fill=\"none\" stroke=\"#8b769e\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"157.500\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"48\" y=\"144.500\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">1.00×</text><text x=\"48\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">1 GPU</text><circle cx=\"154.5\" cy=\"126.378\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"154.5\" y=\"113.378\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">1.83×</text><text x=\"154.5\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">2 GPUs</text><circle cx=\"261\" cy=\"62.126\" r=\"4.5\" fill=\"#fdfbf8\" stroke=\"#8b769e\" stroke-width=\"2\"/><text x=\"261\" y=\"49.126\" text-anchor=\"middle\" class=\"plot-value\" fill=\"#8b769e\">3.54×</text><text x=\"261\" y=\"220\" text-anchor=\"middle\" class=\"plot-tick\">4 GPUs</text></svg>"}};

  const scalingButtons = $$('[data-scaling-metric]');
  scalingButtons.forEach(button => button.addEventListener('click', () => {
    const value = button.dataset.scalingMetric;
    activate(scalingButtons, value, 'scalingMetric');
    $$('[data-scaling-model]').forEach(card => {
      $('.scaling-plot', card).innerHTML = scalingPlots[card.dataset.scalingModel][value];
    });
    $('.scaling-axis-note').textContent = value === 'relative'
      ? 'Throughput relative to each model’s 1-GPU run · GPU counts evenly spaced · dashed line shows ideal scaling'
      : 'Samples / second · GPU counts evenly spaced · same vertical scale across models';
  }));
  const distributionButtons = $$('[data-distribution]');
  distributionButtons.forEach(button => button.addEventListener('click', () => {
    activate(distributionButtons, button.dataset.distribution, 'distribution');
    $$('[data-distribution-panel]').forEach(panel => {
      panel.hidden = panel.dataset.distributionPanel !== button.dataset.distribution;
    });
  }));
  const contexts = {
    pi05: {
      backboneLabel: 'Vision-language prefix', backboneDetail: 'Encode the observation and instruction',
      contextLabel: 'Prefix keys + values', contextDetail: 'Read as a separate attention stream',
      queryLabel: 'Action queries, keys + values', queryDetail: 'Project the trainable action tokens',
      attentionStreamOne: 'Frozen prefix K/V', attentionStreamTwo: 'Trainable action K/V',
      contextSummary: 'π0.5 · two streams, one attention result.',
      contextDescription: 'Action queries attend to both frozen prefix and trainable action keys/values. Backward reads both streams for action-query gradients, but computes key/value gradients only for the action stream. The full score matrix and a concatenated K/V buffer are never stored.',
      contextFootnote: 'The prefix attends within its own context. Its final layer supplies K/V without computing an unused prefix output. Arrows show the action-expert path.'
    },
    molmoact2: {
      backboneLabel: 'Vision-language backbone', backboneDetail: 'Encode the observation and instruction',
      contextLabel: 'Shared context keys + values', contextDetail: 'Keep one context across flow timesteps',
      queryLabel: 'Action queries', queryDetail: 'Queries for the sampled flow timesteps',
      attentionStreamOne: 'Shared context K/V', attentionStreamTwo: 'Read across flow timesteps',
      contextSummary: 'MolmoAct2 · share context across the action batch.',
      contextDescription: 'Action queries from multiple flow timesteps attend to the same backbone context. The attention kernel reads that context directly instead of repeating its keys and values for every timestep. Backward computes gradients only for inputs that require them.',
      contextFootnote: 'The diagram shows the cross-attention path; the action expert also contains its own action processing. The backbone stays frozen in expert fine-tuning.'
    },
    groot: {
      backboneLabel: 'Vision-language backbone', backboneDetail: 'Extract features from images and language',
      contextLabel: 'Frozen context features', contextDetail: 'Supply features to the action head',
      queryLabel: 'Action queries + context projections', queryDetail: 'Project actions and context inside the head',
      attentionStreamOne: 'Projected context K/V', attentionStreamTwo: 'Action queries read context',
      contextSummary: 'GR00T N1.7 · attend to context without redundant work.',
      contextDescription: 'The action head cross-attends to frozen backbone features. Shared kernels stream attention tiles, retain compact context masks, and avoid storing a full score matrix. Context projections in the trainable head still receive gradients; the frozen backbone does not.',
      contextFootnote: 'The diagram shows the cross-attention path. The feature-only language backbone can skip unused vocabulary logits; action-head projections and loss stay model-specific.'
    }
  };
  const contextButtons = $$('[data-context]');
  contextButtons.forEach(button => button.addEventListener('click', () => {
    activate(contextButtons, button.dataset.context, 'context');
    Object.entries(contexts[button.dataset.context]).forEach(([key, value]) => {
      const id = key.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
      document.getElementById(id).textContent = value;
    });
    $('.context-figure').dataset.model = button.dataset.context;
    drawConnections();
  }));

  function connectionCanvas(id, container) {
    const svg = document.getElementById(id);
    const bounds = container.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    function element(tag, attributes, parent = svg) {
      const node = document.createElementNS(ns, tag);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
      parent.appendChild(node);
      return node;
    }
    const defs = element('defs', {});
    ['context', 'gradient'].forEach((name, index) => {
      const color = index ? '#b17155' : '#b9977d';
      const marker = element('marker', { id: `${id}-${name}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, defs);
      element('path', { d: 'M1 1L8 5L1 9', fill: 'none', stroke: color, 'stroke-width': 1.5 }, marker);
    });
    function box(selector) {
      const rect = container.querySelector(selector).getBoundingClientRect();
      return { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top, x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2 };
    }
    function path(d, gradient = false) {
      element('path', { d, fill: 'none', stroke: gradient ? '#b17155' : '#b9977d', 'stroke-width': 1.3, 'stroke-linejoin': 'round', 'marker-end': `url(#${id}-${gradient ? 'gradient' : 'context'})` });
    }
    return { box, path, bounds };
  }
  function drawConnections() {
    const compact = window.matchMedia('(max-width: 600px)').matches;
    const context = connectionCanvas('context-connections', $('.context-diagram'));
    const source = context.box('.context-store'), attention = context.box('.attention-core');
    if (compact) {
      const rail = attention.left - 9;
      context.path(`M${source.left} ${source.y}H${rail}V${attention.y}H${attention.left}`);
    } else {
      const rail = (source.right + attention.left) / 2;
      context.path(`M${source.right} ${source.y}H${rail}V${attention.y}H${attention.left}`);
    }
    const loss = context.box('.action-output'), projection = context.box('.action-projection');
    const backwardRail = loss.right + 9;
    context.path(`M${loss.right} ${loss.y}H${backwardRail}V${projection.y}H${projection.right}`, true);

    const rl = connectionCanvas('rl-connections', $('.rl-system'));
    const policy = rl.box('.rollout-policy'), packet = rl.box('.experience-packet');
    const replay = rl.box('.ppo-replay'), snapshot = rl.box('.head-snapshot');
    if (window.innerWidth > 800) {
      const firstRail = (policy.right + packet.left) / 2;
      rl.path(`M${policy.right} ${policy.y}H${firstRail}V${packet.y}H${packet.left}`);
      const secondRail = (packet.right + replay.left) / 2;
      rl.path(`M${packet.right} ${packet.y}H${secondRail}V${replay.y}H${replay.left}`);
      const returnY = rl.bounds.height - 6;
      rl.path(`M${snapshot.x} ${snapshot.bottom}V${returnY}H${policy.x}V${policy.bottom}`, true);
    }
  }
  const connectionObserver = new ResizeObserver(drawConnections);
  connectionObserver.observe($('.context-diagram'));
  connectionObserver.observe($('.rl-system'));
  document.fonts.ready.then(drawConnections);
  drawConnections();

  // The original three-part illustration, with a continuous pick/place cycle.
  const svgNS = 'http://www.w3.org/2000/svg';
  const teaser = $('.teaser');
  let teaserVisible = true;
  const sceneVariants = ['', '-mobile'].map(suffix => {
    const find = id => document.getElementById(id + suffix);
    const particles = [];
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((name, index) => {
      const path = find('stream-' + name);
      for (let i = 0; i < (index === 6 ? 3 : 2); i++) {
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('r', index === 6 ? 2.3 : 2.7);
        circle.setAttribute('fill', index === 6 ? '#83946f' : '#b77864');
        find('stream-particles').appendChild(circle);
        particles.push({ path, length: path.getTotalLength(), phase: i / (index === 6 ? 3 : 2) + index * .13, speed: index === 6 ? .13 : .24, circle });
      }
    });
    return { find, particles };
  });
  const ease = t => t * t * (3 - 2 * t);
  function robotPose(time) {
    const phase = time / 9200 % 1;
    let x = 970, y = 112, grip = 18, carrying = false;
    if (phase < .18) {
      const t = ease(phase / .18);x += 34 * t;y += 69 * t;
    } else if (phase < .25) {
      x = 1004;y = 181;grip = 18 - 4 * ease((phase - .18) / .07);
    } else if (phase < .58) {
      const t = ease((phase - .25) / .33);x = 1004 - 66 * t;y = 181 - 73 * Math.sin(Math.PI * t);grip = 14;carrying = true;
    } else if (phase < .65) {
      x = 938;y = 181;grip = 14 + 4 * ease((phase - .58) / .07);
    } else if (phase < .85) {
      const t = ease((phase - .65) / .2);x = 938 + 32 * t;y = 181 - 69 * t;
    }
    const bx = 870, by = 201, length = 89;
    const dx = x - bx, dy = y - by;
    const angle2 = Math.acos(Math.max(-1, Math.min(1, (dx * dx + dy * dy - 2 * length * length) / (2 * length * length))));
    const angle1 = Math.atan2(dy, dx) - Math.atan2(length * Math.sin(angle2), length + length * Math.cos(angle2));
    const ex = bx + length * Math.cos(angle1), ey = by + length * Math.sin(angle1);
    let cubeX = carrying ? x : phase >= .58 && phase < .93 ? 938 : 1004;
    const cubeY = carrying ? y + 27 : 208;
    const opacity = phase >= .85 && phase < .93 ? 1 - ease((phase - .85) / .08) : phase >= .93 ? ease((phase - .93) / .07) : 1;
    return { x, y, ex, ey, grip, cubeX, cubeY, opacity };
  }
  function renderScene(time) {
    const pose = robotPose(time);
    sceneVariants.forEach(({ find, particles }) => {
      const d = `M870 201 ${pose.ex.toFixed(2)} ${pose.ey.toFixed(2)} ${pose.x.toFixed(2)} ${pose.y.toFixed(2)}`;
      find('robot-arm').setAttribute('d', d);
      find('robot-arm-shadow').setAttribute('d', d);
      ['robot-elbow', 'robot-elbow-inset'].forEach(id => {
        find(id).setAttribute('cx', pose.ex);find(id).setAttribute('cy', pose.ey);
      });
      find('robot-gripper').setAttribute('transform', `translate(${pose.x} ${pose.y})`);
      find('gripper-left').setAttribute('d', `M-6 5L${-pose.grip} 12v11l3 4`);
      find('gripper-right').setAttribute('d', `M6 5L${pose.grip} 12v11l-3 4`);
      find('robot-cube').setAttribute('transform', `translate(${pose.cubeX} ${pose.cubeY})`);
      find('robot-cube').setAttribute('opacity', pose.opacity);
      find('observation-scan').setAttribute('transform', `translate(0 ${Math.sin(time / 2300) * 26 + 24})`);
      particles.forEach(particle => {
        const fraction = (time / 1000 * particle.speed + particle.phase) % 1;
        const point = particle.path.getPointAtLength(fraction * particle.length);
        particle.circle.setAttribute('cx', point.x);particle.circle.setAttribute('cy', point.y);
        particle.circle.setAttribute('opacity', Math.sin(fraction * Math.PI) * .8);
      });
    });
  }
  let animationFrame = 0, previousTime = 0, sceneTime = 0;
  function animateScene(now) {
    if (previousTime) sceneTime += Math.min(now - previousTime, 50);
    previousTime = now;
    renderScene(sceneTime);
    animationFrame = requestAnimationFrame(animateScene);
  }
  function synchronizeScene() {
    cancelAnimationFrame(animationFrame);
    previousTime = 0;
    if (!paused && teaserVisible && !document.hidden) animationFrame = requestAnimationFrame(animateScene);
  }
  $('.motion-toggle').addEventListener('click', synchronizeScene);
  reducedMotion.addEventListener('change', synchronizeScene);
  document.addEventListener('visibilitychange', synchronizeScene);
  if ('IntersectionObserver' in window) {
    const visibilityObserver = new IntersectionObserver(entries => {
      teaserVisible = entries[0].isIntersecting;
      synchronizeScene();
    });
    visibilityObserver.observe(teaser);
  }
  renderScene(0);
  synchronizeScene();

  const rlBenchmarks = {"molmoact2":{"name":"MolmoAct2","baseline":0.9820658514513243,"somaspeed":4.21235399376847,"speedup":4.289278552495575,"trials":[{"seed":1234,"baseline":0.9421702849982398,"somaspeed":4.019832949810557},{"seed":5678,"baseline":1.0254895145913665,"somaspeed":4.424243384638464}]},"groot":{"name":"GR00T N1.7","baseline":1.5293913486609239,"somaspeed":3.648822556281504,"speedup":2.3858004424284682,"trials":[{"seed":1234,"baseline":1.5228776838290687,"somaspeed":3.6893015074817206},{"seed":5678,"baseline":1.5359609734456796,"somaspeed":3.6092222334662125}]},"pi05":{"name":"π0.5","baseline":1.343429224292311,"somaspeed":5.89189830435977,"speedup":4.385715449552984,"trials":[{"seed":1234,"baseline":1.2805148798289578,"somaspeed":5.798364142171003},{"seed":5678,"baseline":1.4128452326828487,"somaspeed":5.988499565665268}]}};

  let selectedRLModel = 'molmoact2', rlMetric = 'throughput', rlChartAnimation = 0;
  const rlPanel = document.getElementById('rl-benchmark-panel');
  function updateRLChart() {
    const model = rlBenchmarks[selectedRLModel], relative = rlMetric === 'relative';
    const values = relative ? [1, model.speedup] : [model.baseline, model.somaspeed];
    const maximum = relative ? 5 : 7.5;
    const bars = [$('.native-bar', rlPanel), $('.soma-bar', rlPanel)];
    const labels = bars.map(bar => $('.bar-value', bar));
    cancelAnimationFrame(rlChartAnimation);
    const starts = labels.map(label => parseFloat(label.textContent) || 0);
    const start = performance.now(), duration = reducedMotion.matches || paused ? 0 : 650;
    function count(now) {
      const fraction = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - (1 - fraction) ** 3;
      labels.forEach((label, i) => label.textContent = (starts[i] + (values[i] - starts[i]) * eased).toFixed(2) + (relative ? '×' : ''));
      if (fraction < 1) rlChartAnimation = requestAnimationFrame(count);
    }
    rlChartAnimation = requestAnimationFrame(count);
    bars.forEach((bar, i) => bar.style.width = `${values[i] / maximum * 100}%`);
    $$('.chart-axis span', rlPanel).forEach((label, i) => label.textContent = `${maximum / 5 * i}${relative ? '×' : ''}`);
    $('#rl-chart-model-name').textContent = model.name;
    $('.chart-summary', rlPanel).textContent = `${model.speedup.toFixed(2)}× more observations per second`;
    $('.chart', rlPanel).setAttribute('aria-label', `${model.name} RL throughput: Baseline ${model.baseline.toFixed(2)}, SomaSpeed ${model.somaspeed.toFixed(2)} new observations per second; ${model.speedup.toFixed(2)} times faster. Displaying ${relative ? 'relative speed' : 'observations per second'}.`);
    rlPanel.setAttribute('aria-labelledby', `rl-tab-${selectedRLModel}`);
    const table = $('#rl-seed-table');table.replaceChildren();
    model.trials.forEach(trial => {
      const row = document.createElement('tr');
      [trial.seed, trial.baseline.toFixed(2), trial.somaspeed.toFixed(2)].forEach((value, index) => {
        const cell = document.createElement(index ? 'td' : 'th');
        if (!index) cell.scope = 'row';cell.textContent = value;row.appendChild(cell);
      });
      table.appendChild(row);
    });
    $('#rl-model-note').hidden = selectedRLModel !== 'molmoact2';
  }
  const rlModelTabs = $$('[data-rl-model]');
  function selectRLModel(button) {
    selectedRLModel = button.dataset.rlModel;
    rlModelTabs.forEach(tab => {
      const selected = tab === button;tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));tab.tabIndex = selected ? 0 : -1;
    });
    updateRLChart();
  }
  rlModelTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectRLModel(button));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % rlModelTabs.length;
      if (event.key === 'ArrowLeft') next = (index + rlModelTabs.length - 1) % rlModelTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = rlModelTabs.length - 1;
      if (next !== undefined) { event.preventDefault();selectRLModel(rlModelTabs[next]);rlModelTabs[next].focus(); }
    });
  });
  const rlMetricButtons = $$('[data-rl-metric]');
  rlMetricButtons.forEach(button => button.addEventListener('click', () => {
    rlMetric = button.dataset.rlMetric;activate(rlMetricButtons, rlMetric, 'rlMetric');updateRLChart();
  }));
  updateRLChart();
})();
