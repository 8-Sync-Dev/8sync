---
name: locate-anything
description: >-
  Fast open-vocabulary VISUAL GROUNDING via NVIDIA LocateAnything-3B (run through
  the mudler/locate-anything.cpp ggml port, no Python). Turns an image + a text
  description into labeled bounding boxes + click-center coordinates. Use when you
  need EXACT PIXEL COORDINATES from an image — GUI element grounding (to click a
  button/field precisely), OCR/text localization, open-set object detection —
  rather than a prose description. Invoked as `8sync locate <image> "<target>"`.
  Complements a native VLM / zai-vision (which describe) and the browser tool (which clicks).
---

# locate-anything — visual grounding for exact coordinates

**What it is.** NVIDIA **LocateAnything-3B** (Qwen2.5-3B LM + MoonViT + MLP projector)
run through **`mudler/locate-anything.cpp`** — an MIT C++/ggml port with prebuilt
GGUFs, no Python at inference. It does **grounding, not captioning**: give it an image
and an open-vocabulary phrase; it returns labeled boxes. `8sync locate` wraps it and
adds a **click-center** per box so you can drive the `browser` tool straight to a target.

**When to reach for it (vs. the alternatives):**

| Need | Tool |
| --- | --- |
| "What does this screen say / what's the error?" (describe) | **Look yourself** if GLM-5.3 / 5.3-Flash; **zai-vision** only if text-only |
| "Where EXACTLY is the Sign-in button?" (coordinates to click) | **`8sync locate`** (this skill) |
| Read structure of a graph/dashboard | render + read as image (`8sync shot`, image-routing) — non-vision models then get positions via **`8sync locate`** (automatic) |
| Precise code/config/text | read as TEXT (never image) |

Self-check: if the next action is a **click / crop / measure at a pixel**, you want a
BOX → `8sync locate`. If it's "understand the content", look yourself (GLM-5.3) or zai-vision (GLM-5.2 only).

## Setup (once)

```sh
8sync locate --setup   # clones + cmake-builds locate-anything.cpp, downloads q8_0 GGUF (~6.3 GB)
```

Builds with CUDA if the toolkit is present, else CPU (still ~1.7–3× faster than the
official PyTorch path). Artifacts live under `~/.cache/8sync/locate-anything/`.

## Use

```sh
# Ground a UI element → box + click point
8sync locate ui.png "the Sign in button"
#   → 1 detection(s):
#     the Sign in button   box [812, 40, 940, 78]  click≈(876, 59)

# Multi-category (separate with </c>)
8sync locate street.jpg "person</c>car"

# Draw the boxes for a visual check
8sync locate ui.png "the search field" --annotated /tmp/boxed.png

# Decode mode: hybrid (default, Parallel Box Decoding) | slow | fast
8sync locate ui.png "submit" --mode fast
```

## The high-value pipeline: shot → locate → click

```sh
8sync shot http://localhost:3000 -o /tmp/ui.png
8sync locate /tmp/ui.png "the primary CTA button"    # → click≈(cx, cy)
```

Then in the `browser` tool, click at those coordinates (map back to the live viewport
if the shot used a different width). This closes the loop that pure vision-description
can't: **see → locate → act**, saving the round-trips of guessing selectors.

## Notes / limits

- **License:** the LocateAnything-3B weights are **NVIDIA research / non-commercial use
  only**. The `locate-anything.cpp` code is MIT. Respect the model license.
- Single-image, greedy decoding by design (the port drops stochastic sampling and
  multi-image, which don't have parity-checked detection semantics).
- Coordinates are in the analyzed image's pixel space — rescale if the screenshot
  viewport differs from the live page.
- Prompts are open-vocabulary; a concrete noun phrase ("the red delete icon") grounds
  better than a vague one.
