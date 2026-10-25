import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const ARENA_RADIUS = 40;
const BLADE_GEOM_LENGTH = 2.75;
const MAX_BLADES = 12;
const MAX_MOBS = 80;
const TIER_COLORS = ['#46ff9b', '#3ee8ff', '#7c8cff', '#c56dff', '#ff9f43', '#ff4d6d'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function shortestAngle(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createSoftCircleTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function createShadowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function createMoonTexture() {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.44, h * 0.4, 8, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#fff8e8');
    g.addColorStop(0.55, '#d8efe8');
    g.addColorStop(0.78, '#91bdb9');
    g.addColorStop(1, 'rgba(64, 129, 127, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(88, 120, 116, 0.16)';
    for (let i = 0; i < 9; i++) {
      const x = w * (0.28 + Math.random() * 0.45);
      const y = h * (0.28 + Math.random() * 0.42);
      const r = 8 + Math.random() * 22;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  });
  return texture;
}

function createNameTexture(name, color) {
  return canvasTexture(512, 144, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 44px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0, 8, 10, 0.86)';
    ctx.strokeText(name, w / 2, h / 2 - 8);
    ctx.fillStyle = '#e8fff9';
    ctx.fillText(name, w / 2, h / 2 - 8);
    const textWidth = Math.min(w - 80, ctx.measureText(name).width + 44);
    ctx.fillStyle = color;
    ctx.fillRect(w / 2 - textWidth / 2, h - 25, textWidth, 3);
  });
}

