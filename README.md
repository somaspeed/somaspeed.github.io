# SomaSpeed project website

A dependency-free static website for [SomaSpeed](https://github.com/kja7/somaspeed). Open `index.html` directly or serve this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The teaser builds on the original native SVG observation, GPU-engine, and robot-arm scene with animated data streams, a continuous pick-and-place cycle, and an RL experience feedback path. The method figures use responsive HTML/CSS and native SVG connectors. Performance plots are native SVG; fonts, scripts, styles, the logo, result data, and downloadable configurations are local. No build step or external service is required.

The method reflects public project commit `1c6ee26589d92f05fb447bba1f87326a6cf680b7`: model adapters, FSDP2/HSDP, tensor and pipeline parallelism, shared structured attention for all three models, fused AdamW, concurrent Flow-SDE PPO, cached frozen features, asynchronous head publication, replay graphs, and configurable memory controls. Distribution figures illustrate roles rather than measured hardware layouts. The attention selector distinguishes π0.5 split-stream attention from MolmoAct2 and GR00T cross-attention.

Three separate result sets are presented:

- **Tuned SFT:** `assets/results.json` and the original downloadable 8-GPU configurations. These historical runs retain their original settings; newly available features are not retroactively attributed to them.
- **SFT GPU scaling:** `assets/scaling.csv` and `assets/scaling.json`, filtered from the supplied `scalingmeasurements.csv`. Only SomaSpeed measurements are included. Each model has 1-, 2-, and 4-GPU runs with a fixed batch per GPU and approximately 480 measured seconds per setting. GPU counts are evenly spaced on the horizontal axis. Relative scaling and efficiency use that model’s own 1-GPU throughput.
- **RL throughput:** `assets/rl-results.json`, copied at full precision from the local project’s `artifacts/oct7-update/B-rl/results.csv` and `per-seed.csv`, matching the supplied RL figure. Pooled throughput uses the same model tabs, horizontal bars, and metric controls as SFT. Individual seed values are preserved in the benchmark details. Measurement details describe warmup, wall-time aggregation, and the limits of these short runs.

These figures measure throughput. They do not establish convergence or robot task success. Newer public example configs may differ from the preserved benchmark configurations.

The motion button pauses animation, and reduced-motion preferences are respected. SFT model tabs support arrow, Home, and End keys. Without JavaScript, all three scaling charts, the first RL model, the first distribution layout, and the π0.5 attention diagram remain readable. The site also works when opened directly from disk.

Local browser tools and screenshots live in ignored `.venv/` and `.preview/` directories. Browser checks cover exact chart data, scaling normalization, individual seed values, model and diagram controls, keyboard tabs, reduced motion, direct-file opening, missing assets, and responsive layouts at 320, 390, 600, 768, 1024, and 1440 pixels.

For GitHub Pages, deploy from `main`, `/ (root)`. The included `.nojekyll` file serves static assets without Jekyll processing.
