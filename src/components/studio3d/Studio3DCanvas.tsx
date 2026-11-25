import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  LightingMood3D,
  MapConfig,
  MapLoadStatus,
  RunnerConfig,
  Studio3DTrack,
} from '../../types/studio3d';
import {
  buildGroundedRoutePath,
  sampleGroundedRouteAtProgress,
} from '../../utils/studio3dGpsEngine';
import { resolveEffectiveCameraMode } from '../../utils/studio3dRunnerHelpers';
import { CustomGlbRunner3D, type CustomGlbStatus } from './CustomGlbRunner3D';
import { RealisticRunner3D } from './RealisticRunner3D';
import { TerrainMap3D } from './TerrainMap3D';

interface Studio3DCanvasProps {
  track: Studio3DTrack;
  runner: RunnerConfig;
  mapConfig: MapConfig;
  timelineProgress: number;
  isPlaying: boolean;
  includeFinishPose: boolean;
  currentCadence: number;
  currentPaceSec: number;
  mapReloadNonce: number;
  onMapLoadStatus?: (status: MapLoadStatus) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onMapCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onCustomModelStatus?: (status: CustomGlbStatus) => void;
}

interface MoodPalette {
  keyColor: string;
  keyIntensity: number;
  keyPos: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  rimColor: string;
  rimIntensity: number;
}

function resolveLightingMood(
  mood: LightingMood3D,
  mapStyle: MapConfig['mapStyle'],
): Exclude<LightingMood3D, 'auto'> {
  if (mood !== 'auto') return mood;
  if (mapStyle === 'dark') return 'night-run';
  return 'city-park';
}

const MOOD_PALETTES: Record<Exclude<LightingMood3D, 'auto'>, MoodPalette> = {
  morning: {
    keyColor: '#FFF7ED',
    keyIntensity: 2.05,
    keyPos: [160, 220, 120],
    hemiSky: '#E0F2FE',
    hemiGround: '#86EFAC',
    hemiIntensity: 0.78,
    rimColor: '#FDE68A',
    rimIntensity: 0.7,
  },
  evening: {
    keyColor: '#FB923C',
    keyIntensity: 1.95,
    keyPos: [-220, 95, 140],
    hemiSky: '#FDBA74',
    hemiGround: '#431407',
    hemiIntensity: 0.65,
    rimColor: '#F97316',
    rimIntensity: 0.9,
  },
  night: {
    keyColor: '#93C5FD',
    keyIntensity: 1.25,
    keyPos: [120, 200, -140],
    hemiSky: '#1E3A8A',
    hemiGround: '#020617',
    hemiIntensity: 0.55,
    rimColor: '#38BDF8',
    rimIntensity: 1.45,
  },
  'city-park': {
    keyColor: '#FFFBEB',
    keyIntensity: 1.95,
    keyPos: [140, 240, 150],
    hemiSky: '#DBEAFE',
    hemiGround: '#94A3B8',
    hemiIntensity: 0.85,
    rimColor: '#BAE6FD',
    rimIntensity: 0.65,
  },
  mountain: {
    keyColor: '#F8FAFC',
    keyIntensity: 2.05,
    keyPos: [180, 210, -110],
    hemiSky: '#E0F2FE',
    hemiGround: '#475569',
    hemiIntensity: 0.76,
    rimColor: '#38BDF8',
    rimIntensity: 0.65,
  },
  'night-run': {
    keyColor: '#60A5FA',
    keyIntensity: 1.25,
    keyPos: [100, 190, 130],
    hemiSky: '#1E1B4B',
    hemiGround: '#020617',
    hemiIntensity: 0.58,
    rimColor: '#F97316',
    rimIntensity: 1.55,
  },
};

function detectSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
    return (
      renderer.includes('swiftshader') ||
      renderer.includes('llvmpipe') ||
      renderer.includes('software')
    );
  } catch {
    return false;
  }
}

