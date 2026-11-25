import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Compass,
  Eye,
  FileUp,
  History,
  Navigation,
  Orbit,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import type { AthleteUser, RunLog } from '../../types';
import {
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_MAP_CONFIG,
  DEFAULT_RUNNER_CONFIG,
  type Camera20mAngle,
  type CameraMode3D,
  type CharacterSize3D,
  type ExportConfig,
  type MapConfig,
  type MapLoadStatus,
  type RunnerConfig,
  type Studio3DTrack,
} from '../../types/studio3d';
import { parseFitArrayBuffer } from '../../utils/fitParser';
import { getTranslations, type Language } from '../../utils/i18n';
import { formatDuration, formatPace } from '../../utils/runParser';
import {
  deleteSavedGlbAvatar,
  formatAvatarSizeMb,
  getDefaultSavedGlbAvatar,
  getSavedGlbAvatar,
  isSupportedGlbFilename,
  listSavedGlbAvatars,
  replaceGlbAvatar,
  saveGlbAvatar,
  updateSavedGlbAvatarSettings,
  type SavedGlbAvatarSummary,
} from '../../utils/studio3dAvatarStorage';
import { Studio3DAudioEngine } from '../../utils/studio3dAudio';
import {
  computeMiniMapGeometry,
  computeStartFinishBannerState,
  computeTrackKmSplits,
  getCompletedKmSplits,
  getExportDurationSec,
  recordStudio3DVideo,
  sampleTrackTelemetryAtProgress,
} from '../../utils/studio3dExporter';
import { sampleTrackPointByDistance } from '../../utils/studio3dGpsEngine';
import {
  createTrackFromRunLog,
  fetchRoadSnappedTrack,
  parseGpxToStudio3DTrack,
  pickInitialGpsTrackFromRuns,
} from '../../utils/studio3dTrack';
import type { CustomGlbStatus } from './CustomGlbRunner3D';
import { Studio3DCanvas } from './Studio3DCanvas';
import { Studio3DPanelTabs, type Studio3DTab } from './Studio3DPanelTabs';

interface Studio3DViewProps {
  runs: RunLog[];
  user?: AthleteUser;
  lang: Language;
  isGuest?: boolean;
  onRequestSignIn?: () => void;
  externalUploadTrigger?: number;
}

const INITIAL_MAP_LOAD_STATUS: MapLoadStatus = {
  phase: 'loading',
  loadedTiles: 0,
  failedTiles: 0,
  totalTiles: 1,
  zoom: 15,
};

