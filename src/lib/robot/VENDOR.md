# Vendored: Verity robot

This folder is copied verbatim from `accountantRobot/src/robot` — the portable
Three.js character built for the original Verity prototype. It owns geometry,
materials, the receipt printer, and all character animation, and it deliberately
knows nothing about a renderer, a scene, a microphone, or an AI provider.

Do not add app concerns here. The host supplies the renderer, camera, lights and
animation loop, and drives the character through the documented API:

```js
robot.setMode('listening' | 'thinking' | 'speaking' | 'idle')
robot.setAudioLevel(level)        // 0–1, every audio-analysis frame
robot.setOutputAudioActive(bool)  // true while sound is genuinely audible
robot.beginResponse()
robot.appendTranscript(delta)
robot.update(timeSeconds, deltaSeconds)
```

See `README.md` in this folder for the full contract. To pull upstream changes,
re-copy the folder rather than editing files here.
