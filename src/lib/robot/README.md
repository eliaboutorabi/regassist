# Verity Robot module

This folder is the portable Three.js character. It intentionally does not own a renderer, scene, camera, animation loop, microphone, AI connection, or application UI.

Copy this folder into another browser application, or add this repository as a local dependency and import `verity-accountant-robot/robot`.

## Minimal integration

```js
import * as THREE from "three";
import {
  VerityRobot,
  attachVerityPointerControls,
  createVerityStudioLights,
  frameVerityCamera,
} from "verity-accountant-robot/robot";

const canvas = document.querySelector("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
frameVerityCamera(camera, canvas.clientWidth / canvas.clientHeight);
scene.add(createVerityStudioLights());

const robot = new VerityRobot({ renderer });
scene.add(robot.object3d);
const removePointerControls = attachVerityPointerControls(canvas, robot);

let previousTime = performance.now();
function animate(now) {
  const deltaTime = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  robot.update(now / 1000, deltaTime);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// When the host component is removed:
// removePointerControls();
// robot.dispose();
// renderer.dispose();
```

The module requires `three` and a browser DOM. Pass the renderer so the receipt texture can use the device's maximum anisotropy. It can be omitted when that optimization is not needed.

## Public API

### `new VerityRobot(options?)`

Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `renderer` | `null` | Enables optimal receipt-texture anisotropy. |
| `appearance` | `classic` | Selects `classic` or the blush, pink-paper, and earrings `rose` palette. |
| `accent` | `#5B4CB0` | Changes the equals key and receipt cursor color. |
| `scale` | `0.9` | Initial scale of the complete character. |
| `reducedMotion` | OS preference | Reduces idle, speaking, and paper motion. |

The Three.js group is exposed as `robot.object3d`. The alias `robot.root` remains available for direct transform access.

### Visual state

| Method | Input | Effect |
| --- | --- | --- |
| `setMode(mode)` | `idle`, `listening`, `thinking`, or `speaking` | Selects the character's behavioral state. |
| `setAudioLevel(level)` | Number from `0` to `1` | Drives mouth amplitude and subtle paper flutter. Call every audio-analysis frame. |
| `setOutputAudioActive(active)` | Boolean | Feeds the paper while output is genuinely audible. |
| `beginResponse()` | — | Starts a new receipt response without clearing prior paper. |
| `appendTranscript(delta)` | Incremental text | Queues transcript text for paced printing. |
| `clearTranscript()` | — | Clears all receipt state. |
| `setDragRotation(pitch, yaw)` | Radians | Sets the damped inspection angle. |
| `resetRotation()` | — | Returns the character to its front view. |
| `update(time, deltaTime)` | Seconds | Advances all character animation. Call once per rendered frame. |
| `getState()` | — | Returns a small serializable debug snapshot. |
| `dispose()` | — | Releases robot geometry, materials, and receipt texture and removes it from its parent. |

Constants are exported as `VERITY_APPEARANCES`, `VERITY_MODES`, and `VERITY_DEFAULTS`.

## Voice/audio adapter contract

The robot is provider-agnostic. A WebRTC stream, an HTML audio element, prerecorded audio, or any speech system can drive the same API.

For a spoken response, the host should:

1. Call `beginResponse()` once.
2. Pass transcript deltas to `appendTranscript(delta)` as they arrive.
3. Analyze the actual output waveform and call `setAudioLevel(normalizedAmplitude)` every frame.
4. Keep `setOutputAudioActive(true)` while sound is audible, not merely while an AI response object exists. This is what keeps the receipt moving for the full utterance.
5. Set the audio level to `0` and output activity to `false` after the sound tail ends.

The demo's audio envelope in `src/main.js` is a working adapter example. Keeping that adapter outside this module prevents Verity from being coupled to OpenAI Realtime or to a particular turn-detection strategy.

Secondary motion is built into `update()`: the receipt uses length-aware spring damping and tail deformation, while optional earrings swing from local pivots. Consumers do not need a physics engine or an additional update loop.

## Optional helpers

- `attachVerityPointerControls(element, robot, options?)` makes the robot gently follow the mouse, preserves touch dragging, and returns a cleanup function.
- `attachVerityDragControls(element, robot, options?)` remains available for integrations that want the original drag-only behavior.
- `createVerityStudioLights(options?)` returns the soft four-light reference rig as a `THREE.Group`.
- `frameVerityCamera(camera, aspect?)` applies the camera framing used by the demo.

All helpers are optional. Existing Three.js applications can use their own controls, lights, and camera.

## Folder boundary

```text
src/robot/
├── VerityRobot.js    # Geometry, materials, receipt, and animation state
├── dragControls.js   # Optional pointer adapter
├── studioLights.js   # Optional reference lighting and camera framing
├── index.js          # Stable public exports
└── README.md         # Integration contract
```

Consumers should import only from `index.js` (or the `/robot` package export). Files behind that entry point are implementation details and can change without forcing integration changes.
