import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const VERITY_MODES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
});

export const VERITY_APPEARANCES = Object.freeze({
  classic: Object.freeze({
    accent: "#5B4CB0",
    body: 0xf1eee5,
    bodySide: 0xe3ded3,
    faceRim: 0xaaa69f,
    face: 0x11162f,
    key: 0x666976,
    symbol: 0xfffdf6,
    mouth: 0xc3c4c7,
    slot: 0x454852,
    paper: 0xfffdf7,
    paperBack: 0xe9e4da,
    paperEdge: 0xd8d2c7,
    paperCss: "#fffdf6",
    paperRgb: "255, 253, 246",
    earrings: false,
  }),
  rose: Object.freeze({
    accent: "#C84F82",
    body: 0xf6e8e7,
    bodySide: 0xe5cecf,
    faceRim: 0xb49ca8,
    face: 0x28172f,
    key: 0x896d80,
    symbol: 0xfffbf7,
    mouth: 0xe6cbd8,
    slot: 0x594654,
    paper: 0xffedf3,
    paperBack: 0xead5dd,
    paperEdge: 0xdabac7,
    paperCss: "#fcebf1",
    paperRgb: "252, 235, 241",
    earrings: true,
  }),
});

export const VERITY_DEFAULTS = Object.freeze({
  appearance: "classic",
  accent: VERITY_APPEARANCES.classic.accent,
  scale: 0.9,
});

function createClayBumpTexture() {
  const size = 128;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const textureContext = textureCanvas.getContext("2d");
  const image = textureContext.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broadNoise = Math.sin(x * 0.17) * 3.5
        + Math.sin(y * 0.13) * 3.2
        + Math.sin((x + y) * 0.075) * 2.5;
      const fineNoise = Math.sin(x * 1.71 + y * 2.13) * 1.2;
      const value = Math.round(128 + broadNoise + fineNoise);
      const index = (y * size + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }

  textureContext.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

let clayBumpTexture = null;

function getClayBumpTexture() {
  clayBumpTexture ||= createClayBumpTexture();
  return clayBumpTexture;
}

function roundedMaterial(color, roughness = 0.84, metalness = 0, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    specularIntensity: options.specularIntensity ?? 0.24,
    specularColor: options.specularColor ?? 0xfff8ee,
    bumpMap: options.bumpScale === 0 ? null : getClayBumpTexture(),
    bumpScale: options.bumpScale ?? 0.012,
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.85,
  });
}

function makeRoundedBox(width, height, depth, radius, material, segments = 7) {
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(width, height, depth, segments, radius),
    material,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeRoundedPanel(width, height, depth, radius, material) {
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.045,
    bevelSegments: 5,
    curveSegments: 16,
  });
  geometry.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geometry, material);
}

function makeSoftCylinder(length, radius, bevel, material) {
  const halfLength = length / 2;
  const profile = [
    new THREE.Vector2(0, -halfLength),
    new THREE.Vector2(radius - bevel, -halfLength),
    new THREE.Vector2(radius, -halfLength + bevel),
    new THREE.Vector2(radius, halfLength - bevel),
    new THREE.Vector2(radius - bevel, halfLength),
    new THREE.Vector2(0, halfLength),
  ];
  return new THREE.Mesh(new THREE.LatheGeometry(profile, 40), material);
}

function makeSymbol(symbol, material) {
  const group = new THREE.Group();
  const addBar = (width, height, x = 0, y = 0, rotation = 0) => {
    const bar = makeRoundedBox(width, height, 0.14, 0.055, material, 7);
    bar.position.set(x, y, 0.285);
    bar.rotation.z = rotation;
    bar.castShadow = false;
    bar.receiveShadow = false;
    group.add(bar);
  };

  if (symbol === "+") {
    addBar(0.58, 0.14);
    addBar(0.14, 0.58);
  } else if (symbol === "−") {
    addBar(0.58, 0.14);
  } else if (symbol === "×") {
    addBar(0.14, 0.6, 0, 0, Math.PI / 4);
    addBar(0.14, 0.6, 0, 0, -Math.PI / 4);
  } else if (symbol === "=") {
    addBar(0.6, 0.14, 0, 0.16);
    addBar(0.6, 0.14, 0, -0.16);
  }

  return group;
}

function stepSpring(state, target, stiffness, damping, deltaTime) {
  const acceleration = (target - state.value) * stiffness - state.velocity * damping;
  state.velocity += acceleration * deltaTime;
  state.value += state.velocity * deltaTime;
  return state.value;
}

