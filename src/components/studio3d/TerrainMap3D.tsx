import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import type {
  MapLoadStatus,
  MapMode3D,
  RouteVisualStyle3D,
  Studio3DLandmark,
  Studio3DTrack,
} from '../../types/studio3d';
import {
  sampleGroundedRouteAtProgress,
  type GroundedRoutePath,
} from '../../utils/studio3dGpsEngine';

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export const MAP_STYLES: Record<MapMode3D, string | maplibregl.StyleSpecification> = {
  clean: 'https://tiles.openfreemap.org/styles/positron',
  street: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  satellite: SATELLITE_STYLE,
};

export function isDarkMapTheme(mode: MapMode3D): boolean {
  return mode === 'dark' || mode === 'satellite';
}

interface TerrainMap3DProps {
  track: Studio3DTrack;
  mapStyle: MapMode3D;
  routeStyle?: RouteVisualStyle3D;
  overlayColor?: string;
  buildings3d: boolean;
  showKmPins?: boolean;
  showRouteGlow?: boolean;
  isNight: boolean;
  jerseyColor: string;
  routeProgress: number;
  groundedPath: GroundedRoutePath;
  mapReloadNonce: number;
  mapContainer: HTMLDivElement | null;
  onMapCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onMapLoadStatus?: (status: MapLoadStatus) => void;
}

function createLandmarkSpriteTexture(
  landmark: Studio3DLandmark,
  accentColor: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 88;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(12, 12, 232, 56, 14);
    ctx.fill();

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(landmark.label.slice(0, 16), 128, 41);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const LandmarkMarker3D: React.FC<{
  landmark: Studio3DLandmark;
  position: THREE.Vector3;
  scaleFactor: number;
  accentColor: string;
  passed: boolean;
}> = ({ landmark, position, scaleFactor, accentColor, passed }) => {
  const badgeColor =
    landmark.type === "start" ? "#10B981" : landmark.type === "finish" ? "#F43F5E" : accentColor;
  const spriteTex = useMemo(
    () => createLandmarkSpriteTexture(landmark, badgeColor),
    [landmark, badgeColor],
  );
  useEffect(() => () => spriteTex.dispose(), [spriteTex]);

  return (
    <group position={[position.x, position.y + 0.05, position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[scaleFactor * 0.32, scaleFactor * 0.62, 24]} />
        <meshBasicMaterial
          color={passed ? badgeColor : "#94A3B8"}
          transparent
          opacity={passed ? 0.9 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, scaleFactor * 1.1, 0]}>
        <cylinderGeometry args={[scaleFactor * 0.06, scaleFactor * 0.06, scaleFactor * 2.2, 8]} />
        <meshStandardMaterial color={passed ? badgeColor : "#E2E8F0"} roughness={0.35} />
      </mesh>
      <sprite position={[0, scaleFactor * 3.4, 0]} scale={[scaleFactor * 5.8, scaleFactor * 2.0, 1]}>
        <spriteMaterial map={spriteTex} transparent depthTest={false} opacity={passed ? 1 : 0.82} />
      </sprite>
    </group>
  );
};

function add3DBuildingsToMap(map: maplibregl.Map, mode: MapMode3D, enabled: boolean) {
  if (!enabled || mode === 'satellite') {
    if (map.getLayer('3d-buildings')) {
      map.removeLayer('3d-buildings');
    }
    return;
  }

  const style = map.getStyle();
  if (!style?.sources?.openmaptiles) return;
  if (map.getLayer('3d-buildings')) return;

  const layers = style.layers || [];
  const labelLayer = layers.find((layer) => layer.type === 'symbol');

  map.addLayer(
    {
      id: '3d-buildings',
      source: 'openmaptiles',
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 13,
      paint: {
        'fill-extrusion-color':
          mode === 'dark' ? '#475569' : mode === 'clean' ? '#cbd5e1' : '#aebbc9',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 14],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      },
    },
    labelLayer?.id,
  );
}


