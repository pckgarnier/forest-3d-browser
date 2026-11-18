# Performance & QA report

## Test machine (not the original target spec)
AMD Radeon RX 9070 XT, Ryzen 7 5700X, 1920×1080 @ 59 Hz monitor, Chrome 157 (Windows 11).
Rendering is forced to a 2560×1440 internal resolution (`?res=2560x1440`).
The original target was an RTX 5070 Ti / Ryzen 7800X3D / 180 Hz display; it has not been measured there.

Bundle: `index.html` is 94,451 bytes minified (36,555 bytes gzip).
Startup (procedural generation) takes about 6–7 s on the Ryzen 7 5700X.

## Scripted 60 s fly-through at 2560×1440 (`node tools/perf.mjs`)
GPU times come from WebGPU timestamp queries. They are logged into a GPU buffer by a tiny
compute pass each frame and read back once at the end, so measuring adds no per-frame readback.

| Run | Frames | GPU avg | GPU p99 | GPU max | CPU frame avg | CPU p99 | CPU max | Frames > 16.7 ms |
|---|---|---|---|---|---|---|---|---|
| Uncapped (vsync off) | 17,849 | 3.29 ms | 3.78 ms | 3.88 ms | 3.36 ms | 3.9 ms | 11.8 ms | 0 |
| Paced at 180 Hz (`HZ=180`) | 10,786 | 4.49 ms | 4.87 ms | 6.81 ms | 5.56 ms | 7.3 ms | 19.2 ms | 3 |

GPU breakdown (uncapped run): shadow 0.75 ms, main 1.76 ms, post (volumetrics, blur, bloom) 0.43 ms, culling 0.06 ms.
GPU time is higher in the 180 Hz run because the GPU downclocks at partial load.

Notes on frame pacing:
- **Paced-run over-budget frames.** The 3 frames over 16.7 ms in the 180 Hz run are all late
  timer callbacks in the test's pacing loop. Each is immediately followed by a ~0.3 ms
  catch-up frame, and GPU time for those frames is 3–7 ms.
- **Uncapped GC stall.** Some uncapped runs show one ~58 ms stall about 23 s in.
  - It is Chrome's unified-heap GC sweeping the WebGPU wrapper objects that every frame must
    create (command encoder, pass encoders, command buffer, swap-chain texture).
  - With vsync off the main thread never idles, so the sweep is deferred and then forced all
    at once (confirmed with a Chrome trace, `tools/trace.mjs`).
  - It has not appeared in any run with idle time (59 Hz vsync, or 180 Hz pacing).
- **Per-frame allocations.** The frame loop's own JS code allocates nothing per frame (all
  buffers, descriptors and typed arrays are preallocated). The ~300 B/frame that a heap
  profile shows (`tools/allocprof.mjs`) is the WebGPU wrapper objects the API requires.

## Blind visual critic (11 rounds)
Each round, a separate agent that only sees renders reviews:
- the 6 fixed poses at 2560×1440,
- a 30-frame contact sheet of the fly-through,
- four bursts of 8 consecutive 60 fps frames at 1:1 scale.

Rounds 5–11 found **no critical defects**: no camera clipping, no visible world edge from
the start view, no rendering corruption, and no shimmer, popping or banding in the bursts.

The final round (r11) still rates three items **major** (art direction):
1. The stag sculpture's body and head lack sculpted detail, and the fly-through mostly sees it backlit.
2. The floating rocks are too uniform in shape and placement.
3. The strata cliffs read as stacked slabs, closer to masonry than eroded rock.

Moderates include flat distant foliage silhouettes, blown-out sky in up-shots,
the ground texture's low detail, and the iridescent bushes reading as noisy.

The original gate ("nothing above minor") is therefore **not passed**.
