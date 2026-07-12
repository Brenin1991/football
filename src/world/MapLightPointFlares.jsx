import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";
import { GAME_CONFIG } from "../config";

const _camQ = new Quaternion();
const _parentQ = new Quaternion();
const _poleWorld = new Vector3();

function readFlareConfig() {
  return GAME_CONFIG.world?.lightPointFlares ?? {};
}

function parseColor(hex, fallback) {
  try {
    return new Color(hex ?? fallback);
  } catch {
    return new Color(fallback);
  }
}

const VOL_CONE_VERT = `
uniform float uHeight;
varying vec3 vLocal;
varying float vAlong;

void main() {
  vLocal = position;
  vAlong = clamp((0.5 * uHeight - position.y) / max(uHeight, 1e-4), 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VOL_CONE_FRAG = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uHeightFalloff;
uniform float uNoiseScale;
uniform float uNoiseScroll;
uniform float uBaseRadius;
uniform float uHeight;
uniform float uTime;

varying vec3 vLocal;
varying float vAlong;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float maxR = max(0.001, uBaseRadius * vAlong);
  float d = length(vLocal.xz);
  float radial = 1.0 - smoothstep(maxR * 0.68, maxR * 1.06, d);
  radial = pow(max(radial, 0.0), 1.28);
  float vertical = pow(1.0 - vAlong * 0.28, uHeightFalloff) * (1.0 - vAlong * 0.1);
  vec3 q = vLocal * uNoiseScale + vec3(0.0, uTime * uNoiseScroll, uTime * 0.11);
  float n = hash31(floor(q * 3.7)) * 0.55 + hash31(floor(q * 1.9)) * 0.45;
  float dust = 0.68 + 0.32 * n;
  float intensity = radial * vertical * uStrength * dust;
  if (intensity < 0.008) discard;
  gl_FragColor = vec4(uColor * intensity, 1.0);
}
`;

function applyPoleDistanceFactor(kit, factor, flareEnabled) {
  const f = MathUtils.clamp(factor, 0, 1);

  if (kit.pointLight) {
    kit.pointLight.visible = f > 0.001;
    kit.pointLight.intensity = (kit._tpBasePointIntensity ?? 0) * f;
  }
  if (kit.spotLight) {
    const on = f > 0.001;
    kit.spotLight.visible = on;
    kit.spotLight.intensity = (kit._tpBaseSpotIntensity ?? 0) * f;
    if (kit.spotLight.castShadow) {
      kit.spotLight.castShadow = on;
    }
  }
  if (kit.flareMesh?.material) {
    if (flareEnabled === false) {
      kit.flareMesh.visible = false;
    } else {
      kit.flareMesh.visible = f > 0.001;
      kit.flareMesh.material.opacity = (kit._tpBaseFlareOpacity ?? 1) * f;
    }
  }
  if (kit.volCone?.material?.uniforms?.uStrength) {
    kit.volCone.visible = f > 0.001;
    kit.volCone.material.uniforms.uStrength.value = (kit._tpBaseVolStrength ?? 1) * f;
  }
}