function createTextSprite(text, color, options = {}) {
  const size = options.size ?? 128;
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.34, 0, TAU);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${options.weight ?? 700} ${options.fontSize ?? Math.round(size * 0.5)}px "STKaiti", "KaiTi", "Microsoft YaHei", serif`;
    ctx.strokeStyle = 'rgba(0, 7, 9, 0.82)';
    ctx.lineWidth = size * 0.07;
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  });
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = options.scale ?? 0.72;
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function createGroundTexture(renderer) {
  const rand = mulberry32(20261024);
  const texture = canvasTexture(1024, 1024, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const base = ctx.createRadialGradient(cx, cy, 20, cx, cy, w / 2);
    base.addColorStop(0, '#34463e');
    base.addColorStop(0.42, '#293b34');
    base.addColorStop(0.78, '#1d2d29');
    base.addColorStop(1, '#111c1c');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Broad stone plates.
    for (let ring = 0; ring < 8; ring++) {
      const r0 = 58 + ring * 55;
      const segments = 12 + ring * 3;
      for (let s = 0; s < segments; s++) {
        const a0 = (s / segments) * TAU + rand() * 0.02;
        const a1 = ((s + 1) / segments) * TAU - rand() * 0.015;
        ctx.beginPath();
        ctx.arc(cx, cy, r0 + 52, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = `rgba(${30 + Math.floor(rand() * 18)}, ${50 + Math.floor(rand() * 16)}, ${43 + Math.floor(rand() * 14)}, ${0.10 + rand() * 0.14})`;
        ctx.fill();
        if (rand() > 0.63) {
          ctx.strokeStyle = 'rgba(8, 15, 14, 0.28)';
          ctx.lineWidth = 1 + rand() * 1.5;
          ctx.stroke();
        }
      }
    }

    // Concentric cut lines.
    for (let radius = 74; radius < 510; radius += 55) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.strokeStyle = radius === 74 ? 'rgba(111, 210, 190, 0.18)' : 'rgba(9, 18, 16, 0.22)';
      ctx.lineWidth = radius === 74 ? 2 : 1.2;
      ctx.stroke();
    }

    // Radial seams.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72);
      ctx.lineTo(cx + Math.cos(a) * 508, cy + Math.sin(a) * 508);
      ctx.strokeStyle = 'rgba(8, 17, 15, 0.18)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Central blade seal: four curved cuts around a small orbit.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(120, 234, 212, 0.28)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((i / 4) * TAU);
      ctx.beginPath();
      ctx.arc(64, 0, 94, -0.9, 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 0, 66, 0.2, 1.25);
      ctx.strokeStyle = 'rgba(255, 92, 122, 0.18)';
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.strokeStyle = 'rgba(207, 255, 245, 0.35)';
    ctx.stroke();
    ctx.restore();

    // Moss and grit.
    for (let i = 0; i < 170; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 2 + rand() * 16;
      ctx.fillStyle = `rgba(${36 + rand() * 24}, ${78 + rand() * 35}, ${51 + rand() * 24}, ${0.03 + rand() * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 2800; i++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(205,255,240,0.04)' : 'rgba(0,6,7,0.16)';
      ctx.fillRect(x, y, 1 + rand(), 1 + rand());
    }

    // Cracks.
    for (let i = 0; i < 12; i++) {
      let x = rand() * w;
      let y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += (rand() - 0.5) * 55;
        y += (rand() - 0.5) * 55;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(3, 9, 9, 0.26)';
      ctx.lineWidth = 1 + rand();
      ctx.stroke();
    }
  });
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createMobFaceTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    glow.addColorStop(0, 'rgba(170, 100, 255, 0.5)');
    glow.addColorStop(0.5, 'rgba(115, 55, 210, 0.16)');
    glow.addColorStop(1, 'rgba(80, 20, 160, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = 'rgba(38, 20, 60, 0.95)';
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(48, 22);
    ctx.lineTo(0, 52);
    ctx.lineTo(-48, 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d9d2f2';
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.lineTo(33, 10);
    ctx.lineTo(0, 38);
    ctx.lineTo(-33, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff3658';
    ctx.beginPath();
    ctx.ellipse(-12, -3, 6, 9, -0.35, 0, TAU);
    ctx.ellipse(12, -3, 6, 9, 0.35, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(48, 16, 40, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 18);
    ctx.quadraticCurveTo(0, 24, 10, 18);
    ctx.stroke();
    ctx.restore();
  });
}

function createBladeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.18, 1.45);
  shape.bezierCurveTo(1.0, 0.82, 0.9, -0.42, 0.05, -1.18);
  shape.quadraticCurveTo(-0.12, -1.3, -0.28, -1.12);
  shape.bezierCurveTo(0.18, -0.22, 0.48, 0.52, 0.18, 1.45);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.09,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.022,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function createBladeMaterial(tier) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOuter: { value: new THREE.Color(TIER_COLORS[tier - 1] ?? TIER_COLORS[0]) },
      uInner: { value: new THREE.Color('#ff1b3d') },
    },
    vertexShader: `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 localPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * localPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vLocal;
      uniform vec3 uOuter;
      uniform vec3 uInner;
      void main() {
        float outerMix = smoothstep(-0.55, 0.2, -vLocal.x);
        vec3 col = mix(uInner, uOuter, outerMix);
        float outerRim = smoothstep(0.26, 0.55, -vLocal.x);
        float innerRim = smoothstep(0.3, 0.55, vLocal.x);
        col = mix(col, uOuter, outerRim * 0.55);
        col = mix(col, uInner * 1.4, innerRim * 0.55);
        float tip = smoothstep(0.92, 1.36, -vLocal.z);
        col += uOuter * tip * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function buildFighter(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.16),
    emissiveIntensity: 0.8,
    roughness: 0.62,
    metalness: 0.14,
    flatShading: true,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x141e22,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xd7eee8,
    roughness: 0.38,
    metalness: 0.45,
    flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe5c39d,
    roughness: 0.78,
    metalness: 0,
    flatShading: true,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x11191d,
    roughness: 0.76,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(1.4),
    emissive: new THREE.Color(color).multiplyScalar(0.38),
    emissiveIntensity: 1,
    roughness: 0.45,
    flatShading: true,
  });

  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.62, 6), darkMat);
    leg.position.set(side * 0.16, 0.34, 0);
    legs.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.32), darkMat);
    boot.position.set(side * 0.16, 0.08, 0.07);
    legs.add(boot);
  }
  group.add(legs);

  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.58, 1.08, 9, 1), bodyMat);
  robe.position.y = 0.92;
  group.add(robe);

  const skirtEdge = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.035, 5, 18), trimMat);
  skirtEdge.rotation.x = Math.PI / 2;
  skirtEdge.position.y = 0.4;
  group.add(skirtEdge);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 5, 16), darkMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.08;
  group.add(belt);

  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.55, 9), bodyMat);
  chest.position.y = 1.34;
  group.add(chest);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 5, 12), trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.58;
  group.add(collar);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), skinMat);
  head.position.y = 1.82;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.345, 10, 8, 0, TAU, 0, Math.PI * 0.62), hairMat);
  hair.position.set(0, 1.88, -0.03);
  hair.scale.set(1.02, 1, 1.04);
  group.add(hair);

  const topknot = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), hairMat);
  topknot.position.set(0, 2.14, -0.09);
  group.add(topknot);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 4, 10), accentMat);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 2.08, -0.09);
  group.add(band);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), darkMat);
    eye.position.set(side * 0.115, 1.83, 0.3);
    group.add(eye);
  }

  const arms = new THREE.Group();
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.58, 6), bodyMat);
    arm.position.set(side * 0.45, 1.29, 0.03);
    arm.rotation.z = side * 0.48;
    arms.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 7, 6), skinMat);
    hand.position.set(side * 0.62, 1.04, 0.06);
    arms.add(hand);
  }
  group.add(arms);

  const scarf = new THREE.Group();
  const scarfMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.15),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.86,
  });
  const ribbonGeometries = [];
  for (let i = 0; i < 3; i++) {
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.22 - i * 0.035, 0.46), scarfMat);
    ribbon.position.set(0.1 + i * 0.04, 1.51 - i * 0.035, -0.3 - i * 0.32);
    ribbon.rotation.x = -0.32;
    ribbon.rotation.y = 0.2 - i * 0.1;
    ribbon.updateMatrix();
    const geometry = ribbon.geometry.clone().applyMatrix4(ribbon.matrix);
    geometry.deleteAttribute('uv');
    ribbon.geometry.dispose();
    ribbonGeometries.push(geometry);
  }
  const scarfGeometry = mergeGeometries(ribbonGeometries, false);
  for (const geometry of ribbonGeometries) geometry.dispose();
  scarf.add(new THREE.Mesh(scarfGeometry, scarfMat));
  group.add(scarf);

  const accentLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), accentMat);
  accentLine.position.set(0, 1.03, 0.545);
  group.add(accentLine);

  group.userData.arms = arms;
  group.userData.scarf = scarf;
  group.userData.head = head;
  return group;
}

function bakeFighter(fighter) {
  fighter.updateMatrixWorld(true);
  const scarf = fighter.userData.scarf;
  if (scarf) fighter.remove(scarf);
  const geometries = [];
  fighter.traverse((object) => {
    if (!object.isMesh) return;
    let geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.deleteAttribute('uv');
    geometry.deleteAttribute('uv1');
    const color = object.material?.color ?? new THREE.Color(0xffffff);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.12,
    emissive: 0x0d1816,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = false;
  fighter.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    object.material?.dispose?.();
  });
  const root = new THREE.Group();
  root.add(mesh);
  if (scarf) root.add(scarf);
  return { root, scarf };
}

export class StormGame {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05090d);
    this.scene.fog = new THREE.FogExp2(0x071015, 0.009);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 380);
    this.camera.position.set(0, 30, 36);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x05090d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.68, 0.64, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.pixelRatio = 1;
    this.views = new Map();
    this.pickupViews = new Map();
    this.mobData = new Map();
    this.effects = [];
    this.damageNumbers = [];
    this.state = null;
    this.match = null;
    this.localId = null;
    this.localSnapshot = null;
    this.localPred = null;
    this.input = { x: 0, z: 0 };
    this.pendingDash = false;
    this.localDashLock = 0;
    this.cameraLook = new THREE.Vector3(0, 1, 0);
    this.cameraShake = 0;
    this.needsCameraSnap = true;
    this.elapsed = 0;
    this.fpsAvg = 60;
    this.lowQuality = false;
    this.qualityTimer = 0;
    this.qualityLock = new URLSearchParams(location.search).get('quality');
    this.zoneTarget = { x: 0, z: 0, radius: ARENA_RADIUS };
    this.zoneVisual = { x: 0, z: 0, radius: ARENA_RADIUS };
    this.onLocalHit = null;
    this.onLocalKill = null;
    this.onLocalDeath = null;
    this.onLocalDash = null;

    const bladeGeometry = createBladeGeometry();
    this.shared = {
      bladeGeometry,
      shadowTexture: createShadowTexture(),
      glowTexture: createSoftCircleTexture(),
      solid: (() => {
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 2, 2);
        return new THREE.CanvasTexture(c);
      })(),
    };

    const mobFaceTexture = createMobFaceTexture();
    this.shared.mobBodyGeometry = new THREE.ConeGeometry(0.36, 0.95, 7);
    this.shared.mobBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a2d73,
      emissive: 0x8b4cff,
      emissiveIntensity: 1.15,
      roughness: 0.62,
      metalness: 0.18,
      flatShading: true,
    });
    this.shared.mobFaceTexture = mobFaceTexture;
    this.shared.mobBladeMaterial = createBladeMaterial(4);

    this.buildMobRenderer();
    this.buildLights();
    this.buildSky();
    this.buildArena();
    this.buildDecor();
    this.buildZone();
    this.buildPreview();
    this.resize();
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.qualityLock === 'low') this.setLowQuality(true);
    window.addEventListener('resize', () => this.resize());
  }

  buildMobRenderer() {
    this.mobBodyMesh = new THREE.InstancedMesh(
      this.shared.mobBodyGeometry,
      this.shared.mobBodyMaterial,
      MAX_MOBS,
    );
    this.mobBodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mobBodyMesh.frustumCulled = false;
    this.mobBodyMesh.count = 0;
    this.scene.add(this.mobBodyMesh);

    this.mobBladeMesh = new THREE.InstancedMesh(
      this.shared.bladeGeometry,
      this.shared.mobBladeMaterial,
      MAX_MOBS,
    );
    this.mobBladeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mobBladeMesh.frustumCulled = false;
    this.mobBladeMesh.count = 0;
    this.scene.add(this.mobBladeMesh);

    this.mobFacePositions = new Float32Array(MAX_MOBS * 3);
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.mobFacePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    faceGeometry.setDrawRange(0, 0);
    this.mobFacePoints = new THREE.Points(
      faceGeometry,
      new THREE.PointsMaterial({
        map: this.shared.mobFaceTexture,
        size: 1.05,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.mobFacePoints.frustumCulled = false;
    this.scene.add(this.mobFacePoints);
    this.mobDummy = new THREE.Object3D();
  }

  buildLights() {
    const ambient = new THREE.AmbientLight(0x2f5751, 0.55);
    this.scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x8dbcec, 0x0b1d18, 1.5);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0xbfe1ff, 2.5);
    moon.position.set(18, 34, 12);
    moon.castShadow = true;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    moon.shadow.mapSize.set(coarse ? 512 : 1024, coarse ? 512 : 1024);
    moon.shadow.camera.left = -48;
    moon.shadow.camera.right = 48;
    moon.shadow.camera.top = 48;
    moon.shadow.camera.bottom = -48;
    moon.shadow.camera.near = 2;
    moon.shadow.camera.far = 130;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.025;
    this.scene.add(moon);

    const fill = new THREE.DirectionalLight(0x5b8cff, 0.62);
    fill.position.set(-16, 10, -14);
    this.scene.add(fill);

    const centreGlow = new THREE.PointLight(0x6ecbb6, 170, 72, 2);
    centreGlow.position.set(0, 11, 0);
    this.scene.add(centreGlow);

    const warm = new THREE.PointLight(0xffb46b, 22, 18, 2);
    warm.position.set(-26, 3.2, -19);
    this.scene.add(warm);
    const warm2 = new THREE.PointLight(0xff9f55, 18, 16, 2);
    warm2.position.set(26, 3.2, -16);
    this.scene.add(warm2);
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(250, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vPos;
          void main() {
            vec3 d = normalize(vPos);
            float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 low = vec3(0.018, 0.032, 0.045);
            vec3 high = vec3(0.006, 0.012, 0.024);
            vec3 col = mix(low, high, smoothstep(0.3, 0.95, h));
            col += vec3(0.03, 0.09, 0.10) * pow(max(0.0, 0.18 - abs(d.y - 0.03)), 4.0) * 0.5;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    const starGeo = new THREE.BufferGeometry();
    const positions = [];
    const rand = mulberry32(77);
    for (let i = 0; i < 700; i++) {
      const a = rand() * TAU;
      const elevation = 0.12 + rand() * 0.82;
      const radius = 200 + rand() * 24;
      const horizontal = Math.cos(elevation * Math.PI * 0.5);
      positions.push(
        Math.cos(a) * horizontal * radius,
        Math.sin(elevation * Math.PI * 0.5) * radius + 4,
        Math.sin(a) * horizontal * radius,
      );
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xb8d9e8,
        size: 0.2,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        fog: false,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(stars);

    const moonTexture = createMoonTexture();
    const moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: moonTexture,
        color: 0xe8fff8,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    moonSprite.position.set(-27, 28, -66);
    moonSprite.scale.set(25, 25, 1);
    this.scene.add(moonSprite);
    const moonGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color: 0x7fcfc4,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    moonGlow.position.copy(moonSprite.position);
    moonGlow.scale.set(58, 58, 1);
    this.scene.add(moonGlow);

    // Distant mountains.
    const rand2 = mulberry32(411);
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x0b1718,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const mountainGeometry = new THREE.ConeGeometry(1, 1, 5, 1);
    const mountainMesh = new THREE.InstancedMesh(mountainGeometry, mountainMat, 48);
    const mountainDummy = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + rand2() * 0.08;
      const r = 105 + rand2() * 48;
      const height = 12 + rand2() * 30;
      const width = 10 + rand2() * 18;
      mountainDummy.position.set(Math.cos(a) * r, height / 2 - 7, Math.sin(a) * r);
      mountainDummy.rotation.set(0, rand2() * TAU, 0);
      mountainDummy.scale.set(width, height, width * (0.8 + rand2() * 0.6));
      mountainDummy.updateMatrix();
      mountainMesh.setMatrixAt(i, mountainDummy.matrix);
    }
    mountainMesh.instanceMatrix.needsUpdate = true;
    mountainMesh.frustumCulled = false;
    this.scene.add(mountainMesh);

    // Low ground beyond the platform.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(200, 96),
      new THREE.MeshStandardMaterial({ color: 0x061012, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -6.8;
    this.scene.add(ground);
  }

  buildArena() {
    const texture = createGroundTexture(this.renderer);
    const topMat = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xf1fff7,
      emissive: 0x1b3b34,
      emissiveMap: texture,
      emissiveIntensity: 0.4,
      roughness: 0.88,
      metalness: 0.02,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(ARENA_RADIUS + 0.04, 96), topMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);

    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x101d1c,
      roughness: 0.96,
      metalness: 0.03,
      flatShading: true,
    });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(40.18, 37.2, 5.2, 140, 1, true), sideMat);
    side.position.y = -2.6;
    side.receiveShadow = true;
    this.scene.add(side);

    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(38.6, 15, 11, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x07100f,
        roughness: 1,
        metalness: 0,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    );
    under.position.y = -10.4;
    under.rotation.y = 0.2;
    this.scene.add(under);

    // A lower shrine terrace holds the torii, lanterns and broken stones.
    const terraceMat = new THREE.MeshStandardMaterial({
      color: 0x12201e,
      roughness: 0.94,
      metalness: 0.03,
      flatShading: true,
    });
    const terrace = new THREE.Mesh(new THREE.CircleGeometry(48.5, 140), terraceMat);
    terrace.rotation.x = -Math.PI / 2;
    terrace.position.y = -1.14;
    terrace.receiveShadow = true;
    this.scene.add(terrace);
    const terraceSide = new THREE.Mesh(
      new THREE.CylinderGeometry(48.55, 43.5, 3.6, 140, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0b1716,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    terraceSide.position.y = -2.95;
    this.scene.add(terraceSide);
    const terraceRim = new THREE.Mesh(
      new THREE.TorusGeometry(48.35, 0.2, 5, 170),
      new THREE.MeshStandardMaterial({
        color: 0x344a45,
        metalness: 0.4,
        roughness: 0.55,
        flatShading: true,
      }),
    );
    terraceRim.rotation.x = Math.PI / 2;
    terraceRim.position.y = -1.12;
    this.scene.add(terraceRim);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(40.05, 0.28, 7, 180),
      new THREE.MeshStandardMaterial({
        color: 0x3b554f,
        metalness: 0.55,
        roughness: 0.42,
        flatShading: true,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    rim.receiveShadow = true;
    this.scene.add(rim);

    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(39.6, 39.7, 220),
      new THREE.MeshBasicMaterial({
        color: 0x53e6cd,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = 0.045;
    this.scene.add(glowRing);

    // Broken rock crown around the platform.
    const rand = mulberry32(9001);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x172823,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: true,
    });
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMat, 62);
    const rockDummy = new THREE.Object3D();
    for (let i = 0; i < 62; i++) {
      const a = (i / 62) * TAU + rand() * 0.1;
      const radius = 41.2 + rand() * 2.8;
      const size = 0.7 + rand() * 2.2;
      rockDummy.position.set(
        Math.cos(a) * radius,
        -0.1 + size * 0.32,
        Math.sin(a) * radius,
      );
      rockDummy.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
      rockDummy.scale.set(size, size * (0.55 + rand() * 0.7), size);
      rockDummy.updateMatrix();
      rockMesh.setMatrixAt(i, rockDummy.matrix);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockMesh.frustumCulled = false;
    this.scene.add(rockMesh);
  }

  buildDecor() {
    const lanternPositions = [0.65, 2.35, 3.8, 5.5];
    for (const a of lanternPositions) {
      this.createLantern(Math.cos(a) * 44.5, Math.sin(a) * 44.5, a);
    }
    this.createTorii(0, -49.2);
    this.createBladeMonument(20, -45.5);

    // Bamboo and pine silhouettes.
    const rand = mulberry32(221);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x11231f,
      roughness: 0.92,
      flatShading: true,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x12342b,
      roughness: 0.9,
      flatShading: true,
    });
    const trunkDummy = new THREE.Object3D();
    const leafDummy = new THREE.Object3D();
    const trunkMatrices = [];
    const leafMatrices = [];
    for (let i = 0; i < 48; i++) {
      const a = rand() * TAU;
      const r = 56 + rand() * 30;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (rand() > 0.48) {
        const h = 6 + rand() * 9;
        trunkDummy.position.set(x, h / 2 - 5, z);
        trunkDummy.rotation.set(0, 0, 0);
        trunkDummy.scale.set(0.13, h, 0.13);
        trunkDummy.updateMatrix();
        trunkMatrices.push(trunkDummy.matrix.clone());
        for (let layer = 0; layer < 3; layer++) {
          const width = 1.9 - layer * 0.38;
          leafDummy.position.set(x, h - 4.6 + layer * 1.35, z);
          leafDummy.rotation.set(0, rand() * TAU, 0);
          leafDummy.scale.set(width, 3.2 - layer * 0.4, width);
          leafDummy.updateMatrix();
          leafMatrices.push(leafDummy.matrix.clone());
        }
      } else {
        const h = 8 + rand() * 10;
        trunkDummy.position.set(x, h / 2 - 4.6, z);
        trunkDummy.rotation.set(0, 0, 0);
        trunkDummy.scale.set(0.11, h, 0.11);
        trunkDummy.updateMatrix();
        trunkMatrices.push(trunkDummy.matrix.clone());
        for (let layer = 0; layer < 4; layer++) {
          leafDummy.position.set(
            x + (rand() - 0.5) * 0.8,
            h - 3.5 + layer * 1.3,
            z + (rand() - 0.5) * 0.8,
          );
          leafDummy.rotation.set(0, rand() * TAU, (rand() - 0.5) * 0.35);
          leafDummy.scale.set(1.3, 2.8, 1.3);
          leafDummy.updateMatrix();
          leafMatrices.push(leafDummy.matrix.clone());
        }
      }
    }

    const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, 5);
    const foliageGeometry = new THREE.ConeGeometry(1, 1, 5);
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeometry,
      trunkMat,
      trunkMatrices.length,
    );
    trunkMatrices.forEach((matrix, index) => trunkMesh.setMatrixAt(index, matrix));
    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.frustumCulled = false;
    this.scene.add(trunkMesh);

    const foliageMesh = new THREE.InstancedMesh(
      foliageGeometry,
      leafMat,
      leafMatrices.length,
    );
    leafMatrices.forEach((matrix, index) => foliageMesh.setMatrixAt(index, matrix));
    foliageMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.frustumCulled = false;
    this.scene.add(foliageMesh);

    // Floating embers and petals.
    const rand2 = mulberry32(727);
    const emberCount = 260;
    const positions = new Float32Array(emberCount * 3);
    this.emberBase = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const a = rand2() * TAU;
      const r = 5 + rand2() * 54;
      const y = 0.4 + rand2() * 10;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * r;
      this.emberBase[i * 3] = positions[i * 3];
      this.emberBase[i * 3 + 1] = y;
      this.emberBase[i * 3 + 2] = positions[i * 3 + 2];
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const embers = new THREE.Points(
      emberGeo,
      new THREE.PointsMaterial({
        map: this.shared.glowTexture,
        color: 0xffc58a,
        size: 0.18,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(embers);
    this.embers = embers;

    const petalCount = 160;
    const petalPositions = new Float32Array(petalCount * 3);
    this.petalData = [];
    for (let i = 0; i < petalCount; i++) {
      const a = rand2() * TAU;
      const r = 8 + rand2() * 60;
      const y = 1 + rand2() * 13;
      petalPositions[i * 3] = Math.cos(a) * r;
      petalPositions[i * 3 + 1] = y;
      petalPositions[i * 3 + 2] = Math.sin(a) * r;
      this.petalData.push({ speed: 0.25 + rand2() * 0.45, phase: rand2() * TAU, radius: r, angle: a });
    }
    const petalGeo = new THREE.BufferGeometry();
    petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPositions, 3));
    const petals = new THREE.Points(
      petalGeo,
      new THREE.PointsMaterial({
        map: this.shared.glowTexture,
        color: 0xff9ab3,
        size: 0.14,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(petals);
    this.petals = petals;

    // Low mist at the platform lip.
    const mistMat = new THREE.SpriteMaterial({
      map: this.shared.glowTexture,
      color: 0x416a70,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 12; i++) {
      const mist = new THREE.Sprite(mistMat.clone());
      const a = (i / 12) * TAU + 0.2;
      mist.position.set(Math.cos(a) * 47.5, 0.6 + Math.random() * 1.4, Math.sin(a) * 47.5);
      mist.scale.set(22 + Math.random() * 14, 7, 1);
      mist.material.rotation = Math.random() * TAU;
      this.scene.add(mist);
    }
  }

  createLantern(x, z, angle) {
    const group = new THREE.Group();
    group.position.set(x, -1.14, z);
    group.rotation.y = -angle + Math.PI / 2;
    const stone = new THREE.MeshStandardMaterial({
      color: 0x283b36,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 6), stone);
    base.position.y = 0.15;
    base.castShadow = true;
    group.add(base);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.65, 6), stone);
    pillar.position.y = 1.05;
    pillar.castShadow = true;
    group.add(pillar);
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.68, 0.66),
      new THREE.MeshStandardMaterial({
        color: 0xffb76a,
        emissive: 0xff8a3d,
        emissiveIntensity: 2.6,
        roughness: 0.5,
      }),
    );
    housing.position.y = 2.02;
    group.add(housing);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.38, 4), stone);
    roof.position.y = 2.55;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color: 0xffa85c,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.y = 2.02;
    glow.scale.set(1.85, 1.85, 1);
    glow.material.opacity = 0.34;
    group.add(glow);
    this.scene.add(group);
  }

  createTorii(x, z) {
    const group = new THREE.Group();
    group.position.set(x, -1.14, z);
    const red = new THREE.MeshStandardMaterial({
      color: 0x6f1f2a,
      roughness: 0.62,
      metalness: 0.14,
      flatShading: true,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1a171a,
      roughness: 0.72,
      metalness: 0.18,
      flatShading: true,
    });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 6.1, 8), red);
      pillar.position.set(side * 3.1, 3.05, 0);
      pillar.castShadow = true;
      group.add(pillar);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.55, 8), dark);
      foot.position.set(side * 3.1, 0.22, 0);
      foot.castShadow = true;
      group.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.4, 0.52), red);
    beam.position.y = 5.45;
    beam.castShadow = true;
    group.add(beam);
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.28, 0.72), dark);
    topBeam.position.y = 5.92;
    topBeam.castShadow = true;
    group.add(topBeam);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 0.3), red);
    tie.position.y = 4.55;
    group.add(tie);
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.8, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x181b1c,
        emissive: 0x5eead4,
        emissiveIntensity: 0.16,
        metalness: 0.5,
        roughness: 0.5,
      }),
    );
    plaque.position.y = 4.95;
    group.add(plaque);
    const plaqueGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createTextSprite('夜刃', '#9ef7e8', { size: 128, fontSize: 74, scale: 1.4 }).material.map,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        color: 0xffffff,
      }),
    );
    plaqueGlow.position.set(0, 4.95, 0.1);
    plaqueGlow.scale.set(1.15, 0.55, 1);
    group.add(plaqueGlow);
    this.scene.add(group);
  }

  createBladeMonument(x, z) {
    const group = new THREE.Group();
    group.position.set(x, -1.14, z);
    group.rotation.y = -0.5;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x1b2a26, roughness: 0.94, flatShading: true }),
    );
    rock.scale.set(1.2, 0.7, 1);
    rock.position.y = 0.2;
    rock.castShadow = true;
    group.add(rock);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9fb4b1,
      emissive: 0x43c9b8,
      emissiveIntensity: 0.75,
      metalness: 0.88,
      roughness: 0.24,
      flatShading: true,
    });
    const blade = new THREE.Mesh(this.shared.bladeGeometry, mat);
    blade.scale.set(2.8, 2.8, 2.8);
    blade.position.set(0, 3.1, 0);
    blade.rotation.set(0.12, -0.3, 0.22);
    blade.castShadow = true;
    group.add(blade);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color: 0x5eead4,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(0, 3.1, 0);
    glow.scale.set(4.5, 4.5, 1);
    group.add(glow);
    this.scene.add(group);
  }

  buildZone() {
    const zoneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xff4268) },
        uTime: { value: 0 },
        uOpacity: { value: 0.55 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float fade = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
          float scan = pow(0.5 + 0.5 * sin(vUv.y * 44.0 - uTime * 3.2), 10.0);
          float ribbons = pow(0.5 + 0.5 * sin(vUv.x * 34.0 + uTime * 0.7 + vUv.y * 6.0), 18.0);
          float alpha = (0.035 + scan * 0.18 + ribbons * 0.08) * fade * uOpacity;
          gl_FragColor = vec4(uColor * (1.05 + scan * 1.1), alpha);
        }
      `,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6.5, 128, 1, true), zoneMat);
    wall.position.y = 3.2;
    wall.renderOrder = 4;
    this.scene.add(wall);
    this.zoneWall = wall;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.995, 1.025, 160),
      new THREE.MeshBasicMaterial({
        color: 0xff4268,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.renderOrder = 5;
    this.scene.add(ring);
    this.zoneRing = ring;

    const overlayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSafe: { value: ARENA_RADIUS },
        uZone: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uSafe;
        uniform vec2 uZone;
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          float d = length(vWorld.xz - uZone);
          float edge = smoothstep(uSafe - 0.5, uSafe + 0.6, d);
          float deep = smoothstep(uSafe - 0.2, uSafe + 2.2, d);
          float pulse = 0.82 + 0.18 * sin(uTime * 2.1 + d * 0.7);
          vec3 col = mix(vec3(0.20, 0.015, 0.07), vec3(0.38, 0.03, 0.15), deep);
          gl_FragColor = vec4(col, (edge * 0.2 + deep * 0.25) * pulse);
        }
      `,
    });
    const overlay = new THREE.Mesh(new THREE.CircleGeometry(40.4, 180), overlayMat);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = 0.055;
    overlay.renderOrder = 2;
    this.scene.add(overlay);
    this.zoneOverlay = overlay;
    this.zoneMat = zoneMat;
    this.overlayMat = overlayMat;
  }

  buildPreview() {
    const group = new THREE.Group();
    group.position.y = 0;
    const material = createBladeMaterial(1);
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(this.shared.bladeGeometry, material);
      const angle = (i / 6) * TAU;
      blade.position.set(Math.cos(angle) * 7.2, 1.4, Math.sin(angle) * 7.2);
      blade.rotation.y = Math.PI - angle;
      blade.scale.set(1.45, 1.45, 1.45);
      group.add(blade);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.9, 7.12, 130),
      new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color: 0x5eead4,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    core.position.set(0, 1.5, 0);
    core.scale.set(7, 7, 1);
    group.add(core);
    this.scene.add(group);
    this.preview = group;
  }

  setLocalId(id) {
    this.localId = id;
    this.needsCameraSnap = true;
    this.preview.visible = false;
  }

  setState(snapshot) {
    this.state = snapshot;
    this.match = snapshot.match;
    this.zoneTarget.radius = snapshot.match.safeRadius;
    this.zoneTarget.x = snapshot.match.zoneX;
    this.zoneTarget.z = snapshot.match.zoneZ;
    this.syncPlayerViews(snapshot.players);
    this.syncPickupViews(snapshot.pickups);
    this.syncMobViews(snapshot.mobs ?? []);
    const me = snapshot.players.find((p) => p.id === this.localId);
    if (me) {
      const wasDead = this.localSnapshot ? this.localSnapshot.hp <= 0 : true;
      const wasRespawning = this.localSnapshot ? this.localSnapshot.respawn > 0 : false;
      if (!this.localPred) {
        this.localPred = {
          x: me.x,
          z: me.z,
          facing: me.facing,
          angle: me.bladeAngle,
          dashTime: 0,
        };
      } else if (
        (wasDead && me.hp > 0) ||
        (wasRespawning && me.respawn <= 0) ||
        this.match.phase !== 'playing' ||
        Math.hypot(me.x - this.localPred.x, me.z - this.localPred.z) > 2.4
      ) {
        this.localPred.x = me.x;
        this.localPred.z = me.z;
        this.localPred.facing = me.facing;
        this.localPred.angle = me.bladeAngle;
        this.localPred.dashTime = 0;
      } else {
        const d = shortestAngle(this.localPred.angle, me.bladeAngle);
        this.localPred.angle += d * 0.2;
        if (!this.input.x && !this.input.z) {
          this.localPred.x = lerp(this.localPred.x, me.x, 0.35);
          this.localPred.z = lerp(this.localPred.z, me.z, 0.35);
        }
      }
      const view = this.views.get(me.id);
      if (view) view.angle = this.localPred.angle;
      this.localSnapshot = me;
    }
  }

  syncPlayerViews(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let view = this.views.get(p.id);
      if (!view) view = this.createPlayerView(p);
      const wasDead = view.dead;
      view.target = p;
      view.dead = p.hp <= 0;
      if (wasDead && !view.dead) {
        view.x = p.x;
        view.z = p.z;
        view.facing = p.facing;
      }
      if (!view.initialized) {
        view.x = p.x;
        view.z = p.z;
        view.facing = p.facing;
        view.angle = p.bladeAngle;
        view.initialized = true;
      }
      view.angle += shortestAngle(view.angle, p.bladeAngle) * 0.35;
      view.group.visible = !view.dead;
      view.nameSprite.material.opacity = p.isBot ? 0.62 : 0.92;
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(view.group);
        view.group.traverse((obj) => {
          if (obj.material && obj.material.map && obj.material.map !== this.shared.glowTexture && obj.material.map !== this.shared.solid) {
            // Textures are small and per-player; release when a player leaves.
            obj.material.map.dispose();
          }
          if (obj.material && !obj.material.userData?.shared) obj.material.dispose?.();
          if (obj.geometry && !obj.isSprite && obj.geometry !== this.shared.bladeGeometry) {
            obj.geometry.dispose();
          }
        });
        this.views.delete(id);
      }
    }
  }

  createPlayerView(p) {
    const group = new THREE.Group();
    const color = new THREE.Color(p.color);
    const bodyRoot = new THREE.Group();
    const fighter = buildFighter(p.color);
    const bakedFighter = bakeFighter(fighter);
    bodyRoot.add(bakedFighter.root);
    group.add(bodyRoot);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 2.3),
      new THREE.MeshBasicMaterial({
        map: this.shared.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.66,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.7, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const orbitRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.01, 96),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    orbitRing.rotation.x = -Math.PI / 2;
    orbitRing.position.y = 0.52;
    group.add(orbitRing);

    const tierColor = TIER_COLORS[p.bladeLevel - 1] ?? TIER_COLORS[0];
    const bladeMat = createBladeMaterial(p.bladeLevel);
    const bladeMesh = new THREE.InstancedMesh(
      this.shared.bladeGeometry,
      bladeMat,
      MAX_BLADES,
    );
    bladeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bladeMesh.frustumCulled = false;
    bladeMesh.count = 0;
    group.add(bladeMesh);
    const bladeDummy = new THREE.Object3D();
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color: tierColor,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    aura.position.y = 0.72;
    aura.scale.set(3.2, 3.2, 1);
    group.add(aura);

    const shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.92, 1),
      new THREE.MeshBasicMaterial({
        color: 0x64d2ff,
        wireframe: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    shield.position.y = 1.15;
    shield.visible = false;
    group.add(shield);

    const rageRing = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1.02, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff4d6d,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    rageRing.rotation.x = -Math.PI / 2;
    rageRing.position.y = 0.06;
    rageRing.visible = false;
    group.add(rageRing);

    const nameTexture = createNameTexture(p.name, p.color);
    const nameSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: p.isBot ? 0.62 : 0.92,
      }),
    );
    nameSprite.scale.set(2.5, 0.7, 1);
    nameSprite.position.y = 2.85;
    group.add(nameSprite);

    const hpBg = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.solid,
        color: 0x061014,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        depthTest: false,
      }),
    );
    hpBg.scale.set(1.56, 0.1, 1);
    hpBg.position.set(0, 2.52, 0);
    group.add(hpBg);

    const hpFill = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.solid,
        color,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        depthTest: false,
      }),
    );
    hpFill.center.set(0, 0.5);
    hpFill.scale.set(1.5, 0.075, 1);
    hpFill.position.set(-0.75, 2.52, 0.001);
    group.add(hpFill);

    this.scene.add(group);
    const view = {
      group,
      bodyRoot,
      shadow,
      ring,
      orbitRing,
      bladeMesh,
      bladeDummy,
      bladeMat,
      aura,
      scarf: bakedFighter.scarf,
      tier: p.bladeLevel,
      shield,
      rageRing,
      nameSprite,
      hpFill,
      x: p.x,
      z: p.z,
      facing: p.facing,
      angle: p.bladeAngle,
      dead: p.hp <= 0,
      initialized: false,
      target: p,
    };
    this.views.set(p.id, view);
    return view;
  }

  syncMobViews(mobs) {
    const seen = new Set();
    for (const mob of mobs) {
      seen.add(mob.id);
      let data = this.mobData.get(mob.id);
      if (!data) {
        data = {
          x: mob.x,
          z: mob.z,
          phase: Math.random() * TAU,
          target: mob,
        };
        this.mobData.set(mob.id, data);
      } else {
        data.target = mob;
      }
    }
    for (const id of this.mobData.keys()) {
      if (!seen.has(id)) this.mobData.delete(id);
    }
  }

  syncPickupViews(pickups) {
    const seen = new Set();
    for (const u of pickups) {
      seen.add(u.id);
      if (!this.pickupViews.has(u.id)) this.createPickupView(u);
    }
    for (const [id, view] of this.pickupViews) {
      if (!seen.has(id)) {
        this.scene.remove(view.group);
        view.group.traverse((obj) => {
          if (obj.material && obj.material.map && obj.material.map !== this.shared.glowTexture) obj.material.map.dispose();
          obj.material?.dispose?.();
          if (!obj.isSprite) obj.geometry?.dispose?.();
        });
        this.pickupViews.delete(id);
      }
    }
  }

  createPickupView(u) {
    const grade = u.grade ?? 1;
    const gradeColor = [0x46ff9b, 0x3ee8ff, 0xc56dff][grade - 1] ?? 0x46ff9b;
    const colors = {
      upgrade: gradeColor,
      blade: u.level ? new THREE.Color(TIER_COLORS[u.level - 1] ?? TIER_COLORS[0]).getHex() : 0x9dffcf,
      haste: 0xffd166,
      rage: 0xff5c7a,
      shield: 0x64d2ff,
    };
    const labels = {
      upgrade: `+${grade}`,
      blade: '刃',
      haste: '疾',
      rage: '锋',
      shield: '护',
    };
    const color = colors[u.type] ?? 0xffffff;
    const upgrade = u.type === 'upgrade';
    const group = new THREE.Group();
    group.position.set(u.x, 0, u.z);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(upgrade ? 0.46 + grade * 0.05 : 0.34, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: upgrade ? 2.6 + grade * 0.4 : 2.2,
        metalness: 0.4,
        roughness: 0.24,
        flatShading: true,
      }),
    );
    core.position.y = 1.02;
    group.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.018, 4, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.position.y = 1.02;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.3, 2.1, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 0.95;
    group.add(beam);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.glowTexture,
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.y = 1.02;
    const glowScale = upgrade ? 2.3 + grade * 0.2 : 2.2;
    glow.scale.set(glowScale, glowScale, 1);
    glow.material.opacity = upgrade ? 0.36 : 0.3;
    group.add(glow);
    const cssColor = `#${color.toString(16).padStart(6, '0')}`;
    const label = createTextSprite(labels[u.type], cssColor, {
      size: 128,
      fontSize: upgrade ? 68 : 60,
      scale: upgrade ? 1.18 : 0.7,
      background: 'rgba(4, 12, 15, 0.86)',
    });
    label.position.y = upgrade ? 2.5 : 1.72;
    group.add(label);
    this.scene.add(group);
    this.pickupViews.set(u.id, {
      group,
      core,
      ring,
      label,
      type: u.type,
      grade: u.grade ?? null,
      phase: Math.random() * TAU,
    });
  }

  setInput(axes, dash) {
    this.input.x = axes.x;
    this.input.z = axes.z;
    if (
      dash &&
      this.localDashLock <= 0 &&
      this.localSnapshot &&
      this.localSnapshot.hp > 0 &&
      this.localSnapshot.dashCd <= 0.06
    ) {
      this.pendingDash = true;
      this.localDashLock = 0.55;
    }
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'hit') {
        const amount = Math.max(1, Math.round(e.amount));
        const local = this.localSnapshot;
        const involved = e.targetId === this.localId || e.attackerId === this.localId;
        const nearby = local && Math.hypot(local.x - e.x, local.z - e.z) < 14;
        if (involved || nearby) {
          this.spawnBurst(e.x, 0.9, e.z, e.absorbed > 0 ? 0x64d2ff : 0xff647f, 12, 4.2, 0.42);
          this.spawnRing(e.x, e.z, e.absorbed > 0 ? 0x64d2ff : 0xff5c7a, 0.6, 1.5, 0.3);
        }
        if (involved) {
          this.spawnDamageNumber(e.x, e.z, `${e.absorbed > 0 && e.amount <= e.absorbed ? '挡' : `-${amount}`}`, e.absorbed > 0 ? '#8fe7ff' : '#ffd0d7');
        }
        if (e.targetId === this.localId) {
          this.cameraShake = Math.max(this.cameraShake, 0.32);
          this.onLocalHit?.(e);
        }
      } else if (e.type === 'clash') {
        const local = this.localSnapshot;
        if (local && Math.hypot(local.x - e.x, local.z - e.z) < 14) {
          this.spawnBurst(e.x, 0.85, e.z, 0xffe0a3, 10, 5.2, 0.32);
          this.spawnRing(e.x, e.z, 0xffd166, 0.2, 0.8, 0.25);
        }
      } else if (e.type === 'bladeBreak') {
        const localInvolved = e.attackerId === this.localId || e.victimId === this.localId;
        this.spawnBurst(e.x, 1.1, e.z, e.attackerColor ?? 0xffd166, 26, 7.4, 0.72);
        this.spawnBurst(e.x, 1.1, e.z, e.victimColor ?? 0xff5c7a, 18, 5.4, 0.58);
        this.spawnRing(e.x, e.z, 0xffd166, 0.5, 4.6, 0.56);
        this.spawnRing(e.x, e.z, e.victimColor ?? 0xff5c7a, 0.8, 2.8, 0.4);
        if (localInvolved) this.cameraShake = Math.max(this.cameraShake, 0.55);
      } else if (e.type === 'powerUp') {
        const view = this.views.get(e.playerId);
        if (view) {
          this.spawnRing(view.x, view.z, view.target?.color ?? 0x5eead4, 0.4, 2.8, 0.45);
          this.spawnBurst(view.x, 1.1, view.z, TIER_COLORS[(e.bladeLevel ?? 1) - 1] ?? 0x5eead4, 16, 5.2, 0.5);
        }
      } else if (e.type === 'kill') {
        this.spawnBurst(e.x, 1, e.z, e.victimColor ?? 0xff5c7a, 28, 7.5, 0.8);
        this.spawnRing(e.x, e.z, 0xff5c7a, 0.9, 4.2, 0.65);
        this.spawnRing(e.x, e.z, e.killerColor ?? 0x5eead4, 1.2, 3.4, 0.45);
        if (e.victimId === this.localId) {
          this.cameraShake = Math.max(this.cameraShake, 0.9);
          this.onLocalDeath?.(e);
        } else if (e.killerId === this.localId) {
          this.cameraShake = Math.max(this.cameraShake, 0.35);
          this.onLocalKill?.(e);
        }
      } else if (e.type === 'dash') {
        const color = this.views.get(e.playerId)?.target?.color ?? 0x5eead4;
        this.spawnBurst(e.x, 0.35, e.z, color, 8, 3.4, 0.32);
        this.spawnRing(e.x, e.z, color, 0.4, 1.4, 0.28);
        if (e.playerId === this.localId) this.onLocalDash?.(e);
      } else if (e.type === 'pickup') {
        const color =
          e.pickupType === 'upgrade'
            ? 0xffd45e
            : e.pickupType === 'blade'
              ? 0x9dffcf
              : e.pickupType === 'haste'
                ? 0xffd166
                : e.pickupType === 'rage'
                  ? 0xff5c7a
                  : 0x64d2ff;
        const local = this.localSnapshot;
        if (e.playerId === this.localId || (local && Math.hypot(local.x - e.x, local.z - e.z) < 16)) {
          this.spawnBurst(e.x, 0.9, e.z, color, e.pickupType === 'upgrade' ? 28 : 18, 5, 0.6);
          this.spawnRing(e.x, e.z, color, 0.3, e.pickupType === 'upgrade' ? 3.4 : 2.2, 0.45);
        }
      } else if (e.type === 'mobHit') {
        const local = this.localSnapshot;
        const nearby = local && Math.hypot(local.x - e.x, local.z - e.z) < 14;
        if (e.playerId === this.localId || nearby) {
          this.spawnBurst(e.x, 0.75, e.z, 0xb06cff, 5, 2.8, 0.28);
        }
        if (e.playerId === this.localId) {
          this.spawnDamageNumber(e.x, e.z, `-${Math.max(1, Math.round(e.damage))}`, '#e0c8ff');
        }
      } else if (e.type === 'mobKill') {
        const local = this.localSnapshot;
        const nearby = local && Math.hypot(local.x - e.x, local.z - e.z) < 18;
        if (e.playerId === this.localId || nearby) {
          this.spawnBurst(e.x, 0.8, e.z, 0xb06cff, 18, 4.8, 0.55);
          this.spawnRing(e.x, e.z, 0xb06cff, 0.25, 2.1, 0.4);
        }
        if (e.playerId === this.localId && (e.bladeGained || e.levelGained)) {
          this.spawnRing(e.x, e.z, 0xffd45e, 0.4, 3.1, 0.55);
        }
      } else if (e.type === 'respawn') {
        this.spawnRing(e.x, e.z, 0x5eead4, 0.4, 2.6, 0.5);
      }
    }
  }

  spawnBurst(x, y, z, color, count = 12, speed = 4, life = 0.5) {
    if (this.effects.length >= (this.lowQuality ? 24 : 80)) return;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      const a = Math.random() * TAU;
      const up = Math.random() * 0.9 + 0.15;
      const s = speed * (0.35 + Math.random() * 0.65);
      velocities.push(new THREE.Vector3(Math.cos(a) * s * 0.7, up * s * 0.55, Math.sin(a) * s * 0.7));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.shared.glowTexture,
      color,
      size: 0.26,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.effects.push({ points, velocities, life, maxLife: life, type: 'burst' });
  }

  spawnRing(x, z, color, startRadius, endRadius, life) {
    if (this.effects.length >= (this.lowQuality ? 30 : 90)) return;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.1, z);
    mesh.scale.setScalar(startRadius);
    this.scene.add(mesh);
    this.effects.push({
      mesh,
      life,
      maxLife: life,
      type: 'ring',
      startRadius,
      endRadius,
    });
  }

  spawnDamageNumber(x, z, text, color) {
    if (this.damageNumbers.length >= (this.lowQuality ? 10 : 24)) return;
    const sprite = createTextSprite(text, color, {
      size: 128,
      fontSize: text.length > 2 ? 52 : 66,
      scale: 0.92,
      weight: 700,
    });
    sprite.position.set(x, 2.2, z);
    this.scene.add(sprite);
    this.damageNumbers.push({ sprite, life: 0.9, maxLife: 0.9, vy: 1.25 });
  }

  updateLocal(dt) {
    this.localDashLock = Math.max(0, this.localDashLock - dt);
    if (!this.localPred || !this.localSnapshot) return;
    const me = this.localSnapshot;
    const phase = this.match?.phase;
    if (me.hp <= 0 || phase !== 'playing') {
      if (phase !== 'playing') {
        this.localPred.x = lerp(this.localPred.x, me.x, damp(8, dt));
        this.localPred.z = lerp(this.localPred.z, me.z, damp(8, dt));
      }
      return;
    }

    if (this.pendingDash) {
      this.pendingDash = false;
      let dx = this.input.x;
      let dz = this.input.z;
      if (!dx && !dz) {
        dx = Math.sin(this.localPred.facing);
        dz = Math.cos(this.localPred.facing);
      }
      const len = Math.hypot(dx, dz) || 1;
      this.localPred.dashTime = 0.18;
      this.localPred.dashDirX = dx / len;
      this.localPred.dashDirZ = dz / len;
    }
    this.localPred.dashTime = Math.max(0, this.localPred.dashTime - dt);
    const speed = this.localPred.dashTime > 0 ? 19 : me.speed;
    const vx = this.localPred.dashTime > 0 ? this.localPred.dashDirX * speed : this.input.x * speed;
    const vz = this.localPred.dashTime > 0 ? this.localPred.dashDirZ * speed : this.input.z * speed;
    this.localPred.x += vx * dt;
    this.localPred.z += vz * dt;
    if (vx || vz) this.localPred.facing = Math.atan2(vx, vz);
    const r = Math.hypot(this.localPred.x, this.localPred.z);
    const maxR = ARENA_RADIUS - 0.68;
    if (r > maxR) {
      this.localPred.x = (this.localPred.x / r) * maxR;
      this.localPred.z = (this.localPred.z / r) * maxR;
    }
    this.localPred.angle = (this.localPred.angle + me.bladeSpeed * dt) % TAU;
  }

  updateViews(dt) {
    for (const [id, view] of this.views) {
      const p = view.target;
      if (!p) continue;
      const isLocal = id === this.localId;
      if (!view.dead) {
        if (isLocal && this.localPred) {
          view.x = this.localPred.x;
          view.z = this.localPred.z;
          view.facing += shortestAngle(view.facing, this.localPred.facing) * damp(14, dt);
          view.angle = this.localPred.angle;
        } else {
          const dist = Math.hypot(p.x - view.x, p.z - view.z);
          if (dist > 5) {
            view.x = p.x;
            view.z = p.z;
          } else {
            const t = damp(12, dt);
            view.x = lerp(view.x, p.x, t);
            view.z = lerp(view.z, p.z, t);
          }
          view.facing += shortestAngle(view.facing, p.facing) * damp(12, dt);
          view.angle = (view.angle + p.bladeSpeed * dt) % TAU;
        }
      }
      view.group.position.set(view.x, 0, view.z);
      view.bodyRoot.rotation.y = view.facing;
      const moving = !view.dead && (Math.abs(p.x - view.x) > 0.02 || Math.abs(p.z - view.z) > 0.02);
      view.bodyRoot.position.y = view.dead ? 0 : Math.sin(this.elapsed * 7 + id.length) * 0.012 + (moving ? 0.015 : 0);
      view.bodyRoot.scale.setScalar(p.scale);
      view.shadow.scale.setScalar(0.92 + p.scale * 0.12);
      view.ring.scale.setScalar(1.1 * p.scale);
      view.nameSprite.position.y = 2.64 + p.scale * 0.2;
      view.nameSprite.material.opacity = p.isBot ? 0.66 : 0.94;
      view.shadow.position.y = 0.03;

      const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
      view.hpFill.scale.x = 1.5 * hpRatio;
      view.hpFill.material.color.set(p.hp < p.maxHp * 0.3 ? 0xff5c7a : p.color);
      view.hpFill.position.y = 2.41 + p.scale * 0.16;
      view.nameSprite.position.y = 2.67 + p.scale * 0.18;

      if (view.tier !== p.bladeLevel) {
        const tierColor = TIER_COLORS[p.bladeLevel - 1] ?? TIER_COLORS[0];
        view.tier = p.bladeLevel;
        view.bladeMat.uniforms.uOuter.value.set(tierColor);
        view.orbitRing.material.color.set(tierColor);
        view.aura.material.color.set(tierColor);
      }

      const bladeScale = p.bladeLength / BLADE_GEOM_LENGTH;
      const bladeCount = view.dead ? 0 : Math.min(p.bladeCount, MAX_BLADES);
      view.bladeMesh.count = bladeCount;
      view.bladeMesh.visible = bladeCount > 0;
      for (let i = 0; i < bladeCount; i++) {
        const ring = i % 3;
        const angle = view.angle + (i / p.bladeCount) * TAU + (ring - 1) * 0.045;
        const radius = p.bladeRadius + ring * 0.13;
        view.bladeDummy.position.set(
          Math.cos(angle) * radius,
          0.56 + ring * 0.025,
          Math.sin(angle) * radius,
        );
        view.bladeDummy.rotation.set(0, Math.PI - angle, 0);
        view.bladeDummy.scale.setScalar(bladeScale);
        view.bladeDummy.updateMatrix();
        view.bladeMesh.setMatrixAt(i, view.bladeDummy.matrix);
      }
      view.bladeMesh.instanceMatrix.needsUpdate = true;
      view.aura.visible = !view.dead;
      view.aura.material.opacity = p.buffs.rage > 0 ? 0.26 : 0.12;
      view.orbitRing.scale.set(p.bladeRadius + 0.26, p.bladeRadius + 0.26, 1);
      view.orbitRing.visible = !view.dead;
      view.orbitRing.material.opacity = p.buffs.rage > 0 ? 0.34 : 0.15;
      view.shield.visible = p.buffs.shield > 0 && !view.dead;
      if (view.shield.visible) {
        view.shield.rotation.y += dt * 0.7;
        view.shield.rotation.x += dt * 0.34;
        view.shield.material.opacity = 0.22 + Math.sin(this.elapsed * 4) * 0.08;
      }
      view.rageRing.visible = p.buffs.rage > 0 && !view.dead;
      if (view.rageRing.visible) {
        const pulse = 1 + Math.sin(this.elapsed * 6) * 0.07;
        view.rageRing.scale.setScalar(p.bladeRadius * 0.78 * pulse);
        view.rageRing.material.opacity = 0.3 + Math.sin(this.elapsed * 6) * 0.12;
      }
      if (view.scarf) {
        view.scarf.rotation.x = Math.sin(this.elapsed * 5 + id.length) * 0.14;
        view.scarf.rotation.z = Math.cos(this.elapsed * 4 + id.length) * 0.08;
      }
    }
  }

  updateMobViews(dt) {
    let count = 0;
    const positions = this.mobFacePositions;
    const dummy = this.mobDummy;
    for (const data of this.mobData.values()) {
      const mob = data.target;
      if (!mob) continue;
      data.x = lerp(data.x, mob.x, damp(11, dt));
      data.z = lerp(data.z, mob.z, damp(11, dt));
      data.phase += dt;
      const bob = Math.sin(data.phase * 3.2) * 0.07;

      dummy.position.set(data.x, 0.67 + bob, data.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1.12, 1.08, 1.12);
      dummy.updateMatrix();
      this.mobBodyMesh.setMatrixAt(count, dummy.matrix);

      const angle = data.phase * 2.6;
      dummy.position.set(
        data.x + Math.cos(angle) * 0.62,
        0.66 + bob,
        data.z + Math.sin(angle) * 0.62,
      );
      dummy.rotation.set(0, Math.PI - angle, 0);
      dummy.scale.setScalar(0.2);
      dummy.updateMatrix();
      this.mobBladeMesh.setMatrixAt(count, dummy.matrix);

      positions[count * 3] = data.x;
      positions[count * 3 + 1] = 0.95 + bob * 1.2;
      positions[count * 3 + 2] = data.z;

      count++;
      if (count >= MAX_MOBS) break;
    }
    this.mobBodyMesh.count = count;
    this.mobBladeMesh.count = count;
    this.mobBodyMesh.instanceMatrix.needsUpdate = true;
    this.mobBladeMesh.instanceMatrix.needsUpdate = true;
    const faceAttribute = this.mobFacePoints.geometry.attributes.position;
    faceAttribute.needsUpdate = true;
    this.mobFacePoints.geometry.setDrawRange(0, count);
  }

  updatePickups(dt) {
    for (const view of this.pickupViews.values()) {
      view.phase += dt;
      view.core.rotation.y += dt * 1.2;
      view.core.rotation.x = Math.sin(view.phase * 1.4) * 0.18;
      view.core.position.y = 1.02 + Math.sin(view.phase * 2.1) * 0.12;
      view.ring.position.y = view.core.position.y;
      view.ring.rotation.z += dt * 0.9;
      const labelBase = view.type === 'upgrade' ? 2.48 : 1.7;
      view.label.position.y = labelBase + Math.sin(view.phase * 2.1) * 0.12;
    }
  }

  updateZone(dt) {
    this.zoneVisual.radius = lerp(this.zoneVisual.radius, this.zoneTarget.radius, damp(6, dt));
    this.zoneVisual.x = lerp(this.zoneVisual.x, this.zoneTarget.x, damp(5, dt));
    this.zoneVisual.z = lerp(this.zoneVisual.z, this.zoneTarget.z, damp(5, dt));
    const r = this.zoneVisual.radius;
    this.zoneWall.scale.set(r, 1, r);
    this.zoneWall.position.x = this.zoneVisual.x;
    this.zoneWall.position.z = this.zoneVisual.z;
    this.zoneRing.scale.set(r, r, 1);
    this.zoneRing.position.x = this.zoneVisual.x;
    this.zoneRing.position.z = this.zoneVisual.z;
    this.zoneMat.uniforms.uTime.value = this.elapsed;
    const shrinkT = clamp((ARENA_RADIUS - this.zoneTarget.radius) / (ARENA_RADIUS - 8), 0, 1);
    this.zoneMat.uniforms.uOpacity.value = 0.2 + shrinkT * 0.7;
    this.zoneRing.material.opacity = 0.16 + shrinkT * 0.34 + Math.sin(this.elapsed * 2.4) * 0.05;
    this.overlayMat.uniforms.uTime.value = this.elapsed;
    this.overlayMat.uniforms.uSafe.value = r;
    this.overlayMat.uniforms.uZone.value.set(this.zoneVisual.x, this.zoneVisual.z);
    const inDanger = this.localSnapshot && this.localSnapshot.hp > 0 && this.match?.phase === 'playing'
      && Math.hypot(this.localSnapshot.x - this.zoneVisual.x, this.localSnapshot.z - this.zoneVisual.z) > r;
    return inDanger;
  }

  updateAmbient(dt) {
    if (this.embers) {
      const pos = this.embers.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const base = i * 3;
        const t = this.elapsed * 0.22 + i * 0.47;
        pos.array[base] = this.emberBase[base] + Math.sin(t * 0.7) * 0.6;
        pos.array[base + 1] = this.emberBase[base + 1] + Math.sin(t) * 0.45;
        pos.array[base + 2] = this.emberBase[base + 2] + Math.cos(t * 0.8) * 0.6;
      }
      pos.needsUpdate = true;
    }
    if (this.petals) {
      const pos = this.petals.geometry.attributes.position;
      for (let i = 0; i < this.petalData.length; i++) {
        const d = this.petalData[i];
        d.angle += dt * d.speed * 0.05;
        const y = 1 + ((this.elapsed * d.speed + i * 0.9) % 11);
        pos.array[i * 3] = Math.cos(d.angle) * d.radius + Math.sin(this.elapsed * d.speed * 2 + d.phase) * 0.4;
        pos.array[i * 3 + 1] = y;
        pos.array[i * 3 + 2] = Math.sin(d.angle) * d.radius;
      }
      pos.needsUpdate = true;
    }
    if (this.preview && this.preview.visible) {
      this.preview.rotation.y += dt * 0.18;
      this.preview.position.y = Math.sin(this.elapsed * 0.9) * 0.12;
    }

  }

  updateCamera(dt, inDanger) {
    if (!this.localId || !this.localSnapshot || !this.localPred) {
      const a = -0.35 + Math.sin(this.elapsed * 0.055) * 0.48;
      const radius = 48;
      const h = 30;
      const desired = new THREE.Vector3(Math.sin(a) * radius, h, Math.cos(a) * radius);
      this.camera.position.lerp(desired, damp(1.6, dt));
      this.cameraLook.lerp(new THREE.Vector3(0, 1.1, 0), damp(3, dt));
      this.camera.lookAt(this.cameraLook);
      return;
    }
    const p = this.localSnapshot;
    const alive = p.hp > 0;
    const focusX = alive ? this.localPred.x : p.x;
    const focusZ = alive ? this.localPred.z : p.z;
    const aspect = this.camera.aspect || 1;
    const portraitZoom = clamp(1.08 / aspect, 1, 1.62);
    const dangerZoom = inDanger ? 1.04 : 1;
    const height = 28 * portraitZoom * dangerZoom;
    const back = 21.5 * portraitZoom * dangerZoom;
    const desired = new THREE.Vector3(focusX, height, focusZ + back);
    const look = new THREE.Vector3(focusX, 1.0, focusZ);
    if (this.needsCameraSnap) {
      this.camera.position.copy(desired);
      this.cameraLook.copy(look);
      this.needsCameraSnap = false;
    } else {
      this.camera.position.lerp(desired, damp(4.2, dt));
      this.cameraLook.lerp(look, damp(5.4, dt));
    }
    this.cameraShake *= Math.exp(-8 * dt);
    if (this.cameraShake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShake * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this.cameraShake;
    }
    this.camera.lookAt(this.cameraLook);
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        if (e.type === 'burst') {
          this.scene.remove(e.points);
          e.points.geometry.dispose();
          e.points.material.dispose();
        } else {
          this.scene.remove(e.mesh);
          e.mesh.geometry.dispose();
          e.mesh.material.dispose();
        }
        this.effects.splice(i, 1);
        continue;
      }
      const t = 1 - e.life / e.maxLife;
      if (e.type === 'burst') {
        const attr = e.points.geometry.attributes.position;
        for (let k = 0; k < e.velocities.length; k++) {
          const v = e.velocities[k];
          attr.array[k * 3] += v.x * dt;
          attr.array[k * 3 + 1] += v.y * dt;
          attr.array[k * 3 + 2] += v.z * dt;
          v.y -= 5.5 * dt;
          v.multiplyScalar(1 - 1.8 * dt);
        }
        attr.needsUpdate = true;
        e.points.material.opacity = 1 - t;
      } else {
        const radius = lerp(e.startRadius, e.endRadius, 1 - Math.pow(1 - t, 2));
        e.mesh.scale.setScalar(radius);
        e.mesh.material.opacity = (1 - t) * 0.7;
      }
    }

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.sprite);
        d.sprite.material.map?.dispose();
        d.sprite.material.dispose();
        this.damageNumbers.splice(i, 1);
        continue;
      }
      const t = 1 - d.life / d.maxLife;
      d.sprite.position.y += d.vy * dt;
      d.sprite.material.opacity = 1 - t;
      const s = 1.1 + t * 0.25;
      d.sprite.scale.set(s, s, 1);
    }
  }

  setLowQuality(enabled) {
    if (this.lowQuality === enabled) return;
    this.lowQuality = enabled;
    this.renderer.shadowMap.enabled = !enabled;
    if (!enabled) this.renderer.shadowMap.needsUpdate = true;
    this.bloom.enabled = !enabled;
    this.resize();
    this.qualityTimer = 0;
  }

  updateQuality(dt) {
    if (this.qualityLock === 'high' || this.qualityLock === 'low') return;
    const instantFps = 1 / Math.max(dt, 0.001);
    this.fpsAvg = lerp(this.fpsAvg, Math.min(120, instantFps), 0.05);
    const players = this.state?.players ?? [];
    const alive = players.filter((p) => p.hp > 0);
    const totalBlades = alive.reduce((sum, p) => sum + (p.bladeCount ?? 0), 0);
    const stressed = alive.length >= 7 || totalBlades >= 38;
    const struggling = this.fpsAvg < 44;
    if (!this.lowQuality) {
      if (stressed || struggling) this.qualityTimer += dt;
      else this.qualityTimer = Math.max(0, this.qualityTimer - dt * 2);
      if (this.qualityTimer > 2.2) this.setLowQuality(true);
    } else {
      if (!stressed && this.fpsAvg > 54) this.qualityTimer += dt;
      else this.qualityTimer = Math.max(0, this.qualityTimer - dt);
      if (this.qualityTimer > 8) this.setLowQuality(false);
    }
  }

  resize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 0.8 ? 52 : 46;
    this.camera.updateProjectionMatrix();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const ratioCap = this.lowQuality
      ? coarse
        ? 0.8
        : 0.9
      : coarse
        ? 1.05
        : 1.35;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, ratioCap);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.strength = width < 760 ? 0.46 : 0.6;
  }

  update(dt) {
    this.elapsed += dt;
    this.updateLocal(dt);
    this.updateViews(dt);
    this.updateMobViews(dt);
    this.updatePickups(dt);
    const inDanger = this.updateZone(dt);
    this.updateAmbient(dt);
    this.updateEffects(dt);
    this.updateCamera(dt, inDanger);
    this.updateQuality(dt);
    this.sky.position.copy(this.camera.position);
    if (this.lowQuality) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
    return inDanger;
  }

  getLocalPosition() {
    if (this.localPred) return { x: this.localPred.x, z: this.localPred.z };
    if (this.localSnapshot) return { x: this.localSnapshot.x, z: this.localSnapshot.z };
    return null;
  }
}
