import type {
  ExportConfig,
  RunnerConfig,
  Studio3DTrack,
  Studio3DTrackPoint,
} from '../types/studio3d';
import { formatDuration, formatPace } from './runParser';
import type { Studio3DAudioEngine } from './studio3dAudio';
import { sampleTrackPointByDistance } from './studio3dGpsEngine';

export interface Studio3DFrameTelemetry {
  point: Studio3DTrackPoint;
  elapsedSec: number;
  distanceKm: number;
  elevGainSoFarM: number;
  isFinishPhase: boolean;
}

export interface KmSplitItem {
  index: number;
  label: string;
  startKm: number;
  endKm: number;
  avgPaceSecPerKm: number;
  avgHr: number;
  isPartial: boolean;
}

export function computeTrackKmSplits(track: Studio3DTrack): KmSplitItem[] {
  const pts = track.points;
  const totalKm = track.totalDistanceKm;
  if (pts.length < 2 || totalKm < 0.08) return [];

  const boundaries: Array<{ startKm: number; endKm: number; label: string; isPartial: boolean }> = [];
  const fullKms = Math.floor(totalKm);
  const remainder = totalKm - fullKms;

  for (let k = 1; k <= fullKms; k += 1) {
    const isLastWithTinyTail = k === fullKms && remainder > 0 && remainder < 0.05;
    boundaries.push({
      startKm: k - 1,
      endKm: isLastWithTinyTail ? totalKm : k,
      label: String(k).padStart(2, '0'),
      isPartial: false,
    });
  }

  if (remainder >= 0.05) {
    const roundedRem = Math.max(0.1, Math.round(remainder * 10) / 10);
    boundaries.push({
      startKm: fullKms,
      endKm: totalKm,
      label: roundedRem.toFixed(1),
      isPartial: true,
    });
  }

  return boundaries.map((b, idx) => {
    const pStart = sampleTrackPointByDistance(pts, totalKm, Math.min(1, b.startKm / totalKm));
    const pEnd = sampleTrackPointByDistance(pts, totalKm, Math.min(1, b.endKm / totalKm));
    const segDist = Math.max(0.02, b.endKm - b.startKm);
    const segSec = Math.max(1, pEnd.elapsedSec - pStart.elapsedSec);
    const avgPaceSecPerKm = Math.round(segSec / segDist);

    const inSeg = pts.filter((pt) => pt.distanceKm >= b.startKm && pt.distanceKm <= b.endKm);
    const avgHr =
      inSeg.length > 0
        ? Math.round(inSeg.reduce((acc, p) => acc + p.hr, 0) / inSeg.length)
        : Math.round((pStart.hr + pEnd.hr) * 0.5);

    return {
      index: idx + 1,
      label: b.label,
      startKm: b.startKm,
      endKm: b.endKm,
      avgPaceSecPerKm,
      avgHr,
      isPartial: b.isPartial,
    };
  });
}

export function getCompletedKmSplits(
  allSplits: KmSplitItem[],
  currentDistanceKm: number,
  isFinishPhase: boolean,
): KmSplitItem[] {
  if (allSplits.length === 0) return [];
  const completed = allSplits.filter((sp) =>
    isFinishPhase ? true : currentDistanceKm >= sp.endKm - 0.005,
  );
  // Permanen menempel (tampilkan hingga 6 split terbaru secara rapi)
  return completed.slice(-6);
}

export function getExportDurationSec(config: ExportConfig): number {
  if (config.durationPreset === 'custom') {
    return Math.min(180, Math.max(5, Math.round(config.customDurationSec || 25)));
  }
  return config.durationPreset;
}

export function sampleTrackTelemetryAtProgress(
  track: Studio3DTrack,
  rawProgress: number,
  includeFinishPose: boolean,
): Studio3DFrameTelemetry {
  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const isFinishPhase = includeFinishPose && rawProgress >= finishThreshold;
  const routeProgress = Math.min(1, Math.max(0, rawProgress / finishThreshold));

  const pts = track.points;
  if (pts.length === 0) {
    throw new Error('Track has no points.');
  }
  if (pts.length === 1 || routeProgress <= 0) {
    return {
      point: pts[0],
      elapsedSec: 0,
      distanceKm: 0,
      elevGainSoFarM: 0,
      isFinishPhase: false,
    };
  }
  if (routeProgress >= 1) {
    return {
      point: pts[pts.length - 1],
      elapsedSec: track.totalDurationSec,
      distanceKm: track.totalDistanceKm,
      elevGainSoFarM: track.elevationGainM,
      isFinishPhase,
    };
  }

  const point = sampleTrackPointByDistance(pts, track.totalDistanceKm, routeProgress);

  return {
    point,
    elapsedSec: point.elapsedSec,
    distanceKm: point.distanceKm,
    elevGainSoFarM: Math.round(track.elevationGainM * routeProgress),
    isFinishPhase,
  };
}

