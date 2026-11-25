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
  buildPaceColoredRouteRibbonGeometry,
  buildSlimRouteRibbonGeometry,
  sampleGroundedRouteAtProgress,
  type GroundedRoutePath,
} from '../../utils/studio3dGpsEngine';

export const MAP_STYLES: Record<MapMode3D, string> = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

interface TerrainMap3DProps {
  track: Studio3DTrack;
  mapStyle: MapMode3D;
  routeStyle?: RouteVisualStyle3D;
  buildings3d: boolean;
  isNight: boolean;
  jerseyColor: string;
  routeProgress: number;
  groundedPath: GroundedRoutePath;
  mapReloadNonce: number;
  mapContainer: HTMLDivElement | null;
  onMapCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onMapLoadStatus?: (status: MapLoadStatus) => void;
}

function createGoogleMapsChevronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(32, 82);
    ctx.lineTo(64, 42);
    ctx.lineTo(96, 82);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createLandmarkSpriteTexture(
  landmark: Studio3DLandmark,
  sportByteDarkBadge = false,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const bgColor =
      landmark.type === 'start'
        ? sportByteDarkBadge
          ? '#35D07F'
          : '#10B981'
        : landmark.type === 'finish'
          ? sportByteDarkBadge
            ? '#FF626D'
            : '#F97316'
          : landmark.type === 'peak'
            ? '#8B5CF6'
            : landmark.type === 'custom'
              ? '#EC4899'
              : sportByteDarkBadge
                ? '#111C25'
                : '#0F172A';

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(14, 14, 292, 74, 18);
    ctx.fill();

    ctx.strokeStyle =
      sportByteDarkBadge && landmark.type !== 'start' && landmark.type !== 'finish'
        ? 'rgba(166, 240, 75, 0.92)'
        : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(landmark.label.slice(0, 18), 160, 52);

    ctx.fillStyle =
      sportByteDarkBadge && landmark.type !== 'start' && landmark.type !== 'finish'
        ? '#A6F04B'
        : '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(148, 88);
    ctx.lineTo(172, 88);
    ctx.lineTo(160, 106);
    ctx.closePath();
    ctx.fill();
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
  sportByteDarkBadge?: boolean;
}> = ({ landmark, position, scaleFactor, sportByteDarkBadge = false }) => {
  const spriteTex = useMemo(
    () => createLandmarkSpriteTexture(landmark, sportByteDarkBadge),
    [landmark, sportByteDarkBadge],
  );
  useEffect(() => () => spriteTex.dispose(), [spriteTex]);

  const pinColor =
    landmark.type === 'start'
      ? '#10B981'
      : landmark.type === 'finish'
        ? '#F97316'
        : landmark.type === 'peak'
          ? '#8B5CF6'
          : landmark.type === 'custom'
            ? '#EC4899'
            : '#38BDF8';

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh position={[0, scaleFactor * 1.4, 0]}>
        <cylinderGeometry args={[scaleFactor * 0.12, scaleFactor * 0.12, scaleFactor * 2.8, 10]} />
        <meshStandardMaterial color="#F8FAFC" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, scaleFactor * 2.9, 0]}>
        <sphereGeometry args={[scaleFactor * 0.38, 12, 12]} />
        <meshStandardMaterial color={pinColor} roughness={0.35} emissive={pinColor} emissiveIntensity={0.25} />
      </mesh>
      <sprite position={[0, scaleFactor * 5.0, 0]} scale={[scaleFactor * 7.8, scaleFactor * 2.7, 1]}>
        <spriteMaterial map={spriteTex} transparent depthTest={false} />
      </sprite>
    </group>
  );
};