function smoothGeoCoords(coords: number[][]): number[][] {
  if (coords.length < 4) return coords;
  let pts = coords;
  for (let pass = 0; pass < 2; pass += 1) {
    const next: number[][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function syncHairlineRouteOnMap(
  ..._args: unknown[]
) { return; }
function _oldSyncHairlineRouteOnMap(
  map: maplibregl.Map,
  track: Studio3DTrack,
  routeProgress: number,
  accentColor: string,
  darkTheme: boolean,
  showRouteGlow = false,
) {
  if (!map.isStyleLoaded() || track.points.length < 2) return;

  const fullCoords = smoothGeoCoords(track.points.map((p) => [p.lon, p.lat]));
  const activeCount = Math.max(
    2,
    Math.min(fullCoords.length, Math.ceil(routeProgress * (fullCoords.length - 1)) + 1),
  );
  const activeCoords = routeProgress <= 0.002 ? [] : fullCoords.slice(0, activeCount);

  const fullGeo: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: fullCoords },
  };
  const activeGeo: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: activeCoords },
  };

  const baseColor = darkTheme ? 'rgba(255, 255, 255, 0.28)' : 'rgba(15, 23, 42, 0.22)';

  const fullSrc = map.getSource('gpx-route-full') as maplibregl.GeoJSONSource | undefined;
  if (fullSrc) {
    fullSrc.setData(fullGeo);
    map.setPaintProperty('gpx-route-base', 'line-color', baseColor);
    map.setPaintProperty('gpx-route-base', 'line-dasharray', showRouteGlow ? [2, 2] : [1, 0]);
  } else {
    map.addSource('gpx-route-full', { type: 'geojson', data: fullGeo });
    map.addLayer({
      id: 'gpx-route-base',
      type: 'line',
      source: 'gpx-route-full',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': baseColor,
        'line-width': 2.0,
        'line-dasharray': [2, 2],
        'line-opacity': 0.8,
      },
    });
  }

  const activeSrc = map.getSource('gpx-route-active') as maplibregl.GeoJSONSource | undefined;
  if (activeSrc) {
    activeSrc.setData(activeGeo);
    if (map.getLayer('gpx-route-glow')) {
      map.setPaintProperty('gpx-route-glow', 'line-color', accentColor);
      map.setPaintProperty('gpx-route-glow', 'line-opacity', showRouteGlow ? 0.36 : 0);
    }
    map.setPaintProperty('gpx-route-active', 'line-color', accentColor);
  } else {
    map.addSource('gpx-route-active', { type: 'geojson', data: activeGeo });
    map.addLayer({
      id: 'gpx-route-glow',
      type: 'line',
      source: 'gpx-route-active',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': accentColor,
        'line-width': 9.5,
        'line-blur': 4.5,
        'line-opacity': showRouteGlow ? 0.36 : 0,
      },
    });
    map.addLayer({
      id: 'gpx-route-active',
      type: 'line',
      source: 'gpx-route-active',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': accentColor,
        'line-width': 4.0,
        'line-opacity': 0.98,
      },
    });
  }
}