class WebGLErrorBoundary extends Component<
  { children: React.ReactNode; onErrorFallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onErrorFallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.onErrorFallback ?? (
          <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-300 text-xs p-6 text-center">
            WebGL 3D belum tersedia di perangkat ini.
          </div>
        )
      );
    }
    return this.props.children;
  }
}

const SceneContent: React.FC<
  Studio3DCanvasProps & { mapContainer: HTMLDivElement | null }
> = ({
  track,
  runner,
  mapConfig,
  timelineProgress,
  isPlaying,
  includeFinishPose,
  currentCadence,
  currentPaceSec,
  mapReloadNonce,
  mapContainer,
  onMapLoadStatus,
  onCanvasReady,
  onMapCanvasReady,
  onCustomModelStatus,
}) => {
  const { gl, scene, camera } = useThree();
  const keyLightRef = useRef<THREE.DirectionalLight>(null);

  const resolvedMood = resolveLightingMood(mapConfig.lightingMood, mapConfig.mapStyle);
  const mood = MOOD_PALETTES[resolvedMood];
  const isNightMood = resolvedMood === 'night' || resolvedMood === 'night-run';

  useEffect(() => {
    onCanvasReady?.(gl.domElement);
    return () => onCanvasReady?.(null);
  }, [gl, onCanvasReady]);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    return () => {
      scene.environment = null;
      envTarget.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  const groundedPath = useMemo(
    () => buildGroundedRoutePath(track.points, () => 0, { heightOffsetM: 0.08 }),
    [track],
  );

  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const routeProgress = THREE.MathUtils.clamp(timelineProgress / finishThreshold, 0, 1);
  const isFinishPhase =
    mapConfig.cameraMode === 'finish-pose' ||
    (includeFinishPose && timelineProgress >= finishThreshold);

  const characterSizeFactor =
    runner.characterSize === 'small'
      ? 0.48
      : runner.characterSize === 'large'
        ? 1.05
        : 0.72;

  // Skala atlet proporsional terhadap ketinggian kamera drone agar selalu jelas terlihat
  const runnerScale = useMemo(
    () => Math.max(3.2, Math.min(26.0, track.spanMeters * 0.0095 * characterSizeFactor)),
    [track.spanMeters, characterSizeFactor],
  );

  const { runnerPos, rawRunnerYaw, slopePitchRad } = useMemo(() => {
    const sampled = sampleGroundedRouteAtProgress(groundedPath, routeProgress);
    let pitch = 0;
    const pts = track.points;
    if (pts && pts.length >= 3) {
      const idx = Math.min(pts.length - 1, Math.max(0, Math.round(routeProgress * (pts.length - 1))));
      const prevIdx = Math.max(0, idx - 2);
      const nextIdx = Math.min(pts.length - 1, idx + 2);
      const dDistM = Math.max(2, (pts[nextIdx].distanceKm - pts[prevIdx].distanceKm) * 1000);
      const dElevM = (pts[nextIdx].elevationM ?? 0) - (pts[prevIdx].elevationM ?? 0);
      const grade = THREE.MathUtils.clamp(dElevM / dDistM, -0.25, 0.25);
      // Positif = condong ke depan saat menanjak, negatif = menahan saat turunan
      pitch = THREE.MathUtils.clamp(grade * 0.65, -0.14, 0.16);
    }
    return { runnerPos: sampled.position, rawRunnerYaw: sampled.yawRad, slopePitchRad: pitch };
  }, [groundedPath, routeProgress, track.points]);

  const smoothYawRef = useRef<number>(rawRunnerYaw);
  const rimLightRef = useRef<THREE.DirectionalLight>(null);

  const effectiveRunnerConfig = useMemo<RunnerConfig>(() => {
    if (runner.characterStyle === 'trail-pro') {
      return {
        ...runner,
        accessory: runner.accessory === 'none' ? 'trail-vest' : runner.accessory,
      };
    }
    return runner;
  }, [runner]);

  const camTargetPosRef = useRef(new THREE.Vector3());
  const camLookTargetRef = useRef(new THREE.Vector3());
  const smoothLookAtRef = useRef(new THREE.Vector3(runnerPos.x, runnerPos.y, runnerPos.z));
  const initializedCamRef = useRef(false);
  const prevScrubProgressRef = useRef(timelineProgress);
  const prevModeRef = useRef(mapConfig.cameraMode);
  const prevBuildings3dRef = useRef(mapConfig.buildings3d);

  useEffect(() => {
    initializedCamRef.current = false;
  }, [track.id]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);

    // Shortest-angle exponential damper agar zig-zag titik GPS tidak bikin avatar & kamera getar
    if (!initializedCamRef.current || (!isPlaying && Math.abs(timelineProgress - prevScrubProgressRef.current) > 0.02)) {
      smoothYawRef.current = rawRunnerYaw;
    } else {
      let diff = rawRunnerYaw - smoothYawRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      smoothYawRef.current += diff * (1 - Math.exp(-7.8 * dt));
    }
    const effectiveMode = resolveEffectiveCameraMode(
      mapConfig.cameraMode,
      timelineProgress,
      isFinishPhase,
    );

    const zoom = THREE.MathUtils.clamp(mapConfig.cameraZoom ?? 1.0, 0.5, 2.5);
    const visualHeight = Math.max(12, runnerScale * 1.9);

    const overviewHeight = Math.max(150, Math.min(820, track.spanMeters * 0.62)) * zoom;
    const overviewDist = Math.max(120, Math.min(640, track.spanMeters * 0.48)) * zoom;
    const droneHeight = Math.max(36, Math.min(92, track.spanMeters * 0.048)) * zoom;
    const droneBackDist = droneHeight * 0.72;

    if (!mapConfig.buildings3d && effectiveMode !== 'finish-pose') {
      // Mode 3D OFF -> Kamera top-down 2D datar di atas pelari
      const flatHeight =
        (effectiveMode === 'overview'
          ? overviewHeight
          : Math.max(68, Math.min(180, track.spanMeters * 0.095))) * zoom;
      camTargetPosRef.current.set(
        effectiveMode === 'overview' ? 0 : runnerPos.x,
        flatHeight,
        (effectiveMode === 'overview' ? 0 : runnerPos.z) + 0.5,
      );
      camLookTargetRef.current.set(
        effectiveMode === 'overview' ? 0 : runnerPos.x,
        0,
        effectiveMode === 'overview' ? 0 : runnerPos.z,
      );
    } else if (effectiveMode === 'overview') {
      const orbitAngle =
        mapConfig.cameraMode === 'auto'
          ? -0.45 + (timelineProgress / 0.08) * 0.35
          : state.clock.elapsedTime * 0.08;
      camTargetPosRef.current.set(
        Math.sin(orbitAngle) * overviewDist,
        overviewHeight,
        Math.cos(orbitAngle) * overviewDist,
      );
      camLookTargetRef.current.set(0, 0, 0);
    } else if (effectiveMode === 'follow-chase') {
      const chaseHeight = Math.max(24, visualHeight * 2.4) * zoom;
      const chaseBackDist = chaseHeight * 1.15;
      const trailAngle = smoothYawRef.current + Math.PI * 0.94;
      const camX = runnerPos.x + Math.sin(trailAngle) * chaseBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * chaseBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + chaseHeight, 8), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(smoothYawRef.current) * (runnerScale * 2.8),
        runnerPos.y + runnerScale * 0.95,
        runnerPos.z + Math.cos(smoothYawRef.current) * (runnerScale * 2.8),
      );
    } else if (effectiveMode === 'birds-eye') {
      const birdsHeight =
        Math.max(85, Math.min(240, Math.max(visualHeight * 8.5, track.spanMeters * 0.12))) * zoom;
      const birdsBackDist = birdsHeight * 0.24;
      const trailAngle = smoothYawRef.current + Math.PI * 0.92;
      const camX = runnerPos.x + Math.sin(trailAngle) * birdsBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * birdsBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + birdsHeight, 12), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(smoothYawRef.current) * (runnerScale * 1.8),
        runnerPos.y + runnerScale * 0.6,
        runnerPos.z + Math.cos(smoothYawRef.current) * (runnerScale * 1.8),
      );
    } else if (effectiveMode === 'drone-180') {
      const orbitSweep =
        Math.sin(timelineProgress * Math.PI * 2.5 + state.clock.elapsedTime * 0.22) *
        (Math.PI * 0.5);
      const orbitAngle = smoothYawRef.current + Math.PI * 0.5 + orbitSweep;
      const orbitDist = Math.max(visualHeight * 2.8, Math.min(68, track.spanMeters * 0.042)) * zoom;
      const orbitHeight = Math.max(visualHeight * 1.8, Math.min(38, track.spanMeters * 0.025)) * zoom;
      const camX = runnerPos.x + Math.sin(orbitAngle) * orbitDist;
      const camZ = runnerPos.z + Math.cos(orbitAngle) * orbitDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + orbitHeight, 6), camZ);
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 1.0, runnerPos.z);
    } else if (effectiveMode === 'follow-20m') {
      const baseAngle =
        mapConfig.camera20mAngle === 'front'
          ? smoothYawRef.current
          : mapConfig.camera20mAngle === 'side'
            ? smoothYawRef.current + Math.PI * 0.5
            : mapConfig.camera20mAngle === 'orbit'
              ? smoothYawRef.current + Math.PI + timelineProgress * Math.PI * 4 + state.clock.elapsedTime * 0.45
              : smoothYawRef.current + Math.PI;
      const horizDist = Math.max(28, visualHeight * 3.4) * zoom;
      const aerialHeight = Math.max(22, visualHeight * 2.8) * zoom;
      const camX = runnerPos.x + Math.sin(baseAngle) * horizDist;
      const camZ = runnerPos.z + Math.cos(baseAngle) * horizDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + aerialHeight, 8), camZ);
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 0.9, runnerPos.z);
    } else if (effectiveMode === 'finish-pose') {
      const finishZoom = THREE.MathUtils.clamp(zoom, 0.75, 1.55);
      // Orbit 360 derajat penuh mengelilingi pelari slow-motion selama fase finish
      const finishSpan = Math.max(0.04, 1 - finishThreshold);
      const finishRatio = THREE.MathUtils.clamp((timelineProgress - finishThreshold) / finishSpan, 0, 1);
      const orbitAngle =
        mapConfig.cameraMode === 'finish-pose'
          ? smoothYawRef.current + state.clock.elapsedTime * 0.65
          : smoothYawRef.current + Math.PI * 0.75 + finishRatio * Math.PI * 2;
      const heroDist = runnerScale * 4.8 * finishZoom;
      const heroHeight = runnerScale * 1.48 * finishZoom;
      camTargetPosRef.current.set(
        runnerPos.x + Math.sin(orbitAngle) * heroDist,
        runnerPos.y + heroHeight,
        runnerPos.z + Math.cos(orbitAngle) * heroDist,
      );
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 1.05, runnerPos.z);
    } else {
      const trailAngle = smoothYawRef.current + Math.PI * 0.88;
      const camX = runnerPos.x + Math.sin(trailAngle) * droneBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * droneBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + droneHeight, 8), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(smoothYawRef.current) * (runnerScale * 1.8),
        runnerPos.y + runnerScale * 0.9,
        runnerPos.z + Math.cos(smoothYawRef.current) * (runnerScale * 1.8),
      );
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov =
        effectiveMode === 'follow-20m' || effectiveMode === 'birds-eye' ? 52 : 45;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4.5, dt);
        camera.updateProjectionMatrix();
      }
    }

    const jumpedWhilePaused =
      !isPlaying &&
      (Math.abs(timelineProgress - prevScrubProgressRef.current) > 0.08 ||
        mapConfig.cameraMode !== prevModeRef.current ||
        mapConfig.buildings3d !== prevBuildings3dRef.current);
    prevScrubProgressRef.current = timelineProgress;
    prevModeRef.current = mapConfig.cameraMode;
    prevBuildings3dRef.current = mapConfig.buildings3d;

    if (!initializedCamRef.current || jumpedWhilePaused) {
      camera.position.copy(camTargetPosRef.current);
      smoothLookAtRef.current.copy(camLookTargetRef.current);
      camera.lookAt(smoothLookAtRef.current);
      initializedCamRef.current = true;
    } else {
      const lambda =
        effectiveMode === 'overview'
          ? 4.5
          : effectiveMode === 'finish-pose'
            ? 5.2
            : 11.5;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetPosRef.current.x, lambda, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetPosRef.current.y, lambda, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, camTargetPosRef.current.z, lambda, dt);

      smoothLookAtRef.current.x = THREE.MathUtils.damp(smoothLookAtRef.current.x, camLookTargetRef.current.x, lambda + 3.5, dt);
      smoothLookAtRef.current.y = THREE.MathUtils.damp(smoothLookAtRef.current.y, camLookTargetRef.current.y, lambda + 3.5, dt);
      smoothLookAtRef.current.z = THREE.MathUtils.damp(smoothLookAtRef.current.z, camLookTargetRef.current.z, lambda + 3.5, dt);
      camera.lookAt(smoothLookAtRef.current);
    }

    if (keyLightRef.current) {
      keyLightRef.current.position.set(
        runnerPos.x + mood.keyPos[0] * 0.55,
        runnerPos.y + mood.keyPos[1] * 0.55,
        runnerPos.z + mood.keyPos[2] * 0.55,
      );
      keyLightRef.current.target.position.copy(runnerPos);
      keyLightRef.current.target.updateMatrixWorld();
    }
    if (rimLightRef.current) {
      const backAngle = smoothYawRef.current + Math.PI;
      rimLightRef.current.position.set(
        runnerPos.x + Math.sin(backAngle) * 35,
        runnerPos.y + 28,
        runnerPos.z + Math.cos(backAngle) * 35,
      );
      rimLightRef.current.target.position.copy(runnerPos);
      rimLightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <hemisphereLight args={[mood.hemiSky, mood.hemiGround, mood.hemiIntensity]} />

      <directionalLight
        ref={rimLightRef}
        color={mood.rimColor}
        intensity={isNightMood ? 1.25 : 0.9}
        position={[0, 30, -30]}
      />
      <directionalLight
        ref={keyLightRef}
        color={mood.keyColor}
        intensity={mood.keyIntensity}
        position={mood.keyPos}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={10}
        shadow-camera-far={420}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={48}
        shadow-camera-bottom={-48}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
      />

      <directionalLight
        color={mood.rimColor}
        intensity={mood.rimIntensity}
        position={[-140, 90, -160]}
      />

      <TerrainMap3D
        key={track.id}
        track={track}
        mapStyle={mapConfig.mapStyle}
        routeStyle={mapConfig.routeStyle ?? 'google-maps'}
        overlayColor={mapConfig.overlayColor ?? '#F97316'}
        buildings3d={mapConfig.buildings3d}
        showKmPins={mapConfig.showKmPins ?? false}
        showRouteGlow={mapConfig.showRouteGlow ?? false}
        routeThickness={mapConfig.routeThickness ?? 'thin'}
        isNight={isNightMood}
        jerseyColor={runner.jerseyColor}
        routeProgress={routeProgress}
        groundedPath={groundedPath}
        mapReloadNonce={mapReloadNonce}
        mapContainer={mapContainer}
        onMapCanvasReady={onMapCanvasReady}
        onMapLoadStatus={onMapLoadStatus}
      />

      {/* Beacon ring di bawah kaki pelari agar posisi atlet selalu jelas di atas jalan */}
      <group position={[runnerPos.x, runnerPos.y + 0.08, runnerPos.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[runnerScale * 0.36, runnerScale * 0.50, 32]} />
          <meshBasicMaterial color={mapConfig.overlayColor ?? '#F97316'} transparent opacity={0.48} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[runnerScale * 0.38, 32]} />
          <meshBasicMaterial color="#090D16" transparent opacity={0.35} />
        </mesh>
      </group>

      {runner.characterStyle === 'custom-glb' && runner.customModelUrl ? (
        <CustomGlbRunner3D
          config={effectiveRunnerConfig}
          position={runnerPos}
          yawRef={smoothYawRef}
          slopePitchRad={slopePitchRad}
          scale={runnerScale}
          cadenceSpm={currentCadence}
          paceSecPerKm={currentPaceSec}
          isPlaying={isPlaying}
          isFinishPose={isFinishPhase}
          includeFinishPose={includeFinishPose}
          isManualFinishCamera={mapConfig.cameraMode === 'finish-pose'}
          timelineProgress={timelineProgress}
          onStatusChange={onCustomModelStatus}
        />
      ) : (
        <RealisticRunner3D
          config={effectiveRunnerConfig}
          position={runnerPos}
          yawRef={smoothYawRef}
          slopePitchRad={slopePitchRad}
          scale={runnerScale}
          cadenceSpm={currentCadence}
          paceSecPerKm={currentPaceSec}
          isPlaying={isPlaying}
          isFinishPose={isFinishPhase}
          includeFinishPose={includeFinishPose}
          isManualFinishCamera={mapConfig.cameraMode === 'finish-pose'}
          timelineProgress={timelineProgress}
          isNightMood={isNightMood}
        />
      )}
    </>
  );
};