const MapLightPointFlaresInner = memo(function MapLightPointFlaresInner({
  mapScene,
  worldAnchorRef,
  daylight = 1,
  daylightRef = null,
}) {
  const meshesRef = useRef([]);
  const polesRef = useRef([]);
  const sharedFlareGeoRef = useRef(null);
  const sharedVolGeoRef = useRef(null);
  /** Flares visíveis (curto) — billboard só percorre isto com culling activo. */
  const billboardFlaresRef = useRef([]);
  const sortScratchRef = useRef([]);

  const cfg = readFlareConfig();
  const path =
    typeof cfg.texturePath === "string" && cfg.texturePath.trim().length > 0
      ? cfg.texturePath.trim()
      : "/textures/light_glow.png";

  const [flareTex, setFlareTex] = useState(null);
  const loadedTexRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();
    loader.load(
      path,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        if (cancelled) {
          texture.dispose();
          return;
        }
        loadedTexRef.current = texture;
        setFlareTex(texture);
      },
      undefined,
      () => {
        if (!cancelled) setFlareTex(null);
      }
    );
    return () => {
      cancelled = true;
      if (loadedTexRef.current) {
        loadedTexRef.current.dispose();
        loadedTexRef.current = null;
      }
      setFlareTex(null);
    };
  }, [path]);

  /**
   * Uma passagem no mapa: luzes reais + cones volumétricos. Não depende da textura do flare
   * (evita recriar luzes quando a textura chega).
   */
  useLayoutEffect(() => {
    if (!mapScene) return;
    const cfg = readFlareConfig();
    const needle = String(cfg.nodeNameIncludes ?? "light_point").toLowerCase();
    /** `usePointLight` tem prioridade: omni costuma ser mais barata que spot no acumulador de luzes. */
    const plCfg = cfg.pointLight ?? {};
    const usePoint = cfg.usePointLight === true && plCfg.enabled !== false;
    const useSpot = cfg.useRealSpots === true && (cfg.spotLight?.enabled !== false) && !usePoint;

    const slCfg = cfg.spotLight ?? {};
    const spotEnabled = useSpot;

    const plColor = parseColor(plCfg.color, "#ffd9b0");
    const plIntensity = typeof plCfg.intensity === "number" ? plCfg.intensity : 14;
    const plDistance = typeof plCfg.distance === "number" ? plCfg.distance : 14;
    const plDecay = typeof plCfg.decay === "number" ? plCfg.decay : 2;

    const slColor = parseColor(slCfg.color, "#ffedd0");
    const slIntensity = typeof slCfg.intensity === "number" ? slCfg.intensity : 42;
    const slDistance = typeof slCfg.distance === "number" ? slCfg.distance : 22;
    const slAngle = typeof slCfg.angle === "number" ? slCfg.angle : 0.32;
    const slPenumbra = typeof slCfg.penumbra === "number" ? slCfg.penumbra : 0.38;
    const slDecay = typeof slCfg.decay === "number" ? slCfg.decay : 2;
    const slCastShadow = slCfg.castShadow === true;
    const slShadowMap = typeof slCfg.shadowMapSize === "number" ? slCfg.shadowMapSize : 512;
    const slShadowRadius = typeof slCfg.shadowRadius === "number" ? Math.max(0, slCfg.shadowRadius) : 2.5;
    const slShadowFocus = typeof slCfg.shadowFocus === "number" ? MathUtils.clamp(slCfg.shadowFocus, 0.35, 1) : 0.92;
    const slShadowCamNear =
      typeof slCfg.shadowCameraNear === "number" && slCfg.shadowCameraNear > 0 ? slCfg.shadowCameraNear : 0.28;
    /** Mapa escalado (ex. mapModelScale 5) exige bias maior; senão sombra some ou vira “serrilhado” invisível. */
    const mapScale = MathUtils.clamp(Number(GAME_CONFIG.world?.mapModelScale) || 1, 1, 24);
    const shadowBiasScale = Math.sqrt(mapScale);
    const tl = Array.isArray(slCfg.targetLocal) ? slCfg.targetLocal : [0, -16, 0];
    const tlx = Number(tl[0]) || 0;
    const tly = Number(tl[1]) || -16;
    const tlz = Number(tl[2]) || 0;

    const poleRows = [];
    mapScene.updateMatrixWorld(true);
    mapScene.traverse((node) => {
      if (!node || typeof node.add !== "function") return;
      const nm = String(node.name ?? "").toLowerCase();
      if (!nm.includes(needle)) return;

      let kit = node.userData.__tpStreetLightKit;
      if (!kit) {
        kit = {};
        node.userData.__tpStreetLightKit = kit;
      }

      if (usePoint && !kit.pointLight) {
        const p = new PointLight(plColor, plIntensity, plDistance, plDecay);
        p.name = "tp_pole_point";
        p.userData.__tpStreetLightPart = true;
        node.add(p);
        kit.pointLight = p;
        kit._tpBasePointIntensity = plIntensity;
      }

      if (spotEnabled && !kit.spotLight) {
        const spot = new SpotLight(slColor, slIntensity, slDistance, slAngle, slPenumbra, slDecay);
        spot.name = "tp_pole_spot";
        spot.userData.__tpStreetLightPart = true;
        spot.position.set(0, 0, 0);
        if (slCastShadow) {
          spot.castShadow = true;
          spot.shadow.autoUpdate = true;
          spot.shadow.mapSize.setScalar(slShadowMap);
          const baseBias = typeof slCfg.shadowBias === "number" ? slCfg.shadowBias : -0.00025;
          const baseN = typeof slCfg.shadowNormalBias === "number" ? slCfg.shadowNormalBias : 0.045;
          spot.shadow.bias = baseBias * shadowBiasScale;
          spot.shadow.normalBias = baseN * shadowBiasScale;
          spot.shadow.radius = slShadowRadius;
          spot.shadow.focus = slShadowFocus;
          spot.shadow.camera.near = slShadowCamNear;
          spot.shadow.needsUpdate = true;
        }
        const target = new Object3D();
        target.name = "tp_pole_spot_target";
        target.userData.__tpStreetLightPart = true;
        target.position.set(tlx, tly, tlz);
        node.add(spot);
        node.add(target);
        spot.target = target;
        kit.spotLight = spot;
        kit.spotTarget = target;
        kit._tpBaseSpotIntensity = slIntensity;
      }

      if (!kit._tpPoleRowRegistered && (kit.pointLight || kit.spotLight)) {
        kit._tpPoleRowRegistered = true;
        poleRows.push({ node, kit });
      }

      const vcfg = cfg.volumetric ?? {};
      if (vcfg.enabled !== false && (kit.pointLight || kit.spotLight) && !kit.volCone) {
        const H = typeof vcfg.length === "number" && vcfg.length > 0 ? vcfg.length : 18;
        const R = typeof vcfg.radius === "number" && vcfg.radius > 0 ? vcfg.radius : 4.5;
        const radSeg = typeof vcfg.radialSegments === "number" ? Math.max(3, Math.floor(vcfg.radialSegments)) : 16;
        const hSeg = typeof vcfg.heightSegments === "number" ? Math.max(1, Math.floor(vcfg.heightSegments)) : 8;
        const baseStrength = typeof vcfg.strength === "number" && Number.isFinite(vcfg.strength) ? vcfg.strength : 0.35;
        const heightFalloff =
          typeof vcfg.heightFalloff === "number" && Number.isFinite(vcfg.heightFalloff)
            ? Math.max(0.1, vcfg.heightFalloff)
            : 2.2;
        const noiseScale =
          typeof vcfg.noiseScale === "number" && Number.isFinite(vcfg.noiseScale) ? Math.max(0.01, vcfg.noiseScale) : 1.8;
        const noiseScroll =
          typeof vcfg.noiseScroll === "number" && Number.isFinite(vcfg.noiseScroll) ? vcfg.noiseScroll : 0.2;
        const vDepthTest = vcfg.depthTest !== false;
        const ignoreFog = vcfg.ignoreSceneFog !== false;
        const renderOrder = typeof vcfg.renderOrder === "number" ? Math.floor(vcfg.renderOrder) : 12;

        const beamColor = parseColor(
          typeof plCfg.color === "string" && plCfg.color.length > 0 ? plCfg.color : cfg.color,
          "#ffd9b0"
        );

        if (!sharedVolGeoRef.current) {
          sharedVolGeoRef.current = new ConeGeometry(R, H, radSeg, hSeg);
        }

        const mat = new ShaderMaterial({
          uniforms: {
            uHeight: { value: H },
            uBaseRadius: { value: R },
            uColor: { value: new Vector3(beamColor.r, beamColor.g, beamColor.b) },
            uStrength: { value: baseStrength },
            uHeightFalloff: { value: heightFalloff },
            uNoiseScale: { value: noiseScale },
            uNoiseScroll: { value: noiseScroll },
            uTime: { value: 0 },
          },
          vertexShader: VOL_CONE_VERT,
          fragmentShader: VOL_CONE_FRAG,
          transparent: true,
          depthWrite: false,
          depthTest: vDepthTest,
          blending: AdditiveBlending,
          side: DoubleSide,
          fog: !ignoreFog,
        });
        mat.userData.skipGraphicsPatches = true;
        const mesh = new Mesh(sharedVolGeoRef.current, mat);
        mesh.name = "tp_light_volumetric_cone";
        mesh.userData.__tpStreetLightPart = true;
        mesh.frustumCulled = true;
        mesh.renderOrder = renderOrder;
        mesh.position.set(0, -H * 0.5, 0);
        node.add(mesh);
        kit.volCone = mesh;
        kit._tpBaseVolStrength = baseStrength;
      }
    });
    polesRef.current = poleRows;

    return () => {
      mapScene.traverse((node) => {
        const kit = node.userData.__tpStreetLightKit;
        if (!kit) return;

        if (kit.pointLight) {
          node.remove(kit.pointLight);
          kit.pointLight = null;
        }
        if (kit.spotLight) {
          kit.spotLight.target = null;
          node.remove(kit.spotLight);
          kit.spotLight = null;
        }
        if (kit.spotTarget) {
          node.remove(kit.spotTarget);
          kit.spotTarget = null;
        }
        if (kit.volCone) {
          node.remove(kit.volCone);
          const vm = kit.volCone.material;
          if (vm) vm.dispose();
          kit.volCone = null;
        }
        kit._tpBasePointIntensity = undefined;
        kit._tpBaseSpotIntensity = undefined;
        kit._tpBaseVolStrength = undefined;
        kit._tpPoleRowRegistered = false;
        if (!kit.flareMesh) {
          delete node.userData.__tpStreetLightKit;
        }
      });
      polesRef.current = [];
      if (sharedVolGeoRef.current) {
        sharedVolGeoRef.current.dispose();
        sharedVolGeoRef.current = null;
      }
    };
  }, [mapScene]);

  /**
   * Flares: criar uma vez por mapa (shell sem textura), só ligar `map` / opacidade quando `flareTex` chega.
   * Nunca remove meshes ao mudar só a textura (evita hitch).
   */
  useLayoutEffect(() => {
    if (!mapScene) return undefined;

    const cfg = readFlareConfig();
    const flareEnabled = cfg.flare?.enabled !== false;
    const needle = String(cfg.nodeNameIncludes ?? "light_point").toLowerCase();
    const scale = typeof cfg.billboardScale === "number" && cfg.billboardScale > 0 ? cfg.billboardScale : 2.4;
    const opacity = typeof cfg.opacity === "number" && Number.isFinite(cfg.opacity) ? cfg.opacity : 1;
    const depthTest = cfg.depthTest !== false;
    const toneMapped = cfg.toneMapped !== false;
    const ignoreSceneFog = cfg.ignoreSceneFog !== false;

    if (!sharedFlareGeoRef.current) {
      sharedFlareGeoRef.current = new PlaneGeometry(scale, scale);
    }
    const sharedFlareGeo = sharedFlareGeoRef.current;

    const flareMeshes = [];

    mapScene.updateMatrixWorld(true);
    mapScene.traverse((node) => {
      if (!node || typeof node.add !== "function") return;
      const nm = String(node.name ?? "").toLowerCase();
      if (!nm.includes(needle)) return;

      const kit = node.userData.__tpStreetLightKit;
      if (!kit || (!kit.pointLight && !kit.spotLight)) return;

      if (!flareEnabled) {
        if (kit.flareMesh) {
          kit.flareMesh.visible = false;
          if (kit.flareMesh.material) {
            kit.flareMesh.material.opacity = 0;
          }
        }
        return;
      }

      if (!kit.flareMesh) {
        const mat = new MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest,
          blending: AdditiveBlending,
          toneMapped,
          fog: !ignoreSceneFog,
        });
        mat.userData.skipGraphicsPatches = true;
        if (typeof cfg.color === "string" && cfg.color.length > 0) {
          mat.color = new Color(cfg.color);
        }
        const mesh = new Mesh(sharedFlareGeo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 990;
        mesh.name = "tp_light_flare";
        mesh.userData.__tpLightFlare = true;
        mesh.userData.__tpStreetLightPart = true;
        mesh.visible = false;
        node.add(mesh);
        kit.flareMesh = mesh;
        kit._tpBaseFlareOpacity = opacity;
      }

      const mat = kit.flareMesh.material;
      if (flareTex) {
        if (mat.map !== flareTex) {
          mat.map = flareTex;
          mat.needsUpdate = true;
        }
        kit._tpBaseFlareOpacity = opacity;
        mat.opacity = opacity;
      } else {
        mat.map = null;
        mat.opacity = 0;
        mat.needsUpdate = true;
        kit.flareMesh.visible = false;
      }

      flareMeshes.push(kit.flareMesh);
    });

    meshesRef.current = flareMeshes;
    billboardFlaresRef.current = flareMeshes;

    return () => {
      mapScene.traverse((node) => {
        const kit = node.userData.__tpStreetLightKit;
        if (!kit?.flareMesh) return;
        node.remove(kit.flareMesh);
        const mat = kit.flareMesh.material;
        if (mat) {
          mat.map = null;
          mat.dispose();
        }
        kit.flareMesh = null;
        kit._tpBaseFlareOpacity = undefined;
        if (!kit.pointLight && !kit.spotLight && !kit.volCone) {
          delete node.userData.__tpStreetLightKit;
        }
      });
      meshesRef.current = [];
      billboardFlaresRef.current = [];
      if (sharedFlareGeoRef.current) {
        sharedFlareGeoRef.current.dispose();
        sharedFlareGeoRef.current = null;
      }
    };
  }, [mapScene, flareTex, path]);

  const cullAccumRef = useRef(1e9);
  const hadDistanceCullRef = useRef(false);
  const volTimeRef = useRef(0);

  useFrame(({ camera }, delta) => {
    const poles = polesRef.current;
    volTimeRef.current += delta;
    const volT = volTimeRef.current;
    for (let vi = 0; vi < poles.length; vi++) {
      const cone = poles[vi].kit?.volCone;
      const u = cone?.material?.uniforms?.uTime;
      if (u) u.value = volT;
    }

    const cfg = readFlareConfig();
    const flareEnabled = cfg.flare?.enabled !== false;
    const daylightOffThresholdRaw = cfg.daylightOffThreshold;
    const daylightFadeRangeRaw = cfg.daylightFadeRange;
    const daylightOffThreshold =
      typeof daylightOffThresholdRaw === "number" && Number.isFinite(daylightOffThresholdRaw)
        ? MathUtils.clamp(daylightOffThresholdRaw, 0, 1)
        : 0.22;
    const daylightFadeRange =
      typeof daylightFadeRangeRaw === "number" && Number.isFinite(daylightFadeRangeRaw) && daylightFadeRangeRaw > 0
        ? Math.min(1, daylightFadeRangeRaw)
        : 0.08;
    const nightStart = Math.max(0, daylightOffThreshold - daylightFadeRange);
    const daylightNow = typeof daylightRef?.current === "number" ? daylightRef.current : daylight;
    const nightLightFactor = MathUtils.clamp(
      (daylightOffThreshold - daylightNow) / Math.max(1e-4, daylightOffThreshold - nightStart),
      0,
      1
    );

    const dc = cfg.distanceCulling ?? {};
    const cullOn = dc.enabled !== false && worldAnchorRef?.current;
    const allFlares = meshesRef.current;

    if (poles.length === 0) {
      return;
    }

    if (!cullOn) {
      hadDistanceCullRef.current = false;
      const bill = billboardFlaresRef.current;
      bill.length = 0;
      for (let i = 0; i < poles.length; i++) {
        const kit = poles[i].kit;
        applyPoleDistanceFactor(kit, nightLightFactor, flareEnabled);
        if (kit.flareMesh?.visible) {
          bill.push(kit.flareMesh);
        }
      }
    } else {
      const hz = typeof dc.updateHz === "number" && dc.updateHz > 0 ? dc.updateHz : 4;
      cullAccumRef.current += delta;
      if (cullAccumRef.current >= 1 / hz) {
        cullAccumRef.current = 0;

        const store = worldAnchorRef.current;
        if (!store?.valid) {
          hadDistanceCullRef.current = false;
          const bill = billboardFlaresRef.current;
          bill.length = 0;
          for (let i = 0; i < poles.length; i++) {
            const kit = poles[i].kit;
            applyPoleDistanceFactor(kit, nightLightFactor, flareEnabled);
            if (kit.flareMesh?.visible) {
              bill.push(kit.flareMesh);
            }
          }
        } else {
          hadDistanceCullRef.current = true;
          const maxD = typeof dc.maxDistance === "number" && dc.maxDistance > 0 ? dc.maxDistance : 42;
          const fadeRaw = dc.fadeStartDistance;
          const fadeStart =
            typeof fadeRaw === "number" && Number.isFinite(fadeRaw)
              ? Math.min(fadeRaw, maxD - 1e-3)
              : maxD * 0.58;
          const fadeSpan = Math.max(1e-3, maxD - fadeStart);

          const capRaw = dc.maxSimultaneousSpots;
          let cap;
          if (typeof capRaw === "number" && capRaw === 0) {
            cap = Infinity;
          } else if (typeof capRaw === "number" && capRaw > 0) {
            cap = Math.floor(capRaw);
          } else {
            cap = cfg.useRealSpots === true || cfg.usePointLight === true ? 3 : 8;
          }

          const px = store.x;
          const py = store.y;
          const pz = store.z;

          const scratch = sortScratchRef.current;
          scratch.length = 0;
          for (let i = 0; i < poles.length; i++) {
            const { node, kit } = poles[i];
            node.getWorldPosition(_poleWorld);
            const dx = _poleWorld.x - px;
            const dy = _poleWorld.y - py;
            const dz = _poleWorld.z - pz;
            const dist = Math.hypot(dx, dy, dz);
            let factor = 1;
            if (dist >= maxD) {
              factor = 0;
            } else if (dist > fadeStart) {
              factor = (maxD - dist) / fadeSpan;
            }
            scratch.push({ dist, kit, factor });
          }
          scratch.sort((a, b) => a.dist - b.dist);

          const bill = billboardFlaresRef.current;
          bill.length = 0;

          for (let j = 0; j < scratch.length; j++) {
            const { kit, factor: distFactor } = scratch[j];
            let f = distFactor * nightLightFactor;
            if (Number.isFinite(cap) && j >= cap) {
              f = 0;
            }
            applyPoleDistanceFactor(kit, f, flareEnabled);
            if (kit.flareMesh?.visible) {
              bill.push(kit.flareMesh);
            }
          }
        }
      }
    }

    const list = billboardFlaresRef.current.length > 0 ? billboardFlaresRef.current : allFlares;
    camera.getWorldQuaternion(_camQ);
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh.visible) continue;
      const parent = mesh.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_parentQ);
      mesh.quaternion.copy(_parentQ).invert().multiply(_camQ);
    }
  });

  return null;
});

/**
 * Postes `light_point`: `PointLight` (`usePointLight`) ou `SpotLight` (`useRealSpots`, sem point),
 * flare opcional, culling + teto `maxSimultaneousSpots`.
 */
export function MapLightPointFlares({ mapScene, worldAnchorRef, daylight = 1, daylightRef = null }) {
  const enabled = GAME_CONFIG.world?.lightPointFlares?.enabled !== false;
  if (!enabled || !mapScene) return null;
  return (
    <MapLightPointFlaresInner
      mapScene={mapScene}
      worldAnchorRef={worldAnchorRef}
      daylight={daylight}
      daylightRef={daylightRef}
    />
  );
}