function buildRibbonGeometry(
  verts: Array<{ x: number; z: number; distM: number }>,
  maxDistM: number,
  halfWidth: number,
  yOffset: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  if (verts.length < 2 || maxDistM <= 0.01) return geo;

  const pts: Array<{ x: number; z: number }> = [{ x: verts[0].x, z: verts[0].z }];
  for (let i = 1; i < verts.length; i += 1) {
    const prev = verts[i - 1];
    const curr = verts[i];
    if (curr.distM <= maxDistM) {
      pts.push({ x: curr.x, z: curr.z });
    } else {
      const segLen = Math.max(1e-5, curr.distM - prev.distM);
      const t = Math.max(0, Math.min(1, (maxDistM - prev.distM) / segLen));
      pts.push({
        x: prev.x + (curr.x - prev.x) * t,
        z: prev.z + (curr.z - prev.z) * t,
      });
      break;
    }
  }

  if (pts.length < 2) return geo;

  const positions = new Float32Array(pts.length * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i < pts.length; i += 1) {
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(pts.length - 1, i + 1)];
    let dx = pNext.x - pPrev.x;
    let dz = pNext.z - pPrev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz;
    const nz = dx;

    const baseIdx = i * 6;
    positions[baseIdx] = pts[i].x + nx * halfWidth;
    positions[baseIdx + 1] = yOffset;
    positions[baseIdx + 2] = pts[i].z + nz * halfWidth;

    positions[baseIdx + 3] = pts[i].x - nx * halfWidth;
    positions[baseIdx + 4] = yOffset;
    positions[baseIdx + 5] = pts[i].z - nz * halfWidth;

    if (i < pts.length - 1) {
      const v0 = i * 2;
      const v1 = v0 + 1;
      const v2 = v0 + 2;
      const v3 = v0 + 3;
      indices.push(v0, v2, v1, v1, v2, v3);
    }
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

const GroundedRoute3D: React.FC<{
  groundedPath: GroundedRoutePath;
  routeProgress: number;
  accentColor: string;
  isDark: boolean;
  showRouteGlow: boolean;
  ribbonWidth: number;
}> = ({ groundedPath, routeProgress, accentColor, isDark, showRouteGlow, ribbonWidth }) => {
  const baseGeo = useMemo(
    () => buildRibbonGeometry(groundedPath.vertices, groundedPath.totalArcMeters, ribbonWidth * 0.62, 0.03),
    [groundedPath, ribbonWidth],
  );
  useEffect(() => () => baseGeo.dispose(), [baseGeo]);

  const activeDistM = Math.max(0, Math.min(groundedPath.totalArcMeters, routeProgress * groundedPath.totalArcMeters));

  const activeGeo = useMemo(
    () => buildRibbonGeometry(groundedPath.vertices, activeDistM, ribbonWidth, 0.05),
    [groundedPath, activeDistM, ribbonWidth],
  );
  useEffect(() => () => activeGeo.dispose(), [activeGeo]);

  const glowGeo = useMemo(
    () => (showRouteGlow ? buildRibbonGeometry(groundedPath.vertices, activeDistM, ribbonWidth * 2.4, 0.04) : null),
    [groundedPath, activeDistM, ribbonWidth, showRouteGlow],
  );
  useEffect(() => () => glowGeo?.dispose(), [glowGeo]);

  return (
    <group name="GroundedRoute3DRibbon">
      {groundedPath.vertices.length >= 2 && (
        <mesh geometry={baseGeo} renderOrder={2}>
          <meshBasicMaterial
            color={isDark ? "#94A3B8" : "#475569"}
            transparent
            opacity={isDark ? 0.34 : 0.26}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {showRouteGlow && glowGeo && activeDistM > 0.2 && (
        <mesh geometry={glowGeo} renderOrder={3}>
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.32}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {activeDistM > 0.2 && (
        <mesh geometry={activeGeo} renderOrder={4}>
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.96}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
};

export const TerrainMap3D: React.FC<TerrainMap3DProps> = ({
  track,
  mapStyle,
  overlayColor = '#F97316',
  buildings3d,
  showKmPins = false,
  showRouteGlow = false,
  isNight,
  routeProgress,
  groundedPath,
  mapReloadNonce,
  mapContainer,
  onMapCanvasReady,
  onMapLoadStatus,
}) => {
  const { camera, size } = useThree();
  const mapRef = useRef<maplibregl.Map | null>(null);
  const currentModeRef = useRef<MapMode3D>(mapStyle);
  const buildings3dRef = useRef<boolean>(buildings3d);
  const forwardVecRef = useRef(new THREE.Vector3());

  currentModeRef.current = mapStyle;
  buildings3dRef.current = buildings3d;

  useEffect(() => {
    if (!mapContainer) return;

    onMapLoadStatus?.({
      phase: 'loading',
      loadedTiles: 0,
      failedTiles: 0,
      totalTiles: 1,
      zoom: 16,
    });

    const map = new maplibregl.Map({
      container: mapContainer,
      style: MAP_STYLES[currentModeRef.current],
      center: [track.centerLon, track.centerLat],
      zoom: 16.5,
      pitch: buildings3dRef.current ? 54 : 0,
      bearing: 0,
      maxPitch: 60,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true,
      },
    });

    mapRef.current = map;
    onMapCanvasReady?.(map.getCanvas());

    const handleLoad = () => {
      add3DBuildingsToMap(map, currentModeRef.current, buildings3dRef.current);
      syncHairlineRouteOnMap(
        map,
        track,
        routeProgress,
        overlayColor,
        isDarkMapTheme(currentModeRef.current),
        showRouteGlow,
      );
      onMapLoadStatus?.({
        phase: 'ready',
        loadedTiles: 1,
        failedTiles: 0,
        totalTiles: 1,
        zoom: Math.round(map.getZoom()),
      });
    };

    const handleError = () => {
      onMapLoadStatus?.({
        phase: 'error',
        loadedTiles: 0,
        failedTiles: 1,
        totalTiles: 1,
        zoom: Math.round(map.getZoom()),
      });
    };

    map.on('load', handleLoad);
    map.on('error', handleError);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainer);

    return () => {
      resizeObserver.disconnect();
      map.off('load', handleLoad);
      map.off('error', handleError);
      onMapCanvasReady?.(null);
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapContainer, track.id, mapReloadNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    onMapLoadStatus?.({
      phase: 'loading',
      loadedTiles: 0,
      failedTiles: 0,
      totalTiles: 1,
      zoom: Math.round(map.getZoom()),
    });

    map.setStyle(MAP_STYLES[mapStyle]);
    map.once('style.load', () => {
      add3DBuildingsToMap(map, mapStyle, buildings3dRef.current);
      syncHairlineRouteOnMap(map, track, routeProgress, overlayColor, isDarkMapTheme(mapStyle), showRouteGlow);
      onMapLoadStatus?.({
        phase: 'ready',
        loadedTiles: 1,
        failedTiles: 0,
        totalTiles: 1,
        zoom: Math.round(map.getZoom()),
      });
    });
  }, [mapStyle, onMapLoadStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    add3DBuildingsToMap(map, currentModeRef.current, buildings3d);
  }, [buildings3d]);

  useFrame(() => {
    const map = mapRef.current;
    if (!map) return;
    syncHairlineRouteOnMap(
      map,
      track,
      routeProgress,
      overlayColor,
      isDarkMapTheme(currentModeRef.current),
        showRouteGlow,
      );

    const fwd = forwardVecRef.current;
    camera.getWorldDirection(fwd);

    const dy = fwd.y < -0.02 ? fwd.y : -0.02;
    const tGround = Math.max(1, -camera.position.y / dy);
    const lookX = camera.position.x + fwd.x * tGround;
    const lookZ = camera.position.z + fwd.z * tGround;

    const cosLat = Math.max(0.15, Math.cos((track.centerLat * Math.PI) / 180));
    const centerLat = track.centerLat - lookZ / 111320;
    const centerLon = track.centerLon + lookX / (111320 * cosLat);

    const horizForward = Math.hypot(fwd.x, fwd.z);
    const rawPitchDeg = THREE.MathUtils.clamp(
      (Math.atan2(horizForward, Math.max(0.001, -fwd.y)) * 180) / Math.PI,
      0,
      58,
    );
    const pitchDeg = buildings3d ? rawPitchDeg : 0;
    const bearingDeg = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;

    const fovRad =
      camera instanceof THREE.PerspectiveCamera
        ? (camera.fov * Math.PI) / 180
        : (45 * Math.PI) / 180;
    const distToGround = Math.max(
      10,
      Math.hypot(lookX - camera.position.x, camera.position.y, lookZ - camera.position.z),
    );
    const visibleHeightM = 2 * distToGround * Math.tan(fovRad * 0.5);
    const metersPerPixel = Math.max(0.04, visibleHeightM / Math.max(1, size.height));
    const zoom = THREE.MathUtils.clamp(
      Math.log2((78271.51696 * cosLat) / metersPerPixel),
      11,
      20.5,
    );

    map.jumpTo({
      center: [centerLon, centerLat],
      zoom,
      pitch: pitchDeg,
      bearing: bearingDeg,
    });
  });

  const landmarkMarkers = useMemo(() => {
    return track.landmarks
      .map((lm) => {
        const { position } = sampleGroundedRouteAtProgress(
          groundedPath,
          THREE.MathUtils.clamp(lm.progress, 0, 1),
        );
        return { landmark: lm, position };
      });
  }, [track.landmarks, groundedPath]);

  const landmarkScale = Math.max(1.1, Math.min(3.0, track.spanMeters * 0.0018));

  return (
    <group name="TerrainMapRoot">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12000, 12000]} />
        <shadowMaterial transparent opacity={isNight ? 0.36 : 0.25} />
      </mesh>

      <GroundedRoute3D
        groundedPath={groundedPath}
        routeProgress={routeProgress}
        accentColor={overlayColor}
        isDark={isDarkMapTheme(mapStyle)}
        showRouteGlow={showRouteGlow}
        ribbonWidth={Math.max(0.45, Math.min(1.6, track.spanMeters * 0.00075)) * (routeThickness === 'thick' ? 2.1 : routeThickness === 'normal' ? 1.4 : 0.85)}
      />

      {showKmPins && landmarkMarkers.map((item) => (
        <LandmarkMarker3D
          key={item.landmark.id}
          landmark={item.landmark}
          position={item.position}
          scaleFactor={landmarkScale}
          accentColor={overlayColor}
          passed={routeProgress >= item.landmark.progress - 0.005}
        />
      ))}
    </group>
  );
};