export const Studio3DView: React.FC<Studio3DViewProps> = ({
  runs,
  user,
  lang,
  isGuest = false,
  externalUploadTrigger = 0,
}) => {
  const t3d = getTranslations(lang).public3d;
  const initialPicked = useMemo(
    () =>
      pickInitialGpsTrackFromRuns(runs, user?.biodata.city || 'Indonesia', {
        restingHr: user?.biodata.restingHr,
        maxHr: user?.biodata.maxHr,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [track, setTrack] = useState<Studio3DTrack | null>(() => initialPicked?.track ?? null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>(
    () => initialPicked?.runId ?? '',
  );
  const [activeTab, setActiveTab] = useState<Studio3DTab>('pelari');
  const [runner, setRunner] = useState<RunnerConfig>(() => ({
    ...DEFAULT_RUNNER_CONFIG,
    runnerName: user?.biodata.fullName || user?.username || DEFAULT_RUNNER_CONFIG.runnerName,
  }));
  const [mapConfig, setMapConfig] = useState<MapConfig>(DEFAULT_MAP_CONFIG);
  const [exportConfig, setExportConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);
  const [mapReloadNonce, setMapReloadNonce] = useState(0);
  const [mapLoadStatus, setMapLoadStatus] = useState<MapLoadStatus>(INITIAL_MAP_LOAD_STATUS);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportPercent, setExportPercent] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportInfo, setLastExportInfo] = useState<{ filename: string; sizeMb: string } | null>(
    null,
  );
  const [customModelStatus, setCustomModelStatus] = useState<CustomGlbStatus>({
    loading: false,
    error: null,
    animationCount: 0,
    hasLocomotionClip: false,
    rigMode: 'static',
    detectedBones: 0,
  });
  const [savedAvatars, setSavedAvatars] = useState<SavedGlbAvatarSummary[]>([]);
  const [activeSavedAvatarId, setActiveSavedAvatarId] = useState<string | null>(null);
  const [avatarStorageNotice, setAvatarStorageNotice] = useState<string | null>(null);
  const [snappedTrack, setSnappedTrack] = useState<Studio3DTrack | null>(null);
  const [routeSnapStatus, setRouteSnapStatus] = useState<
    'idle' | 'matching' | 'matched' | 'fallback'
  >('idle');

  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (externalUploadTrigger > 0) fileInputRef.current?.click();
  }, [externalUploadTrigger]);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioEngineRef = useRef<Studio3DAudioEngine | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const activeModelBlobRef = useRef<Blob | null>(null);
  const snappedTrackCacheRef = useRef<Record<string, Studio3DTrack>>({});
  const hasAutoPickedGpsRef = useRef(Boolean(initialPicked));
  const latestBlobUrlsRef = useRef<{ audio: string | null; model: string | null }>({
    audio: null,
    model: null,
  });

  useEffect(() => {
    latestBlobUrlsRef.current = {
      audio: exportConfig.customAudioUrl,
      model: runner.customModelUrl,
    };
  }, [exportConfig.customAudioUrl, runner.customModelUrl]);

  const getAudioEngine = useCallback(() => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new Studio3DAudioEngine();
    }
    return audioEngineRef.current;
  }, []);

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
      audioEngineRef.current?.dispose();
      if (latestBlobUrlsRef.current.audio?.startsWith('blob:')) {
        URL.revokeObjectURL(latestBlobUrlsRef.current.audio);
      }
      if (latestBlobUrlsRef.current.model?.startsWith('blob:')) {
        URL.revokeObjectURL(latestBlobUrlsRef.current.model);
      }
    };
  }, []);

  useEffect(() => {
    if (track || hasAutoPickedGpsRef.current || runs.length === 0) return;
    const picked = pickInitialGpsTrackFromRuns(runs, user?.biodata.city || 'Indonesia', {
      restingHr: user?.biodata.restingHr,
      maxHr: user?.biodata.maxHr,
    });
    if (picked) {
      hasAutoPickedGpsRef.current = true;
      setSelectedHistoryId(picked.runId);
      setTrack(picked.track);
      setMapLoadStatus(INITIAL_MAP_LOAD_STATUS);
      setMapReloadNonce((n) => n + 1);
    }
  }, [runs, track, user?.biodata.city, user?.biodata.restingHr, user?.biodata.maxHr]);

  useEffect(() => {
    const resolvedName = user?.biodata.fullName || user?.username;
    if (!resolvedName) return;
    setRunner((prev) =>
      prev.runnerName === DEFAULT_RUNNER_CONFIG.runnerName
        ? { ...prev, runnerName: resolvedName }
        : prev,
    );
  }, [user?.biodata.fullName, user?.username]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [summaries, defaultRec] = await Promise.all([
          listSavedGlbAvatars(),
          getDefaultSavedGlbAvatar(),
        ]);
        if (cancelled) return;
        setSavedAvatars(summaries);
        if (defaultRec) {
          const url = URL.createObjectURL(defaultRec.blob);
          activeModelBlobRef.current = defaultRec.blob;
          setActiveSavedAvatarId(defaultRec.id);
          setRunner((prev) => {
            if (prev.customModelUrl && prev.customModelUrl.startsWith('blob:')) {
              URL.revokeObjectURL(prev.customModelUrl);
            }
            return {
              ...prev,
              characterStyle: 'custom-glb',
              customModelUrl: url,
              customModelName: defaultRec.name,
              customModelFlip180: defaultRec.flip180,
              customModelAnimMode: defaultRec.animMode,
            };
          });
        }
      } catch {
        // Ignore IndexedDB unavailability
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const effectiveVol = muted ? 0 : exportConfig.volume;
    void engine.configure(exportConfig.musicPreset, exportConfig.customAudioUrl, effectiveVol);
  }, [exportConfig.musicPreset, exportConfig.customAudioUrl, exportConfig.volume, muted]);

  useEffect(() => {
    if (!isPlaying || isExporting || !track) return;

    const totalSec = getExportDurationSec(exportConfig);
    let lastTs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      setProgress((prev) => {
        const next = prev + dtSec / totalSec;
        if (next >= 1) {
          setIsPlaying(false);
          audioEngineRef.current?.stop();
          return 1;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isExporting, exportConfig, track]);

  useEffect(() => {
    if (!track || (mapConfig.routeSnapMode ?? 'raw') !== 'snap-road') {
      setSnappedTrack(null);
      setRouteSnapStatus('idle');
      return;
    }
    const cached = snappedTrackCacheRef.current[track.id];
    if (cached) {
      setSnappedTrack(cached);
      setRouteSnapStatus('matched');
      return;
    }

    const controller = new AbortController();
    setRouteSnapStatus('matching');
    void fetchRoadSnappedTrack(track, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      if (res.matched) {
        snappedTrackCacheRef.current[track.id] = res.track;
        setSnappedTrack(res.track);
        setRouteSnapStatus('matched');
      } else {
        setSnappedTrack(null);
        setRouteSnapStatus('fallback');
      }
    });
    return () => controller.abort();
  }, [track, mapConfig.routeSnapMode]);

  const activeTrack = useMemo(() => {
    if (!track) return null;
    if ((mapConfig.routeSnapMode ?? 'raw') === 'snap-road' && snappedTrack?.id === track.id) {
      return {
        ...snappedTrack,
        title: track.title,
        date: track.date,
        location: track.location,
        landmarks: track.landmarks,
      };
    }
    return track;
  }, [track, snappedTrack, mapConfig.routeSnapMode]);

  const liveTelemetry = useMemo(
    () =>
      activeTrack
        ? sampleTrackTelemetryAtProgress(activeTrack, progress, exportConfig.includeFinishPose)
        : null,
    [activeTrack, progress, exportConfig.includeFinishPose],
  );

  
  useEffect(() => {
    if (!track || track.points.length === 0) return;
    const isRawCoords = /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(track.location.trim());
    if (!isRawCoords && track.location && track.location !== 'Indonesia') return;

    const controller = new AbortController();
    const pt = track.points[0];
    void fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${pt.lat}&lon=${pt.lon}&format=json&zoom=10&addressdetails=1`,
      {
        signal: controller.signal,
        headers: { 'Accept-Language': 'id,en' },
      },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        const addr = data.address || {};
        const cityOrRegency =
          addr.city ||
          addr.county ||
          addr.regency ||
          addr.municipality ||
          addr.town ||
          addr.state_district;
        const state = addr.state;
        const resolved = [cityOrRegency, state].filter(Boolean).join(', ');
        if (resolved) {
          setTrack((prev) => (prev && prev.id === track.id ? { ...prev, location: resolved } : prev));
        }
      })
      .catch(() => {
        // Fallback ke koordinat jika offline
      });

    return () => controller.abort();
  }, [track?.id]);

  
  useEffect(() => {
    if (!track || track.points.length < 3 || track.elevationGainM > 0) return;

    const controller = new AbortController();
    const pts = track.points;
    const sampleCount = Math.min(85, pts.length);
    const sampledIndices: number[] = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const idx = Math.round((i / Math.max(1, sampleCount - 1)) * (pts.length - 1));
      sampledIndices.push(idx);
    }

    const lats = sampledIndices.map((i) => pts[i].lat.toFixed(5)).join(',');
    const lons = sampledIndices.map((i) => pts[i].lon.toFixed(5)).join(',');

    void fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
      { signal: controller.signal },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.elevation) || controller.signal.aborted) return;
        const elevSamples: number[] = data.elevation.map((v: unknown) =>
          typeof v === 'number' && Number.isFinite(v) ? v : 0,
        );
        if (elevSamples.length !== sampledIndices.length) return;

        // Interpolasi elevasi ke semua titik rute & hitung total elevation gain (threshold 1.5m anti-noise)
        const updatedPoints = pts.map((pt, ptIdx) => {
          let sPos = 0;
          while (sPos < sampledIndices.length - 2 && sampledIndices[sPos + 1] < ptIdx) {
            sPos += 1;
          }
          const idx0 = sampledIndices[sPos];
          const idx1 = sampledIndices[Math.min(sampledIndices.length - 1, sPos + 1)];
          const t = idx1 > idx0 ? (ptIdx - idx0) / (idx1 - idx0) : 0;
          const elev = elevSamples[sPos] + (elevSamples[Math.min(elevSamples.length - 1, sPos + 1)] - elevSamples[sPos]) * t;
          return { ...pt, elevationM: Math.round(elev * 10) / 10 };
        });

        let gain = 0;
        let minE = updatedPoints[0].elevationM;
        let maxE = updatedPoints[0].elevationM;
        let anchorE = updatedPoints[0].elevationM;

        for (let i = 1; i < updatedPoints.length; i += 1) {
          const e = updatedPoints[i].elevationM;
          if (e < minE) minE = e;
          if (e > maxE) maxE = e;
          const diff = e - anchorE;
          if (diff >= 1.8) {
            gain += diff;
            anchorE = e;
          } else if (diff <= -1.8) {
            anchorE = e;
          }
        }

        const roundedGain = Math.round(gain);
        if (roundedGain > 0) {
          setTrack((prev) =>
            prev && prev.id === track.id
              ? {
                  ...prev,
                  points: updatedPoints,
                  elevationGainM: roundedGain,
                  minElevationM: Math.round(minE),
                  maxElevationM: Math.round(maxE),
                }
              : prev,
          );
        }
      })
      .catch(() => {
        // Abaikan jika offline
      });

    return () => controller.abort();
  }, [track?.id]);

  
  const effectiveOverlayTextColor =
    !mapConfig.overlayTextColor || mapConfig.overlayTextColor === 'auto'
      ? mapConfig.mapStyle === 'dark' || mapConfig.mapStyle === 'satellite'
        ? '#FFFFFF'
        : '#0F172A'
      : mapConfig.overlayTextColor;
  const isDarkOverlayText =
    effectiveOverlayTextColor.toLowerCase() === '#0f172a' ||
    effectiveOverlayTextColor.toLowerCase() === '#000000' ||
    effectiveOverlayTextColor.toLowerCase() === '#1e293b';
  const overlayTextShadow = isDarkOverlayText
    ? '0 1px 2px rgba(255,255,255,0.92), 0 0 6px rgba(255,255,255,0.88)'
    : '0 1px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)';

  const allKmSplits = useMemo(() => (activeTrack ? computeTrackKmSplits(activeTrack) : []), [activeTrack]);

  const visibleKmSplits = useMemo(
    () =>
      liveTelemetry
        ? getCompletedKmSplits(allKmSplits, liveTelemetry.distanceKm, liveTelemetry.isFinishPhase)
        : [],
    [allKmSplits, liveTelemetry],
  );

  const bannerState = useMemo(
    () => computeStartFinishBannerState(progress, exportConfig.includeFinishPose),
    [progress, exportConfig.includeFinishPose],
  );

  const miniMap = useMemo(() => {
    if (!activeTrack) return null;
    const finishThreshold = exportConfig.includeFinishPose ? 0.88 : 1.0;
    const routeP = Math.min(1, Math.max(0, progress / finishThreshold));
    return computeMiniMapGeometry(activeTrack, routeP, 64, 9);
  }, [activeTrack, progress, exportConfig.includeFinishPose]);

  const handleTogglePlay = async () => {
    if (isExporting || !track) return;
    const engine = getAudioEngine();
    if (isPlaying) {
      setIsPlaying(false);
      engine.stop();
      return;
    }

    if (progress >= 0.995) {
      setProgress(0);
    }
    setIsPlaying(true);
    await engine.configure(
      exportConfig.musicPreset,
      exportConfig.customAudioUrl,
      muted ? 0 : exportConfig.volume,
    );
    if (!muted && exportConfig.musicPreset !== 'none') {
      await engine.start();
    }
  };

  const handleRestart = async () => {
    if (isExporting || !track) return;
    setProgress(0);
    setMapConfig((prev) => ({ ...prev, cameraMode: 'auto' }));
    if (isPlaying) {
      const engine = getAudioEngine();
      engine.stop();
      if (!muted && exportConfig.musicPreset !== 'none') {
        await engine.start();
      }
    }
  };

  const handleSelectHistoryRun = (runId: string) => {
    setSelectedHistoryId(runId);
    if (!runId) return;
    const found = runs.find((r) => r.id === runId);
    if (!found) return;
    hasAutoPickedGpsRef.current = true;
    setInputError(null);
    setIsPlaying(false);
    audioEngineRef.current?.stop();
    setProgress(0);
    setMapLoadStatus(INITIAL_MAP_LOAD_STATUS);
    setMapReloadNonce((n) => n + 1);
    setTrack(
      createTrackFromRunLog(found, user?.biodata.city || 'Indonesia', {
        restingHr: user?.biodata.restingHr,
        maxHr: user?.biodata.maxHr,
      }),
    );
  };

  const handleFileUpload = async (file: File) => {
    setInputError(null);
    const lower = file.name.toLowerCase();
    const bioHints = {
      restingHr: user?.biodata.restingHr,
      maxHr: user?.biodata.maxHr,
    };
    try {
      let nextTrack: Studio3DTrack;
      if (lower.endsWith('.fit')) {
        const buffer = await file.arrayBuffer();
        nextTrack = parseFitArrayBuffer(buffer, file.name, bioHints);
      } else if (lower.endsWith('.gpx')) {
        const text = await file.text();
        nextTrack = parseGpxToStudio3DTrack(text, file.name, bioHints);
      } else {
        throw new Error('Format file harus .FIT atau .GPX.');
      }

      hasAutoPickedGpsRef.current = true;
      setIsPlaying(false);
      audioEngineRef.current?.stop();
      setProgress(0);
      setSelectedHistoryId('');
      setMapLoadStatus(INITIAL_MAP_LOAD_STATUS);
      setMapReloadNonce((n) => n + 1);
      setTrack(nextTrack);
    } catch (err) {
      setInputError(
        err instanceof Error ? err.message : 'Gagal membaca file .FIT / .GPX.',
      );
    }
  };

  const handleSelectGlbFile = async (file: File, replaceSavedId?: string) => {
    setAvatarStorageNotice(null);
    if (!isSupportedGlbFilename(file.name)) {
      setAvatarStorageNotice('Format avatar harus .GLB atau .GLTF.');
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    activeModelBlobRef.current = file;
    setRunner((prev) => {
      if (prev.customModelUrl && prev.customModelUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.customModelUrl);
      }
      return {
        ...prev,
        characterStyle: 'custom-glb',
        customModelUrl: blobUrl,
        customModelName: file.name,
      };
    });

    if (replaceSavedId) {
      try {
        const updated = await replaceGlbAvatar(replaceSavedId, file, {
          name: file.name,
          flip180: Boolean(runner.customModelFlip180),
          animMode: runner.customModelAnimMode ?? 'auto',
          makeDefault: true,
        });
        setActiveSavedAvatarId(updated.id);
        setSavedAvatars(await listSavedGlbAvatars());
        setAvatarStorageNotice(`Avatar diganti & disimpan: ${updated.name} (${formatAvatarSizeMb(updated.sizeBytes)})`);
      } catch (err) {
        setAvatarStorageNotice(
          err instanceof Error ? err.message : 'Gagal mengganti avatar tersimpan.',
        );
      }
    } else {
      setActiveSavedAvatarId(null);
      setAvatarStorageNotice(`Model aktif: ${file.name}. Klik Simpan agar tersimpan permanen.`);
    }
  };

  const handleSaveCurrentGlbAvatar = async () => {
    setAvatarStorageNotice(null);
    if (!runner.customModelUrl) return;
    try {
      let blob = activeModelBlobRef.current;
      if (!blob) {
        const resp = await fetch(runner.customModelUrl);
        blob = await resp.blob();
        activeModelBlobRef.current = blob;
      }

      if (activeSavedAvatarId) {
        const updated = await updateSavedGlbAvatarSettings(activeSavedAvatarId, {
          flip180: Boolean(runner.customModelFlip180),
          animMode: runner.customModelAnimMode ?? 'auto',
          makeDefault: true,
        });
        if (updated) {
          setSavedAvatars(await listSavedGlbAvatars());
          setAvatarStorageNotice(`Pengaturan avatar "${updated.name}" diperbarui.`);
          return;
        }
      }

      const saved = await saveGlbAvatar(blob, {
        name: runner.customModelName || 'Avatar_Pelari.glb',
        flip180: Boolean(runner.customModelFlip180),
        animMode: runner.customModelAnimMode ?? 'auto',
        makeDefault: true,
      });
      setActiveSavedAvatarId(saved.id);
      setSavedAvatars(await listSavedGlbAvatars());
      setAvatarStorageNotice(`Avatar "${saved.name}" tersimpan (${formatAvatarSizeMb(saved.sizeBytes)}).`);
    } catch (err) {
      setAvatarStorageNotice(
        err instanceof Error ? err.message : 'Gagal menyimpan avatar .GLB.',
      );
    }
  };

  const handleLoadSavedGlbAvatar = async (id: string) => {
    setAvatarStorageNotice(null);
    try {
      const rec = await getSavedGlbAvatar(id);
      if (!rec) {
        setAvatarStorageNotice('Avatar tersimpan tidak ditemukan.');
        return;
      }
      await updateSavedGlbAvatarSettings(id, { makeDefault: true });
      const blobUrl = URL.createObjectURL(rec.blob);
      activeModelBlobRef.current = rec.blob;
      setActiveSavedAvatarId(rec.id);
      setRunner((prev) => {
        if (prev.customModelUrl && prev.customModelUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prev.customModelUrl);
        }
        return {
          ...prev,
          characterStyle: 'custom-glb',
          customModelUrl: blobUrl,
          customModelName: rec.name,
          customModelFlip180: rec.flip180,
          customModelAnimMode: rec.animMode,
        };
      });
      setSavedAvatars(await listSavedGlbAvatars());
      setAvatarStorageNotice(`Memuat avatar "${rec.name}" (${formatAvatarSizeMb(rec.sizeBytes)}).`);
    } catch (err) {
      setAvatarStorageNotice(
        err instanceof Error ? err.message : 'Gagal memuat avatar tersimpan.',
      );
    }
  };

  const handleDeleteSavedGlbAvatar = async (id: string) => {
    setAvatarStorageNotice(null);
    try {
      await deleteSavedGlbAvatar(id);
      const nextList = await listSavedGlbAvatars();
      setSavedAvatars(nextList);
      if (activeSavedAvatarId === id) {
        setActiveSavedAvatarId(null);
      }
      setAvatarStorageNotice('Avatar dihapus dari daftar tersimpan.');
    } catch (err) {
      setAvatarStorageNotice(
        err instanceof Error ? err.message : 'Gagal menghapus avatar tersimpan.',
      );
    }
  };

  const handleClearGlbModel = () => {
    setAvatarStorageNotice(null);
    activeModelBlobRef.current = null;
    setActiveSavedAvatarId(null);
    setRunner((prev) => {
      if (prev.customModelUrl && prev.customModelUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.customModelUrl);
      }
      return {
        ...prev,
        characterStyle: 'realistic',
        customModelUrl: null,
        customModelName: null,
      };
    });
  };

  const handleQuickCamera = (mode: CameraMode3D) => {
    setMapConfig((prev) => ({ ...prev, cameraMode: mode }));
    if (mode === 'finish-pose' && progress < 0.88) {
      setProgress(exportConfig.includeFinishPose ? 0.92 : 0.99);
    }
  };

  const handleReloadMap = useCallback(() => {
    if (!track) return;
    setMapLoadStatus(INITIAL_MAP_LOAD_STATUS);
    setMapReloadNonce((n) => n + 1);
  }, [track]);

  const handleStartExport = async () => {
    if (!activeTrack) return;
    setExportError(null);
    setLastExportInfo(null);
    setIsPlaying(false);
    audioEngineRef.current?.stop();

    const abortController = new AbortController();
    exportAbortRef.current = abortController;
    setIsExporting(true);
    setExportPercent(0);
    setMapConfig((prev) => ({
      ...prev,
      cameraMode: prev.cameraMode === 'finish-pose' ? 'auto' : prev.cameraMode,
    }));

    try {
      const engine = getAudioEngine();
      const result = await recordStudio3DVideo({
        getSourceCanvas: () => webglCanvasRef.current,
        getMapCanvas: () => mapCanvasRef.current,
        setProgress: (nextP) => setProgress(nextP),
        audioEngine: engine,
        track: activeTrack,
        runner,
        exportConfig: {
          ...exportConfig,
          volume: muted ? 0 : exportConfig.volume,
        },
        onPercent: (pct) => setExportPercent(pct),
        abortSignal: abortController.signal,
      });

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      setLastExportInfo({
        filename: result.filename,
        sizeMb: (result.blob.size / (1024 * 1024)).toFixed(2),
      });
    } catch (err) {
      if (!abortController.signal.aborted) {
        setExportError(
          err instanceof Error ? err.message : 'Gagal mengekspor video 9:16.',
        );
      }
    } finally {
      setIsExporting(false);
      exportAbortRef.current = null;
    }
  };

  const handleCancelExport = () => {
    exportAbortRef.current?.abort();
    audioEngineRef.current?.stop();
    setIsExporting(false);
  };

  const isMapLoading = mapLoadStatus.phase === 'loading';

  return (
    <div data-testid="view-studio3d" className="space-y-4">
      <header className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 shadow-xs space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {track ? (
              <p
                data-testid="studio3d-top-summary"
                className="font-mono-tabular text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap"
              >
                <span className="font-bold text-slate-900 dark:text-white">
                  {track.totalDistanceKm.toFixed(2)} km
                </span>
                <span className="text-slate-400">·</span>
                <span>{formatDuration(track.totalDurationSec)}</span>
                <span className="text-slate-400">·</span>
                <span>{formatPace(track.avgPaceSecPerKm)}/km</span>
                <span className="text-slate-400">·</span>
                <span>{track.avgHr} bpm</span>
                <span className="text-slate-400">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{track.elevationGainM}m
                </span>
              </p>
            ) : (
              <p
                data-testid="studio3d-top-summary"
                className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate"
              >
                {t3d.guestUploadHint}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".fit,.gpx"
              className="hidden"
              data-testid="studio3d-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f);
                e.target.value = '';
              }}
            />

            {runs.length > 0 && (
              <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
                <History className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <select
                  aria-label="Pilih dari Riwayat Lari"
                  value={selectedHistoryId}
                  onChange={(e) => handleSelectHistoryRun(e.target.value)}
                  className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none max-w-[180px] cursor-pointer"
                >
                  <option value="">Riwayat Lari...</option>
                  {runs.slice(0, 25).map((r) => {
                    const hasGps = Array.isArray(r.telemetryPoints) && r.telemetryPoints.length >= 2;
                    return (
                      <option key={r.id} value={r.id} className="dark:bg-slate-900">
                        {r.date} · {r.distanceKm.toFixed(2)}km ({r.paceStr}){hasGps ? ' [GPS]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        </div>

        {inputError && (
          <div
            role="alert"
            className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            {inputError}
          </div>
        )}
      </header>

      <section
        data-testid="studio3d-preview-stage"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col items-center gap-3.5"
      >
        <div className="w-full max-w-[780px] flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
          <div
            data-testid="studio3d-map-status"
            className="font-mono-tabular text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5 min-w-0 truncate"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                !track
                  ? 'bg-slate-400'
                  : isMapLoading
                    ? 'bg-amber-500'
                    : mapLoadStatus.phase === 'ready'
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
              }`}
            />
            <span className="truncate">
              {!track
                ? 'Upload GPX/FIT'
                : isMapLoading
                  ? 'Memuat peta...'
                  : mapLoadStatus.phase === 'ready'
                    ? 'OpenFreeMap'
                    : 'Gagal muat'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMapConfig((prev) => ({ ...prev, mapStyle: 'clean' }))}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                mapConfig.mapStyle === 'clean'
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300'
              }`}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => setMapConfig((prev) => ({ ...prev, mapStyle: 'dark' }))}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                mapConfig.mapStyle === 'dark'
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300'
              }`}
            >
              Night
            </button>
            <button
              type="button"
              onClick={() =>
                setMapConfig((prev) => ({ ...prev, buildings3d: !prev.buildings3d }))
              }
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                mapConfig.buildings3d
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400'
              }`}
            >
              {mapConfig.buildings3d ? '3D ON' : '3D OFF'}
            </button>
            <button
              type="button"
              data-testid="studio3d-reload-map-btn"
              disabled={!track}
              onClick={handleReloadMap}
              className="h-7 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 dark:text-slate-100 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-3 h-3 text-blue-600 dark:text-blue-400 ${
                  track && isMapLoading ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
              <span>Muat</span>
            </button>
          </div>
        </div>

        <div className="w-full max-w-[350px] sm:max-w-[370px] rounded-[36px] p-2.5 bg-slate-900 dark:bg-slate-800 border-4 border-slate-800 dark:border-slate-700 shadow-2xl">
          <div
            data-testid="studio3d-phone-screen"
            className="relative w-full aspect-[9/16] rounded-[26px] overflow-hidden bg-slate-950 select-none"
          >
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 rounded-full bg-slate-950/90 border border-white/10 z-20" />

            {!activeTrack || !liveTelemetry ? (
              <div
                data-testid="studio3d-empty-track"
                className="w-full h-full flex flex-col items-center justify-center text-center px-6 gap-4 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                  <FileUp className="w-7 h-7" aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-display text-base font-bold text-white">
                    Belum Ada Rute GPS
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Upload file <strong>.FIT</strong> atau <strong>.GPX</strong> untuk merender peta dunia nyata 3D tanpa rute contoh bawaan.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="studio3d-empty-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-2 shadow-lg transition-colors cursor-pointer"
                >
                  <FileUp className="w-4 h-4" aria-hidden="true" />
                  <span>Upload .FIT / .GPX</span>
                </button>
              </div>
            ) : (
              <>
                <div className="absolute inset-0">
                  <Studio3DCanvas
                    track={activeTrack}
                    runner={runner}
                    mapConfig={mapConfig}
                    timelineProgress={progress}
                    isPlaying={isPlaying || isExporting}
                    includeFinishPose={exportConfig.includeFinishPose}
                    currentCadence={liveTelemetry.point.cadence}
                    currentPaceSec={liveTelemetry.point.paceSecPerKm}
                    mapReloadNonce={mapReloadNonce}
                    onMapLoadStatus={setMapLoadStatus}
                    onCanvasReady={(c) => {
                      webglCanvasRef.current = c;
                    }}
                    onMapCanvasReady={(c) => {
                      mapCanvasRef.current = c;
                    }}
                    onCustomModelStatus={setCustomModelStatus}
                  />
                </div>

                <div
                  className="pointer-events-none absolute top-0 inset-x-0 pt-5 pb-2 px-3 z-10"
                  style={{
                    color: (mapConfig.overlayBox ?? true) ? '#FFFFFF' : effectiveOverlayTextColor,
                    textShadow: (mapConfig.overlayBox ?? true)
                      ? '0 1px 3px rgba(0,0,0,0.85)'
                      : overlayTextShadow,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`h-14 flex flex-col justify-between min-w-0 flex-1 transition-all duration-200 ${
                        (mapConfig.overlayBox ?? true)
                          ? 'rounded-xl bg-slate-950/55 backdrop-blur-xs border border-white/25 px-2.5 py-1.5 shadow-md'
                          : 'py-0.5'
                      }`}
                    >
                      <p
                        className="font-mono-tabular text-[10px] font-extrabold tracking-wide truncate leading-none"
                        style={{ color: mapConfig.overlayColor || '#F97316' }}
                      >
                        {(runner.runnerName || 'Atlet Kalcer').trim()}
                      </p>
                      <p className="font-display text-[13px] font-bold truncate leading-tight">
                        {activeTrack.title}
                      </p>
                      <p className="font-mono-tabular text-[9px] font-medium opacity-90 truncate leading-none">
                        {activeTrack.location?.trim()
                          ? `${activeTrack.date} · ${activeTrack.location.trim()}`
                          : activeTrack.date}
                      </p>
                    </div>

                    {miniMap && (
                      <div
                        data-testid="studio3d-gps-minimap"
                        className="w-14 h-14 rounded-xl bg-slate-950/55 backdrop-blur-xs border border-white/25 shadow-md overflow-hidden shrink-0 relative"
                      >
                        <span className="absolute top-1 left-1.5 font-mono-tabular text-[7px] font-bold text-slate-200 leading-none">
                          GPS
                        </span>
                        <svg
                          viewBox="0 0 64 64"
                          className="w-full h-full block"
                          aria-hidden="true"
                        >
                          <polyline
                            fill="none"
                            stroke={mapConfig.overlayColor || '#F97316'}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={miniMap.polyline.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')}
                          />
                          <circle
                            cx={miniMap.startPt.x}
                            cy={miniMap.startPt.y}
                            r="2.4"
                            fill="#A3E635"
                          />
                          <circle
                            cx={miniMap.runnerPt.x}
                            cy={miniMap.runnerPt.y}
                            r="3.2"
                            fill="#FFFFFF"
                            stroke={mapConfig.overlayColor || '#F97316'}
                            strokeWidth="1.4"
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  {visibleKmSplits.length > 0 && (
                    <div
                      data-testid="studio3d-km-splits"
                      className="mt-2 flex flex-col items-start gap-1"
                    >
                      {visibleKmSplits.map((sp, idx) => {
                        const isNewest =
                          idx === visibleKmSplits.length - 1 && bannerState.finishAlpha <= 0.15;
                        return (
                          <div
                            key={sp.index}
                            className={`font-mono-tabular text-[9px] font-bold inline-flex items-center gap-1.5 transition-all ${
                              (mapConfig.overlayBox ?? true)
                                ? `rounded-md bg-slate-950/52 backdrop-blur-xs px-2 py-0.5 border ${
                                    isNewest ? 'border-lime-400/60' : 'border-white/20'
                                  }`
                                : ''
                            }`}
                          >
                            <span
                              style={!isNewest ? { color: mapConfig.overlayColor || '#F97316' } : undefined}
                              className={`font-extrabold ${isNewest ? 'text-lime-400' : ''}`}
                            >
                              KM {sp.label}
                            </span>
                            <span>{formatPace(sp.avgPaceSecPerKm)}/km</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div
                  className="pointer-events-none absolute bottom-0 inset-x-0 pb-3 px-3 z-10"
                  style={{
                    color: (mapConfig.overlayBox ?? true) ? '#FFFFFF' : effectiveOverlayTextColor,
                    textShadow: (mapConfig.overlayBox ?? true)
                      ? '0 1px 3px rgba(0,0,0,0.85)'
                      : overlayTextShadow,
                  }}
                >
                  {bannerState.finishAlpha > 0.15 ? (
                    <div
                      data-testid="studio3d-finish-banner"
                      className={`space-y-2 text-center transition-all duration-200 ${
                        (mapConfig.overlayBox ?? true)
                          ? 'rounded-2xl bg-slate-950/58 backdrop-blur-xs border border-white/25 px-3 py-2.5 shadow-lg'
                          : ''
                      }`}
                      style={{
                        opacity: bannerState.finishAlpha,
                        transform: `translateY(${(bannerState.finishOffsetY * 0.35).toFixed(1)}px)`,
                      }}
                    >
                      <div className="space-y-0.5">
                        <p
                          className="font-mono-tabular text-[8px] font-extrabold tracking-widest uppercase"
                          style={{ color: mapConfig.overlayColor || '#F97316' }}
                        >
                          Activity Completed
                        </p>
                        <p className="font-display text-xs font-bold truncate">
                          {(runner.runnerName || 'Atlet Kalcer').trim()} · {activeTrack.title}
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            DISTANCE
                          </span>
                          <span className="font-mono-tabular text-xs font-extrabold">
                            {activeTrack.totalDistanceKm.toFixed(2)} km
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            AVG PACE
                          </span>
                          <span className="font-mono-tabular text-xs font-extrabold">
                            {formatPace(activeTrack.avgPaceSecPerKm)} /km
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            TIME
                          </span>
                          <span className="font-mono-tabular text-xs font-extrabold">
                            {formatDuration(activeTrack.totalDurationSec)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-white/15 text-center">
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            AVG HR
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {activeTrack.avgHr} bpm
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            CADENCE
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {activeTrack.avgCadence} spm
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            ELEV GAIN
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            +{activeTrack.elevationGainM} m
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`space-y-1.5 transition-all duration-200 ${
                        (mapConfig.overlayBox ?? true)
                          ? 'rounded-2xl bg-slate-950/56 backdrop-blur-xs border border-white/25 px-3 py-2 shadow-lg'
                          : ''
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0 truncate">
                          <span className="font-mono-tabular text-sm font-extrabold">
                            {liveTelemetry.distanceKm.toFixed(2)}
                          </span>
                          <span
                            className="font-mono-tabular text-[9px] font-bold ml-1"
                            style={{ color: mapConfig.overlayColor || '#F97316' }}
                          >
                            / {activeTrack.totalDistanceKm.toFixed(2)} KM
                          </span>
                        </div>
                        <span className="font-mono-tabular text-[10px] font-bold shrink-0">
                          {formatDuration(liveTelemetry.elapsedSec)}
                        </span>
                      </div>

                      <div className="w-full h-1 rounded-full bg-white/25 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-[width] duration-75"
                          style={{
                            width: `${Math.max(2, Math.min(100, progress * 100))}%`,
                            backgroundColor: mapConfig.overlayColor || '#F97316',
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-x-1.5 gap-y-1 text-center">
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            PACE (/KM)
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {formatPace(liveTelemetry.point.paceSecPerKm)} /km
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            HEART RATE
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {liveTelemetry.point.hr} bpm
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            CADENCE
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {liveTelemetry.point.cadence} spm
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            DISTANCE
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {liveTelemetry.distanceKm.toFixed(2)} km
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            ELEV GAIN
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            +{liveTelemetry.elevGainSoFarM} m
                          </span>
                        </div>
                        <div>
                          <span className="block font-mono-tabular text-[8px] opacity-80">
                            TIME
                          </span>
                          <span className="font-mono-tabular text-[10px] font-bold">
                            {formatDuration(liveTelemetry.elapsedSec)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
</>
            )}
          </div>
        </div>

        <div className="w-full max-w-[370px] flex items-center gap-2">
          <button
            type="button"
            data-testid="studio3d-play-btn"
            onClick={handleTogglePlay}
            disabled={isExporting || !track}
            aria-label={isPlaying ? 'Pause animasi' : 'Putar animasi'}
            className="w-9 h-9 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            data-testid="studio3d-restart-btn"
            onClick={handleRestart}
            disabled={isExporting || !track}
            aria-label="Ulang dari awal"
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.002}
            value={progress}
            disabled={isExporting || !track}
            aria-label="Progress animasi 3D"
            data-testid="studio3d-progress-slider"
            onChange={(e) => setProgress(Number(e.target.value))}
            className="flex-1 accent-orange-500 cursor-pointer disabled:opacity-50"
          />

          <span className="font-mono-tabular text-[11px] font-semibold text-slate-600 dark:text-slate-300 w-9 text-right shrink-0">
            {Math.round(progress * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Nyalakan audio' : 'Matikan audio'}
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center shrink-0 cursor-pointer"
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-500" aria-hidden="true" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="w-full max-w-[780px] pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center gap-2.5">
          <div className="w-full flex items-center gap-1.5 overflow-x-auto pb-1">
            {(
              [
                { id: 'auto', label: 'Auto', icon: <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'follow-chase', label: 'Ikut Jalan 3/4', icon: <Navigation className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'drone', label: 'Drone 61°', icon: <Camera className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'drone-180', label: 'Drone 180°', icon: <Orbit className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'follow-20m', label: 'Kamera Atas', icon: <Video className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'birds-eye', label: "Bird's-Eye", icon: <Eye className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'overview', label: 'Overview', icon: <Compass className="w-3.5 h-3.5" aria-hidden="true" /> },
                { id: 'finish-pose', label: 'Finish', icon: <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> },
              ] as Array<{ id: CameraMode3D; label: string; icon: React.ReactNode }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                data-testid={`studio3d-cam-${btn.id}`}
                onClick={() => handleQuickCamera(btn.id)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  mapConfig.cameraMode === btn.id
                    ? 'bg-slate-900 dark:bg-orange-500 text-white'
                    : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {btn.icon}
                <span>{btn.label}</span>
              </button>
            ))}
          </div>

          {mapConfig.cameraMode === 'follow-20m' && (
            <div
              data-testid="studio3d-20m-angles"
              className="flex flex-wrap items-center justify-center gap-1.5"
            >
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1">
                Arah Atas:
              </span>
              {(
                [
                  { id: 'front', label: 'Depan' },
                  { id: 'back', label: 'Belakang' },
                  { id: 'side', label: 'Samping' },
                  { id: 'orbit', label: 'Berputar' },
                ] as Array<{ id: Camera20mAngle; label: string }>
              ).map((ang) => (
                <button
                  key={ang.id}
                  type="button"
                  data-testid={`studio3d-20m-${ang.id}`}
                  onClick={() => setMapConfig((prev) => ({ ...prev, camera20mAngle: ang.id }))}
                  className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    mapConfig.camera20mAngle === ang.id
                      ? 'bg-orange-500 text-white'
                      : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {ang.label}
                </button>
              ))}
            </div>
          )}

          <div className="w-full max-w-[440px] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[185px]">
              <ZoomIn className="w-3.5 h-3.5 text-blue-500 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                Zoom
              </span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={mapConfig.cameraZoom ?? 1.0}
                aria-label="Zoom Kamera 3D"
                data-testid="studio3d-quick-zoom-slider"
                onChange={(e) =>
                  setMapConfig((prev) => ({ ...prev, cameraZoom: Number(e.target.value) }))
                }
                className="flex-1 accent-orange-500 cursor-pointer"
              />
              <span className="font-mono-tabular text-[11px] font-bold text-slate-800 dark:text-slate-100 w-9 text-right shrink-0">
                {(mapConfig.cameraZoom ?? 1.0).toFixed(1)}×
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0 border-l border-slate-200 dark:border-slate-700 pl-3">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-0.5">
                Pelari:
              </span>
              {(
                [
                  { id: 'small', label: 'S' },
                  { id: 'medium', label: 'M' },
                  { id: 'large', label: 'L' },
                ] as Array<{ id: CharacterSize3D; label: string }>
              ).map((sz) => (
                <button
                  key={sz.id}
                  type="button"
                  data-testid={`studio3d-quick-size-${sz.id}`}
                  onClick={() => setRunner((prev) => ({ ...prev, characterSize: sz.id }))}
                  title={
                    sz.id === 'small'
                      ? 'Ukuran Kecil (Proporsional)'
                      : sz.id === 'medium'
                        ? 'Ukuran Sedang'
                        : 'Ukuran Besar'
                  }
                  className={`w-7 h-6 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    runner.characterSize === sz.id
                      ? 'bg-orange-500 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {sz.label}
                </button>
              ))}
            </div>
          </div>
                <div className="w-full max-w-[780px] flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="font-mono-tabular text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              Teks:
            </span>
            <button
              type="button"
              onClick={() =>
                setMapConfig((prev) => ({ ...prev, overlayBox: !(prev.overlayBox ?? true) }))
              }
              className={`px-2 py-0.5 rounded-md font-semibold text-[10px] border transition-colors cursor-pointer ${
                (mapConfig.overlayBox ?? true)
                  ? 'bg-slate-800 text-white border-slate-700 dark:bg-slate-700'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
              title="Toggle Kotak Kaca Overlay"
            >
              Kotak {(mapConfig.overlayBox ?? true) ? 'ON' : 'OFF'}
            </button>
            {[
              { val: 'auto', label: 'Auto' },
              { val: '#FFFFFF', label: 'Putih' },
              { val: '#0F172A', label: 'Hitam' },
            ].map((opt) => {
              const active = (mapConfig.overlayTextColor || 'auto') === opt.val;
              return (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() =>
                    setMapConfig((prev) => ({ ...prev, overlayTextColor: opt.val }))
                  }
                  className={`px-2 py-0.5 rounded-md font-semibold text-[10px] border transition-colors cursor-pointer ${
                    active
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <input
              type="color"
              title="Custom Warna Teks Overlay"
              value={
                !mapConfig.overlayTextColor || mapConfig.overlayTextColor === 'auto'
                  ? effectiveOverlayTextColor
                  : mapConfig.overlayTextColor
              }
              onChange={(e) =>
                setMapConfig((prev) => ({ ...prev, overlayTextColor: e.target.value }))
              }
              className="w-5 h-5 rounded border border-slate-300 dark:border-slate-700 bg-transparent p-0 cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono-tabular text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              Garis:
            </span>
            {['#F97316', '#0F172A', '#38BDF8', '#A3E635', '#F43F5E'].map((hex) => {
              const active = (mapConfig.overlayColor || '#F97316').toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() =>
                    setMapConfig((prev) => ({ ...prev, overlayColor: hex }))
                  }
                  className={`w-4 h-4 rounded-full border transition-transform cursor-pointer ${
                    active ? 'scale-125 border-slate-900 dark:border-white' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
            <input
              type="color"
              title="Custom Warna Garis & Aksen"
              value={mapConfig.overlayColor || '#F97316'}
              onChange={(e) =>
                setMapConfig((prev) => ({ ...prev, overlayColor: e.target.value }))
              }
              className="w-5 h-5 rounded border border-slate-300 dark:border-slate-700 bg-transparent p-0 cursor-pointer"
            />
          </div>
        </div>
        </div>
      </section>

      <Studio3DPanelTabs
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        runner={runner}
        onChangeRunner={setRunner}
        customModelStatus={customModelStatus}
        savedAvatars={savedAvatars}
        activeSavedAvatarId={activeSavedAvatarId}
        avatarStorageNotice={avatarStorageNotice}
        onSelectGlbFile={(file, replaceId) => {
          void handleSelectGlbFile(file, replaceId);
        }}
        onSaveCurrentGlbAvatar={() => {
          void handleSaveCurrentGlbAvatar();
        }}
        onLoadSavedGlbAvatar={(id) => {
          void handleLoadSavedGlbAvatar(id);
        }}
        onDeleteSavedGlbAvatar={(id) => {
          void handleDeleteSavedGlbAvatar(id);
        }}
        onClearGlbModel={handleClearGlbModel}
        mapConfig={mapConfig}
        onChangeMapConfig={setMapConfig}
        mapLoadStatus={mapLoadStatus}
        routeSnapStatus={routeSnapStatus}
        onReloadMap={handleReloadMap}
        exportConfig={exportConfig}
        onChangeExportConfig={setExportConfig}
        track={activeTrack}
        onUpdateTrackInfo={(patch) =>
          setTrack((prev) => (prev ? { ...prev, ...patch } : prev))
        }
        onAddCustomLandmark={(label, lmProgress) => {
          setTrack((prev) => {
            if (!prev) return prev;
            const pt = sampleTrackPointByDistance(prev.points, prev.totalDistanceKm, lmProgress);
            return {
              ...prev,
              landmarks: [
                ...prev.landmarks,
                {
                  id: `lm-custom-${Date.now()}`,
                  label,
                  type: 'custom',
                  progress: lmProgress,
                  distanceKm: Math.round(pt.distanceKm * 100) / 100,
                  elevationM: Math.round(pt.elevationM),
                },
              ],
            };
          });
        }}
        onRemoveLandmark={(id) =>
          setTrack((prev) =>
            prev
              ? {
                  ...prev,
                  landmarks: prev.landmarks.filter((lm) => lm.id !== id),
                }
              : prev,
          )
        }
        isExporting={isExporting}
        exportPercent={exportPercent}
        exportError={exportError}
        lastExportInfo={lastExportInfo}
        onStartExport={handleStartExport}
        onCancelExport={handleCancelExport}
      />
    </div>
  );
};