function syncRouteLayersOnMap(
  map: maplibregl.Map,
  track: Studio3DTrack,
  routeProgress: number,
  jerseyColor: string,
  routeStyle: RouteVisualStyle3D,
) {
  if (!map.isStyleLoaded() || track.points.length < 2) return;

  const fullCoords = track.points.map((p) => [p.lon, p.lat]);
  const activeCount = Math.max(
    2,
    Math.min(fullCoords.length, Math.ceil(routeProgress * (fullCoords.length - 1)) + 1),
  );
  const activeCoords = routeProgress <= 0.002 ? [] : fullCoords.slice(0, activeCount);

  const activeColor =
    routeStyle === 'sportbyte-lime'
      ? '#A6F04B'
      : routeStyle === 'google-maps'
        ? '#1A73E8'
        : jerseyColor || '#F97316';

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

  const fullSrc = map.getSource('gpx-route-full') as maplibregl.GeoJSONSource | undefined;
  if (fullSrc) {
    fullSrc.setData(fullGeo);
  } else {
    map.addSource('gpx-route-full', { type: 'geojson', data: fullGeo });
    map.addLayer({
      id: 'gpx-route-casing',
      type: 'line',
      source: 'gpx-route-full',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0F172A', 'line-width': 9, 'line-opacity': 0.85 },
    });
    map.addLayer({
      id: 'gpx-route-base',
      type: 'line',
      source: 'gpx-route-full',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#93C5FD', 'line-width': 5, 'line-opacity': 0.9 },
    });
  }

  const activeSrc = map.getSource('gpx-route-active') as maplibregl.GeoJSONSource | undefined;
  if (activeSrc) {
    activeSrc.setData(activeGeo);
    map.setPaintProperty('gpx-route-active', 'line-color', activeColor);
  } else {
    map.addSource('gpx-route-active', { type: 'geojson', data: activeGeo });
    map.addLayer({
      id: 'gpx-route-active',
      type: 'line',
      source: 'gpx-route-active',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': activeColor, 'line-width': 6.5, 'line-opacity': 1 },
    });
  }
}

function add3DBuildingsToMap(map: maplibregl.Map, mode: MapMode3D, enabled: boolean) {
  if (!enabled) {
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
      minzoom: 13.5,
      paint: {
        'fill-extrusion-color': mode === 'dark' ? '#64748b' : '#b8c4d1',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      },
    },
    labelLayer?.id,
  );
}

