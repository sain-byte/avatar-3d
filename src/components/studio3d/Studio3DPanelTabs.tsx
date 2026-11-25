import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Check,
  Download,
  Film,
  Map as MapIcon,
  MapPin,
  Music,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  CharacterStyle3D,
  CustomModelAnimMode,
  DurationPresetSec,
  ExportConfig,
  FinishPoseStyle3D,
  GaitMode3D,
  LightingMood3D,
  MapConfig,
  MapLoadStatus,
  MusicPreset3D,
  RouteSnapMode3D,
  RouteVisualStyle3D,
  RunnerAccessory,
  RunnerConfig,
  RunnerGender,
  RunnerHairStyle,
  Studio3DTrack,
  VideoQuality3D,
} from '../../types/studio3d';
import {
  formatAvatarSizeMb,
  type SavedGlbAvatarSummary,
} from '../../utils/studio3dAvatarStorage';
import type { CustomGlbStatus } from './CustomGlbRunner3D';

export type Studio3DTab = 'pelari' | 'peta' | 'export';

interface Studio3DPanelTabsProps {
  activeTab: Studio3DTab;
  onChangeTab: (tab: Studio3DTab) => void;
  runner: RunnerConfig;
  onChangeRunner: React.Dispatch<React.SetStateAction<RunnerConfig>>;
  customModelStatus: CustomGlbStatus;
  savedAvatars: SavedGlbAvatarSummary[];
  activeSavedAvatarId: string | null;
  avatarStorageNotice: string | null;
  onSelectGlbFile: (file: File, replaceId?: string) => void;
  onSaveCurrentGlbAvatar: () => void;
  onLoadSavedGlbAvatar: (id: string) => void;
  onDeleteSavedGlbAvatar: (id: string) => void;
  onClearGlbModel: () => void;
  mapConfig: MapConfig;
  onChangeMapConfig: React.Dispatch<React.SetStateAction<MapConfig>>;
  mapLoadStatus: MapLoadStatus;
  routeSnapStatus: 'idle' | 'matching' | 'matched' | 'fallback';
  onReloadMap: () => void;
  exportConfig: ExportConfig;
  onChangeExportConfig: React.Dispatch<React.SetStateAction<ExportConfig>>;
  track: Studio3DTrack | null;
  onUpdateTrackInfo: (patch: { title?: string; date?: string; location?: string }) => void;
  onAddCustomLandmark: (label: string, progress: number) => void;
  onRemoveLandmark: (id: string) => void;
  isExporting: boolean;
  exportPercent: number;
  exportError: string | null;
  lastExportInfo: { filename: string; sizeMb: string } | null;
  onStartExport: () => void;
  onCancelExport: () => void;
}

