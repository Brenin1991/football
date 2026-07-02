import * as THREE from 'three';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

import Stats from 'stats.js';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { ColorCorrectionShader } from 'three/examples/jsm/shaders/ColorCorrectionShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';

import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import * as CANNON from 'cannon-es';
import { World, Body, Box, Sphere, Vec3 } from 'cannon-es'; // Cannon.js

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Variáveis globais do engine
let scene, camera, editorCamera, renderer, editorRenderer, composer, renderPass, fxaaPass, listener, world, clock, delta, canvas, editorCanvas;
let gameStartFunction = null; // Variável para armazenar o callback do gameStart
let gameLoopFunction = null; // Variável para armazenar o callback do gameLoop

let editorGameStartFunction = null; // Variável para armazenar o callback do gameStart
let editorGameLoopFunction = null; // Variável para armazenar o callback do gameLoop
const modelLoader = new GLTFLoader();
const keysPressed = {}; // Armazena o estado das teclas pressionadas

// Sistema de colisões
let collisionCallbacks = new Map(); // Callbacks de colisão por objeto
let collisionGroups = new Map(); // Grupos de colisão
let collisionMaterials = new Map(); // Materiais de colisão
let collisionContacts = new Set(); // Contatos ativos para evitar duplicatas
let collisionDebugMode = false; // Modo debug para visualizar colisões

// Controles de visibilidade para câmera de jogo
let showGizmos = false; // Controla visibilidade dos gizmos (desativado por padrão para jogo)
let showHelpers = false; // Controla visibilidade dos helpers (desativado por padrão para jogo)
let showColliders = false; // Controla visibilidade dos colisores (desativado por padrão para jogo)
let showWireframes = false; // Controla visibilidade dos wireframes (desativado por padrão para jogo)

// Criação do Stats.js
const stats = new Stats();
stats.showPanel(0); // 0: FPS, 1: ms, 2: memória
document.body.appendChild(stats.dom);

// loaders
const rgbeLoader = new RGBELoader();
const audioLoader = new THREE.AudioLoader();

const fileSystem = {
  models: "./assets/models",
  sounds: "./assets/sounds",
  texture: "./assets/textures",
  scripts: "./scripts",
};

let timeMulti = 1;

let sceneObjects = [];
let prefabs = [];
let psxShaderMaterials = []; // Lista para rastrear materiais com shaders PSX

let transformControls, gizmo;
let selectedObjectGizmo = null; // Gizmo para o objeto selecionado
let gizmoMode = 'translate'; // 'translate', 'rotate', 'scale'

let currentCamera = null;

// Instâncias globais para Environment e PostProcessing
let globalPostProcessing = null;
let currentEnvironment = null;

// Sistema de materiais pré-definidos
const MaterialPresets = {
  // Metais
  metal: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 1.0,
      roughness: 0.1,
      color: 0xffffff, // Branco (será substituído pela cor original se existir)
      envMapIntensity: 1.0
    }
  },

  chrome: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 1.0,
      roughness: 0.0,
      color: 0xffffff, // Branco
      envMapIntensity: 1.5
    }
  },

  gold: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 1.0,
      roughness: 0.1,
      color: 0xffffff, // Branco (será substituído pela cor original se existir)
      envMapIntensity: 1.2
    }
  },

  silver: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 1.0,
      roughness: 0.05,
      color: 0xffffff, // Branco (será substituído pela cor original se existir)
      envMapIntensity: 1.3
    }
  },

  // Plásticos
  plastic: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.3,
      color: 0xffffff, // Branco
      envMapIntensity: 0.5
    }
  },

  rubber: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.8,
      color: 0xffffff, // Branco (será substituído pela cor original se existir)
      envMapIntensity: 0.2
    }
  },

  // Vidros
  glass: {
    type: 'MeshPhysicalMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.0,
      color: 0xffffff, // Branco
      transparent: true,
      opacity: 0.3,
      ior: 1.5,
      transmission: 0.9,
      thickness: 0.5
    }
  },

  // Emissivos
  emissive: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.5,
      color: 0xffffff, // Branco (será usado para emissão se não houver cor original)
      emissive: 0xffffff, // Branco (será substituído pela cor original se existir)
      emissiveIntensity: 1.0
    }
  },

  neon: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.2,
      color: 0xffffff, // Branco (será usado para emissão se não houver cor original)
      emissive: 0xffffff, // Branco (será substituído pela cor original se existir)
      emissiveIntensity: 2.0
    }
  },

  // Materiais especiais
  hologram: {
    type: 'MeshPhysicalMaterial',
    properties: {
      metalness: 0.0,
      roughness: 0.0,
      color: 0xffffff, // Branco (será usado para emissão se não houver cor original)
      transparent: true,
      opacity: 0.7,
      ior: 1.0,
      transmission: 0.5,
      thickness: 0.1,
      emissive: 0xffffff, // Branco (será substituído pela cor original se existir)
      emissiveIntensity: 0.5
    }
  },

  // Padrão (mantém o material original)
  default: {
    type: 'MeshStandardMaterial',
    properties: {
      metalness: 0.5,
      roughness: 0.5,
      color: 0xffffff, // Branco
      envMapIntensity: 1.0
    }
  }
};

// Função para criar material personalizado
function createCustomMaterial(materialType = 'default', customProperties = {}, originalProperties = {}) {
  const preset = MaterialPresets[materialType] || MaterialPresets.default;
  const materialClass = preset.type === 'MeshPhysicalMaterial' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

  // Hierarquia: Original > Custom > Preset
  const finalProperties = { ...preset.properties, ...customProperties, ...originalProperties };

  // Caso especial para materiais emissivos: se não há cor de emissão definida,
  // mas há uma cor base, use a cor base para a emissão.
  const isEmissiveType = materialType === 'emissive' || materialType === 'neon' || materialType === 'hologram';
  if (isEmissiveType) {
    // Se a propriedade emissive não veio do modelo original nem das propriedades customizadas
    if (!originalProperties.emissive && !customProperties.emissive) {
      finalProperties.emissive = finalProperties.color;
    }
  }

  return new materialClass(finalProperties);
}

// Função para criar material com shader PSX personalizado
function createPSXShaderMaterial(shaderConfig = {}, originalProperties = {}) {
  const {
    name = 'psxShader',
    vertexShader,
    fragmentShader,
    uniforms = {},
    flatShading = true,
    fog = true
  } = shaderConfig;

  // Shader padrão PSX se não for fornecido
  const defaultVertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    uniform float time;

    void main() {
      vUv = uv;
      
      // Simulando o jitter nos vértices (baixa precisão de ponto flutuante)
      vec3 jitteredPosition = position;
      jitteredPosition.xy = floor(jitteredPosition.xy * 10.0) / 10.0;
      
      // Adicionar distorção nos vértices
      jitteredPosition.x += sin(position.y * 10.0 + time * 500.0) * 0.008;
      jitteredPosition.y += cos(position.x * 10.0 + time * 500.0) * 0.008;

      vPosition = (modelViewMatrix * vec4(jitteredPosition, 1.0)).xyz;
      vWorldPosition = (modelMatrix * vec4(jitteredPosition, 1.0)).xyz;
      vNormal = normalize(normalMatrix * normal);
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(jitteredPosition, 1.0);
    }
  `;

  const defaultFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tRoughness;
    uniform sampler2D tMetalness;
    uniform sampler2D tEmissive;
    uniform sampler2D tAO;
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 lightDirection;
    uniform vec3 lightColor;
    uniform vec3 ambientLightColor;
    uniform float time;
    uniform float uColorDepth;
    
    // Propriedades PBR do material original
    uniform float roughness;
    uniform float metalness;
    uniform vec3 emissive;
    uniform float emissiveIntensity;
    uniform float envMapIntensity;
    uniform float transparent;
    uniform float opacity;
    
    const float dither[16] = float[16](
      0.0,  8.0,  2.0, 10.0,
      12.0, 4.0, 14.0,  6.0,
      3.0, 11.0,  1.0,  9.0,
      15.0, 7.0, 13.0,  5.0
    );
    
    void main() {
      // Distorção PSX nas coordenadas UV
      vec2 distortedUV = vUv;
      
      // Adicionar distorção dinâmica (sem reduzir resolução)
      distortedUV.x += sin(vUv.y * 8.0 + time * 5.0) * 0.005;
      distortedUV.y += cos(vUv.x * 8.0 + time * 5.0) * 0.005;

      // Obter texturas PBR
      vec4 baseColor = texture2D(tDiffuse, distortedUV);
      vec3 normal = normalize(vNormal);
      float roughnessValue = texture2D(tRoughness, distortedUV).r;
      float metalnessValue = texture2D(tMetalness, distortedUV).r;
      vec3 emissiveColor = texture2D(tEmissive, distortedUV).rgb;
      float ao = texture2D(tAO, distortedUV).r;
      
      // Aplicar propriedades PBR do material
      roughnessValue = mix(roughnessValue, roughness, 0.5);
      metalnessValue = mix(metalnessValue, metalness, 0.5);
      emissiveColor = mix(emissiveColor, emissive, 0.5) * emissiveIntensity;
      
      // Iluminação PBR simplificada
      vec3 lightDir = normalize(lightDirection);
      float diffuse = max(dot(normal, lightDir), 0.3);
      
      // Calcular iluminação
      vec3 lighting = lightColor * diffuse;
      lighting += ambientLightColor;
      
      // Aplicar AO
      lighting *= ao;
      
      // Cor final com iluminação PBR
      vec3 finalColor = baseColor.rgb * lighting;
      
      // Adicionar emissão
      finalColor += emissiveColor;
      
      // Aplicar dithering PSX
      int x = int(mod(gl_FragCoord.x, 4.0));
      int y = int(mod(gl_FragCoord.y, 4.0));
      int index = x + y * 4;
      
      float threshold = dither[index] / 16.0;
      vec3 ditheredColor = floor(finalColor * uColorDepth + threshold) / uColorDepth;
      
      // Aplicar transparência
      float finalOpacity = mix(baseColor.a, opacity, 0.5);
      if (transparent > 0.0) {
        finalOpacity *= transparent;
      }
      
      // Fog
      float distanceToCamera = length(vPosition);
      float fogFactor = smoothstep(fogNear * 0.6, fogFar, distanceToCamera);
      
      vec4 colorWithDither = vec4(ditheredColor, finalOpacity);
      gl_FragColor = mix(colorWithDither, vec4(fogColor, 1.0), fogFactor);
    }
  `;

  // Usar shaders fornecidos ou padrão
  const finalVertexShader = vertexShader || defaultVertexShader;
  const finalFragmentShader = fragmentShader || defaultFragmentShader;

  // Uniforms padrão PSX
  const defaultUniforms = {
    tDiffuse: { value: originalProperties.map || null },
    tNormal: { value: originalProperties.normalMap || null },
    tRoughness: { value: originalProperties.roughnessMap || null },
    tMetalness: { value: originalProperties.metalnessMap || null },
    tEmissive: { value: originalProperties.emissiveMap || null },
    tAO: { value: originalProperties.aoMap || null },
    uColorDepth: { value: 16.0 },
    fogColor: { value: scene.fog ? scene.fog.color : new THREE.Color(0xffffff) },
    fogNear: { value: scene.fog ? scene.fog.near : 1 },
    fogFar: { value: scene.fog ? scene.fog.far : 1000 },
    lightDirection: { value: new THREE.Vector3(1, 1, 1) },
    lightColor: { value: new THREE.Color(0xffffff) },
    ambientLightColor: { value: new THREE.Color(0x404040) },
    time: { value: 0.0 },
    // Propriedades PBR
    roughness: { value: originalProperties.roughness !== undefined ? originalProperties.roughness : 0.5 },
    metalness: { value: originalProperties.metalness !== undefined ? originalProperties.metalness : 0.0 },
    emissive: { value: originalProperties.emissive || new THREE.Color(0x000000) },
    emissiveIntensity: { value: originalProperties.emissiveIntensity !== undefined ? originalProperties.emissiveIntensity : 1.0 },
    envMapIntensity: { value: originalProperties.envMapIntensity !== undefined ? originalProperties.envMapIntensity : 1.0 },
    transparent: { value: originalProperties.transparent ? 1.0 : 0.0 },
    opacity: { value: originalProperties.opacity !== undefined ? originalProperties.opacity : 1.0 }
  };

  // Combinar uniforms padrão com os fornecidos
  const finalUniforms = { ...defaultUniforms, ...uniforms };

  // Converter valores simples para objetos THREE
  if (finalUniforms.lightDirection && Array.isArray(finalUniforms.lightDirection)) {
    finalUniforms.lightDirection = { value: new THREE.Vector3(...finalUniforms.lightDirection) };
  }
  if (finalUniforms.lightColor && Array.isArray(finalUniforms.lightColor)) {
    finalUniforms.lightColor = { value: new THREE.Color(...finalUniforms.lightColor) };
  }
  if (finalUniforms.ambientLightColor && Array.isArray(finalUniforms.ambientLightColor)) {
    finalUniforms.ambientLightColor = { value: new THREE.Color(...finalUniforms.ambientLightColor) };
  }

  const material = new THREE.ShaderMaterial({
    uniforms: finalUniforms,
    vertexShader: finalVertexShader,
    fragmentShader: finalFragmentShader,
    fog: fog,
    flatShading: flatShading
  });

  // Registrar o material para atualização de tempo
  psxShaderMaterials.push(material);

  return material;
}

// Função para atualizar o tempo nos shaders PSX
function updatePSXShaderTime(time) {
  if (composer && composer.passes) {
    composer.passes.forEach(pass => {
      if (pass.uniforms && pass.uniforms.time) {
        pass.uniforms.time.value = time;
      }
    });
  }
}

// Função para aplicar material baseado no nome do mesh
function applyMaterialByName(node, materialType = 'default', customProperties = {}, originalProperties = {}) {
  const nodeName = node.name.toLowerCase();

  // A detecção automática só ocorre se o tipo de material não for especificado (for 'default')
  let detectedType = materialType;
  if (materialType === 'default') {
    if (nodeName.includes('metal') || nodeName.includes('steel')) {
      detectedType = 'metal';
    } else if (nodeName.includes('chrome')) {
      detectedType = 'chrome';
    } else if (nodeName.includes('gold')) {
      detectedType = 'gold';
    } else if (nodeName.includes('silver')) {
      detectedType = 'silver';
    } else if (nodeName.includes('plastic')) {
      detectedType = 'plastic';
    } else if (nodeName.includes('rubber') || nodeName.includes('tire')) {
      detectedType = 'rubber';
    } else if (nodeName.includes('glass') || nodeName.includes('window')) {
      detectedType = 'glass';
    } else if (nodeName.includes('light') || nodeName.includes('lamp') || nodeName.includes('emissive')) {
      detectedType = 'emissive';
    } else if (nodeName.includes('neon')) {
      detectedType = 'neon';
    } else if (nodeName.includes('hologram')) {
      detectedType = 'hologram';
    }
  }

  // Caso especial para shaders PSX
  if (detectedType === 'psx') {
    return createPSXShaderMaterial(customProperties, originalProperties);
  }

  // Passa todas as propriedades para a função de criação
  return createCustomMaterial(detectedType, customProperties, originalProperties);
}

// Função para extrair propriedades do material original
function extractOriginalProperties(originalMaterial) {
  const properties = {};

  if (originalMaterial) {
    // Extrair texturas
    if (originalMaterial.map) properties.map = originalMaterial.map;
    if (originalMaterial.normalMap) properties.normalMap = originalMaterial.normalMap;
    if (originalMaterial.roughnessMap) properties.roughnessMap = originalMaterial.roughnessMap;
    if (originalMaterial.metalnessMap) properties.metalnessMap = originalMaterial.metalnessMap;
    if (originalMaterial.emissiveMap) properties.emissiveMap = originalMaterial.emissiveMap;
    if (originalMaterial.aoMap) properties.aoMap = originalMaterial.aoMap;
    if (originalMaterial.displacementMap) properties.displacementMap = originalMaterial.displacementMap;

    // Extrair cores (clonando para evitar modificação do original)
    if (originalMaterial.color) properties.color = originalMaterial.color.clone();
    if (originalMaterial.emissive) properties.emissive = originalMaterial.emissive.clone();

    // Extrair propriedades PBR e outras
    const pbrKeys = ['roughness', 'metalness', 'envMapIntensity', 'emissiveIntensity', 'opacity', 'transparent', 'ior', 'transmission', 'thickness'];
    pbrKeys.forEach(key => {
      if (originalMaterial[key] !== undefined && originalMaterial[key] !== null) {
        properties[key] = originalMaterial[key];
      }
    });
  }

  return properties;
}

// Função para aplicar cores padrão apenas quando necessário
function applyDefaultColors(materialType, originalProperties) {
  const defaultColors = {
    metal: 0x888888,      // Cinza metálico
    chrome: 0xffffff,     // Branco
    gold: 0xffd700,       // Dourado
    silver: 0xc0c0c0,     // Prateado
    plastic: 0xffffff,    // Branco
    rubber: 0x333333,     // Cinza escuro
    glass: 0xffffff,      // Branco transparente
    emissive: 0xffffff,   // Branco emissivo
    neon: 0xffffff,       // Branco neon
    hologram: 0xffffff,   // Branco holograma
    default: 0xffffff     // Branco padrão
  };

  // Se não tem cor original, aplicar cor padrão
  if (!originalProperties.color) {
    originalProperties.color = defaultColors[materialType] || defaultColors.default;
  }

  // Para materiais emissivos, se não tem emissão original, usar a cor do material
  if ((materialType === 'emissive' || materialType === 'neon' || materialType === 'hologram') &&
    !originalProperties.emissive) {
    originalProperties.emissive = originalProperties.color;
  }

  return originalProperties;
}

function setUpRenderer() {
  // Cena
  scene = new THREE.Scene();

  // Câmera principal do jogo
  camera = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 1000);
  camera.position.set(0, 3, 7);

  currentCamera = camera;

  /* editorCamera = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 1000);
  editorCamera.position.set(0, 5, 10); // Ajuste conforme necessário */

  canvas = document.getElementById("gameCanvas");
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true, // Suaviza as bordas dos objetos
    stencil: true,
    depth: true,
    powerPreference: "high-performance", // Melhor desempenho gráfico
    alpha: true, // Se necessário para transparência do fundo
    precision: "highp", // Alta precisão nos shaders
    physicallyCorrectLights: true,
    outputEncoding: THREE.ACESFilmicToneMapping,
    logarithmicDepthBuffer: true,
  });

  // Configurar renderer para sombras
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Sombras suaves
  renderer.shadowMap.autoUpdate = true;

  //renderer.setSize(640, 480);
  //renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // renderer.toneMappingExposure = 2;
}

// Inicializa a cena, câmera e renderizador
export function init() {
  setGameStart(null);
  setGameLoop(null);
  setUpRenderer();
  // setUpEditor();

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
  composer.addPass(fxaaPass);

  listener = new THREE.AudioListener();
  camera.add(listener);

  world = new World();
  world.gravity.set(0, -9.82, 0); // Definir gravidade para simular o eixo Y

  // CONFIGURAÇÕES CRÍTICAS PARA EVITAR TUNNELING
  world.solver.iterations = 10; // Mais iterações para melhor estabilidade
  world.solver.tolerance = 0.001; // Tolerância menor para maior precisão

  // Configurar material de contato padrão
  world.defaultContactMaterial = new CANNON.ContactMaterial(
    new CANNON.Material('default'),
    new CANNON.Material('default'),
    {
      friction: 0.3,
      restitution: 0.3,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
      frictionEquationRelaxation: 3
    }
  );


  // Inicializar TransformControls para gizmos
  setupTransformControls();

  // Criar gizmos customizados
  createCustomGizmos();

  // Configurar interações dos gizmos customizados
  setupCustomGizmoInteractions();

  // Configurar HDR padrão para evitar tela preta

  // Adiciona listeners para as teclas
  document.addEventListener('keydown', (event) => {
    keysPressed[event.key.toLowerCase()] = true;

    // Controles de teclado para gizmos
    if (editorMode && transformControls) {
      switch (event.key.toLowerCase()) {
        case 'g':
          setGizmoModeInternal('translate');
          break;
        case 'r':
          setGizmoModeInternal('rotate');
          break;
        case 's':
          setGizmoModeInternal('scale');
          break;
        case 'escape':
          clearGizmoInternal();
          break;
      }
    }

    // ✅ NOVO: Tecla ESC para deselecionar objeto
    if (event.key === 'Escape') {

      if (editorMode && selectedObject) {
        selectObject(null); // Deselecionar objeto

        // Notificar o editor sobre a deseleção
        if (typeof window !== 'undefined' && window.parent) {
          window.parent.postMessage({
            type: 'OBJECT_DESELECTED',
            timestamp: Date.now()
          }, '*');
        }
      }
    }

    // Tecla Delete para deletar objeto selecionado
    if (event.key === 'Delete') {
     

      if (editorMode && selectedObject) {
        
        // Confirmação antes de deletar
        if (confirm(`Tem certeza que deseja deletar o objeto "${selectedObject.name}"?\n\nEsta ação não pode ser desfeita.`)) {
          deleteObjectFromScene(selectedObject.name);
        }
      }
     }
  });

  document.addEventListener('keyup', (event) => {
    keysPressed[event.key.toLowerCase()] = false;
  });
  /* 
    if(gameStartFunction) {
      gameStartFunction(); // Chama o loop do jogo a cada frame
    }
  
    if(editorGameStartFunction) {
      editorGameStartFunction();
    }
   */
  // Variável global para o relógio
  clock = new THREE.Clock();

  function animate() {
    stats.begin();
    delta = clock.getDelta();

    // Atualizar tempo nos shaders PSX
    updatePSXShaderTime(clock.getElapsedTime());

    const panelGameplay = allowPanelGameplay();
    if (!editorMode && panelGameplay && gameLoopFunction) {
      try {
        gameLoopFunction();
        // Atualizar física sempre que houver corpos no mundo
        if (world && world.bodies.length > 0) {
          try {
            // Atualizar a física com um deltaTime fixo e SUBSTEPS para evitar tunneling
            const deltaTime = 1 / 60;
            const substeps = 3; // 3 substeps para maior precisão
            const substepTime = deltaTime / substeps;

            for (let i = 0; i < substeps; i++) {
              world.step(substepTime);
            }

            // Processar colisões ANTES de aplicar constraints
            processCollisions();

            // Aplicar freeze rotation DEPOIS de processar colisões
            // forceFreezeRotation();

            // Sincronizar os objetos Three.js com Cannon.js
            world.bodies.forEach((body) => {
              // Verificar se o corpo e suas propriedades existem
              if (!body || !body.position || !body.quaternion) {
                console.warn('⚠️ Corpo físico inválido encontrado:', body);
                return;
              }

              if (body.threeObject) {
                // Verificar se o objeto Three.js ainda existe
                if (!body.threeObject.position) {
                  console.warn('⚠️ Objeto Three.js inválido para corpo:', body);
                  return;
                }

                try {
                  // Sincronizar posição
                  body.threeObject.position.copy(body.position);

                  // Sincronizar rotação baseado no tipo de objeto
                  if (body.threeObject.fixedRotation) {
                    // Objetos com rotação fixa - manter rotação inicial
                    if (body.threeObject.initialRotation) {
                      body.threeObject.rotation.set(
                        body.threeObject.initialRotation.x,
                        body.threeObject.initialRotation.y,
                        body.threeObject.initialRotation.z
                      );
                    }
                  } else if (body.threeObject.preserveRotation && body.threeObject.initialRotation) {
                    // Objetos que preservam rotação inicial
                    body.threeObject.rotation.set(
                      body.threeObject.initialRotation.x,
                      body.threeObject.initialRotation.y,
                      body.threeObject.initialRotation.z
                    );
                  } else {
                    // Objetos normais - sincronizar com física
                    body.threeObject.quaternion.copy(body.quaternion);
                  }

                  // Atualizar visualização do colisor se existir
                  if (body.threeObject.colliderVisualization && body.threeObject.colliderVisualization.position) {
                    body.threeObject.colliderVisualization.position.copy(body.position);
                    body.threeObject.colliderVisualization.quaternion.copy(body.quaternion);
                  }
                } catch (error) {
                  console.error('❌ Erro ao sincronizar objeto:', body.threeObject.name, error);
                }
              }
            });

            // Aplicar constraints de física DEPOIS da sincronização
            applyPhysicsConstraints();

            
          } catch (error) {
            console.error('Error updating physics:', error);
          }
        }
      } catch (error) {
        console.error('Error in game loop:', error);
      }
    }



    // Escolher qual câmera usar baseado no modo
    if (editorMode && editorGameLoopFunction) {
      editorGameLoopFunction();
    }

    // Enviar informações da cena para o editor periodicamente
    if (editorMode && clock.getElapsedTime() % 2 < delta) { // A cada 2 segundos
      sendSceneInfoToEditor();
    }

    // Limpar outlines órfãos periodicamente (a cada 5 segundos)
    if (editorMode && clock.getElapsedTime() % 5 < delta) {
      cleanupOrphanOutlines();
    }

    // Limpar helpers de luz órfãos periodicamente (a cada 7 segundos)
    if (editorMode && clock.getElapsedTime() % 7 < delta) {
      cleanupOrphanLightHelpers();
    }

    // Limpar corpos físicos órfãos periodicamente (a cada 10 segundos)
    if (clock.getElapsedTime() % 10 < delta) {
      cleanupOrphanPhysicsBodies();
    }

    // Atualizar TransformControls se existir
    if (transformControls) {
      transformControls.update();
    }

    // Exportar para debug global
    if (typeof window !== 'undefined') {
      window.transformControls = transformControls;
      window.selectedObject = selectedObject;
      window.gizmoMode = gizmoMode;
      window.setupTransformControls = setupTransformControls;
      window.attachGizmoToObject = attachGizmoToObjectInternal;
      window.clearGizmo = clearGizmoInternal;
    }

    // Atualizar outlines se houver objeto selecionado
    if (selectedObject && selectedObject.outlineMeshes) {
      updateObjectOutlines(selectedObject);
    }

    // Atualizar tamanho do gizmo baseado na distância da câmera
    if (editorMode) {
      updateGizmoSize();
    }

    // Mixers: no painel embed sem play, não avançar animações de jogo (preview do Inspector continua via timeScale)
    const advanceAnimators = editorMode || panelGameplay || !isEditorPanelEmbed();
    let animatorsUpdated = 0;
    if (advanceAnimators) {
      sceneObjects.forEach(sceneObject => {
        if (sceneObject.animator) {
          sceneObject.animator.update(delta);
          animatorsUpdated++;
        }
        if (sceneObject.gameObject && sceneObject.gameObject.animator) {
          sceneObject.gameObject.animator.update(delta);
          animatorsUpdated++;
        }
      });

      scene.traverse(object => {
        if (object.animator && object.animator.update) {
          object.animator.update(delta);
          animatorsUpdated++;
        }
      });
    }

    

    renderer.render(scene, currentCamera);

    // Renderizar a cena principal com pós-processamento
    renderer.clear();
    composer.render();

    // Limpar o buffer de profundidade e renderizar a cena da UI por cima
    renderer.clearDepth();
    if (uiScene && uiCamera) {
      renderer.render(uiScene, uiCamera);
    }

    stats.end();
    requestAnimationFrame(animate);
  }

  animate();
}

// Função para verificar se uma tecla está pressionada
export function isKeyPressed(key) {
  return keysPressed[key.toLowerCase()] === true;
}

export function saveProject() {
  // Salvamento melhorado com mais dados
  const sceneData = {
    meta: {
      version: '1.0',
      timestamp: new Date().toISOString(),
      engine: 'PSX-Engine'
    },
    scene: null, // Não salvar scene.toJSON() diretamente para evitar gizmos
    objects: [],
    environment: {
      background: scene.background,
      fog: scene.fog ? {
        type: scene.fog.constructor.name,
        color: scene.fog.color,
        near: scene.fog.near,
        far: scene.fog.far,
        density: scene.fog.density
      } : null
    },
    camera: {
      position: camera.position.toArray(),
      rotation: camera.rotation.toArray(),
      fov: camera.fov,
      near: camera.near,
      far: camera.far
    },
    physics: {
      gravity: world ? world.gravity : null,
      bodies: []
    }
  };

  // Salva dados dos objetos PSX (excluindo gizmos)
  sceneObjects.forEach(sceneObject => {
    // Verificar se o objeto deve ser pulado (gizmos, etc.)
    if (shouldSkipObjectExtraction(sceneObject.gameObject)) {
      return; // Pular este objeto
    }

    const objData = {
      id: sceneObject.id,
      name: sceneObject.name,
      type: sceneObject.type,
      transform: {
        position: sceneObject.gameObject.position.toArray(),
        rotation: sceneObject.gameObject.rotation.toArray(),
        scale: sceneObject.gameObject.scale.toArray()
      },
      materials: [],
      physics: null,
      components: Object.keys(sceneObject.components)
    };

    // Salva materiais
    if (sceneObject.gameObject.material) {
      const materials = Array.isArray(sceneObject.gameObject.material)
        ? sceneObject.gameObject.material
        : [sceneObject.gameObject.material];

      materials.forEach(material => {
        objData.materials.push({
          type: material.type,
          color: material.color ? material.color.getHex() : null,
          map: material.map ? (material.map.name || material.map.image?.src?.split('/').pop()) : null,
          normalMap: material.normalMap ? (material.normalMap.name || material.normalMap.image?.src?.split('/').pop()) : null,
          roughnessMap: material.roughnessMap ? (material.roughnessMap.name || material.roughnessMap.image?.src?.split('/').pop()) : null,
          metalnessMap: material.metalnessMap ? (material.metalnessMap.name || material.metalnessMap.image?.src?.split('/').pop()) : null,
          aoMap: material.aoMap ? (material.aoMap.name || material.aoMap.image?.src?.split('/').pop()) : null,
          emissiveMap: material.emissiveMap ? (material.emissiveMap.name || material.emissiveMap.image?.src?.split('/').pop()) : null,
          transparent: material.transparent,
          opacity: material.opacity,
          metalness: material.metalness,
          roughness: material.roughness
        });
      });
    }

    // Salva dados de física
    if (sceneObject.physics) {
      objData.physics = {
        mass: sceneObject.physics.mass,
        type: sceneObject.physics.type,
        shape: sceneObject.physics.shapes ? sceneObject.physics.shapes[0]?.type : null,
        velocity: sceneObject.physics.velocity ? sceneObject.physics.velocity.toArray() : null,
        angularVelocity: sceneObject.physics.angularVelocity ? sceneObject.physics.angularVelocity.toArray() : null
      };
    }

    sceneData.objects.push(objData);
  });

  // Também verificar objetos que podem estar na cena mas não no array sceneObjects
  scene.traverse((object) => {
    // Pular objetos que já foram salvos via sceneObjects
    const alreadySaved = sceneObjects.some(sceneObj => sceneObj.gameObject === object);
    if (alreadySaved) {
      return;
    }

    // Verificar se o objeto deve ser pulado (gizmos, etc.)
    if (shouldSkipObjectExtraction(object)) {
      return;
    }

    // Salvar objetos que não são gizmos e não estão no array sceneObjects
    const objData = {
      id: object.uuid || Date.now().toString(),
      name: object.name || 'unnamed',
      type: object.type || 'Object3D',
      transform: {
        position: object.position.toArray(),
        rotation: object.rotation.toArray(),
        scale: object.scale.toArray()
      },
      materials: [],
      physics: null,
      components: []
    };

    // Salva materiais se for um mesh
    if (object.material) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      materials.forEach(material => {
        objData.materials.push({
          type: material.type,
          color: material.color ? material.color.getHex() : null,
          map: material.map ? (material.map.name || material.map.image?.src?.split('/').pop()) : null,
          normalMap: material.normalMap ? (material.normalMap.name || material.normalMap.image?.src?.split('/').pop()) : null,
          roughnessMap: material.roughnessMap ? (material.roughnessMap.name || material.roughnessMap.image?.src?.split('/').pop()) : null,
          metalnessMap: material.metalnessMap ? (material.metalnessMap.name || material.metalnessMap.image?.src?.split('/').pop()) : null,
          aoMap: material.aoMap ? (material.aoMap.name || material.aoMap.image?.src?.split('/').pop()) : null,
          emissiveMap: material.emissiveMap ? (material.emissiveMap.name || material.emissiveMap.image?.src?.split('/').pop()) : null,
          transparent: material.transparent,
          opacity: material.opacity,
          metalness: material.metalness,
          roughness: material.roughness
        });
      });
    }

    sceneData.objects.push(objData);
  });

  return sceneData;
}

export function loadProject(sceneData) {
  // Verifica se é o formato antigo ou novo
  if (sceneData.object && sceneData.object.type === 'Scene') {
    // Formato antigo - compatibilidade
    const loadedScene = new THREE.ObjectLoader().parse(sceneData);
    if (loadedScene.children.length > 0) {
      loadedScene.children.forEach((child) => {
        const obj = child.clone();
        instantiate(obj, obj.name);
      });
    }
    return;
  }

  // Formato novo - carregamento completo
  if (sceneData.meta && sceneData.scene) {
    // Limpa cena atual
    clearScene();

    // Carrega ambiente
    if (sceneData.environment) {
      if (sceneData.environment.background) {
        scene.background = new THREE.Color(sceneData.environment.background);
      }
      if (sceneData.environment.fog) {
        const fogData = sceneData.environment.fog;
        if (fogData.type === 'Fog') {
          scene.fog = new THREE.Fog(fogData.color, fogData.near, fogData.far);
        } else if (fogData.type === 'FogExp2') {
          scene.fog = new THREE.FogExp2(fogData.color, fogData.density);
        }
      }
    }

    // Carrega câmera
    if (sceneData.camera) {
      const camData = sceneData.camera;
      camera.position.fromArray(camData.position);
      camera.rotation.fromArray(camData.rotation);
      camera.fov = camData.fov;
      camera.near = camData.near;
      camera.far = camData.far;
      camera.updateProjectionMatrix();
    }

    // Carrega objetos
    if (sceneData.objects) {
      sceneData.objects.forEach(objData => {
        loadSceneObject(objData);
      });
    }


    createCustomGizmos();
    setupCustomGizmoInteractions();

    // ✅ SELECIONAR PRIMEIRO OBJETO DISPONÍVEL PARA MOSTRAR GIZMOS (formato antigo)
    if (sceneObjects.length > 0) {
      const firstObject = sceneObjects[0].gameObject;
      if (firstObject) {
        selectObject(firstObject);
      }
    }
  }
}

// Adiciona um modelo à cena
export function instantiate(model, name, type) {
  const newObj = model.clone();
  newObj.name = name;
  let sceneObject = {
    id: newObj.id, // Atribui um ID único
    name: newObj.name,
    gameObject: newObj,
    type: newObj.type,
    animations: [],
    animator: null,
    physics: null,
    components: {}, // Armazena componentes como um objeto

    // Método para acessar o ID
    getGameObjectId: function () {
      return this.id;
    },

    // Método para acessar o nome
    getGameObjectName: function () {
      return this.name;
    },

    // Método para adicionar um componente
    addComponent: function (name, component) {
      if (typeof component === 'function') {
        this.components[name] = component.bind(this);
      }
    },

    // Método para remover um componente
    removeComponent: function (name) {
      if (this.components[name]) {
        delete this.components[name];
      }
    }
  };

  sceneObjects.push(sceneObject);
  scene.add(sceneObject.gameObject);

  return sceneObject;
}

export function findObjectById(id) {
  for (let sceneObject of sceneObjects) {
    if (sceneObject.id === id) {
      return sceneObject; // Retorna o objeto se o ID corresponder
    }
  }
  return null; // Retorna null se nenhum objeto for encontrado
}

// Encontra um objeto na coleção pelo nome
export function findObjectByName(name, callback) {
  for (let sceneObject of sceneObjects) {
    if (sceneObject.name === name) {
      if (callback && typeof callback === 'function') {
        callback(sceneObject); // Chama o callback passando o objeto encontrado
      }
      return sceneObject; // Retorna o objeto se o nome corresponder
    }
  }

  if (callback && typeof callback === 'function') {
    callback(null); // Chama o callback com null se nenhum objeto for encontrado
  }

  return null; // Retorna null se nenhum objeto for encontrado
}

export function findObjectByType(type, callback) {
  for (let sceneObject of sceneObjects) {
    if (sceneObject.type === type) {
      if (callback && typeof callback === 'function') {
        callback(sceneObject); // Chama o callback passando o objeto encontrado
      }
      return sceneObject; // Retorna o objeto se o nome corresponder
    }
  }

  if (callback && typeof callback === 'function') {
    callback(null); // Chama o callback com null se nenhum objeto for encontrado
  }

  return null; // Retorna null se nenhum objeto for encontrado
}


// Remove um modelo da cena
export function destroy(sceneObject) {
  // Verifica se o objeto existe na coleção
  const index = sceneObjects.indexOf(sceneObject);

  if (index !== -1) {
    // Remove o modelo da cena
    scene.remove(sceneObject.gameObject);

    // Remove o objeto da coleção
    sceneObjects.splice(index, 1);

    //// console.log(`${sceneObject.name} foi removido da cena.`);
  } else {
    //// console.log(`${sceneObject.name} não está na cena.`);
  }
}



// Carrega um modelo GLB
export function LoadModelGLB(url, scale, position, rotation, callback, materialType = 'default', customProperties = {}, preserveRotation = false) {
  modelLoader.load(
    fileSystem.models + "/" + url,
    (gltf) => {
      const model = gltf.scene;
      if (model instanceof THREE.Object3D) {
        // Aplicar escala, posição e rotação
        model.scale.set(scale.x, scale.y, scale.z);
        model.position.set(position.x, position.y, position.z);
        model.rotation.set(rotation.x, rotation.y, rotation.z);

        // Armazenar rotação inicial como Euler
        model.initialRotation = new THREE.Euler(rotation.x, rotation.y, rotation.z, 'XYZ');
        model.preserveRotation = preserveRotation;


        // ✅ ADICIONAR: Salvar informações do modelo carregado no userData
        model.userData = {
          ...model.userData,
          isLoadedModel: true,
          modelFile: url,
          originalScale: { x: scale.x, y: scale.y, z: scale.z },
          originalPosition: { x: position.x, y: position.y, z: position.z },
          originalRotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          materialType: materialType,
          customProperties: customProperties,
          preserveRotation: preserveRotation
        };

        

        // Aplicar materiais e propriedades aos meshes
        model.traverse((node) => {
          if (node.isMesh) {
            const originalMaterial = node.material;
            const originalProperties = extractOriginalProperties(originalMaterial);
            const newMaterial = applyMaterialByName(
              node,
              materialType,
              customProperties,
              originalProperties
            );
            node.material = newMaterial;
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
      } else {
        console.warn('O modelo carregado não é um Object3D:', model);
      }

      // ✅ FUNÇÃO PURA: Apenas retornar o modelo e animações
      const animations = gltf.animations || [];

      

      if (typeof callback === 'function') {
        callback(model, animations);
      } else {
        console.warn('Callback não é uma função:', callback);
      }
    },
    undefined,
    (error) => {
      console.error('Erro ao carregar o modelo:', error);
      if (typeof callback === 'function') {
        callback(null, null, error);
      }
    }
  );
}

export function translate(object, axis, value) {
  if (value >= 0) {
    object[axis] += value * timeMulti; // Adiciona se for positivo ou zero
  } else {
    object[axis] += value * timeMulti; // Subtrai automaticamente se for negativo
  }
}

export function rotate(object, axis, value) {
  if (value >= 0) {
    object.rotation[axis] += value * timeMulti; // Adiciona se for positivo ou zero
  } else {
    object.rotation[axis] += value * timeMulti; // Subtrai automaticamente se for negativo
  }
}


export function translateTo(model, target, velocity) {
  model.position.addScaledVector(target, velocity * timeMulti);
}

export function trackTo(origin, target) {
  let direction = new THREE.Vector3();
  direction.subVectors(origin.position, target.position).normalize();

  return direction;
}
/*
export function followTarget(origin, target) {
  let direction = new THREE.Vector3();
  direction.subVectors(origin.position, target.position).normalize();
  bullet.position.addScaledVector(direction, 1); // Velocidade do tiro
}*/

export function distance(origin, target) {
  const dist = origin.position.distanceTo(target.position);

  return dist;
}


// Função para definir o gameLoop
export function setGameLoop(callback) {
  gameLoopFunction = callback; // Define o callback do loop de jogo
}

export function setGameStart(callback) {
  gameStartFunction = callback; // Define o callback do loop de jogo
}

export function setEditorGameLoop(callback) {
  editorGameLoopFunction = callback; // Define o callback do loop de jogo
}

export function setEditorGameStart(callback) {
  editorGameStartFunction = callback; // Define o callback do loop de jogo
}

// Retorna a cena, câmera e renderizador (se necessário)
export function getScene() {
  return scene;
}

export function getCamera() {
  return currentCamera;
}

export function getRenderer() {
  return renderer;
}

export function setBackgroundColor(color) {
  if (scene) {
    scene.background = new THREE.Color(color);
    renderer.setClearColor(new THREE.Color(color));
  }
}

export function getDelta() {
  return delta;
}

export function getClock() {
  return clock;
}

export function getDeltaTime() {
  return delta;
}

// Vector3.js
export default class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // Método para adição
  add(vector) {
    return new Vector3(this.x + vector.x, this.y + vector.y, this.z + vector.z);
  }

  // Método para subtração
  subtract(vector) {
    return new Vector3(this.x - vector.x, this.y - vector.y, this.z - vector.z);
  }

  // Método para multiplicação por um escalar
  multiply(scalar) {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  // Método para obter a magnitude do vetor
  magnitude() {
    return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);
  }

  // Método para normalizar o vetor
  normalize() {
    const mag = this.magnitude();
    return new Vector3(this.x / mag, this.y / mag, this.z / mag);
  }

  // Método para aplicar um quaternion ao vetor
  applyQuaternion(quaternion) {
    const x = this.x, y = this.y, z = this.z;
    const qx = quaternion.x, qy = quaternion.y, qz = quaternion.z, qw = quaternion.w;

    // Calcular o produto do quaternion
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    // Calcular o resultado final após a rotação
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return this;
  }

  // Método para subtrair vetores (modifica o vetor atual)
  subVectors(vectorA, vectorB) {
    this.x = vectorA.x - vectorB.x;
    this.y = vectorA.y - vectorB.y;
    this.z = vectorA.z - vectorB.z;
    return this;
  }

  // Método para calcular distância até outro vetor
  distanceTo(vector) {
    const dx = this.x - vector.x;
    const dy = this.y - vector.y;
    const dz = this.z - vector.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Método para copiar valores de outro vetor
  copy(vector) {
    this.x = vector.x;
    this.y = vector.y;
    this.z = vector.z;
    return this;
  }

  // Método para definir valores
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  // Método para adicionar escalar a cada componente
  addScalar(scalar) {
    this.x += scalar;
    this.y += scalar;
    this.z += scalar;
    return this;
  }

  // Método para multiplicar por escalar (modifica o vetor atual)
  multiplyScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  // Método para adicionar vetor escalado
  addScaledVector(vector, scalar) {
    this.x += vector.x * scalar;
    this.y += vector.y * scalar;
    this.z += vector.z * scalar;
    return this;
  }

  // Método para obter o comprimento do vetor
  length() {
    return this.magnitude();
  }
}

const smokeTexture = loadTexture("smoke.png");
const fireTexture = loadTexture("explosion.png");

const smokeGeometry = new THREE.SphereGeometry(0.5, 8, 8);
const fireGeometry = new THREE.SphereGeometry(0.5, 8, 8);

// Criar o material da fumaça uma vez
const smokeMaterial = new THREE.MeshBasicMaterial({
  map: smokeTexture, // Aplique a textura
  transparent: true,
  opacity: 1,
});

// Criar o material da chama com cor amarelada uma vez
const fireMaterial = new THREE.MeshBasicMaterial({
  map: fireTexture,
  transparent: true,
  opacity: 1,
});

// PARTÍCULA (FUTURO PARTICLES SYSTEM)
export function createSmokeTrail(position, color) {
  const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial.clone());
  const fire = new THREE.Mesh(fireGeometry, fireMaterial.clone());

  // Definir a posição inicial da fumaça e da chama como a posição do projétil
  smoke.position.copy(position);
  fire.position.copy(position);

  // Adicionar a fumaça e a chama à cena
  scene.add(smoke);
  scene.add(fire);

  // Definir a opacidade inicial
  smoke.material.opacity = 1; // Começar totalmente opaco
  fire.material.opacity = 1; // Começar totalmente opaco

  // Tornar a fumaça gradualmente mais transparente e removê-la após um tempo
  const fadeDuration = 1000; // Tempo em milissegundos antes de remover a fumaça
  const fadeInterval = setInterval(() => {
    smoke.material.opacity -= 0.04; // Diminuir a opacidade gradualmente
    if (smoke.material.opacity <= 0) {
      clearInterval(fadeInterval); // Parar a redução de opacidade
      scene.remove(smoke); // Remover a fumaça da cena
    }
  }, 50); // Atualiza a cada 50ms para um fade suave

  // Tornar a chama mais transparente rapidamente e removê-la após um tempo
  const fireFadeDuration = 100; // A chama desaparece mais rapidamente
  fire.material.opacity = 1; // Começar totalmente opaco
  const fireFadeInterval = setInterval(() => {
    fire.material.opacity -= 0.8; // Diminui a opacidade mais rápido que a fumaça
    if (fire.material.opacity <= 0) {
      clearInterval(fireFadeInterval); // Parar a redução de opacidade
      scene.remove(fire); // Remover a chama da cena
    }
  }, 20); // Atualiza a cada 20ms
}

export function createExplosion(position) {
  const explosionMaterial = new THREE.MeshPhongMaterial({
    map: fireTexture, // Textura
    emissive: new THREE.Color(0xffa500),
    emissiveIntensity: 10,
    transparent: true,
    opacity: 1,
    alphaTest: 0.5,

  });

  // Criar a malha da explosão e aplicar o material
  const explosion = new THREE.Mesh(
    new THREE.SphereGeometry(5, 10, 10),
    explosionMaterial // Use o material com a textura aqui
  );
  explosion.position.copy(position);
  scene.add(explosion);

  // Remover explosão após 0.5 segundos
  setTimeout(() => {
    //// console.log('remover explosão');
    scene.remove(explosion);
  }, 500);
}

export function loadTexture(name) {
  return new Promise((resolve, reject) => {
    if (!name || name.trim() === '') {
      resolve(null);
      return;
    }

    const textureLoader = new THREE.TextureLoader();

    // Tentar diferentes caminhos se o primeiro falhar
    const possiblePaths = [
      fileSystem.texture + "/" + name,
      './assets/textures/' + name,
      '../assets/textures/' + name,
      '../../assets/textures/' + name,
      name // Caminho absoluto
    ];

    const tryLoadTexture = (pathIndex = 0) => {
      if (pathIndex >= possiblePaths.length) {
        reject(new Error(`Não foi possível carregar a textura: ${name}`));
        return;
      }

      const currentPath = possiblePaths[pathIndex];
      

      textureLoader.load(
        currentPath,
        (texture) => {
          
          // Definir o nome da textura para facilitar a identificação
          texture.name = name;
          
          resolve(texture);
        },
        (progress) => {
          
        },
        (error) => {
          console.error(`❌ Erro ao carregar textura (tentativa ${pathIndex + 1}):`, error);
          // Tentar próximo caminho
          tryLoadTexture(pathIndex + 1);
        }
      );
    };

    tryLoadTexture();
  });
}

export function cameraVector3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

export class Environment {
  setHDR(path) {
    const fullPath = fileSystem.texture + '/' + path;
    

    // Tentar diferentes caminhos se o primeiro falhar
    const possiblePaths = [
      fullPath,
      './assets/textures/' + path,
      '../assets/textures/' + path,
      '../../assets/textures/' + path
    ];

    

    const tryLoadHDR = (pathIndex = 0) => {
      if (pathIndex >= possiblePaths.length) {
        console.error('❌ Todos os caminhos falharam para:', path);
        return;
      }

      const currentPath = possiblePaths[pathIndex];
      

      rgbeLoader.load(currentPath,
        (texture) => {
          
          texture.mapping = THREE.EquirectangularReflectionMapping;
          scene.environment = texture; // Define o ambiente
          scene.background = texture;   // Define o fundo
        },
        (progress) => {
          
        },
        (error) => {
          console.error(`❌ Erro ao carregar HDR (tentativa ${pathIndex + 1}):`, error);
          console.error('📁 Caminho tentado:', currentPath);
          // Tentar próximo caminho
          tryLoadHDR(pathIndex + 1);
        }
      );
    };

    tryLoadHDR();
  }

  clearLights() {
    // Remove todas as luzes existentes da cena
    const lightsToRemove = [];
    scene.traverse((child) => {
      if (child.isLight) {
        lightsToRemove.push(child);
      }
    });

    lightsToRemove.forEach(light => {
      scene.remove(light);
    });

  }

  setSkybox(images) {
    const loader = new THREE.CubeTextureLoader();
    const skyTexture = loader.load(fileSystem.texture + '/' + images);
    scene.background = skyTexture; // Define o céu
  }

  addDirectionalLight(color = 0xffffff, intensity = 1, position = [5, 10, 7.5]) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    light.castShadow = true;  // Habilitar sombreamento na luz

    // Tamanho do mapa de sombras para melhorar a qualidade
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;

    // Definir os limites da câmera da sombra com área maior
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 500;
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;

    light.shadow.bias = -0.0001;  // Pequeno valor negativo para resolver problemas de precisão

    scene.add(light);
    return light;
  }

  addAmbientLight(color = 0x404040, intensity = 1) {
    const light = new THREE.AmbientLight(color, intensity);
    scene.add(light);
   
    return light;
  }

  addPointLight(color = 0xffffff, intensity = 1, distance = 100, position = [10, 10, 10]) {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(...position);
    light.castShadow = true; // Habilita sombras

    // Configurar sombras para luz pontual
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 500;
    light.shadow.bias = -0.0001;

    scene.add(light);
    return light;
  }

  addSpotLight(color = 0xffffff, intensity = 1, position = [15, 30, 15]) {
    const light = new THREE.SpotLight(color, intensity);
    light.position.set(...position);
    light.castShadow = true; // Habilita sombras

    // Configurar sombras para luz spot
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 500;
    light.shadow.bias = -0.0001;

    scene.add(light);
    return light;
  }

  setFog(color = 0xffffff, density = 0.1) {
    scene.fog = new THREE.Fog(color, 1, 1000);
    scene.fog.density = density;
  }

  clearFog() {
    scene.fog = null;
  }

  setCameraRenderDistance(near, far) {
    if (camera) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }
}

////////////////////// pos processing ////////////////////////

export class PostProcessing {
  constructor() {
    if (globalPostProcessing && globalPostProcessing !== this) {
      console.warn('⚠️ Usando instância global de PostProcessing');
      return globalPostProcessing;
    }
  }

  reset() {
    
    resetPostProcessing();
  }

  addBloom(strength = 1, radius = 1, threshold = 0.1) {
    
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, radius, threshold);
    composer.addPass(bloomPass);
  }

  addFilm(noiseIntensity = 0.15, scanlinesIntensity = 0.015, scanlinesCount = 512) {
    
    const filmPass = new FilmPass(noiseIntensity, scanlinesIntensity, scanlinesCount, false);
    composer.addPass(filmPass);
  }

  addDepthOfField(focus = 15.0, aperture = 0.02, maxblur = 0.005) {
    
    // O BokehPass é o substituto moderno para o DepthOfFieldPass
    const bokehPass = new BokehPass(scene, camera, {
      focus: focus,
      aperture: aperture,
      maxblur: maxblur,
    });
    composer.addPass(bokehPass);
  }

  addMotionBlur(damp = 0.5) {
    
    // Usa AfterimagePass para criar um efeito de "motion blur"
    const afterimagePass = new AfterimagePass(damp);
    composer.addPass(afterimagePass);
  }

  addVignette(offset = 1.0, darkness = 1.0) {
    
    try {
      const vignettePass = new ShaderPass(VignetteShader);
      // O shader de vinheta espera os uniformes 'offset' e 'darkness'
      vignettePass.uniforms['offset'].value = offset;
      vignettePass.uniforms['darkness'].value = darkness;
      composer.addPass(vignettePass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Vignette:', error);
    }
  }

  addChromaticAberration(amount = 0.005) {
    
    try {
      // Shader customizado para aberração cromática
      const chromaticAberrationShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'amount': { value: amount }
        },
        vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        varying vec2 vUv;
        
        void main() {
          vec2 uv = vUv;
          vec2 center = vec2(0.5, 0.5);
          vec2 offset = (uv - center) * amount;
          
          float r = texture2D(tDiffuse, uv + offset).r;
          float g = texture2D(tDiffuse, uv).g;
          float b = texture2D(tDiffuse, uv - offset).b;
          
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `
      };

      const chromaticAberrationPass = new ShaderPass(chromaticAberrationShader);
      composer.addPass(chromaticAberrationPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Chromatic Aberration:', error);
    }
  }

  addColorCorrection(powRGB = [1.1, 1.1, 1.1], mulRGB = [1.0, 1.0, 1.0]) {
    
    try {
      const colorCorrectionPass = new ShaderPass(ColorCorrectionShader);
      colorCorrectionPass.uniforms['powRGB'].value = new THREE.Vector3(...powRGB);
      colorCorrectionPass.uniforms['mulRGB'].value = new THREE.Vector3(...mulRGB);
      composer.addPass(colorCorrectionPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Color Correction:', error);
    }
  }

  addSMAA() {
    
    try {
      const smaaPass = new SMAAPass(window.innerWidth, window.innerHeight);
      composer.addPass(smaaPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar SMAA:', error);
    }
  }

  addOutline(edgeStrength = 3.0, edgeGlow = 0.0, edgeThickness = 1.0, visibleEdgeColor = '#ffffff', hiddenEdgeColor = '#190a05') {
    
    try {
      const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
      outlinePass.edgeStrength = edgeStrength;
      outlinePass.edgeGlow = edgeGlow;
      outlinePass.edgeThickness = edgeThickness;
      outlinePass.visibleEdgeColor = new THREE.Color(visibleEdgeColor);
      outlinePass.hiddenEdgeColor = new THREE.Color(hiddenEdgeColor);

      // Aplicar outline a todos os objetos na cena
      const selectedObjects = [];
      scene.traverse((child) => {
        if (child.isMesh) {
          selectedObjects.push(child);
        }
      });
      outlinePass.selectedObjects = selectedObjects;

      composer.addPass(outlinePass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Outline:', error);
    }
  }

  addPixelation(pixelSize = 6) {
    
    try {
      // Shader customizado para pixelização
      const pixelationShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          'pixelSize': { value: pixelSize }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform vec2 resolution;
          uniform float pixelSize;
          varying vec2 vUv;
          
          void main() {
            vec2 dxy = pixelSize / resolution;
            vec2 coord = dxy * floor(vUv / dxy);
            gl_FragColor = texture2D(tDiffuse, coord);
          }
        `
      };

      const pixelationPass = new ShaderPass(pixelationShader);
      composer.addPass(pixelationPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Pixelização:', error);
    }
  }

  addHueSaturation(hue = 0.0, saturation = 0.0) {
    
    try {
      const hueSaturationPass = new ShaderPass(HueSaturationShader);
      hueSaturationPass.uniforms['hue'].value = hue;
      hueSaturationPass.uniforms['saturation'].value = saturation;
      composer.addPass(hueSaturationPass);

    } catch (error) {
      console.error('❌ Erro ao adicionar Hue Saturation:', error);
    }
  }

  addGlitch(intensity = 0.1, goWild = false) {
    
    try {
      const glitchPass = new GlitchPass();
      glitchPass.goWild = goWild;

      // Ajustar a intensidade através dos uniformes internos
      if (glitchPass.uniforms && glitchPass.uniforms.seed) {
        glitchPass.uniforms.seed.value = intensity;
      }

      composer.addPass(glitchPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Glitch:', error);
    }
  }

  addLensFlare(intensity = 0.5, flareColor = '#ffffff', sunPosition = [0, 0, 0]) {
    
    try {
      // Criar shader customizado para lens flare
      const lensFlareShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'sunPosition': { value: new THREE.Vector3(sunPosition[0], sunPosition[1], sunPosition[2]) },
          'intensity': { value: intensity },
          'flareColor': { value: new THREE.Color(flareColor) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform vec3 sunPosition;
          uniform float intensity;
          uniform vec3 flareColor;
          varying vec2 vUv;
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 screenPos = vUv * 2.0 - 1.0;
            vec2 sunScreenPos = sunPosition.xy;
            
            float distance = length(screenPos - sunScreenPos);
            float flare = 1.0 - smoothstep(0.0, 0.7, distance);
            
            vec3 flareEffect = flareColor * flare * intensity;
            
            gl_FragColor = vec4(texel.rgb + flareEffect, texel.a);
          }
        `
      };

      const lensFlarePass = new ShaderPass(lensFlareShader);
      composer.addPass(lensFlarePass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Lens Flare:', error);
    }
  }

  addBrightnessContrast(brightness = 0.0, contrast = 0.0) {
    
    try {
      // Criar shader customizado para brightness e contrast
      const brightnessContrastShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'brightness': { value: brightness },
          'contrast': { value: contrast }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float brightness;
          uniform float contrast;
          varying vec2 vUv;
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Aplicar brightness
            vec3 color = texel.rgb + brightness;
            
            // Aplicar contrast
            color = (color - 0.5) * (1.0 + contrast) + 0.5;
            
            gl_FragColor = vec4(color, texel.a);
          }
        `
      };

      const brightnessContrastPass = new ShaderPass(brightnessContrastShader);
      composer.addPass(brightnessContrastPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Brightness/Contrast:', error);
    }
  }

  addGammaCorrection(gamma = 2.2) {
    
    try {
      // Criar shader customizado para correção de gamma
      const gammaCorrectionShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'gamma': { value: gamma }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float gamma;
          varying vec2 vUv;
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Aplicar correção de gamma
            vec3 color = pow(texel.rgb, vec3(1.0 / gamma));
            
            gl_FragColor = vec4(color, texel.a);
          }
        `
      };

      const gammaCorrectionPass = new ShaderPass(gammaCorrectionShader);
      composer.addPass(gammaCorrectionPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Gamma Correction:', error);
    }
  }

  addAdvancedHueSaturation(hue = 0.0, saturation = 0.0, lightness = 0.0) {
    
    try {
      // Criar shader customizado para HSL avançado
      const advancedHueSaturationShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'hue': { value: hue },
          'saturation': { value: saturation },
          'lightness': { value: lightness }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float hue;
          uniform float saturation;
          uniform float lightness;
          varying vec2 vUv;
          
          // Funções simplificadas para HSL
          vec3 adjustHue(vec3 color, float hue) {
            float angle = hue * 3.14159 / 180.0;
            float s = sin(angle);
            float c = cos(angle);
            
            vec3 weights = vec3(0.299, 0.587, 0.114);
            float gray = dot(color, weights);
            
            return mix(color, vec3(
              color.r * c + (color.g - color.b) * s,
              color.g * c + (color.b - color.r) * s,
              color.b * c + (color.r - color.g) * s
            ), 1.0);
          }
          
          vec3 adjustSaturation(vec3 color, float saturation) {
            float gray = dot(color, vec3(0.299, 0.587, 0.114));
            return mix(vec3(gray), color, 1.0 + saturation);
          }
          
          vec3 adjustLightness(vec3 color, float lightness) {
            return color + lightness;
          }
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 color = texel.rgb;
            
            // Aplicar modificações HSL
            color = adjustHue(color, hue * 360.0);
            color = adjustSaturation(color, saturation);
            color = adjustLightness(color, lightness);
            
            // Clamp para evitar valores fora do range
            color = clamp(color, 0.0, 1.0);
            
            gl_FragColor = vec4(color, texel.a);
          }
        `
      };

      const advancedHueSaturationPass = new ShaderPass(advancedHueSaturationShader);
      composer.addPass(advancedHueSaturationPass);
      
    } catch (error) {
      console.error('❌ Erro ao adicionar Advanced Hue/Saturation:', error);
    }
  }

  addSSAO(radius = 0.5, minDistance = 0.005, maxDistance = 0.1) {

    try {
      // Shader SSAO suavizado sem artefatos circulares
      const ssaoShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'radius': { value: radius },
          'intensity': { value: 0.8 },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float radius;
          uniform float intensity;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          // Função para calcular luminância
          float getLuminance(vec3 color) {
            return dot(color, vec3(0.299, 0.587, 0.114));
          }
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 texelSize = 1.0 / resolution;
            
            float centerLum = getLuminance(texel.rgb);
            float ao = 0.0;
            float totalWeight = 0.0;
            
            // Amostragem em cruz com múltiplas distâncias (mais suave)
            float step = radius / 3.0;
            
            // Amostragem horizontal
            for(int i = -3; i <= 3; i++) {
              if(i == 0) continue;
              
              vec2 offset = vec2(float(i) * step * texelSize.x, 0.0);
              vec2 samplePos = vUv + offset;
              
              if(samplePos.x >= 0.0 && samplePos.x <= 1.0) {
                vec3 sampleColor = texture2D(tDiffuse, samplePos).rgb;
                float sampleLum = getLuminance(sampleColor);
                
                float weight = 1.0 / (1.0 + abs(float(i)));
                float diff = max(0.0, centerLum - sampleLum);
                ao += diff * weight;
                totalWeight += weight;
              }
            }
            
            // Amostragem vertical
            for(int i = -3; i <= 3; i++) {
              if(i == 0) continue;
              
              vec2 offset = vec2(0.0, float(i) * step * texelSize.y);
              vec2 samplePos = vUv + offset;
              
              if(samplePos.y >= 0.0 && samplePos.y <= 1.0) {
                vec3 sampleColor = texture2D(tDiffuse, samplePos).rgb;
                float sampleLum = getLuminance(sampleColor);
                
                float weight = 1.0 / (1.0 + abs(float(i)));
                float diff = max(0.0, centerLum - sampleLum);
                ao += diff * weight;
                totalWeight += weight;
              }
            }
            
            // Amostragem diagonal
            for(int i = -2; i <= 2; i++) {
              if(i == 0) continue;
              
              float scale = float(i) * step * 0.707;
              vec2 offset1 = vec2(scale * texelSize.x, scale * texelSize.y);
              vec2 offset2 = vec2(scale * texelSize.x, -scale * texelSize.y);
              
              // Diagonal 1
              vec2 samplePos1 = vUv + offset1;
              if(samplePos1.x >= 0.0 && samplePos1.x <= 1.0 && samplePos1.y >= 0.0 && samplePos1.y <= 1.0) {
                vec3 sampleColor = texture2D(tDiffuse, samplePos1).rgb;
                float sampleLum = getLuminance(sampleColor);
                
                float weight = 0.7 / (1.0 + abs(float(i)));
                float diff = max(0.0, centerLum - sampleLum);
                ao += diff * weight;
                totalWeight += weight;
              }
              
              // Diagonal 2
              vec2 samplePos2 = vUv + offset2;
              if(samplePos2.x >= 0.0 && samplePos2.x <= 1.0 && samplePos2.y >= 0.0 && samplePos2.y <= 1.0) {
                vec3 sampleColor = texture2D(tDiffuse, samplePos2).rgb;
                float sampleLum = getLuminance(sampleColor);
                
                float weight = 0.7 / (1.0 + abs(float(i)));
                float diff = max(0.0, centerLum - sampleLum);
                ao += diff * weight;
                totalWeight += weight;
              }
            }
            
            // Normalizar AO
            if(totalWeight > 0.0) {
              ao = ao / totalWeight;
            }
            
            // Aplicar intensidade e suavizar
            ao = ao * intensity;
            ao = 1.0 - clamp(ao, 0.0, 0.8);
            
            // Suavização final para evitar artefatos
            ao = mix(1.0, ao, 0.8);
            
            gl_FragColor = vec4(texel.rgb * ao, texel.a);
          }
        `
      };

      const ssaoPass = new ShaderPass(ssaoShader);
      composer.addPass(ssaoPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar SSAO:', error);
    }
  }

  addSSR(intensity = 0.5, maxDistance = 100.0, thickness = 0.1) {
    try {
      // Shader SSR simplificado usando offset UV
      const ssrShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'intensity': { value: intensity },
          'offsetScale': { value: 0.02 },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float intensity;
          uniform float offsetScale;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 texelSize = 1.0 / resolution;
            
            // Calcular normal aproximada usando gradiente de cores
            vec3 center = texel.rgb;
            vec3 left = texture2D(tDiffuse, vUv + vec2(-texelSize.x, 0.0)).rgb;
            vec3 right = texture2D(tDiffuse, vUv + vec2(texelSize.x, 0.0)).rgb;
            vec3 up = texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y)).rgb;
            vec3 down = texture2D(tDiffuse, vUv + vec2(0.0, -texelSize.y)).rgb;
            
            // Gradiente horizontal e vertical
            float gradX = dot(right - left, vec3(0.299, 0.587, 0.114));
            float gradY = dot(up - down, vec3(0.299, 0.587, 0.114));
            
            // Calcular offset de reflexão baseado no gradiente
            vec2 reflectOffset = vec2(gradX, gradY) * offsetScale;
            vec2 reflectUV = vUv + reflectOffset;
            
            // Verificar se está dentro dos limites
            if(reflectUV.x >= 0.0 && reflectUV.x <= 1.0 && reflectUV.y >= 0.0 && reflectUV.y <= 1.0) {
              vec3 reflectColor = texture2D(tDiffuse, reflectUV).rgb;
              
              // Fade baseado na distância do centro
              float distFromCenter = length(reflectOffset);
              float fade = 1.0 - smoothstep(0.0, 0.1, distFromCenter);
              
              // Misturar com a cor original
              vec3 finalColor = mix(texel.rgb, reflectColor, intensity * fade);
              gl_FragColor = vec4(finalColor, texel.a);
            } else {
              gl_FragColor = texel;
            }
          }
        `
      };

      const ssrPass = new ShaderPass(ssrShader);
      composer.addPass(ssrPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar SSR:', error);
    }
  }

  addVolumetricFog(density = 0.1, color = '#ffffff', scattering = 0.5, absorption = 0.2, height = 100.0, falloff = 0.1) {
    try {
      // Shader para neblina volumétrica
      const volumetricFogShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'tDepth': { value: null },
          'density': { value: density },
          'color': { value: new THREE.Color(color) },
          'scattering': { value: scattering },
          'absorption': { value: absorption },
          'height': { value: height },
          'falloff': { value: falloff },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          'time': { value: 0.0 },
          'viewPosition': { value: camera.position.clone() },
          'lightDirection': { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float density;
          uniform vec3 color;
          uniform float scattering;
          uniform float absorption;
          uniform float height;
          uniform float falloff;
          uniform vec2 resolution;
          uniform float time;
          uniform vec3 viewPosition;
          uniform vec3 lightDirection;
          varying vec2 vUv;
          
          // Função de ruído 3D para variação da neblina
          float noise3D(vec3 p) {
            return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          }
          
          // Função para calcular profundidade aproximada
          float getDepth(vec3 worldPos) {
            float depth = length(worldPos - viewPosition);
            return depth / 100.0; // Normalizar
          }
          
          // Função para fog volumétrico
          float volumetricFogDensity(vec3 worldPos) {
            // Densidade baseada na altura
            float heightFactor = exp(-max(0.0, worldPos.y - height) * falloff);
            
            // Adicionar variação com ruído
            vec3 noisePos = worldPos * 0.01 + vec3(time * 0.1, 0.0, time * 0.05);
            float noiseValue = noise3D(noisePos) * 0.5 + 0.5;
            
            // Densidade final
            return density * heightFactor * (0.7 + 0.3 * noiseValue);
          }
          
          // Função para scattering da luz
          float lightScattering(vec3 rayDir, vec3 lightDir) {
            float cosAngle = dot(rayDir, lightDir);
            // Fase de Mie simplificada
            float phase = 1.0 + cosAngle * cosAngle;
            return phase * scattering;
          }
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Calcular posição no mundo (aproximada)
            vec3 screenPos = vec3(vUv * 2.0 - 1.0, 0.0);
            float depth = length(texel.rgb) * 0.1; // Aproximação de profundidade
            
            vec3 worldPos = viewPosition + screenPos * depth * 50.0;
            
            // Calcular densidade da neblina
            float fogDensity = volumetricFogDensity(worldPos);
            
            // Calcular direção do raio
            vec3 rayDir = normalize(worldPos - viewPosition);
            
            // Calcular scattering da luz
            float scatter = lightScattering(rayDir, lightDirection);
            
            // Calcular cor da neblina
            vec3 fogColor = color * scatter;
            
            // Calcular transmitância (quanto da luz original passa)
            float transmittance = exp(-fogDensity * absorption);
            
            // Misturar cor original com neblina
            vec3 finalColor = mix(fogColor, texel.rgb, transmittance);
            
            // Adicionar efeito de altura
            float heightEffect = smoothstep(0.0, 1.0, 1.0 - worldPos.y / height);
            finalColor = mix(texel.rgb, finalColor, heightEffect * fogDensity);
            
            gl_FragColor = vec4(finalColor, texel.a);
          }
        `
      };

      const volumetricFogPass = new ShaderPass(volumetricFogShader);
      composer.addPass(volumetricFogPass);

      // Animar o tempo
      const animate = () => {
        volumetricFogShader.uniforms.time.value += 0.01;
        volumetricFogShader.uniforms.viewPosition.value.copy(camera.position);
        requestAnimationFrame(animate);
      };
      animate();

    } catch (error) {
      console.error('❌ Erro ao adicionar Volumetric Fog:', error);
    }
  }

  addHDR(exposure = 1.0, toneMapping = 'reinhard', contrast = 1.1, saturation = 1.0) {
    try {
      // Shader HDR com tone mapping
      const hdrShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'exposure': { value: exposure },
          'contrast': { value: contrast },
          'saturation': { value: saturation },
          'toneMapping': { value: toneMapping === 'aces' ? 1 : 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float exposure;
          uniform float contrast;
          uniform float saturation;
          uniform int toneMapping;
          varying vec2 vUv;
          
          // Tone mapping Reinhard
          vec3 reinhardToneMapping(vec3 color) {
            return color / (color + vec3(1.0));
          }
          
          // Tone mapping ACES (aproximado)
          vec3 acesToneMapping(vec3 color) {
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
          }
          
          // Ajuste de saturação
          vec3 adjustSaturation(vec3 color, float saturation) {
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            return mix(vec3(luminance), color, saturation);
          }
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 color = texel.rgb;
            
            // Aplicar exposure
            color *= exposure;
            
            // Tone mapping
            if(toneMapping == 1) {
              color = acesToneMapping(color);
            } else {
              color = reinhardToneMapping(color);
            }
            
            // Aplicar contraste
            color = (color - 0.5) * contrast + 0.5;
            
            // Aplicar saturação
            color = adjustSaturation(color, saturation);
            
            // Clamp final
            color = clamp(color, 0.0, 1.0);
            
            gl_FragColor = vec4(color, texel.a);
          }
        `
      };

      const hdrPass = new ShaderPass(hdrShader);
      composer.addPass(hdrPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar HDR:', error);
    }
  }

  addVolumetricLighting(intensity = 0.8, samples = 32, scattering = 0.5, lightColor = '#ffffff', lightPosition = [0.5, 0.5, 0.5], rayMarchSteps = 24) {
    try {
      // Shader para luz volumétrica avançada
      const volumetricLightingShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'intensity': { value: intensity },
          'samples': { value: samples },
          'scattering': { value: scattering },
          'lightColor': { value: new THREE.Color(lightColor) },
          'lightPosition': { value: new THREE.Vector3(lightPosition[0], lightPosition[1], lightPosition[2]) },
          'rayMarchSteps': { value: rayMarchSteps },
          'time': { value: 0.0 },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          'viewPosition': { value: camera.position.clone() },
          'viewDirection': { value: camera.getWorldDirection(new THREE.Vector3()) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float intensity;
          uniform float samples;
          uniform float scattering;
          uniform vec3 lightColor;
          uniform vec3 lightPosition;
          uniform float rayMarchSteps;
          uniform float time;
          uniform vec2 resolution;
          uniform vec3 viewPosition;
          uniform vec3 viewDirection;
          varying vec2 vUv;
          
          // Função de ruído 3D melhorada
          float noise3D(vec3 p) {
            vec3 a = floor(p);
            vec3 d = p - a;
            d = d * d * (3.0 - 2.0 * d);
            
            vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
            vec4 k1 = fract(sin(b) * 43758.5453);
            vec4 k2 = fract(sin(b + 1.0) * 43758.5453);
            
            vec2 c = mix(k1.xz, k1.yw, d.x);
            vec2 d2 = mix(k2.xz, k2.yw, d.x);
            
            float k = mix(mix(c.x, c.y, d.y), mix(d2.x, d2.y, d.y), d.z);
            return k;
          }
          
          // Função para densidade volumétrica
          float volumetricDensity(vec3 pos) {
            // Densidade base com ruído
            float density = 0.1 + 0.05 * noise3D(pos * 0.05 + time * 0.01);
            
            // Adicionar variação temporal
            density += 0.02 * sin(time * 0.3 + pos.x * 0.1 + pos.z * 0.1);
            
            // Densidade diminui com altura
            density *= exp(-max(0.0, pos.y - 5.0) * 0.02);
            
            return clamp(density, 0.0, 1.0);
          }
          
          // Função para atenuação da luz
          float lightAttenuation(vec3 pos, vec3 lightPos) {
            float distance = length(pos - lightPos);
            return 1.0 / (1.0 + distance * 0.005);
          }
          
          // Função de espalhamento de luz (Mie scattering)
          float mieScattering(vec3 rayDir, vec3 lightDir) {
            float cosAngle = dot(rayDir, lightDir);
            float phase = 0.5 + 0.5 * cosAngle;
            return phase * phase;
          }
          
          // Ray marching para luz volumétrica
          vec3 rayMarchVolumetricLight(vec3 rayStart, vec3 rayDir, float maxDistance) {
            vec3 lightAccumulation = vec3(0.0);
            float stepSize = maxDistance / rayMarchSteps;
            
            for(int i = 0; i < 24; i++) {
              if(float(i) >= rayMarchSteps) break;
              
              vec3 currentPos = rayStart + rayDir * stepSize * float(i);
              
              // Calcular densidade no ponto atual
              float density = volumetricDensity(currentPos);
              
              // Calcular direção para a luz
              vec3 lightDir = normalize(lightPosition - currentPos);
              
              // Calcular atenuação da luz
              float attenuation = lightAttenuation(currentPos, lightPosition);
              
              // Calcular espalhamento
              float scatter = mieScattering(rayDir, lightDir);
              
              // Acumular luz
              lightAccumulation += lightColor * density * attenuation * scatter * stepSize;
            }
            
            return lightAccumulation * intensity;
          }
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Calcular direção do raio da câmera
            vec3 screenPos = vec3((vUv - 0.5) * 2.0, 1.0);
            vec3 rayDir = normalize(viewDirection + screenPos * 0.3);
            
            // Calcular distância baseada na luminância
            float sceneDepth = 1.0 - dot(texel.rgb, vec3(0.299, 0.587, 0.114));
            float maxDistance = sceneDepth * 50.0 + 10.0;
            
            // Ray marching para luz volumétrica
            vec3 volumetricLight = rayMarchVolumetricLight(viewPosition, rayDir, maxDistance);
            
            // Aplicar scattering
            volumetricLight *= scattering;
            
            // Misturar com a cor original
            vec3 finalColor = texel.rgb + volumetricLight;
            
            // Aplicar tom mapping suave
            finalColor = finalColor / (finalColor + vec3(0.5));
            
            gl_FragColor = vec4(finalColor, texel.a);
          }
        `
      };

      const volumetricLightingPass = new ShaderPass(volumetricLightingShader);
      composer.addPass(volumetricLightingPass);

      // Animar o tempo e posição da câmera
      const animate = () => {
        volumetricLightingShader.uniforms.time.value += 0.016;
        volumetricLightingShader.uniforms.viewPosition.value.copy(camera.position);
        camera.getWorldDirection(volumetricLightingShader.uniforms.viewDirection.value);
        requestAnimationFrame(animate);
      };
      animate();

    } catch (error) {
      console.error('❌ Erro ao adicionar Luz Volumétrica:', error);
    }
  }

  addGodRays(intensity = 0.5, density = 0.96, decay = 0.96, exposure = 0.34, lightPosition = [0.5, 0.5]) {
    try {
      // Criar shader customizado para God Rays
      const godRaysShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'intensity': { value: intensity },
          'density': { value: density },
          'decay': { value: decay },
          'exposure': { value: exposure },
          'lightPosition': { value: new THREE.Vector2(lightPosition[0], lightPosition[1]) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float intensity;
          uniform float density;
          uniform float decay;
          uniform float exposure;
          uniform vec2 lightPosition;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Calcular direção dos raios
            vec2 deltaTextCoord = vUv - lightPosition;
            vec2 textCoo = vUv;
            
            deltaTextCoord *= density * 0.1;
            float illuminationDecay = 1.0;
            
            vec3 godRays = vec3(0.0);
            
            // Amostragem ao longo do raio (8 amostras fixas)
            for(int i = 0; i < 8; i++) {
              textCoo -= deltaTextCoord * 0.2;
              
              // Verificar se está dentro dos limites
              if(textCoo.x >= 0.0 && textCoo.x <= 1.0 && textCoo.y >= 0.0 && textCoo.y <= 1.0) {
                vec3 sampleColor = texture2D(tDiffuse, textCoo).rgb;
                
                // Calcular luminância
                float luminance = dot(sampleColor, vec3(0.299, 0.587, 0.114));
                
                sampleColor *= illuminationDecay * exposure;
                godRays += sampleColor;
                
                illuminationDecay *= decay;
              }
            }
            
            // Aplicar os raios de deus
            vec3 finalColor = texel.rgb + godRays * intensity;
            
            gl_FragColor = vec4(finalColor, texel.a);
          }
        `
      };

      const godRaysPass = new ShaderPass(godRaysShader);
      composer.addPass(godRaysPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar God Rays:', error);
    }
  }

  // ========================================
  // 🎨 EFEITOS ARTÍSTICOS NATIVOS
  // ========================================

  addSepia(amount = 0.5) {
    try {
      const sepiaShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'amount': { value: amount }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float amount;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Conversão para sépia
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            vec3 sepiaColor = vec3(gray) * vec3(1.2, 1.0, 0.8);
            
            // Aplicar o efeito
            color.rgb = mix(color.rgb, sepiaColor, amount);
            
            gl_FragColor = color;
          }
        `
      };

      const sepiaPass = new ShaderPass(sepiaShader);
      composer.addPass(sepiaPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Sepia:', error);
    }
  }

  addDotScreen(scale = 4.0, angle = 1.57) {
    try {
      const dotScreenShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'scale': { value: scale },
          'angle': { value: angle }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float scale;
          uniform float angle;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          float pattern() {
            float s = sin(angle), c = cos(angle);
            vec2 tex = vUv * vec2(1024.0, 1024.0);
            vec2 point = vec2(
              c * tex.x - s * tex.y,
              s * tex.x + c * tex.y
            ) * scale;
            return (sin(point.x) * sin(point.y)) * 4.0;
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float average = (color.r + color.g + color.b) / 3.0;
            gl_FragColor = vec4(vec3(average * 10.0 - 5.0 + pattern()), color.a);
          }
        `
      };

      const dotScreenPass = new ShaderPass(dotScreenShader);
      composer.addPass(dotScreenPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Dot Screen:', error);
    }
  }

  addScanline(density = 0.04, opacity = 0.4) {
    try {
      const scanlineShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'density': { value: density },
          'opacity': { value: opacity }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float density;
          uniform float opacity;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Criar linhas de varredura
            float scanline = sin(vUv.y * 800.0) * 0.04;
            float grid = sin(vUv.y / density) * opacity;
            
            // Aplicar o efeito
            color.rgb -= scanline;
            color.rgb += grid;
            
            gl_FragColor = color;
          }
        `
      };

      const scanlinePass = new ShaderPass(scanlineShader);
      composer.addPass(scanlinePass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Scanline:', error);
    }
  }

  addNoiseEffect(amount = 0.5) {
    try {
      const noiseShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'amount': { value: amount },
          'time': { value: 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float amount;
          uniform float time;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Gerar ruído
            float noise = random(vUv + time * 0.1) * 2.0 - 1.0;
            
            // Aplicar o ruído
            color.rgb += noise * amount;
            
            gl_FragColor = color;
          }
        `
      };

      const noisePass = new ShaderPass(noiseShader);
      composer.addPass(noisePass);

      // Animar o ruído
      const animate = () => {
        if (noisePass.material && noisePass.material.uniforms) {
          noisePass.material.uniforms.time.value = performance.now() * 0.001;
        }
        requestAnimationFrame(animate);
      };
      animate();

    } catch (error) {
      console.error('❌ Erro ao adicionar Noise Effect:', error);
    }
  }

  addHalftone(shape = 1, radius = 4, rotateR = Math.PI / 12, rotateG = Math.PI / 12 * 2, rotateB = Math.PI / 12 * 3, scatter = 0) {
    try {
      const halftoneShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'shape': { value: shape },
          'radius': { value: radius },
          'rotateR': { value: rotateR },
          'rotateG': { value: rotateG },
          'rotateB': { value: rotateB },
          'scatter': { value: scatter }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float shape;
          uniform float radius;
          uniform float rotateR;
          uniform float rotateG;
          uniform float rotateB;
          uniform float scatter;
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          float blend(float a, float b, float t) {
            return a * (1.0 - t) + b * t;
          }
          
          float luma(vec3 color) {
            return dot(color, vec3(0.299, 0.587, 0.114));
          }
          
          float halftone(vec2 uv, float n, float angle) {
            float c = cos(angle);
            float s = sin(angle);
            vec2 tex = uv * n - vec2(0.5);
            vec2 point = vec2(
              c * tex.x - s * tex.y,
              s * tex.x + c * tex.y
            );
            return distance(point, vec2(0.5)) * 2.0;
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            float gray = luma(color.rgb);
            
            // Aplicar halftone para cada canal
            float r = halftone(vUv, radius, rotateR);
            float g = halftone(vUv, radius, rotateG);
            float b = halftone(vUv, radius, rotateB);
            
            // Misturar com a cor original
            color.r = blend(color.r, r, gray);
            color.g = blend(color.g, g, gray);
            color.b = blend(color.b, b, gray);
            
            gl_FragColor = color;
          }
        `
      };

      const halftonePass = new ShaderPass(halftoneShader);
      composer.addPass(halftonePass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Halftone:', error);
    }
  }

  // ========================================
  // 🔬 EFEITOS AVANÇADOS
  // ========================================

  addHBAO(radius = 1.0, intensity = 1.0, quality = 0.5) {
    try {
      const hbaoShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'tDepth': { value: null },
          'radius': { value: radius },
          'intensity': { value: intensity },
          'quality': { value: quality },
          'cameraNear': { value: camera.near },
          'cameraFar': { value: camera.far }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform sampler2D tDepth;
          uniform float radius;
          uniform float intensity;
          uniform float quality;
          uniform float cameraNear;
          uniform float cameraFar;
          varying vec2 vUv;
          
          #include <packing>
          
          float readDepth(vec2 coord) {
            float fragCoordZ = texture2D(tDepth, coord).x;
            float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
            return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            float depth = readDepth(vUv);
            float occlusion = 0.0;
            
            // Sampling pattern mais eficiente para HBAO
            vec2 texelSize = 1.0 / vec2(textureSize(tDiffuse, 0));
            
            for (int i = 0; i < 8; i++) {
              float angle = float(i) * 0.785398; // 45 graus
              vec2 offset = vec2(cos(angle), sin(angle)) * radius * texelSize;
              
              float sampleDepth = readDepth(vUv + offset);
              float diff = depth - sampleDepth;
              
              if (diff > 0.0) {
                occlusion += diff * quality;
              }
            }
            
            occlusion = clamp(occlusion * intensity, 0.0, 1.0);
            color.rgb *= (1.0 - occlusion);
            
            gl_FragColor = color;
          }
        `
      };

      const hbaoPass = new ShaderPass(hbaoShader);
      composer.addPass(hbaoPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar HBAO:', error);
    }
  }

  addFXAA(resolution = [window.innerWidth, window.innerHeight]) {
    try {
      const fxaaShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'resolution': { value: new THREE.Vector2(1 / resolution[0], 1 / resolution[1]) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          void main() {
            vec2 texCoordOffset = resolution;
            
            // Amostragem FXAA
            vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * texCoordOffset).rgb;
            vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * texCoordOffset).rgb;
            vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * texCoordOffset).rgb;
            vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * texCoordOffset).rgb;
            vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
            
            vec3 luma = vec3(0.299, 0.587, 0.114);
            float lumaNW = dot(rgbNW, luma);
            float lumaNE = dot(rgbNE, luma);
            float lumaSW = dot(rgbSW, luma);
            float lumaSE = dot(rgbSE, luma);
            float lumaM = dot(rgbM, luma);
            
            float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
            float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
            
            vec2 dir = vec2(
              -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
              ((lumaNW + lumaSW) - (lumaNE + lumaSE))
            );
            
            float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.25, 0.0625);
            float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
            
            dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * texCoordOffset;
            
            vec3 rgbA = 0.5 * (
              texture2D(tDiffuse, vUv + dir * -0.166667).rgb +
              texture2D(tDiffuse, vUv + dir * 0.166667).rgb
            );
            
            vec3 rgbB = rgbA * 0.5 + 0.25 * (
              texture2D(tDiffuse, vUv + dir * -0.5).rgb +
              texture2D(tDiffuse, vUv + dir * 0.5).rgb
            );
            
            float lumaB = dot(rgbB, luma);
            
            vec3 color = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;
            
            gl_FragColor = vec4(color, 1.0);
          }
        `
      };

      const fxaaPass = new ShaderPass(fxaaShader);
      composer.addPass(fxaaPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar FXAA:', error);
    }
  }

  addSobelEdgeDetection(threshold = 0.1) {
    try {
      const sobelShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'threshold': { value: threshold },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float threshold;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          void main() {
            vec2 texel = 1.0 / resolution;
            
            // Kernel Sobel X
            float tl = length(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb);
            float tm = length(texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb);
            float tr = length(texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y)).rgb);
            float ml = length(texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb);
            float mm = length(texture2D(tDiffuse, vUv).rgb);
            float mr = length(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb);
            float bl = length(texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y)).rgb);
            float bm = length(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb);
            float br = length(texture2D(tDiffuse, vUv + vec2(texel.x, texel.y)).rgb);
            
            // Aplicar filtro Sobel
            float sx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
            float sy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
            
            float g = sqrt(sx * sx + sy * sy);
            
            vec4 color = texture2D(tDiffuse, vUv);
            
            if (g > threshold) {
              color = vec4(0.0, 0.0, 0.0, 1.0); // Borda preta
            }
            
            gl_FragColor = color;
          }
        `
      };

      const sobelPass = new ShaderPass(sobelShader);
      composer.addPass(sobelPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Sobel Edge Detection:', error);
    }
  }

  // ========================================
  // 📐 EFEITOS GEOMÉTRICOS
  // ========================================

  addASCII(characters = ' .:-=+*#%@', fontSize = 10) {
    try {
      const asciiShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'characters': { value: characters },
          'fontSize': { value: fontSize },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float fontSize;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          void main() {
            vec2 cellSize = vec2(fontSize) / resolution;
            vec2 cellIndex = floor(vUv / cellSize);
            vec2 cellUV = fract(vUv / cellSize);
            
            // Amostragem do pixel central da célula
            vec2 centerUV = (cellIndex + 0.5) * cellSize;
            vec4 color = texture2D(tDiffuse, centerUV);
            
            // Converter para escala de cinza
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            
            // Simular caracteres ASCII baseado na intensidade
            float charIntensity = gray * 10.0;
            
            // Criar padrão de caracteres
            vec2 charUV = fract(cellUV * 8.0);
            float pattern = step(0.5, charUV.x) * step(0.5, charUV.y);
            
            if (gray > 0.8) {
              color = vec4(1.0); // Espaço
            } else if (gray > 0.6) {
              color = vec4(vec3(pattern), 1.0); // Ponto
            } else if (gray > 0.4) {
              color = vec4(vec3(step(0.3, length(charUV - 0.5))), 1.0); // Círculo
            } else {
              color = vec4(vec3(step(0.1, abs(charUV.x - 0.5)) * step(0.1, abs(charUV.y - 0.5))), 1.0); // Hash
            }
            
            gl_FragColor = color;
          }
        `
      };

      const asciiPass = new ShaderPass(asciiShader);
      composer.addPass(asciiPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar ASCII Effect:', error);
    }
  }

  addCrosshatch(spacing = 0.05, thickness = 0.002) {
    try {
      const crosshatchShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'spacing': { value: spacing },
          'thickness': { value: thickness },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float spacing;
          uniform float thickness;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            
            // Coordenadas em pixels
            vec2 pixelCoord = vUv * resolution;
            
            // Linhas horizontais
            float horizontal = sin(pixelCoord.y / spacing) * 0.5 + 0.5;
            horizontal = step(1.0 - thickness, horizontal);
            
            // Linhas verticais
            float vertical = sin(pixelCoord.x / spacing) * 0.5 + 0.5;
            vertical = step(1.0 - thickness, vertical);
            
            // Linhas diagonais
            float diagonal1 = sin((pixelCoord.x + pixelCoord.y) / spacing) * 0.5 + 0.5;
            diagonal1 = step(1.0 - thickness, diagonal1);
            
            float diagonal2 = sin((pixelCoord.x - pixelCoord.y) / spacing) * 0.5 + 0.5;
            diagonal2 = step(1.0 - thickness, diagonal2);
            
            // Aplicar crosshatch baseado na intensidade
            float crosshatch = 0.0;
            
            if (gray < 0.25) {
              crosshatch = max(max(horizontal, vertical), max(diagonal1, diagonal2));
            } else if (gray < 0.5) {
              crosshatch = max(horizontal, vertical);
            } else if (gray < 0.75) {
              crosshatch = max(horizontal, diagonal1);
            }
            
            // Misturar com a cor original
            color.rgb = mix(color.rgb, vec3(0.0), crosshatch * 0.8);
            
            gl_FragColor = color;
          }
        `
      };

      const crosshatchPass = new ShaderPass(crosshatchShader);
      composer.addPass(crosshatchPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Crosshatch:', error);
    }
  }

  addDithering(bayerLevel = 2) {
    try {
      const ditheringShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'bayerLevel': { value: bayerLevel },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float bayerLevel;
          uniform vec2 resolution;
          varying vec2 vUv;
          
          // Matriz Bayer 4x4
          float bayer4(vec2 coord) {
            float bayer[16] = float[16](
              0.0, 8.0, 2.0, 10.0,
              12.0, 4.0, 14.0, 6.0,
              3.0, 11.0, 1.0, 9.0,
              15.0, 7.0, 13.0, 5.0
            );
            
            int x = int(mod(coord.x, 4.0));
            int y = int(mod(coord.y, 4.0));
            return bayer[y * 4 + x] / 16.0;
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            vec2 pixelCoord = floor(vUv * resolution);
            float threshold = bayer4(pixelCoord);
            
            // Aplicar dithering em cada canal
            color.r = step(threshold, color.r);
            color.g = step(threshold, color.g);
            color.b = step(threshold, color.b);
            
            gl_FragColor = color;
          }
        `
      };

      const ditheringPass = new ShaderPass(ditheringShader);
      composer.addPass(ditheringPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Dithering:', error);
    }
  }

  // ========================================
  // 🕹️ EFEITOS PS2/RETRO
  // ========================================

  addPSXDithering(colorDepth = 16, intensity = 1.0) {
    try {
      const psxDitheringShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'colorDepth': { value: colorDepth },
          'intensity': { value: intensity },
          'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          'time': { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float colorDepth;
          uniform float intensity;
          uniform vec2 resolution;
          uniform float time;
          varying vec2 vUv;
          
          // Matriz Bayer PSX 4x4
          float bayerPSX(vec2 coord) {
            float bayer[16] = float[16](
              0.0,  8.0,  2.0, 10.0,
              12.0, 4.0, 14.0,  6.0,
              3.0, 11.0,  1.0,  9.0,
              15.0, 7.0, 13.0,  5.0
            );
            
            int x = int(mod(coord.x, 4.0));
            int y = int(mod(coord.y, 4.0));
            return bayer[y * 4 + x] / 16.0;
          }
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Aplicar dithering PSX
            vec2 pixelCoord = floor(vUv * resolution);
            float threshold = bayerPSX(pixelCoord);
            
            // Reduzir profundidade de cor
            float depthFactor = colorDepth / 32.0;
            vec3 ditheredColor = floor(color.rgb * colorDepth + threshold) / colorDepth;
            
            // Misturar com cor original baseado na intensidade
            vec3 finalColor = mix(color.rgb, ditheredColor, intensity);
            
            gl_FragColor = vec4(finalColor, color.a);
          }
        `
      };

      const psxDitheringPass = new ShaderPass(psxDitheringShader);
      composer.addPass(psxDitheringPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Dithering:', error);
    }
  }

  addPSXJitter(vertexJitter = 0.008, uvJitter = 0.005, timeScale = 500.0) {
    try {
      const psxJitterShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'vertexJitter': { value: vertexJitter },
          'uvJitter': { value: uvJitter },
          'timeScale': { value: timeScale },
          'time': { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          uniform float time;
          uniform float timeScale;
          uniform float vertexJitter;
          
          void main() {
            vUv = uv;
            
            // Aplicar jitter nos vértices (simulando baixa precisão PSX)
            vec3 jitteredPosition = position;
            jitteredPosition.xy = floor(jitteredPosition.xy * 10.0) / 10.0;
            
            // Adicionar distorção nos vértices
            jitteredPosition.x += sin(position.y * 10.0 + time * timeScale) * vertexJitter;
            jitteredPosition.y += cos(position.x * 10.0 + time * timeScale) * vertexJitter;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(jitteredPosition, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uvJitter;
          uniform float time;
          uniform float timeScale;
          varying vec2 vUv;
          
          void main() {
            // Aplicar distorção nas coordenadas UV
            vec2 distortedUV = vUv;
            distortedUV.x += sin(vUv.y * 8.0 + time * timeScale) * uvJitter;
            distortedUV.y += cos(vUv.x * 8.0 + time * timeScale) * uvJitter;
            
            vec4 color = texture2D(tDiffuse, distortedUV);
            gl_FragColor = color;
          }
        `
      };

      const psxJitterPass = new ShaderPass(psxJitterShader);
      composer.addPass(psxJitterPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Jitter:', error);
    }
  }

  addPSXPixelation(pixelSize = 8, resolution = 0.5) {
    try {
      const psxPixelationShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'pixelSize': { value: pixelSize },
          'resolution': { value: resolution },
          'screenSize': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float pixelSize;
          uniform float resolution;
          uniform vec2 screenSize;
          varying vec2 vUv;
          
          void main() {
            // Reduzir resolução
            vec2 pixelatedUV = floor(vUv * screenSize * resolution / pixelSize) * pixelSize / screenSize;
            
            vec4 color = texture2D(tDiffuse, pixelatedUV);
            gl_FragColor = color;
          }
        `
      };

      const psxPixelationPass = new ShaderPass(psxPixelationShader);
      composer.addPass(psxPixelationPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Pixelation:', error);
    }
  }

  addPSXScanlines(density = 0.04, opacity = 0.6, count = 512) {
    try {
      const psxScanlinesShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'density': { value: density },
          'opacity': { value: opacity },
          'count': { value: count },
          'time': { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float density;
          uniform float opacity;
          uniform float count;
          uniform float time;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Criar scanlines
            float scanline = sin(vUv.y * count + time * 100.0) * 0.5 + 0.5;
            scanline = pow(scanline, density * 10.0);
            
            // Aplicar scanlines
            color.rgb *= mix(1.0, scanline, opacity);
            
            gl_FragColor = color;
          }
        `
      };

      const psxScanlinesPass = new ShaderPass(psxScanlinesShader);
      composer.addPass(psxScanlinesPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Scanlines:', error);
    }
  }

  addPSXColorBanding(bands = 16, intensity = 1.0) {
    try {
      const psxColorBandingShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'bands': { value: bands },
          'intensity': { value: intensity }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float bands;
          uniform float intensity;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Aplicar banding de cor
            vec3 bandedColor = floor(color.rgb * bands) / bands;
            
            // Misturar com cor original
            vec3 finalColor = mix(color.rgb, bandedColor, intensity);
            
            gl_FragColor = vec4(finalColor, color.a);
          }
        `
      };

      const psxColorBandingPass = new ShaderPass(psxColorBandingShader);
      composer.addPass(psxColorBandingPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Color Banding:', error);
    }
  }

  addPSXTextureWarping(warpStrength = 0.01, warpSpeed = 5.0) {
    try {
      const psxTextureWarpingShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'warpStrength': { value: warpStrength },
          'warpSpeed': { value: warpSpeed },
          'time': { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float warpStrength;
          uniform float warpSpeed;
          uniform float time;
          varying vec2 vUv;
          
          void main() {
            // Aplicar distorção de textura
            vec2 warpedUV = vUv;
            warpedUV.x += sin(vUv.y * 10.0 + time * warpSpeed) * warpStrength;
            warpedUV.y += cos(vUv.x * 10.0 + time * warpSpeed) * warpStrength;
            
            vec4 color = texture2D(tDiffuse, warpedUV);
            gl_FragColor = color;
          }
        `
      };

      const psxTextureWarpingPass = new ShaderPass(psxTextureWarpingShader);
      composer.addPass(psxTextureWarpingPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Texture Warping:', error);
    }
  }

  addPSXFog(near = 10, far = 100, density = 0.1) {
    try {
      const psxFogShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'fogNear': { value: near },
          'fogFar': { value: far },
          'fogDensity': { value: density },
          'fogColor': { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
          varying vec2 vUv;
          varying float vFogDepth;
          void main() {
            vUv = uv;
            vFogDepth = -(modelViewMatrix * vec4(position, 1.0)).z;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float fogNear;
          uniform float fogFar;
          uniform float fogDensity;
          uniform vec3 fogColor;
          varying vec2 vUv;
          varying float vFogDepth;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Aplicar fog PSX
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            fogFactor = pow(fogFactor, fogDensity * 10.0);
            
            vec3 finalColor = mix(fogColor, color.rgb, fogFactor);
            
            gl_FragColor = vec4(finalColor, color.a);
          }
        `
      };

      const psxFogPass = new ShaderPass(psxFogShader);
      composer.addPass(psxFogPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Fog:', error);
    }
  }

  addPSXVertexPrecision(precision = 10.0, intensity = 1.0) {
    try {
      const psxVertexPrecisionShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'precision': { value: precision },
          'intensity': { value: intensity },
          'time': { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          uniform float precision;
          uniform float intensity;
          uniform float time;
          
          void main() {
            vUv = uv;
            
            // Simular baixa precisão de vértices PSX
            vec3 jitteredPosition = position;
            jitteredPosition.xy = floor(jitteredPosition.xy * precision) / precision;
            
            // Adicionar jitter baseado na intensidade
            jitteredPosition.x += sin(position.y * precision + time * 100.0) * 0.001 * intensity;
            jitteredPosition.y += cos(position.x * precision + time * 100.0) * 0.001 * intensity;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(jitteredPosition, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            gl_FragColor = color;
          }
        `
      };

      const psxVertexPrecisionPass = new ShaderPass(psxVertexPrecisionShader);
      composer.addPass(psxVertexPrecisionPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar PSX Vertex Precision:', error);
    }
  }

  // ========================================
  // 🌀 EFEITOS DE DISTORÇÃO
  // ========================================

  addBarrelDistortion(strength = 0.1, cylindricalRatio = 1.0) {
    try {
      const barrelShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'strength': { value: strength },
          'cylindricalRatio': { value: cylindricalRatio }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float strength;
          uniform float cylindricalRatio;
          varying vec2 vUv;
          
          void main() {
            vec2 coord = vUv * 2.0 - 1.0;
            
            // Aplicar distorção barril
            float theta = atan(coord.y, coord.x);
            float radius = length(coord);
            
            radius = pow(radius, 1.0 + strength);
            
            vec2 distortedCoord = vec2(
              radius * cos(theta),
              radius * sin(theta) * cylindricalRatio
            );
            
            distortedCoord = (distortedCoord + 1.0) * 0.5;
            
            // Verificar se está dentro dos limites
            if (distortedCoord.x >= 0.0 && distortedCoord.x <= 1.0 &&
                distortedCoord.y >= 0.0 && distortedCoord.y <= 1.0) {
              gl_FragColor = texture2D(tDiffuse, distortedCoord);
            } else {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
          }
        `
      };

      const barrelPass = new ShaderPass(barrelShader);
      composer.addPass(barrelPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Barrel Distortion:', error);
    }
  }

  addFisheye(strength = 0.5) {
    try {
      const fisheyeShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'strength': { value: strength }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float strength;
          varying vec2 vUv;
          
          void main() {
            vec2 coord = vUv - 0.5;
            float len = length(coord);
            
            // Aplicar distorção fisheye
            float z = sqrt(1.0 - len * len);
            float r = atan(len, z) / 3.14159;
            
            float phi = atan(coord.y, coord.x);
            
            vec2 fisheyeCoord = vec2(
              r * cos(phi) + 0.5,
              r * sin(phi) + 0.5
            );
            
            // Misturar com coordenadas originais
            vec2 finalCoord = mix(vUv, fisheyeCoord, strength);
            
            if (finalCoord.x >= 0.0 && finalCoord.x <= 1.0 &&
                finalCoord.y >= 0.0 && finalCoord.y <= 1.0) {
              gl_FragColor = texture2D(tDiffuse, finalCoord);
            } else {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
          }
        `
      };

      const fisheyePass = new ShaderPass(fisheyeShader);
      composer.addPass(fisheyePass);
    } catch (error) {
      console.error('❌ Erro ao adicionar Fisheye:', error);
    }
  }

  // ========================================
  // 📊 EFEITOS DE PERFORMANCE
  // ========================================

  addLUT(lutTexture, amount = 1.0) {
    try {
      const lutShader = {
        uniforms: {
          'tDiffuse': { value: null },
          'lutTexture': { value: lutTexture },
          'amount': { value: amount }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform sampler2D lutTexture;
          uniform float amount;
          varying vec2 vUv;
          
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Aplicar LUT
            float blueColor = color.b * 63.0;
            
            vec2 quad1;
            quad1.y = floor(floor(blueColor) / 8.0);
            quad1.x = floor(blueColor) - (quad1.y * 8.0);
            
            vec2 quad2;
            quad2.y = floor(ceil(blueColor) / 8.0);
            quad2.x = ceil(blueColor) - (quad2.y * 8.0);
            
            vec2 texPos1;
            texPos1.x = (quad1.x * 0.125) + 0.5/512.0 + ((0.125 - 1.0/512.0) * color.r);
            texPos1.y = (quad1.y * 0.125) + 0.5/512.0 + ((0.125 - 1.0/512.0) * color.g);
            
            vec2 texPos2;
            texPos2.x = (quad2.x * 0.125) + 0.5/512.0 + ((0.125 - 1.0/512.0) * color.r);
            texPos2.y = (quad2.y * 0.125) + 0.5/512.0 + ((0.125 - 1.0/512.0) * color.g);
            
            vec4 newColor1 = texture2D(lutTexture, texPos1);
            vec4 newColor2 = texture2D(lutTexture, texPos2);
            
            vec4 newColor = mix(newColor1, newColor2, fract(blueColor));
            
            gl_FragColor = mix(color, newColor, amount);
          }
        `
      };

      const lutPass = new ShaderPass(lutShader);
      composer.addPass(lutPass);
    } catch (error) {
      console.error('❌ Erro ao adicionar LUT:', error);
    }
  }

  // Sistema dinâmico para shaders personalizados
  addCustomShader(shaderConfig) {
    const {
      name = 'customShader',
      vertexShader,
      fragmentShader,
      uniforms = {},
      enabled = true
    } = shaderConfig;

    // Verificar se os shaders foram fornecidos
    if (!vertexShader || !fragmentShader) {
      console.error('Shader personalizado requer vertexShader e fragmentShader!');
      return null;
    }

    // Criar o shader personalizado
    const customShader = {
      uniforms: {
        'tDiffuse': { value: null },
        ...uniforms
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader
    };

    // Criar e adicionar o passe
    const customPass = new ShaderPass(customShader);
    customPass.name = name;
    customPass.enabled = enabled;

    composer.addPass(customPass);

    return customPass;
  }

  // Função para aplicar múltiplos shaders de uma vez
  addShaderPack(shaderPack) {
    const results = [];

    shaderPack.forEach(shaderConfig => {
      const result = this.addCustomShader(shaderConfig);
      if (result) {
        results.push(result);
      }
    });

    return results;
  }

  // Função para remover shader por nome
  removeShader(shaderName) {
    const passes = composer.passes;
    for (let i = passes.length - 1; i >= 0; i--) {
      if (passes[i].name === shaderName) {
        composer.removePass(passes[i]);
        return true;
      }
    }
    console.warn(`Shader "${shaderName}" não encontrado!`);
    return false;
  }

  // Função para listar todos os shaders ativos
  listActiveShaders() {
    const activeShaders = [];
    composer.passes.forEach((pass, index) => {
      if (pass.name) {
        activeShaders.push({
          index: index,
          name: pass.name,
          enabled: pass.enabled
        });
      }
    });
    return activeShaders;
  }

  addTexture(texture) {
    const texturePass = new TexturePass(texture);
    composer.addPass(texturePass);
  }

  render() {
    composer.render();
  }
}

export function audioPlayer(path) {
  const sound = new THREE.Audio(listener);

  audioLoader.load(fileSystem.sounds + '/' + path, function (buffer) {
    sound.setBuffer(buffer);
    sound.setVolume(1);
  });

  return sound;
}

export class Geometry {
  createSphere(r, h, v, c) {
    let sphereGeometry = new THREE.SphereGeometry(r, h, v);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let sphere = new THREE.Mesh(sphereGeometry, material);

    return sphere;
  }

  createBox(width, height, depth, c) {
    let boxGeometry = new THREE.BoxGeometry(width, height, depth);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let box = new THREE.Mesh(boxGeometry, material);
    box.castShadow = true;
    box.receiveShadow = true;

    return box;
  }

  createCylinder(radiusTop, radiusBottom, height, radialSegments, c) {
    let cylinderGeometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let cylinder = new THREE.Mesh(cylinderGeometry, material);
    cylinder.castShadow = true;
    cylinder.receiveShadow = true;

    return cylinder;
  }

  createCone(radius, height, radialSegments, c) {
    let coneGeometry = new THREE.ConeGeometry(radius, height, radialSegments);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let cone = new THREE.Mesh(coneGeometry, material);
    cone.castShadow = true;
    cone.receiveShadow = true;

    return cone;
  }

  createPlane(width, height, c) {
    let planeGeometry = new THREE.PlaneGeometry(width, height);
    let material = new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide });
    let plane = new THREE.Mesh(planeGeometry, material);
    plane.castShadow = true;
    plane.receiveShadow = true;

    return plane;
  }

  createTorus(radius, tube, radialSegments, tubularSegments, c) {
    let torusGeometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let torus = new THREE.Mesh(torusGeometry, material);
    torus.castShadow = true;
    torus.receiveShadow = true;

    return torus;
  }

  createIcosahedron(radius, detail, c) {
    let icosahedronGeometry = new THREE.IcosahedronGeometry(radius, detail);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let icosahedron = new THREE.Mesh(icosahedronGeometry, material);

    return icosahedron;
  }

  createDodecahedron(radius, detail, c) {
    let dodecahedronGeometry = new THREE.DodecahedronGeometry(radius, detail);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let dodecahedron = new THREE.Mesh(dodecahedronGeometry, material);

    return dodecahedron;
  }

  createTetrahedron(radius, detail, c) {
    let tetrahedronGeometry = new THREE.TetrahedronGeometry(radius, detail);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let tetrahedron = new THREE.Mesh(tetrahedronGeometry, material);

    return tetrahedron;
  }

  createTorusKnot(radius, tube, tubularSegments, radialSegments, p, q, c) {
    let torusKnotGeometry = new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments, p, q);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let torusKnot = new THREE.Mesh(torusKnotGeometry, material);

    return torusKnot;
  }

  createRing(innerRadius, outerRadius, thetaSegments, phiSegments, c) {
    let ringGeometry = new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments);
    let material = new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide });
    let ring = new THREE.Mesh(ringGeometry, material);

    return ring;
  }

  createOctahedron(radius, detail, c) {
    let octahedronGeometry = new THREE.OctahedronGeometry(radius, detail);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let octahedron = new THREE.Mesh(octahedronGeometry, material);

    return octahedron;
  }

  createTube(path, tubularSegments, radius, radialSegments, closed, c) {
    let tubeGeometry = new THREE.TubeGeometry(path, tubularSegments, radius, radialSegments, closed);
    let material = new THREE.MeshStandardMaterial({ color: c });
    let tube = new THREE.Mesh(tubeGeometry, material);

    return tube;
  }
}

export class Physics {
  addSpherePhysics(object, radius, mass, position = null) {
    // Usar a posição do objeto Three.js se a posição não for fornecida
    const objPosition = position || [object.position.x, object.position.y, object.position.z];

    let sphereShape = new CANNON.Sphere(radius);
    let sphereBody = new CANNON.Body({
      mass: mass,
      position: new CANNON.Vec3(...objPosition),
      shape: sphereShape
    });

    sphereBody.threeObject = object; // Associar o objeto Three.js ao corpo
    object.body = sphereBody; // Associar o corpo ao objeto Three.js



    world.addBody(object.body);
    return sphereBody;
  }

  addBoxPhysics(object, width, height, depth, mass, position = null) {
    // Usar a posição do objeto Three.js se a posição não for fornecida
    const objPosition = position || [object.position.x, object.position.y, object.position.z];

    let boxShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
    let boxBody = new CANNON.Body({
      mass: mass,
      position: new CANNON.Vec3(...objPosition),
      shape: boxShape
    });

    boxBody.threeObject = object; // Associar o objeto Three.js ao corpo

    object.body = boxBody; // Associar o corpo ao objeto Three.js


    world.addBody(object.body);
    return boxBody;
  }

  addCylinderPhysics(object, radiusTop, radiusBottom, height, mass, position = null) {
    // Usar a posição do objeto Three.js se a posição não for fornecida
    const objPosition = position || [object.position.x, object.position.y, object.position.z];

    let cylinderShape = new CANNON.Cylinder(radiusTop, radiusBottom, height, 8);
    let cylinderBody = new CANNON.Body({
      mass: mass,
      position: new CANNON.Vec3(...objPosition),
      shape: cylinderShape
    });

    cylinderBody.threeObject = object; // Associar o objeto Three.js ao corpo

    object.body = cylinderBody; // Associar o corpo ao objeto Three.js
    world.addBody(object.body);
    return cylinderBody;
  }

  addPlanePhysics(object, mass, position = null) {
    // Usar a posição do objeto Three.js se a posição não for fornecida
    const objPosition = position || [object.position.x, object.position.y, object.position.z];

    let planeShape = new CANNON.Plane();
    let planeBody = new CANNON.Body({
      mass: mass,
      position: new CANNON.Vec3(...objPosition),
      shape: planeShape
    });

    planeBody.threeObject = object; // Associar o objeto Three.js ao corpo

    object.body = planeBody; // Associar o corpo ao objeto Three.js
    world.addBody(object.body);
    return planeBody;
  }

  addCustomPhysics(object, shape, mass, position = null) {
    // Usar a posição do objeto Three.js se a posição não for fornecida
    const objPosition = position || [object.position.x, object.position.y, object.position.z];

    let customBody = new CANNON.Body({
      mass: mass,
      position: new CANNON.Vec3(...objPosition),
      shape: shape
    });

    customBody.threeObject = object; // Associar o objeto Three.js ao corpo

    object.body = customBody; // Associar o corpo ao objeto Three.js
    world.addBody(object.body);
    return customBody;
  }
}

export class Animation {
  createAnimator(model) {
    // Se model é um sceneObject, usar o gameObject
    const targetObject = model.gameObject || model;
    const animator = new THREE.AnimationMixer(targetObject);

    // Associar o animator ao local correto
    if (model.gameObject) {
      model.animator = animator;
      model.gameObject.animator = animator;
    } else {
      model.animator = animator;
    }

    return animator;
  }



  playAnimation(animator, animation) {
    if (animation) {
      const action = animator.clipAction(animation);
      action.play();  // Toca a primeira animação
    }
  }
}

// Sistema avançado de animação para o Inspector
export function getObjectAnimations(objectName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return null;
  }

  // ✅ CORREÇÃO: Buscar animações de forma mais robusta
  let animations = [];
  let animator = null;

  // Se é um objeto do array sceneObjects
  if (sceneObject.gameObject) {
    // ✅ CORREÇÃO: Verificar animações no gameObject primeiro (modelo carregado)
    if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
    // Se não encontrou no gameObject, verificar no sceneObject
    else if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  // ✅ CORREÇÃO: Se ainda não encontrou, tentar buscar no objeto da cena Three.js
  if (animations.length === 0) {
    const sceneObjectDirect = scene.getObjectByName(objectName);
    if (sceneObjectDirect && sceneObjectDirect.animations && sceneObjectDirect.animations.length > 0) {
      animations = sceneObjectDirect.animations;
      animator = sceneObjectDirect.animator;  
    }
  }

  const result = [];

  // Processar as animações encontradas
  if (animations.length > 0) {
    animations.forEach((clip, index) => {
      result.push({
        id: index,
        name: clip.name || `Animation_${index}`,
        duration: clip.duration,
        tracks: clip.tracks.length,
        loop: clip.loop || 2201, // THREE.LoopRepeat = 2201
        isPlaying: false,
        currentTime: 0,
        speed: 1.0
      });
    });
  }

  // Verificar se há animações em ações ativas do animator
  if (animator && animator._actions) {
    animator._actions.forEach((action, index) => {
      if (action._clip) {
        const existingAnim = result.find(anim => anim.name === action._clip.name);
        if (existingAnim) {
          existingAnim.isPlaying = action.isRunning();
          existingAnim.currentTime = action.time;
          existingAnim.speed = action.timeScale;
          existingAnim.loop = action.loop ? String(action.loop) : 'default';
        }
      }
    });
  }



  return {
    objectName: objectName,
    hasAnimations: result.length > 0,
    animations: result,
    animator: animator ? true : false
  };
}

export function playObjectAnimation(objectName, animationName, options = {}) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // ✅ CORREÇÃO: Buscar animações e animator de forma mais robusta
  let animations = null;
  let animator = null;
  let targetObject = null;

  // Se é um objeto do array sceneObjects
  if (sceneObject.gameObject) {
    targetObject = sceneObject.gameObject;
    // Verificar animações no sceneObject primeiro
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    targetObject = sceneObject;
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  // ✅ CORREÇÃO: Se não encontrou animações, tentar buscar no modelo carregado
  if (!animations || animations.length === 0) {

    // Verificar se o targetObject tem animações (pode ter sido carregado pelo LoadModelGLB)
    if (targetObject && targetObject.animations && targetObject.animations.length > 0) {
      animations = targetObject.animations;
    } else {
      console.warn('❌ Nenhuma animação encontrada para o objeto:', objectName);
      return false;
    }
  }

  // ✅ CORREÇÃO: Criar animator se não existir
  if (!animator) {
    animator = new THREE.AnimationMixer(targetObject);

    // ✅ Associar o animator criado
    if (sceneObject.gameObject) {
      sceneObject.animator = animator;
      sceneObject.gameObject.animator = animator;
    } else {
      sceneObject.animator = animator;
    }

  } else {
  }

  // Encontrar a animação
  let targetAnimation = null;
  if (animations) {
    targetAnimation = animations.find(clip => clip.name === animationName);
  }

  if (!targetAnimation) {
    console.warn('❌ Animação não encontrada:', animationName);
    return false;
  }

  // ✅ NOVA IMPLEMENTAÇÃO: Sistema de transições suaves
  const currentActions = animator._actions.filter(action => action.isRunning());
  const newAction = animator.clipAction(targetAnimation);

  // Configurar a nova ação
  if (options.loop !== undefined) {
    // ✅ CORREÇÃO: Converter strings para constantes do Three.js
    if (options.loop === 'loop' || options.loop === 'repeat') {
      newAction.setLoop(THREE.LoopRepeat, options.repetitions || Infinity);
    } else if (options.loop === 'once' || options.loop === 'once') {
      newAction.setLoop(THREE.LoopOnce, 1);
    } else if (options.loop === 'pingpong') {
      newAction.setLoop(THREE.LoopPingPong, options.repetitions || Infinity);
    } else {
      // Se for um número, usar diretamente
      newAction.setLoop(options.loop, options.repetitions || Infinity);
    }
  } else {
    // ✅ Padrão: Loop infinito
    newAction.setLoop(THREE.LoopRepeat);
  }

  if (options.speed !== undefined) {
    newAction.timeScale = options.speed;
  }
  if (options.startTime !== undefined) {
    newAction.time = options.startTime;
  }

  // ✅ SISTEMA DE TRANSIÇÕES SUAVES
  const transitionDuration = options.transitionDuration || 0.3; // Duração padrão da transição

  // ✅ CORREÇÃO T-POSE: Configurar callback para animações 'once'
  if (options.loop === 'once') {
    // Adicionar listener para detectar quando a animação termina
    const onFinished = () => {

      // ✅ LÓGICA MELHORADA: Verificar se o fallback é válido antes de tocar
      let fallbackAnimationName = null;

      if (options.fallbackAnimation) {
        // Verificar se a animação de fallback especificada existe
        const fallbackExists = animations.find(clip => clip.name === options.fallbackAnimation);
        if (fallbackExists) {
          fallbackAnimationName = options.fallbackAnimation;
        } else {
          console.warn('⚠️ Animação de fallback especificada não existe:', options.fallbackAnimation);
        }
      }

      // Se não foi especificado fallback ou não existe, procurar por animações apropriadas
      if (!fallbackAnimationName) {
        // ✅ LÓGICA INTELIGENTE: Priorizar animações apropriadas baseado no contexto
        const priorityAnimations = [
          'idle', 'Idle', 'IDLE',
          'stand', 'Stand', 'STAND',
          'wait', 'Wait', 'WAIT',
          'rest', 'Rest', 'REST'
        ];

        // Procurar por animações de prioridade
        for (const priorityName of priorityAnimations) {
          const foundAnimation = animations.find(clip => clip.name === priorityName);
          if (foundAnimation) {
            fallbackAnimationName = foundAnimation.name;
            break;
          }
        }

        // Se não encontrou animação de prioridade, procurar por nomes que contenham 'idle'
        if (!fallbackAnimationName) {
          const idleAnimation = animations.find(clip =>
            clip.name.toLowerCase().includes('idle') ||
            clip.name.toLowerCase().includes('stand') ||
            clip.name.toLowerCase().includes('wait')
          );

          if (idleAnimation) {
            fallbackAnimationName = idleAnimation.name;
          }
        }

        // Se ainda não encontrou, usar a primeira animação disponível (exceto a atual)
        if (!fallbackAnimationName && animations.length > 1) {
          const availableAnimations = animations.filter(clip => clip.name !== animationName);
          if (availableAnimations.length > 0) {
            fallbackAnimationName = availableAnimations[0].name;
          }
        }
      }

      // Tocar a animação de fallback se encontrou uma válida
      if (fallbackAnimationName) {
        playObjectAnimation(objectName, fallbackAnimationName, {
          loop: 'loop',
          speed: options.fallbackSpeed || 0.5,
          transitionDuration: options.fallbackTransitionDuration || 0.2,
          smoothTransition: options.smoothTransition !== false
        });
      } else {
        console.warn('⚠️ Animação "once" terminou mas não foi encontrada animação de fallback válida');
      }
    };

    // Adicionar o listener ao mixer
    animator.addEventListener('finished', onFinished);

    // Armazenar o listener para poder removê-lo depois se necessário
    if (!animator._onceListeners) {
      animator._onceListeners = new Map();
    }
    animator._onceListeners.set(animationName, onFinished);
  }

  if (currentActions.length > 0 && options.smoothTransition !== false) {
    // Fazer crossfade entre animações atuais e nova

    // Configurar a nova ação para crossfade
    newAction.reset();
    newAction.setEffectiveTimeScale(1);
    newAction.setEffectiveWeight(1);
    newAction.play();

    // Fazer crossfade com todas as ações atuais
    currentActions.forEach(action => {
      action.crossFadeTo(newAction, transitionDuration, true);
    });
  } else {
    // Se não há animações atuais ou transição suave está desabilitada
    if (currentActions.length > 0) {
      animator.stopAllAction();
    }
    newAction.play();
  }

  // No modo editor os mixers ficam congelados (timeScale 0); liberar para preview no Inspector
  if (editorMode && animator) {
    animator.timeScale = 1;
  }

  return true;
}

// ✅ NOVA FUNÇÃO: Remover listeners de animações 'once'
export function removeOnceListener(objectName, animationName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  let animator = null;
  if (sceneObject.gameObject && sceneObject.gameObject.animator) {
    animator = sceneObject.gameObject.animator;
  } else if (sceneObject.animator) {
    animator = sceneObject.animator;
  }

  if (!animator || !animator._onceListeners) {
    return false;
  }

  const listener = animator._onceListeners.get(animationName);
  if (listener) {
    animator.removeEventListener('finished', listener);
    animator._onceListeners.delete(animationName);
    return true;
  }

  return false;
}

// ✅ NOVA FUNÇÃO: Limpar todos os listeners de animações 'once'
export function clearOnceListeners(objectName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  let animator = null;
  if (sceneObject.gameObject && sceneObject.gameObject.animator) {
    animator = sceneObject.gameObject.animator;
  } else if (sceneObject.animator) {
    animator = sceneObject.animator;
  }

  if (!animator || !animator._onceListeners) {
    return false;
  }

  animator._onceListeners.forEach((listener, animationName) => {
    animator.removeEventListener('finished', listener);
  });
  animator._onceListeners.clear();
  return true;
}

// ✅ NOVA FUNÇÃO: Verificar se uma animação existe
export function hasAnimation(objectName, animationName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    return false;
  }

  let animations = null;

  // Se é um objeto do array sceneObjects
  if (sceneObject.gameObject) {
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
    } else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
    }
  } else {
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
    }
  }

  if (!animations) {
    return false;
  }

  return animations.some(clip => clip.name === animationName);
}

// ✅ NOVA FUNÇÃO: Obter lista de animações disponíveis
export function getAvailableAnimations(objectName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    return [];
  }

  let animations = null;

  // Se é um objeto do array sceneObjects
  if (sceneObject.gameObject) {
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
    } else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
    }
  } else {
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
    }
  }

  if (!animations) {
    return [];
  }

  return animations.map(clip => clip.name);
}

// ✅ NOVA FUNÇÃO: Gerenciar transições entre animações de forma mais controlada
export function crossfadeAnimation(objectName, fromAnimation, toAnimation, options = {}) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  let animator = null;
  if (sceneObject.gameObject && sceneObject.gameObject.animator) {
    animator = sceneObject.gameObject.animator;
  } else if (sceneObject.animator) {
    animator = sceneObject.animator;
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  const fromAction = animator.clipAction(fromAnimation);
  const toAction = animator.clipAction(toAnimation);

  // Configurar a nova ação
  if (options.loop !== undefined) {
    if (options.loop === 'loop' || options.loop === 'repeat') {
      toAction.setLoop(THREE.LoopRepeat, options.repetitions || Infinity);
    } else if (options.loop === 'once') {
      toAction.setLoop(THREE.LoopOnce, 1);
    } else if (options.loop === 'pingpong') {
      toAction.setLoop(THREE.LoopPingPong, options.repetitions || Infinity);
    } else {
      toAction.setLoop(options.loop, options.repetitions || Infinity);
    }
  }

  if (options.speed !== undefined) {
    toAction.timeScale = options.speed;
  }

  const duration = options.duration || 0.3;

  // Fazer crossfade
  fromAction.crossFadeTo(toAction, duration, true);



  return true;
}

// ✅ NOVA FUNÇÃO: Verificar se uma animação está tocando
export function isAnimationPlaying(objectName, animationName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    return false;
  }

  let animator = null;
  if (sceneObject.gameObject && sceneObject.gameObject.animator) {
    animator = sceneObject.gameObject.animator;
  } else if (sceneObject.animator) {
    animator = sceneObject.animator;
  }

  if (!animator) {
    return false;
  }

  const action = animator.clipAction(animationName);
  return action.isRunning();
}

// ✅ NOVA FUNÇÃO: Obter informações sobre animações ativas
export function getActiveAnimations(objectName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    return [];
  }

  let animator = null;
  if (sceneObject.gameObject && sceneObject.gameObject.animator) {
    animator = sceneObject.gameObject.animator;
  } else if (sceneObject.animator) {
    animator = sceneObject.animator;
  }

  if (!animator) {
    return [];
  }

  return animator._actions.filter(action => action.isRunning()).map(action => ({
    name: action._clip.name,
    time: action.time,
    timeScale: action.timeScale,
    weight: action.getEffectiveWeight(),
    loop: action.loop
  }));
}

export function stopObjectAnimation(objectName, animationName = null) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  if (animationName) {
    // Parar animação específica
    const targetAnimation = animations?.find(clip => clip.name === animationName);
    if (targetAnimation) {
      const action = animator.clipAction(targetAnimation);
      action.stop();
    }
  } else {
    // Parar todas as animações
    animator.stopAllAction();
  }

  return true;
}

export function pauseObjectAnimation(objectName, animationName = null) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  if (animationName) {
    // Pausar animação específica
    const targetAnimation = animations?.find(clip => clip.name === animationName);
    if (targetAnimation) {
      const action = animator.clipAction(targetAnimation);
      action.paused = true;
    }
  } else {
    // Pausar todas as animações
    const actions = animator._actions;
    if (actions) {
      actions.forEach(action => {
        action.paused = true;
      }); 
    }
  }

  return true;
}

export function resumeObjectAnimation(objectName, animationName = null) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  if (animationName) {
    // Resumir animação específica
    const targetAnimation = animations?.find(clip => clip.name === animationName);
    if (targetAnimation) {
      const action = animator.clipAction(targetAnimation);
      action.paused = false;
    }
  } else {
    // Resumir todas as animações
    const actions = animator._actions;
    if (actions) {
      actions.forEach(action => {
        action.paused = false;
      });
    }
  }

  return true;
}

export function setAnimationSpeed(objectName, animationName, speed) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  if (animationName) {
    // Definir velocidade para animação específica
    const targetAnimation = animations?.find(clip => clip.name === animationName);
    if (targetAnimation) {
      const action = animator.clipAction(targetAnimation);
      action.timeScale = speed;
    }
  } else {
    // Definir velocidade para todas as animações
    const actions = animator._actions;
    if (actions) {
      actions.forEach(action => {
        action.timeScale = speed;
      });
    }
  }

  return true;
}

export function setAnimationLoop(objectName, animationName, loopType, repetitions = Infinity) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  const targetAnimation = animations?.find(clip => clip.name === animationName);
  if (targetAnimation) {
    const action = animator.clipAction(targetAnimation);
    action.setLoop(loopType, repetitions);
  }

  return true;
}

export function getAnimationState(objectName, animationName) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    return null;
  }

  // Verificar se é um objeto do array sceneObjects ou um objeto direto da cena
  let object = sceneObject;
  let animations = null;
  let animator = null;

  // Se é um objeto do array sceneObjects, verificar tanto no sceneObject quanto no gameObject
  if (sceneObject.gameObject) {
    // Verificar animações no sceneObject
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
    // Se não encontrou no sceneObject, verificar no gameObject
    else if (sceneObject.gameObject.animations && sceneObject.gameObject.animations.length > 0) {
      animations = sceneObject.gameObject.animations;
      animator = sceneObject.gameObject.animator;
    }
  } else {
    // Se é um objeto direto da cena
    if (sceneObject.animations && sceneObject.animations.length > 0) {
      animations = sceneObject.animations;
      animator = sceneObject.animator;
    }
  }

  if (!animator) {
    return null;
  }

  const targetAnimation = animations?.find(clip => clip.name === animationName);
  if (!targetAnimation) {
    return null;
  }

  const action = animator.clipAction(targetAnimation);
  if (!action) {
    return null;
  }

  return {
    isPlaying: Boolean(action.isRunning()),
    isPaused: Boolean(action.paused),
    currentTime: Number(action.time) || 0,
    duration: Number(targetAnimation.duration) || 0,
    speed: Number(action.timeScale) || 1,
    loop: action.loop ? String(action.loop) : 'default', // Converter para string
    weight: Number(action.weight) || 1
  };
}

// ✅ NOVA FUNÇÃO: Pular para tempo específico da animação
export function seekAnimation(objectName, animationName, time) {
  const sceneObject = findObjectByName(objectName);
  if (!sceneObject) {
    console.warn('❌ Objeto não encontrado:', objectName);
    return false;
  }

  let animator = null;

  if (sceneObject.gameObject) {
    animator = sceneObject.animator || sceneObject.gameObject.animator;
  } else {
    animator = sceneObject.animator;
  }

  if (!animator) {
    console.warn('❌ Animator não encontrado:', objectName);
    return false;
  }

  if (animationName) {
    // Pular para tempo específico da animação
    const actions = animator._actions;
    if (actions) {
      actions.forEach(action => {
        if (action._clip && action._clip.name === animationName) {
          action.time = time;
        }
      });
    }
  } else {
    // Pular para tempo de todas as animações
    const actions = animator._actions;
    if (actions) {
      actions.forEach(action => {
        action.time = time;
      }); 
    }
  }

  return true;
}

////////////////////editor////////////////////

let controls;

let raycaster, mouse;

export function transformControl() {
  return transformControls;
}

let attachObject;
export function setAttach(gameObject) {
  attachObject = gameObject;
  transformControls.attach(gameObject); // Anexa o pai
  gizmo.visible = true; // Torna o gizmo visível
  controls.enabled = false;
}

/*
window.addEventListener('click', (event) => {
  if (transformControls) {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true); // O segundo parâmetro verifica filhos

      
      if (intersects.length > 0) {
          const selectedObject = intersects[0].object;
          let objectToAttach = selectedObject;

          // Se o objeto selecionado for uma Mesh, pegue seu pai
          if (selectedObject instanceof THREE.Mesh) {
              objectToAttach = selectedObject.parent; // Pega o pai
             // console.log(objectToAttach);
          }

          // Verifica se o objeto pai é um Group ou Mesh
          if (objectToAttach instanceof THREE.Group) {
              transformControls.attach(objectToAttach); // Anexa o pai
              gizmo.visible = true; // Torna o gizmo visível
              controls.enabled = false; 
          }
      } else {
          transformControls.detach();
          gizmo.visible = false; // Esconde o gizmo
          controls.enabled = true; 
      }
  }
});*/


window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    attachObject = null;
    transformControls.detach(); // Desanexa o objeto
    gizmo.visible = false; // Esconde o gizmo
    controls.enabled = true; // Reativa os controles de orbit
  }
});

export function returnSceneObjectsList() {

  return sceneObjects;
}

// Função para obter lista de materiais disponíveis
export function getAvailableMaterials() {
  return Object.keys(MaterialPresets);
}

// Função para obter informações de materiais de um objeto
export function getObjectMaterials(object) {
  if (!object) return [];

  const materials = [];

  // Se o objeto tem material próprio
  if (object.material) {
    materials.push({
      name: object.name + '_material',
      type: object.material.type,
      properties: extractMaterialProperties(object.material),
      isMain: true
    });
  }

  // Percorrer todos os filhos para encontrar materiais
  object.traverse((child) => {
    if (child.material) {
      materials.push({
        name: child.name + '_material',
        type: child.material.type,
        properties: extractMaterialProperties(child.material),
        meshName: child.name,
        isMain: false
      });
    }
  });

  return materials;
}

// Função para extrair propriedades de um material
function extractMaterialProperties(material) {
  const properties = {
    type: material.type,
    color: material.color ? material.color.getHexString() : 'ffffff',
    metalness: material.metalness !== undefined ? material.metalness : 0,
    roughness: material.roughness !== undefined ? material.roughness : 0.5,
    opacity: material.opacity !== undefined ? material.opacity : 1.0,
    transparent: material.transparent || false,
    side: material.side ? material.side.toString() : 'FrontSide',
    wireframe: material.wireframe || false,
    flatShading: material.flatShading || false
  };


  // Propriedades de sombra (serão aplicadas ao mesh, não ao material)
  // Mas mantemos aqui para referência no Inspector
  properties.castShadow = true; // Padrão
  properties.receiveShadow = true; // Padrão

  // Propriedades específicas para materiais físicos
  if (material.ior !== undefined) properties.ior = material.ior;
  if (material.transmission !== undefined) properties.transmission = material.transmission;
  if (material.thickness !== undefined) properties.thickness = material.thickness;

  // Propriedades de emissão
  if (material.emissive) {
    properties.emissive = material.emissive.getHexString();
    properties.emissiveIntensity = material.emissiveIntensity || 1.0;
  }

  // Propriedades de mapas de textura
  if (material.map) {
    properties.hasDiffuseMap = true;
    // Extrair nome da textura de forma mais robusta
    let textureName = material.map.name;

    if (!textureName && material.map.source && material.map.source.data) {
      textureName = material.map.source.data.src ?
        material.map.source.data.src.split('/').pop().split('?')[0] :
        'diffuse';
    }
    properties.diffuseMapName = textureName || 'diffuse'; 
  }
  if (material.normalMap) {
    properties.hasNormalMap = true;
    let textureName = material.normalMap.name;
    if (!textureName && material.normalMap.source && material.normalMap.source.data) {
      textureName = material.normalMap.source.data.src ?
        material.normalMap.source.data.src.split('/').pop().split('?')[0] :
        'normal';
    }
    properties.normalMapName = textureName || 'normal';
  }
  if (material.roughnessMap) {
    properties.hasRoughnessMap = true;
    let textureName = material.roughnessMap.name;
    if (!textureName && material.roughnessMap.source && material.roughnessMap.source.data) {
      textureName = material.roughnessMap.source.data.src ?
        material.roughnessMap.source.data.src.split('/').pop().split('?')[0] :
        'roughness';
    }
    properties.roughnessMapName = textureName || 'roughness';
  }
  if (material.metalnessMap) {
    properties.hasMetalnessMap = true;
    let textureName = material.metalnessMap.name;
    if (!textureName && material.metalnessMap.source && material.metalnessMap.source.data) {
      textureName = material.metalnessMap.source.data.src ?
        material.metalnessMap.source.data.src.split('/').pop().split('?')[0] :
        'metalness';
    }
    properties.metalnessMapName = textureName || 'metalness';
  }
  if (material.aoMap) {
    properties.hasAOMap = true;
    let textureName = material.aoMap.name;
    if (!textureName && material.aoMap.source && material.aoMap.source.data) {
      textureName = material.aoMap.source.data.src ?
        material.aoMap.source.data.src.split('/').pop().split('?')[0] :
        'ao';
    }
    properties.aoMapName = textureName || 'ao';
  }
  if (material.emissiveMap) {
    properties.hasEmissiveMap = true;
    let textureName = material.emissiveMap.name;
    if (!textureName && material.emissiveMap.source && material.emissiveMap.source.data) {
      textureName = material.emissiveMap.source.data.src ?
        material.emissiveMap.source.data.src.split('/').pop().split('?')[0] :
        'emissive';
    }
    properties.emissiveMapName = textureName || 'emissive';
  }
  if (material.envMap) {
    properties.hasEnvMap = true;
    let textureName = material.envMap.name;
    if (!textureName && material.envMap.source && material.envMap.source.data) {
      textureName = material.envMap.source.data.src ?
        material.envMap.source.data.src.split('/').pop().split('?')[0] :
        'environment';
    }
    properties.envMapName = textureName || 'environment';
  }

  // Extrair parâmetros de tiling e offset

  if (material.map) {
    properties.mapTiling = material.map.repeat ? material.map.repeat.toArray() : [1, 1];
    properties.mapOffset = material.map.offset ? material.map.offset.toArray() : [0, 0];
  }

  if (material.normalMap) {
    properties.normalMapTiling = material.normalMap.repeat ? material.normalMap.repeat.toArray() : [1, 1];
    properties.normalMapOffset = material.normalMap.offset ? material.normalMap.offset.toArray() : [0, 0];
  }

  if (material.roughnessMap) {
    properties.roughnessMapTiling = material.roughnessMap.repeat ? material.roughnessMap.repeat.toArray() : [1, 1];
    properties.roughnessMapOffset = material.roughnessMap.offset ? material.roughnessMap.offset.toArray() : [0, 0];
  }

  if (material.metalnessMap) {
    properties.metalnessMapTiling = material.metalnessMap.repeat ? material.metalnessMap.repeat.toArray() : [1, 1];
    properties.metalnessMapOffset = material.metalnessMap.offset ? material.metalnessMap.offset.toArray() : [0, 0];
  }

  if (material.aoMap) {
    properties.aoMapTiling = material.aoMap.repeat ? material.aoMap.repeat.toArray() : [1, 1];
    properties.aoMapOffset = material.aoMap.offset ? material.aoMap.offset.toArray() : [0, 0];
  }

  if (material.emissiveMap) {
    properties.emissiveMapTiling = material.emissiveMap.repeat ? material.emissiveMap.repeat.toArray() : [1, 1];
    properties.emissiveMapOffset = material.emissiveMap.offset ? material.emissiveMap.offset.toArray() : [0, 0];
  }

  // Extrair parâmetros de intensidade

  if (material.normalScale) {
    properties.normalScale = material.normalScale.toArray();
  }

  // Para as intensidades de mapas, vamos usar valores padrão por enquanto
  // pois não são propriedades nativas do THREE.js
  properties.roughnessMapIntensity = 1.0;
  properties.metalnessMapIntensity = 1.0;
  properties.aoMapIntensity = 1.0;
  properties.emissiveMapIntensity = 1.0;

  return properties;
}

// Função para extrair texturas de um material
function extractMaterialTextures(material) {
  const textures = {};

  // Extrair todas as texturas do material
  if (material.map) textures.map = material.map;
  if (material.normalMap) textures.normalMap = material.normalMap;
  if (material.roughnessMap) textures.roughnessMap = material.roughnessMap;
  if (material.metalnessMap) textures.metalnessMap = material.metalnessMap;
  if (material.aoMap) textures.aoMap = material.aoMap;
  if (material.emissiveMap) textures.emissiveMap = material.emissiveMap;
  if (material.envMap) textures.envMap = material.envMap;
  if (material.lightMap) textures.lightMap = material.lightMap;
  if (material.alphaMap) textures.alphaMap = material.alphaMap;
  if (material.displacementMap) textures.displacementMap = material.displacementMap;
  if (material.bumpMap) textures.bumpMap = material.bumpMap;
  if (material.specularMap) textures.specularMap = material.specularMap;
  if (material.specularIntensityMap) textures.specularIntensityMap = material.specularIntensityMap;
  if (material.specularColorMap) textures.specularColorMap = material.specularColorMap;
  if (material.anisotropyMap) textures.anisotropyMap = material.anisotropyMap;
  if (material.clearcoatMap) textures.clearcoatMap = material.clearcoatMap;
  if (material.clearcoatNormalMap) textures.clearcoatNormalMap = material.clearcoatNormalMap;
  if (material.clearcoatRoughnessMap) textures.clearcoatRoughnessMap = material.clearcoatRoughnessMap;
  if (material.iridescenceMap) textures.iridescenceMap = material.iridescenceMap;
  if (material.iridescenceThicknessMap) textures.iridescenceThicknessMap = material.iridescenceThicknessMap;
  if (material.sheenColorMap) textures.sheenColorMap = material.sheenColorMap;
  if (material.sheenRoughnessMap) textures.sheenRoughnessMap = material.sheenRoughnessMap;
  if (material.transmissionMap) textures.transmissionMap = material.transmissionMap;
  if (material.thicknessMap) textures.thicknessMap = material.thicknessMap;
  if (material.attenuationDistanceMap) textures.attenuationDistanceMap = material.attenuationDistanceMap;
  if (material.attenuationColorMap) textures.attenuationColorMap = material.attenuationColorMap;

  return textures;
}

// Função para aplicar material a um objeto
export function applyMaterialToObject(objectName, materialType, customProperties = {}) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  const object = scene.getObjectByName(objectName);
  if (!object) {
    console.error('❌ Objeto não encontrado:', objectName);
    return false;
  }

  try {
    // Função para aplicar material preservando texturas
    const applyMaterialWithTextures = (targetObject) => {
      if (!targetObject.material) return;

      // Extrair propriedades e texturas originais
      const originalProperties = extractMaterialProperties(targetObject.material);
      const originalTextures = extractMaterialTextures(targetObject.material);

      // Criar novo material
      const newMaterial = createCustomMaterial(materialType, customProperties, originalProperties);

      // Aplicar texturas originais ao novo material
      Object.keys(originalTextures).forEach(textureKey => {
        if (newMaterial[textureKey] !== undefined) {
          newMaterial[textureKey] = originalTextures[textureKey];
        }
      });

      // Limpar material antigo
      targetObject.material.dispose();

      // Aplicar novo material
      targetObject.material = newMaterial;

      // Forçar atualização
      newMaterial.needsUpdate = true;
    };

    // Aplicar ao objeto principal
    applyMaterialWithTextures(object);

    // Aplicar a todos os filhos
    object.traverse((child) => {
      if (child.material) {
        applyMaterialWithTextures(child);
      }
    });


    // Notificar o editor
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'MATERIAL_APPLIED',
        objectName: objectName,
        materialType: materialType,
        properties: customProperties,
        timestamp: Date.now()
      }, '*');
    }

    return true;
  } catch (error) {
    console.error('❌ Erro ao aplicar material:', error);
    return false;
  }
}

// Função para atualizar propriedade de material
export function updateMaterialProperty(objectName, propertyName, value) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  const object = scene.getObjectByName(objectName);
  if (!object) {
    console.error('❌ Objeto não encontrado:', objectName);
    return false;
  }

  try {
    // Função para atualizar propriedade em um material
    const updateMaterialProp = (material) => {
      if (!material) return;

      switch (propertyName) {
        case 'color':
          material.color.setHex(parseInt(value, 16));
          break;
        case 'metalness':
          material.metalness = parseFloat(value);
          break;
        case 'roughness':
          material.roughness = parseFloat(value);
          break;
        case 'opacity':
          material.opacity = parseFloat(value);
          material.transparent = parseFloat(value) < 1.0;
          break;
        case 'emissive':
          material.emissive.setHex(parseInt(value, 16));
          break;
        case 'emissiveIntensity':
          material.emissiveIntensity = parseFloat(value);
          break;
        case 'ior':
          if (material.ior !== undefined) material.ior = parseFloat(value);
          break;
        case 'transmission':
          if (material.transmission !== undefined) material.transmission = parseFloat(value);
          break;
        case 'thickness':
          if (material.thickness !== undefined) material.thickness = parseFloat(value);
          break;
        case 'wireframe':
          material.wireframe = Boolean(value);
          break;
        case 'flatShading':
          material.flatShading = Boolean(value);
          break;
        case 'castShadow':
        case 'receiveShadow':
          // Propriedades de sombra são aplicadas ao mesh, não ao material  
          return true; // Retornar true para indicar que foi processada
        default:
          console.warn('Propriedade de material não reconhecida:', propertyName);
          return false;
      }

      material.needsUpdate = true;
      return true;
    };

    // Atualizar material principal
    let updated = updateMaterialProp(object.material);

    // Atualizar materiais dos filhos
    object.traverse((child) => {
      if (child.material) {
        updated = updateMaterialProp(child.material) || updated;
      }
    });

    if (updated) {  

      // Notificar o editor
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'MATERIAL_PROPERTY_UPDATED',
          objectName: objectName,
          propertyName: propertyName,
          value: value,
          timestamp: Date.now()
        }, '*');
      }
    }

    return updated;
  } catch (error) {
    console.error('❌ Erro ao atualizar propriedade de material:', error);
    return false;
  }
}

// Função para criar material personalizado diretamente
export function createMaterial(materialType = 'default', customProperties = {}) {
  return createCustomMaterial(materialType, customProperties);
}

export class InGameUI {
  constructor(width, height) {
    if (!renderer) {
      console.error("Renderer not initialized before InGameUI.");
      return;
    }
    // A UI terá sua própria cena e câmera ortográfica
    uiScene = new THREE.Scene();
    uiCamera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 100);
    uiCamera.position.z = 50;

    this.width = width;
    this.height = height;
    this.elements = new Map();
    //// console.log('🎮 In-Game UI System Initialized.');

    // Modificar o renderer para renderizar as duas cenas
    renderer.autoClear = false;
  }

  _createTextTexture(text, options) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const fontSize = options.fontSize || 32;
    const fontFamily = options.fontFamily || 'Arial';
    context.font = `${fontSize}px ${fontFamily}`;

    // Medir o texto para definir o tamanho do canvas
    const metrics = context.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    // Definir o tamanho do canvas com padding adequado
    const padding = options.padding || 20;
    canvas.width = Math.max(64, textWidth + padding * 2); // Mínimo de 64px
    canvas.height = Math.max(64, textHeight + padding * 2);

    // Reaplicar fontes e estilos após redimensionar
    context.font = `${fontSize}px ${fontFamily}`;
    context.fillStyle = options.color || '#FFFFFF';
    context.textAlign = options.textAlign || 'left';
    context.textBaseline = 'middle';

    // Sombra
    if (options.shadowColor) context.shadowColor = options.shadowColor;
    if (options.shadowBlur) context.shadowBlur = options.shadowBlur;
    if (options.shadowOffsetX) context.shadowOffsetX = options.shadowOffsetX;
    if (options.shadowOffsetY) context.shadowOffsetY = options.shadowOffsetY;

    let x = canvas.width / 2; // Padrão para 'center'
    if (context.textAlign === 'left') x = padding;
    if (context.textAlign === 'right') x = canvas.width - padding;

    // Borda (stroke)
    if (options.strokeColor && options.strokeWidth) {
      context.lineWidth = options.strokeWidth;
      context.strokeStyle = options.strokeColor;
      context.strokeText(text, x, canvas.height / 2);
    }

    // Texto principal
    context.fillText(text, x, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    return { texture, width: canvas.width, height: canvas.height, canvas, context };
  }

  createText(id, text, options = {}) {
    //// console.log('🎨 Criando texto com ID:', id, 'texto:', text);
    const { texture, width, height, canvas, context } = this._createTextTexture(text, options);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Renderiza sempre por cima
    });

    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);

    //// console.log('🎨 Mesh criado:', mesh);
    //// console.log('🎨 Adicionando à cena UI:', uiScene);

    uiScene.add(mesh);
    this.elements.set(id, {
      mesh,
      texture,
      canvas,
      context,
      options,
      lastText: text,
      lastWidth: width,
      lastHeight: height
    });

    //// console.log('🎨 Texto criado com sucesso, elementos:', this.elements.size);
    return mesh;
  }

  updateText(id, newText) {
    const element = this.elements.get(id);
    if (!element || !element.context) {
      console.warn(`Elemento ${id} não encontrado ou sem contexto`);
      return;
    }

    try {
      //// console.log('🎨 Atualizando texto:', id, 'de', element.lastText, 'para', newText);

      // Re-criar a textura com o novo texto
      const { texture, width, height } = this._createTextTexture(newText, element.options);

      // Verificar se o elemento tem mesh e material
      if (!element.mesh || !element.mesh.material) {
        console.warn(`Elemento ${id} não tem mesh ou material válido`);
        return;
      }

      // Atualizar o material com a nova textura
      element.mesh.material.map = texture;
      element.texture = texture;
      element.lastText = newText;

      // Verificar se o tamanho mudou significativamente (mais de 20%)
      const sizeChanged = element.lastWidth && Math.abs(width - element.lastWidth) / element.lastWidth > 0.2;

      if (sizeChanged || !element.lastWidth) {
        //// console.log('🎨 Tamanho mudou significativamente, recriando geometria');
        // Recriar a geometria com o novo tamanho
        const newGeometry = new THREE.PlaneGeometry(width, height);
        if (element.mesh.geometry) {
          element.mesh.geometry.dispose(); // Limpar geometria antiga
        }
        element.mesh.geometry = newGeometry;
        element.lastWidth = width;
        element.lastHeight = height;
      }
    } catch (error) {
      console.error(`Erro ao atualizar texto ${id}:`, error);
    }
  }

  createPanel(id, options = {}) {
    const geometry = new THREE.PlaneGeometry(options.width || 100, options.height || 50);
    const material = new THREE.MeshBasicMaterial({
      color: options.color || 0x000000,
      transparent: true,
      opacity: options.opacity || 0.5,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);

    uiScene.add(mesh);
    this.elements.set(id, { mesh });
    return mesh;
  }

  createProgressBar(id, options = {}) {
    const background = this.createPanel(`${id}_bg`, {
      width: options.width,
      height: options.height,
      color: options.backgroundColor || 0x333333,
      opacity: 1
    });

    const bar = this.createPanel(`${id}_bar`, {
      width: options.width,
      height: options.height,
      color: options.color || 0x00ff00,
      opacity: 1
    });

    // Aninhar a barra no fundo
    bar.position.z = 0.1; // Colocar um pouco à frente
    background.add(bar);

    const progressElement = { background, bar, width: options.width };
    this.elements.set(id, progressElement);
    return progressElement;
  }

  updateProgress(id, percentage) {
    const element = this.elements.get(id);
    if (!element || !element.bar) {
      console.warn(`Elemento de progresso ${id} não encontrado`);
      return;
    }

    try {
      const percent = Math.max(0, Math.min(100, percentage)) / 100;
      element.bar.scale.x = percent;
      // Ajustar a posição para que a barra diminua da direita para a esquerda
      element.bar.position.x = - (element.width * (1 - percent)) / 2;
    } catch (error) {
      console.error(`Erro ao atualizar progresso ${id}:`, error);
    }
  }

  remove(id) {
    const element = this.elements.get(id);
    if (element) {
      if (element.mesh) {
        uiScene.remove(element.mesh);
      } else if (element.background) { // Para barras de progresso
        uiScene.remove(element.background);
      }
      this.elements.delete(id);
    }
  }

  get(id) {
    return this.elements.get(id);
  }
}

let uiScene; // Adicionar variável global para a cena da UI
let uiCamera; // Adicionar variável global para a câmera da UI

// Função para buscar um objeto interno pelo nome
export function findChildByName(parent, childName, recursive = true) {
  if (!parent) {
    console.warn('Parent object is null or undefined');
    return null;
  }

  // Verificar se o objeto tem a propriedade children
  if (!parent.children || !Array.isArray(parent.children)) {
    console.warn('Parent object does not have children property or it is not an array');
    return null;
  }

  // Busca direta nos filhos
  const directChild = parent.children.find(child => child.name === childName);
  if (directChild) {
    return directChild;
  }

  // Busca recursiva se habilitada
  if (recursive) {
    for (const child of parent.children) {
      const found = findChildByName(child, childName, true);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

// Função para buscar múltiplos objetos pelo nome (usando wildcards)
export function findChildrenByName(parent, pattern, recursive = true) {
  if (!parent) {
    console.warn('Parent object is null or undefined');
    return [];
  }

  const results = [];

  function searchRecursive(obj) {
    // Verificar se o nome do objeto corresponde ao padrão
    if (pattern.includes('*')) {
      // Padrão com wildcard
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(obj.name)) {
        results.push(obj);
      }
    } else {
      // Nome exato
      if (obj.name === pattern) {
        results.push(obj);
      }
    }

    // Busca recursiva
    if (recursive) {
      for (const child of obj.children) {
        searchRecursive(child);
      }
    }
  }

  searchRecursive(parent);
  return results;
}

// Função para buscar por tipo de objeto
export function findChildrenByType(parent, type, recursive = true) {
  if (!parent) {
    console.warn('Parent object is null or undefined');
    return [];
  }

  const results = [];

  function searchRecursive(obj) {
    if (obj.type === type) {
      results.push(obj);
    }

    if (recursive) {
      for (const child of obj.children) {
        searchRecursive(child);
      }
    }
  }

  searchRecursive(parent);
  return results;
}

// Função para buscar por propriedades customizadas
export function findChildrenByProperty(parent, propertyName, propertyValue, recursive = true) {
  if (!parent) {
    console.warn('Parent object is null or undefined');
    return [];
  }

  const results = [];

  function searchRecursive(obj) {
    if (obj.userData && obj.userData[propertyName] === propertyValue) {
      results.push(obj);
    }

    if (recursive) {
      for (const child of obj.children) {
        searchRecursive(child);
      }
    }
  }

  searchRecursive(parent);
  return results;
}

// Função para listar todos os objetos de um modelo
export function listModelObjects(model, showHierarchy = true, maxDepth = 10) {
  if (!model) {
    console.warn('Model is null or undefined');
    return [];
  }

  const objects = [];

  function traverse(obj, depth = 0, path = '') {
    if (depth > maxDepth) return;

    const currentPath = path ? `${path}/${obj.name}` : obj.name;

    objects.push({
      name: obj.name,
      type: obj.type,
      path: currentPath,
      depth: depth,
      isMesh: obj.isMesh,
      isGroup: obj.isGroup,
      childrenCount: obj.children.length,
      userData: obj.userData
    });

    if (showHierarchy) {
      for (const child of obj.children) {
        traverse(child, depth + 1, currentPath);
      }
    }
  }

  traverse(model);
  return objects;
}

// Função para imprimir a hierarquia do modelo no console
export function printModelHierarchy(model, maxDepth = 10) {
  const objects = listModelObjects(model, true, maxDepth);

  //// console.log('📋 Hierarquia do modelo:');
  objects.forEach(obj => {
    const indent = '  '.repeat(obj.depth);
    const typeIcon = obj.isMesh ? '🔲' : obj.isGroup ? '📁' : '📄';
    //// console.log(`${indent}${typeIcon} ${obj.name} (${obj.type})`);
  });

  return objects;
}

// Função para extrair um objeto específico do modelo
export function extractChildFromModel(model, childName, createCopy = true) {
  const child = findChildByName(model, childName);

  if (!child) {
    console.warn(`Child object '${childName}' not found in model`);
    return null;
  }

  if (createCopy) {
    // Criar uma cópia do objeto
    const clonedChild = child.clone();

    // Copiar propriedades importantes
    clonedChild.position.copy(child.position);
    clonedChild.rotation.copy(child.rotation);
    clonedChild.scale.copy(child.scale);

    // Copiar userData
    if (child.userData) {
      clonedChild.userData = JSON.parse(JSON.stringify(child.userData));
    }

    return clonedChild;
  } else {
    // Remover o objeto do modelo original
    if (child.parent) {
      child.parent.remove(child);
    }
    return child;
  }
}

// Função para substituir um objeto no modelo
export function replaceChildInModel(model, childName, newObject) {
  const oldChild = findChildByName(model, childName);

  if (!oldChild) {
    console.warn(`Child object '${childName}' not found in model`);
    return false;
  }

  if (oldChild.parent) {
    // Manter a transformação do objeto antigo
    newObject.position.copy(oldChild.position);
    newObject.rotation.copy(oldChild.rotation);
    newObject.scale.copy(oldChild.scale);

    // Substituir na hierarquia
    const index = oldChild.parent.children.indexOf(oldChild);
    oldChild.parent.children[index] = newObject;
    newObject.parent = oldChild.parent;

    // Remover o objeto antigo
    oldChild.parent = null;

    //// console.log(`✅ Objeto '${childName}' substituído com sucesso`);
    return true;
  }

  return false;
}

// Função para calcular a posição global de um objeto (incluindo todos os pais)
export function getWorldPosition(object) {
  if (!object) {
    console.warn('Object is null or undefined');
    return new THREE.Vector3();
  }

  const worldPosition = new THREE.Vector3();
  object.getWorldPosition(worldPosition);
  return worldPosition;
}

// Função para calcular a rotação global de um objeto
export function getWorldRotation(object) {
  if (!object) {
    console.warn('Object is null or undefined');
    return new THREE.Euler();
  }

  const worldRotation = new THREE.Euler();
  object.getWorldQuaternion(new THREE.Quaternion()).getEuler(worldRotation);
  return worldRotation;
}

// Função para calcular a escala global de um objeto
export function getWorldScale(object) {
  if (!object) {
    console.warn('Object is null or undefined');
    return new THREE.Vector3(1, 1, 1);
  }

  const worldScale = new THREE.Vector3();
  object.getWorldScale(worldScale);
  return worldScale;
}

// Configuração padrão para o sistema de waypoints
const defaultTrackConfig = {
  // Dimensões da pista
  trackWidth: 20,        // Largura total da pista
  wallHeight: 5,         // Altura das paredes
  wallThickness: 1,      // Espessura das paredes

  // Waypoints principais
  waypointSize: 1.5,     // Tamanho das esferas dos waypoints
  waypointColor: 0xffff00, // Cor dos waypoints (amarelo)
  waypointOpacity: 0.7,  // Transparência dos waypoints

  // Paredes
  leftWallColor: 0xff0000,  // Cor da parede esquerda (vermelho)
  rightWallColor: 0x0000ff, // Cor da parede direita (azul)
  wallOpacity: 0.3,         // Transparência das paredes
  wallEmissiveIntensity: 0.5, // Intensidade do brilho das paredes

  // Esferas de guia
  guideSphereCount: 10,     // Número de esferas entre cada waypoint
  guideSphereSize: 0.5,      // Tamanho das esferas de guia
  guideSphereColor: 0xffff00, // Cor das esferas de guia (amarelo)
  guideSphereOpacity: 0.5,    // Transparência das esferas de guia
};

// Função melhorada para buscar waypoints com posições globais
export function findWaypointsInModel(modelName, waypointPattern = 'waypoint-', config = {}) {
  return new Promise((resolve) => {
    findObjectByName(modelName, (model) => {
      if (!model) {
        console.error('❌ Modelo não encontrado:', modelName);
        resolve([]);
        return;
      }

      const trackConfig = { ...defaultTrackConfig, ...config };
      const waypoints = [];
      const geometry = new Geometry();
      const physics = new Physics();

      // Função recursiva para encontrar waypoints
      function findWaypointsRecursive(obj, path = '') {
        if (!obj) return;

        const currentPath = path ? `${path}/${obj.name}` : obj.name;

        // Verificar se é um waypoint
        if (obj.name && obj.name.toLowerCase().includes(waypointPattern.toLowerCase())) {
          const worldPos = getWorldPosition(obj);
          waypoints.push({
            name: obj.name,
            object: obj,
            position: worldPos,
            localPosition: obj.position.clone(),
            path: currentPath
          });
          obj.visible = false;
          // console.log(`📍 Waypoint encontrado: ${obj.name} em posição global:`, worldPos);

          // Criar uma esfera no waypoint para visualização
          if (trackConfig.showWaypoints) {
            const waypointSphere = geometry.createSphere(
              trackConfig.waypointSize,
              8,
              8,
              trackConfig.waypointColor
            );
            waypointSphere.position.copy(worldPos);
            const sphereObj = instantiate(waypointSphere, `waypoint_marker_${obj.name}`);

            // Material emissivo para a esfera
            const material = createMaterial('emissive', {
              color: trackConfig.waypointColor,
              emissive: trackConfig.waypointColor,
              emissiveIntensity: 2.0,
              transparent: true,
              opacity: trackConfig.waypointOpacity
            });

            if (sphereObj && sphereObj.gameObject) {
              sphereObj.gameObject.material = material;
              sphereObj.gameObject.visible = trackConfig.showWaypoints;
            }
          }
        }

        // Buscar recursivamente nos filhos
        if (obj.children && obj.children.length > 0) {
          for (const child of obj.children) {
            findWaypointsRecursive(child, currentPath);
          }
        }
      }

      findWaypointsRecursive(model.gameObject);
      // console.log(`🎯 Total de waypoints encontrados: ${waypoints.length}`);

      // Criar paredes e chão entre os waypoints
      if (waypoints.length > 1) {
        // Encontrar os limites do circuito para criar o chão
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        // Primeiro loop: encontrar os limites do circuito
        for (let i = 0; i < waypoints.length; i++) {
          const currentPos = waypoints[i].position;
          const nextPos = waypoints[(i + 1) % waypoints.length].position;

          // Atualizar limites considerando a largura da pista
          minX = Math.min(minX, currentPos.x - trackConfig.trackWidth / 2);
          maxX = Math.max(maxX, currentPos.x + trackConfig.trackWidth / 2);
          minZ = Math.min(minZ, currentPos.z - trackConfig.trackWidth / 2);
          maxZ = Math.max(maxZ, currentPos.z + trackConfig.trackWidth / 2);

          // Considerar também o próximo ponto
          minX = Math.min(minX, nextPos.x - trackConfig.trackWidth / 2);
          maxX = Math.max(maxX, nextPos.x + trackConfig.trackWidth / 2);
          minZ = Math.min(minZ, nextPos.z - trackConfig.trackWidth / 2);
          maxZ = Math.max(maxZ, nextPos.z + trackConfig.trackWidth / 2);
        }

        // Adicionar margem extra aos limites
        const margin = trackConfig.trackWidth * 0.5;
        minX -= margin;
        maxX += margin;
        minZ -= margin;
        maxZ += margin;

        /* // Criar o chão
        if (trackConfig.showFloor) {
          const floorWidth = maxX - minX;
          const floorDepth = maxZ - minZ;
          
          // Usar seções ainda maiores
          const SECTION_SIZE = 500; // Aumentado para 500 para ter ainda menos divisões
          const sectionsX = Math.ceil(floorWidth / SECTION_SIZE);
          const sectionsZ = Math.ceil(floorDepth / SECTION_SIZE);
          
          const totalSections = sectionsX * sectionsZ;
         // console.log(`🏗️ Dimensões do chão: ${floorWidth.toFixed(2)} x ${floorDepth.toFixed(2)}`);
         // console.log(`🏗️ Criando chão em seções: ${sectionsX}x${sectionsZ} = ${totalSections} seções totais`);
         // console.log(`🏗️ Cada seção tem ${SECTION_SIZE}x${SECTION_SIZE} unidades`);
          
          // Criar seções do chão
          for (let sx = 0; sx < sectionsX; sx++) {
            for (let sz = 0; sz < sectionsZ; sz++) {
              // Calcular dimensões desta seção
              const sectionWidth = Math.min(SECTION_SIZE, floorWidth - (sx * SECTION_SIZE));
              const sectionDepth = Math.min(SECTION_SIZE, floorDepth - (sz * SECTION_SIZE));
              
              // Criar geometria da seção usando PLANE
              const sectionGeometry = geometry.createPlane(
                sectionWidth,
                sectionDepth,
                trackConfig.floorColor
              );
              
              const section = instantiate(sectionGeometry, `track_floor_${sx}_${sz}`);
              if (section && section.gameObject) {
                // Rotacionar o plane para ficar horizontal
                section.gameObject.rotation.x = -Math.PI / 2;
                
                // Posicionar a seção
                section.gameObject.position.set(
                  minX + (sx * SECTION_SIZE) + sectionWidth/2,
                  trackConfig.floorHeight,
                  minZ + (sz * SECTION_SIZE) + sectionDepth/2
                );
                
                // Material super simplificado
                const floorMaterial = createMaterial('basic', {
                  color: trackConfig.floorColor,
                  transparent: true,
                  opacity: trackConfig.floorOpacity,
                  side: 1,
                  shadowSide: 1
                });
                section.gameObject.material = floorMaterial;
                section.gameObject.visible = trackConfig.showFloor;
                
                // Otimizar renderização
                section.gameObject.matrixAutoUpdate = false;
                section.gameObject.updateMatrix();
                
                // Física minimalista - só colisão básica
                const sectionPhysics = physics.addPlanePhysics(
                  section.gameObject,
                  0 // massa 0 = estático
                );
                
                if (sectionPhysics) {
                  // Remover todos os efeitos de física extras
                  sectionPhysics.friction = 0;
                  sectionPhysics.restitution = 0;
                  sectionPhysics.damping = 0;
                  sectionPhysics.angularDamping = 0;
                  sectionPhysics.linearDamping = 0;
                  sectionPhysics.type = CANNON.Body.STATIC;
                  
                  // Configurações mínimas necessárias
                  sectionPhysics.fixedRotation = true;
                  sectionPhysics.updateMassProperties();
                  
                  // Colisão mais simples possível
                  sectionPhysics.collisionResponse = 1;
                  sectionPhysics.collisionFilterGroup = 1;
                  sectionPhysics.collisionFilterMask = -1;
                  
                  // Sincronizar posição
                  sectionPhysics.position.copy(section.gameObject.position);
                  sectionPhysics.quaternion.copy(section.gameObject.quaternion);
                }
              }
            }
          }
          
         // console.log('🟦 Chão criado com física minimalista');
        } */

        // Criar paredes...
        for (let i = 0; i < waypoints.length; i++) {
          const currentPos = waypoints[i].position;
          const nextPos = waypoints[(i + 1) % waypoints.length].position;

          // Calcular direção e distância entre waypoints
          const direction = {
            x: nextPos.x - currentPos.x,
            y: nextPos.y - currentPos.y,
            z: nextPos.z - currentPos.z
          };
          const distance = Math.sqrt(
            direction.x * direction.x +
            direction.y * direction.y +
            direction.z * direction.z
          );

          // Normalizar direção
          const normalizedDir = {
            x: direction.x / distance,
            y: direction.y / distance,
            z: direction.z / distance
          };

          // Vetor perpendicular para as paredes laterais (cross product com up vector)
          const perpendicular = {
            x: -normalizedDir.z,
            y: 0,
            z: normalizedDir.x
          };

          // Criar paredes laterais
          const wallLength = distance + trackConfig.wallThickness * 2; // Adicionar overlap nas extremidades
          const wallGeometry = geometry.createBox(
            trackConfig.wallThickness,
            trackConfig.wallHeight,
            wallLength,
            trackConfig.leftWallColor
          );

          // Parede esquerda
          const leftWallPos = {
            x: currentPos.x + perpendicular.x * (trackConfig.trackWidth / 2),
            y: currentPos.y,  // Usar a posição Y do waypoint como centro
            z: currentPos.z + perpendicular.z * (trackConfig.trackWidth / 2)
          };

          const leftWall = instantiate(wallGeometry.clone(), `wall_left_${i}`);
          if (leftWall && leftWall.gameObject) {
            leftWall.gameObject.position.set(
              leftWallPos.x + direction.x / 2,
              leftWallPos.y,  // Manter a posição Y centralizada
              leftWallPos.z + direction.z / 2
            );

            // Rotacionar a parede para alinhar com a direção
            leftWall.gameObject.lookAt(
              nextPos.x + perpendicular.x * (trackConfig.trackWidth / 2),
              leftWallPos.y,
              nextPos.z + perpendicular.z * (trackConfig.trackWidth / 2)
            );

            // Material para parede esquerda
            const leftWallMaterial = createMaterial('emissive', {
              color: trackConfig.leftWallColor,
              emissive: trackConfig.leftWallColor,
              emissiveIntensity: trackConfig.wallEmissiveIntensity,
              transparent: true,
              opacity: trackConfig.wallOpacity
            });
            leftWall.gameObject.material = leftWallMaterial;

            // Adicionar física à parede esquerda
            const leftWallPhysics = physics.addBoxPhysics(
              leftWall.gameObject,
              trackConfig.wallThickness,
              trackConfig.wallHeight,
              wallLength,
              0  // massa 0 para objeto estático
            );
            if (leftWallPhysics) {
              leftWallPhysics.friction = 0.3;
              leftWallPhysics.restitution = 0.2;
              leftWallPhysics.type = CANNON.Body.STATIC; // Forçar como estático
              leftWallPhysics.updateMassProperties(); // Atualizar propriedades
              // Fixar a rotação
              leftWallPhysics.fixedRotation = true;
              leftWallPhysics.angularDamping = 1;
              // Sincronizar posição com o objeto visual
              leftWallPhysics.position.copy(leftWall.gameObject.position);
              leftWallPhysics.quaternion.copy(leftWall.gameObject.quaternion);
            }
          }

          // Parede direita
          const rightWallPos = {
            x: currentPos.x - perpendicular.x * (trackConfig.trackWidth / 2),
            y: currentPos.y,  // Usar a posição Y do waypoint como centro
            z: currentPos.z - perpendicular.z * (trackConfig.trackWidth / 2)
          };

          const rightWall = instantiate(wallGeometry.clone(), `wall_right_${i}`);
          if (rightWall && rightWall.gameObject) {
            rightWall.gameObject.position.set(
              rightWallPos.x + direction.x / 2,
              rightWallPos.y,  // Manter a posição Y centralizada
              rightWallPos.z + direction.z / 2
            );

            // Rotacionar a parede para alinhar com a direção
            rightWall.gameObject.lookAt(
              nextPos.x - perpendicular.x * (trackConfig.trackWidth / 2),
              rightWallPos.y,
              nextPos.z - perpendicular.z * (trackConfig.trackWidth / 2)
            );

            // Material para parede direita
            const rightWallMaterial = createMaterial('emissive', {
              color: trackConfig.rightWallColor,
              emissive: trackConfig.rightWallColor,
              emissiveIntensity: trackConfig.wallEmissiveIntensity,
              transparent: true,
              opacity: trackConfig.wallOpacity
            });
            rightWall.gameObject.material = rightWallMaterial;

            // Adicionar física à parede direita
            const rightWallPhysics = physics.addBoxPhysics(
              rightWall.gameObject,
              trackConfig.wallThickness,
              trackConfig.wallHeight,
              wallLength,
              0  // massa 0 para objeto estático
            );
            if (rightWallPhysics) {
              rightWallPhysics.friction = 0.3;
              rightWallPhysics.restitution = 0.2;
              rightWallPhysics.type = CANNON.Body.STATIC; // Forçar como estático
              rightWallPhysics.updateMassProperties(); // Atualizar propriedades
              // Fixar a rotação
              rightWallPhysics.fixedRotation = true;
              rightWallPhysics.angularDamping = 1;
              // Sincronizar posição com o objeto visual
              rightWallPhysics.position.copy(rightWall.gameObject.position);
              rightWallPhysics.quaternion.copy(rightWall.gameObject.quaternion);
            }
          }

          // Criar esferas de guia no centro
          const numSpheres = trackConfig.guideSphereCount || defaultTrackConfig.guideSphereCount;
          for (let j = 1; j < numSpheres; j++) {
            const t = j / numSpheres;
            const interpolatedPos = {
              x: currentPos.x + direction.x * t,
              y: currentPos.y + direction.y * t,
              z: currentPos.z + direction.z * t
            };

            // Criar uma esfera menor para o caminho
            const pathSphere = geometry.createSphere(
              trackConfig.guideSphereSize,
              8,
              8,
              trackConfig.guideSphereColor
            );
            pathSphere.position.set(interpolatedPos.x, interpolatedPos.y, interpolatedPos.z);
            const pathObj = instantiate(pathSphere, `path_marker_${i}_${j}`);

            // Material emissivo para as esferas do caminho
            const pathMaterial = createMaterial('emissive', {
              color: trackConfig.guideSphereColor,
              emissive: trackConfig.guideSphereColor,
              emissiveIntensity: 1.0,
              transparent: true,
              opacity: trackConfig.guideSphereOpacity
            });

            if (pathObj && pathObj.gameObject) {
              pathObj.gameObject.material = pathMaterial;
              pathObj.gameObject.visible = trackConfig.showGuideSpheres;
            }
          }
        }
      }

      resolve(waypoints);
    });
  });
}

// Função para mover objeto para posição global
export function moveToWorldPosition(object, targetWorldPosition, speed = 1.0) {
  if (!object || !targetWorldPosition) {
    console.warn('Object or target position is null');
    return;
  }

  const currentWorldPos = getWorldPosition(object);
  const direction = new THREE.Vector3();
  direction.subVectors(targetWorldPosition, currentWorldPos);

  if (direction.length() > 0.1) { // Só mover se não estiver muito próximo
    direction.normalize();
    object.position.addScaledVector(direction, speed * timeMulti);
  }
}

// Função para mover objeto suavemente entre waypoints
export function moveBetweenWaypoints(object, waypoints, currentIndex = 0, speed = 1.0, arrivalDistance = 2.0) {
  if (!object || !waypoints || waypoints.length === 0) {
    console.warn('Invalid parameters for moveBetweenWaypoints');
    return currentIndex;
  }

  const targetWaypoint = waypoints[currentIndex];
  if (!targetWaypoint) {
    console.warn('Invalid waypoint index');
    return currentIndex;
  }

  const currentWorldPos = getWorldPosition(object);
  const distance = currentWorldPos.distanceTo(targetWaypoint.position);

  if (distance > arrivalDistance) {
    // Mover em direção ao waypoint
    moveToWorldPosition(object, targetWaypoint.position, speed);
  } else {
    // Chegou ao waypoint, ir para o próximo
    const nextIndex = (currentIndex + 1) % waypoints.length;
    // console.log(`🎯 Objeto chegou ao waypoint ${currentIndex + 1}, indo para waypoint ${nextIndex + 1}`);
    return nextIndex;
  }

  return currentIndex;
}

// Função para criar um objeto de teste visível
export function createTestObject(geometry, material, name = 'testObject') {
  if (!geometry) {
    console.warn('Geometry is required for test object');
    return null;
  }

  // Se não foi fornecido material, criar um padrão
  if (!material) {
    material = createMaterial('emissive', {
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.8
    });
  }

  // Aplicar material se a geometria não tiver
  if (geometry.material) {
    geometry.material = material;
  }

  // Posicionar em local visível
  geometry.position.set(0, 5, 10);

  // Instanciar
  const testObject = instantiate(geometry, name);
  // console.log(`🧪 Objeto de teste criado: ${name} em posição:`, testObject.gameObject.position);

  return testObject;
}

// Função para debug de posições
export function debugObjectPosition(object, label = 'Object') {
  const worldPos = getWorldPosition(object);
  const localPos = object.position.clone();

}

// Função para listar hierarquia completa com posições
export function debugModelHierarchy(model, maxDepth = 5) {
  if (!model) {
    console.warn('Model is null for hierarchy debug');
    return;
  }

  // console.log('📋 Hierarquia completa do modelo:');

  function traverse(obj, depth = 0) {
    if (depth > maxDepth) return;

    const indent = '  '.repeat(depth);
    const worldPos = getWorldPosition(obj);
    const localPos = obj.position;

    // console.log(`${indent}${obj.name || 'unnamed'} (${obj.type})`);
    // console.log(`${indent}  Local: ${localPos.x.toFixed(2)}, ${localPos.y.toFixed(2)}, ${localPos.z.toFixed(2)}`);
    // console.log(`${indent}  World: ${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)}`);

    if (obj.children && obj.children.length > 0) {
      for (const child of obj.children) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(model);
}

// Sistema de física avançada para movimento 3D
export class AdvancedPhysics {
  constructor() {
    this.velocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.mass = 1.0;
    this.drag = 0.98;
    this.angularDrag = 0.95;
    this.maxSpeed = 10.0;
    this.maxAngularSpeed = 2.0;
  }

  // Aplicar força ao objeto
  applyForce(force) {
    this.acceleration.add(force.clone().divideScalar(this.mass));
  }

  // Aplicar torque (rotação)
  applyTorque(torque) {
    this.angularVelocity.add(torque.clone().divideScalar(this.mass));
  }

  // Atualizar física
  update(deltaTime) {
    // Atualizar velocidade
    this.velocity.add(this.acceleration.clone().multiplyScalar(deltaTime));

    // Aplicar drag
    this.velocity.multiplyScalar(this.drag);
    this.angularVelocity.multiplyScalar(this.angularDrag);

    // Limitar velocidade máxima
    if (this.velocity.length() > this.maxSpeed) {
      this.velocity.normalize().multiplyScalar(this.maxSpeed);
    }

    // Limitar velocidade angular máxima
    if (this.angularVelocity.length() > this.maxAngularSpeed) {
      this.angularVelocity.normalize().multiplyScalar(this.maxAngularSpeed);
    }

    // Resetar aceleração
    this.acceleration.set(0, 0, 0);
  }

  // Obter velocidade atual
  getVelocity() {
    return this.velocity.clone();
  }

  // Definir velocidade
  setVelocity(velocity) {
    this.velocity.copy(velocity);
  }

  // Obter velocidade angular
  getAngularVelocity() {
    return this.angularVelocity.clone();
  }

  // Definir velocidade angular
  setAngularVelocity(angularVelocity) {
    this.angularVelocity.copy(angularVelocity);
  }
}

// Função para criar física avançada em um objeto
export function createAdvancedPhysics(object, config = {}) {
  const physics = new AdvancedPhysics();

  // Aplicar configurações
  if (config.mass) physics.mass = config.mass;
  if (config.drag) physics.drag = config.drag;
  if (config.angularDrag) physics.angularDrag = config.angularDrag;
  if (config.maxSpeed) physics.maxSpeed = config.maxSpeed;
  if (config.maxAngularSpeed) physics.maxAngularSpeed = config.maxAngularSpeed;

  // Associar ao objeto
  object.advancedPhysics = physics;

  return physics;
}

// Função para mover objeto em direção a um alvo com física
export function moveTowardsTarget(object, target, speed = 1.0, usePhysics = true) {
  if (!object || !target) return;

  const direction = new THREE.Vector3();
  direction.subVectors(target, object.position).normalize();

  if (usePhysics && object.advancedPhysics) {
    // Usar física avançada
    const force = direction.clone().multiplyScalar(speed);
    object.advancedPhysics.applyForce(force);
  } else {
    // Movimento direto
    object.position.addScaledVector(direction, speed * timeMulti);
  }
}

// Função para seguir um objeto com suavização
export function followObject(follower, target, followDistance = 5.0, speed = 1.0, usePhysics = true) {
  if (!follower || !target) return;

  const distance = follower.position.distanceTo(target.position);

  if (distance > followDistance) {
    moveTowardsTarget(follower, target.position, speed, usePhysics);
  }

  return distance;
}

// Função para orbitar em torno de um objeto
export function orbitAround(object, center, radius = 5.0, speed = 1.0, axis = 'y') {
  if (!object || !center) return;

  const time = clock.getElapsedTime();
  const angle = time * speed;

  switch (axis) {
    case 'x':
      object.position.x = center.x + radius * Math.cos(angle);
      object.position.z = center.z + radius * Math.sin(angle);
      break;
    case 'y':
      object.position.x = center.x + radius * Math.cos(angle);
      object.position.y = center.y + radius * Math.sin(angle);
      break;
    case 'z':
      object.position.x = center.x + radius * Math.cos(angle);
      object.position.y = center.y + radius * Math.sin(angle);
      break;
  }
}

// Função para movimento suave com interpolação
export function smoothMoveTo(object, targetPosition, speed = 1.0, smoothing = 0.1) {
  if (!object) return;

  const direction = new THREE.Vector3();
  direction.subVectors(targetPosition, object.position);

  if (direction.length() > 0.1) {
    object.position.lerp(targetPosition, smoothing * speed * timeMulti);
  }
}

// Função para rotação suave
export function smoothRotateTo(object, targetRotation, speed = 1.0, smoothing = 0.1) {
  if (!object) return;

  object.rotation.lerp(targetRotation, smoothing * speed * timeMulti);
}

// Função para movimento com aceleração
export function accelerateTowards(object, target, maxSpeed = 5.0, acceleration = 1.0, usePhysics = true) {
  if (!object || !target) return;

  const direction = new THREE.Vector3();
  direction.subVectors(target, object.position).normalize();

  if (usePhysics && object.advancedPhysics) {
    const currentSpeed = object.advancedPhysics.getVelocity().length();
    const targetSpeed = Math.min(currentSpeed + acceleration * timeMulti, maxSpeed);

    const force = direction.clone().multiplyScalar(targetSpeed);
    object.advancedPhysics.applyForce(force);
  } else {
    // Implementação simples sem física
    const currentVelocity = new THREE.Vector3();
    const targetVelocity = direction.clone().multiplyScalar(maxSpeed);

    currentVelocity.lerp(targetVelocity, acceleration * timeMulti);
    object.position.add(currentVelocity.clone().multiplyScalar(timeMulti));
  }
}

// Função para movimento em formação
export function moveInFormation(leader, followers, formation = 'line', spacing = 3.0) {
  if (!leader || !followers || followers.length === 0) return;

  const leaderPos = leader.position.clone();
  const leaderForward = new THREE.Vector3(0, 0, -1).applyQuaternion(leader.quaternion);
  const leaderRight = new THREE.Vector3(1, 0, 0).applyQuaternion(leader.quaternion);

  followers.forEach((follower, index) => {
    let targetPosition;

    switch (formation) {
      case 'line':
        targetPosition = leaderPos.clone().add(leaderRight.clone().multiplyScalar((index + 1) * spacing));
        break;
      case 'v':
        const angle = (index + 1) * Math.PI / 4;
        const offset = leaderRight.clone().multiplyScalar(Math.cos(angle) * spacing);
        const forward = leaderForward.clone().multiplyScalar(Math.sin(angle) * spacing);
        targetPosition = leaderPos.clone().add(offset).add(forward);
        break;
      case 'circle':
        const circleAngle = (index / followers.length) * Math.PI * 2;
        targetPosition = leaderPos.clone().add(
          leaderRight.clone().multiplyScalar(Math.cos(circleAngle) * spacing)
        ).add(
          leaderForward.clone().multiplyScalar(Math.sin(circleAngle) * spacing)
        );
        break;
      default:
        targetPosition = leaderPos.clone();
    }

    smoothMoveTo(follower, targetPosition, 2.0, 0.05);
  });
}

// Função para atualizar física de todos os objetos
export function updateAllPhysics(deltaTime) {
  sceneObjects.forEach(sceneObject => {
    if (sceneObject.gameObject && sceneObject.gameObject.advancedPhysics) {
      sceneObject.gameObject.advancedPhysics.update(deltaTime);

      // Aplicar velocidade ao objeto
      const velocity = sceneObject.gameObject.advancedPhysics.getVelocity();
      sceneObject.gameObject.position.add(velocity.clone().multiplyScalar(deltaTime));

      // Aplicar velocidade angular
      const angularVelocity = sceneObject.gameObject.advancedPhysics.getAngularVelocity();
      sceneObject.gameObject.rotation.x += angularVelocity.x * deltaTime;
      sceneObject.gameObject.rotation.y += angularVelocity.y * deltaTime;
      sceneObject.gameObject.rotation.z += angularVelocity.z * deltaTime;
    }
  });
}


// ... existing code ...

// Adicionar antes das outras funções de exportação
export function raycast(start, end, targetName = null) {
  // Criar raycaster
  const raycaster = new THREE.Raycaster();

  // Converter pontos para Vector3 caso não sejam
  const startPoint = start instanceof THREE.Vector3 ? start : new THREE.Vector3(start.x, start.y, start.z);
  const endPoint = end instanceof THREE.Vector3 ? end : new THREE.Vector3(end.x, end.y, end.z);

  // Calcular direção do raio
  const direction = new THREE.Vector3();
  direction.subVectors(endPoint, startPoint).normalize();

  // Configurar raycaster
  raycaster.set(startPoint, direction);

  // Calcular distância máxima
  const maxDistance = startPoint.distanceTo(endPoint);

  // Pegar meshes baseado no targetName
  const meshes = [];
  scene.traverse((object) => {
    if (object.isMesh) {
      // Se não tiver targetName, pegar todos os meshes
      // Se tiver targetName, checar se o objeto ou algum pai tem o nome
      if (!targetName) {
        meshes.push(object);
        // console.log('🎯 Mesh encontrado:', object.name);
      } else {
        let current = object;
        while (current) {
          if (current.name && current.name.toUpperCase().includes(targetName.toUpperCase())) {
            meshes.push(object);
            // console.log(`🎯 Mesh com nome "${targetName}" encontrado:`, current.name);
            break;
          }
          current = current.parent;
        }
      }
    }
  });

  if (meshes.length === 0) {
    // Listar todos os objetos da cena para debug
    // console.log('📋 Lista de objetos na cena:');
    scene.traverse((object) => {
      if (object.isMesh) {
        // console.log(`- ${object.name} (mesh)`);
      } else if (object.isGroup) {
        // console.log(`- ${object.name} (grupo)`);
      }
    });
    // console.log(`❌ ${targetName ? `Nenhum objeto "${targetName}"` : 'Nenhum mesh'} encontrado na cena`);
    return null;
  }

  // Fazer o raycast apenas nos meshes selecionados
  const intersects = raycaster.intersectObjects(meshes, false);

  // Debug visual - linha do raycast
  const debugLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]),
    new THREE.LineBasicMaterial({ color: intersects.length > 0 ? 0x00ff00 : 0xff0000 })
  );
  scene.add(debugLine);
  setTimeout(() => scene.remove(debugLine), 100);

  // Se houver colisão e estiver dentro da distância máxima
  if (intersects.length > 0 && intersects[0].distance <= maxDistance) {
    // console.log(`🎯 Raycast atingiu ${targetName || 'mesh'} a ${intersects[0].distance.toFixed(2)} unidades`);

    return {
      distance: intersects[0].distance,
      point: intersects[0].point,
      normal: intersects[0].face ? intersects[0].face.normal : null,
      object: intersects[0].object
    };
  }

  return null;
}

export function updateLookAt(camera, target) {
  if (camera && target) {
    camera.lookAt(target);
  }
}

export function getWorld() {
  return world;
}

export function getComposer() {
  return composer;
}

// Função para resetar o composer para estado básico
export function resetPostProcessing() {

  // Remover todos os passes exceto o básico
  composer.passes = [];

  // Readicionar passes básicos
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
  composer.addPass(fxaaPass);

}

// Função para obter a instância global de PostProcessing
export function getGlobalPostProcessing() {
  if (!globalPostProcessing) {
    globalPostProcessing = new PostProcessing();
  }
  return globalPostProcessing;
}

// Função para obter a instância global de Environment
export function getCurrentEnvironment() {
  if (!currentEnvironment) {
    currentEnvironment = new Environment();
  }
  return currentEnvironment;
}

export function getUIScene() {
  return uiScene;
}

export function getUICamera() {
  return uiCamera;
}

export function syncPhysics() {
  if (!world) return;

  world.bodies.forEach(body => {
    if (body.gameObject) {
      // Verificar se as posições são válidas antes de copiar
      if (body.position && isFinite(body.position.x) && isFinite(body.position.y) && isFinite(body.position.z)) {
        body.gameObject.position.copy(body.position);
      } else {
        console.warn('⚠️ Posição inválida detectada:', body.position);
      }

      // Verificar se o quaternion é válido antes de copiar
      if (body.quaternion && isFinite(body.quaternion.x) && isFinite(body.quaternion.y) &&
        isFinite(body.quaternion.z) && isFinite(body.quaternion.w)) {
        body.gameObject.quaternion.copy(body.quaternion);
      } else {
        console.warn('⚠️ Quaternion inválido detectado:', body.quaternion);
        body.quaternion.set(0, 0, 0, 1); // Reset para identidade
      }
    }
  });
}

// Function to convert HSL to Hex
export function hslToHex(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return parseInt(`0x${toHex(r)}${toHex(g)}${toHex(b)}`);
}

// Function to set material color
export function setMaterialColor(object, color) {
  if (!object || !object.material) {
    console.warn('Invalid object or object has no material');
    return;
  }

  // Handle array of materials
  if (Array.isArray(object.material)) {
    object.material.forEach(material => {
      if (material.color) {
        material.color.setHex(color);
      }
    });
  } else {
    // Handle single material
    if (object.material.color) {
      object.material.color.setHex(color);
    }
  }
}

// 🎲 Sistema de Números Aleatórios
export class Random {
  // Gerar número aleatório entre min e max (inclusive)
  static range(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Gerar número inteiro aleatório entre min e max (inclusive)
  static rangeInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Gerar número aleatório entre 0 e 1
  static value() {
    return Math.random();
  }

  // Escolher elemento aleatório de um array
  static choice(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
  }

  // Gerar cor aleatória (hex)
  static color() {
    return Math.floor(Math.random() * 16777215);
  }

  // Gerar cor aleatória RGB
  static colorRGB() {
    return {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256)
    };
  }

  // Gerar Vector3 aleatório
  static vector3(minX = -1, maxX = 1, minY = -1, maxY = 1, minZ = -1, maxZ = 1) {
    return new Vector3(
      this.range(minX, maxX),
      this.range(minY, maxY),
      this.range(minZ, maxZ)
    );
  }

  // Gerar posição aleatória em círculo
  static positionInCircle(centerX = 0, centerZ = 0, radius = 10) {
    const angle = this.range(0, Math.PI * 2);
    const distance = this.range(0, radius);

    return {
      x: centerX + Math.cos(angle) * distance,
      y: 0,
      z: centerZ + Math.sin(angle) * distance
    };
  }

  // Gerar posição aleatória em esfera
  static positionInSphere(centerX = 0, centerY = 0, centerZ = 0, radius = 10) {
    const u = this.value();
    const v = this.value();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * Math.cbrt(this.value());

    return {
      x: centerX + r * Math.sin(phi) * Math.cos(theta),
      y: centerY + r * Math.sin(phi) * Math.sin(theta),
      z: centerZ + r * Math.cos(phi)
    };
  }

  // Gerar rotação aleatória
  static rotation() {
    return {
      x: this.range(0, Math.PI * 2),
      y: this.range(0, Math.PI * 2),
      z: this.range(0, Math.PI * 2)
    };
  }

  // Gerar escala aleatória
  static scale(min = 0.5, max = 2.0) {
    const scale = this.range(min, max);
    return {
      x: scale,
      y: scale,
      z: scale
    };
  }

  // Gerar escala não uniforme
  static scaleNonUniform(minX = 0.5, maxX = 2.0, minY = 0.5, maxY = 2.0, minZ = 0.5, maxZ = 2.0) {
    return {
      x: this.range(minX, maxX),
      y: this.range(minY, maxY),
      z: this.range(minZ, maxZ)
    };
  }

  // Gerar direção aleatória (Vector3 normalizado)
  static direction() {
    const vector = this.vector3(-1, 1, -1, 1, -1, 1);
    return vector.normalize();
  }

  // Gerar direção aleatória no plano XZ
  static directionXZ() {
    const angle = this.range(0, Math.PI * 2);
    return new Vector3(Math.cos(angle), 0, Math.sin(angle));
  }

  // Gerar velocidade aleatória
  static velocity(minSpeed = 1, maxSpeed = 10) {
    const speed = this.range(minSpeed, maxSpeed);
    const direction = this.direction();
    return direction.multiply(speed);
  }

  // Gerar velocidade no plano XZ
  static velocityXZ(minSpeed = 1, maxSpeed = 10) {
    const speed = this.range(minSpeed, maxSpeed);
    const direction = this.directionXZ();
    return direction.multiply(speed);
  }

  // Gerar delay aleatório
  static delay(minSeconds = 0.1, maxSeconds = 2.0) {
    return this.range(minSeconds, maxSeconds);
  }

  // Gerar chance (true/false baseado em probabilidade)
  static chance(probability = 0.5) {
    return this.value() < probability;
  }

  // Gerar peso aleatório (útil para sistemas de spawn)
  static weight(weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let random = this.range(0, total);

    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return i;
      }
    }

    return weights.length - 1;
  }

  // Gerar nome aleatório
  static name(prefix = 'Object') {
    const id = Math.floor(this.value() * 10000);
    return `${prefix}_${id}`;
  }

  // Gerar ID único
  static id() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Gerar seed para reproduzir sequências aleatórias
  static seed(seed) {
    // Implementação simples de seed
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // Gerar número com distribuição normal (gaussiana)
  static gaussian(mean = 0, standardDeviation = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.value();
    while (v === 0) v = this.value();

    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * standardDeviation;
  }

  // Gerar número com distribuição exponencial
  static exponential(lambda = 1) {
    return -Math.log(1 - this.value()) / lambda;
  }

  // Gerar número com distribuição de Poisson
  static poisson(lambda = 1) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;

    do {
      k++;
      p *= this.value();
    } while (p > L);

    return k - 1;
  }
}

// Sistema de modo editor
let editorMode = false;
let editorCameraInstance = null;
let editorControls = null;
let selectedObject = null;
let editorRaycaster = null;
let editorMouse = null;
let editorModeCallbacks = {
  onObjectSelected: null,
  onModeChanged: null
};

// Sistema de raycast para seleção de objetos
let selectionRaycaster = null;
let selectionMouse = null;
let isSelectionActive = false;

/** Map<AnimationMixer, number> — timeScales salvos ao pausar o jogo (modo editor) */
let editorPausedMixerTimeScales = null;

/**
 * Iframe do Bluelight: nunca simula o jogo aqui (só janela standalone).
 * Usa flag injetada pelo preview server + query (?psxEmbed=editor).
 */
function isEditorPanelEmbed() {
  if (typeof window === 'undefined') return false;
  if (window.__PSX_EMBED_EDITOR_PANEL__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('psxEmbed') === 'editor';
  } catch (e) {
    return false;
  }
}

function allowPanelGameplay() {
  return !isEditorPanelEmbed();
}

function suspendEngineAudioForEditor() {
  try {
    if (listener && listener.context) {
      const ctx = listener.context;
      if (ctx.state === 'running') {
        ctx.suspend();
      }
    }
  } catch (e) {
    console.warn('PSX: não foi possível suspender o áudio (modo editor):', e);
  }
}

function resumeEngineAudioFromEditor() {
  try {
    if (listener && listener.context) {
      const ctx = listener.context;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    }
  } catch (e) {
    console.warn('PSX: não foi possível retomar o áudio:', e);
  }
}

function freezeMixersForEditor() {
  editorPausedMixerTimeScales = new Map();
  const seen = new Set();
  const freeze = (mixer) => {
    if (!mixer || typeof mixer.timeScale !== 'number' || seen.has(mixer)) return;
    seen.add(mixer);
    editorPausedMixerTimeScales.set(mixer, mixer.timeScale);
    mixer.timeScale = 0;
  };
  sceneObjects.forEach((so) => {
    if (so.animator) freeze(so.animator);
    if (so.gameObject && so.gameObject.animator) freeze(so.gameObject.animator);
  });
  if (scene) {
    scene.traverse((obj) => {
      if (obj.animator) freeze(obj.animator);
    });
  }
}

function thawMixersFromEditor() {
  if (!editorPausedMixerTimeScales) return;
  editorPausedMixerTimeScales.forEach((timeScale, mixer) => {
    if (mixer && typeof mixer.timeScale === 'number') {
      mixer.timeScale = timeScale;
    }
  });
  editorPausedMixerTimeScales = null;
}

/**
 * Modo de execução da engine no painel de edição vs jogo em tempo real.
 * O modo "editor" pausa o gameLoop do usuário, física (no bloco dedicado), áudio e mixers conforme a implementação.
 */
export const PSX_RUNTIME_MODE = Object.freeze({
  EDITOR: 'editor',
  PLAY: 'play'
});

export function getRuntimeMode() {
  return editorMode ? PSX_RUNTIME_MODE.EDITOR : PSX_RUNTIME_MODE.PLAY;
}

/**
 * Define o modo de forma idempotente (sem depender só de toggle).
 * @param {'editor'|'play'} mode
 * @returns {'editor'|'play'}
 */
export function setRuntimeMode(mode) {
  const wantEditor = mode === PSX_RUNTIME_MODE.EDITOR;
  // Painel do iframe do editor: nunca forçar modo "play" dentro do Bluelight
  if (isEditorPanelEmbed() && !wantEditor) {
    return getRuntimeMode();
  }
  if (wantEditor === editorMode) {
    return getRuntimeMode();
  }
  toggleEditorMode();
  return getRuntimeMode();
}

// Função para alternar modo editor
export function toggleEditorMode() {
  // No painel embed, o modo editor não pode ser desligado (só jogo no browser/janela)
  if (isEditorPanelEmbed() && editorMode) {
    return;
  }

  editorMode = !editorMode;

  if (editorMode) {
    enableEditorMode();
  } else {
    disableEditorMode();
  }

  // Notificar mudança de modo
  if (editorModeCallbacks.onModeChanged) {
    editorModeCallbacks.onModeChanged(editorMode);
  }
}

// Função para verificar se está no modo editor
export function isEditorMode() {
  return editorMode;
}

// Função para registrar callbacks do modo editor
export function setEditorModeCallbacks(callbacks) {
  editorModeCallbacks = { ...editorModeCallbacks, ...callbacks };
}

// Função para obter objeto selecionado
export function getSelectedObject() {
  return selectedObject;
}

// Função para selecionar objeto programaticamente
export function selectObject(object) {
  selectedObject = object;

  if (object && object.isObject3D) {
    // Focar a câmera no objeto selecionado
    try {
      currentCamera.lookAt(object.position);
    } catch (error) {
      console.error('❌ Erro ao focar câmera no objeto:', error);
    }

    // Anexar gizmo ao objeto selecionado
    attachGizmoToObjectInternal(object);

    // Destacar visualmente o objeto selecionado
    highlightSelectedObject(object);


    // Enviar mensagem para o editor React sobre a seleção
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_SELECTED',
        object: getObjectInfo(object),
        originalObject: getObjectInfo(object),
        timestamp: Date.now()
      }, '*');
    }
  } else {
    // Limpar gizmo se nenhum objeto foi selecionado
    clearGizmoInternal();
    clearHighlights();

    // Enviar mensagem de deseleção para o editor React
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_SELECTED',
        object: null,
        originalObject: null,
        timestamp: Date.now()
      }, '*');
    }
  }

  // Notificar seleção
  if (editorModeCallbacks.onObjectSelected) {
    editorModeCallbacks.onObjectSelected(object);
  }

  return object;
}

function enableEditorMode() {
  suspendEngineAudioForEditor();

  // Configurar raycast para seleção
  if (!selectionRaycaster) {
    selectionRaycaster = new THREE.Raycaster();
    selectionMouse = new THREE.Vector2();
  }

  // Ativar sistema de seleção
  isSelectionActive = true;

  // Adicionar event listeners para seleção
  if (renderer && renderer.domElement) {
    renderer.domElement.addEventListener('click', onEditorMouseClick);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  createCustomGizmos();
  setupCustomGizmoInteractions();

  applyVisibilitySettings({
    gizmos: true,    // Gizmos ativos para edição
    helpers: true,   // Helpers visíveis para debug
    colliders: false, // Colisores visíveis para debug
    wireframes: false // Wireframes desativados por padrão
  });

  freezeMixersForEditor();
}

function disableEditorMode() {
  if (allowPanelGameplay()) {
    thawMixersFromEditor();
    resumeEngineAudioFromEditor();
  }

  // Desativar sistema de seleção
  isSelectionActive = false;

  // Remover event listeners
  if (renderer && renderer.domElement) {
    renderer.domElement.removeEventListener('click', onEditorMouseClick);
  }

  // Limpar seleção
  selectedObject = null;

  // Notificar deseleção
  if (editorModeCallbacks.onObjectSelected) {
    editorModeCallbacks.onObjectSelected(null);
  }

  

  // Aplicar configurações de visibilidade para modo jogo
  applyVisibilitySettings({
    gizmos: false,   // Gizmos desativados para jogo
    helpers: false,  // Helpers desativados para performance
    colliders: false, // Colisores desativados para jogo
    wireframes: false // Wireframes desativados para jogo
  });
}

function setupEditorKeyboardControls() {
  // Controles já configurados no gameLoop principal
  // WASD para movimento, QE para subir/descer
}

function onEditorMouseClick(event) {
  if (!editorMode || !isSelectionActive || !selectionRaycaster || !currentCamera) {
    
    return;
  }

  // Verificar se a cena está inicializada
  if (!scene) {
    console.warn('⚠️ Cena não inicializada - pulando clique');
    return;
  }

  // Verificar se o renderer está disponível
  if (!renderer || !renderer.domElement) {
    console.warn('⚠️ Renderer não disponível - pulando clique');
    return;
  }

  // Calcular posição do mouse em coordenadas normalizadas (-1 a +1)
  const rect = renderer.domElement.getBoundingClientRect();
  selectionMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  selectionMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

 

  // Configurar raycaster com a câmera atual
  selectionRaycaster.setFromCamera(selectionMouse, currentCamera);

  // Coletar todos os objetos clicáveis da cena (excluindo gizmos, outlines e elementos de física)
  const clickableObjects = [];
  try {
    scene.traverse((object) => {
      if (object && (object.isMesh || object.isGroup)) {
        // Filtrar objetos que não devem ser selecionados
        const shouldExclude =
          // Gizmos customizados
          object.name.includes('CustomGizmos') ||
          object.name.includes('TranslateGizmo') ||
          object.name.includes('RotateGizmo') ||
          object.name.includes('ScaleGizmo') ||
          object.name.includes('Axis_') ||
          object.name.includes('Plane_') ||
          object.name.includes('Ring_') ||
          object.name.includes('UniformScale') ||
          // Outlines
          object.name.includes('Outline_') ||
          // Elementos de física
          object.name.includes('Collider_') ||
          object.name.includes('Physics_') ||
          object.name.includes('RigidBody_') ||
          object.name.includes('Collision_') ||
          // Outros elementos do editor
          object.name.includes('Editor_') ||
          object.name.includes('Debug_') ||
          object.name.includes('Helper_') ||
          // Verificar se é parte do gizmoGroup
          (gizmoGroup && gizmoGroup.children.includes(object)) ||
          // Verificar se tem userData indicando que é gizmo
          (object.userData && (object.userData.type === 'axis' || object.userData.type === 'plane' || object.userData.type === 'ring'));

        if (!shouldExclude) {
          clickableObjects.push(object);
        }
      }
    });
  } catch (error) {
    console.error('❌ Erro ao percorrer cena:', error);
    return;
  }


  // Fazer raycast em todos os objetos da cena
  const intersects = selectionRaycaster.intersectObjects(clickableObjects, true);


  if (intersects.length > 0) {
    const clickedObject = intersects[0].object;

    // Encontrar o objeto root (pai mais alto na hierarquia)
    let objectToSelect = clickedObject;
    while (objectToSelect.parent && objectToSelect.parent.type !== 'Scene') {
      objectToSelect = objectToSelect.parent;
    }

    // Verificar se o objeto root também não deve ser selecionado
    const shouldExcludeRoot =
      objectToSelect.name.includes('CustomGizmos') ||
      objectToSelect.name.includes('Outline_') ||
      objectToSelect.name.includes('Collider_') ||
      objectToSelect.name.includes('Physics_') ||
      objectToSelect.name.includes('Editor_') ||
      objectToSelect.name.includes('Debug_') ||
      objectToSelect.name.includes('Helper_');

    if (shouldExcludeRoot) {
      return;
    }

    // Selecionar o objeto root
    selectObject(objectToSelect);

  

    // Destacar visualmente o objeto selecionado
    highlightSelectedObject(objectToSelect);

    // Enviar mensagem para o editor React sobre a seleção
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_SELECTED',
        object: getObjectInfo(objectToSelect),
        originalObject: getObjectInfo(clickedObject),
        timestamp: Date.now()
      }, '*');
    }

  } else {
    // Deselecionar se clicou no vazio
    
    selectObject(null);
    clearHighlights();

    // Enviar mensagem de deseleção para o editor React
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_SELECTED',
        object: null,
        originalObject: null,
        timestamp: Date.now()
      }, '*');
    }
  }
}

function highlightSelectedObject(object) {
  // Verificar se a cena está inicializada
  if (!scene) {
    console.warn('⚠️ Cena não inicializada - pulando highlight');
    return;
  }

  // Verificar se o objeto é válido
  if (!object) {
    console.warn('⚠️ Objeto inválido - pulando highlight');
    return;
  }

  // Verificar se o objeto tem o método traverse
  if (typeof object.traverse !== 'function') {
    console.warn('⚠️ Objeto não tem método traverse - pulando highlight');
    return;
  }

  // Limpar highlights anteriores
  clearHighlights();


  // Anexar gizmo ao objeto selecionado
  attachGizmoToObjectInternal(object);

  // Adicionar highlight visual com outline
  try {
    // Criar um outline simples para o objeto selecionado
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide
    });

    // Aplicar outline a todos os meshes do objeto
    object.traverse((child) => {
      if (child && child.isMesh) {
        // Verificar se a geometria existe
        if (!child.geometry) {
          console.warn('⚠️ Mesh sem geometria:', child.name);
          return;
        }

        try {
          // Criar uma cópia da geometria para o outline
          const outlineGeometry = child.geometry.clone();
          const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);

          // Dar nome ao outline para facilitar identificação
          outlineMesh.name = `Outline_${object.name}_${child.name}`;

          // Obter a posição mundial do mesh
          const worldPosition = new THREE.Vector3();
          child.getWorldPosition(worldPosition);

          // Obter a rotação mundial do mesh
          const worldQuaternion = new THREE.Quaternion();
          child.getWorldQuaternion(worldQuaternion);
          const worldRotation = new THREE.Euler();
          worldRotation.setFromQuaternion(worldQuaternion);

          // Obter a escala mundial do mesh
          const worldScale = new THREE.Vector3();
          child.getWorldScale(worldScale);

          // Aplicar transformações mundiais ao outline
          outlineMesh.position.copy(worldPosition);
          outlineMesh.rotation.copy(worldRotation);
          outlineMesh.scale.copy(worldScale);
          outlineMesh.scale.multiplyScalar(1.05); // Ligeiramente maior

          // Adicionar à cena
          scene.add(outlineMesh);

          // Armazenar referência para remoção posterior
          if (!object.outlineMeshes) {
            object.outlineMeshes = [];
          }
          object.outlineMeshes.push(outlineMesh);
        } catch (error) {
          console.warn('⚠️ Erro ao criar outline para mesh:', child.name, error);
        }
      }
    });

    
  } catch (error) {
    console.warn('⚠️ Erro ao criar outline:', error);
  }
}

function clearHighlights() {
  if (!scene) {
    console.warn('⚠️ Cena não inicializada - pulando limpeza de highlights');
    return;
  }

  // Verificar se scene.traverse existe (método do Three.js)
  if (typeof scene.traverse !== 'function') {
    console.warn('⚠️ Método traverse não disponível na cena - pulando limpeza de highlights');
    return;
  }

  // Limpar todos os highlights visuais
  clearGizmoInternal();

  try {
    // Remover outlines de todos os objetos
    scene.traverse((object) => {
      if (object && object.outlineMeshes && Array.isArray(object.outlineMeshes)) {
        object.outlineMeshes.forEach((outlineMesh) => {
          if (outlineMesh) {
            if (outlineMesh.geometry) {
              outlineMesh.geometry.dispose();
            }
            if (outlineMesh.material) {
              outlineMesh.material.dispose();
            }
            if (outlineMesh.parent) {
              outlineMesh.parent.remove(outlineMesh);
            }
          }
        });
        object.outlineMeshes = [];
      }
    });

    // Limpar outlines órfãos que possam estar na cena
    const outlinesToRemove = [];
    scene.traverse((object) => {
      if (object && object.name && object.name.includes('Outline') ||
        (object.material && object.material.color && object.material.color.getHex() === 0x00ff00 && object.material.transparent)) {
        outlinesToRemove.push(object);
      }
    });

    outlinesToRemove.forEach((outline) => {
      if (outline && outline.geometry) {
        outline.geometry.dispose();
      }
      if (outline && outline.material) {
        outline.material.dispose();
      }
      if (outline && outline.parent) {
        outline.parent.remove(outline);
      }
    });

    if (outlinesToRemove.length > 0) {  
    }

  } catch (error) {
    console.error('❌ Erro ao limpar highlights:', error);
  }
}

// Função para configurar TransformControls
function setupTransformControls() {

  if (!scene || !renderer || !camera) {
    console.error('❌ Cena, renderer ou câmera não inicializados:', {
      hasScene: !!scene,
      hasRenderer: !!renderer,
      hasCamera: !!camera
    });
    return;
  }

  try {
    // Verificar se o TransformControls está disponível
    if (typeof TransformControls === 'undefined') {
      console.error('❌ TransformControls não está disponível');
      return;
    }


    // Criar TransformControls
    transformControls = new TransformControls(camera, renderer.domElement);

    // Configurar propriedades do TransformControls
    transformControls.size = 0.8;
    transformControls.showX = true;
    transformControls.showY = true;
    transformControls.showZ = true;

    // Configurar cores dos eixos
    transformControls.setMode('translate');
    transformControls.setSpace('world');

    // Verificar se o TransformControls foi criado corretamente
    if (!transformControls) {
      console.error('❌ TransformControls não foi criado corretamente');
      transformControls = null;
      return;
    }


    // Adicionar à cena
    scene.add(transformControls);

    // Configurar eventos do TransformControls
    transformControls.addEventListener('dragging-changed', (event) => {
      // Desabilitar OrbitControls durante o drag
      if (window.orbitControls) {
        window.orbitControls.enabled = !event.value;
      }
    });

    transformControls.addEventListener('change', () => {
      // Atualizar Inspector quando o objeto é transformado
      if (selectedObject && window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'OBJECT_TRANSFORMED',
          object: getObjectInfo(selectedObject),
          timestamp: Date.now()
        }, '*');
      }
    });

    

  } catch (error) {
    console.error('❌ Erro ao configurar TransformControls:', error);
    transformControls = null;
  }
}

// Função para definir o modo do gizmo (interna)
function setGizmoModeInternal(mode) {
  gizmoMode = mode;
  showCustomGizmo(mode);
}

// Função para anexar gizmo a um objeto (interna)
function attachGizmoToObjectInternal(object) {
  attachCustomGizmoToObject(object);
}

// Função para limpar gizmo (interna)
function clearGizmoInternal() {
  clearCustomGizmo();
}

function handleEditorKeyboardMovement() {
  if (!currentCamera) return;

  const delta = clock.getDelta();
  const moveSpeed = 10.0;
  const adjustedSpeed = moveSpeed * delta;

  // Vetores de movimento
  const forward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);

  // Aplicar rotação da câmera aos vetores
  forward.applyQuaternion(currentCamera.quaternion);
  right.applyQuaternion(currentCamera.quaternion);
  up.applyQuaternion(currentCamera.quaternion);

  // Movimento baseado em teclas
  if (keysPressed['w']) {
    currentCamera.position.add(forward.clone().multiplyScalar(adjustedSpeed));
  }
  if (keysPressed['s']) {
    currentCamera.position.add(forward.clone().multiplyScalar(-adjustedSpeed));
  }
  if (keysPressed['a']) {
    currentCamera.position.add(right.clone().multiplyScalar(-adjustedSpeed));
  }
  if (keysPressed['d']) {
    currentCamera.position.add(right.clone().multiplyScalar(adjustedSpeed));
  }
  if (keysPressed['q']) {
    currentCamera.position.add(up.clone().multiplyScalar(adjustedSpeed));
  }
  if (keysPressed['e']) {
    currentCamera.position.add(up.clone().multiplyScalar(-adjustedSpeed));
  }
}

// Função para obter informações detalhadas de um objeto
export function getObjectInfo(object) {
  if (!object) return null;

  return {
    name: object.name || 'Unnamed',
    type: object.type,
    uuid: object.uuid,
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z
    },
    rotation: {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z
    },
    scale: {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z
    },
    isMesh: object.isMesh,
    isGroup: object.isGroup,
    visible: object.visible,
    children: object.children ? object.children.length : 0,
    userData: object.userData || {},
    // Informações de material se for mesh
    material: object.material ? {
      type: object.material.type,
      color: object.material.color ? object.material.color.getHexString() : null,
      transparent: object.material.transparent,
      opacity: object.material.opacity
    } : null,
    // Propriedades físicas
    physicsEnabled: object.physicsEnabled || false,
    physicsType: object.physicsType || 'box',
    physicsMass: object.physicsMass || 1,
    physicsFriction: object.physicsFriction || 0.5,
    physicsRestitution: object.physicsRestitution || 0.3,
    physicsLinearDamping: object.physicsLinearDamping || 0.01,
    physicsAngularDamping: object.physicsAngularDamping || 0.01,
    physicsSize: object.physicsSize || { x: 1, y: 1, z: 1 },
    physicsOffset: object.physicsOffset || { x: 0, y: 0, z: 0 },
    hasPhysicsBody: !!object.physicsBody
  };
}

// Função para listar todos os objetos da cena
export function getAllSceneObjects() {
  const objects = [];
  const processedObjects = new Set(); // Para evitar duplicatas


  // Primeiro, adicionar objetos do array sceneObjects (modelos carregados)
  sceneObjects.forEach((sceneObject, index) => {
    
    if (sceneObject.gameObject) {
      const objectInfo = getObjectInfo(sceneObject.gameObject);

      // Adicionar informações sobre hierarquia
      objectInfo.parent = sceneObject.gameObject.parent ? sceneObject.gameObject.parent.name : null;
      objectInfo.parentUUID = sceneObject.gameObject.parent ? sceneObject.gameObject.parent.uuid : null;
      objectInfo.children = sceneObject.gameObject.children ? sceneObject.gameObject.children.length : 0;
      objectInfo.uuid = sceneObject.gameObject.uuid;
      objectInfo.id = sceneObject.id;
      objectInfo.type = sceneObject.type;
      objectInfo.source = 'sceneObjects'; // Marcar como modelo carregado

      objects.push(objectInfo);
      processedObjects.add(sceneObject.gameObject.uuid);

    } else {
      console.warn(`⚠️ sceneObject[${index}] sem gameObject:`, sceneObject);
    }
  });

  // Depois, adicionar objetos diretamente na cena (objetos geométricos)
  if (scene) {
    scene.traverse((object) => {
      // Pular objetos já processados e objetos especiais
      if (processedObjects.has(object.uuid) ||
        !object.name ||
        object.name === 'camera' ||
        object.name === 'light' ||
        object.name === 'ambient' ||
        object.name === 'directional' ||
        object.name === 'point' ||
        object.name === 'spot' ||
        object.name === 'helper' ||
        object.name.includes('helper') ||
        object.name.includes('grid') ||
        object.name.includes('axes')) {
        return;
      }

      const objectInfo = getObjectInfo(object);

      // Adicionar informações sobre hierarquia
      objectInfo.parent = object.parent ? object.parent.name : null;
      objectInfo.parentUUID = object.parent ? object.parent.uuid : null;
      objectInfo.children = object.children ? object.children.length : 0;
      objectInfo.uuid = object.uuid;
      objectInfo.id = object.uuid; // Usar UUID como ID para objetos diretos
      objectInfo.type = object.type || 'mesh';
      objectInfo.source = 'direct'; // Marcar como objeto direto

      objects.push(objectInfo);
      processedObjects.add(object.uuid);
    });
  }



  return objects;
}

// Função para obter a câmera do editor
export function getEditorCamera() {
  return editorCamera;
}

// Função para testar raycast manualmente
export function testRaycast(mouseX, mouseY) {
  if (!selectionRaycaster || !currentCamera) {
    console.warn('🎯 Raycast não disponível - raycaster ou câmera não inicializados');
    return null;
  }

  // Configurar raycaster
  selectionRaycaster.setFromCamera({ x: mouseX, y: mouseY }, currentCamera);

  // Coletar objetos clicáveis
  const clickableObjects = [];
  scene.traverse((object) => {
    if (object.isMesh || object.isGroup) {
      clickableObjects.push(object);
    }
  });

  // Fazer raycast
  const intersects = selectionRaycaster.intersectObjects(clickableObjects, true);

  if (intersects.length > 0) {
    const hitObject = intersects[0].object;
   
    return intersects[0];
  }

  return null;
}

// Função para atualizar outlines de um objeto
function updateObjectOutlines(object) {
  if (!object.outlineMeshes || !Array.isArray(object.outlineMeshes)) return;

  let meshIndex = 0;
  object.traverse((child) => {
    if (child.isMesh && object.outlineMeshes[meshIndex]) {
      const outlineMesh = object.outlineMeshes[meshIndex];

      // Obter transformações mundiais atualizadas
      const worldPosition = new THREE.Vector3();
      child.getWorldPosition(worldPosition);

      const worldQuaternion = new THREE.Quaternion();
      child.getWorldQuaternion(worldQuaternion);
      const worldRotation = new THREE.Euler();
      worldRotation.setFromQuaternion(worldQuaternion);

      const worldScale = new THREE.Vector3();
      child.getWorldScale(worldScale);

      // Atualizar outline
      outlineMesh.position.copy(worldPosition);
      outlineMesh.rotation.copy(worldRotation);
      outlineMesh.scale.copy(worldScale);
      outlineMesh.scale.multiplyScalar(1.05);

      meshIndex++;
    }
  });
}

// Função para enviar informações da cena para o editor
function sendSceneInfoToEditor() {
  if (window.parent && window.parent !== window) {
    const sceneObjects = getAllSceneObjects();

    window.parent.postMessage({
      type: 'SCENE_INFO',
      objects: sceneObjects,
      timestamp: Date.now()
    }, '*');
  }
}

// Função para deletar objeto da cena
export function deleteObjectFromScene(objectName) {

  // Encontrar o objeto na cena
  let targetObject = null;
  scene.traverse((object) => {
    if (object.name === objectName) {
      targetObject = object;
    }
  });

  if (!targetObject) {
    console.warn('⚠️ Objeto não encontrado para deleção:', objectName);
    return;
  }

  // Limpar outlines do objeto antes de deletar
  if (targetObject.outlineMeshes && Array.isArray(targetObject.outlineMeshes)) {
    targetObject.outlineMeshes.forEach((outlineMesh) => {
      if (outlineMesh) {
        if (outlineMesh.geometry) {
          outlineMesh.geometry.dispose();
        }
        if (outlineMesh.material) {
          outlineMesh.material.dispose();
        }
        if (outlineMesh.parent) {
          outlineMesh.parent.remove(outlineMesh);
        }
      }
    });
    targetObject.outlineMeshes = [];
  }

  // Se o objeto é o selecionado, limpar seleção
  if (selectedObject === targetObject) {
    selectedObject = null;
    clearGizmoInternal();
  }

  // Remover o objeto da cena
  if (targetObject.parent) {
    targetObject.parent.remove(targetObject);

    // ✅ CORREÇÃO: Remover também do array sceneObjects
    const sceneObjectIndex = sceneObjects.findIndex(obj =>
      obj.gameObject === targetObject || obj.name === objectName
    );

    if (sceneObjectIndex !== -1) {
      sceneObjects.splice(sceneObjectIndex, 1);
    }

    // Notificar o editor sobre a deleção
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_DELETED',
        objectName: objectName
      }, '*');
    }
  } else {
    console.warn('⚠️ Objeto não tem pai para ser removido:', objectName);
  }
}

// Função para atualizar transformação de um objeto
export function updateObjectTransform(objectName, transformType, value) {

  // Encontrar o objeto na cena
  let targetObject = null;
  scene.traverse((object) => {
    if (object.name === objectName) {
      targetObject = object;
    }
  });

  if (!targetObject) {
    console.warn('⚠️ Objeto não encontrado:', objectName);
    return;
  }

  // Aplicar a transformação
  switch (transformType) {
    case 'position':
      targetObject.position.set(value.x, value.y, value.z);
      break;
    case 'rotation':
      targetObject.rotation.set(value.x, value.y, value.z);
      break;
    case 'scale':
      targetObject.scale.set(value.x, value.y, value.z);
      break;
    default:
      console.warn('⚠️ Tipo de transformação desconhecido:', transformType);
      return;
  }

  // Atualizar matriz do objeto
  targetObject.updateMatrix();
  targetObject.updateMatrixWorld(true);

  // SINCRONIZAR COM O CORPO FÍSICO
  if (world) {
    const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
    if (body) {
      switch (transformType) {
        case 'position':
          body.position.set(value.x, value.y, value.z);
          break;
        case 'rotation':
          // Converter Euler para Quaternion com ordem YXZ
          const quaternion = new CANNON.Quaternion();
          quaternion.setFromEuler(value.x, value.y, value.z, 'YXZ');
          body.quaternion.copy(quaternion);
          break;
        case 'scale':
          // Para mudanças de escala, recriar o corpo físico se existir
          if (targetObject.physicsEnabled && targetObject.physicsBody) {
            createPhysicsBody(targetObject);
          }
          break;
      }
    }
  }

  // Se o objeto é o selecionado, atualizar o gizmo
  if (selectedObject === targetObject && selectedObjectGizmo) {
    selectedObjectGizmo.updateMatrix();
    selectedObjectGizmo.updateMatrixWorld(true);
  }

}

// Função para selecionar objeto por UUID
export function selectObjectByUUID(uuid) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  // Procurar o objeto na cena por UUID
  let foundObject = null;
  scene.traverse((object) => {
    if (object.uuid === uuid) {
      foundObject = object;
    }
  });

  if (foundObject) {
    selectObject(foundObject);
    return true;
  } else {
    console.warn('⚠️ Objeto não encontrado por UUID:', uuid);
    return false;
  }
}

// Função para encontrar objeto por UUID
export function findObjectByUUID(uuid) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return null;
  }

  let foundObject = null;
  scene.traverse((object) => {
    if (object.uuid === uuid) {
      foundObject = object;
    }
  });

  return foundObject;
}

// Função para renomear objeto por UUID
export function renameObjectByUUID(uuid, newName) {

  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para renomeação por UUID:', uuid);
    return false;
  }

  try {
    const oldName = object.name;

    // Renomear o objeto na cena Three.js
    object.name = newName;

    // ✅ CORREÇÃO: Atualizar também o nome no array sceneObjects
    const sceneObjectIndex = sceneObjects.findIndex(obj =>
      obj.gameObject === object || obj.uuid === uuid
    );

    if (sceneObjectIndex !== -1) {
      sceneObjects[sceneObjectIndex].name = newName;
    }

    // Se for um grupo, renomear também o userData se existir
    if (object.userData && object.userData.type === 'Group') {
      object.userData.name = newName;
    }

    // Notificar o editor sobre a renomeação
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_RENAMED',
        uuid: uuid,
        oldName: oldName,
        newName: newName
      }, '*');
    }

    // Atualizar informações da cena
    setTimeout(() => {
      sendSceneInfoToEditor();
    }, 100);

    return true;
  } catch (error) {
    console.error('❌ Erro ao renomear objeto por UUID:', error);
    return false;
  }
}

// Função para deletar objeto por UUID
export function deleteObjectByUUID(uuid) {

  const targetObject = findObjectByUUID(uuid);
  if (!targetObject) {
    console.warn('⚠️ Objeto não encontrado para deleção por UUID:', uuid);
    return false;
  }

  // Limpar outlines do objeto antes de deletar
  if (targetObject.outlineMeshes && Array.isArray(targetObject.outlineMeshes)) {
    targetObject.outlineMeshes.forEach((outlineMesh) => {
      if (outlineMesh) {
        if (outlineMesh.geometry) {
          outlineMesh.geometry.dispose();
        }
        if (outlineMesh.material) {
          outlineMesh.material.dispose();
        }
        if (outlineMesh.parent) {
          outlineMesh.parent.remove(outlineMesh);
        }
      }
    });
    targetObject.outlineMeshes = [];
  }

  // Se o objeto é o selecionado, limpar seleção
  if (selectedObject === targetObject) {
    selectedObject = null;
    clearGizmoInternal();
  }

  // Remover o objeto da cena
  if (targetObject.parent) {
    targetObject.parent.remove(targetObject);

    // ✅ CORREÇÃO: Remover também do array sceneObjects
    const sceneObjectIndex = sceneObjects.findIndex(obj =>
      obj.gameObject === targetObject || obj.uuid === uuid
    );

    if (sceneObjectIndex !== -1) {
      sceneObjects.splice(sceneObjectIndex, 1);
    }

    // Notificar o editor sobre a deleção
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_DELETED',
        uuid: uuid,
        objectName: targetObject.name
      }, '*');
    }
    return true;
  } else {
    console.warn('⚠️ Objeto não tem pai para ser removido por UUID:', uuid);
    return false;
  }
}

// Função para fazer parent de um objeto
export function parentObject(childUUID, parentUUID) {

  const childObject = findObjectByUUID(childUUID);
  const parentObject = findObjectByUUID(parentUUID);

  if (!childObject) {
    console.warn('⚠️ Objeto filho não encontrado:', childUUID);
    return false;
  }

  if (!parentObject) {
    console.warn('⚠️ Objeto pai não encontrado:', parentUUID);
    return false;
  }

  // Verificar se não está tentando fazer parent de si mesmo
  if (childUUID === parentUUID) {
    console.warn('⚠️ Não é possível fazer parent de um objeto em si mesmo');
    return false;
  }

  // Verificar se o pai não é filho do filho (evitar loops)
  let currentParent = parentObject.parent;
  while (currentParent) {
    if (currentParent.uuid === childUUID) {
      console.warn('⚠️ Não é possível fazer parent: isso criaria um loop na hierarquia');
      return false;
    }
    currentParent = currentParent.parent;
  }

  try {
    // Remover o objeto filho do seu pai atual
    if (childObject.parent) {
      childObject.parent.remove(childObject);
    }

    // Adicionar o objeto filho ao novo pai
    parentObject.add(childObject);

    // ATUALIZAR O PARENTUUID DO OBJETO FILHO
    childObject.parentUUID = parentUUID;

    // Também atualizar a propriedade parent para compatibilidade
    childObject.parent = parentObject;

    // Atualizar matrizes
    childObject.updateMatrix();
    childObject.updateMatrixWorld(true);
    parentObject.updateMatrix();
    parentObject.updateMatrixWorld(true);


    // Notificar o editor sobre a mudança
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_PARENTED',
        childName: childObject.name,
        parentName: parentObject.name,
        childUUID: childObject.uuid,
        parentUUID: parentUUID
      }, '*');
    }

    // Atualizar informações da cena
    setTimeout(() => {
      sendSceneInfoToEditor();
    }, 100);

    return true;
  } catch (error) {
    console.error('❌ Erro ao fazer parent:', error);
    return false;
  }
}

// Função para atualizar transformação por UUID
export function updateObjectTransformByUUID(uuid, transformType, value) {
  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para atualização por UUID:', uuid);
    return false;
  }

  try {
    switch (transformType) {
      case 'position':
        if (value.x !== undefined) object.position.x = value.x;
        if (value.y !== undefined) object.position.y = value.y;
        if (value.z !== undefined) object.position.z = value.z;
        break;
      case 'rotation':
        if (value.x !== undefined) object.rotation.x = value.x;
        if (value.y !== undefined) object.rotation.y = value.y;
        if (value.z !== undefined) object.rotation.z = value.z;
        break;
      case 'scale':
        if (value.x !== undefined) object.scale.x = value.x;
        if (value.y !== undefined) object.scale.y = value.y;
        if (value.z !== undefined) object.scale.z = value.z;
        break;
      default:
        console.warn('⚠️ Tipo de transformação não reconhecido:', transformType);
        return false;
    }

    // Atualizar física se existir
    if (object.physicsBody) {
      updatePhysicsBody(object);
    }

    return true;
  } catch (error) {
    console.error('❌ Erro ao aplicar transformação por UUID:', error);
    return false;
  }
}

// Função para aplicar material por UUID
export function applyMaterialToObjectByUUID(uuid, materialType, customProperties = {}) {
  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para aplicação de material por UUID:', uuid);
    return false;
  }

  try {
    const applyMaterialWithTextures = (targetObject) => {
      if (targetObject.isMesh) {
        // Criar novo material
        const newMaterial = createMaterial(materialType, customProperties);

        // Preservar texturas existentes se especificado
        if (customProperties.preserveTextures && targetObject.material) {
          const originalTextures = extractMaterialTextures(targetObject.material);
          Object.assign(newMaterial, originalTextures);
        }

        // Aplicar o material
        targetObject.material = newMaterial;
        targetObject.material.needsUpdate = true;

        return true;
      }
      return false;
    };

    // Aplicar material recursivamente se for um grupo
    if (object.isGroup) {
      let applied = false;
      object.traverse((child) => {
        if (child.isMesh) {
          applied = applyMaterialWithTextures(child) || applied;
        }
      });
      return applied;
    } else {
      return applyMaterialWithTextures(object);
    }
  } catch (error) {
    console.error('❌ Erro ao aplicar material por UUID:', error);
    return false;
  }
}

// Função para atualizar propriedade de material por UUID
// Função para aplicar novo tipo de material
function applyMaterialType(oldMaterial, materialType) {

  let newMaterial;
  const properties = {
    color: oldMaterial.color ? oldMaterial.color.clone() : new THREE.Color(0xffffff),
    opacity: oldMaterial.opacity || 1,
    transparent: oldMaterial.transparent || false,
    wireframe: oldMaterial.wireframe || false,
    flatShading: oldMaterial.flatShading || false,
    side: oldMaterial.side || THREE.FrontSide
  };

  switch (materialType) {
    case 'standard':
      newMaterial = new THREE.MeshStandardMaterial(properties);
      if (oldMaterial.roughness !== undefined) newMaterial.roughness = oldMaterial.roughness;
      if (oldMaterial.metalness !== undefined) newMaterial.metalness = oldMaterial.metalness;
      if (oldMaterial.emissive) newMaterial.emissive = oldMaterial.emissive.clone();
      if (oldMaterial.emissiveIntensity !== undefined) newMaterial.emissiveIntensity = oldMaterial.emissiveIntensity;
      break;
    case 'basic':
      newMaterial = new THREE.MeshBasicMaterial(properties);
      break;
    case 'lambert':
      newMaterial = new THREE.MeshLambertMaterial(properties);
      if (oldMaterial.emissive) newMaterial.emissive = oldMaterial.emissive.clone();
      if (oldMaterial.emissiveIntensity !== undefined) newMaterial.emissiveIntensity = oldMaterial.emissiveIntensity;
      break;
    case 'phong':
      newMaterial = new THREE.MeshPhongMaterial(properties);
      if (oldMaterial.emissive) newMaterial.emissive = oldMaterial.emissive.clone();
      if (oldMaterial.emissiveIntensity !== undefined) newMaterial.emissiveIntensity = oldMaterial.emissiveIntensity;
      if (oldMaterial.shininess !== undefined) newMaterial.shininess = oldMaterial.shininess;
      break;
    case 'toon':
      newMaterial = new THREE.MeshToonMaterial(properties);
      if (oldMaterial.emissive) newMaterial.emissive = oldMaterial.emissive.clone();
      if (oldMaterial.emissiveIntensity !== undefined) newMaterial.emissiveIntensity = oldMaterial.emissiveIntensity;
      break;
    case 'shader':
      // Para shader customizado, manter o material atual por enquanto
      return;
    default:
      console.warn('⚠️ Tipo de material não reconhecido:', materialType);
      return;
  }

  // Copiar texturas se existirem
  if (oldMaterial.map) newMaterial.map = oldMaterial.map;
  if (oldMaterial.normalMap) newMaterial.normalMap = oldMaterial.normalMap;
  if (oldMaterial.roughnessMap) newMaterial.roughnessMap = oldMaterial.roughnessMap;
  if (oldMaterial.metalnessMap) newMaterial.metalnessMap = oldMaterial.metalnessMap;
  if (oldMaterial.aoMap) newMaterial.aoMap = oldMaterial.aoMap;
  if (oldMaterial.emissiveMap) newMaterial.emissiveMap = oldMaterial.emissiveMap;

  // Substituir o material no objeto
  return newMaterial;
}

export function updateMaterialPropertyByUUID(uuid, propertyName, value) {
  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para atualização de material por UUID:', uuid);
    return false;
  }

  try {
    const updateMaterialProp = (mesh, material) => {
      if (material) {
        
        switch (propertyName) {
          case 'color':
            if (material.color && material.color.setHex) {
              // Converter cor hex para número inteiro
              const hexValue = value.startsWith('#') ? value.substring(1) : value;
              const colorInt = parseInt(hexValue, 16);
              material.color.setHex(colorInt);
            } else {
              console.warn('⚠️ Material não tem propriedade color ou setHex:', material);
            }
            break;
          case 'opacity':
            material.opacity = value;
            material.transparent = value < 1;
            break;
          case 'roughness':
            if (material.roughness !== undefined) {
              material.roughness = value;
            }
            break;
          case 'metalness':
            if (material.metalness !== undefined) {
              material.metalness = value;
            }
            break;
          case 'emissive':
            if (material.emissive && material.emissive.setHex) {
              // Converter cor hex para número inteiro
              const hexValue = value.startsWith('#') ? value.substring(1) : value;
              const colorInt = parseInt(hexValue, 16);
              material.emissive.setHex(colorInt);
            } else {
              console.warn('⚠️ Material não tem propriedade emissive ou setHex:', material);
            }
            break;
          case 'emissiveIntensity':
            if (material.emissiveIntensity !== undefined) {
              material.emissiveIntensity = value;
            }
            break;
          case 'transparent':
            material.transparent = Boolean(value);
            break;
          case 'wireframe':
            material.wireframe = Boolean(value);
            break;
          case 'flatShading':
            material.flatShading = Boolean(value);
            break;
          case 'side':
            // Converter string para constante THREE.js
            switch (value) {
              case 'front':
                material.side = THREE.FrontSide;
                break;
              case 'back':
                material.side = THREE.BackSide;
                break;
              case 'double':
                material.side = THREE.DoubleSide;
                break;
              default:
                console.warn('⚠️ Valor de side inválido:', value);
            }
            break;
          case 'materialType':
            const newMaterial = applyMaterialType(material, value);
            if (newMaterial && mesh) {
              // Substituir o material no mesh
              mesh.material = newMaterial;
            }
            break;
          case 'map':
          case 'diffuseMap':
            // Aplicar textura difusa
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.map = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura difusa:', error);
              });
            } else {
              material.map = null;
              material.needsUpdate = true;
            }
            break;
          case 'normalMap':
            // Aplicar textura normal
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.normalMap = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura normal:', error);
              });
            } else {
              material.normalMap = null;
              material.needsUpdate = true;
            }
            break;
          case 'roughnessMap':
            // Aplicar textura de rugosidade
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.roughnessMap = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura de rugosidade:', error);
              });
            } else {
              material.roughnessMap = null;
              material.needsUpdate = true;
            }
            break;
          case 'metalnessMap':
            // Aplicar textura de metalicidade
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.metalnessMap = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura de metalicidade:', error);
              });
            } else {
              material.metalnessMap = null;
              material.needsUpdate = true;
            }
            break;
          case 'aoMap':
            // Aplicar textura de oclusão ambiente
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.aoMap = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura de oclusão ambiente:', error);
              });
            } else {
              material.aoMap = null;
              material.needsUpdate = true;
            }
            break;
          case 'emissiveMap':
            // Aplicar textura emissiva
            if (value && value.trim() !== '') {
              loadTexture(value).then(texture => {
                if (texture) {
                  material.emissiveMap = texture;
                  material.needsUpdate = true;
                }
              }).catch(error => {
                console.error('❌ Erro ao carregar textura emissiva:', error);
              });
            } else {
              material.emissiveMap = null;
              material.needsUpdate = true;
            }
            break;
          case 'mapTiling':
            // Aplicar tiling da textura difusa
            if (Array.isArray(value) && value.length === 2 && material.map) {
              material.map.repeat.set(value[0], value[1]);
              material.map.wrapS = THREE.RepeatWrapping;
              material.map.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'mapOffset':
            // Aplicar offset da textura difusa
            if (Array.isArray(value) && value.length === 2 && material.map) {
              material.map.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'normalMapTiling':
            // Aplicar tiling da textura normal
            if (Array.isArray(value) && value.length === 2 && material.normalMap) {
              material.normalMap.repeat.set(value[0], value[1]);
              material.normalMap.wrapS = THREE.RepeatWrapping;
              material.normalMap.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'normalMapOffset':
            // Aplicar offset da textura normal
            if (Array.isArray(value) && value.length === 2 && material.normalMap) {
              material.normalMap.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'roughnessMapTiling':
            // Aplicar tiling da textura de rugosidade
            if (Array.isArray(value) && value.length === 2 && material.roughnessMap) {
              material.roughnessMap.repeat.set(value[0], value[1]);
              material.roughnessMap.wrapS = THREE.RepeatWrapping;
              material.roughnessMap.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'roughnessMapOffset':
            // Aplicar offset da textura de rugosidade
            if (Array.isArray(value) && value.length === 2 && material.roughnessMap) {
              material.roughnessMap.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'metalnessMapTiling':
            // Aplicar tiling da textura de metalicidade
            if (Array.isArray(value) && value.length === 2 && material.metalnessMap) {
              material.metalnessMap.repeat.set(value[0], value[1]);
              material.metalnessMap.wrapS = THREE.RepeatWrapping;
              material.metalnessMap.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'metalnessMapOffset':
            // Aplicar offset da textura de metalicidade
            if (Array.isArray(value) && value.length === 2 && material.metalnessMap) {
              material.metalnessMap.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'aoMapTiling':
            // Aplicar tiling da textura de oclusão ambiente
            if (Array.isArray(value) && value.length === 2 && material.aoMap) {
              material.aoMap.repeat.set(value[0], value[1]);
              material.aoMap.wrapS = THREE.RepeatWrapping;
              material.aoMap.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'aoMapOffset':
            // Aplicar offset da textura de oclusão ambiente
            if (Array.isArray(value) && value.length === 2 && material.aoMap) {
              material.aoMap.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'emissiveMapTiling':
            // Aplicar tiling da textura emissiva
            if (Array.isArray(value) && value.length === 2 && material.emissiveMap) {
              material.emissiveMap.repeat.set(value[0], value[1]);
              material.emissiveMap.wrapS = THREE.RepeatWrapping;
              material.emissiveMap.wrapT = THREE.RepeatWrapping;
              material.needsUpdate = true;
            }
            break;
          case 'emissiveMapOffset':
            // Aplicar offset da textura emissiva
            if (Array.isArray(value) && value.length === 2 && material.emissiveMap) {
              material.emissiveMap.offset.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'normalScale':
            // Aplicar intensidade do normal map
            if (Array.isArray(value) && value.length === 2) {
              material.normalScale.set(value[0], value[1]);
              material.needsUpdate = true;
            }
            break;
          case 'roughnessMapIntensity':
            // Aplicar intensidade da textura de rugosidade
            if (typeof value === 'number' && material.roughnessMap) {
              // Para roughness, multiplicamos o valor da textura pela intensidade
              material.roughness = material.roughness * value;
              material.needsUpdate = true;
            }
            break;
          case 'metalnessMapIntensity':
            // Aplicar intensidade da textura de metalicidade
            if (typeof value === 'number' && material.metalnessMap) {
              // Para metalness, multiplicamos o valor da textura pela intensidade
              material.metalness = material.metalness * value;
              material.needsUpdate = true;
            }
            break;
          case 'aoMapIntensity':
            // Aplicar intensidade da textura de oclusão ambiente
            if (typeof value === 'number' && material.aoMap) {
              // Para AO, multiplicamos o valor da textura pela intensidade
              material.aoIntensity = value;
              material.needsUpdate = true;
            }
            break;
          case 'emissiveMapIntensity':
            // Aplicar intensidade da textura emissiva
            if (typeof value === 'number' && material.emissiveMap) {
              // Para emissive, multiplicamos o valor da textura pela intensidade
              material.emissiveIntensity = material.emissiveIntensity * value;
              material.needsUpdate = true;
            }
            break;
          case 'castShadow':
          case 'receiveShadow':
            // Propriedades de sombra são aplicadas ao mesh, não ao material
            return true; // Retornar true para indicar que foi processada
          default:
            if (material[propertyName] !== undefined) {
              material[propertyName] = value;
            } else {
              console.warn('⚠️ Propriedade de material não encontrada:', propertyName);
              return false;
            }
        }

        material.needsUpdate = true;
        return true;
      }
      return false;
    };

    // Atualizar material recursivamente se for um grupo
    if (object.isGroup) {
      let updated = false;
      object.traverse((child) => {
        if (child.isMesh && child.material) {
          updated = updateMaterialProp(child, child.material) || updated;
        }
      });
      return updated;
    } else if (object.isMesh) {
      return updateMaterialProp(object, object.material);
    }

    return false;
  } catch (error) {
    console.error('❌ Erro ao atualizar propriedade de material por UUID:', error);
    return false;
  }
}

// Função para atualizar propriedades de sombra do mesh
export function updateMeshShadowProperties(uuid, propertyName, value) {
  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para atualização de sombra por UUID:', uuid);
    return false;
  }

  try {
    let updated = false;

    // Função para atualizar propriedades de sombra em um mesh
    const updateShadowProp = (mesh) => {
      if (mesh && mesh.isMesh) {
        switch (propertyName) {
          case 'castShadow':
            mesh.castShadow = Boolean(value);
            updated = true;
            break;
          case 'receiveShadow':
            mesh.receiveShadow = Boolean(value);
            updated = true;
            break;
          default:
            console.warn('⚠️ Propriedade de sombra não reconhecida:', propertyName);
            return false;
        }
        return true;
      }
      return false;
    };

    // Atualizar propriedades de sombra recursivamente
    if (object.isGroup) {
      object.traverse((child) => {
        if (child.isMesh) {
          updateShadowProp(child);
        }
      });
    } else if (object.isMesh) {
      updateShadowProp(object);
    }

    if (updated) {

      // Notificar o editor
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'MESH_SHADOW_PROPERTY_UPDATED',
          uuid: uuid,
          propertyName: propertyName,
          value: value,
          timestamp: Date.now()
        }, '*');
      }
    }

    return updated;
  } catch (error) {
    console.error('❌ Erro ao atualizar propriedade de sombra por UUID:', error);
    return false;
  }
}

// Função para atualizar propriedade de luz
export function updateLightProperty(objectName, propertyName, value) {

  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  const object = scene.getObjectByName(objectName);
  if (!object) {
    console.error('❌ Objeto não encontrado:', objectName);
    return false;
  }

  if (!object.userData || !object.userData.isLight) {
    console.error('❌ Objeto não é uma luz:', objectName);
    return false;
  }

  try {
    let updated = false;

    switch (propertyName) {
      case 'color':
        if (object.color && object.color.setHex) {
          // Remover # se presente
          const hexValue = value.startsWith('#') ? value.substring(1) : value;
          object.color.setHex(parseInt(hexValue, 16));
          updated = true;
        }
        break;
      case 'intensity':
        if (object.intensity !== undefined) {
          object.intensity = parseFloat(value);
          updated = true;
        }
        break;
      case 'distance':
        if (object.distance !== undefined) {
          object.distance = parseFloat(value);
          updated = true;
        }
        break;
      case 'decay':
        if (object.decay !== undefined) {
          object.decay = parseFloat(value);
          updated = true;
        }
        break;
      case 'angle':
        if (object.angle !== undefined) {
          object.angle = parseFloat(value);
          updated = true;
        }
        break;
      case 'penumbra':
        if (object.penumbra !== undefined) {
          object.penumbra = parseFloat(value);
          updated = true;
        }
        break;
      case 'castShadow':
        if (object.castShadow !== undefined) {
          object.castShadow = Boolean(value);
          updated = true;
        }
        break;
      case 'shadowMapSize':
        if (object.shadow && object.shadow.mapSize) {
          const size = parseInt(value);
          object.shadow.mapSize.width = size;
          object.shadow.mapSize.height = size;
          updated = true;
        }
        break;
      case 'shadowBias':
        if (object.shadow && object.shadow.bias !== undefined) {
          object.shadow.bias = parseFloat(value);
          updated = true;
        }
        break;
      default:
        console.warn('⚠️ Propriedade de luz não reconhecida:', propertyName);
        return false;
    }

    if (updated) {
      // Notificar o editor
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'LIGHT_PROPERTY_UPDATED',
          objectName: objectName,
          propertyName: propertyName,
          value: value,
          timestamp: Date.now()
        }, '*');
      }
    }

    return updated;
  } catch (error) {
    console.error('❌ Erro ao atualizar propriedade de luz:', error);
    return false;
  }
}

// Função para atualizar propriedade de luz por UUID
export function updateLightPropertyByUUID(uuid, propertyName, value) {

  const object = findObjectByUUID(uuid);
  if (!object) {
    console.warn('⚠️ Objeto não encontrado para atualização de luz por UUID:', uuid);
    return false;
  }

  if (!object.userData || !object.userData.isLight) {
    console.error('❌ Objeto não é uma luz:', uuid);
    return false;
  }

  try {
    let updated = false;

    switch (propertyName) {
      case 'color':
        if (object.color && object.color.setHex) {
          // Remover # se presente
          const hexValue = value.startsWith('#') ? value.substring(1) : value;
          object.color.setHex(parseInt(hexValue, 16));
          updated = true;
        }
        break;
      case 'intensity':
        if (object.intensity !== undefined) {
          object.intensity = parseFloat(value);
          updated = true;
        }
        break;
      case 'distance':
        if (object.distance !== undefined) {
          object.distance = parseFloat(value);
          updated = true;
        }
        break;
      case 'decay':
        if (object.decay !== undefined) {
          object.decay = parseFloat(value);
          updated = true;
        }
        break;
      case 'angle':
        if (object.angle !== undefined) {
          object.angle = parseFloat(value);
          updated = true;
        }
        break;
      case 'penumbra':
        if (object.penumbra !== undefined) {
          object.penumbra = parseFloat(value);
          updated = true;
        }
        break;
      case 'castShadow':
        if (object.castShadow !== undefined) {
          object.castShadow = Boolean(value);
          updated = true;
        }
        break;
      case 'shadowMapSize':
        if (object.shadow && object.shadow.mapSize) {
          const size = parseInt(value);
          object.shadow.mapSize.width = size;
          object.shadow.mapSize.height = size;
          updated = true;
        }
        break;
      case 'shadowBias':
        if (object.shadow && object.shadow.bias !== undefined) {
          object.shadow.bias = parseFloat(value);
          updated = true;
        }
        break;
      default:
        console.warn('⚠️ Propriedade de luz não reconhecida:', propertyName);
        return false;
    }

    if (updated) {

      // Notificar o editor
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'LIGHT_PROPERTY_UPDATED',
          uuid: uuid,
          propertyName: propertyName,
          value: value,
          timestamp: Date.now()
        }, '*');
      }
    }

    return updated;
  } catch (error) {
    console.error('❌ Erro ao atualizar propriedade de luz por UUID:', error);
    return false;
  }
}

// Função para selecionar objeto por nome (mantida para compatibilidade)
export function selectObjectByName(objectName) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  // Procurar o objeto na cena
  const object = scene.getObjectByName(objectName);
  if (object) {
    selectObject(object);
    return true;
  } else {
    console.warn('⚠️ Objeto não encontrado por nome:', objectName);
    return false;
  }
}

// Listener para mensagens do editor
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SELECT_OBJECT') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      selectObjectByUUID(event.data.uuid);
    } else if (event.data.objectName) {
      selectObjectByName(event.data.objectName);
    }
  } else if (event.data && event.data.type === 'UPDATE_OBJECT_TRANSFORM') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      updateObjectTransformByUUID(event.data.uuid, event.data.transformType, event.data.value);
    } else if (event.data.objectName) {
      updateObjectTransform(event.data.objectName, event.data.transformType, event.data.value);
    }
  } else if (event.data && event.data.type === 'UPDATE_OBJECT_PHYSICS') {
    const { objectName, physicsProperty, value } = event.data;
    updateObjectPhysics(objectName, physicsProperty, value);
  } else if (event.data && event.data.type === 'APPLY_MESH_COLLIDERS_TO_ALL_MESHES') {
    const { objectName, options } = event.data;

    // Encontrar o objeto na cena
    let sceneObject = sceneObjects.find(obj => obj.name === objectName);
    let object = null;

    if (sceneObject) {
      object = sceneObject.gameObject;
    } else {
      scene.traverse((sceneObject) => {
        if (sceneObject.name === objectName) {
          object = sceneObject;
        }
      });
    }

    if (object) {
      // Aplicar mesh colliders a todos os meshes filhos
      const createdBodies = createMeshCollidersForAllMeshes(
        object,
        options.useConvex || false,
        options.makeStatic || true
      );

      // Mostrar visualizações se solicitado
      if (options.showColliders) {
        showPhysicsColliders();
      }
    } else {
      console.error('❌ Objeto não encontrado para aplicar mesh colliders:', objectName);
    }
  } else if (event.data && event.data.type === 'UPDATE_LIGHT_PROPERTY') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      updateLightPropertyByUUID(event.data.uuid, event.data.lightProperty, event.data.value);
    } else if (event.data.objectName) {
      updateLightProperty(event.data.objectName, event.data.lightProperty, event.data.value);
    }
  } else if (event.data && event.data.type === 'RENAME_OBJECT') {
    if (event.data.uuid && event.data.newName) {
      renameObjectByUUID(event.data.uuid, event.data.newName);
    }
  } else if (event.data && event.data.type === 'DELETE_OBJECT') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      deleteObjectByUUID(event.data.uuid);
    } else if (event.data.objectName) {
      deleteObjectFromScene(event.data.objectName);
    }
  } else if (event.data && event.data.type === 'PARENT_OBJECT') {
    const { childUUID, parentUUID } = event.data;
    parentObject(childUUID, parentUUID);
  } else if (event.data && event.data.type === 'ADD_MODEL_TO_SCENE') {
    const { modelData } = event.data;
    addModelToScene(modelData);
  } else if (event.data && event.data.type === 'ADD_BASIC_OBJECT') {
    const { objectType } = event.data;
    addBasicObjectToScene(objectType);
  } else if (event.data && event.data.type === 'APPLY_MATERIAL') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      applyMaterialToObjectByUUID(event.data.uuid, event.data.materialType, event.data.customProperties || {});
    } else if (event.data.objectName) {
      applyMaterialToObject(event.data.objectName, event.data.materialType, event.data.customProperties || {});
    }
  } else if (event.data && event.data.type === 'UPDATE_MATERIAL_PROPERTY') {
    // Suportar tanto UUID quanto nome para compatibilidade
    if (event.data.uuid) {
      updateMaterialPropertyByUUID(event.data.uuid, event.data.propertyName, event.data.value);
    } else if (event.data.objectName) {
      updateMaterialProperty(event.data.objectName, event.data.propertyName, event.data.value);
    }
  } else if (event.data && event.data.type === 'UPDATE_MESH_SHADOW_PROPERTY') {
    // Atualizar propriedades de sombra do mesh
    if (event.data.uuid) {
      updateMeshShadowProperties(event.data.uuid, event.data.propertyName, event.data.value);
    }
  } else if (event.data && event.data.type === 'UPDATE_TEXTURE_TILING') {
    // Atualizar tiling de textura
    const { objectName, textureType, tilingX, tilingY } = event.data;
    updateTextureTiling(objectName, textureType, tilingX, tilingY);
  } else if (event.data && event.data.type === 'UPDATE_TEXTURE_OFFSET') {
    // Atualizar offset de textura
    const { objectName, textureType, offsetX, offsetY } = event.data;
    updateTextureOffset(objectName, textureType, offsetX, offsetY);
  } else if (event.data && event.data.type === 'UPDATE_NORMAL_MAP_INTENSITY') {
    // Atualizar intensidade de normal map
    const { objectName, intensityX, intensityY } = event.data;
    updateNormalMapIntensity(objectName, intensityX, intensityY);
  } else if (event.data && event.data.type === 'UPDATE_ROUGHNESS_MAP_INTENSITY') {
    // Atualizar intensidade de roughness map
    const { objectName, intensity } = event.data;
    updateRoughnessMapIntensity(objectName, intensity);
  } else if (event.data && event.data.type === 'UPDATE_METALNESS_MAP_INTENSITY') {
    // Atualizar intensidade de metalness map
    const { objectName, intensity } = event.data;
    updateMetalnessMapIntensity(objectName, intensity);
  } else if (event.data && event.data.type === 'UPDATE_AO_MAP_INTENSITY') {
    // Atualizar intensidade de AO map
    const { objectName, intensity } = event.data;
    updateAOMapIntensity(objectName, intensity);
  } else if (event.data && event.data.type === 'UPDATE_EMISSIVE_MAP_INTENSITY') {
    // Atualizar intensidade de emissive map
    const { objectName, intensity } = event.data;
    updateEmissiveMapIntensity(objectName, intensity);
  } else if (event.data && event.data.type === 'GET_TEXTURE_PROPERTIES') {
    // Obter propriedades de textura
    const { objectName } = event.data;
    const properties = getTextureProperties(objectName);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'TEXTURE_PROPERTIES',
        objectName: objectName,
        properties: properties,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'GET_AVAILABLE_MATERIALS') {
    const materials = getAvailableMaterials();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'AVAILABLE_MATERIALS',
        materials: materials,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'GET_OBJECT_MATERIALS') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let object = null;
    if (event.data.uuid) {
      object = findObjectByUUID(event.data.uuid);
    } else if (event.data.objectName) {
      object = scene.getObjectByName(event.data.objectName);
    }

    if (object) {
      const materials = getObjectMaterials(object);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'OBJECT_MATERIALS',
          uuid: event.data.uuid,
          objectName: event.data.objectName,
          materials: materials,
          timestamp: Date.now()
        }, '*');
      }
    }
  } else if (event.data && event.data.type === 'GET_OBJECT_ANIMATIONS') {

    // Suportar tanto UUID quanto nome para compatibilidade
    let animations = null;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      animations = object ? getObjectAnimations(object.name) : null;
    } else if (event.data.objectName) {
      animations = getObjectAnimations(event.data.objectName);
    }


    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'OBJECT_ANIMATIONS',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animations: animations,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'PLAY_OBJECT_ANIMATION') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? playObjectAnimation(object.name, event.data.animationName, event.data.options || {}) : false;
    } else if (event.data.objectName) {
      result = playObjectAnimation(event.data.objectName, event.data.animationName, event.data.options || {});
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_PLAY_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'STOP_OBJECT_ANIMATION') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? stopObjectAnimation(object.name, event.data.animationName) : false;
    } else if (event.data.objectName) {
      result = stopObjectAnimation(event.data.objectName, event.data.animationName);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_STOP_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'PAUSE_OBJECT_ANIMATION') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? pauseObjectAnimation(object.name, event.data.animationName) : false;
    } else if (event.data.objectName) {
      result = pauseObjectAnimation(event.data.objectName, event.data.animationName);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_PAUSE_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'RESUME_OBJECT_ANIMATION') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? resumeObjectAnimation(object.name, event.data.animationName) : false;
    } else if (event.data.objectName) {
      result = resumeObjectAnimation(event.data.objectName, event.data.animationName);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_RESUME_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_ANIMATION_SPEED') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? setAnimationSpeed(object.name, event.data.animationName, event.data.speed) : false;
    } else if (event.data.objectName) {
      result = setAnimationSpeed(event.data.objectName, event.data.animationName, event.data.speed);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_SPEED_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        speed: event.data.speed,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_ANIMATION_LOOP') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let result = false;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      result = object ? setAnimationLoop(object.name, event.data.animationName, event.data.loopType, event.data.repetitions) : false;
    } else if (event.data.objectName) {
      result = setAnimationLoop(event.data.objectName, event.data.animationName, event.data.loopType, event.data.repetitions);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_LOOP_RESULT',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        loopType: event.data.loopType,
        success: result,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'GET_ANIMATION_STATE') {
    // Suportar tanto UUID quanto nome para compatibilidade
    let state = null;
    if (event.data.uuid) {
      const object = findObjectByUUID(event.data.uuid);
      state = object ? getAnimationState(object.name, event.data.animationName) : null;
    } else if (event.data.objectName) {
      state = getAnimationState(event.data.objectName, event.data.animationName);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ANIMATION_STATE',
        uuid: event.data.uuid,
        objectName: event.data.objectName,
        animationName: event.data.animationName,
        state: state,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_GIZMO_MODE') {
    const { mode } = event.data;
    setGizmoMode(mode);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'GIZMO_MODE_CHANGED',
        mode: mode,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'GET_GIZMO_MODE') {
    const mode = getGizmoMode();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'GIZMO_MODE',
        mode: mode,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'ATTACH_GIZMO_TO_OBJECT') {
    const { objectName } = event.data;
    const object = scene.getObjectByName(objectName);
    if (object) {
      attachGizmoToObject(object);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'GIZMO_ATTACHED',
          objectName: objectName,
          success: true,
          timestamp: Date.now()
        }, '*');
      }
    } else {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'GIZMO_ATTACHED',
          objectName: objectName,
          success: false,
          error: 'Object not found',
          timestamp: Date.now()
        }, '*');
      }
    }
  } else if (event.data && event.data.type === 'CLEAR_GIZMO') {
    clearGizmo();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'GIZMO_CLEARED',
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'IS_GIZMO_VISIBLE') {
    const visible = isGizmoVisible();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'GIZMO_VISIBILITY',
        visible: visible,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_GIZMOS_VISIBILITY') {
    const { visible } = event.data;
    setGizmosVisibility(visible);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'GIZMOS_VISIBILITY_CHANGED',
        visible: visible,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_HELPERS_VISIBILITY') {
    const { visible } = event.data;
    setHelpersVisibility(visible);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'HELPERS_VISIBILITY_CHANGED',
        visible: visible,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_COLLIDERS_VISIBILITY') {
    const { visible } = event.data;
    setCollidersVisibility(visible);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'COLLIDERS_VISIBILITY_CHANGED',
        visible: visible,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'SET_WIREFRAMES_VISIBILITY') {
    const { visible } = event.data;
    setWireframesVisibility(visible);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'WIREFRAMES_VISIBILITY_CHANGED',
        visible: visible,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'GET_VISIBILITY_STATE') {
    const state = getVisibilityState();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'VISIBILITY_STATE',
        state: state,
        timestamp: Date.now()
      }, '*');
    }
  } else if (event.data && event.data.type === 'APPLY_VISIBILITY_SETTINGS') {
    const { settings } = event.data;
    applyVisibilitySettings(settings);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'VISIBILITY_SETTINGS_APPLIED',
        settings: settings,
        timestamp: Date.now()
      }, '*');
    }
  }
});



// Função para verificar se o sistema de seleção está ativo
export function getSelectionActiveStatus() {
  return isSelectionActive && editorMode;
}

// Função para ativar/desativar seleção manualmente
export function setSelectionActive(active) {
  isSelectionActive = active;
}

// Funções para controlar gizmos
export function setGizmoMode(mode) {
  if (['translate', 'rotate', 'scale'].includes(mode)) {
    setGizmoModeInternal(mode);
  } else {
    console.warn('⚠️ Modo de gizmo inválido:', mode);
  }
}

export function getGizmoMode() {
  return gizmoMode;
}

export function attachGizmoToObject(object) {
  attachGizmoToObjectInternal(object);
}

export function clearGizmo() {
  clearGizmoInternal();
}

export function isGizmoVisible() {
  return transformControls ? transformControls.visible : false;
}

// Função para debug do gizmo
export function debugGizmo() {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return false;
  }

  if (transformControls) {
    
    // Verificar se está na cena
    if (!scene.children.includes(transformControls)) {
      console.warn('🎯 TransformControls não está na cena! Adicionando...');
      scene.add(transformControls);
    }

    return true;
  } else {
    console.warn('🎯 TransformControls não inicializado!');
    return false;
  }
}

// Função para forçar a renderização do gizmo
export function forceGizmoUpdate() {
  if (transformControls) {
    transformControls.updateMatrix();
    transformControls.updateMatrixWorld(true);
  }
}

// Função para limpar outlines órfãos
export function cleanupOrphanOutlines() {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return 0;
  }

  const outlinesToRemove = [];
  scene.traverse((object) => {
    if (object.name && object.name.startsWith('Outline_')) {
      outlinesToRemove.push(object);
    }
  });

  outlinesToRemove.forEach((outline) => {
    if (outline.geometry) {
      outline.geometry.dispose();
    }
    if (outline.material) {
      outline.material.dispose();
    }
    if (outline.parent) {
      outline.parent.remove(outline);
    }
  });

  return outlinesToRemove.length;
}

// ✅ FUNÇÃO PARA LIMPAR HELPERS DE LUZ ÓRFÃOS
export function cleanupOrphanLightHelpers() {

  if (!scene) {
    console.error('❌ Cena não inicializada');
    return 0;
  }

  const helpersToRemove = [];

  scene.traverse((object) => {
    if (object.userData && object.userData.isLightHelper) {
      // Verificar se a luz original ainda existe
      const parentLightName = object.userData.parentLight;
      if (parentLightName) {
        const parentLight = scene.getObjectByName(parentLightName);
        if (!parentLight) {
          helpersToRemove.push(object);
        }
      }
    }
  });

  // Remover objetos órfãos
  helpersToRemove.forEach(object => {
    if (object.parent) {
      object.parent.remove(object);
    }
  });

  return helpersToRemove.length;
}

// Função para adicionar objeto básico à cena
export function addBasicObjectToScene(objectType) {

  if (!scene) {
    console.error('❌ Cena não inicializada');
    return;
  }

  try {
    let mesh;
    const geometryClass = new Geometry();

    // Gerar nome único para o objeto
    let objectName = objectType;
    let counter = 1;
    while (scene.getObjectByName(objectName)) {
      objectName = `${objectType}_${counter}`;
      counter++;
    }

    // Criar objeto baseado no tipo
    switch (objectType) {
      case 'cube':
        mesh = geometryClass.createBox(1, 1, 1, getRandomColor());
        break;
      case 'sphere':
        mesh = geometryClass.createSphere(0.5, 32, 16, getRandomColor());
        break;
      case 'cylinder':
        mesh = geometryClass.createCylinder(0.5, 0.5, 1, 32, getRandomColor());
        break;
      case 'plane':
        mesh = geometryClass.createPlane(2, 2, getRandomColor());
        break;
      case 'torus':
        mesh = geometryClass.createTorus(0.5, 0.2, 16, 32, getRandomColor());
        break;
      case 'cone':
        mesh = geometryClass.createCone(0.5, 1, 32, getRandomColor());
        break;
      case 'icosahedron':
        mesh = geometryClass.createIcosahedron(0.5, 0, getRandomColor());
        break;
      case 'pointLight':
        // Criar luz pontual
        const pointLight = new THREE.PointLight(0xffffff, 1, 100);
        pointLight.position.set(0, 5, 0);
        pointLight.castShadow = true;

        // Configurar sombras para luz pontual
        pointLight.shadow.mapSize.width = 1024;
        pointLight.shadow.mapSize.height = 1024;
        pointLight.shadow.camera.near = 0.5;
        pointLight.shadow.camera.far = 500;
        pointLight.shadow.bias = -0.0001;

        pointLight.name = objectName;
        pointLight.userData = { type: 'PointLight', isLight: true };

        // Criar helper visual para a luz
        const pointLightHelper = new THREE.PointLightHelper(pointLight, 1, 0xffff00);
        pointLightHelper.name = `${objectName}_Helper`;
        pointLight.add(pointLightHelper);

        mesh = pointLight;
        break;
      case 'directionalLight':
        // Criar luz direcional
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 7.5);
        directionalLight.castShadow = true;

        // Configurar sombras para luz direcional com área maior
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.bias = -0.0001;

        directionalLight.name = objectName;
        directionalLight.userData = { type: 'DirectionalLight', isLight: true };

        // Criar helper visual para a luz
        const directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 5, 0xffff00);
        directionalLightHelper.name = `${objectName}_Helper`;
        directionalLight.add(directionalLightHelper);

        mesh = directionalLight;
        break;
      case 'spotLight':
        // Criar luz spot
        const spotLight = new THREE.SpotLight(0xffffff, 1);
        spotLight.position.set(0, 10, 0);
        spotLight.angle = Math.PI / 4;
        spotLight.penumbra = 0.1;
        spotLight.decay = 2;
        spotLight.distance = 200;
        spotLight.castShadow = true;

        // Configurar sombras para luz spot
        spotLight.shadow.mapSize.width = 1024;
        spotLight.shadow.mapSize.height = 1024;
        spotLight.shadow.camera.near = 0.5;
        spotLight.shadow.camera.far = 500;
        spotLight.shadow.bias = -0.0001;

        spotLight.name = objectName;
        spotLight.userData = { type: 'SpotLight', isLight: true };

        // Criar helper visual para a luz
        const spotLightHelper = new THREE.SpotLightHelper(spotLight, 0xffff00);
        spotLightHelper.name = `${objectName}_Helper`;
        spotLight.add(spotLightHelper);

        mesh = spotLight;
        break;
      case 'ambientLight':
        // Criar luz ambiente
        const ambientLight = new THREE.AmbientLight(0x404040, 1);
        ambientLight.name = objectName;
        ambientLight.userData = { type: 'AmbientLight', isLight: true };

        // Para luz ambiente, não precisamos de helper visual
        mesh = ambientLight;
        break;
      default:
        console.warn('⚠️ Tipo de objeto não reconhecido:', objectType);
        return;
    }

    if (mesh) {
      // Definir nome do objeto
      mesh.name = objectName;

      // Verificar se é uma luz
      const isLight = mesh.userData && mesh.userData.isLight;

      if (isLight) {
        // Para luzes, adicionar diretamente à cena
        scene.add(mesh);


        // Selecionar a luz recém-adicionada
        selectObject(mesh);

        // Notificar o editor sobre a adição
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'BASIC_OBJECT_ADDED_TO_SCENE',
            objectName: objectName,
            objectType: objectType,
            isLight: true,
            lightType: mesh.userData.type,
            timestamp: Date.now()
          }, '*');
        }
      } else {
        // Para objetos geométricos, criar grupo automaticamente
        const group = new THREE.Group();
        const groupName = `Group_${objectName}`;
        group.name = groupName;
        group.userData = { type: 'Group', isGroup: true, isAutoGroup: true };

        // Adicionar mesh ao grupo
        group.add(mesh);

        // Adicionar grupo à cena usando instantiate
        const sceneObject = instantiate(group, groupName, 'group');


        // Selecionar o grupo recém-adicionado
        selectObject(group);

        // Notificar o editor sobre a adição
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'BASIC_OBJECT_ADDED_TO_SCENE',
            objectName: objectName,
            objectType: objectType,
            groupName: groupName,
            timestamp: Date.now()
          }, '*');
        }
      }
    }

  } catch (error) {
    console.error('❌ Erro ao adicionar objeto básico:', error);

    // Notificar erro ao editor
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'BASIC_OBJECT_ADD_ERROR',
        error: error.message,
        objectType: objectType,
        timestamp: Date.now()
      }, '*');
    }
  }
}

// Função auxiliar para gerar cor aleatória
function getRandomColor() {
  const colors = [
    0x4caf50, // Verde
    0x2196f3, // Azul
    0xff9800, // Laranja
    0x9c27b0, // Roxo
    0xe91e63, // Rosa
    0x00bcd4, // Ciano
    0x795548, // Marrom
    0x607d8b, // Azul acinzentado
    0xff5722, // Vermelho laranja
    0x8bc34a  // Verde claro
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Função para adicionar modelo à cena via drag and drop
export function addModelToScene(modelData) {

  if (!scene) {
    console.error('❌ Cena não inicializada');
    return;
  }

  try {
    // Usar o nome do arquivo diretamente
    let modelFileName = modelData.name || modelData.path;

    // Garantir que tem a extensão correta
    if (!modelFileName.endsWith('.glb') && !modelFileName.endsWith('.gltf')) {
      modelFileName += '.glb';
    }


    // Gerar nome único para o modelo
    const baseName = modelData.name.replace('.glb', '').replace('.gltf', '');
    let modelName = baseName;
    let counter = 1;

    // Verificar se já existe um objeto com esse nome
    while (scene.getObjectByName(modelName)) {
      modelName = `${baseName}_${counter}`;
      counter++;
    }

    // Carregar o modelo usando LoadModelGLB
    LoadModelGLB(
      modelFileName,
      { x: 1, y: 1, z: 1 }, // Escala padrão
      { x: 0, y: 0, z: 0 }, // Posição padrão
      { x: 0, y: 0, z: 0 }, // Rotação padrão
      (loadedModel, animations) => {

        if (loadedModel) {
          // Definir o nome do modelo
          loadedModel.name = modelName;

          // CRIAR GRUPO AUTOMATICAMENTE PARA MODELOS
          const group = new THREE.Group();
          const groupName = `Group_${modelName}`;
          group.name = groupName;
          group.userData = { type: 'Group', isGroup: true, isAutoGroup: true };

          // Adicionar modelo ao grupo
          group.add(loadedModel);
          
          // ✅ IMPORTANTE: Garantir que as transformações sejam aplicadas corretamente
          // Atualizar a matriz mundial do grupo para refletir as transformações do modelo
          group.updateMatrixWorld(true);
       

          // ✅ CORREÇÃO: Criar sceneObject manualmente para preservar animações
          const sceneObject = {
            id: group.uuid || Date.now().toString(),
            name: groupName,
            gameObject: group,
            type: 'Group',
            animations: [],
            animator: null,
            physics: null,
            components: {},

            // Método para acessar o ID
            getGameObjectId: function () {
              return this.id;
            },

            // Método para acessar o nome
            getGameObjectName: function () {
              return this.name;
            },

            // Método para adicionar um componente
            addComponent: function (name, component) {
              if (typeof component === 'function') {
                this.components[name] = component.bind(this);
              }
            },

            // Método para remover um componente
            removeComponent: function (name) {
              if (this.components[name]) {
                delete this.components[name];
              }
            }
          };

          // ✅ CORREÇÃO: Associar animações ao GRUPO (objeto visível na cena)
          if (animations && animations.length > 0) {
            // ✅ CRÍTICO: Associar as animações e animator ao GRUPO (objeto visível)
            group.animations = animations;
            group.animator = new THREE.AnimationMixer(group);

            // ✅ Tocar todas as animações automaticamente no GRUPO
            animations.forEach((clip) => {
              const action = group.animator.clipAction(clip);
              action.setLoop(THREE.LoopRepeat);
              //action.play();
            });

            // ✅ Referenciar no sceneObject para facilitar buscas
            sceneObject.animations = animations;
            sceneObject.animator = group.animator;
            sceneObject.gameObject.animations = animations;
            sceneObject.gameObject.animator = group.animator;

          }

          // ✅ Adicionar à cena e ao controle manualmente
          sceneObjects.push(sceneObject);
          scene.add(group);



          // Selecionar o grupo recém-adicionado
          selectObject(group);

          // Notificar o editor sobre a adição
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'MODEL_ADDED_TO_SCENE',
              modelName: modelName,
              modelData: modelData,
              groupName: groupName,
              sceneObject: sceneObject
            }, '*');
          }

          // Enviar informações atualizadas da cena
          setTimeout(() => {
            sendSceneInfoToEditor();
          }, 100);
        } else {
          console.error('❌ Modelo não foi carregado corretamente');
        }
      },
      'default', // Material padrão
      {}, // Propriedades customizadas
      false // Não preservar rotação
    );

  } catch (error) {
    console.error('❌ Erro ao adicionar modelo à cena:', error);

    // Notificar erro ao editor
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'MODEL_ADD_ERROR',
        error: error.message,
        modelData: modelData
      }, '*');
    }
  }
}

// Função para atualizar propriedades físicas de um objeto
export function updateObjectPhysics(objectName, physicsProperty, value) {

  // Encontrar o objeto na cena - tentar primeiro no array sceneObjects
  let sceneObject = sceneObjects.find(obj => obj.name === objectName);
  let object = null;

  if (sceneObject) {
    // Se encontrou no array sceneObjects, usar o gameObject
    object = sceneObject.gameObject;
  } else {
    // Se não encontrou no array, procurar diretamente na cena
    scene.traverse((sceneObject) => {
      if (sceneObject.name === objectName) {
        object = sceneObject;
      }
    });
  }

  if (!object) {
    console.error('❌ Objeto não encontrado:', objectName);
    return;
  }

  // Atualizar a propriedade física no objeto
  object[physicsProperty] = value;
  
 

  // Se a física foi habilitada, criar o corpo físico
  if (physicsProperty === 'physicsEnabled' && value === true) {
    createPhysicsBody(object);
  }
  // Se a física foi desabilitada, remover o corpo físico
  else if (physicsProperty === 'physicsEnabled' && value === false) {
    removePhysicsBody(object);
  }
  // Se propriedades que requerem recriação do corpo físico foram alteradas
  else if (['physicsType', 'physicsSize', 'physicsOffset', 'physicsRotation',
    'physicsMass', 'physicsGravityEnabled', 'physicsCollisionEnabled',
    'meshColliderConvex'].includes(physicsProperty) && object.physicsEnabled) {
    
    createPhysicsBody(object);

  }
  // Se outras propriedades foram alteradas e a física está ativa, atualizar o corpo
  else if (object.physicsEnabled && object.physicsBody) {
    updatePhysicsBody(object);
  }

}


import { threeToCannon, ShapeType } from 'three-to-cannon';

// Função para criar corpo físico
export function createPhysicsBody(object) {
 
  
  if (!world) {
    console.error('❌ Mundo físico não inicializado');
    return;
  }

  // Remover corpo físico existente se houver
  if (object.physicsBody) {
    removePhysicsBody(object);
  }

  // IMPORTANTE: Se for um Group E for mesh/trimesh, aplicar física em todas as meshes filhas
  if ((object.isGroup || object.type === 'Group') && 
      (object.physicsType === 'mesh' || object.physicsType === 'trimesh')) {
    
    
    // Contar quantas meshes filhas existem
    let meshCount = 0;
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        meshCount++;
      }
    });
    
    
    const createdBodies = [];
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        
        // Copiar propriedades físicas do grupo para a mesh filha
        child.physicsType = object.physicsType || 'mesh';
        child.physicsMass = object.physicsMass || 1;
        child.physicsFriction = object.physicsFriction || 0.5;
        child.physicsRestitution = object.physicsRestitution || 0.3;
        child.physicsLinearDamping = object.physicsLinearDamping || 0.01;
        child.physicsAngularDamping = object.physicsAngularDamping || 0.01;
        child.physicsGravityEnabled = object.physicsGravityEnabled;
        child.physicsCollisionEnabled = object.physicsCollisionEnabled;
        child.physicsSize = object.physicsSize;
        child.physicsOffset = object.physicsOffset;
        child.physicsRotation = object.physicsRotation;
        
        // Criar corpo físico para a mesh filha
        const childBody = createPhysicsBodyForSingleMesh(child);
        if (childBody) {
          createdBodies.push(childBody);
        } else {
          console.error(`❌ Falha ao criar collider para: ${child.name}`);
        }
      }
    });
    return createdBodies;
  }

  const physicsType = object.physicsType || 'box';
  const mass = object.physicsMass || 1;
  const friction = object.physicsFriction || 0.5;
  const restitution = object.physicsRestitution || 0.3;
  const linearDamping = object.physicsLinearDamping || 0.01;
  const angularDamping = object.physicsAngularDamping || 0.01;

  // Garantir que physicsSize e physicsOffset são objetos válidos
  const baseSize = (object.physicsSize && typeof object.physicsSize === 'object')
    ? object.physicsSize
    : { x: 1, y: 1, z: 1 };
  const scale = (object.scale && typeof object.scale === 'object')
    ? object.scale
    : { x: 1, y: 1, z: 1 };

  // Para colliders primitivos (box, sphere, cylinder, etc.), aplicar escala
  // Para mesh colliders, a escala já é aplicada na geometria
  const shouldApplyScale = !['mesh', 'trimesh', 'convex'].includes(physicsType);
  const physicsSize = {
    x: baseSize.x * (shouldApplyScale && typeof scale.x === 'number' ? scale.x : 1),
    y: baseSize.y * (shouldApplyScale && typeof scale.y === 'number' ? scale.y : 1),
    z: baseSize.z * (shouldApplyScale && typeof scale.z === 'number' ? scale.z : 1)
  };

  const physicsOffset = (object.physicsOffset && typeof object.physicsOffset === 'object')
    ? object.physicsOffset
    : { x: 0, y: 0, z: 0 };

  const physicsRotation = (object.physicsRotation && typeof object.physicsRotation === 'object')
    ? object.physicsRotation
    : { x: 0, y: 0, z: 0 };

  // Novas propriedades para controle de gravidade e colisão
  // Para mesh/trimesh, SEMPRE desabilitar gravidade (são colisores estáticos)
  let gravityEnabled;
  if (physicsType === 'mesh' || physicsType === 'trimesh') {
    gravityEnabled = false; // SEMPRE false para mesh/trimesh
  } else {
    gravityEnabled = object.physicsGravityEnabled !== false; // true por padrão para outros tipos
  }
  const collisionEnabled = object.physicsCollisionEnabled !== false; // true por padrão

  // Garantir que todas as propriedades x, y, z existem
  if (typeof physicsSize.x !== 'number') physicsSize.x = 1;
  if (typeof physicsSize.y !== 'number') physicsSize.y = 1;
  if (typeof physicsSize.z !== 'number') physicsSize.z = 1;

  if (typeof physicsOffset.x !== 'number') physicsOffset.x = 0;
  if (typeof physicsOffset.y !== 'number') physicsOffset.y = 0;
  if (typeof physicsOffset.z !== 'number') physicsOffset.z = 0;

  if (typeof physicsRotation.x !== 'number') physicsRotation.x = 0;
  if (typeof physicsRotation.y !== 'number') physicsRotation.y = 0;
  if (typeof physicsRotation.z !== 'number') physicsRotation.z = 0;

  let shape;
  let visualGeometry; // Para visualização do colisor

  switch (physicsType) {
    case 'sphere':
      const radius = Math.max(physicsSize.x, physicsSize.y, physicsSize.z) / 2;
      shape = new CANNON.Sphere(radius);
      visualGeometry = new THREE.SphereGeometry(radius, 16, 16);
      break;

    case 'cylinder':
      shape = new CANNON.Cylinder(physicsSize.x / 2, physicsSize.z / 2, physicsSize.y, 8);
      visualGeometry = new THREE.CylinderGeometry(physicsSize.x / 2, physicsSize.z / 2, physicsSize.y, 8);
      break;

    case 'plane':
      shape = new CANNON.Plane();
      visualGeometry = new THREE.PlaneGeometry(10, 10); // Tamanho padrão para visualização
      break;

    case 'capsule':
      shape = new CANNON.Cylinder(physicsSize.x / 2, physicsSize.x / 2, physicsSize.y, 8);
      visualGeometry = new THREE.CylinderGeometry(physicsSize.x / 2, physicsSize.x / 2, physicsSize.y, 8);
      break;

    case 'convex':
      // Para convex hull, usar a geometria do modelo com escala aplicada
      try {
        
        const convexResult = threeToCannon(object, { type: ShapeType.CONVEX });
        
        if (convexResult && convexResult.shape) {
          shape = convexResult.shape;
          visualGeometry = convexResult.geometry || object.geometry;
        } else {
          console.warn(`⚠️ threeToCannon falhou para convex ${object.name}, usando fallback...`);
          // Fallback para box
          shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
          visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
        }
      } catch (error) {
        console.error(`❌ Erro ao criar Convex Hull Collider para ${object.name}:`, error);
        // Fallback para box em caso de erro
        shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
        visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
      }
      break;

    case 'mesh':
    case 'trimesh':
      // Mesh Collider usando three-to-cannon (baseado no exemplo do ChatGPT)
      try {
        
        // Usar threeToCannon com tipo MESH (correto)
        const threeToCannonResult = threeToCannon(object, { type: ShapeType.MESH });
        
        if (threeToCannonResult && threeToCannonResult.shape) {
          shape = threeToCannonResult.shape;
          visualGeometry = threeToCannonResult.geometry || object.geometry;
        } else {
          console.warn(`⚠️ threeToCannon falhou para ${object.name}, tentando fallback...`);
          
          // Fallback para o método antigo
          const meshColliderConvex = object.meshColliderConvex || false;
          const meshResult = createMeshCollider(object, meshColliderConvex);
          if (meshResult) {
            shape = meshResult.shape;
            visualGeometry = meshResult.geometry;
          } else {
            // Fallback final para box
            shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
            visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
            console.warn(`⚠️ Mesh Collider fallback final para box para ${object.name}`);
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao criar Mesh/Trimesh Collider para ${object.name}:`, error);
        
        // Fallback para box em caso de erro
        shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
        visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
        console.warn(`⚠️ Fallback para box devido a erro para ${object.name}`);
      }
      break;

    case 'simple-mesh':
      // NOVA OPÇÃO: Simple Mesh Colliders (estilo ChatGPT) - sem física, apenas raycasting
      const simpleColliders = createSimpleMeshColliders(object);
      if (simpleColliders && simpleColliders.length > 0) {
        
        // Para Simple Mesh Colliders, não criamos shape físico real
        // Apenas um shape dummy para compatibilidade
        shape = new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)); // Shape mínimo invisível
        visualGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        
        // Marcar o objeto como usando Simple Mesh Colliders
        object.userData.useSimpleMeshColliders = true;
        object.userData.simpleMeshColliders = simpleColliders;
        
        // Configurar como estático (não afetado pela física)
        mass = 0;
        gravityEnabled = false;
        collisionEnabled = false;
      } else {
        console.warn(`⚠️ Nenhum Simple Mesh Collider criado para ${object.name}`);
        // Fallback para box
        shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
        visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
      }
      break;

    case 'auto':
      // Auto-detectar o melhor tipo de collider
      const autoDetectedType = detectBestPhysicsType(object);

      // Recursivamente chamar com o tipo detectado
      const originalType = object.physicsType;
      object.physicsType = autoDetectedType;
      // Para auto-detect, usar o tamanho base sem escala (a escala será aplicada na função específica)
      const baseSizeForAuto = (object.physicsSize && typeof object.physicsSize === 'object')
        ? object.physicsSize
        : { x: 1, y: 1, z: 1 };
      const autoResult = createPhysicsBodyForType(object, autoDetectedType, baseSizeForAuto);
      object.physicsType = originalType; // Restaurar tipo original

      if (autoResult) {
        shape = autoResult.shape;
        visualGeometry = autoResult.geometry;
      } else {
        // Fallback para box
        shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
        visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
      }
      break;

    case 'box':
    default:
      shape = new CANNON.Box(new CANNON.Vec3(physicsSize.x / 2, physicsSize.y / 2, physicsSize.z / 2));
      visualGeometry = new THREE.BoxGeometry(physicsSize.x, physicsSize.y, physicsSize.z);
      break;
  }

  // Criar o corpo físico
  let bodyPosition;
  
  // Para mesh/trimesh colliders, usar posição exata do objeto (já que os vértices foram transformados)
  if (physicsType === 'mesh' || physicsType === 'trimesh') {
    bodyPosition = new CANNON.Vec3(
      object.position ? object.position.x : 0,
      object.position ? object.position.y : 0,
      object.position ? object.position.z : 0
    );
  } else {
    // Para colliders primitivos, aplicar offset normalmente
    bodyPosition = new CANNON.Vec3(
      (object.position ? object.position.x : 0) + physicsOffset.x,
      (object.position ? object.position.y : 0) + physicsOffset.y,
      (object.position ? object.position.z : 0) + physicsOffset.z
    );
  }

  const body = new CANNON.Body({
    mass: mass,
    shape: shape,
    position: bodyPosition
  });

  
  // Aplicar rotação do colisor
  if (physicsType === 'mesh' || physicsType === 'trimesh') {
    // Para mesh colliders, usar rotação identidade (já que os vértices foram transformados)
    body.quaternion.set(0, 0, 0, 1); // Sem rotação
  } else {
    // Para colliders primitivos, aplicar rotação normalmente
    if (physicsRotation.x !== 0 || physicsRotation.y !== 0 || physicsRotation.z !== 0) {
      // Converter Euler para Quaternion
      const euler = new THREE.Euler(physicsRotation.x, physicsRotation.y, physicsRotation.z);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromEuler(euler, 'YXZ');

      // Aplicar a rotação do colisor ao corpo físico
      body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    } else {
      // Usar a rotação do objeto Three.js se não houver rotação específica do colisor
      body.quaternion.set(
        object.quaternion ? object.quaternion.x : 0,
        object.quaternion ? object.quaternion.y : 0,
        object.quaternion ? object.quaternion.z : 0,
        object.quaternion ? object.quaternion.w : 1
      );
    }
  }

  // Aplicar configurações de gravidade e colisão
  if (physicsType === 'mesh' || physicsType === 'trimesh') {
    // Para mesh/trimesh colliders, SEMPRE usar STATIC (sem gravidade)
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.invMass = 0;
    body.collisionResponse = true; // Garantir colisões para mesh colliders
    
    // IMPORTANTE: Configurações específicas para mesh colliders
    body.collisionFilterGroup = 1;
    body.collisionFilterMask = -1;
    
    // Para Trimesh, garantir que o shape também tenha as configurações corretas
    if (shape && shape.type === CANNON.Shape.types.TRIMESH) {
      shape.collisionResponse = true;
      shape.collisionFilterGroup = 1;
      shape.collisionFilterMask = -1;
    }
    
  } else {
    // Para outros tipos de collider, usar lógica normal de gravidade
    if (!gravityEnabled) {
      // Modo Kinematic (como Unity): não afetado pela gravidade, mas pode ser movido programaticamente
      body.type = CANNON.Body.KINEMATIC;
      body.mass = 0; // Massa 0 para objetos cinemáticos
      body.invMass = 0; // Inverso da massa também 0
    } else {
      // Modo Dynamic: afetado pela gravidade e forças
      body.type = CANNON.Body.DYNAMIC;
      body.mass = mass;
      body.updateMassProperties();
    }
  }

  if (!collisionEnabled) {
    body.collisionResponse = false; // Desabilita colisões
  } else {
    // Garantir que colisões estejam habilitadas
    body.collisionResponse = true;
    
    // Para mesh colliders, garantir configurações específicas
    if (physicsType === 'mesh' || physicsType === 'trimesh') {
      body.collisionFilterGroup = 1;
      body.collisionFilterMask = -1;
      
      // Para Trimesh, garantir que o shape também tenha as configurações corretas
      if (shape && shape.type === CANNON.Shape.types.TRIMESH) {
        shape.collisionResponse = true;
        shape.collisionFilterGroup = 1;
        shape.collisionFilterMask = -1;
        
        // IMPORTANTE: Para Trimesh, garantir que as propriedades sejam configuradas corretamente
        if (shape.updateTree) {
          shape.updateTree();
        }
        
        // IMPORTANTE: Para Trimesh, garantir que as propriedades sejam configuradas corretamente
        if (shape.updateNormals) {
          shape.updateNormals();
        }
        
        // IMPORTANTE: Para Trimesh, garantir que as propriedades sejam configuradas corretamente
        if (shape.updateEdges) {
          shape.updateEdges();
        }
      }
    }
  }

  // Configurar propriedades físicas
  body.material = new CANNON.Material('default');
  body.material.friction = friction;
  body.material.restitution = restitution;
  body.linearDamping = linearDamping;
  body.angularDamping = angularDamping;

  // Configurar material de contato específico para este objeto
  const contactMaterial = new CANNON.ContactMaterial(
    body.material,
    world.defaultContactMaterial.materials[0],
    {
      friction: friction,
      restitution: restitution,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
      frictionEquationRelaxation: 3
    }
  );
  world.addContactMaterial(contactMaterial);
  
  // Para mesh colliders, adicionar material de contato específico
  if (physicsType === 'mesh' || physicsType === 'trimesh') {
    const meshContactMaterial = new CANNON.ContactMaterial(
      body.material,
      world.defaultContactMaterial.materials[0],
      {
        friction: friction,
        restitution: restitution,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 1e8,
        frictionEquationRelaxation: 3
      }
    );
    world.addContactMaterial(meshContactMaterial);
  }

  // Adicionar o corpo ao mundo físico
  world.addBody(body);

  // Armazenar referência do corpo no objeto
  object.physicsBody = body;

  // Vincular o objeto Three.js ao corpo físico para sincronização
  body.threeObject = object;


  // Criar visualização do colisor
  createColliderVisualization(object, visualGeometry, physicsOffset);

  
  return body;
}

// Função para criar corpo físico para uma mesh específica (usada por Groups)
function createPhysicsBodyForSingleMesh(object) {
  if (!world) {
    console.error('❌ Mundo físico não inicializado');
    return null;
  }

  // Remover corpo físico existente se houver
  if (object.physicsBody) {
    removePhysicsBody(object);
  }

  const physicsType = object.physicsType || 'mesh';
  const mass = object.physicsMass || 1;
  const friction = object.physicsFriction || 0.5;
  const restitution = object.physicsRestitution || 0.3;
  const linearDamping = object.physicsLinearDamping || 0.01;
  const angularDamping = object.physicsAngularDamping || 0.01;

  // Para mesh colliders, usar posição exata e rotação identidade
  const bodyPosition = new CANNON.Vec3(
    object.position ? object.position.x : 0,
    object.position ? object.position.y : 0,
    object.position ? object.position.z : 0
  );

  let shape;
  let visualGeometry;

  const meshResult = createMeshColliderForSingleMesh(object, false); // false = não convex

  if (meshResult) {
    shape = meshResult.shape;
    visualGeometry = meshResult.geometry;
   
  } else {
    console.warn(`⚠️ Falha ao criar mesh collider para ${object.name}, usando fallback box`);
    // Fallback para box
    shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    visualGeometry = new THREE.BoxGeometry(1, 1, 1);
  }

  // Criar o corpo físico - SEMPRE STATIC para mesh colliders
  const body = new CANNON.Body({
    mass: 0, // SEMPRE 0 para mesh colliders (STATIC)
    shape: shape,
    position: bodyPosition,
    quaternion: new CANNON.Quaternion(0, 0, 0, 1) // Sem rotação (identidade) - os vértices já foram transformados
  });

  // Configurar propriedades físicas
  body.material = new CANNON.Material('default');
  body.material.friction = friction;
  body.material.restitution = restitution;
  body.linearDamping = linearDamping;
  body.angularDamping = angularDamping;

  // Configurar como estático por padrão para mesh colliders (SEM gravidade)
  body.type = CANNON.Body.STATIC;
  body.mass = 0;
  body.invMass = 0;
  body.collisionResponse = true;
  body.collisionFilterGroup = 1;
  body.collisionFilterMask = -1;
  
  // IMPORTANTE: Mesh colliders NUNCA devem ter gravidade

  // Para Trimesh, garantir configurações específicas
  if (shape && shape.type === CANNON.Shape.types.TRIMESH) {
    shape.collisionResponse = true;
    shape.collisionFilterGroup = 1;
    shape.collisionFilterMask = -1;
    
    if (shape.updateTree) {
      shape.updateTree();
    }
    if (shape.updateNormals) {
      shape.updateNormals();
    }
    if (shape.updateEdges) {
      shape.updateEdges();
    }
  }

  // Adicionar ao mundo físico
  world.addBody(body);

  // Armazenar referência
  object.physicsBody = body;
  body.threeObject = object;

  // Criar visualização do colisor
  createColliderVisualization(object, visualGeometry, { x: 0, y: 0, z: 0 });

  return body;
}

// Função para criar Mesh Colliders para TODOS os meshes filhos (Unity-style)
export function createMeshCollidersForAllMeshes(object, useConvex = false, makeStatic = true) {
  try {

    const createdBodies = [];

    // Percorrer todos os meshes filhos
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {

        // Obter posição e rotação mundiais do mesh
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();

        child.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

        // Criar mesh collider para este mesh específico
        const meshResult = createMeshColliderForSingleMesh(child, useConvex);

        if (meshResult) {
                  // Criar corpo físico - SEMPRE STATIC para mesh colliders
        const body = new CANNON.Body({
          mass: 0, // SEMPRE 0 para mesh colliders (STATIC)
          shape: meshResult.shape,
          position: new CANNON.Vec3(worldPosition.x, worldPosition.y, worldPosition.z),
          quaternion: new CANNON.Quaternion(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w) // Usar rotação mundial
        });

          // Configurar propriedades físicas
          body.material = new CANNON.Material('default');
          body.material.friction = object.physicsFriction || 0.5;
          body.material.restitution = object.physicsRestitution || 0.3;
          body.linearDamping = object.physicsLinearDamping || 0.01;
          body.angularDamping = object.physicsAngularDamping || 0.01;

          // Configurar como STATIC para mesh colliders (sem gravidade)
          body.type = CANNON.Body.STATIC;
          body.mass = 0;
          body.invMass = 0;
          body.collisionResponse = true;
          body.collisionFilterGroup = 1;
          body.collisionFilterMask = -1;
          

          // Adicionar ao mundo físico
          world.addBody(body);

          // Armazenar referência
          body.threeObject = child;
          child.physicsBody = body;

          // Criar visualização do colisor
          createColliderVisualization(child, meshResult.geometry, { x: 0, y: 0, z: 0 });

          createdBodies.push({
            mesh: child,
            body: body,
            shape: meshResult.shape
          });

        } else {
          console.warn(`⚠️ Falha ao criar mesh collider para: ${child.name}`);
        }
      }
    });

    return createdBodies;

  } catch (error) {
    console.error(`❌ Erro ao criar mesh colliders para ${object.name}:`, error);
    return [];
  }
}

// NOVA FUNÇÃO: Criar Mesh Colliders simples usando Three.js Raycaster (estilo ChatGPT)
export function createSimpleMeshColliders(object) {
  try {

    const meshColliders = [];

    // Percorrer todos os meshes filhos
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {

        // Calcular bounding box e sphere como no exemplo do ChatGPT
        child.geometry.computeBoundingBox();
        child.geometry.computeBoundingSphere();

        // Marcar o mesh como collider
        child.userData.isCollider = true;
        child.userData.colliderType = 'mesh';

        // Adicionar à lista de colliders
        meshColliders.push(child);

      }
    });

    // Armazenar a lista de colliders no objeto pai
    object.userData.meshColliders = meshColliders;

    return meshColliders;

  } catch (error) {
    console.error(`❌ Erro ao criar simple mesh colliders para ${object.name}:`, error);
    return [];
  }
}

// NOVA FUNÇÃO: Testar colisão com Simple Mesh Colliders usando Raycaster
export function testSimpleMeshCollision(mouseX, mouseY, camera, targetObject = null) {
  try {
    if (!raycaster) {
      raycaster = new THREE.Raycaster();
    }

    // Converter coordenadas do mouse
    const mouse = new THREE.Vector2();
    mouse.x = (mouseX / window.innerWidth) * 2 - 1;
    mouse.y = -(mouseY / window.innerHeight) * 2 + 1;

    // Configurar raycaster
    raycaster.setFromCamera(mouse, camera);

    // Determinar objetos para testar
    let objectsToTest = [];
    
    if (targetObject) {
      // Testar apenas o objeto específico
      if (targetObject.userData.meshColliders) {
        objectsToTest = targetObject.userData.meshColliders;
      } else {
        // Se não tem meshColliders, testar o próprio objeto e seus filhos
        objectsToTest = [targetObject];
      }
    } else {
      // Testar todos os objetos da cena que têm colliders
      scene.traverse((object) => {
        if (object.userData.meshColliders) {
          objectsToTest = objectsToTest.concat(object.userData.meshColliders);
        } else if (object.userData.isCollider) {
          objectsToTest.push(object);
        }
      });
    }


    // Realizar o raycast
    const intersects = raycaster.intersectObjects(objectsToTest, true);

    if (intersects.length > 0) {
      const hitObject = intersects[0].object;
     
      return {
        object: hitObject,
        point: intersects[0].point,
        distance: intersects[0].distance,
        face: intersects[0].face,
        intersects: intersects
      };
    } else {
      return null;
    }

  } catch (error) {
    console.error(`❌ Erro ao testar colisão:`, error);
    return null;
  }
}

// NOVA FUNÇÃO: Adicionar event listener para clique com Simple Mesh Colliders
export function addSimpleMeshCollisionListener(camera, targetObject = null, callback = null) {
  try {

    const clickHandler = (event) => {
      const result = testSimpleMeshCollision(event.clientX, event.clientY, camera, targetObject);
      
      if (result && callback) {
        callback(result);
      }
    };

    // Adicionar event listener
    window.addEventListener('click', clickHandler);

    // Retornar função para remover o listener
    return () => {
      window.removeEventListener('click', clickHandler);
    };

  } catch (error) {
    console.error(`❌ Erro ao adicionar listener de colisão:`, error);
    return null;
  }
}

// Função para criar Mesh Collider para um mesh específico
function createMeshColliderForSingleMesh(mesh, useConvex = false) {
  try {

    const geometry = mesh.geometry;
    if (!geometry) {
      console.warn(`⚠️ Mesh ${mesh.name} não tem geometria`);
      return null;
    }
    
    // ✅ CRÍTICO: Verificar se a geometria tem atributos de posição
    if (!geometry.attributes || !geometry.attributes.position) {
      console.error(`❌ Geometria de ${mesh.name} não tem atributos de posição`);
      return null;
    }


    // Calcular bounding box e sphere
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

  

    // Extrair vertices e índices da geometria
    const vertices = [];
    const indices = [];

    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute) {
      console.warn(`⚠️ Atributo de posição não encontrado na geometria de ${mesh.name}`);
      return null;
    }

    // Obter escala e rotação do mesh
    const scale = mesh.scale || { x: 1, y: 1, z: 1 };
    const rotation = mesh.rotation || { x: 0, y: 0, z: 0 };
    const quaternion = mesh.quaternion || new THREE.Quaternion();
  
    // Criar matriz de transformação para aplicar escala e rotação
    const matrix = new THREE.Matrix4();
    
        // ✅ NOVA ABORDAGEM: Usar a geometria já transformada

    
    // Garantir que a matriz mundial está atualizada
    mesh.updateMatrixWorld(true);
    
    // Usar a matriz mundial diretamente
    matrix.copy(mesh.matrixWorld);
 

    // Extrair vértices aplicando escala e rotação
    const tempVector = new THREE.Vector3();
    for (let i = 0; i < positionAttribute.count; i++) {
      // Obter posição original do vértice
      tempVector.set(
        positionAttribute.getX(i),
        positionAttribute.getY(i),
        positionAttribute.getZ(i)
      );
      
      // Aplicar transformação (escala + rotação)
      tempVector.applyMatrix4(matrix);
      
      vertices.push(
        tempVector.x,
        tempVector.y,
        tempVector.z
      );
    }

    // Extrair índices se existirem
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) {
        indices.push(geometry.index.getX(i));
      }
    } else {
      // Se não houver índices, criar sequencialmente
      for (let i = 0; i < positionAttribute.count; i++) {
        indices.push(i);
      }
    }


    let shape;

    if (useConvex) {
      // Criar Convex Hull (recomendado para objetos dinâmicos)
      const cannonVertices = [];
      for (let i = 0; i < vertices.length; i += 3) {
        cannonVertices.push(new CANNON.Vec3(vertices[i], vertices[i + 1], vertices[i + 2]));
      }
      shape = new CANNON.ConvexPolyhedron({ vertices: cannonVertices, faces: [] });
    } else {
      // Criar Triangle Mesh (mais preciso mas menos performático)
      shape = new CANNON.Trimesh(vertices, indices);
      
      // IMPORTANTE: Configurar propriedades específicas para Trimesh
      shape.collisionResponse = true;
      shape.collisionFilterGroup = 1;
      shape.collisionFilterMask = -1;
      
      // IMPORTANTE: Para Trimesh, garantir que as propriedades sejam configuradas corretamente
      // Isso pode resolver problemas de colisão
      if (shape.updateTree) {
        shape.updateTree();
      }
    }

    // Criar geometria escalada para visualização
    const scaledGeometry = geometry.clone();
    scaledGeometry.scale(scale.x, scale.y, scale.z);
    scaledGeometry.userData = { isScaled: true };


    return {
      shape: shape,
      geometry: scaledGeometry
    };

  } catch (error) {
    console.error(`❌ Erro ao criar mesh collider para ${mesh.name}:`, error);
    return null;
  }
}

// Função para criar Mesh Collider (Unity-style) - VERSÃO MELHORADA
function createMeshCollider(object, useConvex = false) {
  try {

    let geometry = null;
    let sourceObject = object;

    // MÉTODO 1: Verificar se o objeto tem geometria direta
    if (object.geometry) {
      geometry = object.geometry;
      sourceObject = object;
    }
    // MÉTODO 2: Buscar em filhos (para modelos GLB/GLTF)
    else if (object.children && object.children.length > 0) {

      // Primeiro, tentar encontrar meshes diretamente
      for (const child of object.children) {
        if (child.isMesh && child.geometry) {
          geometry = child.geometry;
          sourceObject = child;
          break;
        }
      }

      // Se não encontrou, buscar recursivamente
      if (!geometry) {
        for (const child of object.children) {
          const foundGeometry = findGeometryInChildren(child);
          if (foundGeometry) {
            geometry = foundGeometry;
            sourceObject = child;
            break;
          }
        }
      }
    }

    if (!geometry) {
      console.warn(`⚠️ Nenhuma geometria encontrada para mesh collider em ${object.name}`);
      return null;
    }

    // Calcular bounding box e sphere como no ChatGPT
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();


    // Extrair vertices e índices da geometria
    const vertices = [];
    const indices = [];

    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute) {
      console.warn(`⚠️ Atributo de posição não encontrado na geometria de ${object.name}`);
      return null;
    }

    // Obter escala e rotação do objeto fonte
    const scale = sourceObject.scale || { x: 1, y: 1, z: 1 };
    const rotation = sourceObject.rotation || { x: 0, y: 0, z: 0 };
    const quaternion = sourceObject.quaternion || new THREE.Quaternion();


    // Criar matriz de transformação para aplicar escala e rotação
    const matrix = new THREE.Matrix4();
   
    
    // Garantir que a matriz mundial está atualizada
    sourceObject.updateMatrixWorld(true);
    
    // Usar a matriz mundial diretamente
    matrix.copy(sourceObject.matrixWorld);

    // Extrair vértices aplicando escala e rotação
    const tempVector = new THREE.Vector3();
    for (let i = 0; i < positionAttribute.count; i++) {
      // Obter posição original do vértice
      tempVector.set(
        positionAttribute.getX(i),
        positionAttribute.getY(i),
        positionAttribute.getZ(i)
      );
      
      // Aplicar transformação (escala + rotação)
      tempVector.applyMatrix4(matrix);
      
      vertices.push(
        tempVector.x,
        tempVector.y,
        tempVector.z
      );
    }

    // Extrair índices se existirem
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) {
        indices.push(geometry.index.getX(i));
      }
    } else {
      // Se não houver índices, criar sequencialmente
      for (let i = 0; i < positionAttribute.count; i++) {
        indices.push(i);
      }
    }


    let shape;

    if (useConvex) {
      // Criar Convex Hull (recomendado para objetos dinâmicos)
      const cannonVertices = [];
      for (let i = 0; i < vertices.length; i += 3) {
        cannonVertices.push(new CANNON.Vec3(vertices[i], vertices[i + 1], vertices[i + 2]));
      }
      shape = new CANNON.ConvexPolyhedron({ vertices: cannonVertices, faces: [] });
    } else {
      // Criar Triangle Mesh (mais preciso mas menos performático)
      shape = new CANNON.Trimesh(vertices, indices);
      
      // IMPORTANTE: Configurar propriedades específicas para Trimesh
      shape.collisionResponse = true;
      shape.collisionFilterGroup = 1;
      shape.collisionFilterMask = -1;
      
      // IMPORTANTE: Para Trimesh, garantir que as propriedades sejam configuradas corretamente
      // Isso pode resolver problemas de colisão
      if (shape.updateTree) {
        shape.updateTree();
      }
    }

    // Criar geometria escalada para visualização
    const scaledGeometry = geometry.clone();
    scaledGeometry.scale(scale.x, scale.y, scale.z);
    scaledGeometry.userData = { isScaled: true }; // Marcar como já escalada

    return {
      shape: shape,
      geometry: scaledGeometry
    };

  } catch (error) {
    console.error(`❌ Erro ao criar mesh collider para ${object.name}:`, error);
    console.error(`🔍 Stack trace:`, error.stack);
    return null;
  }
}

// Função auxiliar para encontrar geometria em filhos
function findGeometryInChildren(parent) {
  if (parent.geometry) {
    return parent.geometry;
  }

  if (parent.children && parent.children.length > 0) {
    for (const child of parent.children) {
      const foundGeometry = findGeometryInChildren(child);
      if (foundGeometry) {
        return foundGeometry;
      }
    }
  }

  return null;
}

// Função para auto-detectar o melhor tipo de physics collider
function detectBestPhysicsType(object) {
  try {
    let geometry = object.geometry;

    // Se não houver geometria direta, buscar em filhos
    if (!geometry && object.children && object.children.length > 0) {
      geometry = findGeometryInChildren(object);
    }

    if (!geometry) {
      return 'box';
    }

    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute) {
      return 'box';
    }

    // Calcular bounding box da geometria
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;

    if (!bbox) {
      return 'box';
    }

    const width = bbox.max.x - bbox.min.x;
    const height = bbox.max.y - bbox.min.y;
    const depth = bbox.max.z - bbox.min.z;

    // Calcular razões das dimensões
    const maxDim = Math.max(width, height, depth);
    const widthRatio = width / maxDim;
    const heightRatio = height / maxDim;
    const depthRatio = depth / maxDim;

    // Tolerância para considerar dimensões similares
    const tolerance = 0.15;

    // Detectar esfera (todas as dimensões similares + verificar se é aproximadamente esférico)
    if (Math.abs(widthRatio - 1) < tolerance &&
      Math.abs(heightRatio - 1) < tolerance &&
      Math.abs(depthRatio - 1) < tolerance) {

      // Verificar se a geometria é aproximadamente esférica
      if (isApproximatelySphere(geometry)) {
        return 'sphere';
      }
    }

    // Detectar cilindro (duas dimensões similares, uma diferente)
    if ((Math.abs(widthRatio - depthRatio) < tolerance && Math.abs(heightRatio - 1) > tolerance) ||
      (Math.abs(widthRatio - heightRatio) < tolerance && Math.abs(depthRatio - 1) > tolerance) ||
      (Math.abs(heightRatio - depthRatio) < tolerance && Math.abs(widthRatio - 1) > tolerance)) {

      if (isApproximatelyCylinder(geometry)) {
        return 'cylinder';
      }
    }

    // Detectar plano (uma dimensão muito pequena)
    const minDim = Math.min(width, height, depth);
    if (minDim / maxDim < 0.1) {
      return 'plane';
    }

    // Para geometrias complexas, decidir entre box, convex e mesh
    const vertexCount = positionAttribute.count;

    if (vertexCount < 50) {
      // Poucos vértices, usar convex hull
      return 'convex';
    } else if (vertexCount < 500) {
      // Geometria média, verificar se é aproximadamente um box
      if (isApproximatelyBox(geometry)) {
        return 'box';
      } else {
        return 'convex';
      }
    } else {
      // Muitos vértices, usar mesh collider
      return 'mesh';
    }

  } catch (error) {
    console.error(`❌ Erro na auto-detecção de physics para ${object.name}:`, error);
    return 'box';
  }
}

// Função auxiliar para verificar se é aproximadamente uma esfera
function isApproximatelySphere(geometry) {
  // Implementação simplificada - poderia ser mais sofisticada
  const positionAttribute = geometry.attributes.position;
  const center = new THREE.Vector3();

  // Calcular centro
  for (let i = 0; i < positionAttribute.count; i++) {
    center.x += positionAttribute.getX(i);
    center.y += positionAttribute.getY(i);
    center.z += positionAttribute.getZ(i);
  }
  center.divideScalar(positionAttribute.count);

  // Calcular raio médio e desvio
  let totalDistance = 0;
  let maxDeviation = 0;

  for (let i = 0; i < positionAttribute.count; i++) {
    const vertex = new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    );
    const distance = vertex.distanceTo(center);
    totalDistance += distance;
  }

  const avgRadius = totalDistance / positionAttribute.count;

  for (let i = 0; i < positionAttribute.count; i++) {
    const vertex = new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    );
    const distance = vertex.distanceTo(center);
    const deviation = Math.abs(distance - avgRadius) / avgRadius;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  // Se o desvio máximo for menor que 20%, considerar esférico
  return maxDeviation < 0.2;
}

// Função auxiliar para verificar se é aproximadamente um cilindro
function isApproximatelyCylinder(geometry) {
  // Implementação simplificada
  const positionAttribute = geometry.attributes.position;
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;

  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const depth = bbox.max.z - bbox.min.z;

  // Verificar se duas dimensões são similares e uma é diferente
  const dims = [width, height, depth].sort((a, b) => a - b);
  const ratio1 = dims[0] / dims[1];
  const ratio2 = dims[1] / dims[2];

  return ratio1 > 0.8 && ratio2 < 0.7;
}

// Função auxiliar para verificar se é aproximadamente um box
function isApproximatelyBox(geometry) {
  // Implementação simplificada - verifica se a geometria se encaixa bem em um bounding box
  const positionAttribute = geometry.attributes.position;
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;

  let verticesNearBounds = 0;
  const tolerance = 0.05;

  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    const nearMinX = Math.abs(x - bbox.min.x) < tolerance;
    const nearMaxX = Math.abs(x - bbox.max.x) < tolerance;
    const nearMinY = Math.abs(y - bbox.min.y) < tolerance;
    const nearMaxY = Math.abs(y - bbox.max.y) < tolerance;
    const nearMinZ = Math.abs(z - bbox.min.z) < tolerance;
    const nearMaxZ = Math.abs(z - bbox.max.z) < tolerance;

    if (nearMinX || nearMaxX || nearMinY || nearMaxY || nearMinZ || nearMaxZ) {
      verticesNearBounds++;
    }
  }

  // Se mais de 60% dos vértices estão perto das bordas do bounding box, provavelmente é um box
  return (verticesNearBounds / positionAttribute.count) > 0.6;
}

// Função auxiliar para criar physics body de um tipo específico
function createPhysicsBodyForType(object, physicsType, physicsSize) {
  try {
    let shape;
    let visualGeometry;

    // Obter escala do objeto
    const scale = (object.scale && typeof object.scale === 'object')
      ? object.scale
      : { x: 1, y: 1, z: 1 };

    // Aplicar escala apenas para colliders primitivos
    const shouldApplyScale = !['mesh', 'trimesh', 'convex'].includes(physicsType);
    const finalSize = {
      x: physicsSize.x * (shouldApplyScale && typeof scale.x === 'number' ? scale.x : 1),
      y: physicsSize.y * (shouldApplyScale && typeof scale.y === 'number' ? scale.y : 1),
      z: physicsSize.z * (shouldApplyScale && typeof scale.z === 'number' ? scale.z : 1)
    };

    switch (physicsType) {
      case 'box':
        shape = new CANNON.Box(new CANNON.Vec3(finalSize.x / 2, finalSize.y / 2, finalSize.z / 2));
        visualGeometry = new THREE.BoxGeometry(finalSize.x, finalSize.y, finalSize.z);
        break;

      case 'sphere':
        const radius = Math.max(finalSize.x, finalSize.y, finalSize.z) / 2;
        shape = new CANNON.Sphere(radius);
        visualGeometry = new THREE.SphereGeometry(radius, 16, 16);
        break;

      case 'cylinder':
        shape = new CANNON.Cylinder(finalSize.x / 2, finalSize.z / 2, finalSize.y, 8);
        visualGeometry = new THREE.CylinderGeometry(finalSize.x / 2, finalSize.z / 2, finalSize.y, 8);
        break;

      case 'convex':
        const convexResult = createMeshCollider(object, true);
        if (convexResult) {
          shape = convexResult.shape;
          visualGeometry = convexResult.geometry;
        } else {
          return null;
        }
        break;

      case 'mesh':
        // Mesh Collider usando three-to-cannon (baseado no exemplo do ChatGPT)
        try {
          
          const threeToCannonResult = threeToCannon(object, { type: ShapeType.MESH });
          
          if (threeToCannonResult && threeToCannonResult.shape) {
            shape = threeToCannonResult.shape;
            visualGeometry = threeToCannonResult.geometry || object.geometry;
          } else {
            console.warn(`⚠️ threeToCannon falhou para ${object.name}, tentando fallback...`);
            
            // Fallback para o método antigo
            const meshResult = createMeshCollider(object, false);
            if (meshResult) {
              shape = meshResult.shape;
              visualGeometry = meshResult.geometry;
            } else {
              return null;
            }
          }
        } catch (error) {
          console.error(`❌ Erro ao criar Mesh Collider para ${object.name}:`, error);
          return null;
        }
        break;

      case 'simple-mesh':
        // NOVA OPÇÃO: Usar Simple Mesh Colliders (estilo ChatGPT)
        const simpleColliders = createSimpleMeshColliders(object);
        if (simpleColliders && simpleColliders.length > 0) {
          // Para Simple Mesh Colliders, não criamos shape físico, apenas marcamos os meshes
          // O raycasting será feito diretamente com os meshes
          
          // Retornar um shape dummy para compatibilidade
          shape = new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)); // Shape mínimo
          visualGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
          
          // Marcar o objeto como usando Simple Mesh Colliders
          object.userData.useSimpleMeshColliders = true;
          object.userData.simpleMeshColliders = simpleColliders;
        } else {
          console.warn(`⚠️ Nenhum Simple Mesh Collider criado para ${object.name}`);
          return null;
        }
        break;

      default:
        return null;
    }

    return {
      shape: shape,
      geometry: visualGeometry
    };

  } catch (error) {
    console.error(`❌ Erro ao criar physics body do tipo ${physicsType}:`, error);
    return null;
  }
}

// Função para remover corpo físico
function removePhysicsBody(object) {
  if (!object) {
    console.warn('⚠️ Tentativa de remover física de objeto inválido');
    return;
  }

  // Se for um Group E for mesh/trimesh, remover física de todas as meshes filhas
  if ((object.isGroup || object.type === 'Group') && 
      (object.physicsType === 'mesh' || object.physicsType === 'trimesh')) {
    
    let removedCount = 0;
    object.traverse((child) => {
      if (child.isMesh && child.physicsBody) {
        try {
          // Remover a referência do objeto Three.js do corpo físico
          if (child.physicsBody.threeObject) {
            child.physicsBody.threeObject = null;
          }

          world.removeBody(child.physicsBody);
          child.physicsBody = null;
          removedCount++;
        } catch (error) {
          console.error('❌ Erro ao remover corpo físico de mesh filha:', child.name, error);
        }
      }
    });
    
  } else {
    // Para objetos individuais
    if (object.physicsBody && world) {
      try {
        // Remover a referência do objeto Three.js do corpo físico
        if (object.physicsBody.threeObject) {
          object.physicsBody.threeObject = null;
        }

        world.removeBody(object.physicsBody);
        object.physicsBody = null;
      } catch (error) {
        console.error('❌ Erro ao remover corpo físico de:', object.name, error);
      }
    }
  }

  // Remover visualização do colisor
  removeColliderVisualization(object);
}

// Função para atualizar corpo físico existente
function updatePhysicsBody(object) {
  if (!object.physicsBody) return;

  const body = object.physicsBody;

  // Atualizar massa
  if (object.physicsMass !== undefined) {
    // Para mesh/trimesh colliders, SEMPRE manter massa 0 (STATIC)
    if (object.physicsType === 'mesh' || object.physicsType === 'trimesh') {
      body.mass = 0;
      body.invMass = 0;
    } else {
      body.mass = object.physicsMass;
      body.updateMassProperties();
    }
  }

  // Atualizar fricção e restituição
  if (object.physicsFriction !== undefined) {
    body.material.friction = object.physicsFriction;
  }
  if (object.physicsRestitution !== undefined) {
    body.material.restitution = object.physicsRestitution;
  }

  // Atualizar amortecimento
  if (object.physicsLinearDamping !== undefined) {
    body.linearDamping = object.physicsLinearDamping;
  }
  if (object.physicsAngularDamping !== undefined) {
    body.angularDamping = object.physicsAngularDamping;
  }

  // Atualizar configurações de gravidade e colisão
  if (object.physicsGravityEnabled !== undefined) {
    // Para mesh/trimesh colliders, SEMPRE manter como STATIC (sem gravidade)
    if (object.physicsType === 'mesh' || object.physicsType === 'trimesh') {
      body.type = CANNON.Body.STATIC;
      body.mass = 0;
      body.invMass = 0;
    } else {
      // Para outros tipos, usar lógica normal
      if (object.physicsGravityEnabled) {
        // Mudar para Dynamic (afetado pela gravidade)
        body.type = CANNON.Body.DYNAMIC;
        body.mass = object.physicsMass || 1;
        body.updateMassProperties();
      } else {
        // Mudar para Kinematic (não afetado pela gravidade)
        body.type = CANNON.Body.KINEMATIC;
        body.mass = 0;
        body.invMass = 0;
        // Manter a velocidade atual para transição suave
        if (body.velocity) {
          //body.velocity.set(0, 0, 0);
        }
        if (body.angularVelocity) {
          //   body.angularVelocity.set(0, 0, 0);
        }
      }
    }
  }

  if (object.physicsCollisionEnabled !== undefined) {
    body.collisionResponse = object.physicsCollisionEnabled; // Habilita/desabilita colisões
  }

  // Se o tamanho, offset ou rotação mudaram, recriar o corpo físico
  if (object.physicsSize !== undefined || object.physicsOffset !== undefined || object.physicsRotation !== undefined || object.physicsType !== undefined) {
    createPhysicsBody(object);
    return;
  }
}

// Função para criar visualização do colisor
function createColliderVisualization(object, geometry, offset) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return;
  }

  // Remover visualização anterior se existir
  if (object.colliderVisualization) {
    scene.remove(object.colliderVisualization);
    if (object.colliderVisualization.geometry) {
      object.colliderVisualization.geometry.dispose();
    }
    if (object.colliderVisualization.material) {
      object.colliderVisualization.material.dispose();
    }
  }

  // Criar material para o wireframe do colisor
  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000, // Vermelho
    wireframe: true,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    side: THREE.DoubleSide
  });

  // Criar mesh para visualização
  const colliderMesh = new THREE.Mesh(geometry, material);
  colliderMesh.name = `Collider_${object.name}`;

  // Obter posição e rotação do objeto
  const objectPosition = object.position || { x: 0, y: 0, z: 0 };
  const objectRotation = object.rotation || { x: 0, y: 0, z: 0 };
  const objectScale = object.scale || { x: 1, y: 1, z: 1 };

  // Posicionar o colisor visual
  colliderMesh.position.set(
    objectPosition.x + offset.x,
    objectPosition.y + offset.y,
    objectPosition.z + offset.z
  );

  // Aplicar rotação do objeto
  colliderMesh.rotation.set(objectRotation.x, objectRotation.y, objectRotation.z);

  // Aplicar escala do objeto apenas para colliders primitivos
  // Para mesh colliders, a escala já foi aplicada na geometria
  const isMeshCollider = object.physicsType === 'mesh' || object.physicsType === 'trimesh' || object.physicsType === 'convex';
  if (!isMeshCollider) {
    // Para colliders primitivos, não aplicar escala aqui pois já foi aplicada na geometria
    // A escala já foi considerada na criação da geometria do collider
  }

  // Configurar propriedades de renderização
  colliderMesh.renderOrder = 1000; // Renderizar por último
  colliderMesh.material.depthTest = false; // Sempre visível

  // Adicionar à cena
  scene.add(colliderMesh);

  // Armazenar referência no objeto
  object.colliderVisualization = colliderMesh;

}

// Função para remover visualização do colisor
function removeColliderVisualization(object) {
  if (object.colliderVisualization) {
    if (scene) {
      scene.remove(object.colliderVisualization);
    }
    if (object.colliderVisualization.geometry) {
      object.colliderVisualization.geometry.dispose();
    }
    if (object.colliderVisualization.material) {
      object.colliderVisualization.material.dispose();
    }
    object.colliderVisualization = null;
  }
}

// Função para mostrar/ocultar todas as visualizações de colisor
export function toggleColliderVisualizations(show = true) {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return;
  }

  scene.traverse((object) => {
    if (object.colliderVisualization) {
      object.colliderVisualization.visible = show;
    }
  });
}

// Função para mostrar visualizações de colisor apenas para objetos com física
export function showPhysicsColliders() {
  if (!scene) {
    console.error('❌ Cena não inicializada');
    return;
  }

  scene.traverse((object) => {
    if (object.physicsBody && object.colliderVisualization) {
      object.colliderVisualization.visible = true;
    } else if (object.colliderVisualization) {
      object.colliderVisualization.visible = false;
    }
  });

}

// Função para limpar corpos físicos órfãos
function cleanupOrphanPhysicsBodies() {
  if (!world || !scene) return;

  const bodiesToRemove = [];

  // Verificar corpos sem objeto Three.js associado
  world.bodies.forEach((body) => {
    if (!body.threeObject || !body.threeObject.position) {
      bodiesToRemove.push(body);
    }
  });

  // Remover corpos órfãos
  bodiesToRemove.forEach((body) => {
    try {
      world.removeBody(body);
    } catch (error) {
      console.error('❌ Erro ao remover corpo órfão:', error);
    }
  });

  if (bodiesToRemove.length > 0) {
  }
}

// ===== SISTEMA DE COLISÕES =====

// Função para configurar callback de colisão para um objeto
export function setCollisionCallback(objectName, callback) {
  if (typeof callback !== 'function') {
    console.error('❌ Callback de colisão deve ser uma função');
    return;
  }

  collisionCallbacks.set(objectName, callback);
}

// Função para remover callback de colisão
export function removeCollisionCallback(objectName) {
  collisionCallbacks.delete(objectName);
}

// Função para configurar grupo de colisão
export function setCollisionGroup(objectName, group) {
  collisionGroups.set(objectName, group);
}

// Função para configurar material de colisão
export function setCollisionMaterial(objectName, material) {
  collisionMaterials.set(objectName, material);
}

// Função para ativar/desativar modo debug de colisões
export function setCollisionDebugMode(enabled) {
  collisionDebugMode = enabled;
}

// Funções para controlar visibilidade na câmera de jogo
export function setGizmosVisibility(visible) {
  showGizmos = visible;

  // Aplicar visibilidade aos gizmos existentes
  if (gizmoGroup) {
    gizmoGroup.visible = visible && editorMode;
  }
  if (transformControls) {
    transformControls.visible = visible && editorMode;
  }
}

export function setHelpersVisibility(visible) {
  showHelpers = visible;

  // Aplicar visibilidade aos helpers da cena
  if (scene) {
    scene.traverse((object) => {
      if (object.userData && object.userData.isHelper) {
        object.visible = visible;
      }
      // Helpers de luz
      if (object.name && object.name.includes('Helper_')) {
        object.visible = visible;
      }
    });
  }
}

export function setCollidersVisibility(visible) {
  showColliders = visible;

  // Aplicar visibilidade aos colisores da cena
  if (scene) {
    scene.traverse((object) => {
      if (object.name && object.name.includes('Collider_')) {
        object.visible = visible;
      }
      // Visualizações de colisão
      if (object.userData && object.userData.isColliderVisualization) {
        object.visible = visible;
      }
    });
  }
}

export function setWireframesVisibility(visible) {
  showWireframes = visible;

  // Aplicar wireframe aos materiais da cena
  if (scene) {
    scene.traverse((object) => {
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(mat => {
            mat.wireframe = visible;
          });
        } else {
          object.material.wireframe = visible;
        }
      }
    });
  }
}

// Função para obter estado atual das visibilidades
export function getVisibilityState() {
  return {
    gizmos: showGizmos,
    helpers: showHelpers,
    colliders: showColliders,
    wireframes: showWireframes
  };
}

// Função para aplicar todas as visibilidades de uma vez
export function applyVisibilitySettings(settings) {
  if (settings.gizmos !== undefined) setGizmosVisibility(settings.gizmos);
  if (settings.helpers !== undefined) setHelpersVisibility(settings.helpers);
  if (settings.colliders !== undefined) setCollidersVisibility(settings.colliders);
  if (settings.wireframes !== undefined) setWireframesVisibility(settings.wireframes);
}

// Função para processar colisões
function processCollisions() {
  if (!world) return;

  // Processar contatos ativos usando world.contacts
  if (world.contacts && world.contacts.length > 0) {
    world.contacts.forEach((contact) => {
      const bodyA = contact.bi;
      const bodyB = contact.bj;

      if (bodyA && bodyB && bodyA.threeObject && bodyB.threeObject) {
        const objectA = bodyA.threeObject;
        const objectB = bodyB.threeObject;

        // Verificar se os objetos ainda existem na cena
        if (!objectA.parent || !objectB.parent) {
          return; // Pular se um dos objetos foi removido
        }

        // Criar chave única para o contato
        const contactKey = `${objectA.name}-${objectB.name}`;
        const reverseKey = `${objectB.name}-${objectA.name}`;

        // Verificar se já processamos este contato
        if (!collisionContacts.has(contactKey) && !collisionContacts.has(reverseKey)) {
          collisionContacts.add(contactKey);

          // Executar callbacks de colisão
          const callbackA = collisionCallbacks.get(objectA.name);
          const callbackB = collisionCallbacks.get(objectB.name);

          if (callbackA) {
            try {
              callbackA({
                object: objectA,
                otherObject: objectB,
                contact: contact,
                type: 'start'
              });
            } catch (error) {
              console.error('❌ Erro no callback de colisão A:', error);
            }
          }

          if (callbackB) {
            try {
              callbackB({
                object: objectB,
                otherObject: objectA,
                contact: contact,
                type: 'start'
              });
            } catch (error) {
              console.error('❌ Erro no callback de colisão B:', error);
            }
          }

          // Notificar o editor sobre a colisão
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'COLLISION_DETECTED',
              objectA: objectA.name,
              objectB: objectB.name,
              timestamp: Date.now()
            }, '*');
          }
        }
      }
    });
  }

  // Limpar contatos antigos (a cada 100ms)
  const currentTime = Date.now();
  if (!processCollisions.lastCleanup || currentTime - processCollisions.lastCleanup > 100) {
    processCollisions.lastCleanup = currentTime;
    collisionContacts.clear();
  }
}

// Função para verificar colisão entre dois objetos
export function checkCollision(objectNameA, objectNameB) {
  if (!world) return false;

  const bodyA = world.bodies.find(b => b.threeObject && b.threeObject.name === objectNameA);
  const bodyB = world.bodies.find(b => b.threeObject && b.threeObject.name === objectNameB);

  if (!bodyA || !bodyB) return false;

  // Verificar se há contato entre os corpos usando world.contacts
  if (world.contacts && world.contacts.length > 0) {
    return world.contacts.some(contact =>
      (contact.bi === bodyA && contact.bj === bodyB) ||
      (contact.bi === bodyB && contact.bj === bodyA)
    );
  }

  return false;
}

// Função para obter objetos em colisão com um objeto específico
export function getCollidingObjects(objectName) {
  if (!world) return [];

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return [];

  const collidingObjects = [];

  // Usar world.contacts em vez de contactMaterialTable
  if (world.contacts && world.contacts.length > 0) {
    world.contacts.forEach((contact) => {
      const bodyA = contact.bi;
      const bodyB = contact.bj;

      if (bodyA && bodyB && bodyA.threeObject && bodyB.threeObject) {
        if (bodyA.id === body.id && bodyB.threeObject.name !== objectName) {
          collidingObjects.push(bodyB.threeObject.name);
        } else if (bodyB.id === body.id && bodyA.threeObject.name !== objectName) {
          collidingObjects.push(bodyA.threeObject.name);
        }
      }
    });
  }

  return collidingObjects;
}

// Função para aplicar força de colisão (impulso brusco)
export function applyCollisionForce(objectName, force, point = null) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  const cannonForce = new CANNON.Vec3(force.x, force.y, force.z);
  const cannonPoint = point ? new CANNON.Vec3(point.x, point.y, point.z) : body.position;

  body.applyImpulse(cannonForce, cannonPoint);
}

// Função para adicionar força (Unity-style) - Mais suave para controle de personagem
export function addForce(objectName, force, forceMode = 'force') {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  const cannonForce = new CANNON.Vec3(force.x, force.y, force.z);

  switch (forceMode) {
    case 'force':
      // Força contínua - ideal para movimento de personagem
      body.applyForce(cannonForce);
      break;
    case 'impulse':
      // Impulso instantâneo - para pulos, explosões
      body.applyImpulse(cannonForce);
      break;
    case 'velocityChange':
      // Mudança direta de velocidade - ignora massa
      body.velocity.x += cannonForce.x;
      body.velocity.y += cannonForce.y;
      body.velocity.z += cannonForce.z;
      break;
    case 'acceleration':
      // Aceleração - força dividida pela massa
      const mass = body.mass > 0 ? body.mass : 1;
      body.applyForce(cannonForce.scale(mass));
      break;
  }

}

// Função para configurar Freeze Rotation (Unity-style)
export function setFreezeRotation(objectName, freezeX = false, freezeY = false, freezeZ = false) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  body.angularFactor = new CANNON.Vec3(0, 1, 0);

}

// Função para congelar todas as rotações (shortcut comum)
export function freezeAllRotations(objectName) {
  setFreezeRotation(objectName, true, true, true);
}

// Função para descongelar todas as rotações
export function unfreezeAllRotations(objectName) {
  setFreezeRotation(objectName, false, false, false);
}

// Função para definir velocidade diretamente (Unity-style)
export function setVelocity(objectName, velocity) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  body.velocity.set(velocity.x, velocity.y, velocity.z);
}

// Função para obter velocidade atual
export function getVelocity(objectName) {
  if (!world) return null;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return null;

  return {
    x: body.velocity.x,
    y: body.velocity.y,
    z: body.velocity.z
  };
}

// Função para definir velocidade angular diretamente (Unity-style)
export function setAngularVelocity(objectName, angularVelocity) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  body.angularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);
}

// Função para obter velocidade angular atual
export function getAngularVelocity(objectName) {
  if (!world) return null;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return null;

  return {
    x: body.angularVelocity.x,
    y: body.angularVelocity.y,
    z: body.angularVelocity.z
  };
}

export function addTorque(objectName, torque, torqueMode = 'torque') {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  const cannonTorque = new CANNON.Vec3(torque.x, torque.y, torque.z);

  switch (torqueMode) {
    case 'torque':
      // Adiciona torque acumulativo (padrão do Cannon.js)
      body.torque.x += cannonTorque.x;
      body.torque.y += cannonTorque.y;
      body.torque.z += cannonTorque.z;
      break;

    case 'velocityChange':
      // Altera diretamente a velocidade angular
      body.angularVelocity.x += cannonTorque.x;
      body.angularVelocity.y += cannonTorque.y;
      body.angularVelocity.z += cannonTorque.z;
      break;

    case 'acceleration':
      // Aplica torque proporcional ao momento de inércia
      const inertia = body.inertia ? body.inertia : new CANNON.Vec3(1, 1, 1);
      body.torque.x += cannonTorque.x * inertia.x;
      body.torque.y += cannonTorque.y * inertia.y;
      body.torque.z += cannonTorque.z * inertia.z;
      break;

    default:
      console.warn(`Modo de torque "${torqueMode}" não reconhecido`);
      break;
  }

}


// Função para rotacionar objeto diretamente (Unity-style)
export function rotateObject(objectName, rotation) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  // Converter Euler para Quaternion com ordem YXZ
  const quaternion = new CANNON.Quaternion();
  quaternion.setFromEuler(rotation.x, rotation.y, rotation.z, 'YXZ');

  // Aplicar rotação diretamente no corpo físico
  body.quaternion.copy(quaternion);

  // Sincronizar com o objeto Three.js
  if (body.threeObject) {
    body.threeObject.quaternion.copy(body.quaternion);
  }

}

// Função para rotacionar objeto incrementalmente (adicionar à rotação atual)
export function rotateObjectIncremental(objectName, deltaRotation) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  // DEBUG: Verificar se o objeto tem freeze rotation ativo
  if (body.freezeRotationX || body.freezeRotationY || body.freezeRotationZ) {
    console.warn(`⚠️ Objeto "${objectName}" tem freeze rotation ativo:`, {
      freezeX: body.freezeRotationX,
      freezeY: body.freezeRotationY,
      freezeZ: body.freezeRotationZ
    });
  }

  // Obter rotação atual do objeto Three.js
  const currentEuler = new THREE.Euler();
  currentEuler.setFromQuaternion(body.threeObject.quaternion, 'YXZ');

  // Adicionar delta à rotação atual
  const newRotation = {
    x: currentEuler.x + deltaRotation.x,
    y: currentEuler.y + deltaRotation.y,
    z: currentEuler.z + deltaRotation.z
  };

  // Converter para quaternion
  const quaternion = new CANNON.Quaternion();
  quaternion.setFromEuler(newRotation.x, newRotation.y, newRotation.z, 'YXZ');

  // Aplicar nova rotação
  body.quaternion.copy(quaternion);

  // Sincronizar com o objeto Three.js
  if (body.threeObject) {
    body.threeObject.quaternion.copy(body.quaternion);
  }

}


// Função para rotacionar objeto em torno de um eixo (Unity-style)
export function rotateAroundAxis(objectName, axis, angle) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  // Criar quaternion para rotação em torno do eixo
  const quaternion = new CANNON.Quaternion();
  quaternion.setFromAxisAngle(new CANNON.Vec3(axis.x, axis.y, axis.z), angle);

  // Aplicar rotação
  body.quaternion = quaternion;

  // Sincronizar com o objeto Three.js
  if (body.threeObject) {
    body.threeObject.quaternion.copy(body.quaternion);
  }

}

// Função para configurar propriedades de controle de personagem
export function setupCharacterController(objectName, options = {}) {
  const defaults = {
    mass: 70,                    // Massa do personagem
    friction: 0.1,               // Baixo atrito para movimento suave
    restitution: 0,              // Sem quique
    linearDamping: 0.9,          // Alta resistência para parar rapidamente
    angularDamping: 0.99,        // Resistência rotacional alta
    freezeRotationX: true,       // Impedir tombo para frente/trás
    freezeRotationY: false,      // Permitir rotação Y (olhar)
    freezeRotationZ: true,       // Impedir tombo lateral
    physicsType: 'capsule'       // Formato ideal para personagem
  };

  const config = { ...defaults, ...options };

  // Aplicar configurações de física
  updateObjectPhysics(objectName, 'physicsMass', config.mass);
  updateObjectPhysics(objectName, 'physicsFriction', config.friction);
  updateObjectPhysics(objectName, 'physicsRestitution', config.restitution);
  updateObjectPhysics(objectName, 'physicsLinearDamping', config.linearDamping);
  updateObjectPhysics(objectName, 'physicsAngularDamping', config.angularDamping);
  updateObjectPhysics(objectName, 'physicsType', config.physicsType);
  updateObjectPhysics(objectName, 'physicsEnabled', true);

  // Configurar freeze rotation
  //setFreezeRotation(objectName, config.freezeRotationX, config.freezeRotationY, config.freezeRotationZ);

  // FORÇA BRUTA ESPECIAL PARA PERSONAGENS - Aplicar IMEDIATAMENTE no corpo
  if (world) {
    const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
    if (body) {
      // Configurações extremas para eliminar rotação
      body.material.friction = config.friction;
      body.material.restitution = config.restitution;
      body.linearDamping = config.linearDamping;
      body.angularDamping = 0.999; // Quase 100% de damping rotacional

      // Zerar toda rotação inicial
      body.angularVelocity.set(0, 0, 0);
      body.torque.set(0, 0, 0);

      // Marcar como personagem para tratamento especial
      body.isCharacterController = true;

    }
  }


  return config;
}

// Função para mover objeto cinemático (como Unity Kinematic)
export function moveKinematicObject(objectName, targetPosition, targetRotation = null) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  // Verificar se é um objeto cinemático
  if (body.type !== CANNON.Body.KINEMATIC) {
    console.warn('⚠️ Tentativa de mover objeto não-cinemático:', objectName);
    return;
  }

  // Mover para a posição alvo
  body.position.set(targetPosition.x, targetPosition.y, targetPosition.z);

  // Aplicar rotação se fornecida
  if (targetRotation) {
    body.quaternion.setFromEuler(targetRotation.x, targetRotation.y, targetRotation.z, 'YXZ');
  }

  // Sincronizar com o objeto Three.js
  if (body.threeObject) {
    body.threeObject.position.copy(body.position);
    if (targetRotation) {
      body.threeObject.quaternion.copy(body.quaternion);
    }
  }

}

// Função para definir velocidade de objeto cinemático
export function setKinematicVelocity(objectName, velocity) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  // Verificar se é um objeto cinemático
  if (body.type !== CANNON.Body.KINEMATIC) {
    console.warn('⚠️ Tentativa de definir velocidade em objeto não-cinemático:', objectName);
    return;
  }

  body.velocity.set(velocity.x, velocity.y, velocity.z);
}

// Função para configurar sensor de colisão (trigger)
export function setCollisionSensor(objectName, isSensor = true) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  body.isSensor = isSensor;
}

// Função para obter informações de colisão
export function getCollisionInfo(objectName) {
  if (!world) return null;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return null;

  return {
    name: objectName,
    hasCallback: collisionCallbacks.has(objectName),
    group: collisionGroups.get(objectName),
    material: collisionMaterials.get(objectName),
    isSensor: body.isSensor,
    collidingWith: getCollidingObjects(objectName),
    velocity: body.velocity ? { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z } : null,
    angularVelocity: body.angularVelocity ? { x: body.angularVelocity.x, y: body.angularVelocity.y, z: body.angularVelocity.z } : null
  };
}

// Função para criar material de contato personalizado
export function createContactMaterial(materialA, materialB, options = {}) {
  if (!world) return null;

  const contactMaterial = new CANNON.ContactMaterial(
    materialA || new CANNON.Material(),
    materialB || new CANNON.Material(),
    {
      friction: options.friction || 0.3,
      restitution: options.restitution || 0.3,
      contactEquationStiffness: options.contactEquationStiffness || 1e7,
      contactEquationRelaxation: options.contactEquationRelaxation || 3,
      frictionEquationStiffness: options.frictionEquationStiffness || 1e7,
      frictionEquationRegularizationTime: options.frictionEquationRegularizationTime || 3
    }
  );

  world.addContactMaterial(contactMaterial);

  return contactMaterial;
}

// Função para configurar colisão específica entre dois objetos
export function setupCollisionBetween(objectNameA, objectNameB, options = {}) {
  if (!world) return;

  const bodyA = world.bodies.find(b => b.threeObject && b.threeObject.name === objectNameA);
  const bodyB = world.bodies.find(b => b.threeObject && b.threeObject.name === objectNameB);

  if (bodyA && bodyB) { 
  } else {  
    console.warn('⚠️ Objetos não encontrados para configurar colisão:', objectNameA, objectNameB);
  }
}

// Função para configurar filtros de colisão
export function setCollisionFilter(objectName, group, mask) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body) return;

  body.collisionFilterGroup = group;
  body.collisionFilterMask = mask;
}

// Função para detectar colisões por raycast
export function raycastCollision(start, end, targetNames = []) {
  if (!world) return null;

  const raycastResult = new CANNON.RaycastResult();
  const rayStart = new CANNON.Vec3(start.x, start.y, start.z);
  const rayEnd = new CANNON.Vec3(end.x, end.y, end.z);

  world.raycastClosest(rayStart, rayEnd, {}, raycastResult);

  if (raycastResult.hasHit) {
    const hitBody = raycastResult.body;
    const hitObject = hitBody.threeObject;

    if (hitObject && (targetNames.length === 0 || targetNames.includes(hitObject.name))) {
      return {
        object: hitObject.name,
        point: {
          x: raycastResult.hitPointWorld.x,
          y: raycastResult.hitPointWorld.y,
          z: raycastResult.hitPointWorld.z
        },
        normal: {
          x: raycastResult.hitNormalWorld.x,
          y: raycastResult.hitNormalWorld.y,
          z: raycastResult.hitNormalWorld.z
        },
        distance: raycastResult.distance
      };
    }
  }

  return null;
}

// ============================================================================
// Sistema de Física Unity-style para Personagens


// Função para movimento de personagem Unity-style
export function moveCharacter(objectName, moveVector, speed = 5) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body || !body.isCharacter) {
    console.error('❌ Objeto não é um personagem:', objectName);
    return;
  }

  // Aplicar movimento mantendo velocidade Y (gravidade)
  const currentVelocityY = body.velocity.y;

  // Calcular força baseada na velocidade desejada
  const targetVelocity = new CANNON.Vec3(
    moveVector.x * speed,
    currentVelocityY, // Manter velocidade Y
    moveVector.z * speed
  );

  // Aplicar velocidade diretamente para controle preciso
  body.velocity.x = targetVelocity.x;
  body.velocity.z = targetVelocity.z;

  // Atualizar informações do character controller
  if (body.threeObject.characterController) {
    body.threeObject.characterController.velocity = {
      x: targetVelocity.x,
      y: currentVelocityY,
      z: targetVelocity.z
    };
  }

}

// Função para pular Unity-style
export function jumpCharacter(objectName, jumpForce = 10) {
  if (!world) return;

  const body = world.bodies.find(b => b.threeObject && b.threeObject.name === objectName);
  if (!body || !body.isCharacter) {
    console.error('❌ Objeto não é um personagem:', objectName);
    return;
  }

  // Verificar se está no chão (básico)
  const isGrounded = body.velocity.y < 0.1 && body.velocity.y > -0.1;

  if (isGrounded) {
    body.velocity.y = jumpForce;
    return true;
  } else {
    return false;
  }
}

// Sistema para aplicar constraints continuamente
function applyPhysicsConstraints() {
  if (!world) return;

  world.bodies.forEach(body => {
    if (body.threeObject) {
      // SÓ aplicar freeze rotation se explicitamente configurado
      if (body.freezeRotationX || body.freezeRotationY || body.freezeRotationZ) {
        // Zerar TUDO relacionado à rotação
        if (body.freezeRotationX) {
          body.angularVelocity.x = 0;
          body.torque.x = 0;
        }
        if (body.freezeRotationY) {
          body.angularVelocity.y = 0;
          body.torque.y = 0;
        }
        if (body.freezeRotationZ) {
          body.angularVelocity.z = 0;
          body.torque.z = 0;
        }

        // FORÇA BRUTA EXTREMA - Corrigir rotação constantemente
        if (body.freezeRotationX && body.freezeRotationZ) {
          // Calcular ângulo Y atual e forçar X e Z para zero
          const euler = new THREE.Euler();
          euler.setFromQuaternion(body.quaternion, 'YXZ'); // ESPECIFICAR ORDEM YXZ

          // Forçar pitch (X) e roll (Z) para zero
          euler.x = 0;
          euler.z = 0;

          // Aplicar de volta no corpo físico
          body.quaternion.setFromEuler(euler, 'YXZ'); // ESPECIFICAR ORDEM YXZ

          // Também aplicar no objeto Three.js
          if (body.threeObject) {
            body.threeObject.quaternion.copy(body.quaternion);
          }
        }
      }

      // Aplicar constraints de posição (se necessário)
      if (body.freezePositionX) body.velocity.x = 0;
      if (body.freezePositionY) body.velocity.y = 0;
      if (body.freezePositionZ) body.velocity.z = 0;
    }
  });
}

// Integrar constraints no loop de física existente
// (será chamado automaticamente no loop de animação)

// Sistema de gizmos customizados
let customGizmos = {
  translate: null,
  rotate: null,
  scale: null
};
let activeGizmo = null;
let gizmoGroup = null;
let gizmoInteractions = {
  isDragging: false,
  dragAxis: null,
  dragStart: null,
  dragObject: null
};

// Função para criar gizmos customizados
function createCustomGizmos() {

  if (!scene) {
    console.error('❌ Cena não inicializada para criar gizmos');
    return;
  }

  // Criar grupo para os gizmos
  gizmoGroup = new THREE.Group();
  gizmoGroup.name = 'CustomGizmos';
  gizmoGroup.renderOrder = 1000; // ✅ RENDERIZAR SEMPRE NA FRENTE
  scene.add(gizmoGroup);

  // Criar gizmo de translação
  customGizmos.translate = createTranslateGizmo();
  gizmoGroup.add(customGizmos.translate);

  // Criar gizmo de rotação
  customGizmos.rotate = createRotateGizmo();
  gizmoGroup.add(customGizmos.rotate);

  // Criar gizmo de escala
  customGizmos.scale = createScaleGizmo();
  gizmoGroup.add(customGizmos.scale);

  // Inicialmente, todos os gizmos ficam invisíveis
  customGizmos.translate.visible = false;
  customGizmos.rotate.visible = false;
  customGizmos.scale.visible = false;
  gizmoGroup.visible = false;

}

// Função para criar gizmo de translação
function createTranslateGizmo() {
  const group = new THREE.Group();
  group.name = 'TranslateGizmo';

  // Eixo X (vermelho)
  const xAxis = createAxisArrow(0xff0000, 'X');
  xAxis.rotation.z = -Math.PI / 2;
  group.add(xAxis);

  // Eixo Y (verde)
  const yAxis = createAxisArrow(0x00ff00, 'Y');
  group.add(yAxis);

  // Eixo Z (azul)
  const zAxis = createAxisArrow(0x0000ff, 'Z');
  zAxis.rotation.x = Math.PI / 2;
  group.add(zAxis);

  // Planos de movimento
  const xyPlane = createPlaneGizmo(0xffff00, 'XY');
  xyPlane.rotation.x = -Math.PI / 2;
  group.add(xyPlane);

  const xzPlane = createPlaneGizmo(0xff00ff, 'XZ');
  group.add(xzPlane);

  const yzPlane = createPlaneGizmo(0x00ffff, 'YZ');
  yzPlane.rotation.z = Math.PI / 2;
  group.add(yzPlane);

  return group;
}

// Função para criar gizmo de rotação
function createRotateGizmo() {
  const group = new THREE.Group();
  group.name = 'RotateGizmo';

  // Anéis de rotação
  const xRing = createRotationRing(0xff0000, 'X');
  xRing.rotation.z = -Math.PI / 2;
  group.add(xRing);

  const yRing = createRotationRing(0x00ff00, 'Y');
  group.add(yRing);

  const zRing = createRotationRing(0x0000ff, 'Z');
  zRing.rotation.x = Math.PI / 2;
  group.add(zRing);

  return group;
}

// Função para criar gizmo de escala
function createScaleGizmo() {
  const group = new THREE.Group();
  group.name = 'ScaleGizmo';

  // Eixos de escala
  const xAxis = createScaleAxis(0xff0000, 'X');
  xAxis.rotation.z = -Math.PI / 2;
  group.add(xAxis);

  const yAxis = createScaleAxis(0x00ff00, 'Y');
  group.add(yAxis);

  const zAxis = createScaleAxis(0x0000ff, 'Z');
  zAxis.rotation.x = Math.PI / 2;
  group.add(zAxis);

  // Cubo central para escala uniforme
  const uniformScale = createUniformScaleCube();
  group.add(uniformScale);

  return group;
}

// Função para criar seta de eixo
function createAxisArrow(color, axis) {
  const group = new THREE.Group();
  group.name = `Axis_${axis}`;

  // Linha do eixo
  const lineGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1.5);
  const lineMaterial = new THREE.MeshBasicMaterial({ color: color });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.y = 0.75;
  line.renderOrder = 1000; // Renderizar na frente
  group.add(line);

  // Cabeça da seta
  const arrowGeometry = new THREE.ConeGeometry(0.08, 0.2, 8);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: color });
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
  arrow.position.y = 1.6;
  arrow.renderOrder = 1000; // Renderizar na frente
  group.add(arrow);

  // ✅ ÁREA DE DRAG INVISÍVEL MAIOR (para facilitar o clique)
  const dragGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.8); // Área 7x maior
  const dragMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.0, // Totalmente invisível
    depthTest: false // Sempre na frente
  });
  const dragArea = new THREE.Mesh(dragGeometry, dragMaterial);
  dragArea.position.y = 0.9;
  dragArea.renderOrder = 999; // Renderizar antes dos elementos visíveis
  dragArea.userData = {
    type: 'axis',
    axis: axis,
    color: color,
    isDragArea: true,
    dragPriority: 1 // Prioridade alta para drag
  };
  group.add(dragArea);

  // Adicionar interatividade
  line.userData = { type: 'axis', axis: axis, color: color };
  arrow.userData = { type: 'axis', axis: axis, color: color };

  return group;
}

// Função para criar plano de movimento
function createPlaneGizmo(color, plane) {
  const group = new THREE.Group();
  group.name = `Plane_${plane}`;

  const planeGeometry = new THREE.PlaneGeometry(0.8, 0.8);
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide
  });
  const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
  planeMesh.renderOrder = 1000; // Renderizar na frente
  group.add(planeMesh);

  // ✅ ÁREA DE DRAG INVISÍVEL MAIOR (para facilitar o clique)
  const dragGeometry = new THREE.PlaneGeometry(1.2, 1.2); // Área 2x maior
  const dragMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.0, // Totalmente invisível
    side: THREE.DoubleSide,
    depthTest: false // Sempre na frente
  });
  const dragArea = new THREE.Mesh(dragGeometry, dragMaterial);
  dragArea.renderOrder = 999; // Renderizar antes dos elementos visíveis
  dragArea.userData = {
    type: 'plane',
    plane: plane,
    color: color,
    isDragArea: true,
    dragPriority: 2 // Prioridade média para drag
  };
  group.add(dragArea);

  // Adicionar interatividade
  planeMesh.userData = { type: 'plane', plane: plane, color: color };

  return group;
}

// Função para criar anel de rotação
function createRotationRing(color, axis) {
  const group = new THREE.Group();
  group.name = `Ring_${axis}`;

  const ringGeometry = new THREE.TorusGeometry(1.2, 0.05, 8, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.7
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 1000; // Renderizar na frente
  group.add(ring);

  // ✅ ÁREA DE DRAG INVISÍVEL MAIOR (para facilitar o clique)
  const dragGeometry = new THREE.TorusGeometry(1.2, 0.2, 8, 32); // Área 4x maior
  const dragMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.0, // Totalmente invisível
    depthTest: false // Sempre na frente
  });
  const dragArea = new THREE.Mesh(dragGeometry, dragMaterial);
  dragArea.renderOrder = 999; // Renderizar antes dos elementos visíveis
  dragArea.userData = {
    type: 'ring',
    axis: axis,
    color: color,
    isDragArea: true,
    dragPriority: 1 // Prioridade alta para drag
  };
  group.add(dragArea);

  // Adicionar interatividade
  ring.userData = { type: 'ring', axis: axis, color: color };

  return group;
}

// Função para criar eixo de escala
function createScaleAxis(color, axis) {
  const group = new THREE.Group();
  group.name = `ScaleAxis_${axis}`;

  // Linha do eixo
  const lineGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1.5);
  const lineMaterial = new THREE.MeshBasicMaterial({ color: color });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.y = 0.75;
  line.renderOrder = 1000; // Renderizar na frente
  group.add(line);

  // Cubo na ponta
  const cubeGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const cubeMaterial = new THREE.MeshBasicMaterial({ color: color });
  const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cube.position.y = 1.6;
  cube.renderOrder = 1000; // Renderizar na frente
  group.add(cube);

  // ✅ ÁREA DE DRAG INVISÍVEL MAIOR (para facilitar o clique)
  const dragGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.8); // Área 7x maior
  const dragMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.0, // Totalmente invisível
    depthTest: false // Sempre na frente
  });
  const dragArea = new THREE.Mesh(dragGeometry, dragMaterial);
  dragArea.position.y = 0.9;
  dragArea.renderOrder = 999; // Renderizar antes dos elementos visíveis
  dragArea.userData = {
    type: 'scaleAxis',
    axis: axis,
    color: color,
    isDragArea: true,
    dragPriority: 1 // Prioridade alta para drag
  };
  group.add(dragArea);

  // Adicionar interatividade
  line.userData = { type: 'scaleAxis', axis: axis, color: color };
  cube.userData = { type: 'scaleAxis', axis: axis, color: color };

  return group;
}

// Função para criar cubo de escala uniforme
function createUniformScaleCube() {
  const group = new THREE.Group();
  group.name = 'UniformScale';

  const cubeGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const cubeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cube.renderOrder = 1000; // Renderizar na frente
  group.add(cube);

  // ✅ ÁREA DE DRAG INVISÍVEL MAIOR (para facilitar o clique)
  const dragGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4); // Área 8x maior
  const dragMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0, // Totalmente invisível
    depthTest: false // Sempre na frente
  });
  const dragArea = new THREE.Mesh(dragGeometry, dragMaterial);
  dragArea.renderOrder = 999; // Renderizar antes dos elementos visíveis
  dragArea.userData = {
    type: 'uniformScale',
    color: 0xffffff,
    isDragArea: true,
    dragPriority: 3 // Prioridade baixa para drag
  };
  group.add(dragArea);

  // Adicionar interatividade
  cube.userData = { type: 'uniformScale', color: 0xffffff };

  return group;
}

// ... funções de criação de gizmos ...

// Função para anexar gizmo customizado a um objeto
function attachCustomGizmoToObject(object) {

  if (!object) {
    console.error('❌ Objeto é null!');
    return;
  }

  if (!gizmoGroup) {
    console.error('❌ gizmoGroup não existe!');
    return;
  }

  

  clearCustomGizmo();

  const worldPosition = new THREE.Vector3();
  object.getWorldPosition(worldPosition);

  // Calcular escala do gizmo baseada na distância da câmera (como Unity)
  const cameraDistance = camera.position.distanceTo(worldPosition);
  const gizmoScale = Math.max(0.5, cameraDistance * 0.1); // Tamanho constante baseado na distância

  gizmoGroup.position.copy(worldPosition);
  gizmoGroup.scale.setScalar(gizmoScale);

  

  showCustomGizmo(gizmoMode);
  gizmoInteractions.dragObject = object;

}

// Função para mostrar gizmo específico
function showCustomGizmo(mode) {

  if (!gizmoGroup) {
    console.error('❌ gizmoGroup não existe!');
    return;
  }

  

  // Esconder todos os gizmos primeiro
  Object.values(customGizmos).forEach(gizmo => {
    if (gizmo) {
      gizmo.visible = false;
    }
  });

  // Mostrar o gizmo específico
  if (customGizmos[mode]) {
    customGizmos[mode].visible = true;
    activeGizmo = customGizmos[mode];
    gizmoGroup.visible = true;

  } else {
    gizmoGroup.visible = false;
    console.error('❌ Gizmo não encontrado para modo:', mode);
  }
}

// Função para limpar gizmo customizado
function clearCustomGizmo() {
  if (gizmoGroup) gizmoGroup.visible = false;
  gizmoInteractions.dragObject = null;
  gizmoInteractions.isDragging = false;
  gizmoInteractions.dragAxis = null;
}

// Função para configurar interações do gizmo customizado
function setupCustomGizmoInteractions() {
  if (!renderer || !camera) return;


  // Usar capture: true para garantir que os eventos sejam capturados primeiro
  renderer.domElement.addEventListener('mousedown', onCustomGizmoMouseDown, { capture: true });
  renderer.domElement.addEventListener('mousemove', onCustomGizmoMouseMove, { capture: true });
  renderer.domElement.addEventListener('mouseup', onCustomGizmoMouseUp, { capture: true });

}

function onCustomGizmoMouseDown(event) {

  if (!isEditorMode || !gizmoGroup || !gizmoGroup.visible) {
    return;
  }

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;


  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(gizmoGroup.children, true);

  if (intersects.length > 0) {
    // ✅ PRIORIZAR ÁREAS DE DRAG (isDragArea: true)
    let bestIntersect = intersects[0];
    let bestPriority = -1;

    for (const intersect of intersects) {
      const userData = intersect.object.userData;

      // Se é uma área de drag, dar prioridade
      if (userData.isDragArea) {
        const priority = userData.dragPriority || 0;
        if (priority > bestPriority) {
          bestPriority = priority;
          bestIntersect = intersect;
        }
      }
    }

    const userData = bestIntersect.object.userData;

    if (userData.type) {
      gizmoInteractions.isDragging = true;
      gizmoInteractions.dragAxis = userData.axis || userData.plane || userData.type;
      gizmoInteractions.dragStart = {
        mouse: mouse.clone(),
        objectPosition: gizmoInteractions.dragObject.position.clone(),
        objectRotation: gizmoInteractions.dragObject.rotation.clone(),
        objectScale: gizmoInteractions.dragObject.scale.clone()
      };

    }
  }
}

function onCustomGizmoMouseMove(event) {
  if (!gizmoInteractions.isDragging || !gizmoInteractions.dragObject) {
    return;
  }


  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const deltaMouse = mouse.clone().sub(gizmoInteractions.dragStart.mouse);


  switch (gizmoMode) {
    case 'translate':
      handleTranslateDrag(deltaMouse);
      break;
    case 'rotate':
      handleRotateDrag(deltaMouse);
      break;
    case 'scale':
      handleScaleDrag(deltaMouse);
      break;
  }
}

function onCustomGizmoMouseUp(event) {
  if (gizmoInteractions.isDragging) {
    gizmoInteractions.isDragging = false;
    gizmoInteractions.dragAxis = null;
    gizmoInteractions.dragStart = null;
  }
}

function handleTranslateDrag(deltaMouse) {
  if (!gizmoInteractions.dragObject) return;

  // Calcular a distância da câmera ao objeto para ajustar a sensibilidade
  const cameraDistance = camera.position.distanceTo(gizmoInteractions.dragObject.position);
  const sensitivity = 0.1 * cameraDistance; // Sensibilidade mais baixa e constante

  // Aplicar transformação baseada no modo de gizmo (sem inversões)
  switch (gizmoInteractions.dragAxis) {
    case 'X':
      // Movimento no eixo X (vermelho) - direto
      gizmoInteractions.dragObject.position.x += deltaMouse.x * sensitivity;
      break;
    case 'Y':
      // Movimento no eixo Y (verde) - direto, sem inverter
      gizmoInteractions.dragObject.position.y += deltaMouse.y * sensitivity;
      break;
    case 'Z':
      // Movimento no eixo Z (azul) - usar Y para movimento Z
      gizmoInteractions.dragObject.position.z += deltaMouse.y * sensitivity;
      break;
    case 'XY':
      // Movimento no plano XY - direto
      gizmoInteractions.dragObject.position.x += deltaMouse.x * sensitivity;
      gizmoInteractions.dragObject.position.y += deltaMouse.y * sensitivity;
      break;
    case 'XZ':
      // Movimento no plano XZ
      gizmoInteractions.dragObject.position.x += deltaMouse.x * sensitivity;
      gizmoInteractions.dragObject.position.z += deltaMouse.y * sensitivity;
      break;
    case 'YZ':
      // Movimento no plano YZ
      gizmoInteractions.dragObject.position.y += deltaMouse.y * sensitivity;
      gizmoInteractions.dragObject.position.z += deltaMouse.x * sensitivity;
      break;
  }

  // Atualizar posição do gizmo para seguir o objeto
  if (gizmoGroup) {
    const worldPosition = new THREE.Vector3();
    gizmoInteractions.dragObject.getWorldPosition(worldPosition);
    gizmoGroup.position.copy(worldPosition);
  }
}

function handleRotateDrag(deltaMouse) {
  if (!gizmoInteractions.dragObject) return;

  // Sensibilidade de rotação mais baixa e constante
  const sensitivity = 0.01;

  // Aplicar rotação baseada no eixo (sem inversões)
  switch (gizmoInteractions.dragAxis) {
    case 'X':
      // Rotação no eixo X (vermelho) - usar delta X
      gizmoInteractions.dragObject.rotation.x += deltaMouse.x * sensitivity;
      break;
    case 'Y':
      // Rotação no eixo Y (verde) - usar delta Y
      gizmoInteractions.dragObject.rotation.y += deltaMouse.y * sensitivity;
      break;
    case 'Z':
      // Rotação no eixo Z (azul) - usar delta X
      gizmoInteractions.dragObject.rotation.z += deltaMouse.x * sensitivity;
      break;
  }
}

function handleScaleDrag(deltaMouse) {
  if (!gizmoInteractions.dragObject) return;

  // Calcular a distância da câmera ao objeto para ajustar a sensibilidade
  const cameraDistance = camera.position.distanceTo(gizmoInteractions.dragObject.position);
  const sensitivity = 0.005 * cameraDistance; // Sensibilidade muito baixa

  // Usar delta X para escala (mais intuitivo)
  const delta = deltaMouse.x * sensitivity;
  const scaleFactor = 1 + delta;

  // Aplicar escala baseada no eixo
  switch (gizmoInteractions.dragAxis) {
    case 'X':
      gizmoInteractions.dragObject.scale.x *= scaleFactor;
      break;
    case 'Y':
      gizmoInteractions.dragObject.scale.y *= scaleFactor;
      break;
    case 'Z':
      gizmoInteractions.dragObject.scale.z *= scaleFactor;
      break;
    case 'uniformScale':
      gizmoInteractions.dragObject.scale.multiplyScalar(scaleFactor);
      break;
  }

  // NÃO escalar o gizmo - manter tamanho constante
  // O gizmo deve sempre ter o mesmo tamanho visual independente da escala do objeto
}

// Função para atualizar o tamanho do gizmo baseado na distância da câmera
function updateGizmoSize() {
  if (!gizmoGroup || !gizmoGroup.visible || !gizmoInteractions.dragObject) {
    return;
  }

  const worldPosition = new THREE.Vector3();
  gizmoInteractions.dragObject.getWorldPosition(worldPosition);

  // Calcular escala do gizmo baseada na distância da câmera
  const cameraDistance = camera.position.distanceTo(worldPosition);
  const gizmoScale = Math.max(0.5, cameraDistance * 0.1);

  // Atualizar apenas a escala, mantendo a posição
  gizmoGroup.scale.setScalar(gizmoScale);

  // ✅ ATUALIZAR RENDER ORDER DE TODOS OS ELEMENTOS DOS GIZMOS
  gizmoGroup.traverse((child) => {
    if (child.isMesh) {
      // Garantir que elementos visíveis sejam renderizados na frente
      if (child.material && child.material.opacity > 0) {
        child.renderOrder = 1000;
      }
      // Garantir que áreas de drag sejam renderizadas antes
      if (child.userData && child.userData.isDragArea) {
        child.renderOrder = 999;
      }
    }
  });
}

// ====== SISTEMA DE PERFIS DE PÓS-PROCESSAMENTO ======

export class ProfileManager {
  constructor() {
    this.profiles = [];
    this.currentProfileId = null;
    this.profilesPath = './config/postProcessingProfiles.json';
    this.callbacks = {
      onProfileCreated: null,
      onProfileUpdated: null,
      onProfileDeleted: null,
      onProfileApplied: null,
      onProfilesLoaded: null
    };

    // Carrega perfis automaticamente
    this.loadProfiles();
  }

  // ====== GESTÃO DE PERFIS ======

  async loadProfiles() {
    try {
      const response = await fetch(this.profilesPath);
      if (response.ok) {
        const data = await response.json();
        this.profiles = data.profiles || [];
        this.currentProfileId = data.currentProfileId || null;

        if (this.callbacks.onProfilesLoaded) {
          this.callbacks.onProfilesLoaded(this.profiles);
        }
      } else {
        console.warn('📁 Arquivo de perfis não encontrado, criando novo...');
        this.profiles = [];
        this.currentProfileId = null;
        await this.saveProfiles();
      }
    } catch (error) {
      console.warn('⚠️ Erro ao carregar perfis:', error);
      this.profiles = [];
      this.currentProfileId = null;
    }
  }

  async saveProfiles() {
    try {
      const data = {
        profiles: this.profiles,
        currentProfileId: this.currentProfileId,
        lastUpdated: new Date().toISOString()
      };

      // Dispara callback para o editor salvar via IPC
      if (window.psxProfileManager && window.psxProfileManager.saveProfiles) {
        window.psxProfileManager.saveProfiles(data);
      }

      return true;
    } catch (error) {
      console.error('❌ Erro ao salvar perfis:', error);
      return false;
    }
  }

  createProfile(name, settings = null) {
    const profile = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: settings || this.getCurrentSettings(),
      metadata: {
        version: '1.0.0',
        author: 'PSX Engine',
        description: `Perfil criado em ${new Date().toLocaleString()}`
      }
    };

    this.profiles.push(profile);
    this.saveProfiles();


    if (this.callbacks.onProfileCreated) {
      this.callbacks.onProfileCreated(profile);
    }

    return profile;
  }

  updateProfile(profileId, updates) {
    const profileIndex = this.profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) {
      console.warn('⚠️ Perfil não encontrado:', profileId);
      return false;
    }

    this.profiles[profileIndex] = {
      ...this.profiles[profileIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.saveProfiles();


    if (this.callbacks.onProfileUpdated) {
      this.callbacks.onProfileUpdated(this.profiles[profileIndex]);
    }

    return this.profiles[profileIndex];
  }

  deleteProfile(profileId) {
    const profileIndex = this.profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) {
      console.warn('⚠️ Perfil não encontrado:', profileId);
      return false;
    }

    const deletedProfile = this.profiles[profileIndex];
    this.profiles.splice(profileIndex, 1);

    // Se era o perfil atual, remove a seleção
    if (this.currentProfileId === profileId) {
      this.currentProfileId = null;
    }

    this.saveProfiles();


    if (this.callbacks.onProfileDeleted) {
      this.callbacks.onProfileDeleted(deletedProfile);
    }

    return true;
  }

  applyProfile(profileId) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) {
      console.warn('⚠️ Perfil não encontrado:', profileId);
      return false;
    }

    // Aplica as configurações do perfil
    if (profile.settings) {
      this.applySettings(profile.settings);
    }

    this.currentProfileId = profileId;
    this.saveProfiles();


    if (this.callbacks.onProfileApplied) {
      this.callbacks.onProfileApplied(profile);
    }

    return true;
  }

  // ====== CONFIGURAÇÕES ======

  getCurrentSettings() {
    const settings = {};

    // Captura configurações de pós-processamento
    if (globalPostProcessing) {
      settings.postProcessing = this.extractPostProcessingSettings();
    }

    // Captura configurações de ambiente
    if (currentEnvironment) {
      settings.environment = this.extractEnvironmentSettings();
    }

    // Captura configurações de renderização
    settings.rendering = this.extractRenderingSettings();

    return settings;
  }

  extractPostProcessingSettings() {
    // Extrai configurações dos passes ativos
    const settings = {
      enabled: composer && composer.passes.length > 1 // Mais que apenas RenderPass
    };

    // Aqui você pode adicionar lógica para extrair configurações específicas
    // dos passes ativos no composer

    return settings;
  }

  extractEnvironmentSettings() {
    return {
      // Configurações de ambiente como skybox, luzes, etc.
      skybox: scene.background ? 'custom' : 'default',
      lights: scene.children.filter(child => child.isLight).length
    };
  }

  extractRenderingSettings() {
    return {
      shadowsEnabled: renderer.shadowMap.enabled,
      shadowMapType: renderer.shadowMap.type,
      antialias: renderer.getContext().getContextAttributes().antialias
    };
  }

  applySettings(settings) {
    // Aplica configurações de pós-processamento
    if (settings.postProcessing && globalPostProcessing) {
      this.applyPostProcessingSettings(settings.postProcessing);
    }

    // Aplica configurações de ambiente
    if (settings.environment && currentEnvironment) {
      this.applyEnvironmentSettings(settings.environment);
    }

    // Aplica configurações de renderização
    if (settings.rendering) {
      this.applyRenderingSettings(settings.rendering);
    }
  }

  applyPostProcessingSettings(settings) {
    // Aplica configurações específicas de pós-processamento

    if (!globalPostProcessing) {
      console.warn('⚠️ PostProcessing não está inicializado');
      return;
    }

    // Reset do post-processing
    globalPostProcessing.reset();

    // Aplicar efeitos baseado nas configurações
    Object.keys(settings).forEach(effectName => {
      if (effectName === 'enabled') return;

      const effectConfig = settings[effectName];
      if (effectConfig && effectConfig.enabled) {

        switch (effectName) {
          case 'bloom':
            globalPostProcessing.addBloom(
              effectConfig.strength || 1,
              effectConfig.radius || 1,
              effectConfig.threshold || 0.1
            );
            break;
          case 'film':
            globalPostProcessing.addFilm(
              effectConfig.noiseIntensity || 0.15,
              effectConfig.scanlinesIntensity || 0.015,
              effectConfig.scanlinesCount || 512
            );
            break;
          case 'depthOfField':
            globalPostProcessing.addDepthOfField(
              effectConfig.focus || 15.0,
              effectConfig.aperture || 0.02,
              effectConfig.maxBlur || 0.005
            );
            break;
          case 'motionBlur':
            globalPostProcessing.addMotionBlur(effectConfig.damp || 0.5);
            break;
          case 'vignette':
            globalPostProcessing.addVignette(
              effectConfig.offset || 1.0,
              effectConfig.darkness || 1.0
            );
            break;
          case 'chromaticAberration':
            globalPostProcessing.addChromaticAberration(effectConfig.amount || 0.005);
            break;
          case 'colorCorrection':
            globalPostProcessing.addColorCorrection(
              effectConfig.powRGB || [1.1, 1.1, 1.1],
              effectConfig.mulRGB || [1.0, 1.0, 1.0]
            );
            break;
          case 'smaa':
            globalPostProcessing.addSMAA();
            break;
          case 'outline':
            globalPostProcessing.addOutline(
              effectConfig.edgeStrength || 3.0,
              effectConfig.edgeGlow || 0.0,
              effectConfig.edgeThickness || 1.0,
              effectConfig.visibleEdgeColor || '#ffffff',
              effectConfig.hiddenEdgeColor || '#190a05'
            );
            break;
          case 'pixelation':
            globalPostProcessing.addPixelation(effectConfig.pixelSize || 6);
            break;
          case 'hueSaturation':
            globalPostProcessing.addHueSaturation(
              effectConfig.hue || 0.0,
              effectConfig.saturation || 0.0
            );
            break;
          case 'glitch':
            globalPostProcessing.addGlitch(
              effectConfig.intensity || 0.1,
              effectConfig.goWild || false
            );
            break;
          case 'lensFlare':
            globalPostProcessing.addLensFlare(
              effectConfig.intensity || 0.5,
              effectConfig.flareColor || '#ffffff',
              effectConfig.sunPosition || [0, 0, 0]
            );
            break;
          case 'brightnessContrast':
            globalPostProcessing.addBrightnessContrast(
              effectConfig.brightness || 0.0,
              effectConfig.contrast || 0.0
            );
            break;
          case 'gammaCorrection':
            globalPostProcessing.addGammaCorrection(effectConfig.gamma || 2.2);
            break;
          case 'advancedHueSaturation':
            globalPostProcessing.addAdvancedHueSaturation(
              effectConfig.hue || 0.0,
              effectConfig.saturation || 0.0,
              effectConfig.lightness || 0.0
            );
            break;
          case 'ssao':
            globalPostProcessing.addSSAO(
              effectConfig.radius || 0.5,
              effectConfig.minDistance || 0.005,
              effectConfig.maxDistance || 0.1
            );
            break;
          case 'ssr':
            globalPostProcessing.addSSR(
              effectConfig.intensity || 0.5,
              effectConfig.maxDistance || 100.0,
              effectConfig.thickness || 0.1
            );
            break;
          case 'godRays':
            globalPostProcessing.addGodRays(
              effectConfig.intensity || 0.5,
              effectConfig.density || 0.96,
              effectConfig.decay || 0.96,
              effectConfig.exposure || 0.34,
              effectConfig.lightPosition || [0.5, 0.5]
            );
            break;
          case 'hdr':
            globalPostProcessing.addHDR(
              effectConfig.exposure || 1.0,
              effectConfig.toneMapping || 'reinhard',
              effectConfig.contrast || 1.1,
              effectConfig.saturation || 1.0
            );
            break;
          case 'volumetricFog':
            globalPostProcessing.addVolumetricFog(
              effectConfig.density || 0.1,
              effectConfig.color || '#ffffff',
              effectConfig.scattering || 0.5,
              effectConfig.absorption || 0.2,
              effectConfig.height || 100.0,
              effectConfig.falloff || 0.1
            );
            break;
          case 'volumetricLighting':
            globalPostProcessing.addVolumetricLighting(
              effectConfig.intensity || 0.8,
              effectConfig.samples || 32,
              effectConfig.scattering || 0.5,
              effectConfig.lightColor || '#ffffff',
              effectConfig.lightPosition || [0.5, 0.5, 0.5],
              effectConfig.rayMarchSteps || 24
            );
            break;
          case 'sepia':
            globalPostProcessing.addSepia(effectConfig.amount || 0.5);
            break;
          case 'dotScreen':
            globalPostProcessing.addDotScreen(
              effectConfig.scale || 4.0,
              effectConfig.angle || 1.57
            );
            break;
          case 'scanline':
            globalPostProcessing.addScanline(
              effectConfig.density || 0.04,
              effectConfig.opacity || 0.4
            );
            break;
          case 'noiseEffect':
            globalPostProcessing.addNoiseEffect(effectConfig.amount || 0.5);
            break;
          case 'halftone':
            globalPostProcessing.addHalftone(
              effectConfig.shape || 1,
              effectConfig.radius || 4,
              effectConfig.rotateR || 0.261799,
              effectConfig.rotateG || 0.523599,
              effectConfig.rotateB || 0.785398,
              effectConfig.scatter || 0
            );
            break;
          case 'hbao':
            globalPostProcessing.addHBAO(
              effectConfig.radius || 1.0,
              effectConfig.intensity || 1.0,
              effectConfig.quality || 0.5
            );
            break;
          case 'fxaa':
            globalPostProcessing.addFXAA(effectConfig.resolution || [window.innerWidth, window.innerHeight]);
            break;
          case 'sobelEdgeDetection':
            globalPostProcessing.addSobelEdgeDetection(effectConfig.threshold || 0.1);
            break;
          case 'ascii':
            globalPostProcessing.addASCII(
              effectConfig.characters || ' .:-=+*#%@',
              effectConfig.fontSize || 10
            );
            break;
          case 'crosshatch':
            globalPostProcessing.addCrosshatch(
              effectConfig.spacing || 0.05,
              effectConfig.thickness || 0.002
            );
            break;
          case 'dithering':
            globalPostProcessing.addDithering(effectConfig.bayerLevel || 2);
            break;
          case 'barrelDistortion':
            globalPostProcessing.addBarrelDistortion(
              effectConfig.strength || 0.1,
              effectConfig.cylindricalRatio || 1.0
            );
            break;
          case 'fisheye':
            globalPostProcessing.addFisheye(effectConfig.strength || 0.5);
            break;
          case 'lut':
            globalPostProcessing.addLUT(effectConfig.lutTexture, effectConfig.amount || 1.0);
            break;
          // Efeitos PS2/Retro
          case 'psxDithering':
            globalPostProcessing.addPSXDithering(
              effectConfig.colorDepth || 16,
              effectConfig.intensity || 1.0
            );
            break;
          case 'psxJitter':
            globalPostProcessing.addPSXJitter(
              effectConfig.vertexJitter || 0.008,
              effectConfig.uvJitter || 0.005,
              effectConfig.timeScale || 500.0
            );
            break;
          case 'psxPixelation':
            globalPostProcessing.addPSXPixelation(
              effectConfig.pixelSize || 8,
              effectConfig.resolution || 0.5
            );
            break;
          case 'psxScanlines':
            globalPostProcessing.addPSXScanlines(
              effectConfig.density || 0.04,
              effectConfig.opacity || 0.6,
              effectConfig.count || 512
            );
            break;
          case 'psxColorBanding':
            globalPostProcessing.addPSXColorBanding(
              effectConfig.bands || 16,
              effectConfig.intensity || 1.0
            );
            break;
          case 'psxTextureWarping':
            globalPostProcessing.addPSXTextureWarping(
              effectConfig.warpStrength || 0.01,
              effectConfig.warpSpeed || 5.0
            );
            break;
          case 'psxFog':
            globalPostProcessing.addPSXFog(
              effectConfig.near || 10,
              effectConfig.far || 100,
              effectConfig.density || 0.1
            );
            break;
          case 'psxVertexPrecision':
            globalPostProcessing.addPSXVertexPrecision(
              effectConfig.precision || 10.0,
              effectConfig.intensity || 1.0
            );
            break;
          default:
            console.warn(`⚠️ Efeito não reconhecido: ${effectName}`);
            break;
        }
      }
    });
  }

  applyEnvironmentSettings(settings) {

    if (!currentEnvironment) {
      console.warn('⚠️ Environment não está inicializado');
      return;
    }

    // Aplicar configurações de skybox
    if (settings.skybox) {

      if (settings.skybox.type === 'hdr' && settings.skybox.hdriPath) {
        currentEnvironment.setHDR(settings.skybox.hdriPath);
      }
    }

    // Aplicar configurações de fog
    if (settings.fog) {

      if (settings.fog.enabled) {
        currentEnvironment.setFog(settings.fog.color || 0xffffff, settings.fog.density || 0.1);
      } else {
        currentEnvironment.clearFog();
      }
    }

    // Aplicar configurações de ambient light
    if (settings.ambientLight) {

      if (settings.ambientLight.enabled !== false) {
        currentEnvironment.addAmbientLight(
          settings.ambientLight.color || 0x404040,
          settings.ambientLight.intensity || 1
        );
      }
    }
  }

  applyRenderingSettings(settings) {
    // Lógica para aplicar configurações de renderização
  }

  // ====== UTILITÁRIOS ======

  getProfiles() {
    return this.profiles;
  }

  getProfile(profileId) {
    return this.profiles.find(p => p.id === profileId);
  }

  getCurrentProfile() {
    return this.currentProfileId ? this.getProfile(this.currentProfileId) : null;
  }

  getProfileByName(name) {
    return this.profiles.find(p => p.name === name);
  }

  duplicateProfile(profileId, newName) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      console.warn('⚠️ Perfil não encontrado:', profileId);
      return false;
    }

    return this.createProfile(newName, profile.settings);
  }

  exportProfile(profileId) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      console.warn('⚠️ Perfil não encontrado:', profileId);
      return null;
    }

    return {
      ...profile,
      exportedAt: new Date().toISOString(),
      exportedBy: 'PSX Engine Profile System'
    };
  }

  importProfile(profileData) {
    if (!profileData.name || !profileData.settings) {
      console.warn('⚠️ Dados de perfil inválidos');
      return false;
    }

    return this.createProfile(profileData.name, profileData.settings);
  }

  // ====== CALLBACKS ======

  onProfileCreated(callback) {
    this.callbacks.onProfileCreated = callback;
  }

  onProfileUpdated(callback) {
    this.callbacks.onProfileUpdated = callback;
  }

  onProfileDeleted(callback) {
    this.callbacks.onProfileDeleted = callback;
  }

  onProfileApplied(callback) {
    this.callbacks.onProfileApplied = callback;
  }

  onProfilesLoaded(callback) {
    this.callbacks.onProfilesLoaded = callback;
  }

  // ====== PRESETS ======

  createPresetProfiles() {
    const presets = [
      {
        name: '🌅 Dia Ensolarado',
        settings: {
          postProcessing: {
            enabled: true,
            bloom: { enabled: true, strength: 0.8, radius: 0.4, threshold: 0.9 },
            hdr: { enabled: true, exposure: 1.2, toneMapping: 'aces' },
            brightnessContrast: { enabled: true, brightness: 0.1, contrast: 0.1 }
          }
        }
      },
      {
        name: '🌃 Noite Dramática',
        settings: {
          postProcessing: {
            enabled: true,
            vignette: { enabled: true, offset: 0.3, darkness: 0.8 },
            ssao: { enabled: true, radius: 0.5, intensity: 1.0 },
            colorCorrection: { enabled: true, powRGB: [0.9, 0.9, 1.1] }
          }
        }
      },
      {
        name: '🕹️ Retro Gaming',
        settings: {
          postProcessing: {
            enabled: true,
            pixelation: { enabled: true, pixelSize: 8 },
            scanline: { enabled: true, density: 0.04, opacity: 0.6 },
            film: { enabled: true, noiseIntensity: 0.15 }
          }
        }
      },
      {
        name: '🎬 Cinematográfico',
        settings: {
          postProcessing: {
            enabled: true,
            depthOfField: { enabled: true, focus: 10.0, aperture: 0.015 },
            colorCorrection: { enabled: true, powRGB: [1.1, 1.0, 0.9] },
            vignette: { enabled: true, offset: 0.4, darkness: 0.3 }
          }
        }
      },
      {
        name: '🕹️ PSX Classic',
        settings: {
          postProcessing: {
            enabled: true,
            psxDithering: { enabled: true, colorDepth: 16, intensity: 1.0 },
            psxJitter: { enabled: true, vertexJitter: 0.008, uvJitter: 0.005, timeScale: 500.0 },
            psxPixelation: { enabled: true, pixelSize: 8, resolution: 0.5 },
            psxScanlines: { enabled: true, density: 0.04, opacity: 0.6, count: 512 },
            psxColorBanding: { enabled: true, bands: 16, intensity: 1.0 }
          }
        }
      },
      {
        name: '🎮 N64 Style',
        settings: {
          postProcessing: {
            enabled: true,
            psxPixelation: { enabled: true, pixelSize: 4, resolution: 0.3 },
            psxScanlines: { enabled: true, density: 0.02, opacity: 0.4, count: 256 },
            psxColorBanding: { enabled: true, bands: 8, intensity: 0.8 },
            psxTextureWarping: { enabled: true, warpStrength: 0.005, warpSpeed: 3.0 }
          }
        }
      },
      {
        name: '📺 Dreamcast',
        settings: {
          postProcessing: {
            enabled: true,
            psxDithering: { enabled: true, colorDepth: 24, intensity: 0.6 },
            psxPixelation: { enabled: true, pixelSize: 6, resolution: 0.4 },
            psxScanlines: { enabled: true, density: 0.03, opacity: 0.5, count: 384 },
            psxColorBanding: { enabled: true, bands: 32, intensity: 0.4 }
          }
        }
      }
    ];

    presets.forEach(preset => {
      if (!this.getProfileByName(preset.name)) {
        this.createProfile(preset.name, preset.settings);
      }
    });
  }
}

// Instância global do ProfileManager
let globalProfileManager = null;

export function getProfileManager() {
  if (!globalProfileManager) {
    globalProfileManager = new ProfileManager();
  }
  return globalProfileManager;
}

// ====== APIs PÚBLICAS PARA SCRIPTS ======

export function createPostProcessingProfile(name, settings = null) {
  return getProfileManager().createProfile(name, settings);
}

export function applyPostProcessingProfile(profileId) {
  return getProfileManager().applyProfile(profileId);
}

export function deletePostProcessingProfile(profileId) {
  return getProfileManager().deleteProfile(profileId);
}

export function getPostProcessingProfiles() {
  return getProfileManager().getProfiles();
}

export function getCurrentPostProcessingProfile() {
  return getProfileManager().getCurrentProfile();
}

export function findPostProcessingProfile(name) {
  return getProfileManager().getProfileByName(name);
}

export function duplicatePostProcessingProfile(profileId, newName) {
  return getProfileManager().duplicateProfile(profileId, newName);
}

export function exportPostProcessingProfile(profileId) {
  return getProfileManager().exportProfile(profileId);
}

export function importPostProcessingProfile(profileData) {
  return getProfileManager().importProfile(profileData);
}

export function createPresetPostProcessingProfiles() {
  return getProfileManager().createPresetProfiles();
}

export function updatePostProcessingProfile(profileId, updates) {
  return getProfileManager().updateProfile(profileId, updates);
}

export function saveCurrentSettingsToProfile(profileId) {
  const manager = getProfileManager();
  const currentSettings = manager.getCurrentSettings();
  return manager.updateProfile(profileId, { settings: currentSettings });
}

// ====== INTEGRAÇÃO COM EDITOR ======

export function setupProfileManagerForEditor() {
  const manager = getProfileManager();

  // Configura callbacks para comunicação com o editor
  manager.onProfileCreated((profile) => {
    if (window.psxProfileManager && window.psxProfileManager.onProfileCreated) {
      window.psxProfileManager.onProfileCreated(profile);
    }
  });

  manager.onProfileUpdated((profile) => {
    if (window.psxProfileManager && window.psxProfileManager.onProfileUpdated) {
      window.psxProfileManager.onProfileUpdated(profile);
    }
  });

  manager.onProfileDeleted((profile) => {
    if (window.psxProfileManager && window.psxProfileManager.onProfileDeleted) {
      window.psxProfileManager.onProfileDeleted(profile);
    }
  });

  manager.onProfileApplied((profile) => {
    if (window.psxProfileManager && window.psxProfileManager.onProfileApplied) {
      window.psxProfileManager.onProfileApplied(profile);
    }
  });

  manager.onProfilesLoaded((profiles) => {
    if (window.psxProfileManager && window.psxProfileManager.onProfilesLoaded) {
      window.psxProfileManager.onProfilesLoaded(profiles);
    }
  });

}

// ==================== SISTEMA DE TILING E INTENSIDADE DE TEXTURAS ====================

// Função para atualizar tiling de textura
export function updateTextureTiling(objectName, textureType, tilingX, tilingY) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  let texture = null;

  switch (textureType) {
    case 'map':
      texture = material.map;
      break;
    case 'normalMap':
      texture = material.normalMap;
      break;
    case 'roughnessMap':
      texture = material.roughnessMap;
      break;
    case 'metalnessMap':
      texture = material.metalnessMap;
      break;
    case 'aoMap':
      texture = material.aoMap;
      break;
    case 'emissiveMap':
      texture = material.emissiveMap;
      break;
    default:
      console.warn(`⚠️ Tipo de textura não suportado: ${textureType}`);
      return;
  }

  if (texture) {
    texture.repeat.set(tilingX, tilingY);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    material.needsUpdate = true;
  } else {
    console.warn(`⚠️ Textura ${textureType} não encontrada no material`);
  }
}

// Função para atualizar offset de textura
export function updateTextureOffset(objectName, textureType, offsetX, offsetY) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  let texture = null;

  switch (textureType) {
    case 'map':
      texture = material.map;
      break;
    case 'normalMap':
      texture = material.normalMap;
      break;
    case 'roughnessMap':
      texture = material.roughnessMap;
      break;
    case 'metalnessMap':
      texture = material.metalnessMap;
      break;
    case 'aoMap':
      texture = material.aoMap;
      break;
    case 'emissiveMap':
      texture = material.emissiveMap;
      break;
    default:
      console.warn(`⚠️ Tipo de textura não suportado: ${textureType}`);
      return;
  }

  if (texture) {
    texture.offset.set(offsetX, offsetY);
    material.needsUpdate = true;
  } else {
    console.warn(`⚠️ Textura ${textureType} não encontrada no material`);
  }
}

// Função para atualizar intensidade de normal map
export function updateNormalMapIntensity(objectName, intensityX, intensityY) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  if (material.normalScale) {
    material.normalScale.set(intensityX, intensityY);
    material.needsUpdate = true;
  } else {
    console.warn(`⚠️ Normal scale não encontrado no material`);
  }
}

// Função para atualizar intensidade de roughness map
export function updateRoughnessMapIntensity(objectName, intensity) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  material.roughnessMapIntensity = intensity;
  material.needsUpdate = true;
}

// Função para atualizar intensidade de metalness map
export function updateMetalnessMapIntensity(objectName, intensity) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  material.metalnessMapIntensity = intensity;
  material.needsUpdate = true;
}

// Função para atualizar intensidade de AO map
export function updateAOMapIntensity(objectName, intensity) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  material.aoMapIntensity = intensity;
  material.needsUpdate = true;
}

// Função para atualizar intensidade de emissive map
export function updateEmissiveMapIntensity(objectName, intensity) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return;
  }

  const material = object.material;
  material.emissiveMapIntensity = intensity;
  material.needsUpdate = true;
}

// Função para obter propriedades de textura
export function getTextureProperties(objectName) {
  const object = scene.getObjectByName(objectName);
  if (!object || !object.material) {
    console.warn(`⚠️ Objeto ou material não encontrado: ${objectName}`);
    return null;
  }

  const material = object.material;
  const properties = {};

  // Função auxiliar para extrair propriedades de textura
  const extractTextureProps = (texture, type) => {
    if (texture) {
      properties[type] = {
        tiling: texture.repeat ? texture.repeat.toArray() : [1, 1],
        offset: texture.offset ? texture.offset.toArray() : [0, 0]
      };
    }
  };

  extractTextureProps(material.map, 'map');
  extractTextureProps(material.normalMap, 'normalMap');
  extractTextureProps(material.roughnessMap, 'roughnessMap');
  extractTextureProps(material.metalnessMap, 'metalnessMap');
  extractTextureProps(material.aoMap, 'aoMap');
  extractTextureProps(material.emissiveMap, 'emissiveMap');

  // Propriedades de intensidade
  if (material.normalScale) {
    properties.normalScale = material.normalScale.toArray();
  }
  if (material.roughnessMapIntensity !== undefined) {
    properties.roughnessMapIntensity = material.roughnessMapIntensity;
  }
  if (material.metalnessMapIntensity !== undefined) {
    properties.metalnessMapIntensity = material.metalnessMapIntensity;
  }
  if (material.aoMapIntensity !== undefined) {
    properties.aoMapIntensity = material.aoMapIntensity;
  }
  if (material.emissiveMapIntensity !== undefined) {
    properties.emissiveMapIntensity = material.emissiveMapIntensity;
  }

  return properties;
}

// ====== FIM DO SISTEMA DE TILING E INTENSIDADE ======

// ====== FIM DO SISTEMA DE PERFIS ======

// Função de conveniência para aplicar Mesh Colliders a modelos GLB
export function applyMeshCollidersToModel(model, options = {}) {
  const {
    useConvex = false,      // true = convex hull, false = triangle mesh
    makeStatic = true,      // true = estático, false = dinâmico
    showColliders = true    // true = mostrar visualização
  } = options;


  // Criar mesh colliders para todos os meshes
  const createdBodies = createMeshCollidersForAllMeshes(model, useConvex, makeStatic);

  // Mostrar visualizações se solicitado
  if (showColliders) {
    showPhysicsColliders();
  }

  return createdBodies;
}

// ==================== SISTEMA DE CENAS ====================

export function saveScene(sceneName) {

  // Usar o sistema de comunicação do editorIntegration
  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - comunica via sistema de handlers
    window.parent.postMessage({
      type: 'SAVE_SCENE',
      sceneName: sceneName
    }, '*');
  } else {
    // Fallback para desenvolvimento
    const sceneData = saveProject();
    sceneData.meta.sceneName = sceneName;
    localStorage.setItem(`psx-scene-${sceneName}`, JSON.stringify(sceneData));
  }

  return true;
}

export function loadScene(sceneName) {

  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - solicita via sistema de handlers
    window.parent.postMessage({
      type: 'LOAD_SCENE',
      sceneName: sceneName
    }, '*');
    return true;
  } else {
    // Fallback para desenvolvimento
    const stored = localStorage.getItem(`psx-scene-${sceneName}`);
    if (stored) {
      const sceneData = JSON.parse(stored);
      //clearScene();
      loadProject(sceneData);
      return true;
    } else {
      console.warn(`⚠️ Cena '${sceneName}' não encontrada!`);
      return false;
    }
  }
}

function clearScene() {
  // Remove todos os objetos da cena
  const objectsToRemove = [...sceneObjects];
  objectsToRemove.forEach(obj => {
    destroy(obj);
  });

  // Limpa luzes (exceto ambiente)
  scene.children.forEach(child => {
    if (child.type === 'DirectionalLight' || child.type === 'PointLight' || child.type === 'SpotLight') {
      scene.remove(child);
    }
  });

  // Reset do ambiente
  scene.background = null;
  scene.fog = null;

}

function loadSceneObject(objData) {
  // Determina o tipo de geometria baseado no tipo do objeto
  const geometry = createGeometryFromType(objData.type);
  if (!geometry) {
    console.warn(`⚠️ Tipo de objeto desconhecido: ${objData.type}`);
    return;
  }

  // Cria material
  let material;

  // Suportar tanto formato 'materials' (plural) quanto 'material' (singular)
  let matData = null;
  if (objData.materials && objData.materials.length > 0) {
    matData = objData.materials[0];
  } else if (objData.material) {
    matData = objData.material;
  }

  if (matData) {
    material = new THREE.MeshStandardMaterial({
      color: matData.color || 0xffffff,
      transparent: matData.transparent,
      opacity: matData.opacity || 1,
      metalness: matData.metalness || 0,
      roughness: matData.roughness || 1
    });

    // Carrega texturas se existirem
    const loadTexturePromises = [];

    if (matData.map) {
      loadTexturePromises.push(
        loadTexture(matData.map).then(texture => {
          material.map = texture;
          // Aplicar tiling e offset
          if (matData.mapTiling) {
            texture.repeat.set(matData.mapTiling[0], matData.mapTiling[1]);
          }
          if (matData.mapOffset) {
            texture.offset.set(matData.mapOffset[0], matData.mapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura difusa ${matData.map}:`, error);
        })
      );
    }

    if (matData.normalMap) {
      loadTexturePromises.push(
        loadTexture(matData.normalMap).then(texture => {
          material.normalMap = texture;
          // Aplicar tiling e offset
          if (matData.normalMapTiling) {
            texture.repeat.set(matData.normalMapTiling[0], matData.normalMapTiling[1]);
          }
          if (matData.normalMapOffset) {
            texture.offset.set(matData.normalMapOffset[0], matData.normalMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de normal
          if (matData.normalScale) {
            material.normalScale.set(matData.normalScale[0], matData.normalScale[1]);
          }
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura normal ${matData.normalMap}:`, error);
        })
      );
    }

    if (matData.roughnessMap) {
      loadTexturePromises.push(
        loadTexture(matData.roughnessMap).then(texture => {
          material.roughnessMap = texture;
          // Aplicar tiling e offset
          if (matData.roughnessMapTiling) {
            texture.repeat.set(matData.roughnessMapTiling[0], matData.roughnessMapTiling[1]);
          }
          if (matData.roughnessMapOffset) {
            texture.offset.set(matData.roughnessMapOffset[0], matData.roughnessMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de roughness
          if (matData.roughnessMapIntensity !== undefined) {
            material.roughnessMapIntensity = matData.roughnessMapIntensity;
          }
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura rugosidade ${matData.roughnessMap}:`, error);
        })
      );
    }

    if (matData.metalnessMap) {
      loadTexturePromises.push(
        loadTexture(matData.metalnessMap).then(texture => {
          material.metalnessMap = texture;
          // Aplicar tiling e offset
          if (matData.metalnessMapTiling) {
            texture.repeat.set(matData.metalnessMapTiling[0], matData.metalnessMapTiling[1]);
          }
          if (matData.metalnessMapOffset) {
            texture.offset.set(matData.metalnessMapOffset[0], matData.metalnessMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de metalness
          if (matData.metalnessMapIntensity !== undefined) {
            material.metalnessMapIntensity = matData.metalnessMapIntensity;
          }
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura metalicidade ${matData.metalnessMap}:`, error);
        })
      );
    }

    if (matData.aoMap) {
      loadTexturePromises.push(
        loadTexture(matData.aoMap).then(texture => {
          material.aoMap = texture;
          // Aplicar tiling e offset
          if (matData.aoMapTiling) {
            texture.repeat.set(matData.aoMapTiling[0], matData.aoMapTiling[1]);
          }
          if (matData.aoMapOffset) {
            texture.offset.set(matData.aoMapOffset[0], matData.aoMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de AO
          if (matData.aoMapIntensity !== undefined) {
            material.aoMapIntensity = matData.aoMapIntensity;
          }
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura AO ${matData.aoMap}:`, error);
        })
      );
    }

    if (matData.emissiveMap) {
      loadTexturePromises.push(
        loadTexture(matData.emissiveMap).then(texture => {
          material.emissiveMap = texture;
          // Aplicar tiling e offset
          if (matData.emissiveMapTiling) {
            texture.repeat.set(matData.emissiveMapTiling[0], matData.emissiveMapTiling[1]);
          }
          if (matData.emissiveMapOffset) {
            texture.offset.set(matData.emissiveMapOffset[0], matData.emissiveMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de emissive
          if (matData.emissiveMapIntensity !== undefined) {
            material.emissiveMapIntensity = matData.emissiveMapIntensity;
          }
          material.needsUpdate = true;
        }).catch(error => {
          console.error(`❌ Erro ao carregar textura emissiva ${matData.emissiveMap}:`, error);
        })
      );
    }

    // Aguarda todas as texturas carregarem
    Promise.all(loadTexturePromises).then(() => {
    });

  } else {
    material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  }

  // Cria objeto
  const mesh = new THREE.Mesh(geometry, material);

  // Aplica transformação
  if (objData.transform) {
    mesh.position.fromArray(objData.transform.position);
    mesh.rotation.fromArray(objData.transform.rotation);
    mesh.scale.fromArray(objData.transform.scale);
  }

  // Cria objeto PSX
  const psxObject = instantiate(mesh, objData.name, objData.type);


  return psxObject;
}

function createGeometryFromType(type) {
  switch (type.toLowerCase()) {
    case 'box':
    case 'boxgeometry':
    case 'boxbuffergeometry':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
    case 'spheregeometry':
    case 'spherebuffergeometry':
      return new THREE.SphereGeometry(0.5, 16, 16);
    case 'cylinder':
    case 'cylindergeometry':
    case 'cylinderbuffergeometry':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    case 'plane':
    case 'planegeometry':
    case 'planebuffergeometry':
      return new THREE.PlaneGeometry(1, 1);
    case 'cone':
    case 'conegeometry':
    case 'conebuffergeometry':
      return new THREE.ConeGeometry(0.5, 1, 16);
    case 'torus':
    case 'torusgeometry':
    case 'torusbuffergeometry':
      return new THREE.TorusGeometry(0.5, 0.2, 16, 32);
    case 'mesh':
      return new THREE.BoxGeometry(1, 1, 1);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function getScenesList() {

  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - solicita via sistema de handlers
    window.parent.postMessage({
      type: 'GET_SCENES_LIST'
    }, '*');
    return true;
  } else {
    // Fallback para desenvolvimento
    const scenes = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('psx-scene-')) {
        scenes.push(key.replace('psx-scene-', ''));
      }
    }
    return scenes;
  }
}

export function deleteScene(sceneName) {

  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - comunica via sistema de handlers
    window.parent.postMessage({
      type: 'DELETE_SCENE',
      sceneName: sceneName
    }, '*');
  } else {
    localStorage.removeItem(`psx-scene-${sceneName}`);
  }
}

export function autoSaveScene() {
  const currentSceneName = getCurrentSceneName();
  if (currentSceneName) {
    saveScene(currentSceneName);
  }
}

export function getCurrentSceneName() {
  // Obtém o nome da cena atual do SceneManager
  if (window.sceneManager && window.sceneManager.currentScene) {
    return window.sceneManager.currentScene.name || 'untitled';
  }
  return 'untitled';
}

export function hasSceneSaveData(sceneName) {

  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - verifica via sistema de handlers
    window.parent.postMessage({
      type: 'HAS_SCENE_DATA',
      sceneName: sceneName
    }, '*');
    return true;
  } else {
    return localStorage.getItem(`psx-scene-${sceneName}`) !== null;
  }
}

export function exportScene(sceneName) {

  if (window.parent && window.parent !== window) {
    // Estamos em um iframe - solicita via sistema de handlers
    window.parent.postMessage({
      type: 'EXPORT_SCENE',
      sceneName: sceneName
    }, '*');
    return true;
  } else {
    // Fallback para desenvolvimento
    const stored = localStorage.getItem(`psx-scene-${sceneName}`);
    if (stored) {
      const sceneData = JSON.parse(stored);
      const dataStr = JSON.stringify(sceneData, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

      const exportFileDefaultName = `${sceneName}.scene.json`;

      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();

      return true;
    } else {
      console.error(`❌ Cena '${sceneName}' não encontrada para exportação`);
      return false;
    }
  }
}

export function exportSceneToFile(sceneName) {
  const sceneData = saveProject();
  sceneData.meta.sceneName = sceneName;

  const dataStr = JSON.stringify(sceneData, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

  const exportFileDefaultName = `${sceneName}.scene.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();

}

export function importScene(fileContent) {
  try {

    if (window.parent && window.parent !== window) {
      // Estamos em um iframe - comunica via sistema de handlers
      window.parent.postMessage({
        type: 'IMPORT_SCENE',
        fileContent: fileContent
      }, '*');
      return true;
    } else {
      // Fallback para desenvolvimento
      const sceneData = JSON.parse(fileContent);

      if (!sceneData.meta || !sceneData.meta.sceneName) {
        throw new Error('Formato de arquivo inválido - meta.sceneName não encontrado');
      }

      const sceneName = sceneData.meta.sceneName;
      localStorage.setItem(`psx-scene-${sceneName}`, JSON.stringify(sceneData));
      return sceneName;
    }
  } catch (error) {
    console.error('❌ Erro ao importar cena:', error);
    return false;
  }
}

export function importSceneFromFile(file, callback) {
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const sceneData = JSON.parse(e.target.result);
      const sceneName = sceneData.meta.sceneName || 'imported_scene';

      // Salva a cena importada
      if (window.electron) {
        window.electron.saveSceneData(sceneName, sceneData);
      } else {
        localStorage.setItem(`psx-scene-${sceneName}`, JSON.stringify(sceneData));
      }


      if (callback) {
        callback(sceneName, sceneData);
      }
    } catch (error) {
      console.error('❌ Erro ao importar cena:', error);
      if (callback) {
        callback(null, null, error);
      }
    }
  };

  reader.readAsText(file);
}

// ==================== SISTEMA DE RECONSTRUÇÃO DE CENA ====================

// Função principal para extrair dados essenciais da cena
export function extractSceneEssentials() {

  const essentials = {
    version: "2.0",
    objects: [],
    environment: {
      background: null,
      fog: null,
      lights: []
    },
    camera: null,
    physics: {
      world: null,
      bodies: []
    }
  };

  // Extrair objetos
  scene.traverse((object) => {
    if (object.type === 'Scene') return;

    const objectData = extractObjectEssentials(object);
    if (objectData) {
      essentials.objects.push(objectData);
    }
  });

  // Extrair configurações do ambiente
  if (scene.background) {
    essentials.environment.background = {
      type: 'Color',
      value: scene.background.getHex ? scene.background.getHex() : scene.background
    };
  }

  if (scene.fog) {
    essentials.environment.fog = {
      type: scene.fog.constructor.name,
      color: scene.fog.color.getHex(),
      near: scene.fog.near,
      far: scene.fog.far,
      density: scene.fog.density
    };
  }

  // Extrair luzes
  scene.traverse((object) => {
    if (object.isLight) {
      const lightData = {
        type: object.type,
        name: object.name,
        position: object.position.toArray(),
        color: object.color.getHex(),
        intensity: object.intensity,
        castShadow: object.castShadow,
        shadow: object.shadow ? {
          mapSize: object.shadow.mapSize,
          camera: {
            near: object.shadow.camera.near,
            far: object.shadow.camera.far
          }
        } : null
      };

      // Propriedades específicas por tipo de luz
      if (object.type === 'DirectionalLight') {
        lightData.target = object.target.position.toArray();
        if (lightData.shadow) {
          lightData.shadow.camera.left = object.shadow.camera.left;
          lightData.shadow.camera.right = object.shadow.camera.right;
          lightData.shadow.camera.top = object.shadow.camera.top;
          lightData.shadow.camera.bottom = object.shadow.camera.bottom;
        }
      } else if (object.type === 'PointLight') {
        lightData.distance = object.distance;
        lightData.decay = object.decay;
      } else if (object.type === 'SpotLight') {
        lightData.distance = object.distance;
        lightData.angle = object.angle;
        lightData.penumbra = object.penumbra;
        lightData.target = object.target.position.toArray();
      }

      essentials.environment.lights.push(lightData);
    }
  });

  // Extrair câmera
  if (currentCamera) {
    essentials.camera = {
      type: currentCamera.type,
      position: currentCamera.position.toArray(),
      rotation: currentCamera.rotation.toArray(),
      fov: currentCamera.fov,
      near: currentCamera.near,
      far: currentCamera.far,
      zoom: currentCamera.zoom
    };
  }

  return essentials;
}

function extractObjectEssentials(object) {
  // Verificar se o objeto deve ser ignorado durante o salvamento
  if (shouldSkipObjectExtraction(object)) {
    return null;
  }

  try {
    const objectData = {
      name: object.name || 'unnamed',
      type: object.type,
      position: object.position.toArray(),
      rotation: object.rotation.toArray(),
      scale: object.scale.toArray(),
      visible: object.visible,
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow,
      userData: object.userData || {},
      uuid: object.uuid
    };

    // Informações de hierarquia
    if (object.parent && object.parent.type !== 'Scene') {
      objectData.parentName = object.parent.name;
      objectData.parentUUID = object.parent.uuid;
    }

    // Informações dos filhos
    if (object.children && object.children.length > 0) {
      objectData.children = [];
      object.children.forEach(child => {
        if (!shouldSkipObjectExtraction(child)) {
          objectData.children.push(child.name);
        }
      });
    }

    // DETECTAR MODELOS GLB - se o objeto ou seu pai tem userData.isLoadedModel, então é um modelo GLB
    const isPartOfGLBModel = (object.userData && object.userData.isLoadedModel) ||
      (object.parent && object.parent.userData && object.parent.userData.isLoadedModel);

    if (isPartOfGLBModel) {
      // Se é o root do modelo GLB (tem isLoadedModel no userData próprio)
      if (object.userData && object.userData.isLoadedModel) {
        objectData.isGLBModel = true;
        objectData.modelFile = object.userData.modelFile;
        objectData.materialType = object.userData.materialType || 'default';
        objectData.customProperties = object.userData.customProperties || {};
        objectData.preserveRotation = object.userData.preserveRotation || false;
      } else {
        // Se é filho de um modelo GLB, marcar para ser ignorado na reconstrução
        objectData.isGLBChild = true;
      }
    }

    // Dados específicos por tipo - apenas se NÃO for parte de modelo GLB
    if (object.isMesh && object.geometry && object.material && !isPartOfGLBModel) {
      try {
        objectData.geometry = extractGeometryParams(object.geometry);
        objectData.material = extractMaterialParams(object.material);
      } catch (meshError) {
        console.warn('⚠️ Erro ao extrair dados de mesh:', object.name, meshError);
      }
    } else if (object.isLight) {
      try {

        objectData.lightData = {
          color: object.color ? object.color.getHex() : 0xffffff,
          intensity: object.intensity || 1.0,
          castShadow: object.castShadow || false
        };

        // Propriedades específicas por tipo de luz
        if (object.distance !== undefined) objectData.lightData.distance = object.distance;
        if (object.decay !== undefined) objectData.lightData.decay = object.decay;
        if (object.angle !== undefined) objectData.lightData.angle = object.angle;
        if (object.penumbra !== undefined) objectData.lightData.penumbra = object.penumbra;
        if (object.groundColor) objectData.lightData.groundColor = object.groundColor.getHex();

        // Extrair dados de target para DirectionalLight e SpotLight
        if (object.target) {
          objectData.lightData.target = object.target.position.toArray();
        }

        // Extrair dados de sombra se disponível
        if (object.shadow) {
          objectData.lightData.shadow = {
            mapSize: {
              width: object.shadow.mapSize.width,
              height: object.shadow.mapSize.height
            },
            camera: {
              near: object.shadow.camera.near,
              far: object.shadow.camera.far
            }
          };

          // Para DirectionalLight, extrair propriedades específicas da câmera ortográfica
          if (object.shadow.camera.left !== undefined) {
            objectData.lightData.shadow.camera.left = object.shadow.camera.left;
            objectData.lightData.shadow.camera.right = object.shadow.camera.right;
            objectData.lightData.shadow.camera.top = object.shadow.camera.top;
            objectData.lightData.shadow.camera.bottom = object.shadow.camera.bottom;
          }

        }


      } catch (lightError) {
        console.warn('⚠️ Erro ao extrair dados de luz:', object.name, lightError);
      }
    } else if (object.isCamera) {
      try {
        objectData.cameraData = {
          fov: object.fov || 75,
          near: object.near || 0.1,
          far: object.far || 1000,
          zoom: object.zoom || 1
        };
      } catch (cameraError) {
        console.warn('⚠️ Erro ao extrair dados de câmera:', object.name, cameraError);
      }
    }

    // Física - Extrair todas as propriedades do objeto
    if (object.physicsBody || object.physicsEnabled) {
      try {
        objectData.physics = {};

        // Propriedades básicas do corpo físico
        if (object.physicsBody) {
          // Tipo de física (string, não número)
          objectData.physics.type = object.physicsType || 'box';
          objectData.physics.mass = object.physicsBody.mass || 1;
          objectData.physics.isKinematic = object.physicsBody.type === CANNON.Body.KINEMATIC;
          objectData.physics.isSensor = object.physicsBody.isTrigger || false;

          // Propriedades do material
          if (object.physicsBody.material) {
            objectData.physics.friction = object.physicsBody.material.friction;
            objectData.physics.restitution = object.physicsBody.material.restitution;
          }

          objectData.physics.linearDamping = object.physicsBody.linearDamping || 0.01;
          objectData.physics.angularDamping = object.physicsBody.angularDamping || 0.01;
        }

        // Propriedades configuradas no objeto (podem existir mesmo sem physicsBody)
        if (object.physicsEnabled !== undefined) objectData.physics.enabled = object.physicsEnabled;
        if (object.physicsType !== undefined) objectData.physics.type = object.physicsType;
        if (object.physicsMass !== undefined) objectData.physics.mass = object.physicsMass;
        if (object.physicsFriction !== undefined) objectData.physics.friction = object.physicsFriction;
        if (object.physicsRestitution !== undefined) objectData.physics.restitution = object.physicsRestitution;
        if (object.physicsLinearDamping !== undefined) objectData.physics.linearDamping = object.physicsLinearDamping;
        if (object.physicsAngularDamping !== undefined) objectData.physics.angularDamping = object.physicsAngularDamping;

        // Propriedades avançadas
        if (object.physicsIsKinematic !== undefined) objectData.physics.isKinematic = object.physicsIsKinematic;
        if (object.physicsIsSensor !== undefined) objectData.physics.isSensor = object.physicsIsSensor;
        if (object.physicsUseGravity !== undefined) objectData.physics.useGravity = object.physicsUseGravity;
        if (object.physicsGravityEnabled !== undefined) objectData.physics.gravityEnabled = object.physicsGravityEnabled;
        if (object.physicsCollisionEnabled !== undefined) objectData.physics.collisionEnabled = object.physicsCollisionEnabled;
        if (object.physicsFreezePosition !== undefined) objectData.physics.freezePosition = object.physicsFreezePosition;
        if (object.physicsFreezeRotation !== undefined) objectData.physics.freezeRotation = object.physicsFreezeRotation;

        // Propriedades específicas de mesh collider
        if (object.physicsMeshType !== undefined) objectData.physics.meshType = object.physicsMeshType;
        if (object.physicsMeshConvex !== undefined) objectData.physics.meshConvex = object.physicsMeshConvex;
        if (object.meshColliderConvex !== undefined) objectData.physics.meshConvex = object.meshColliderConvex;
        if (object.physicsMeshSimplify !== undefined) objectData.physics.meshSimplify = object.physicsMeshSimplify;

        // Tamanho, posição e rotação do colisor
        if (object.physicsSize !== undefined) objectData.physics.size = object.physicsSize;
        if (object.physicsOffset !== undefined) objectData.physics.offset = object.physicsOffset;
        if (object.physicsRotation !== undefined) objectData.physics.rotation = object.physicsRotation;

        // Propriedades de colisão
        if (object.physicsCollisionGroup !== undefined) objectData.physics.collisionGroup = object.physicsCollisionGroup;
        if (object.physicsCollisionMask !== undefined) objectData.physics.collisionMask = object.physicsCollisionMask;

        

      } catch (physicsError) {
        console.warn('⚠️ Erro ao extrair dados de física:', object.name, physicsError);
      }
    }

    return objectData;

  } catch (error) {
    console.error('❌ Erro ao extrair dados do objeto:', object.name, error);
    return null;
  }
}

function shouldSkipObjectExtraction(object) {
  // Lista completa de padrões para objetos que não devem ser salvos
  const skipPatterns = [
    // Gizmos e controles do editor
    'CustomGizmos',
    'TransformControls',
    'EditorCamera',
    'Helper',
    'Gizmo',
    'OutlinePass',
    'EditorHelper',
    'TranslateGizmo',
    'RotateGizmo',
    'ScaleGizmo',
    'Axis_',
    'Plane_',
    'Ring_',
    'UniformScale',
    'gizmo',
    'GizmoGroup',
    'GizmoContainer',
    'TransformGizmo',
    'ControlGizmo',
    'Manipulator',
    'Handle',
    'Control',
    'Widget',

    // Objetos de física que são criados automaticamente
    'Collider_',
    'Physics_',
    'RigidBody_',
    'Collision_',
    'PhysicsBody_',
    'MeshCollider_',
    'collider',
    'physics',
    'rigidbody',
    'collision',

    // Outlines e efeitos visuais do editor
    'Outline_',
    'Highlight_',
    'Selection_',
    'outline',
    'highlight',
    'selection',

    // Outros elementos do editor
    'Editor_',
    'Debug_',
    'Wireframe_',
    'BoundingBox_',
    'editor',
    'debug',
    'wireframe',
    'boundingbox',
    'bounding_box',

    // Elementos específicos do Three.js que não devem ser salvos
    'GridHelper',
    'AxesHelper',
    'BoxHelper',
    'SphereHelper',
    'ConeHelper',
    'CylinderHelper',
    'PlaneHelper',
    'ArrowHelper',
    'DirectionalLightHelper',
    'PointLightHelper',
    'SpotLightHelper',
    'HemisphereLightHelper',
    'RectAreaLightHelper',
    'SkeletonHelper',
    'BoneHelper',
    'CameraHelper',
    'FrustumHelper',
    'LensFlareHelper',
    'LightProbeHelper',
    'PolarGridHelper',
    'AxesGridHelper',
    'VertexNormalsHelper',
    'FaceNormalsHelper',
    'TangentHelper',
    'BinormalHelper',
    'PositionalAudioHelper',
    'AudioListenerHelper',
    'AudioHelper',
    'AudioAnalyserHelper',
    'AudioContextHelper',
    'AudioBufferHelper',
    'AudioBufferSourceHelper',
    'AudioDestinationHelper',
    'AudioGainHelper',
    'AudioPannerHelper',
    'AudioListenerHelper',
    'AudioContextHelper',
    'AudioAnalyserHelper',
    'AudioBufferHelper',
    'AudioBufferSourceHelper',
    'AudioDestinationHelper',
    'AudioGainHelper',
    'AudioPannerHelper'
  ];

  const objectName = object.name || '';
  const objectType = object.type || '';

  // Verificar padrões no nome
  for (const pattern of skipPatterns) {
    if (objectName.includes(pattern)) {
      return true;
    }
  }

  // Verificar se o nome do pai indica que é um gizmo
  if (object.parent && object.parent.name) {
    const parentName = object.parent.name;
    if (parentName.startsWith('Axis_') ||
      parentName.startsWith('Plane_') ||
      parentName.startsWith('Ring_') ||
      parentName.startsWith('Gizmo') ||
      parentName.startsWith('Transform') ||
      parentName.startsWith('Control') ||
      parentName.startsWith('Handle') ||
      parentName.startsWith('Manipulator') ||
      parentName.startsWith('Widget') ||
      parentName.startsWith('Helper') ||
      parentName.startsWith('Debug') ||
      parentName.startsWith('Outline') ||
      parentName.startsWith('Selection') ||
      parentName.startsWith('Collision') ||
      parentName.startsWith('Physics') ||
      parentName.includes('Gizmo') ||
      parentName.includes('Transform') ||
      parentName.includes('Control') ||
      parentName.includes('Handle') ||
      parentName.includes('Manipulator') ||
      parentName.includes('Widget') ||
      parentName.includes('Helper') ||
      parentName.includes('Debug') ||
      parentName.includes('Outline') ||
      parentName.includes('Selection') ||
      parentName.includes('Collision') ||
      parentName.includes('Physics')) {
      return true;
    }
  }

  // Verificar padrões no tipo
  for (const pattern of skipPatterns) {
    if (objectType.includes(pattern)) {
      return true;
    }
  }

  // Pular objetos com userData especial
  if (object.userData && object.userData.isEditorObject) {
    return true;
  }

  // Pular objetos com userData indicando que são gizmos
  if (object.userData && (
    object.userData.isGizmo ||
    object.userData.isEditorGizmo ||
    object.userData.isTransformControl ||
    object.userData.isManipulator ||
    object.userData.isHelper ||
    object.userData.isDebugObject ||
    object.userData.isEditorHelper ||
    object.userData.isOutlineObject ||
    object.userData.isSelectionObject ||
    object.userData.isPhysicsHelper ||
    object.userData.isCollisionHelper ||
    // Verificar tipos específicos de gizmos
    object.userData.type === 'axis' ||
    object.userData.type === 'plane' ||
    object.userData.type === 'ring' ||
    object.userData.type === 'arrow' ||
    object.userData.type === 'handle' ||
    object.userData.type === 'control' ||
    object.userData.type === 'gizmo' ||
    object.userData.type === 'manipulator' ||
    object.userData.type === 'widget' ||
    object.userData.type === 'helper' ||
    object.userData.type === 'debug' ||
    object.userData.type === 'outline' ||
    object.userData.type === 'selection' ||
    object.userData.type === 'collision' ||
    object.userData.type === 'physics'
  )) {
    return true;
  }

  // Pular objetos que são filhos de gizmos (verificação recursiva)
  function hasGizmoParent(obj) {
    if (!obj.parent) return false;

    // Verificar se o pai atual é gizmo
    const parentName = obj.parent.name || '';
    const parentType = obj.parent.type || '';
    const parentUserData = obj.parent.userData || {};

    // Verificar padrões no nome do pai
    for (const pattern of skipPatterns) {
      if (parentName.includes(pattern)) {
        return true;
      }
    }

    // Verificar userData do pai
    if (parentUserData.type === 'axis' ||
      parentUserData.type === 'plane' ||
      parentUserData.type === 'ring' ||
      parentUserData.type === 'arrow' ||
      parentUserData.type === 'handle' ||
      parentUserData.type === 'control' ||
      parentUserData.type === 'gizmo' ||
      parentUserData.type === 'manipulator' ||
      parentUserData.type === 'widget' ||
      parentUserData.type === 'helper' ||
      parentUserData.type === 'debug' ||
      parentUserData.type === 'outline' ||
      parentUserData.type === 'selection' ||
      parentUserData.type === 'collision' ||
      parentUserData.type === 'physics' ||
      parentUserData.isGizmo ||
      parentUserData.isEditorGizmo ||
      parentUserData.isTransformControl ||
      parentUserData.isManipulator ||
      parentUserData.isHelper ||
      parentUserData.isDebugObject ||
      parentUserData.isEditorHelper ||
      parentUserData.isOutlineObject ||
      parentUserData.isSelectionObject ||
      parentUserData.isPhysicsHelper ||
      parentUserData.isCollisionHelper) {
      return true;
    }

    // Verificar recursivamente o pai do pai
    return hasGizmoParent(obj.parent);
  }

  if (object.parent && hasGizmoParent(object)) {
    return true;
  }

  return false;
}

function extractGeometryParams(geometry) {
  const params = {
    type: geometry.type,
    parameters: {}
  };

  // Extrair parâmetros específicos da geometria
  if (geometry.parameters) {
    params.parameters = { ...geometry.parameters };
  }

  return params;
}

function extractMaterialParams(material) {
  if (!material) return null;

  const params = {
    type: material.type,
    color: material.color ? material.color.getHex() : 0xffffff,
    opacity: material.opacity,
    transparent: material.transparent,
    visible: material.visible
  };

  // Propriedades específicas do material
  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
    params.metalness = material.metalness;
    params.roughness = material.roughness;
    params.emissive = material.emissive ? material.emissive.getHex() : 0x000000;
    params.emissiveIntensity = material.emissiveIntensity;
  }

  // Salvar mapas de textura
  if (material.map) {
    params.map = material.map.name || material.map.image?.src?.split('/').pop();
    params.mapTiling = material.map.repeat ? material.map.repeat.toArray() : [1, 1];
    params.mapOffset = material.map.offset ? material.map.offset.toArray() : [0, 0];
  }
  if (material.normalMap) {
    params.normalMap = material.normalMap.name || material.normalMap.image?.src?.split('/').pop();
    params.normalMapTiling = material.normalMap.repeat ? material.normalMap.repeat.toArray() : [1, 1];
    params.normalMapOffset = material.normalMap.offset ? material.normalMap.offset.toArray() : [0, 0];
    params.normalScale = material.normalScale ? material.normalScale.toArray() : [1, 1];
  }
  if (material.roughnessMap) {
    params.roughnessMap = material.roughnessMap.name || material.roughnessMap.image?.src?.split('/').pop();
    params.roughnessMapTiling = material.roughnessMap.repeat ? material.roughnessMap.repeat.toArray() : [1, 1];
    params.roughnessMapOffset = material.roughnessMap.offset ? material.roughnessMap.offset.toArray() : [0, 0];
    params.roughnessMapIntensity = material.roughnessMapIntensity || 1.0;
  }
  if (material.metalnessMap) {
    params.metalnessMap = material.metalnessMap.name || material.metalnessMap.image?.src?.split('/').pop();
    params.metalnessMapTiling = material.metalnessMap.repeat ? material.metalnessMap.repeat.toArray() : [1, 1];
    params.metalnessMapOffset = material.metalnessMap.offset ? material.metalnessMap.offset.toArray() : [0, 0];
    params.metalnessMapIntensity = material.metalnessMapIntensity || 1.0;
  }
  if (material.aoMap) {
    params.aoMap = material.aoMap.name || material.aoMap.image?.src?.split('/').pop();
    params.aoMapTiling = material.aoMap.repeat ? material.aoMap.repeat.toArray() : [1, 1];
    params.aoMapOffset = material.aoMap.offset ? material.aoMap.offset.toArray() : [0, 0];
    params.aoMapIntensity = material.aoMapIntensity || 1.0;
  }
  if (material.emissiveMap) {
    params.emissiveMap = material.emissiveMap.name || material.emissiveMap.image?.src?.split('/').pop();
    params.emissiveMapTiling = material.emissiveMap.repeat ? material.emissiveMap.repeat.toArray() : [1, 1];
    params.emissiveMapOffset = material.emissiveMap.offset ? material.emissiveMap.offset.toArray() : [0, 0];
    params.emissiveMapIntensity = material.emissiveMapIntensity || 1.0;
  }

  return params;
}

// Função principal para reconstruir cena a partir dos dados essenciais
export async function reconstructSceneFromEssentials(sceneData) {

  try {
    // Limpar cena atual
    const objectsToRemove = [];
    scene.traverse((object) => {
      if (object.type !== 'Scene' && object.parent && object.parent.type === 'Scene') {
        objectsToRemove.push(object);
      }
    });

    objectsToRemove.forEach(obj => scene.remove(obj));

    // Recriar ambiente
    if (sceneData.environment) {
      await applyEnvironmentSettings(sceneData.environment);
    }

    // Separar objetos por hierarquia
    const rootObjects = [];
    const childObjects = [];
    const objectMap = new Map();

    // Classificar objetos
    for (const objectData of sceneData.objects) {
      // Log específico para luzes
      if (isLightType(objectData.type)) {
        
      }

      if (objectData.parentName) {
        childObjects.push(objectData);
      } else {
        rootObjects.push(objectData);
      }
    }
    
    for (const objectData of rootObjects) {
      try {
        const obj = await recreateObjectWithHierarchy(objectData);
        if (obj) {
          // ✅ CORREÇÃO: Não adicionar à cena novamente se já foi adicionado pelo instantiate
          if (!obj.parent) {
            scene.add(obj);
          }
          objectMap.set(objectData.name, obj);

          // ✅ CORREÇÃO: Só adicionar ao sceneObjects se não for um modelo GLB (que já foi adicionado pelo instantiate)
          const isGLBModel = (objectData.userData && objectData.userData.isLoadedModel && objectData.userData.modelFile) ||
            (objectData.userData && objectData.userData.modelFile && objectData.userData.modelFile.endsWith('.glb')) ||
            (objectData.userData && objectData.userData.modelFile && objectData.userData.modelFile.includes('.glb')) ||
            (objectData.modelFile && objectData.modelFile.endsWith('.glb')) ||
            (objectData.modelFile && objectData.modelFile.includes('.glb'));

          if (!isGLBModel) {
            // ✅ ADICIONAR AO ARRAY sceneObjects PARA COMPATIBILIDADE COM EDITOR (apenas para não-GLB)
            const sceneObject = {
              id: obj.uuid || Date.now().toString(),
              name: obj.name,
              gameObject: obj,
              type: obj.type || 'group',
              animator: null,
              physics: null,
              components: {},
              getGameObjectId: function () { return this.id; },
              getGameObjectName: function () { return this.name; },
              addComponent: function (name, component) {
                if (typeof component === 'function') {
                  this.components[name] = component.bind(this);
                }
              },
              removeComponent: function (name) {
                if (this.components[name]) {
                  delete this.components[name];
                }
              }
            };
            sceneObjects.push(sceneObject);

          }

          // ✅ DEFINIR parentUUID COMO null PARA OBJETOS ROOT (sem parent)
          obj.parentUUID = null;

        }
      } catch (error) {
        console.error('❌ Erro ao recriar root:', objectData.name, error);
      }
    }
    for (const objectData of childObjects) {
      try {
        const parentObj = objectMap.get(objectData.parentName);
        if (!parentObj) {
          console.warn(`⚠️ Pai não encontrado para: ${objectData.name} (pai: ${objectData.parentName})`);
          continue;
        }

        const childObj = await recreateObjectWithHierarchy(objectData);
        if (childObj) {
          parentObj.add(childObj);
          childObj.parentUUID = parentObj.uuid; // Definir parentUUID para compatibilidade com EditorMode
          objectMap.set(objectData.name, childObj);

          // ✅ CORREÇÃO: Criar animator no PARENT se o filho tem animações
          if (childObj.animations && childObj.animations.length > 0) {
            // Criar animator no PARENT
            parentObj.animations = childObj.animations;
            parentObj.animator = new THREE.AnimationMixer(parentObj);

            // Tocar todas as animações automaticamente no PARENT
            childObj.animations.forEach((clip) => {
              const action = parentObj.animator.clipAction(clip);
              action.setLoop(THREE.LoopRepeat);
              action.play();
            });

          }

          // ✅ CORREÇÃO: Só adicionar ao sceneObjects se não for um modelo GLB (que já foi adicionado pelo instantiate)
          const isGLBModel = (objectData.userData && objectData.userData.isLoadedModel && objectData.userData.modelFile) ||
            (objectData.userData && objectData.userData.modelFile && objectData.userData.modelFile.endsWith('.glb')) ||
            (objectData.userData && objectData.userData.modelFile && objectData.userData.modelFile.includes('.glb')) ||
            (objectData.modelFile && objectData.modelFile.endsWith('.glb')) ||
            (objectData.modelFile && objectData.modelFile.includes('.glb'));

          if (!isGLBModel) {
            // ✅ ADICIONAR AO ARRAY sceneObjects PARA COMPATIBILIDADE COM EDITOR (apenas para não-GLB)
            const sceneObject = {
              id: childObj.uuid || Date.now().toString(),
              name: childObj.name,
              gameObject: childObj,
              type: childObj.type || 'mesh',
              animator: null,
              physics: null,
              components: {},
              getGameObjectId: function () { return this.id; },
              getGameObjectName: function () { return this.name; },
              addComponent: function (name, component) {
                if (typeof component === 'function') {
                  this.components[name] = component.bind(this);
                }
              },
              removeComponent: function (name) {
                if (this.components[name]) {
                  delete this.components[name];
                }
              }
            };
            sceneObjects.push(sceneObject);

          }
        }
      } catch (error) {
        console.error('❌ Erro ao recriar filho:', objectData.name, error);
      }
    }

    // Aplicar câmera
    if (sceneData.camera && currentCamera) {
      currentCamera.position.fromArray(sceneData.camera.position);
      currentCamera.rotation.fromArray(sceneData.camera.rotation);
      currentCamera.fov = sceneData.camera.fov;
      currentCamera.near = sceneData.camera.near;
      currentCamera.far = sceneData.camera.far;
      currentCamera.zoom = sceneData.camera.zoom;
      currentCamera.updateProjectionMatrix();
    }

    createCustomGizmos();
    setupCustomGizmoInteractions();

    // ✅ SELECIONAR PRIMEIRO OBJETO DISPONÍVEL PARA MOSTRAR GIZMOS
    const loadedObjects = Array.from(objectMap.values());
    if (loadedObjects.length > 0) {
      const firstObject = loadedObjects[0];
      selectObject(firstObject);
    }

    return loadedObjects;

  } catch (error) {
    console.error('❌ Erro ao reconstruir cena:', error);
    throw error;
  }
}


async function applyEnvironmentSettings(envSettings) {

  // Background
  if (envSettings.background) {
    if (envSettings.background.type === 'Color') {
      scene.background = new THREE.Color(envSettings.background.value);
    }
  }

  // Fog
  if (envSettings.fog) {
    if (envSettings.fog.type === 'Fog') {
      scene.fog = new THREE.Fog(envSettings.fog.color, envSettings.fog.near, envSettings.fog.far);
    } else if (envSettings.fog.type === 'FogExp2') {
      scene.fog = new THREE.FogExp2(envSettings.fog.color, envSettings.fog.density);
    }
  }

  // Luzes
  for (const lightData of envSettings.lights) {
    const light = recreateLight(lightData);
    if (light) {
      scene.add(light);
    }
  }
}

async function recreateObjectWithHierarchy(objectData) {

  // Verificar se é um objeto que não deve ser recriado
  if (shouldSkipObjectRecreation(objectData)) {
    return null;
  }

  // PULAR FILHOS DE MODELOS GLB - serão recriados automaticamente quando o modelo pai for carregado
  if (objectData.isGLBChild) {
    return null;
  }

  try {
    // 1. MODELOS GLB - INSTANCIAR DIRETAMENTE
    if (objectData.isGLBModel && objectData.modelFile) {

      return new Promise((resolve, reject) => {
        LoadModelGLB(
          objectData.modelFile,
          { x: objectData.scale[0], y: objectData.scale[1], z: objectData.scale[2] },
          { x: objectData.position[0], y: objectData.position[1], z: objectData.position[2] },
          { x: objectData.rotation[0], y: objectData.rotation[1], z: objectData.rotation[2] },
          (loadedModel, animations) => {
            if (loadedModel) {
              loadedModel.name = objectData.name;
              loadedModel.uuid = objectData.uuid;
              loadedModel.visible = objectData.visible;
              loadedModel.castShadow = objectData.castShadow;
              loadedModel.receiveShadow = objectData.receiveShadow;
              loadedModel.userData = objectData.userData;

              // ✅ CORREÇÃO: Criar sceneObject manualmente para evitar duplicação
              const sceneObject = {
                id: loadedModel.uuid || Date.now().toString(),
                name: loadedModel.name,
                gameObject: loadedModel,
                type: loadedModel.type || 'group',
                animations: [],
                animator: null,
                physics: null,
                components: {},
                getGameObjectId: function () { return this.id; },
                getGameObjectName: function () { return this.name; },
                addComponent: function (name, component) {
                  if (typeof component === 'function') {
                    this.components[name] = component.bind(this);
                  }
                },
                removeComponent: function (name) {
                  if (this.components[name]) {
                    delete this.components[name];
                  }
                }
              };

              // ✅ CORREÇÃO: Usar o modelo carregado diretamente (já vem como grupo do arquivo salvo)
              // O animator será criado no PARENT, não aqui
              if (animations && animations.length > 0) {
                // Apenas armazenar as animações no modelo carregado
                loadedModel.animations = animations;

                sceneObject.gameObject = loadedModel;
                sceneObject.animations = animations;
                // sceneObject.animator será definido no PARENT
              } else {
                // Caso não tenha animações, fluxo padrão
                sceneObject.gameObject = loadedModel;
              }

              // ✅ SEMPRE adicionar à cena e ao sceneObjects
              scene.add(loadedModel);
              sceneObjects.push(sceneObject);

              // Aplicar física se disponível
              if (objectData.physics) {
                setTimeout(() => {
                  applyPhysicsToObject(loadedModel, objectData.physics);
                }, 100);
              }

              resolve(loadedModel);
            } else {
              console.error('❌ Falha ao instanciar modelo GLB:', objectData.modelFile);
              reject(new Error(`Falha ao carregar modelo: ${objectData.modelFile}`));
            }
          },
          objectData.materialType || 'default',
          objectData.customProperties || {},
          objectData.preserveRotation || false
        );
      });
    }

    // 2. LUZES
    if (isLightType(objectData.type)) {

      const light = recreateLight(objectData);
      if (light) {
        return light;
      } else {
        console.error('❌ Falha ao recriar luz na função recreateObjectWithHierarchy:', objectData.name);
      }
      return null;
    }

    // 3. MESHES
    if (objectData.geometry && objectData.geometry.type) {
      const mesh = await recreateMesh(objectData);
      if (mesh) {
        return mesh;
      }
      return null;
    }

    // 4. GRUPOS
    if (objectData.type === 'Group' || objectData.isGroup && objectData.isGLBModel === false) {
      const group = recreateGroup(objectData);
      return group;
    }

    // 5. OBJETOS GENÉRICOS
    const genericObject = recreateGenericObject(objectData);
    return genericObject;

  } catch (error) {
    console.error('❌ Erro ao recriar objeto hierárquico:', objectData.name, error);
    return null;
  }
}

function shouldSkipObjectRecreation(objectData) {
  // FILHOS DE MODELOS GLB devem ser ignorados - serão recriados automaticamente
  if (objectData.isGLBChild) {
    return true;
  }

  // Lista completa de padrões para objetos que não devem ser recriados
  const skipPatterns = [
    // Gizmos e controles do editor
    'CustomGizmos',
    'TransformControls',
    'EditorCamera',
    'Helper',
    'Gizmo',
    'OutlinePass',
    'EditorHelper',
    'TranslateGizmo',
    'RotateGizmo',
    'ScaleGizmo',
    'Axis_',
    'Plane_',
    'Ring_',
    'UniformScale',

    // Objetos de física que são criados automaticamente
    'Collider_',
    'Physics_',
    'RigidBody_',
    'Collision_',
    'PhysicsBody_',
    'MeshCollider_',

    // Outlines e efeitos visuais do editor
    'Outline_',
    'Highlight_',
    'Selection_',

    // Outros elementos do editor
    'Editor_',
    'Debug_',
    'Wireframe_',
    'BoundingBox_'
  ];

  const objectName = objectData.name || '';
  const objectType = objectData.type || '';

  // Verificar padrões no nome
  for (const pattern of skipPatterns) {
    if (objectName.includes(pattern)) {
      return true;
    }
  }

  // Verificar padrões no tipo
  for (const pattern of skipPatterns) {
    if (objectType.includes(pattern)) {
      return true;
    }
  }

  // Pular objetos com userData especial
  if (objectData.userData && objectData.userData.isEditorObject) {
    
    return true;
  }

  return false;
}

function isLightType(type) {
  const lightTypes = [
    'DirectionalLight',
    'PointLight',
    'SpotLight',
    'AmbientLight',
    'HemisphereLight',
    'RectAreaLight'
  ];

  return lightTypes.includes(type);
}

function recreateGroup(objectData) {

  const group = new THREE.Group();
  group.name = objectData.name || 'unnamed_group';

  // Garantir que arrays de transformação são válidos
  const position = Array.isArray(objectData.position) ? objectData.position : [0, 0, 0];
  const rotation = Array.isArray(objectData.rotation) ? objectData.rotation : [0, 0, 0];
  const scale = Array.isArray(objectData.scale) ? objectData.scale : [1, 1, 1];

  group.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
  group.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  group.scale.set(scale[0] || 1, scale[1] || 1, scale[2] || 1);
  group.visible = objectData.visible !== false; // default true
  group.userData = objectData.userData || {};

  // Aplicar física se disponível
  if (objectData.physics) {
    try {
      applyPhysicsToObject(group, objectData.physics);
    } catch (physicsError) {
      console.warn('⚠️ Erro ao aplicar física em grupo:', objectData.name, physicsError);
    }
  }

  return group;
}

function recreateGenericObject(objectData) {

  // Criar um Object3D genérico
  const object3D = new THREE.Object3D();
  object3D.name = objectData.name || 'unnamed_object';

  // Garantir que arrays de transformação são válidos
  const position = Array.isArray(objectData.position) ? objectData.position : [0, 0, 0];
  const rotation = Array.isArray(objectData.rotation) ? objectData.rotation : [0, 0, 0];
  const scale = Array.isArray(objectData.scale) ? objectData.scale : [1, 1, 1];

  object3D.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
  object3D.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  object3D.scale.set(scale[0] || 1, scale[1] || 1, scale[2] || 1);
  object3D.visible = objectData.visible !== false; // default true
  object3D.userData = objectData.userData || {};

  // Aplicar física se disponível
  if (objectData.physics) {
    try {
      applyPhysicsToObject(object3D, objectData.physics);
    } catch (physicsError) {
      console.warn('⚠️ Erro ao aplicar física em objeto genérico:', objectData.name, physicsError);
    }
  }

  return object3D;
}

async function recreateMesh(objectData) {

  try {
    // Validar dados necessários
    if (!objectData.geometry || !objectData.geometry.type) {
      console.warn('⚠️ Mesh sem geometria válida:', objectData.name);
      return null;
    }

    if (!objectData.material) {
      console.warn('⚠️ Mesh sem material válido:', objectData.name);
      return null;
    }

    // Recriar geometria e material
    const geometry = recreateGeometry(objectData.geometry.type, objectData.geometry.parameters || {});
    const material = recreateMaterial(objectData.material.type || 'MeshStandardMaterial', objectData.material);

    if (!geometry || !material) {
      console.warn('⚠️ Falha ao recriar geometria ou material para:', objectData.name);
      return null;
    }

    const mesh = new THREE.Mesh(geometry, material);

    // Aplicar propriedades básicas
    mesh.name = objectData.name || 'unnamed_mesh';

    // Garantir que arrays de transformação são válidos
    const position = Array.isArray(objectData.position) ? objectData.position : [0, 0, 0];
    const rotation = Array.isArray(objectData.rotation) ? objectData.rotation : [0, 0, 0];
    const scale = Array.isArray(objectData.scale) ? objectData.scale : [1, 1, 1];

    mesh.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
    mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    mesh.scale.set(scale[0] || 1, scale[1] || 1, scale[2] || 1);

    mesh.visible = objectData.visible !== false; // default true
    mesh.castShadow = objectData.castShadow || false;
    mesh.receiveShadow = objectData.receiveShadow || false;
    mesh.userData = objectData.userData || {};

    // Nota: Física será aplicada no grupo pai, não no mesh individual

    return mesh;

  } catch (error) {
    console.error('❌ Erro ao recriar mesh:', objectData.name, error);
    return null;
  }
}

function recreateGeometry(type, params) {
  try {
    // Garantir que params existe
    if (!params) params = {};

    switch (type) {
      case 'BoxGeometry':
        return new THREE.BoxGeometry(
          params.width || 1,
          params.height || 1,
          params.depth || 1,
          params.widthSegments || 1,
          params.heightSegments || 1,
          params.depthSegments || 1
        );
      case 'SphereGeometry':
        return new THREE.SphereGeometry(
          params.radius || 0.5,
          params.widthSegments || 32,
          params.heightSegments || 16,
          params.phiStart || 0,
          params.phiLength || Math.PI * 2,
          params.thetaStart || 0,
          params.thetaLength || Math.PI
        );
      case 'CylinderGeometry':
        return new THREE.CylinderGeometry(
          params.radiusTop || 1,
          params.radiusBottom || 1,
          params.height || 1,
          params.radialSegments || 32,
          params.heightSegments || 1,
          params.openEnded || false,
          params.thetaStart || 0,
          params.thetaLength || Math.PI * 2
        );
      case 'PlaneGeometry':
        return new THREE.PlaneGeometry(
          params.width || 1,
          params.height || 1,
          params.widthSegments || 1,
          params.heightSegments || 1
        );
      case 'ConeGeometry':
        return new THREE.ConeGeometry(
          params.radius || 1,
          params.height || 1,
          params.radialSegments || 32,
          params.heightSegments || 1,
          params.openEnded || false,
          params.thetaStart || 0,
          params.thetaLength || Math.PI * 2
        );
      case 'TorusGeometry':
        return new THREE.TorusGeometry(
          params.radius || 1,
          params.tube || 0.4,
          params.radialSegments || 16,
          params.tubularSegments || 100,
          params.arc || Math.PI * 2
        );
      default:
        console.warn('Tipo de geometria não suportado:', type, 'usando BoxGeometry');
        return new THREE.BoxGeometry(1, 1, 1);
    }
  } catch (error) {
    console.error('Erro ao recriar geometria:', type, error);
    return new THREE.BoxGeometry(1, 1, 1); // fallback
  }
}

function recreateMaterial(type, params) {
  try {
    // Validar parâmetros
    if (!params) {
      console.warn('⚠️ Parâmetros de material ausentes, usando padrão');
      params = {};
    }

    // Garantir que valores essenciais não são undefined
    const safeColor = params.color !== undefined ? params.color : 0xffffff;
    const safeOpacity = params.opacity !== undefined ? params.opacity : 1.0;
    const safeTransparent = params.transparent !== undefined ? params.transparent : false;
    const safeVisible = params.visible !== undefined ? params.visible : true;

    // Configuração básica do material
    const materialConfig = {
      color: safeColor,
      opacity: safeOpacity,
      transparent: safeTransparent,
      visible: safeVisible
    };

    // Propriedades específicas de material PBR (apenas se definidas)
    if (params.metalness !== undefined) materialConfig.metalness = params.metalness;
    if (params.roughness !== undefined) materialConfig.roughness = params.roughness;
    if (params.emissive !== undefined) materialConfig.emissive = params.emissive;
    if (params.emissiveIntensity !== undefined) materialConfig.emissiveIntensity = params.emissiveIntensity;

    // Propriedades adicionais (apenas se definidas)
    if (params.wireframe !== undefined) materialConfig.wireframe = params.wireframe;
    if (params.flatShading !== undefined) materialConfig.flatShading = params.flatShading;
    if (params.side !== undefined) materialConfig.side = params.side;

    // Criar material diretamente com Three.js para evitar problemas
    let material;

    switch (type) {
      case 'MeshStandardMaterial':
        material = new THREE.MeshStandardMaterial(materialConfig);
        break;
      case 'MeshBasicMaterial':
        material = new THREE.MeshBasicMaterial(materialConfig);
        break;
      case 'MeshPhongMaterial':
        material = new THREE.MeshPhongMaterial(materialConfig);
        break;
      case 'MeshLambertMaterial':
        material = new THREE.MeshLambertMaterial(materialConfig);
        break;
      default:
        console.warn('Tipo de material não reconhecido:', type, 'usando MeshStandardMaterial');
        material = new THREE.MeshStandardMaterial(materialConfig);
    }

    // Carregar texturas se especificadas
    if (params.map) {
      loadTexture(params.map).then(texture => {
        if (texture) {
          material.map = texture;
          // Aplicar tiling e offset
          if (params.mapTiling) {
            texture.repeat.set(params.mapTiling[0], params.mapTiling[1]);
          }
          if (params.mapOffset) {
            texture.offset.set(params.mapOffset[0], params.mapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura diffuse ${params.map}:`, error);
      });
    }
    if (params.normalMap) {
      loadTexture(params.normalMap).then(texture => {
        if (texture) {
          material.normalMap = texture;
          // Aplicar tiling e offset
          if (params.normalMapTiling) {
            texture.repeat.set(params.normalMapTiling[0], params.normalMapTiling[1]);
          }
          if (params.normalMapOffset) {
            texture.offset.set(params.normalMapOffset[0], params.normalMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de normal
          if (params.normalScale) {
            material.normalScale.set(params.normalScale[0], params.normalScale[1]);
          }
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura normal ${params.normalMap}:`, error);
      });
    }
    if (params.roughnessMap) {
      loadTexture(params.roughnessMap).then(texture => {
        if (texture) {
          material.roughnessMap = texture;
          // Aplicar tiling e offset
          if (params.roughnessMapTiling) {
            texture.repeat.set(params.roughnessMapTiling[0], params.roughnessMapTiling[1]);
          }
          if (params.roughnessMapOffset) {
            texture.offset.set(params.roughnessMapOffset[0], params.roughnessMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de roughness
          if (params.roughnessMapIntensity !== undefined) {
            material.roughnessMapIntensity = params.roughnessMapIntensity;
          }
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura roughness ${params.roughnessMap}:`, error);
      });
    }
    if (params.metalnessMap) {
      loadTexture(params.metalnessMap).then(texture => {
        if (texture) {
          material.metalnessMap = texture;
          // Aplicar tiling e offset
          if (params.metalnessMapTiling) {
            texture.repeat.set(params.metalnessMapTiling[0], params.metalnessMapTiling[1]);
          }
          if (params.metalnessMapOffset) {
            texture.offset.set(params.metalnessMapOffset[0], params.metalnessMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de metalness
          if (params.metalnessMapIntensity !== undefined) {
            material.metalnessMapIntensity = params.metalnessMapIntensity;
          }
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura metalness ${params.metalnessMap}:`, error);
      });
    }
    if (params.aoMap) {
      loadTexture(params.aoMap).then(texture => {
        if (texture) {
          material.aoMap = texture;
          // Aplicar tiling e offset
          if (params.aoMapTiling) {
            texture.repeat.set(params.aoMapTiling[0], params.aoMapTiling[1]);
          }
          if (params.aoMapOffset) {
            texture.offset.set(params.aoMapOffset[0], params.aoMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de AO
          if (params.aoMapIntensity !== undefined) {
            material.aoMapIntensity = params.aoMapIntensity;
          }
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura AO ${params.aoMap}:`, error);
      });
    }
    if (params.emissiveMap) {
      loadTexture(params.emissiveMap).then(texture => {
        if (texture) {
          material.emissiveMap = texture;
          // Aplicar tiling e offset
          if (params.emissiveMapTiling) {
            texture.repeat.set(params.emissiveMapTiling[0], params.emissiveMapTiling[1]);
          }
          if (params.emissiveMapOffset) {
            texture.offset.set(params.emissiveMapOffset[0], params.emissiveMapOffset[1]);
          }
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          // Aplicar intensidade de emissive
          if (params.emissiveMapIntensity !== undefined) {
            material.emissiveMapIntensity = params.emissiveMapIntensity;
          }
          material.needsUpdate = true;
        }
      }).catch(error => {
        console.error(`❌ Erro ao carregar textura emissive ${params.emissiveMap}:`, error);
      });
    }

    return material;

  } catch (error) {
    console.error('❌ Erro ao recriar material:', error);
    console.warn('Usando material de fallback');
    return new THREE.MeshStandardMaterial({ color: 0xffffff });
  }
}

function recreateLight(objectData) {

  // Extrair dados da luz (podem estar em lightData ou diretamente no objectData)
  const lightInfo = objectData.lightData || objectData;
  const lightType = objectData.type;

  // Valores padrão para luzes
  const color = lightInfo.color || 0xffffff;
  const intensity = lightInfo.intensity || 1.0;

  let light;

  try {
    switch (lightType) {
      case 'DirectionalLight':
        light = new THREE.DirectionalLight(color, intensity);
        if (lightInfo.target) {
          light.target.position.fromArray(lightInfo.target);
          scene.add(light.target); // IMPORTANTE: Adicionar target à cena
        }
        break;
      case 'PointLight':
        light = new THREE.PointLight(color, intensity, lightInfo.distance || 0, lightInfo.decay || 1);
        break;
      case 'SpotLight':
        light = new THREE.SpotLight(
          color,
          intensity,
          lightInfo.distance || 0,
          lightInfo.angle || Math.PI / 3,
          lightInfo.penumbra || 0
        );
        if (lightInfo.target) {
          light.target.position.fromArray(lightInfo.target);
          scene.add(light.target); // IMPORTANTE: Adicionar target à cena
        }
        break;
      case 'AmbientLight':
        light = new THREE.AmbientLight(color, intensity);
        break;
      case 'HemisphereLight':
        light = new THREE.HemisphereLight(color, lightInfo.groundColor || 0x444444, intensity);
        break;
      default:
        console.warn('⚠️ Tipo de luz não suportado:', lightType);
        return null;
    }

    if (light) {
      // Aplicar propriedades básicas
      light.name = objectData.name;

      // Garantir que arrays de transformação são válidos
      const position = Array.isArray(objectData.position) ? objectData.position : [0, 0, 0];
      const rotation = Array.isArray(objectData.rotation) ? objectData.rotation : [0, 0, 0];
      const scale = Array.isArray(objectData.scale) ? objectData.scale : [1, 1, 1];

      light.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
      light.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      light.scale.set(scale[0] || 1, scale[1] || 1, scale[2] || 1);

      light.visible = objectData.visible !== false; // default true
      light.castShadow = objectData.castShadow || lightInfo.castShadow || false;
      light.userData = objectData.userData || {};

      // Configurar sombras se disponível
      if (lightInfo.shadow && light.shadow) {
        try {
          light.shadow.mapSize.width = lightInfo.shadow.mapSize?.width || 2048;
          light.shadow.mapSize.height = lightInfo.shadow.mapSize?.height || 2048;
          light.shadow.camera.near = lightInfo.shadow.camera?.near || 0.5;
          light.shadow.camera.far = lightInfo.shadow.camera?.far || 500;

          if (lightInfo.shadow.camera?.left !== undefined) {
            light.shadow.camera.left = lightInfo.shadow.camera.left;
            light.shadow.camera.right = lightInfo.shadow.camera.right;
            light.shadow.camera.top = lightInfo.shadow.camera.top;
            light.shadow.camera.bottom = lightInfo.shadow.camera.bottom;
          }

        } catch (shadowError) {
          console.warn('⚠️ Erro ao configurar sombras para:', objectData.name, shadowError);
        }
      }

      // IMPORTANTE: Adicionar luz à cena
      scene.add(light);

      // ✅ CRIAR HELPER PARA A LUZ
      try {
        let helper;

        switch (lightType) {
          case 'DirectionalLight':
            helper = new THREE.DirectionalLightHelper(light, 5);
            break;
          case 'PointLight':
            helper = new THREE.PointLightHelper(light, 0.5);
            break;
          case 'SpotLight':
            helper = new THREE.SpotLightHelper(light);
            break;
          case 'AmbientLight':
            // AmbientLight não tem helper visual
            break;
          case 'HemisphereLight':
            helper = new THREE.HemisphereLightHelper(light, 5);
            break;
          default:
            console.warn('⚠️ Tipo de luz não suportado para helper:', lightType);
            break;
        }

        if (helper) {
          helper.name = `${objectData.name}_Helper`;
          helper.userData = {
            isLightHelper: true,
            parentLight: light.name,
            type: 'LightHelper'
          };
          scene.add(helper);
        }

      } catch (helperError) {
        console.warn('⚠️ Erro ao criar helper para luz:', objectData.name, helperError);
      }
    }

    return light;

  } catch (error) {
    console.error('❌ Erro ao recriar luz:', objectData.name, error);
    return null;
  }
}

function applyPhysicsToObject(object, physicsData) {

  try {
    // Configurar propriedades básicas
    object.physicsEnabled = physicsData.enabled !== false; // default true
    object.physicsType = physicsData.type || 'box';
    object.physicsMass = physicsData.mass || 1;
    object.physicsFriction = physicsData.friction !== undefined ? physicsData.friction : 0.4;
    object.physicsRestitution = physicsData.restitution !== undefined ? physicsData.restitution : 0.3;
    object.physicsLinearDamping = physicsData.linearDamping !== undefined ? physicsData.linearDamping : 0.01;
    object.physicsAngularDamping = physicsData.angularDamping !== undefined ? physicsData.angularDamping : 0.01;

    // Configurar propriedades avançadas
    if (physicsData.isKinematic !== undefined) {
      object.physicsIsKinematic = physicsData.isKinematic;
      // IMPORTANTE: createPhysicsBody usa physicsGravityEnabled para determinar kinematic
      object.physicsGravityEnabled = !physicsData.isKinematic;
    }
    if (physicsData.isSensor !== undefined) object.physicsIsSensor = physicsData.isSensor;
    if (physicsData.useGravity !== undefined) {
      object.physicsUseGravity = physicsData.useGravity;
      object.physicsGravityEnabled = physicsData.useGravity;
    }
    if (physicsData.gravityEnabled !== undefined) {
      object.physicsGravityEnabled = physicsData.gravityEnabled;
    }
    if (physicsData.collisionEnabled !== undefined) {
      object.physicsCollisionEnabled = physicsData.collisionEnabled;
    }
    if (physicsData.freezePosition !== undefined) object.physicsFreezePosition = physicsData.freezePosition;
    if (physicsData.freezeRotation !== undefined) object.physicsFreezeRotation = physicsData.freezeRotation;

    // Configurar propriedades específicas de mesh collider
    if (physicsData.meshType !== undefined) object.physicsMeshType = physicsData.meshType;
    if (physicsData.meshConvex !== undefined) {
      object.physicsMeshConvex = physicsData.meshConvex;
      object.meshColliderConvex = physicsData.meshConvex; // compatibilidade
    }
    if (physicsData.meshSimplify !== undefined) object.physicsMeshSimplify = physicsData.meshSimplify;

    // Configurar tamanho, posição e rotação do colisor
    if (physicsData.size !== undefined) object.physicsSize = physicsData.size;
    if (physicsData.offset !== undefined) object.physicsOffset = physicsData.offset;
    if (physicsData.rotation !== undefined) object.physicsRotation = physicsData.rotation;

    // Configurar propriedades de colisão
    if (physicsData.collisionGroup !== undefined) object.physicsCollisionGroup = physicsData.collisionGroup;
    if (physicsData.collisionMask !== undefined) object.physicsCollisionMask = physicsData.collisionMask;

    // Usar o sistema de física existente e testado
    const physicsBody = createPhysicsBody(object);

    if (physicsBody) {
      // Aplicar propriedades específicas pós-criação
      if (physicsData.isSensor) {
        // Configurar como sensor/trigger
        physicsBody.isTrigger = true;
      }

      // Nota: Kinematic e gravidade são configurados automaticamente pelo createPhysicsBody
      // baseado em physicsGravityEnabled que foi configurado acima


      // Debug específico para kinematic
      if (physicsData.isKinematic && physicsBody.type !== CANNON.Body.KINEMATIC) {
        console.warn('⚠️ PROBLEMA: Objeto deveria ser kinematic mas não é!', {
          name: object.name,
          expectedKinematic: true,
          actualType: physicsBody.type,
          kinematicType: CANNON.Body.KINEMATIC
        });
      }

      return physicsBody;
    } else {
      console.warn('⚠️ Falha ao criar corpo físico para:', object.name);
      return null;
    }

  } catch (error) {
    console.error('❌ Erro ao aplicar física:', error);
    return null;
  }
}