export interface StartFinishBannerState {
  startAlpha: number;
  startOffsetY: number;
  finishAlpha: number;
  finishOffsetY: number;
}

export function computeStartFinishBannerState(
  rawProgress: number,
  includeFinishPose: boolean,
): StartFinishBannerState {
  const p = Math.min(1, Math.max(0, rawProgress));
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

  let startAlpha = 0;
  let startOffsetY = -14;
  if (p <= 0.14) {
    if (p < 0.02) {
      startAlpha = 0.72 + 0.28 * easeOutCubic(p / 0.02);
    } else if (p <= 0.105) {
      startAlpha = 1;
    } else {
      startAlpha = Math.max(0, 1 - (p - 0.105) / 0.035);
    }
    startOffsetY = (1 - startAlpha) * -14;
  }

  const finishThreshold = includeFinishPose ? 0.88 : 0.94;
  let finishAlpha = 0;
  let finishOffsetY = 16;
  if (p >= finishThreshold) {
    const enterT = (p - finishThreshold) / 0.035;
    finishAlpha = p === finishThreshold ? 0.78 : easeOutCubic(enterT);
    finishOffsetY = (1 - finishAlpha) * 16;
  }

  return {
    startAlpha,
    startOffsetY,
    finishAlpha,
    finishOffsetY,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export interface MiniMapPoint {
  x: number;
  y: number;
}

export interface MiniMapGeometry {
  polyline: MiniMapPoint[];
  startPt: MiniMapPoint;
  endPt: MiniMapPoint;
  runnerPt: MiniMapPoint;
}

export function computeMiniMapGeometry(
  track: Studio3DTrack,
  routeProgress: number,
  boxSize: number,
  pad: number,
): MiniMapGeometry {
  const pts = track.points;
  const fallbackPt = { x: boxSize / 2, y: boxSize / 2 };
  if (pts.length === 0) {
    return { polyline: [fallbackPt], startPt: fallbackPt, endPt: fallbackPt, runnerPt: fallbackPt };
  }

  const latSpanRaw = Math.max(1e-5, track.maxLat - track.minLat);
  const cosLat = Math.max(0.25, Math.cos((track.centerLat * Math.PI) / 180));
  const lonSpanRaw = Math.max(1e-5, (track.maxLon - track.minLon) * cosLat);
  const maxSpan = Math.max(latSpanRaw, lonSpanRaw);
  const inner = Math.max(4, boxSize - pad * 2);

  const offsetX = pad + ((maxSpan - lonSpanRaw) / maxSpan) * inner * 0.5;
  const offsetY = pad + ((maxSpan - latSpanRaw) / maxSpan) * inner * 0.5;

  const project = (lat: number, lon: number): MiniMapPoint => {
    const nx = ((lon - track.minLon) * cosLat) / maxSpan;
    const ny = (track.maxLat - lat) / maxSpan;
    return {
      x: offsetX + nx * inner,
      y: offsetY + ny * inner,
    };
  };

  const step = Math.max(1, Math.floor(pts.length / 120));
  const polyline: MiniMapPoint[] = [];
  for (let i = 0; i < pts.length; i += step) {
    polyline.push(project(pts[i].lat, pts[i].lon));
  }
  const last = pts[pts.length - 1];
  const lastProj = project(last.lat, last.lon);
  const tail = polyline[polyline.length - 1];
  if (!tail || Math.abs(tail.x - lastProj.x) > 0.1 || Math.abs(tail.y - lastProj.y) > 0.1) {
    polyline.push(lastProj);
  }

  const clampedP = Math.min(1, Math.max(0, routeProgress));
  const distPt = sampleTrackPointByDistance(pts, track.totalDistanceKm, clampedP);

  return {
    polyline,
    startPt: polyline[0],
    endPt: lastProj,
    runnerPt: project(distPt.lat, distPt.lon),
  };
}

function resolveOverlayPrimaryText(mode: string | undefined, mapStyle: 'light' | 'dark' | undefined): {
  primary: string;
  secondary: string;
  stroke: string;
  shadow: string;
} {
  const effective = !mode || mode === 'auto' ? (mapStyle === 'dark' || mapStyle === 'satellite' ? '#FFFFFF' : '#0F172A') : mode;
  const isDarkText = effective.toLowerCase() === '#0f172a' || effective.toLowerCase() === '#000000' || effective.toLowerCase() === '#1e293b';
  return isDarkText
    ? {
        primary: effective,
        secondary: 'rgba(15, 23, 42, 0.85)',
        stroke: 'rgba(255, 255, 255, 0.85)',
        shadow: 'rgba(255, 255, 255, 0.75)',
      }
    : {
        primary: effective,
        secondary: 'rgba(248, 250, 252, 0.92)',
        stroke: 'rgba(2, 6, 23, 0.78)',
        shadow: 'rgba(0, 0, 0, 0.92)',
      };
}

function paintBroadcastHudOverlay(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  track: Studio3DTrack;
  runner: RunnerConfig;
  accentColor: string;
  textColorMode?: string;
  mapStyle?: 'clean' | 'street' | 'dark' | 'satellite';
  telemetry: Studio3DFrameTelemetry;
  allSplits: KmSplitItem[];
  progress: number;
  includeFinishPose: boolean;
}) {
  const { ctx, width, height, track, runner, accentColor, textColorMode, mapStyle, telemetry, allSplits, progress, includeFinishPose } = params;
  const txtPalette = resolveOverlayPrimaryText(textColorMode, mapStyle);
  const s = width / 720;
  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const routeProgress = Math.min(1, Math.max(0, progress / finishThreshold));

  const padX = 32 * s;
  const topY = 28 * s;
  const mmSize = 86 * s;
  const runnerNameClean = (runner.runnerName || 'Atlet Kalcer').trim().slice(0, 24);
  const locationClean = (track.location || '').trim();
  const metaSubline = locationClean
    ? `${track.date} · ${locationClean.slice(0, 24)}`
    : track.date;

  // Header Kiri Atas tanpa blok hitam (mengandalkan stroke + drop shadow tajam)
  ctx.save();
  ctx.shadowColor = txtPalette.shadow;
  ctx.shadowBlur = 8 * s;
  ctx.shadowOffsetY = 1.5 * s;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = txtPalette.stroke;
  ctx.lineWidth = 3 * s;

  ctx.textAlign = 'left';
  ctx.font = `800 ${Math.round(13 * s)}px JetBrains Mono, monospace`;
  ctx.strokeText(runnerNameClean, padX, topY + 18 * s);
  ctx.fillStyle = accentColor;
  ctx.fillText(runnerNameClean, padX, topY + 18 * s);

  ctx.font = `700 ${Math.round(20 * s)}px Outfit, sans-serif`;
  ctx.strokeText(track.title.slice(0, 24), padX, topY + 46 * s);
  ctx.fillStyle = txtPalette.primary;
  ctx.fillText(track.title.slice(0, 24), padX, topY + 46 * s);

  ctx.font = `600 ${Math.round(12 * s)}px JetBrains Mono, monospace`;
  ctx.strokeText(metaSubline, padX, topY + 72 * s);
  ctx.fillStyle = txtPalette.secondary;
  ctx.fillText(metaSubline, padX, topY + 72 * s);
  ctx.restore();

  // Mini GPS Radar Kanan Atas (sejajar topY)
  const mmX = width - padX - mmSize;
  const mmY = topY;
  drawRoundedRect(ctx, mmX, mmY, mmSize, mmSize, 14 * s);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.lineWidth = Math.max(1, 1.3 * s);
  ctx.stroke();

  ctx.fillStyle = txtPalette.primary;
  ctx.font = `700 ${Math.round(10 * s)}px JetBrains Mono, monospace`;
  ctx.fillText('GPS', mmX + 9 * s, mmY + 15 * s);

  const mmGeom = computeMiniMapGeometry(track, routeProgress, mmSize, 14 * s);
  if (mmGeom.polyline.length >= 2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mmX + mmGeom.polyline[0].x, mmY + mmGeom.polyline[0].y);
    for (let i = 1; i < mmGeom.polyline.length; i += 1) {
      ctx.lineTo(mmX + mmGeom.polyline[i].x, mmY + mmGeom.polyline[i].y);
    }
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(1.8, 2.6 * s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(mmX + mmGeom.startPt.x, mmY + mmGeom.startPt.y, 3 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#A3E635';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(mmX + mmGeom.runnerPt.x, mmY + mmGeom.runnerPt.y, 4.2 * s, 0, Math.PI * 2);
    ctx.fillStyle = txtPalette.primary;
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(1.2, 1.8 * s);
    ctx.stroke();
    ctx.restore();
  }

  // Km Splits Permanen tanpa blok hitam
  const visibleSplits = getCompletedKmSplits(
    allSplits,
    telemetry.distanceKm,
    telemetry.isFinishPhase,
  );
  if (visibleSplits.length > 0) {
    const startSplitY = topY + mmSize + 14 * s;
    const rowH = 25 * s;

    ctx.save();
    ctx.shadowColor = txtPalette.shadow;
    ctx.shadowBlur = 7 * s;
    ctx.shadowOffsetY = 1.5 * s;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = txtPalette.stroke;
    ctx.lineWidth = 2.6 * s;

    visibleSplits.forEach((sp, idx) => {
      const sy = startSplitY + idx * rowH;
      const isNewest = idx === visibleSplits.length - 1 && !telemetry.isFinishPhase;

      ctx.font = `800 ${Math.round(12 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(`KM ${sp.label}`, padX, sy + 16 * s);
      ctx.fillStyle = isNewest ? '#A3E635' : accentColor;
      ctx.fillText(`KM ${sp.label}`, padX, sy + 16 * s);

      const valText = `${formatPace(sp.avgPaceSecPerKm)}/km · ${sp.avgHr} bpm`;
      ctx.font = `700 ${Math.round(12 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(valText, padX + 66 * s, sy + 16 * s);
      ctx.fillStyle = txtPalette.primary;
      ctx.fillText(valText, padX + 66 * s, sy + 16 * s);
    });
    ctx.restore();
  }

  const banner = computeStartFinishBannerState(progress, includeFinishPose);

  // Overlay Bawah Transparan Murni (Tanpa block hitam)
  ctx.save();
  ctx.shadowColor = txtPalette.shadow;
  ctx.shadowBlur = 9 * s;
  ctx.shadowOffsetY = 2 * s;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = txtPalette.stroke;
  ctx.lineWidth = 3 * s;

  const baseX = padX;
  const baseW = width - padX * 2;
  const colW = baseW / 3;

  if (banner.finishAlpha > 0.15) {
    const topFinishY = height - 224 * s;

    drawRoundedRect(ctx, baseX, topFinishY, 5 * s, 38 * s, 2.5 * s);
    ctx.fillStyle = accentColor;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = `800 ${Math.round(11 * s)}px JetBrains Mono, monospace`;
    ctx.strokeText('ACTIVITY COMPLETED', baseX + 14 * s, topFinishY + 13 * s);
    ctx.fillStyle = accentColor;
    ctx.fillText('ACTIVITY COMPLETED', baseX + 14 * s, topFinishY + 13 * s);

    const titleLine = `${runnerNameClean} · ${track.title.slice(0, 20)}`;
    ctx.font = `700 ${Math.round(19 * s)}px Outfit, sans-serif`;
    ctx.strokeText(titleLine, baseX + 14 * s, topFinishY + 35 * s);
    ctx.fillStyle = txtPalette.primary;
    ctx.fillText(titleLine, baseX + 14 * s, topFinishY + 35 * s);

    const stravaMetrics = [
      { label: 'DISTANCE', value: `${track.totalDistanceKm.toFixed(2)} km` },
      { label: 'AVG PACE', value: `${formatPace(track.avgPaceSecPerKm)} /km` },
      { label: 'TIME', value: formatDuration(track.totalDurationSec) },
    ];
    stravaMetrics.forEach((m, idx) => {
      const mx = baseX + idx * colW;
      const my = topFinishY + 68 * s;
      ctx.font = `700 ${Math.round(10 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(m.label, mx, my);
      ctx.fillStyle = txtPalette.secondary;
      ctx.fillText(m.label, mx, my);

      ctx.font = `800 ${Math.round(23 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(m.value, mx, my + 26 * s);
      ctx.fillStyle = txtPalette.primary;
      ctx.fillText(m.value, mx, my + 26 * s);
    });

    const subMetrics = [
      { label: 'AVG HR', value: `${track.avgHr} bpm` },
      { label: 'CADENCE', value: `${track.avgCadence} spm` },
      { label: 'ELEV GAIN', value: `+${track.elevationGainM} m` },
    ];
    subMetrics.forEach((m, idx) => {
      const mx = baseX + idx * colW;
      const my = topFinishY + 128 * s;
      ctx.font = `600 ${Math.round(10 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(m.label, mx, my);
      ctx.fillStyle = txtPalette.secondary;
      ctx.fillText(m.label, mx, my);

      ctx.font = `700 ${Math.round(18 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(m.value, mx, my + 22 * s);
      ctx.fillStyle = txtPalette.primary;
      ctx.fillText(m.value, mx, my + 22 * s);
    });
  } else {
    const topLiveY = height - 208 * s;
    const distStr = telemetry.distanceKm.toFixed(2);

    ctx.textAlign = 'left';
    ctx.font = `800 ${Math.round(28 * s)}px JetBrains Mono, monospace`;
    ctx.strokeText(distStr, baseX, topLiveY + 26 * s);
    ctx.fillStyle = txtPalette.primary;
    ctx.fillText(distStr, baseX, topLiveY + 26 * s);
    const distW = ctx.measureText(distStr).width;

    const totalStr = ` / ${track.totalDistanceKm.toFixed(2)} KM`;
    ctx.font = `700 ${Math.round(13 * s)}px JetBrains Mono, monospace`;
    ctx.strokeText(totalStr, baseX + distW, topLiveY + 25 * s);
    ctx.fillStyle = accentColor;
    ctx.fillText(totalStr, baseX + distW, topLiveY + 25 * s);

    ctx.textAlign = 'right';
    const timeStr = formatDuration(telemetry.elapsedSec);
    ctx.font = `700 ${Math.round(15 * s)}px JetBrains Mono, monospace`;
    ctx.strokeText(timeStr, baseX + baseW, topLiveY + 25 * s);
    ctx.fillStyle = txtPalette.primary;
    ctx.fillText(timeStr, baseX + baseW, topLiveY + 25 * s);
    ctx.textAlign = 'left';

    const barY = topLiveY + 38 * s;
    drawRoundedRect(ctx, baseX, barY, baseW, 5 * s, 2.5 * s);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fill();

    drawRoundedRect(ctx, baseX, barY, Math.max(12 * s, baseW * progress), 5 * s, 2.5 * s);
    ctx.fillStyle = accentColor;
    ctx.fill();

    const stats = [
      { label: 'PACE (/KM)', value: `${formatPace(telemetry.point.paceSecPerKm)} /km` },
      { label: 'HEART RATE', value: `${telemetry.point.hr} bpm` },
      { label: 'CADENCE', value: `${telemetry.point.cadence} spm` },
      { label: 'DISTANCE', value: `${telemetry.distanceKm.toFixed(2)} km` },
      { label: 'ELEV GAIN', value: `+${telemetry.elevGainSoFarM} m` },
      { label: 'TIME', value: formatDuration(telemetry.elapsedSec) },
    ];

    stats.forEach((st, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const sx = baseX + col * colW;
      const sy = topLiveY + (68 + row * 56) * s;

      ctx.font = `600 ${Math.round(10 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(st.label, sx, sy);
      ctx.fillStyle = txtPalette.secondary;
      ctx.fillText(st.label, sx, sy);

      ctx.font = `700 ${Math.round(19 * s)}px JetBrains Mono, monospace`;
      ctx.strokeText(st.value, sx, sy + 22 * s);
      ctx.fillStyle = txtPalette.primary;
      ctx.fillText(st.value, sx, sy + 22 * s);
    });
  }
  ctx.restore();
}

export function pickSupportedVideoMimeType(): {
  mimeType: string;
  extension: 'mp4' | 'webm';
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', extension: 'webm' };
  }
  const candidates: Array<{ mimeType: string; extension: 'mp4' | 'webm' }> = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  for (const cand of candidates) {
    if (MediaRecorder.isTypeSupported(cand.mimeType)) {
      return cand;
    }
  }
  return { mimeType: '', extension: 'webm' };
}

export interface ExportVideoCallbacks {
  getSourceCanvas: () => HTMLCanvasElement | null;
  getMapCanvas?: () => HTMLCanvasElement | null;
  setProgress: (nextProgress: number) => void;
  audioEngine: Studio3DAudioEngine;
  track: Studio3DTrack;
  runner: RunnerConfig;
  exportConfig: ExportConfig;
  overlayColor?: string;
  overlayTextColor?: string;
  mapStyle?: 'clean' | 'street' | 'dark' | 'satellite';
  onPercent: (pct: number) => void;
  abortSignal: AbortSignal;
}

export async function recordStudio3DVideo({
  getSourceCanvas,
  getMapCanvas,
  setProgress,
  audioEngine,
  track,
  runner,
  exportConfig,
  overlayColor = '#F97316',
  overlayTextColor = 'auto',
  mapStyle = 'clean',
  onPercent,
  abortSignal,
}: ExportVideoCallbacks): Promise<{ blob: Blob; filename: string; extension: 'mp4' | 'webm' }> {
  const srcCanvas = getSourceCanvas();
  if (!srcCanvas) {
    throw new Error('Kanvas WebGL 3D belum siap.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Browser ini belum mendukung perekaman video MediaRecorder.');
  }

  const width = exportConfig.quality === '1080p' ? 1080 : 720;
  const height = exportConfig.quality === '1080p' ? 1920 : 1280;
  const durationSec = getExportDurationSec(exportConfig);
  const fps = 30;
  const allSplits = computeTrackKmSplits(track);

  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const ctx = compCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menginisialisasi kanvas kompositor 2D.');
  }

  await audioEngine.configure(
    exportConfig.musicPreset,
    exportConfig.customAudioUrl,
    exportConfig.volume,
  );
  if (exportConfig.musicPreset !== 'none') {
    await audioEngine.start();
  }

  const canvasStream = compCanvas.captureStream(fps);
  const combinedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));
  if (exportConfig.musicPreset !== 'none') {
    const audioStream = audioEngine.getRecordingAudioStream();
    audioStream?.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
  }

  const { mimeType, extension } = pickSupportedVideoMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: exportConfig.quality === '1080p' ? 7_500_000 : 4_200_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };
    recorder.onerror = () => {
      reject(new Error('Terjadi kesalahan saat merekam video 9:16.'));
    };
  });

  setProgress(0);
  recorder.start(250);

  const startMs = performance.now();
  const totalMs = durationSec * 1000;

  await new Promise<void>((resolve, reject) => {
    let rafId = 0;
    const step = () => {
      if (abortSignal.aborted) {
        cancelAnimationFrame(rafId);
        reject(new Error('Ekspor video dibatalkan.'));
        return;
      }

      const elapsedMs = performance.now() - startMs;
      const p = Math.min(1, elapsedMs / totalMs);
      setProgress(p);
      onPercent(Math.round(p * 100));

      ctx.clearRect(0, 0, width, height);

      const liveMapCanvas = getMapCanvas?.();
      if (liveMapCanvas) {
        const mScale = Math.max(width / liveMapCanvas.width, height / liveMapCanvas.height);
        const mw = liveMapCanvas.width * mScale;
        const mh = liveMapCanvas.height * mScale;
        ctx.drawImage(liveMapCanvas, (width - mw) / 2, (height - mh) / 2, mw, mh);
      }

      const liveCanvas = getSourceCanvas();
      if (liveCanvas) {
        const scale = Math.max(width / liveCanvas.width, height / liveCanvas.height);
        const dw = liveCanvas.width * scale;
        const dh = liveCanvas.height * scale;
        ctx.drawImage(liveCanvas, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      const telemetry = sampleTrackTelemetryAtProgress(
        track,
        p,
        exportConfig.includeFinishPose,
      );
      paintBroadcastHudOverlay({
        ctx,
        width,
        height,
        track,
        runner,
        accentColor: overlayColor,
        textColorMode: overlayTextColor,
        mapStyle,
        telemetry,
        allSplits,
        progress: p,
        includeFinishPose: exportConfig.includeFinishPose,
      });

      if (p >= 1) {
        resolve();
      } else {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
  }).catch((err) => {
    if (recorder.state !== 'inactive') recorder.stop();
    audioEngine.stop();
    throw err;
  });

  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
  audioEngine.stop();
  const blob = await stopPromise;

  const safeSlug = track.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

  return {
    blob,
    filename: `sportbyte-3d-${track.date}-${safeSlug || 'run'}-${exportConfig.quality}.${extension}`,
    extension,
  };
}