const JERSEY_SWATCHES = ['#F97316', '#2563EB', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#FACC15', '#F8FAFC'];
const SHORTS_SWATCHES = ['#0F172A', '#1E293B', '#1D4ED8', '#065F46', '#7F1D1D', '#F8FAFC'];
const SHOES_SWATCHES = ['#38BDF8', '#F97316', '#22C55E', '#F43F5E', '#FACC15', '#E2E8F0'];

export const Studio3DPanelTabs: React.FC<Studio3DPanelTabsProps> = ({
  activeTab,
  onChangeTab,
  runner,
  onChangeRunner,
  customModelStatus,
  savedAvatars,
  activeSavedAvatarId,
  avatarStorageNotice,
  onSelectGlbFile,
  onSaveCurrentGlbAvatar,
  onLoadSavedGlbAvatar,
  onDeleteSavedGlbAvatar,
  onClearGlbModel,
  mapConfig,
  onChangeMapConfig,
  mapLoadStatus,
  routeSnapStatus,
  onReloadMap,
  exportConfig,
  onChangeExportConfig,
  track,
  onUpdateTrackInfo,
  onAddCustomLandmark,
  onRemoveLandmark,
  isExporting,
  exportPercent,
  exportError,
  lastExportInfo,
  onStartExport,
  onCancelExport,
}) => {
  const [newLandmarkLabel, setNewLandmarkLabel] = useState('');
  const [newLandmarkPct, setNewLandmarkPct] = useState(50);
  const [replaceTargetId, setReplaceTargetId] = useState<string | undefined>(undefined);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const isMapLoading = mapLoadStatus.phase === 'loading';
  const visibleLandmarks = useMemo(() => track?.landmarks ?? [], [track]);

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      <div
        role="tablist"
        aria-label="Pengaturan Studio Animasi 3D"
        className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-2 pt-2 gap-1"
      >
        {(
          [
            { id: 'pelari', label: 'Karakter Pelari', icon: <User className="w-3.5 h-3.5" aria-hidden="true" /> },
            { id: 'peta', label: 'Peta & Rute', icon: <MapIcon className="w-3.5 h-3.5" aria-hidden="true" /> },
            { id: 'export', label: 'Export Video 9:16', icon: <Film className="w-3.5 h-3.5" aria-hidden="true" /> },
          ] as Array<{ id: Studio3DTab; label: string; icon: React.ReactNode }>
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`studio3d-tab-${tab.id}`}
              onClick={() => onChangeTab(tab.id)}
              className={`h-9 px-3.5 rounded-t-xl text-xs font-bold inline-flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-blue-600 bg-white dark:bg-slate-900 text-orange-500 dark:text-orange-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-4 sm:p-6">
        {activeTab === 'pelari' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-pelari"
          >
            {/* Kolom 1: Gaya Karakter & Model Custom GLB */}
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gaya Avatar 3D
                </h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'realistic', label: 'Atlet Road' },
                      { id: 'trail-pro', label: 'Atlet Trail' },
                      { id: 'custom-glb', label: 'Custom .GLB' },
                    ] as Array<{ id: CharacterStyle3D; label: string }>
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      data-testid={`studio3d-charstyle-${st.id}`}
                      onClick={() => onChangeRunner((prev) => ({ ...prev, characterStyle: st.id }))}
                      className={`h-9 px-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                        runner.characterStyle === st.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gaya Gerak & Pose Finish
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'auto', label: 'Auto (Pace)' },
                      { id: 'walk', label: 'Jalan' },
                      { id: 'jog', label: 'Jogging' },
                      { id: 'run', label: 'Lari' },
                      { id: 'sprint', label: 'Sprint' },
                    ] as Array<{ id: GaitMode3D; label: string }>
                  ).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, gaitMode: g.id }))}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        runner.gaitMode === g.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {(
                    [
                      { id: 'hands-on-hips', label: 'Tangan Pinggang' },
                      { id: 'check-watch', label: 'Cek Jam' },
                      { id: 'casual-wave', label: 'Sapa Santai' },
                      { id: 'victory-raise', label: 'Angkat Tangan' },
                      { id: 'exhausted-bow', label: 'Tunduk Lelah' },
                      { id: 'celebrate-jump', label: 'Lompat' },
                    ] as Array<{ id: FinishPoseStyle3D; label: string }>
                  ).map((fp) => (
                    <button
                      key={fp.id}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, finishPoseStyle: fp.id }))}
                      className={`h-8 px-2 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        runner.finishPoseStyle === fp.id
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {fp.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload & Simpan Avatar Custom .GLB */}
              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Box className="w-3.5 h-3.5" aria-hidden="true" />
                    Model 3D Custom (.GLB)
                  </h3>
                  <input
                    ref={glbInputRef}
                    type="file"
                    accept=".glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onSelectGlbFile(f, replaceTargetId);
                      setReplaceTargetId(undefined);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceTargetId(undefined);
                      glbInputRef.current?.click();
                    }}
                    className="h-7 px-2.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" aria-hidden="true" />
                    <span>Upload .GLB</span>
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Preset Avatar Gratis (1-Klik)
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      {
                        label: "Sain (Default)",
                        url: "/models/ava-sain.glb",
                        flip180: false,
                        animMode: "auto" as const,
                      },
                      {
                        label: "Runner Taktis",
                        url: "https://threejs.org/examples/models/gltf/Soldier.glb",
                        flip180: true,
                        animMode: "clip" as const,
                      },
                      {
                        label: "Manekin Sporty",
                        url: "https://threejs.org/examples/models/gltf/Xbot.glb",
                        flip180: false,
                        animMode: "clip" as const,
                      },
                      {
                        label: "Robot Kartun",
                        url: "https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
                        flip180: false,
                        animMode: "clip" as const,
                      },
                    ].map((preset) => {
                      const active = runner.customModelUrl === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() =>
                            onChangeRunner((prev) => ({
                              ...prev,
                              characterStyle: "custom-glb",
                              customModelUrl: preset.url,
                              customModelName: preset.label,
                              customModelFlip180: preset.flip180,
                              customModelAnimMode: preset.animMode,
                            }))
                          }
                          className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium text-left truncate transition cursor-pointer ${
                            active
                              ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold"
                              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {runner.customModelUrl && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {runner.customModelName || 'Custom Model'}
                      </span>
                      <button
                        type="button"
                        onClick={onClearGlbModel}
                        className="text-rose-500 hover:underline font-semibold shrink-0 cursor-pointer"
                      >
                        Lepas
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {customModelStatus.loading
                        ? 'Memuat rig .GLB...'
                        : customModelStatus.error
                          ? customModelStatus.error
                          : `Rig: ${customModelStatus.rigMode} · ${customModelStatus.detectedBones} tulang · ${customModelStatus.animationCount} klip`}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeRunner((prev) => ({
                            ...prev,
                            customModelFlip180: !prev.customModelFlip180,
                          }))
                        }
                        className={`h-7 px-2 rounded-md border text-[10px] font-semibold cursor-pointer ${
                          runner.customModelFlip180
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Putar 180°: {runner.customModelFlip180 ? 'ON' : 'OFF'}
                      </button>

                      <select
                        aria-label="Mode Animasi GLB"
                        value={runner.customModelAnimMode}
                        onChange={(e) =>
                          onChangeRunner((prev) => ({
                            ...prev,
                            customModelAnimMode: e.target.value as CustomModelAnimMode,
                          }))
                        }
                        className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
                      >
                        <option value="auto">Animasi: Auto</option>
                        <option value="bones">Animasi: Tulang Prosedural</option>
                        <option value="clip">Animasi: Klip Bawaan</option>
                      </select>

                      <button
                        type="button"
                        onClick={onSaveCurrentGlbAvatar}
                        className="h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Save className="w-3 h-3" aria-hidden="true" />
                        <span>Simpan</span>
                      </button>
                    </div>
                  </div>
                )}

                {avatarStorageNotice && (
                  <p className="text-[10px] font-medium text-orange-500 dark:text-orange-400">
                    {avatarStorageNotice}
                  </p>
                )}

                {savedAvatars.length > 0 && (
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {savedAvatars.map((av) => (
                      <div
                        key={av.id}
                        className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border text-[10px] ${
                          activeSavedAvatarId === av.id
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onLoadSavedGlbAvatar(av.id)}
                          className="truncate text-left font-semibold text-slate-800 dark:text-slate-200 cursor-pointer flex-1"
                        >
                          {av.name} ({formatAvatarSizeMb(av.sizeBytes)})
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSavedGlbAvatar(av.id)}
                          aria-label={`Hapus ${av.name}`}
                          className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Kolom 2: Identitas Pelari & Penampilan */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Nama Pelari (Overlay Video)
                </h3>
                <input
                  type="text"
                  value={runner.runnerName}
                  onChange={(e) =>
                    onChangeRunner((prev) => ({ ...prev, runnerName: e.target.value }))
                  }
                  placeholder="Atlet Kalcer"
                  className="w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gender, Rambut & Aksesoris
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'male', label: 'Pria' },
                      { id: 'female', label: 'Wanita' },
                    ] as Array<{ id: RunnerGender; label: string }>
                  ).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, gender: g.id }))}
                      className={`h-8 rounded-lg border text-xs font-semibold cursor-pointer ${
                        runner.gender === g.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'undercut', label: 'Undercut' },
                      { id: 'spiky', label: 'Spiky' },
                      { id: 'side-fade', label: 'Side Fade' },
                    ] as Array<{ id: RunnerHairStyle; label: string }>
                  ).map((hs) => (
                    <button
                      key={hs.id}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, hairStyle: hs.id }))}
                      className={`h-7 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        runner.hairStyle === hs.id
                          ? 'border-slate-900 dark:border-blue-500 bg-slate-900 dark:bg-blue-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {hs.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'none', label: 'Polos' },
                      { id: 'cap', label: 'Topi Lari' },
                      { id: 'visor', label: 'Visor' },
                      { id: 'headband', label: 'Headband' },
                      { id: 'trail-vest', label: 'Trail Vest' },
                    ] as Array<{ id: RunnerAccessory; label: string }>
                  ).map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, accessory: acc.id }))}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        runner.accessory === acc.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {acc.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      onChangeRunner((prev) => ({ ...prev, glasses: !prev.glasses }))
                    }
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      runner.glasses
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Kacamata Sport
                  </button>
                </div>
              </div>
            </section>

            {/* Kolom 3: Warna Outfit (Jersey, Celana, Sepatu) */}
            <section className="space-y-4 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Warna Jersey
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {JERSEY_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, jerseyColor: hex }))}
                      aria-label={`Warna jersey ${hex}`}
                      className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                        runner.jerseyColor.toUpperCase() === hex
                          ? 'border-slate-900 dark:border-white scale-110'
                          : 'border-white/60 dark:border-slate-700'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  <input
                    type="color"
                    value={runner.jerseyColor}
                    onChange={(e) =>
                      onChangeRunner((prev) => ({ ...prev, jerseyColor: e.target.value }))
                    }
                    aria-label="Pilih warna jersey custom"
                    className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Warna Celana
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SHORTS_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, shortsColor: hex }))}
                      aria-label={`Warna celana ${hex}`}
                      className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                        runner.shortsColor.toUpperCase() === hex
                          ? 'border-blue-600 scale-110'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Warna Sepatu Lari
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SHOES_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => onChangeRunner((prev) => ({ ...prev, shoesColor: hex }))}
                      aria-label={`Warna sepatu ${hex}`}
                      className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                        runner.shoesColor.toUpperCase() === hex
                          ? 'border-slate-900 dark:border-white scale-110'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'peta' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-peta" style={{ animation: "fadeSlideIn 220ms ease-out" }}
          >
            {/* Kolom 1: Mode Peta OpenFreeMap (Light/Night) & Bangunan 3D */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Peta Vektor OpenFreeMap
                </h3>
                <button
                  type="button"
                  data-testid="studio3d-panel-reload-map-btn"
                  onClick={onReloadMap}
                  className="h-7 px-2.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isMapLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isMapLoading ? 'Memuat...' : 'Muat Ulang Peta'}</span>
                </button>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tema Peta
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'clean', label: 'Clean Pastel', desc: 'Minimalis bersih' },
                      { id: 'street', label: 'Street 3D', desc: 'Jalan & gedung kota' },
                      { id: 'dark', label: 'Night Mode', desc: 'Gelap elegan' },
                      { id: 'satellite', label: 'Satelit', desc: 'Citra udara asli' },
                    ] as const
                  ).map((st) => {
                    const active = mapConfig.mapStyle === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        data-testid={`studio3d-mapstyle-${st.id}`}
                        onClick={() => onChangeMapConfig((prev) => ({ ...prev, mapStyle: st.id }))}
                        className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="block text-xs font-bold leading-tight">{st.label}</span>
                        <span className="block text-[10px] opacity-75 mt-0.5">{st.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Bangunan 3D
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="studio3d-buildings-on"
                    onClick={() => onChangeMapConfig((prev) => ({ ...prev, buildings3d: true }))}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      mapConfig.buildings3d
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    3D ON
                  </button>
                  <button
                    type="button"
                    data-testid="studio3d-buildings-off"
                    onClick={() => onChangeMapConfig((prev) => ({ ...prev, buildings3d: false }))}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      !mapConfig.buildings3d
                        ? 'border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    3D OFF
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Penyesuaian Jalur
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'raw', label: 'GPS Asli' },
                      { id: 'snap-road', label: 'Snap ke Jalan (Maps)' },
                    ] as Array<{ id: RouteSnapMode3D; label: string }>
                  ).map((sm) => {
                    const active = (mapConfig.routeSnapMode ?? 'raw') === sm.id;
                    return (
                      <button
                        key={sm.id}
                        type="button"
                        data-testid={`studio3d-routesnap-${sm.id}`}
                        onClick={() =>
                          onChangeMapConfig((prev) => ({ ...prev, routeSnapMode: sm.id }))
                        }
                        className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                          active
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sm.label}
                      </button>
                    );
                  })}
                </div>
                {(mapConfig.routeSnapMode ?? 'raw') === 'snap-road' && (
                  <p
                    data-testid="studio3d-routesnap-status"
                    className="text-[10px] font-medium text-slate-500 dark:text-slate-400"
                  >
                    {routeSnapStatus === 'matching'
                      ? 'Menyelaraskan rute GPS ke jalan OSM...'
                      : routeSnapStatus === 'matched'
                        ? 'Rute terselaraskan ke jalan (OSRM).'
                        : routeSnapStatus === 'fallback'
                          ? 'Jalan sekitar tidak ditemukan, memakai GPS asli.'
                          : 'Siap menyelaraskan ke jalan.'}
                  </p>
                )}
              </div>

              <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">
                © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors
              </p>
            </section>

            {/* Kolom 2: Pencahayaan & Header Info Video */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pencahayaan Avatar
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'auto', label: 'Auto' },
                      { id: 'morning', label: 'Pagi' },
                      { id: 'evening', label: 'Sore' },
                      { id: 'night', label: 'Malam' },
                      { id: 'city-park', label: 'City Park' },
                      { id: 'mountain', label: 'Mountain' },
                      { id: 'night-run', label: 'Night Run' },
                    ] as Array<{ id: LightingMood3D; label: string }>
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        onChangeMapConfig((prev) => ({ ...prev, lightingMood: m.id }))
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        mapConfig.lightingMood === m.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Info Aktivitas (Overlay Video)
                </h3>
                {track ? (
                  <>
                    <input
                      type="text"
                      value={track.title}
                      onChange={(e) => onUpdateTrackInfo({ title: e.target.value })}
                      placeholder="Nama Aktivitas"
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={track.date}
                        onChange={(e) => onUpdateTrackInfo({ date: e.target.value })}
                        className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={track.location}
                        onChange={(e) => onUpdateTrackInfo({ location: e.target.value })}
                        placeholder="Lokasi Rute"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Upload file <strong>.FIT</strong> / <strong>.GPX</strong> atau pilih riwayat lari untuk mengedit info rute.
                  </p>
                )}
              </div>
            </section>

            {/* Kolom 3: Landmark Rute */}
            <section className="space-y-3 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Landmark Rute ({visibleLandmarks.length})
              </h3>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  disabled={!track}
                  value={newLandmarkLabel}
                  onChange={(e) => setNewLandmarkLabel(e.target.value)}
                  placeholder="Label landmark (mis. Water Station)"
                  className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white disabled:opacity-50"
                />
                <input
                  type="number"
                  disabled={!track}
                  min={5}
                  max={95}
                  value={newLandmarkPct}
                  onChange={(e) => setNewLandmarkPct(Number(e.target.value))}
                  title="Posisi % di rute"
                  className="w-14 h-8 px-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-center text-slate-900 dark:text-white disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={!track}
                  onClick={() => {
                    const clean = newLandmarkLabel.trim();
                    if (!clean || !track) return;
                    onAddCustomLandmark(clean, Math.min(98, Math.max(2, newLandmarkPct)) / 100);
                    setNewLandmarkLabel('');
                  }}
                  className="h-8 px-2.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Pin
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {visibleLandmarks.map((lm) => (
                  <div
                    key={lm.id}
                    className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 text-[11px]"
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {lm.label}
                      <span className="ml-1.5 font-mono-tabular text-slate-400">
                        · {lm.distanceKm.toFixed(1)} km
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveLandmark(lm.id)}
                      aria-label={`Hapus landmark ${lm.label}`}
                      className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'export' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-export" style={{ animation: "fadeSlideIn 220ms ease-out" }}
          >
            {/* Kolom 1: Durasi & Resolusi */}
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Durasi Video (9:16 Vertikal)
                </h3>
                <div className="grid grid-cols-5 gap-1.5">
                  {([15, 30, 45, 60, 'custom'] as DurationPresetSec[]).map((dur) => (
                    <button
                      key={String(dur)}
                      type="button"
                      onClick={() =>
                        onChangeExportConfig((prev) => ({ ...prev, durationPreset: dur }))
                      }
                      className={`h-8 rounded-lg border font-mono-tabular text-xs font-bold cursor-pointer ${
                        exportConfig.durationPreset === dur
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {dur === 'custom' ? 'Custom' : `${dur}s`}
                    </button>
                  ))}
                </div>
                {exportConfig.durationPreset === 'custom' && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-slate-500">Detik:</span>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={exportConfig.customDurationSec}
                      onChange={(e) =>
                        onChangeExportConfig((prev) => ({
                          ...prev,
                          customDurationSec: Number(e.target.value),
                        }))
                      }
                      className="w-24 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Resolusi & Pose Finish
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {(['720p', '1080p'] as VideoQuality3D[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onChangeExportConfig((prev) => ({ ...prev, quality: q }))}
                      className={`h-8 rounded-lg border font-mono-tabular text-xs font-bold cursor-pointer ${
                        exportConfig.quality === q
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {q === '1080p' ? '1080×1920 (FHD)' : '720×1280 (HD)'}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportConfig.includeFinishPose}
                    onChange={(e) =>
                      onChangeExportConfig((prev) => ({
                        ...prev,
                        includeFinishPose: e.target.checked,
                      }))
                    }
                    className="accent-orange-500 rounded"
                  />
                  <span>Sertakan Selebrasi Finish di Akhir Video</span>
                </label>
              </div>
            </section>

            {/* Kolom 2: Musik Latar */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5" aria-hidden="true" />
                  Musik Latar Video
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'upbeat-synth', label: 'Upbeat Synth' },
                      { id: 'lofi-stride', label: 'Lo-Fi Stride' },
                      { id: 'epic-trail', label: 'Epic Trail' },
                      { id: 'none', label: 'Tanpa Musik' },
                    ] as Array<{ id: MusicPreset3D; label: string }>
                  ).map((mp) => (
                    <button
                      key={mp.id}
                      type="button"
                      onClick={() =>
                        onChangeExportConfig((prev) => ({ ...prev, musicPreset: mp.id }))
                      }
                      className={`h-8 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        exportConfig.musicPreset === mp.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {mp.label}
                    </button>
                  ))}
                </div>

                <div className="pt-1 flex items-center gap-2">
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = URL.createObjectURL(f);
                      onChangeExportConfig((prev) => {
                        if (prev.customAudioUrl?.startsWith('blob:')) {
                          URL.revokeObjectURL(prev.customAudioUrl);
                        }
                        return {
                          ...prev,
                          musicPreset: 'custom-mp3',
                          customAudioUrl: url,
                          customAudioName: f.name,
                        };
                      });
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {exportConfig.customAudioName
                        ? exportConfig.customAudioName.slice(0, 18)
                        : 'Upload MP3 / Audio'}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-slate-500">Volume:</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={exportConfig.volume}
                    onChange={(e) =>
                      onChangeExportConfig((prev) => ({
                        ...prev,
                        volume: Number(e.target.value),
                      }))
                    }
                    className="flex-1 accent-orange-500 cursor-pointer"
                  />
                  <span className="font-mono-tabular text-[11px] font-bold text-slate-700 dark:text-slate-200 w-9 text-right">
                    {Math.round(exportConfig.volume * 100)}%
                  </span>
                </div>
              </div>
            </section>

            {/* Kolom 3: Render & Download */}
            <section className="space-y-3 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6 flex flex-col justify-between">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Render & Download Video
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Menggabungkan peta OpenFreeMap, karakter 3D, dan HUD telemetri menjadi video vertikal siap upload ke Reels / TikTok / Shorts.
                </p>
              </div>

              <div className="space-y-2.5">
                {isExporting ? (
                  <div className="space-y-2">
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-orange-500 transition-[width] duration-150"
                        style={{ width: `${exportPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular text-xs font-bold text-orange-600 dark:text-orange-400">
                        Merekam... {exportPercent}%
                      </span>
                      <button
                        type="button"
                        onClick={onCancelExport}
                        className="h-8 px-3 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Batal</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="studio3d-export-btn"
                    disabled={!track}
                    onClick={onStartExport}
                    className="w-full h-10 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>Render & Unduh Video ({exportConfig.quality})</span>
                  </button>
                )}

                {exportError && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {exportError}
                  </p>
                )}

                {lastExportInfo && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Tersimpan: {lastExportInfo.filename} ({lastExportInfo.sizeMb} MB)
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
};
