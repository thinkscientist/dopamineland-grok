import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const CAM_START = 9;
const CAM_END = -48;
const CORE_Z = -56;
const TUNNEL_NEAR = 3.2;
const TUNNEL_FAR = -70;

const MOODS = {
  drift: {
    hue: 0.8,
    spread: 0.42,
    sat: 0.8,
    light: 0.6,
    skyA: "#07010f",
    skyB: "#221552",
    skyC: "#401433",
    skyD: "#0b2c48",
    fog: "#090414",
    bloom: 0.48,
    spin: 0.07,
    core: "#ff4f9a",
    emissive: "#ff2f78",
    gate: "#9af4ff",
    radius: 3.2,
  },
  surge: {
    hue: 0.99,
    spread: 0.1,
    sat: 0.95,
    light: 0.57,
    skyA: "#140208",
    skyB: "#5a1020",
    skyC: "#5a2808",
    skyD: "#2a0838",
    fog: "#16040a",
    bloom: 0.74,
    spin: 0.2,
    core: "#ff2a3c",
    emissive: "#ff5a1f",
    gate: "#ffd36a",
    radius: 4.4,
  },
  candy: {
    hue: 0.1,
    spread: 0.62,
    sat: 0.84,
    light: 0.66,
    skyA: "#140816",
    skyB: "#3c1654",
    skyC: "#0e3a34",
    skyD: "#4a2414",
    fog: "#160816",
    bloom: 0.58,
    spin: 0.1,
    core: "#ffe56a",
    emissive: "#ff8bd2",
    gate: "#7dffc3",
    radius: 3.6,
  },
};

const ORB_VERT = /* glsl */ `
uniform float uTime;
uniform float uIntro;
uniform vec3 uPointer;
uniform float uRadius;
uniform vec3 uBurst;
uniform float uBurstAmt;

varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying float vFog;

void main() {
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(1.0);
  #endif

  float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.21 + instanceMatrix[3].y * 2.3;
  vec3 pos = position * (1.0 + 0.055 * sin(uTime * 1.35 + phase));
  pos *= mix(0.001, 1.0, uIntro);
  pos.y += sin(uTime * 0.75 + phase) * 0.11;

  vec4 world = modelMatrix * instanceMatrix * vec4(pos, 1.0);

  vec3 away = world.xyz - uPointer;
  float distP = length(away);
  float influence = (1.0 - smoothstep(0.0, uRadius, distP)) * uIntro;
  world.xyz += (away / max(distP, 0.0001)) * influence * 1.15;

  vec3 burst = world.xyz - uBurst;
  float distB = length(burst);
  float burstInf = (1.0 - smoothstep(0.0, 8.0, distB)) * uBurstAmt;
  world.xyz += (burst / max(distB, 0.0001)) * burstInf;

  vW = world.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  float dist = distance(vW, cameraPosition);
  vFog = exp(-0.04 * dist);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ORB_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;

varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying float vFog;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.35);
  vec3 L = normalize(vec3(0.42, 0.78, 0.32));
  float wrap = clamp(dot(N, L) * 0.55 + 0.45, 0.0, 1.0);
  float diff = pow(clamp(dot(N, L), 0.0, 1.0), 0.85);
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 70.0);
  float irid = 0.5 + 0.5 * sin(ndv * 10.0 + uTime * 0.7 + vW.z * 0.09);

  vec3 body = vCol * (0.035 + wrap * 0.2 + diff * 0.42);
  vec3 rim = mix(vCol, vec3(1.0), 0.62) * fres * 1.45;
  vec3 oil = mix(vCol.gbr, vCol.brg, irid);
  vec3 col = body + rim + oil * fres * 0.7 + spec * vec3(1.15, 1.02, 0.96);
  col = mix(uFogColor, col, clamp(vFog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uColorD;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 13.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float n = fbm(dir * 1.45 + vec3(uTime * 0.012, 0.0, -uTime * 0.01));
  float n2 = fbm(dir * 2.6 + vec3(2.0, uTime * 0.018, -1.4));
  vec3 col = mix(uColorA, uColorB, smoothstep(0.38, 0.78, n));
  col = mix(col, uColorC, smoothstep(0.55, 0.92, n2) * 0.72);
  col = mix(col, uColorD, smoothstep(0.62, 0.95, n) * 0.45);
  gl_FragColor = vec4(col, 1.0);
}
`;