export const TerrainMap3D: React.FC<TerrainMap3DProps> = ({
  track,
  mapStyle,
  routeStyle = 'google-maps',
  buildings3d,
  isNight,
  jerseyColor,
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
      pitch: buildings3dRef.current ? 56 : 0,
      bearing: 0,
      maxPitch: 85,
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
      syncRouteLayersOnMap(map, track, routeProgress, jerseyColor, routeStyle);
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
    syncRouteLayersOnMap(map, track, routeProgress, jerseyColor, routeStyle);

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
      syncRouteLayersOnMap(map, track, routeProgress, jerseyColor, routeStyle);
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

  // Sinkronisasi kamera MapLibre GL 1:1 dengan Three.js
  useFrame(() => {
    const map = mapRef.current;
    if (!map) return;
    syncRouteLayersOnMap(map, track, routeProgress, jerseyColor, routeStyle);

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
      78,
    );
    // Saat 3D OFF, kunci tampilan menjadi 2D top-down datar (pitch 0)
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
    // MapLibre world size = 512px per tile (2x 256px)
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

  const routeHalfWidth = Math.max(0.85, Math.min(1.65, track.spanMeters * 0.00085));
  const chevronTileM = Math.max(5.5, routeHalfWidth * 7.2);
  const showCasing = routeStyle !== 'minimal-clean';
  const showChevrons = routeStyle !== 'minimal-clean';

  const chevronTex = useMemo(() => createGoogleMapsChevronTexture(), []);
  useEffect(() => () => chevronTex.dispose(), [chevronTex]);

  const casingRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 1.45, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );
  const guideRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 0.9, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );
  const activeRibbonGeo = useMemo(
    () =>
      routeStyle === 'google-pace'
        ? buildPaceColoredRouteRibbonGeometry(groundedPath, track.points, routeHalfWidth * 1.08, {
            tileLenM: chevronTileM,
          })
        : buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 1.08, {
            tileLenM: chevronTileM,
          }),
    [groundedPath, track.points, routeStyle, routeHalfWidth, chevronTileM],
  );
  const chevronRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 0.95, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );

  useEffect(() => {
    return () => {
      casingRibbonGeo.dispose();
      guideRibbonGeo.dispose();
      activeRibbonGeo.dispose();
      chevronRibbonGeo.dispose();
    };
  }, [casingRibbonGeo, guideRibbonGeo, activeRibbonGeo, chevronRibbonGeo]);

  useEffect(() => {
    const verts = groundedPath.vertices;
    if (verts.length < 2 || routeProgress <= 0.003) {
      activeRibbonGeo.setDrawRange(0, 0);
      return;
    }
    if (routeProgress >= 0.999) {
      activeRibbonGeo.setDrawRange(0, (verts.length - 1) * 6);
      return;
    }
    const targetDist = routeProgress * groundedPath.totalArcMeters;
    let lo = 0;
    let hi = verts.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (verts[mid].distM <= targetDist) lo = mid;
      else hi = mid;
    }
    const segCount = Math.max(1, Math.min(verts.length - 1, lo + 1));
    activeRibbonGeo.setDrawRange(0, segCount * 6);
  }, [activeRibbonGeo, groundedPath, routeProgress]);

  const isSportByteLime = routeStyle === 'sportbyte-lime';
  const casingColor =
    routeStyle === 'google-maps'
      ? '#174EA6'
      : isSportByteLime
        ? '#14232C'
        : routeStyle === 'google-pace'
          ? '#1E293B'
          : '#0F172A';
  const guideColor =
    routeStyle === 'google-maps'
      ? isNight
        ? '#3B82F6'
        : '#93C5FD'
      : isSportByteLime
        ? isNight
          ? '#4D7C0F'
          : '#64748B'
        : isNight
          ? '#64748B'
          : '#94A3B8';
  const activeBaseColor =
    routeStyle === 'google-maps'
      ? '#1A73E8'
      : isSportByteLime
        ? '#A6F04B'
        : routeStyle === 'google-pace'
          ? '#FFFFFF'
          : jerseyColor;

  const landmarkMarkers = useMemo(() => {
    return track.landmarks
      .filter((lm) => lm.type !== 'start' && lm.type !== 'finish')
      .map((lm) => {
        const { position } = sampleGroundedRouteAtProgress(
          groundedPath,
          THREE.MathUtils.clamp(lm.progress, 0, 1),
        );
        return { landmark: lm, position };
      });
  }, [track.landmarks, groundedPath]);

  const landmarkScale = Math.max(1.2, Math.min(3.5, track.spanMeters * 0.0022));

  return (
    <group name="TerrainMapRoot">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12000, 12000]} />
        <shadowMaterial transparent opacity={isNight ? 0.35 : 0.24} />
      </mesh>

      {showCasing && (
        <mesh geometry={casingRibbonGeo} position={[0, 0, 0]}>
          <meshStandardMaterial
            key={`casing-${routeStyle}`}
            color={casingColor}
            roughness={0.55}
            metalness={0.05}
            polygonOffset
            polygonOffsetFactor={-1.0}
          />
        </mesh>
      )}

      <mesh geometry={guideRibbonGeo} position={[0, 0.015, 0]}>
        <meshStandardMaterial
          key={`guide-${routeStyle}-${isNight}`}
          color={guideColor}
          transparent
          opacity={routeStyle === 'google-maps' ? 0.85 : 0.82}
          roughness={0.58}
          polygonOffset
          polygonOffsetFactor={-1.8}
        />
      </mesh>

      <mesh geometry={activeRibbonGeo} position={[0, 0.032, 0]}>
        <meshStandardMaterial
          key={`active-${routeStyle}-${jerseyColor}`}
          color={activeBaseColor}
          vertexColors={routeStyle === 'google-pace'}
          emissive={routeStyle === 'google-pace' ? '#0F172A' : activeBaseColor}
          emissiveIntensity={
            routeStyle === 'google-pace'
              ? 0.14
              : isSportByteLime
                ? isNight
                  ? 0.95
                  : 0.22
                : isNight
                  ? 1.15
                  : 0.3
          }
          roughness={0.34}
          metalness={0.08}
          polygonOffset
          polygonOffsetFactor={-2.8}
        />
      </mesh>

      {showChevrons && (
        <mesh geometry={chevronRibbonGeo} position={[0, 0.05, 0]}>
          <meshBasicMaterial
            map={chevronTex}
            color={isSportByteLime ? '#14232C' : '#FFFFFF'}
            transparent
            opacity={routeStyle === 'google-maps' ? 0.92 : isSportByteLime ? 0.72 : 0.85}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-3.8}
          />
        </mesh>
      )}

      {landmarkMarkers.map((item) => (
        <LandmarkMarker3D
          key={item.landmark.id}
          landmark={item.landmark}
          position={item.position}
          scaleFactor={landmarkScale}
          sportByteDarkBadge={isSportByteLime || mapStyle === 'dark'}
        />
      ))}
    </group>
  );
};