export class VerityRobot {
  constructor({
    renderer = null,
    reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    appearance = VERITY_DEFAULTS.appearance,
    accent = null,
    scale = VERITY_DEFAULTS.scale,
  } = {}) {
    const palette = VERITY_APPEARANCES[appearance] ?? VERITY_APPEARANCES.classic;
    this.root = new THREE.Group();
    this.root.name = "VerityRobot";
    this.floatGroup = new THREE.Group();
    this.root.add(this.floatGroup);

    this.reducedMotion = reducedMotion;
    this.appearance = VERITY_APPEARANCES[appearance] ? appearance : "classic";
    this.palette = palette;
    this.accent = accent ?? palette.accent;
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;

    this.mode = "idle";
    this.audioLevel = 0;
    this.outputAudioActive = false;
    this.transcript = "";
    this.printedTranscript = "";
    this.pendingReceiptText = "";
    this.printCharacterBudget = 0;
    this.receiptLines = [];
    this.nextReceiptLineId = 1;
    this.forceNewReceiptLine = true;
    this.paperProgress = 0.3;
    this.paperTarget = 0.3;
    this.paperPathLength = 0.72;
    this.maxPaperPathLength = 5.15;
    this.paperFeedDistance = 0;
    this.paperTextTravel = 0;
    this.paperDrawAccumulator = 0;
    this.nextBlinkAt = 2.4 + Math.random() * 2;
    this.blinkStartedAt = -1;
    this.dragRotationTarget = new THREE.Vector2();
    this.dragRotation = new THREE.Vector2();
    this.paperTailSwayX = 0;
    this.paperTailSwayZ = 0;
    this.secondaryMotion = {
      initialized: false,
      previousYaw: 0,
      previousPitch: 0,
      previousRoll: 0,
      previousFloatY: 0,
      previousVerticalVelocity: 0,
      paperYaw: { value: 0, velocity: 0 },
      paperPitch: { value: 0, velocity: 0 },
      paperRoll: { value: 0, velocity: 0 },
      tailX: { value: 0, velocity: 0 },
      tailZ: { value: 0, velocity: 0 },
    };

    this.ivory = roundedMaterial(palette.body, 0.92, 0, {
      specularIntensity: 0.16,
      bumpScale: 0.018,
    });
    this.ivorySide = roundedMaterial(palette.bodySide, 0.93, 0, {
      specularIntensity: 0.14,
      bumpScale: 0.018,
    });
    this.faceRimMaterial = roundedMaterial(palette.faceRim, 0.9, 0, {
      specularIntensity: 0.18,
      bumpScale: 0.012,
    });
    this.faceMaterial = roundedMaterial(palette.face, 0.64, 0, {
      specularIntensity: 0.3,
      bumpScale: 0.006,
      clearcoat: 0.08,
      clearcoatRoughness: 0.72,
    });
    this.keyMaterial = roundedMaterial(palette.key, 0.88, 0, {
      specularIntensity: 0.18,
      bumpScale: 0.015,
    });
    this.purpleMaterial = roundedMaterial(this.accent, 0.84, 0, {
      specularIntensity: 0.22,
      bumpScale: 0.014,
    });
    this.whiteMaterial = roundedMaterial(palette.symbol, 0.82, 0, {
      specularIntensity: 0.18,
      bumpScale: 0.012,
    });
    this.mouthMaterial = roundedMaterial(palette.mouth, 0.82, 0, {
      specularIntensity: 0.16,
      bumpScale: 0.01,
    });

    this.buildBody();
    this.buildPaper();
    this.root.scale.setScalar(scale);
  }

  get object3d() {
    return this.root;
  }