export const Studio3DCanvas: React.FC<Studio3DCanvasProps> = (props) => {
  const isSoftwareGl = useMemo(() => detectSoftwareWebGL(), []);
  const [contextLost, setContextLost] = useState(false);
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null);

  return (
    <WebGLErrorBoundary>
      {contextLost ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-200 p-6 text-center gap-3">
          <p className="text-xs font-medium">Konteks WebGL terputus. Klik muat ulang kanvas 3D.</p>
          <button
            type="button"
            onClick={() => setContextLost(false)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold cursor-pointer"
          >
            Muat Ulang 3D
          </button>
        </div>
      ) : (
        <div
          className="relative w-full h-full overflow-hidden transition-colors duration-300"
          style={{
            backgroundColor: props.mapConfig.mapStyle === 'dark' || props.mapConfig.mapStyle === 'satellite' ? '#0B1120' : props.mapConfig.mapStyle === 'clean' ? '#F1F5F9' : '#F3EFE6',
          }}
        >
          <div
            ref={setMapContainer}
            id="map"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }}
          />

          <div
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 10 }}
            className="pointer-events-none"
          >
            <Canvas
              shadows={!isSoftwareGl}
              dpr={isSoftwareGl ? 1 : [1, 2]}
              camera={{ fov: 44, near: 1.5, far: 4500, position: [0, 120, 140] }}
              gl={{
                alpha: true,
                preserveDrawingBuffer: true,
                antialias: !isSoftwareGl,
                powerPreference: 'high-performance',
                toneMapping: THREE.ACESFilmicToneMapping,
                toneMappingExposure: 1.0,
              }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
                gl.domElement.addEventListener(
                  'webglcontextlost',
                  (e) => {
                    e.preventDefault();
                    setContextLost(true);
                  },
                  false,
                );
              }}
            >
              <SceneContent {...props} mapContainer={mapContainer} />
            </Canvas>
          </div>
        </div>
      )}
    </WebGLErrorBoundary>
  );
};