const POINT_VERT = /* glsl */ `
attribute float aPhase;
attribute float aScale;
uniform float uTime;
uniform float uDrift;
varying vec3 vTint;
varying float vTwinkle;

void main() {
  vTint = color;
  vec3 p = position;
  float span = 78.0;
  p.z = mod(position.z - uTime * uDrift + 900.0, span) - 70.0;
  p.x += sin(uTime * 0.55 + aPhase) * 0.16;
  p.y += cos(uTime * 0.47 + aPhase * 1.4) * 0.12;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vTwinkle = 0.45 + 0.55 * sin(uTime * 2.4 + aPhase);
  float dist = max(-mv.z, 1.2);
  gl_PointSize = clamp(aScale * vTwinkle * (160.0 / dist), 2.2, 18.0);
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vTwinkle;

void main() {
  vec2 pc = gl_PointCoord - vec2(0.5);
  float d = length(pc);
  if (d > 0.48) discard;
  float alpha = smoothstep(0.48, 0.05, d) * vTwinkle;
  gl_FragColor = vec4(vTint, alpha);
}
`;

const BURST_VERT = /* glsl */ `
attribute float aLife;
varying vec3 vTint;
varying float vLife;

void main() {
  vTint = color;
  vLife = aLife;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife * (260.0 / max(-mv.z, 0.8));
}
`;

const BURST_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vLife;

