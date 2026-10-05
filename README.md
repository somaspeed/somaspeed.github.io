# SomaSpeed project website

A single-page, dependency-free static website for [SomaSpeed](https://github.com/kja7/somaspeed). Open `index.html` directly, or serve this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The teaser, GPU mesh, optimizer, and attention visualizations are native SVG. Styles, scripts, fonts, the logo/favicon, benchmark data, and downloadable configurations are local; the site needs no external services or build step.

Benchmark values and configurations are copied from the SomaSpeed project's `results/tuned.json` and `configs/`. The chart reports steady-state training throughput, with separately tuned batch sizes. It does not claim equivalent convergence or robot task success. The roadmap describes possible future directions.

The motion button pauses diagram animations. Reduced-motion preferences are respected, and model tabs support arrow, Home, and End keys. Without JavaScript, the benchmark summary and explanatory content remain readable.

Local browser-check dependencies live in `.venv/`; downloaded browsers, caches, and screenshots stay inside this directory. These are ignored by `.gitignore` and are not website assets.

For GitHub Pages, use **Deploy from a branch**, with `main` and `/ (root)` as the source. The included `.nojekyll` file serves the static assets without Jekyll processing.