  buildBody() {
    this.body = makeRoundedBox(4.25, 5.4, 1.88, 0.73, this.ivory, 10);
    this.body.position.y = -0.3;
    this.floatGroup.add(this.body);

    // A single softly rounded display sits directly in the ivory shell. Keeping
    // it partially embedded avoids the separate metallic-looking frame from the
    // earlier two-mesh construction.
    this.face = makeRoundedPanel(3.06, 1.46, 0.07, 0.27, this.faceMaterial);
    this.face.position.set(0, 1.19, 0.975);
    this.face.castShadow = false;
    this.face.receiveShadow = false;
    this.floatGroup.add(this.face);

    const eyeGeometry = new THREE.SphereGeometry(0.205, 32, 24);
    this.eyes = [-0.7, 0.7].map((x) => {
      const eye = new THREE.Mesh(eyeGeometry, this.whiteMaterial);
      eye.scale.set(1, 1.16, 0.52);
      eye.position.set(x, 1.26, 1.09);
      eye.userData.restX = x;
      eye.castShadow = true;
      eye.renderOrder = 4;
      this.floatGroup.add(eye);
      return eye;
    });

    const smileCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.2, 0.03, 0),
      new THREE.Vector3(0, -0.17, 0),
      new THREE.Vector3(0.2, 0.03, 0),
    );
    this.mouth = new THREE.Mesh(
      new THREE.TubeGeometry(smileCurve, 20, 0.035, 8, false),
      this.mouthMaterial,
    );
    this.mouth.position.set(0, 1.08, 1.105);
    this.mouth.renderOrder = 4;
    this.floatGroup.add(this.mouth);

    const keySpecs = [
      { symbol: "+", x: -0.76, y: -0.38, material: this.keyMaterial },
      { symbol: "−", x: 0.76, y: -0.38, material: this.keyMaterial },
      { symbol: "×", x: -0.76, y: -1.72, material: this.keyMaterial },
      { symbol: "=", x: 0.76, y: -1.72, material: this.purpleMaterial },
    ];

    this.keys = keySpecs.map(({ symbol, x, y, material }) => {
      const group = new THREE.Group();
      const key = makeRoundedBox(1.15, 1.04, 0.5, 0.27, material, 8);
      key.castShadow = false;
      const label = makeSymbol(symbol, this.whiteMaterial);
      label.position.set(0, 0, 0);
      group.add(key, label);
      group.position.set(x, y, 1.12);
      this.floatGroup.add(group);
      return group;
    });

    this.hands = [-1, 1].map((side) => {
      const hand = makeSoftCylinder(0.28, 0.33, 0.055, this.ivorySide);
      hand.rotation.z = Math.PI / 2;
      hand.position.set(side * 2.19, 0.75, 0.34);
      hand.castShadow = false;
      hand.receiveShadow = true;
      this.floatGroup.add(hand);
      return hand;
    });

    const slotMaterial = roundedMaterial(this.palette.slot, 0.94, 0, {
      specularIntensity: 0.1,
      bumpScale: 0.008,
    });
    this.slot = makeRoundedBox(1.98, 0.16, 0.5, 0.065, slotMaterial, 8);
    this.slot.position.set(0, 2.46, 0.015);
    this.slot.castShadow = false;
    this.slot.receiveShadow = false;
    this.floatGroup.add(this.slot);

    this.paperGuides = [-0.94, 0.94].map((x) => {
      const guide = makeRoundedBox(0.18, 0.24, 0.4, 0.06, this.faceRimMaterial, 8);
      guide.position.set(x, 2.49, 0.09);
      guide.castShadow = false;
      guide.receiveShadow = true;
      this.floatGroup.add(guide);
      return guide;
    });
    this.paperRollers = [];

    if (this.palette.earrings) this.buildEarrings();
  }

  buildEarrings() {
    const earringMaterial = roundedMaterial(this.accent, 0.86, 0, {
      specularIntensity: 0.18,
      bumpScale: 0.012,
    });
    const studGeometry = new THREE.SphereGeometry(0.055, 18, 14);
    const dollarCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.095, 0.14, 0),
      new THREE.Vector3(0.025, 0.175, 0),
      new THREE.Vector3(-0.09, 0.12, 0),
      new THREE.Vector3(-0.08, 0.035, 0),
      new THREE.Vector3(0.075, -0.025, 0),
      new THREE.Vector3(0.085, -0.105, 0),
      new THREE.Vector3(-0.025, -0.17, 0),
      new THREE.Vector3(-0.105, -0.135, 0),
    ], false, "catmullrom", 0.5);
    const dollarCurveGeometry = new THREE.TubeGeometry(
      dollarCurve,
      32,
      0.026,
      8,
      false,
    );

    this.earrings = [-1, 1].map((side) => {
      const earring = new THREE.Group();
      earring.name = side < 0 ? "VerityLeftEarring" : "VerityRightEarring";

      const stud = new THREE.Mesh(studGeometry, earringMaterial);
      stud.position.y = 0.11;
      stud.castShadow = true;

      const connector = makeRoundedBox(0.035, 0.09, 0.055, 0.015, earringMaterial, 5);
      connector.position.y = 0.045;
      connector.castShadow = true;

      const dollarSign = new THREE.Group();
      const dollarCurveMesh = new THREE.Mesh(dollarCurveGeometry, earringMaterial);
      dollarCurveMesh.castShadow = true;
      const dollarStroke = makeRoundedBox(0.036, 0.42, 0.07, 0.016, earringMaterial, 5);
      dollarStroke.position.z = -0.015;
      dollarStroke.castShadow = true;
      dollarSign.add(dollarCurveMesh, dollarStroke);
      dollarSign.position.y = -0.19;
      dollarSign.scale.setScalar(0.92);

      const charmPivot = new THREE.Group();
      charmPivot.position.y = 0.045;
      charmPivot.add(dollarSign);

      earring.add(stud, connector, charmPivot);
      earring.position.set(side * 2.2, 0.38, 0.62);
      earring.userData.side = side;
      earring.userData.charmPivot = charmPivot;
      earring.userData.swing = { value: 0, velocity: 0 };
      earring.userData.depthSwing = { value: 0, velocity: 0 };
      this.floatGroup.add(earring);
      return earring;
    });
  }

  buildPaper() {
    const width = 1.75;
    const height = 2.55;
    const geometry = new THREE.PlaneGeometry(width, height, 10, 40);
    geometry.translate(0, height / 2, 0);
    this.paperWidth = width;
    this.paperHeight = height;
    this.paperBendStart = 0.84;
    this.paperBendRadius = 0.62;
    this.paperBasePositions = geometry.attributes.position.array.slice();

    this.paperCanvas = document.createElement("canvas");
    this.paperCanvas.width = 512;
    this.paperCanvas.height = 768;
    this.paperContext = this.paperCanvas.getContext("2d");
    this.paperTexture = new THREE.CanvasTexture(this.paperCanvas);
    this.paperTexture.colorSpace = THREE.SRGBColorSpace;
    this.paperTexture.anisotropy = this.maxAnisotropy;

    const material = new THREE.MeshStandardMaterial({
      map: this.paperTexture,
      color: this.palette.paper,
      roughness: 0.94,
      metalness: 0,
      side: THREE.FrontSide,
    });

    this.paper = new THREE.Mesh(geometry, material);
    this.paper.position.set(0, 2.47, -0.08);
    this.paper.castShadow = false;
    this.paper.renderOrder = -1;
    this.paper.frustumCulled = false;

    const paperBackMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.paperBack,
      roughness: 0.96,
      metalness: 0,
      side: THREE.BackSide,
    });
    this.paperBack = new THREE.Mesh(geometry, paperBackMaterial);
    this.paperBack.castShadow = false;
    this.paperBack.frustumCulled = false;
    this.paperBack.renderOrder = -2;
    this.paper.add(this.paperBack);

    const paperEdgeMaterial = new THREE.LineBasicMaterial({
      color: this.palette.paperEdge,
      transparent: true,
      opacity: 0.72,
    });
    this.paperEdges = [-1, 1].map((side) => {
      const edge = new THREE.Line(new THREE.BufferGeometry(), paperEdgeMaterial);
      edge.userData.side = side;
      edge.frustumCulled = false;
      this.paper.add(edge);
      return edge;
    });
    this.paperTopEdge = new THREE.Line(new THREE.BufferGeometry(), paperEdgeMaterial);
    this.paperTopEdge.frustumCulled = false;
    this.paper.add(this.paperTopEdge);

    this.floatGroup.add(this.paper);
    this.updatePaperGeometry(this.paperPathLength);
    this.drawPaper();
  }

  mapPaperPosition(x, pathY) {
    if (pathY <= this.paperBendStart) return new THREE.Vector3(x, pathY, 0);
    const distanceIntoBend = pathY - this.paperBendStart;
    const quarterTurnLength = this.paperBendRadius * Math.PI / 2;
    const bendDistance = Math.min(distanceIntoBend, quarterTurnLength);
    const bendAngle = bendDistance / this.paperBendRadius;
    const trailingDistance = Math.max(0, distanceIntoBend - quarterTurnLength);
    const bendProgress = bendAngle / (Math.PI / 2);
    const fallRadius = 2.2;
    const backwardTravel = trailingDistance > 0
      ? fallRadius * (1 - Math.exp(-trailingDistance / fallRadius))
      : 0;
    const gravityDrop = (trailingDistance - backwardTravel) * 1.25;
    const looseLength = Math.max(this.paperPathLength - this.paperBendStart, 0.4);
    const tailProgress = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp(distanceIntoBend / looseLength, 0, 1),
      0,
      1,
    );
    return new THREE.Vector3(
      x * (1 - 0.028 * bendProgress) + this.paperTailSwayX * tailProgress,
      this.paperBendStart + Math.sin(bendAngle) * this.paperBendRadius - gravityDrop,
      -(1 - Math.cos(bendAngle)) * this.paperBendRadius
        - backwardTravel
        + this.paperTailSwayZ * tailProgress,
    );
  }

  updatePaperGeometry(visibleLength) {
    const clampedLength = THREE.MathUtils.clamp(visibleLength, 0.2, this.maxPaperPathLength);
    const positions = this.paper.geometry.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      const sourceIndex = index * 3;
      const baseX = this.paperBasePositions[sourceIndex];
      const normalizedY = this.paperBasePositions[sourceIndex + 1] / this.paperHeight;
      const pathY = normalizedY * clampedLength;
      const mapped = this.mapPaperPosition(baseX, pathY);
      positions.setXYZ(index, mapped.x, mapped.y, mapped.z);
    }
    positions.needsUpdate = true;
    this.paper.geometry.computeVertexNormals();

    this.paperEdges.forEach((edge) => {
      const edgePoints = Array.from({ length: 41 }, (_, index) => {
        const pathY = clampedLength * index / 40;
        return this.mapPaperPosition(edge.userData.side * this.paperWidth / 2, pathY);
      });
      edge.geometry.setFromPoints(edgePoints);
    });
    const topLeft = this.mapPaperPosition(-this.paperWidth / 2, clampedLength);
    const topRight = this.mapPaperPosition(this.paperWidth / 2, clampedLength);
    this.paperTopEdge.geometry.setFromPoints([topLeft, topRight]);
  }

  wrapTranscript(text, maxCharacters = 24) {
    const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const lines = [];
    let line = "";

    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxCharacters && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });

    if (line) lines.push(line);
    return lines.slice(-12);
  }

  drawPaper() {
    const context = this.paperContext;
    const { width, height } = this.paperCanvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = this.palette.paperCss;
    context.fillRect(0, 0, width, height);

    const curlDepthShade = context.createLinearGradient(0, 0, 0, height * 0.52);
    curlDepthShade.addColorStop(0, "rgba(91, 87, 78, 0.17)");
    curlDepthShade.addColorStop(0.34, "rgba(112, 106, 96, 0.08)");
    curlDepthShade.addColorStop(1, `rgba(${this.palette.paperRgb}, 0)`);
    context.fillStyle = curlDepthShade;
    context.fillRect(0, 0, width, height * 0.54);

    const curlSideShade = context.createLinearGradient(0, 0, width, 0);
    curlSideShade.addColorStop(0, `rgba(${this.palette.paperRgb}, 0)`);
    curlSideShade.addColorStop(0.72, `rgba(${this.palette.paperRgb}, 0)`);
    curlSideShade.addColorStop(1, "rgba(82, 78, 70, 0.07)");
    context.fillStyle = curlSideShade;
    context.fillRect(0, 0, width, height * 0.54);

    const paperBandOffset = -(this.paperFeedDistance % 28);
    context.fillStyle = "rgba(74, 70, 62, 0.05)";
    for (let y = paperBandOffset; y < height; y += 28) {
      context.fillRect(24, y, width - 48, 1);
    }

    context.strokeStyle = "rgba(91, 76, 176, 0.16)";
    context.lineWidth = 2;
    context.setLineDash([8, 10]);
    context.beginPath();
    context.moveTo(55, 55);
    context.lineTo(width - 55, 55);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#282c3d";
    context.font = "500 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textBaseline = "top";

    const maxCharacters = 24;
    const lineHeight = 38;
    const glyphWidth = context.measureText("M").width;
    const textColumnWidth = glyphWidth * maxCharacters;
    const textX = (width - textColumnWidth) / 2;
    const printHeadY = height - 84;
    this.receiptLines.forEach((line) => {
      const lineY = printHeadY - (this.paperFeedDistance - line.feedPosition);
      if (lineY > -lineHeight && lineY < height) {
        context.fillText(line.text, textX, lineY);
      }
    });

    const currentLine = this.receiptLines.at(-1);
    this.paperTextTravel = currentLine
      ? Math.max(0, this.paperFeedDistance - currentLine.feedPosition)
      : 0;

    if (this.mode === "speaking" && currentLine) {
      const cursorY = printHeadY
        - (this.paperFeedDistance - currentLine.feedPosition)
        + lineHeight - 3;
      const cursorX = textX + Math.min(currentLine.text.length, maxCharacters) * glyphWidth;
      context.fillStyle = this.accent;
      context.fillRect(cursorX, cursorY, 14, 3);
    }

    this.paperTexture.needsUpdate = true;
  }

  beginResponse() {
    if (this.transcript.trim()) this.transcript += "\n";
    this.pendingReceiptText = this.receiptLines.length ? "\n" : "";
    this.printCharacterBudget = 0;
    this.setMode("speaking");
    this.paperTarget = Math.max(this.paperTarget, 0.54);
    this.drawPaper();
  }

  appendTranscript(delta) {
    if (!delta) return;
    this.transcript = (this.transcript + delta).slice(-650);
    this.pendingReceiptText += delta;
    const lineCount = this.wrapTranscript(this.transcript).length;
    this.paperTarget = THREE.MathUtils.clamp(0.42 + lineCount * 0.075, 0.5, 1);
  }

  printReceiptText(text) {
    if (!text) return;
    this.printedTranscript = (this.printedTranscript + text).slice(-650);

    for (const character of text) {
      if (character === "\r") continue;
      if (character === "\n") {
        this.forceNewReceiptLine = true;
        continue;
      }

      let currentLine = this.receiptLines.at(-1);
      if (this.forceNewReceiptLine || !currentLine || currentLine.text.length >= 24) {
        currentLine = {
          id: this.nextReceiptLineId,
          text: "",
          feedPosition: this.paperFeedDistance,
        };
        this.nextReceiptLineId += 1;
        this.receiptLines.push(currentLine);
        this.forceNewReceiptLine = false;
        if (this.receiptLines.length > 36) this.receiptLines.shift();
      }

      if (character === " " && currentLine.text.length === 0) continue;
      currentLine.text += character;
    }
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.drawPaper();
  }

  setAudioLevel(level) {
    this.audioLevel = THREE.MathUtils.clamp(level, 0, 1);
  }

  setOutputAudioActive(active) {
    this.outputAudioActive = active;
  }

  setDragRotation(pitch, yaw) {
    this.dragRotationTarget.set(pitch, yaw);
  }

  resetRotation() {
    this.setDragRotation(0, 0);
  }

  clearTranscript() {
    this.transcript = "";
    this.printedTranscript = "";
    this.pendingReceiptText = "";
    this.printCharacterBudget = 0;
    this.receiptLines = [];
    this.nextReceiptLineId = 1;
    this.forceNewReceiptLine = true;
    this.paperTarget = 0.3;
    this.paperPathLength = 0.72;
    this.updatePaperGeometry(this.paperPathLength);
    this.paperTextTravel = 0;
    this.drawPaper();
  }

  getState() {
    return {
      mode: this.mode,
      appearance: this.appearance,
      audioLevel: Number(this.audioLevel.toFixed(3)),
      transcript: this.transcript,
      paperFeedDistance: Number(this.paperFeedDistance.toFixed(2)),
      receiptLines: this.receiptLines.map((line) => ({
        id: line.id,
        text: line.text,
        feedPosition: line.feedPosition,
      })),
    };
  }

  dispose() {
    const geometries = new Set();
    const materials = new Set();

    this.root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.paperTexture.dispose();
    this.root.removeFromParent();
  }

  updateSecondaryMotion(deltaTime, motionScale) {
    const state = this.secondaryMotion;
    const yaw = this.floatGroup.rotation.y;
    const pitch = this.floatGroup.rotation.x;
    const roll = this.floatGroup.rotation.z;
    const floatY = this.floatGroup.position.y;

    if (!state.initialized) {
      state.initialized = true;
      state.previousYaw = yaw;
      state.previousPitch = pitch;
      state.previousRoll = roll;
      state.previousFloatY = floatY;
      return;
    }

    const safeDelta = Math.max(deltaTime, 1 / 240);
    const yawVelocity = THREE.MathUtils.clamp(
      (yaw - state.previousYaw) / safeDelta,
      -5,
      5,
    );
    const pitchVelocity = THREE.MathUtils.clamp(
      (pitch - state.previousPitch) / safeDelta,
      -4,
      4,
    );
    const rollVelocity = THREE.MathUtils.clamp(
      (roll - state.previousRoll) / safeDelta,
      -3,
      3,
    );
    const verticalVelocity = THREE.MathUtils.clamp(
      (floatY - state.previousFloatY) / safeDelta,
      -2,
      2,
    );
    const verticalAcceleration = THREE.MathUtils.clamp(
      (verticalVelocity - state.previousVerticalVelocity) / safeDelta,
      -8,
      8,
    );

    state.previousYaw = yaw;
    state.previousPitch = pitch;
    state.previousRoll = roll;
    state.previousFloatY = floatY;
    state.previousVerticalVelocity = verticalVelocity;

    const hangingAmount = THREE.MathUtils.smoothstep(
      this.paperPathLength,
      this.paperBendStart,
      this.maxPaperPathLength,
    );
    const looseness = THREE.MathUtils.lerp(0.38, 1, hangingAmount);
    const paperStiffness = THREE.MathUtils.lerp(32, 18, hangingAmount);
    const paperDamping = THREE.MathUtils.lerp(9.5, 6.5, hangingAmount);
    const forceScale = motionScale;

    stepSpring(
      state.paperYaw,
      THREE.MathUtils.clamp(-yawVelocity * 0.055 * looseness * forceScale, -0.18, 0.18),
      paperStiffness,
      paperDamping,
      safeDelta,
    );
    stepSpring(
      state.paperPitch,
      THREE.MathUtils.clamp(
        (-pitchVelocity * 0.045 + verticalAcceleration * 0.0025)
          * looseness
          * forceScale,
        -0.12,
        0.12,
      ),
      paperStiffness,
      paperDamping,
      safeDelta,
    );
    stepSpring(
      state.paperRoll,
      THREE.MathUtils.clamp(
        (-roll * 1.5 - rollVelocity * 0.09) * looseness * forceScale,
        -0.13,
        0.13,
      ),
      paperStiffness,
      paperDamping,
      safeDelta,
    );
    this.paperTailSwayX = stepSpring(
      state.tailX,
      THREE.MathUtils.clamp(-yawVelocity * 0.12 * looseness * forceScale, -0.3, 0.3),
      THREE.MathUtils.lerp(15, 8, hangingAmount),
      THREE.MathUtils.lerp(6, 4.5, hangingAmount),
      safeDelta,
    );
    this.paperTailSwayZ = stepSpring(
      state.tailZ,
      THREE.MathUtils.clamp(
        (-pitchVelocity * 0.08 + verticalAcceleration * 0.004)
          * looseness
          * forceScale,
        -0.2,
        0.2,
      ),
      THREE.MathUtils.lerp(15, 8, hangingAmount),
      THREE.MathUtils.lerp(6, 4.5, hangingAmount),
      safeDelta,
    );

    this.earrings?.forEach((earring) => {
      const swingTarget = THREE.MathUtils.clamp(
        (-roll * 1.8 - rollVelocity * 0.14) * forceScale,
        -0.34,
        0.34,
      );
      const depthTarget = THREE.MathUtils.clamp(
        (-yawVelocity * 0.075 - pitchVelocity * 0.035) * forceScale,
        -0.27,
        0.27,
      );
      const swing = stepSpring(
        earring.userData.swing,
        swingTarget,
        30,
        7.2,
        safeDelta,
      );
      const depthSwing = stepSpring(
        earring.userData.depthSwing,
        depthTarget,
        27,
        7,
        safeDelta,
      );
      earring.userData.charmPivot.rotation.z = swing;
      earring.userData.charmPivot.rotation.x = depthSwing;
    });
  }

  update(time, deltaTime) {
    const motionScale = this.reducedMotion ? 0.18 : 1;
    const speakingEnergy = this.mode === "speaking" ? 0.34 : 0;
    const listeningEnergy = this.mode === "listening" ? 0.12 : 0;
    const energy = speakingEnergy + listeningEnergy;

    this.dragRotation.x = THREE.MathUtils.damp(
      this.dragRotation.x,
      this.dragRotationTarget.x,
      11,
      deltaTime,
    );
    this.dragRotation.y = THREE.MathUtils.damp(
      this.dragRotation.y,
      this.dragRotationTarget.y,
      11,
      deltaTime,
    );
    const floatY = Math.sin(time * (0.7 + energy * 0.08)) * (0.052 + energy * 0.01);
    this.floatGroup.position.y = floatY * motionScale;
    this.floatGroup.rotation.z =
      Math.sin(time * 0.52) * 0.014 * motionScale;
    this.floatGroup.rotation.x =
      Math.sin(time * 0.42 + 1.3) * 0.01 * motionScale + this.dragRotation.x;
    this.floatGroup.rotation.y = this.dragRotation.y;
    this.updateSecondaryMotion(deltaTime, motionScale);

    const breath = 1 + Math.sin(time * 1.15) * 0.004 * motionScale;
    this.body.scale.set(breath, breath, breath);

    const isVoicing = this.audioLevel > 0.025;
    const mouthMotion = 1 + this.audioLevel * 1.36;
    this.mouth.scale.y = THREE.MathUtils.damp(
      this.mouth.scale.y,
      mouthMotion,
      isVoicing ? 26 : 16,
      deltaTime,
    );
    this.mouth.scale.x = THREE.MathUtils.damp(
      this.mouth.scale.x,
      1 - this.audioLevel * 0.115,
      22,
      deltaTime,
    );
    this.mouth.position.y = THREE.MathUtils.damp(
      this.mouth.position.y,
      1.08 - this.audioLevel * 0.052,
      22,
      deltaTime,
    );
    this.mouth.rotation.z = THREE.MathUtils.damp(
      this.mouth.rotation.z,
      0,
      12,
      deltaTime,
    );

    if (time >= this.nextBlinkAt && this.blinkStartedAt < 0) {
      this.blinkStartedAt = time;
    }

    let blink = 1;
    if (this.blinkStartedAt >= 0) {
      const blinkTime = (time - this.blinkStartedAt) / 0.22;
      blink = blinkTime < 0.5
        ? THREE.MathUtils.lerp(1, 0.08, blinkTime * 2)
        : THREE.MathUtils.lerp(0.08, 1, (blinkTime - 0.5) * 2);
      if (blinkTime >= 1) {
        this.blinkStartedAt = -1;
        this.nextBlinkAt = time + 2.8 + Math.random() * 4.8;
        blink = 1;
      }
    }

    this.eyes.forEach((eye, index) => {
      eye.scale.y = 1.24 * blink;
      eye.position.x = THREE.MathUtils.damp(
        eye.position.x,
        eye.userData.restX + this.dragRotation.y * 0.075,
        14,
        deltaTime,
      );
      eye.position.y = THREE.MathUtils.damp(
        eye.position.y,
        1.26 - this.dragRotation.x * 0.1
          + Math.sin(time * 0.8 + index * 0.25) * 0.008 * motionScale,
        14,
        deltaTime,
      );
    });

    this.keys.forEach((key, index) => {
      const keyPulse = this.mode === "thinking" && index === 3
        ? Math.sin(time * 3.6) * 0.025
        : 0;
      key.position.z = 0.96 + keyPulse;
    });

    if (this.outputAudioActive) {
      this.paperFeedDistance += deltaTime * (22 + this.audioLevel * 16);
      this.paperPathLength = Math.min(
        this.maxPaperPathLength,
        this.paperPathLength + deltaTime * (0.2 + this.audioLevel * 0.08),
      );
      const printRate = 16 + THREE.MathUtils.clamp(this.pendingReceiptText.length / 120, 0, 1) * 8;
      this.printCharacterBudget = Math.min(
        this.printCharacterBudget + deltaTime * printRate,
        8,
      );
      const printableCharacters = Math.min(
        Math.floor(this.printCharacterBudget),
        this.pendingReceiptText.length,
      );
      if (printableCharacters > 0) {
        this.printReceiptText(this.pendingReceiptText.slice(0, printableCharacters));
        this.pendingReceiptText = this.pendingReceiptText.slice(printableCharacters);
        this.printCharacterBudget -= printableCharacters;
      }
      this.paperDrawAccumulator += deltaTime;
      if (this.paperDrawAccumulator >= 1 / 30) {
        this.paperDrawAccumulator = 0;
        this.drawPaper();
      }
      this.paperProgress = THREE.MathUtils.damp(
        this.paperProgress,
        this.paperTarget,
        2.5,
        deltaTime,
      );
    }
    this.paper.scale.y = 1;
    this.updatePaperGeometry(this.paperPathLength);
    const feedLift = this.outputAudioActive ? (this.paperFeedDistance % 18) / 18 * 0.022 : 0;
    this.paper.position.y = THREE.MathUtils.damp(
      this.paper.position.y,
      2.47 + feedLift,
      14,
      deltaTime,
    );
    this.paperRollers.forEach((roller) => {
      roller.rotation.z = this.paperFeedDistance * 0.085 * roller.userData.direction;
    });

    const paperFlutter = this.outputAudioActive
      ? Math.sin(time * 4.4) * (0.004 + this.audioLevel * 0.009) * motionScale
      : 0;
    this.paper.rotation.x = this.secondaryMotion.paperPitch.value;
    this.paper.rotation.y = this.secondaryMotion.paperYaw.value;
    this.paper.rotation.z = this.secondaryMotion.paperRoll.value + paperFlutter;
  }
}