void main() {
  if (vLife <= 0.001) discard;
  vec2 pc = gl_PointCoord - vec2(0.5);
  float d = length(pc);
  if (d > 0.48) discard;
  float alpha = smoothstep(0.48, 0.0, d) * vLife;
  gl_FragColor = vec4(vTint, alpha);
}
`;

const FINISH_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.001 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - 0.5;
      float d = dot(dir, dir);
      vec2 offset = dir * uAmount * (0.35 + d * 2.4);
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 col = vec3(r, g, b);
      float grain = fract(sin(dot(vUv * (uTime + 4.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (grain - 0.5) * 0.028;
      float vig = smoothstep(1.05, 0.22, length((vUv - 0.5) * vec2(1.08, 1.18)));
      col *= mix(0.62, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class World {
  constructor(container) {
    this.container = container;
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mobile = window.matchMedia("(max-width: 800px)").matches;
    this.moodName = "drift";
    this.time = 0;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.intro = this.reduce ? 1 : 0;
    this.spin = 0;
    this.spinSpeed = MOODS.drift.spin;
    this.hue = MOODS.drift.hue;
    this.spread = MOODS.drift.spread;
    this.sat = MOODS.drift.sat;
    this.light = MOODS.drift.light;
    this.flash = 0;
    this.chroma = 0.0006;
    this.shake = 0;
    this.roll = 0;
    this.camX = 0;
    this.camY = 0.15;
    this.camZ = this.reduce ? CAM_START : 13.2;
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerWorld = new THREE.Vector3(0, 0, -4);
    this.radius = 0;
    this.radiusTarget = 0;
    this.burstAmt = 0;
    this.burstPos = new THREE.Vector3(0, 0, -20);
    this._color = new THREE.Color();
    this._target = new THREE.Color();
    this.raycaster = new THREE.Raycaster();
    this.hitPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.moodColors = {
      skyA: new THREE.Color(MOODS.drift.skyA),
      skyB: new THREE.Color(MOODS.drift.skyB),
      skyC: new THREE.Color(MOODS.drift.skyC),
      skyD: new THREE.Color(MOODS.drift.skyD),
      fog: new THREE.Color(MOODS.drift.fog),
      core: new THREE.Color(MOODS.drift.core),
      emissive: new THREE.Color(MOODS.drift.emissive),
      gate: new THREE.Color(MOODS.drift.gate).multiplyScalar(1.7),
    };
    this.clock = new THREE.Clock();
    this.groups = [];
    this.gates = [];
    this.rails = [];
    this.rings = [];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.08, 220);
    this.camera.position.set(0, 0.15, this.camZ);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(MOODS.drift.fog, 1);
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
    pmrem.dispose();

    this.buildSky();
    this.buildOrbs();
    this.buildCore();
    this.buildGates();
    this.buildRails();
    this.buildSparks();
    this.buildBursts();
    this.buildRings();
    this.buildPointer();
    this.buildComposer();
    this.paintOrbs();
    this.resize();
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(MOODS.drift.skyA) },
        uColorB: { value: new THREE.Color(MOODS.drift.skyB) },
        uColorC: { value: new THREE.Color(MOODS.drift.skyC) },
        uColorD: { value: new THREE.Color(MOODS.drift.skyD) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(130, 48, 32), this.skyMat);
    this.sky.position.set(0, 0, -24);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildOrbs() {
    const perShell = this.mobile ? 210 : 480;
    const detail = this.mobile ? [20, 14] : [24, 18];
    this.orbMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntro: { value: this.intro },
        uPointer: { value: this.pointerWorld },
        uRadius: { value: 0 },
        uBurst: { value: this.burstPos },
        uBurstAmt: { value: 0 },
        uFogColor: { value: new THREE.Color(MOODS.drift.fog) },
      },
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
    });

    for (let shell = 0; shell < 2; shell++) {
      const geo = new THREE.SphereGeometry(1, detail[0], detail[1]);
      const mesh = new THREE.InstancedMesh(geo, this.orbMat, perShell);
      mesh.frustumCulled = false;
      const hues = new Float32Array(perShell);
      const lights = new Float32Array(perShell);
      const dummy = new THREE.Object3D();
      const cluster = Math.floor(perShell * 0.09);

      for (let i = 0; i < perShell; i++) {
        let x;
        let y;
        let z;
        let scale;
        if (i < cluster) {
          const a = i * 2.399963 + shell * 1.7;
          const r = 3.5 + (i % 7) * 0.26;
          x = Math.cos(a) * r;
          y = Math.sin(a) * r * 0.74;
          z = CORE_Z + Math.sin(i * 1.3 + shell) * 1.8;
          scale = 0.16 + (i % 5) * 0.045;
        } else {
          const t = (i - cluster) / (perShell - cluster);
          z = TUNNEL_NEAR - t * (TUNNEL_NEAR - TUNNEL_FAR);
          const arm = (i * 3 + shell * 5) % 8;
          const ang = t * Math.PI * (shell === 0 ? 24 : -19) + arm * 0.78 + shell;
          const lane = 2.15 + (arm % 4) * 0.62 + Math.sin(t * Math.PI * 7.0 + shell) * 0.28;
          x = Math.cos(ang) * lane;
          y = Math.sin(ang) * lane * 0.8;
          const hero = i % 19 === 0;
          scale = hero ? 0.28 + (i % 4) * 0.05 : 0.08 + (i % 6) * 0.028;
        }
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        hues[i] = ((i * 37 + shell * 13) % 100) / 100;
        lights[i] = ((i * 19 + shell * 7) % 100) / 100;
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.groups.push({ mesh, hues, lights, count: perShell, dir: shell === 0 ? 1 : -0.82 });
    }
  }

  buildCore() {
    const mood = MOODS.drift;
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(3.15, 72, 56),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(mood.core),
        emissive: new THREE.Color(mood.emissive),
        emissiveIntensity: 0.42,
        roughness: 0.08,
        metalness: 0.02,
        transmission: 0.55,
        thickness: 2.6,
        ior: 1.42,
        iridescence: 1,
        iridescenceIOR: 1.28,
        iridescenceThicknessRange: [80, 420],
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        attenuationColor: new THREE.Color(mood.core),
        attenuationDistance: 2.2,
        envMapIntensity: 1.35,
      })
    );
    this.core.position.set(0, 0, CORE_Z);
    this.scene.add(this.core);

    const key = new THREE.PointLight("#fff2d8", 80, 46, 2);
    key.position.set(5.5, 4.2, CORE_Z + 7);
    const fill = new THREE.PointLight("#7af0ff", 40, 40, 2);
    fill.position.set(-6, -2.4, CORE_Z + 4);
    this.scene.add(key, fill);
    this.lights = { key, fill };

    const map = makeGlowTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        color: new THREE.Color(mood.core),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.32,
      })
    );
    this.halo.material.toneMapped = false;
    this.halo.position.set(0, 0, CORE_Z);
    this.halo.scale.set(8.2, 8.2, 1);
    this.scene.add(this.halo);
    this.glowMap = map;
  }

  buildGates() {
    for (let i = 0; i < 8; i++) {
      const radius = 2.05 + (i % 3) * 0.62;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.014, 12, 180),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(MOODS.drift.gate).multiplyScalar(1.7),
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.material.toneMapped = false;
      mesh.position.z = 0.4 - i * 8.2;
      mesh.rotation.x = i % 2 === 0 ? 0.42 : -0.33;
      mesh.rotation.y = (i % 3) * 0.2;
      mesh.userData.speed = (0.12 + i * 0.02) * (i % 2 === 0 ? 1 : -1);
      this.gates.push(mesh);
      this.scene.add(mesh);
    }
  }

  buildRails() {
    const geo = new THREE.CapsuleGeometry(0.012, 26, 2, 6);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(i % 2 ? "#ff7ac8" : "#8af6ff").multiplyScalar(2.2),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(geo, mat);
      const a = (i / 12) * Math.PI * 2;
      const r = 2.15 + (i % 4) * 0.38;
      mesh.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.78, -2 - (i % 5) * 12);
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = a;
      this.rails.push(mesh);
      this.scene.add(mesh);
    }
  }

  buildSparks() {
    const count = this.mobile ? 700 : 1700;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const scales = new Float32Array(count);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.35 + Math.random() * 4.3;
      positions[i * 3] = Math.cos(ang) * rad;
      positions[i * 3 + 1] = Math.sin(ang) * rad * 0.82;
      positions[i * 3 + 2] = TUNNEL_NEAR - Math.random() * (TUNNEL_NEAR - TUNNEL_FAR);
      color.setHSL(Math.random(), 0.75, 0.68);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      phases[i] = Math.random() * Math.PI * 2;
      scales[i] = 0.45 + Math.random() * 1.15;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDrift: { value: this.reduce ? 0 : 1.6 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkMat.toneMapped = false;
    this.sparks = new THREE.Points(geo, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
  }

  buildBursts() {
    const max = 520;
    this.burstMax = max;
    this.burstCursor = 0;
    this.bPos = new Float32Array(max * 3);
    this.bVel = new Float32Array(max * 3);
    this.bCol = new Float32Array(max * 3);
    this.bBase = new Float32Array(max * 3);
    this.bLife = new Float32Array(max);
    this.bMaxLife = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.bPos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.bCol, 3));
    geo.setAttribute("aLife", new THREE.BufferAttribute(this.bLife, 1));
    this.burstMat = new THREE.ShaderMaterial({
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.burstMat.toneMapped = false;
    this.burstPoints = new THREE.Points(geo, this.burstMat);
    this.burstPoints.frustumCulled = false;
    this.scene.add(this.burstPoints);
  }

  buildRings() {
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.5, 96),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.material.toneMapped = false;
      mesh.visible = false;
      mesh.userData.life = 0;
      mesh.userData.age = 0;
      mesh.userData.delay = 0;
      this.rings.push(mesh);
      this.scene.add(mesh);
    }
  }

  buildPointer() {
    this.pointerSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowMap,
        color: new THREE.Color("#ffe6f4"),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      })
    );
    this.pointerSprite.material.toneMapped = false;
    this.pointerSprite.scale.set(1.6, 1.6, 1);
    this.scene.add(this.pointerSprite);
  }

  buildComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    const dpr = this.renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(size.width * dpr)),
      Math.max(1, Math.floor(size.height * dpr)),
      { type: THREE.HalfFloatType, samples: 4 }
    );
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), MOODS.drift.bloom, 0.46, 0.32);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
  }

  setScroll(value) {
    this.scrollTarget = THREE.MathUtils.clamp(value, 0, 1);
  }

  setPointer(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.radiusTarget = MOODS[this.moodName].radius;
  }

  clearPointer() {
    this.radiusTarget = 0;
  }

  setMood(name) {
    if (!MOODS[name]) return;
    this.moodName = name;
    this.forcePaint = true;
    this.syncMoodColors();
    this.flash = Math.max(this.flash, 0.16);
    const ahead = this.camera.position.clone();
    ahead.z -= 4.5;
    this.spawnRing(ahead, 0);
  }

  burst(x, y) {
    this.setPointer(x, y);
    this.updatePointerWorld();
    const mood = MOODS[this.moodName];
    const color = this._color.set(mood.gate);
    this.spawnParticles(this.pointerWorld, color, this.mobile ? 48 : 86);
    this.spawnRing(this.pointerWorld, 0);
    this.spawnRing(this.pointerWorld, 0.07);
    this.burstPos.copy(this.pointerWorld);
    this.burstAmt = Math.min(2.4, this.burstAmt + 1.35);
    this.flash = Math.min(0.42, this.flash + 0.2);
    this.shake = Math.min(1, this.shake + 0.85);
    this.chroma = Math.min(0.02, this.chroma + 0.01);
  }

  spawnParticles(origin, color, count) {
    for (let n = 0; n < count; n++) {
      const i = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % this.burstMax;
      const dir = randomUnit();
      const speed = 1.4 + Math.random() * 4.2;
      this.bPos[i * 3] = origin.x + dir.x * 0.05;
      this.bPos[i * 3 + 1] = origin.y + dir.y * 0.05;
      this.bPos[i * 3 + 2] = origin.z + dir.z * 0.05;
      this.bVel[i * 3] = dir.x * speed;
      this.bVel[i * 3 + 1] = dir.y * speed;
      this.bVel[i * 3 + 2] = dir.z * speed;
      const mix = 0.35 + Math.random() * 0.65;
      this.bBase[i * 3] = color.r * mix + (1 - mix);
      this.bBase[i * 3 + 1] = color.g * mix + (1 - mix) * 0.85;
      this.bBase[i * 3 + 2] = color.b * mix + (1 - mix) * 0.95;
      this.bLife[i] = 1;
      this.bMaxLife[i] = 0.55 + Math.random() * 0.7;
    }
  }

  spawnRing(position, delay) {
    let ring = this.rings.find((item) => item.userData.life <= 0 && item.userData.age <= 0);
    if (!ring) ring = this.rings[0];
    ring.position.copy(position);
    ring.userData.life = 1;
    ring.userData.age = -delay;
    ring.userData.delay = delay;
    ring.scale.setScalar(0.15);
    ring.material.opacity = 0;
    ring.material.color.copy(this._target.set(MOODS[this.moodName].gate)).multiplyScalar(2.1);
    ring.visible = delay <= 0;
    ring.lookAt(this.camera.position);
  }

  updatePointerWorld() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const planeZ = this.camera.position.z - 4.2;
    this.hitPlane.constant = -planeZ;
    const hit = this.raycaster.ray.intersectPlane(this.hitPlane, this.pointerWorld);
    if (!hit) this.pointerWorld.set(0, 0, planeZ);
  }

  syncMoodColors() {
    const mood = MOODS[this.moodName];
    this.moodColors.skyA.set(mood.skyA);
    this.moodColors.skyB.set(mood.skyB);
    this.moodColors.skyC.set(mood.skyC);
    this.moodColors.skyD.set(mood.skyD);
    this.moodColors.fog.set(mood.fog);
    this.moodColors.core.set(mood.core);
    this.moodColors.emissive.set(mood.emissive);
    this.moodColors.gate.set(mood.gate).multiplyScalar(1.7);
  }

  paintOrbs() {
    for (const group of this.groups) {
      for (let i = 0; i < group.count; i++) {
        const h = (this.hue + (group.hues[i] - 0.5) * this.spread + 1) % 1;
        const light = THREE.MathUtils.clamp(this.light + (group.lights[i] - 0.5) * 0.2, 0.45, 0.78);
        this._color.setHSL(h, this.sat, light);
        group.mesh.setColorAt(i, this._color);
      }
      group.mesh.instanceColor.needsUpdate = true;
    }
  }

  resize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const dprCap = this.mobile ? 1.25 : 1.6;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  update(energy) {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    if (!this.reduce) this.intro = Math.min(1, this.intro + dt / 2.15);
    const introEase = 1 - Math.pow(1 - this.intro, 3);

    const mood = MOODS[this.moodName];
    this.scroll = THREE.MathUtils.damp(this.scroll, this.scrollTarget, this.reduce ? 8 : 3.1, dt);
    const hueBefore = this.hue;
    this.hue = dampHue(this.hue, mood.hue, 2.2, dt);
    this.spread = THREE.MathUtils.damp(this.spread, mood.spread, 2.2, dt);
    this.sat = THREE.MathUtils.damp(this.sat, mood.sat, 2.2, dt);
    this.light = THREE.MathUtils.damp(this.light, mood.light, 2.2, dt);
    if (
      this.forcePaint ||
      Math.abs(hueBefore - this.hue) > 0.0004 ||
      Math.abs(this.spread - mood.spread) > 0.004 ||
      Math.abs(this.sat - mood.sat) > 0.004
    ) {
      this.paintOrbs();
      this.forcePaint = false;
    }
    this.spinSpeed = THREE.MathUtils.damp(this.spinSpeed, this.reduce ? 0.01 : mood.spin, 1.6, dt);
    this.spin += dt * this.spinSpeed;
    this.radius = THREE.MathUtils.damp(this.radius, this.radiusTarget, 6, dt);
    this.burstAmt = THREE.MathUtils.damp(this.burstAmt, 0, 2.4, dt);
    this.flash = THREE.MathUtils.damp(this.flash, 0, 2.8, dt);
    this.shake = THREE.MathUtils.damp(this.shake, 0, 5.5, dt);
    this.chroma = THREE.MathUtils.damp(this.chroma, 0.0007 + this.scroll * 0.0011, 3, dt);

    const skyLerp = 1 - Math.exp(-dt * 1.8);
    this.skyMat.uniforms.uColorA.value.lerp(this.moodColors.skyA, skyLerp);
    this.skyMat.uniforms.uColorB.value.lerp(this.moodColors.skyB, skyLerp);
    this.skyMat.uniforms.uColorC.value.lerp(this.moodColors.skyC, skyLerp);
    this.skyMat.uniforms.uColorD.value.lerp(this.moodColors.skyD, skyLerp);
    this.orbMat.uniforms.uFogColor.value.lerp(this.moodColors.fog, skyLerp);
    this.renderer.setClearColor(this.orbMat.uniforms.uFogColor.value, 1);

    this.core.material.color.lerp(this.moodColors.core, skyLerp);
    this.core.material.emissive.lerp(this.moodColors.emissive, skyLerp);
    this.core.material.attenuationColor.copy(this.core.material.color);
    this.halo.material.color.lerp(this.moodColors.core, skyLerp);
    for (const gate of this.gates) {
      gate.material.color.lerp(this.moodColors.gate, skyLerp);
    }

    const beat = this.reduce ? 0.15 : 0.5 + 0.5 * Math.sin(this.time * 2.15);
    const pulse = Math.max(beat * 0.45, energy * 1.6);
    const coreScale = 1 + pulse * 0.05 + this.scroll * 0.06;
    this.core.scale.setScalar(coreScale);
    this.core.rotation.y += dt * (this.reduce ? 0.05 : 0.18);
    this.core.rotation.x = Math.sin(this.time * 0.3) * 0.12;
    this.halo.scale.setScalar(7.4 + pulse * 1.5 + this.scroll * 1.3);

    const introZ = THREE.MathUtils.lerp(13.2, CAM_START, introEase);
    const travel = easeInOut(this.scroll);
    const targetZ = THREE.MathUtils.lerp(introZ, CAM_END, travel);
    const sway = this.reduce ? 0 : Math.sin(this.time * 0.21) * 0.12;
    this.camX = THREE.MathUtils.damp(this.camX, this.pointer.x * 0.85 + sway, 2.6, dt);
    this.camY = THREE.MathUtils.damp(this.camY, this.pointer.y * 0.5 + 0.12, 2.6, dt);
    this.camZ = THREE.MathUtils.damp(this.camZ, targetZ, this.reduce ? 7 : 2.5, dt);
    const shakeX = Math.sin(this.time * 46) * this.shake * 0.055;
    const shakeY = Math.cos(this.time * 51) * this.shake * 0.04;
    this.camera.position.set(this.camX + shakeX, this.camY + shakeY, this.camZ);
    this.roll = THREE.MathUtils.damp(this.roll, this.reduce ? 0 : this.pointer.x * -0.07, 2.4, dt);
    this.camera.lookAt(0, 0, this.camZ - 13);
    this.camera.rotateZ(this.roll);
    this.camera.updateMatrixWorld();

    this.updatePointerWorld();
    this.pointerSprite.position.copy(this.pointerWorld);
    const glow = this.radiusTarget > 0.2 ? 0.85 : 0;
    this.pointerSprite.material.opacity = THREE.MathUtils.damp(this.pointerSprite.material.opacity, glow, 8, dt);

    for (const group of this.groups) {
      group.mesh.rotation.z = this.spin * group.dir;
    }
    if (!this.reduce) this.sky.rotation.y = this.time * 0.012;

    for (const gate of this.gates) {
      gate.rotation.z += dt * gate.userData.speed * (this.reduce ? 0.2 : 1);
    }

    this.orbMat.uniforms.uTime.value = this.time;
    this.orbMat.uniforms.uIntro.value = introEase;
    this.orbMat.uniforms.uRadius.value = this.radius;
    this.orbMat.uniforms.uBurstAmt.value = this.burstAmt;
    this.skyMat.uniforms.uTime.value = this.reduce ? 0 : this.time;
    this.sparkMat.uniforms.uTime.value = this.time;

    this.updateBursts(dt);
    this.updateRings(dt);

    const bloomTarget = mood.bloom + this.scroll * 0.15 + this.flash * 0.55 + energy * 0.25;
    this.bloom.strength = THREE.MathUtils.damp(this.bloom.strength, bloomTarget, 3, dt);
    this.renderer.toneMappingExposure = 1.05 + this.flash * 0.28 + pulse * 0.04;
    this.finish.uniforms.uAmount.value = this.chroma;
    this.finish.uniforms.uTime.value = this.time;

    this.composer.render();
  }

  updateBursts(dt) {
    let dirty = false;
    for (let i = 0; i < this.burstMax; i++) {
      if (this.bLife[i] <= 0) continue;
      dirty = true;
      this.bLife[i] -= dt / this.bMaxLife[i];
      if (this.bLife[i] <= 0) {
        this.bLife[i] = 0;
        this.bCol[i * 3] = 0;
        this.bCol[i * 3 + 1] = 0;
        this.bCol[i * 3 + 2] = 0;
        continue;
      }
      this.bVel[i * 3 + 1] -= dt * 0.35;
      this.bPos[i * 3] += this.bVel[i * 3] * dt;
      this.bPos[i * 3 + 1] += this.bVel[i * 3 + 1] * dt;
      this.bPos[i * 3 + 2] += this.bVel[i * 3 + 2] * dt;
      const fade = this.bLife[i] * this.bLife[i];
      this.bCol[i * 3] = this.bBase[i * 3] * (0.35 + fade);
      this.bCol[i * 3 + 1] = this.bBase[i * 3 + 1] * (0.35 + fade);
      this.bCol[i * 3 + 2] = this.bBase[i * 3 + 2] * (0.35 + fade);
    }
    if (!dirty) return;
    const attrs = this.burstPoints.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.color.needsUpdate = true;
    attrs.aLife.needsUpdate = true;
  }

  updateRings(dt) {
    for (const ring of this.rings) {
      if (ring.userData.life <= 0 && ring.userData.age >= 0 && !ring.visible) continue;
      ring.userData.age += dt;
      if (ring.userData.age < 0) continue;
      ring.visible = true;
      ring.userData.life -= dt / 0.9;
      const life = Math.max(ring.userData.life, 0);
      const grow = 1 - life;
      ring.scale.setScalar(0.2 + grow * 5.4);
      ring.material.opacity = life * life;
      ring.lookAt(this.camera.position);
      if (life <= 0) {
        ring.visible = false;
        ring.userData.age = 0;
      }
    }
  }

  dispose() {
    this.composer?.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}

function dampHue(current, target, lambda, dt) {
  let delta = target - current;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  const next = current + delta * (1 - Math.exp(-lambda * dt));
  return (next + 1) % 1;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function randomUnit() {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, z };
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.75)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
