import React, { useEffect, useRef } from 'react';
import {
  Flame,
  Volume2,
  VolumeX,
  Zap,
  Car,
  Sparkles,
  Wrench,
  ShoppingBag,
  Play,
  MessageSquare,
  Map as MapIcon,
  Compass,
  Navigation,
} from 'lucide-react';
import { LosSantosEngine } from './game/engine';
import { useGameStore } from './game/store';
import {
  LANDMARKS,
  MISSION_ORDER,
  MISSIONS,
  PROTAGONISTS,
  STUNT_RAMPS,
  WEAPON_WHEEL_ORDER,
  WEAPONS,
} from './game/data';
import { CharacterId } from './game/types';
import { sound } from './game/audio';

const SHORT_MISSION_LABELS: Record<string, string> = {
  street_warmup: '1️⃣ 第一章：海濱試駕',
  simeon_repo: '2️⃣ 第二章：天文台超跑',
  pier_arms: '3️⃣ 第三章：沙漠機場',
  pacific_heist: '4️⃣ 第四章：銀行大劫案',
  federal_lockdown: '5️⃣ 終章：國際機場決戰',
};

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LosSantosEngine | null>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const state = useGameStore();
  const activeCharProfile = PROTAGONISTS[state.activeChar];
  const activeCharState = state.charStates[state.activeChar];
  const activeWeaponSpec = WEAPONS[activeCharState.weapon];
  const activeWeaponAmmo = state.weapons[activeCharState.weapon];

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new LosSantosEngine(mountRef.current);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Draw GTA V Rectangular Minimap Radar (Multi-Biome San Andreas Island)
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Base dark turf background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const px = activeCharState.x;
    const pz = activeCharState.z;
    const scale = 0.56; // world units to radar pixels

    ctx.save();
    ctx.translate(w / 2, h / 2);

    const toRx = (wx: number) => (wx - px) * scale;
    const toRz = (wz: number) => (wz - pz) * scale;

    // 1. Pacific Ocean (West of x=-165 and South of z=205)
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(toRx(-450), toRz(-450), 285 * scale, 900 * scale);
    ctx.fillRect(toRx(-450), toRz(205), 900 * scale, 260 * scale);

    // 2. Vespucci Golden Beach (x from -165 to -105)
    ctx.fillStyle = '#a16207';
    ctx.fillRect(toRx(-165), toRz(-45), 60 * scale, 250 * scale);

    // 3. Del Perro Pleasure Pier (x from -230 to -106, z from 6 to 34)
    ctx.fillStyle = '#78350f';
    ctx.fillRect(toRx(-230), toRz(6), 124 * scale, 28 * scale);

    // 4. Vinewood Hills Mountain Zone (North: z < -72)
    ctx.fillStyle = '#14532d';
    ctx.fillRect(toRx(-135), toRz(-250), 245 * scale, 178 * scale);

    // 5. Sandy Shores Red Rock Desert (East: x > 98)
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(toRx(98), toRz(-220), 220 * scale, 310 * scale);

    // 6. LSIA International Airport Peninsula (South: z > 100)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(toRx(-90), toRz(100), 310 * scale, 105 * scale);

    // Draw Island Road Network
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4.5;
    const drawRoad = (x1: number, z1: number, x2: number, z2: number) => {
      ctx.beginPath();
      ctx.moveTo(toRx(x1), toRz(z1));
      ctx.lineTo(toRx(x2), toRz(z2));
      ctx.stroke();
    };
    [-100, -32, 32, 95].forEach((rx) => drawRoad(rx, -70, rx, 115));
    [-70, -5, 65, 115].forEach((rz) => drawRoad(-100, rz, 95, rz));
    // Mountain roads to Observatory
    drawRoad(-32, -70, -10, -145);
    drawRoad(32, -70, 10, -145);
    drawRoad(-125, -145, 42, -145);
    // Suspension bridge & West Coast
    drawRoad(-100, 115, -125, -35);
    drawRoad(-125, -35, -125, -145);
    // Route 68 & Sandy Shores Runway
    drawRoad(95, -5, 172, -5);
    drawRoad(95, -70, 172, -70);
    drawRoad(172, -135, 172, 25);
    // LSIA Airport Runway
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#64748b';
    drawRoad(-70, 155, 195, 155);

    // Wanted flashing police overlay on radar
    if (state.wantedStars > 0) {
      const flashBlue = Math.floor(Date.now() / 260) % 2 === 0;
      ctx.fillStyle = state.wantedSearching
        ? 'rgba(250,204,21,0.16)'
        : flashBlue
          ? 'rgba(59,130,246,0.22)'
          : 'rgba(239,68,68,0.22)';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }

    // Draw GPS yellow route line if mission target exists
    const missionBlip = state.blips.find((b) => b.type === 'mission');
    if (missionBlip) {
      const mx = toRx(missionBlip.x);
      const mz = toRz(missionBlip.z);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.8;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(mx, mz);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Radar Blips
    for (const b of state.blips) {
      const bx = Math.max(-w / 2 + 8, Math.min(w / 2 - 8, toRx(b.x)));
      const bz = Math.max(-h / 2 + 8, Math.min(h / 2 - 8, toRz(b.z)));

      ctx.fillStyle = b.color;
      ctx.beginPath();
      const radius =
        b.type === 'mission'
          ? 6.2
          : b.type === 'cash_truck' || b.type === 'helipad'
            ? 5.6
            : b.type === 'heli'
              ? 5.5
              : 4.0;
      ctx.arc(bx, bz, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (b.label) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.label, bx, bz + 3);
      }
    }

    // Player view cone & arrow in center
    ctx.save();
    ctx.rotate(-state.playerRotation + Math.PI);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 34, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }, [
    state.blips,
    activeCharState.x,
    activeCharState.z,
    state.playerRotation,
    state.wantedStars,
    state.wantedSearching,
  ]);

  const toggleMute = () => {
    const next = !state.muted;
    sound.muted = next;
    state.setMuted(next);
  };

  const isSniperScoped = state.aiming && activeCharState.weapon === 'sniper';
  const hitmarkerFresh = state.hitmarker.active && performance.now() - state.hitmarker.ts < 170;
  const reticleGap = Math.round(
    (state.aiming ? 6 : 11) + state.reticleBloom * (state.aiming ? 10 : 18)
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-950 select-none">
      {/* 3D WebGL Viewport */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Special Ability Screen Tint Filter */}
      {state.specialActive && (
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-opacity duration-300"
          style={{
            background:
              state.activeChar === 'michael'
                ? 'radial-gradient(circle, transparent 45%, rgba(56, 189, 248, 0.28) 100%)'
                : state.activeChar === 'franklin'
                  ? 'radial-gradient(circle, transparent 45%, rgba(34, 197, 94, 0.28) 100%)'
                  : 'radial-gradient(circle, transparent 35%, rgba(239, 68, 68, 0.38) 100%)',
          }}
        />
      )}

      {/* Sky-Cam Satellite Switch Scanline Overlay */}
      {state.skyCamSwitching && (
        <div className="pointer-events-none fixed inset-0 z-20 bg-sky-950/25 backdrop-blur-[1px] flex flex-col items-center justify-between p-8">
          <div className="text-xs font-mono tracking-[0.35em] text-sky-300/90 bg-zinc-950/80 px-4 py-1.5 rounded border border-sky-400/40">
            SAN ANDREAS SATELLITE UPLINK · LOCKING TARGET:{' '}
            {state.skyCamTarget ? PROTAGONISTS[state.skyCamTarget].enName.toUpperCase() : ''}
          </div>
        </div>
      )}

      {/* Sniper High-Power Scope Overlay */}
      {isSniperScoped && (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-black/55">
          <div className="relative w-[460px] h-[460px] rounded-full border-4 border-zinc-200/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.82)] flex items-center justify-center">
            <div className="absolute inset-x-0 h-[1px] bg-emerald-400/80" />
            <div className="absolute inset-y-0 w-[1px] bg-emerald-400/80" />
            <div className="w-3 h-3 rounded-full border border-red-500 bg-red-500/40" />
            <div className="absolute bottom-6 text-[11px] font-mono text-emerald-300 tracking-widest">
              HEAVY SNIPER OPTICS · 8.0X ZOOM
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Recoil-Aware Crosshair & Hitmarker */}
      {state.started &&
        !state.paused &&
        !state.weaponWheelOpen &&
        !state.charWheelOpen &&
        !state.worldMapOpen &&
        !isSniperScoped && (
          <div className="pointer-events-none fixed inset-0 z-15 flex items-center justify-center">
            <div className="relative flex items-center justify-center">
              <div
                className={`w-1.5 h-1.5 rounded-full transition-transform ${
                  state.aiming ? 'bg-red-400 scale-125' : 'bg-white/95'
                }`}
              />
              <div
                className={`absolute w-[2px] h-2.5 ${state.aiming ? 'bg-red-400/90' : 'bg-white/85'}`}
                style={{ transform: `translateY(-${reticleGap}px)` }}
              />
              <div
                className={`absolute w-[2px] h-2.5 ${state.aiming ? 'bg-red-400/90' : 'bg-white/85'}`}
                style={{ transform: `translateY(${reticleGap}px)` }}
              />
              <div
                className={`absolute h-[2px] w-2.5 ${state.aiming ? 'bg-red-400/90' : 'bg-white/85'}`}
                style={{ transform: `translateX(-${reticleGap}px)` }}
              />
              <div
                className={`absolute h-[2px] w-2.5 ${state.aiming ? 'bg-red-400/90' : 'bg-white/85'}`}
                style={{ transform: `translateX(${reticleGap}px)` }}
              />
              <div
                className={`absolute border rounded-full transition-all duration-75 ${
                  state.aiming ? 'border-red-400/60' : 'border-white/35'
                }`}
                style={{
                  width: `${reticleGap * 2.1}px`,
                  height: `${reticleGap * 2.1}px`,
                }}
              />
              {hitmarkerFresh && (
                <div
                  className={`absolute w-7 h-7 pointer-events-none ${
                    state.hitmarker.headshot ? 'text-red-500 scale-125' : 'text-white'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-full h-full stroke-current stroke-[2.8]">
                    <line x1="3" y1="3" x2="9" y2="9" />
                    <line x1="21" y1="3" x2="15" y2="9" />
                    <line x1="3" y1="21" x2="9" y2="15" />
                    <line x1="21" y1="21" x2="15" y2="15" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        )}

      {/* === COMBAT, STUNT JUMP & EVENT POPUP FEED === */}
      {state.started && state.popups.length > 0 && (
        <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-25 flex flex-col items-center gap-1.5">
          {state.popups.map((p) => (
            <div
              key={p.id}
              className="px-4 py-1.5 rounded-full bg-zinc-950/90 border border-zinc-700/80 shadow-xl backdrop-blur-md text-xs font-extrabold tracking-wide animate-bounce"
              style={{ color: p.color }}
            >
              {p.text}
            </div>
          ))}
        </div>
      )}

      {/* === TOP-LEFT: 5-Chapter Island Campaign Dispatch & Sandbox Toolbar === */}
      {state.started && (
        <div className="fixed top-4 left-4 z-20 flex flex-col gap-2 max-w-md">
          {state.activeMissionId ? (
            <div className="bg-zinc-950/90 border-l-4 border-yellow-400 px-4 py-3 rounded-r-xl shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold tracking-wider uppercase text-yellow-400">
                  進行中行動 · {MISSIONS[state.activeMissionId].title}
                </span>
                <span className="text-xs font-mono text-emerald-400 font-bold">
                  +${MISSIONS[state.activeMissionId].reward.toLocaleString()}
                </span>
              </div>
              <p className="text-sm font-semibold text-white mt-1">
                {state.missionObjectiveText}
              </p>
              {state.missionProgressText && (
                <p className="text-xs text-amber-300/90 mt-1 font-mono">
                  ▸ {state.missionProgressText}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-zinc-950/90 border border-zinc-800/90 px-3.5 py-2.5 rounded-xl shadow-xl backdrop-blur-md">
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>📱 聖安地列斯五章全島戰役 (點擊任一章節開打)</span>
                <span className="text-emerald-400 font-mono">
                  進度 {state.completedMissions.length}/{MISSION_ORDER.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MISSION_ORDER.map((mId) => {
                  const done = state.completedMissions.includes(mId);
                  return (
                    <button
                      key={mId}
                      onClick={() => engineRef.current?.startMission(mId)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 border ${
                        done
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/70'
                          : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-100'
                      }`}
                    >
                      <span>{SHORT_MISSION_LABELS[mId] || MISSIONS[mId].title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Sandbox Cheats / Helicopters / Island Map Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 bg-zinc-950/85 border border-zinc-800/80 px-2.5 py-1.5 rounded-xl backdrop-blur-md text-[11px]">
            <button
              onClick={() => state.setWorldMapOpen(true)}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-300 font-bold cursor-pointer flex items-center gap-1"
            >
              <MapIcon className="w-3.5 h-3.5" /> [M] 全島衛星傳送
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('spawn_helicopter')}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-amber-300 font-bold cursor-pointer flex items-center gap-1"
            >
              🚁 空投武裝直升機
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('spawn_supercar')}
              className="px-2 py-1 rounded bg-sky-500/15 hover:bg-sky-500/30 border border-sky-500/30 text-sky-300 font-medium cursor-pointer flex items-center gap-1"
            >
              <Car className="w-3.5 h-3.5" /> 空投超跑
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('max_arsenal')}
              className="px-2 py-1 rounded bg-purple-500/15 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 font-medium cursor-pointer flex items-center gap-1"
            >
              <Flame className="w-3.5 h-3.5" /> 滿軍火
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('trigger_5star')}
              className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 text-red-300 font-medium cursor-pointer"
            >
              ⭐⭐⭐⭐⭐ 五星
            </button>
            {state.wantedStars > 0 && (
              <button
                onClick={() => engineRef.current?.clearWantedLevel()}
                className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 font-medium cursor-pointer"
              >
                ✨ 消星
              </button>
            )}
            <button
              onClick={toggleMute}
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer ml-auto"
              title={state.muted ? '開啟音效' : '靜音'}
            >
              {state.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* === TOP-RIGHT: GTA V Wanted Stars, Cash, Weapon & Special Ability === */}
      {state.started && (
        <div className="fixed top-4 right-4 z-20 flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-zinc-950/85 px-3 py-1.5 rounded-full border border-zinc-800/80 backdrop-blur-md">
            {[1, 2, 3, 4, 5].map((star) => {
              const active = star <= state.wantedStars;
              return (
                <span
                  key={star}
                  className={`text-lg leading-none ${
                    active
                      ? 'text-amber-400 animate-wanted drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                      : 'text-zinc-700'
                  }`}
                >
                  ★
                </span>
              );
            })}
            {state.wantedStars > 0 && state.wantedSearching && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                🔍 警方搜索中
              </span>
            )}
            {state.wantedStars >= 3 && !state.wantedSearching && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                🚁 武裝直升機鎖定
              </span>
            )}
          </div>

          <div className="relative flex items-center gap-2 bg-zinc-950/85 px-4 py-1.5 rounded-xl border border-emerald-500/30 shadow-lg">
            <span className="text-2xl font-black tracking-tight font-mono text-emerald-400 drop-shadow">
              ${state.cash.toLocaleString()}
            </span>
            {state.cashDelta && (
              <span
                key={state.cashDelta.id}
                className={`text-xs font-mono font-bold ${
                  state.cashDelta.amount >= 0 ? 'text-emerald-300' : 'text-red-400'
                }`}
              >
                {state.cashDelta.amount >= 0 ? `+${state.cashDelta.amount}` : state.cashDelta.amount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 bg-zinc-950/90 border border-zinc-800 px-3.5 py-2 rounded-xl backdrop-blur-md shadow-xl">
            <button
              onClick={() => state.updateHUD({ weaponWheelOpen: !state.weaponWheelOpen })}
              className="text-left cursor-pointer group"
              title="按住 [Tab] 或點擊開啟八格武器輪盤"
            >
              <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                <span>[TAB] 武器輪盤</span>
                <span className="text-sky-400 group-hover:underline">切換</span>
              </div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span style={{ color: activeWeaponSpec.color }}>●</span>
                <span>{activeWeaponSpec.name}</span>
              </div>
            </button>

            <div className="h-7 w-[1px] bg-zinc-800" />

            {activeCharState.weapon === 'unarmed' ? (
              <span className="text-sm font-mono font-bold text-zinc-400">∞ 近戰</span>
            ) : (
              <div className="text-right min-w-[68px]">
                <div className="text-base font-black font-mono text-white leading-none">
                  {activeWeaponAmmo.inMag}{' '}
                  <span className="text-xs font-normal text-zinc-400">/ {activeWeaponAmmo.reserve}</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {state.reloading ? (
                    <span className="text-amber-400 font-bold">
                      換彈中 {Math.round(state.reloadProgress * 100)}%
                    </span>
                  ) : (
                    <span>[R] 換彈 · 右鍵精準開鏡</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => engineRef.current?.toggleSpecialAbility()}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              state.specialActive
                ? 'bg-amber-400 text-zinc-950 border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.6)]'
                : 'bg-zinc-950/85 hover:bg-zinc-900 text-amber-300 border-amber-500/40'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>[Q] {activeCharProfile.specialName}</span>
            <span className="font-mono opacity-80">({Math.round(activeCharState.special)}%)</span>
          </button>
        </div>
      )}

      {/* === INTERACTION & CITIZEN TALK PROMPTS === */}
      {state.started &&
        !state.shopModalOpen &&
        !state.worldMapOpen &&
        (state.interactPrompt || state.talkPrompt) && (
          <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {state.interactPrompt && (
              <div className="bg-zinc-950/90 border border-amber-400/50 text-amber-200 px-5 py-2 rounded-full text-sm font-bold shadow-2xl backdrop-blur-md flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>{state.interactPrompt}</span>
              </div>
            )}
            {state.talkPrompt && !state.dialogue && (
              <div className="bg-zinc-950/85 border border-sky-400/40 text-sky-200 px-4 py-1.5 rounded-full text-xs font-semibold shadow-xl backdrop-blur-md flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                <span>{state.talkPrompt}</span>
              </div>
            )}
          </div>
        )}

      {/* === CITIZEN DIALOGUE CARD ([F]) === */}
      {state.started && state.dialogue && (
        <div
          onClick={() => state.closeDialogue()}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-25 max-w-lg w-[90%] bg-zinc-950/95 border border-sky-500/40 rounded-2xl px-5 py-3.5 shadow-2xl backdrop-blur-md cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs font-bold text-sky-400 mb-1">
            <span>
              💬 {state.dialogue.name} · {state.dialogue.job} ({state.dialogue.personality})
            </span>
            <span className="text-[10px] text-zinc-500">點擊關閉</span>
          </div>
          <p className="text-sm text-zinc-100 leading-relaxed">{state.dialogue.line}</p>
        </div>
      )}

      {/* === BOTTOM-LEFT: Multi-Biome Island Minimap Radar + Health / Armor / Special Bars === */}
      {state.started && (
        <div
          onClick={() => state.setWorldMapOpen(true)}
          title="點擊或按 [M] 開啟聖安地列斯全島衛星大地圖"
          className="fixed bottom-4 left-4 z-20 flex flex-col w-[262px] bg-zinc-950/95 border-2 border-zinc-800 hover:border-amber-400/70 rounded-lg overflow-hidden shadow-2xl cursor-pointer transition"
        >
          <div className="relative w-full h-[158px]">
            <canvas ref={radarCanvasRef} width={262} height={158} className="w-full h-full block" />
            <div className="absolute top-1.5 left-2 text-[10px] font-bold text-zinc-200 bg-zinc-950/85 px-1.5 py-0.5 rounded border border-zinc-800">
              {state.district.split(' ')[0]}
            </div>
            <div className="absolute top-1.5 right-2 text-[9px] font-mono text-amber-300 bg-zinc-950/85 px-1.5 py-0.5 rounded">
              [M] 全島地圖
            </div>
            <div className="absolute bottom-1.5 left-2 text-[9px] font-mono text-sky-300 bg-zinc-950/80 px-1.5 py-0.5 rounded">
              海拔 {state.vehicleAltitude}m
            </div>
            <div className="absolute bottom-1.5 right-2 text-[10px] font-mono text-zinc-300 bg-zinc-950/80 px-1.5 py-0.5 rounded">
              擊殺 {state.kills}
            </div>
          </div>

          <div className="flex w-full h-2.5 bg-zinc-900 border-t border-zinc-800 p-0.5 gap-0.5">
            <div className="w-1/2 h-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  activeCharState.hp < 30 ? 'bg-red-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.hp))}%` }}
              />
            </div>
            <div className="w-1/4 h-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.armor))}%` }}
              />
            </div>
            <div className="w-1/4 h-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.special))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* === BOTTOM-CENTER: Vehicle / Attack Helicopter HUD === */}
      {state.started && state.inVehicle && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-950/90 border border-zinc-800 px-5 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
              {state.isFlyingVehicle
                ? '🚁 駕駛武裝直升機 · 左鍵發射機砲與反裝甲火箭彈！'
                : '🏎️ 駕駛載具 · 左鍵支援車窗衝鋒槍掃射'}
            </div>
            <div className="text-sm font-bold text-white">{state.vehicleName}</div>
            <div className="w-40 h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full ${state.vehicleHpPercent < 40 ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${state.vehicleHpPercent}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black font-mono text-white leading-none">
              {state.vehicleSpeedKmh}{' '}
              <span className="text-xs font-normal text-sky-400">
                {state.isFlyingVehicle ? `ALT ${state.vehicleAltitude}m` : 'KM/H'}
              </span>
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
              {state.isFlyingVehicle
                ? '[Space] 垂直升空 · [Shift/C] 下降 · [E] 降落出艙'
                : '[Space] 手煞甩尾 · 衝上粉紅跳台觸發飛車特技 · [E] 下車'}
            </div>
          </div>
        </div>
      )}

      {/* === BOTTOM-RIGHT: GTA V 3-Protagonist Satellite Switch Panel === */}
      {state.started && (
        <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          <div className="text-[10px] font-mono text-zinc-400 bg-zinc-950/80 px-2.5 py-0.5 rounded border border-zinc-800">
            按 [1 / 2 / 3] 衛星切換主角 · 按 [M] 聖安地列斯全島傳送
          </div>
          <div className="flex items-center gap-2 bg-zinc-950/90 p-2 rounded-2xl border border-zinc-800 shadow-2xl backdrop-blur-md">
            {(['michael', 'franklin', 'trevor'] as CharacterId[]).map((cid, idx) => {
              const p = PROTAGONISTS[cid];
              const cs = state.charStates[cid];
              const isCurrent = state.activeChar === cid;
              return (
                <button
                  key={cid}
                  onClick={() => engineRef.current?.switchCharacter(cid)}
                  className={`relative flex flex-col items-start p-2.5 rounded-xl border transition cursor-pointer min-w-[108px] ${
                    isCurrent
                      ? 'bg-zinc-900 border-white shadow-lg scale-[1.03]'
                      : 'bg-zinc-950/70 border-zinc-800 opacity-80 hover:opacity-100 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className="text-[10px] font-black font-mono px-1.5 py-0.5 rounded text-zinc-950"
                      style={{ backgroundColor: p.color }}
                    >
                      [{idx + 1}] {cid.toUpperCase().slice(0, 3)}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-emerald-400">操控中</span>
                    )}
                  </div>
                  <div className="text-xs font-bold text-white truncate">{p.name.split(' ')[0]}</div>
                  <div className="text-[10px] text-zinc-400 truncate w-full text-left">
                    {p.specialName.split(' ')[0]}
                  </div>
                  <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-1.5">
                    <div
                      className="h-full"
                      style={{ width: `${cs.hp}%`, backgroundColor: p.color }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* === [M] SAN ANDREAS FULL-ISLAND INTERACTIVE SATELLITE MAP & FAST TRAVEL MODAL === */}
      {state.worldMapOpen && (
        <div
          className="fixed inset-0 z-40 bg-zinc-950/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => state.setWorldMapOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-5xl w-full p-6 shadow-2xl grid grid-cols-1 lg:grid-cols-12 gap-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: Interactive Visual Island Map */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Compass className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-black text-white">
                    聖安地列斯全島衛星大地圖 (San Andreas Island)
                  </h3>
                </div>
                <span className="text-xs text-sky-300 font-semibold">
                  點擊地圖任意處或右側地標即可【衛星空降傳送】
                </span>
              </div>

              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const nx = (e.clientX - rect.left) / rect.width;
                  const nz = (e.clientY - rect.top) / rect.height;
                  const worldX = Math.round((nx - 0.5) * 460);
                  const worldZ = Math.round((nz - 0.5) * 420);
                  engineRef.current?.teleportTo(worldX, worldZ, `自訂座標 (${worldX}, ${worldZ})`);
                }}
                className="relative w-full h-[390px] rounded-2xl overflow-hidden border-2 border-zinc-700 bg-sky-950 cursor-crosshair shadow-inner"
              >
                {/* Biome Zones Visual Illustration */}
                {/* Vinewood Hills North */}
                <div
                  className="absolute bg-emerald-900/85 border-b border-emerald-500/30 rounded-b-3xl flex items-start justify-center pt-3 text-[11px] font-black text-emerald-200 tracking-widest"
                  style={{ left: '20%', top: '0%', width: '52%', height: '32%' }}
                >
                  ⛰️ 好麥塢山脈 · VINEWOOD & 伽利略山頂天文台 (海拔 24m)
                </div>
                {/* Vespucci Beach & Pier West */}
                <div
                  className="absolute bg-amber-500/30 border-r border-amber-300/40 flex items-center justify-center text-[10px] font-bold text-amber-200"
                  style={{ left: '12%', top: '32%', width: '14%', height: '48%' }}
                >
                  🏖️ 威斯普奇陽光沙灘
                </div>
                {/* Del Perro Pier */}
                <div
                  className="absolute bg-amber-800/90 border border-pink-400/60 rounded flex items-center justify-center text-[10px] font-bold text-pink-200"
                  style={{ left: '2%', top: '50%', width: '20%', height: '8%' }}
                >
                  🎡 摩天輪碼頭
                </div>
                {/* Downtown Los Santos Center */}
                <div
                  className="absolute bg-slate-800/90 border border-slate-600 rounded-xl flex items-center justify-center text-xs font-black text-slate-200"
                  style={{ left: '26%', top: '33%', width: '42%', height: '40%' }}
                >
                  🏙️ 洛聖都金融摩天核心區 (Downtown)
                </div>
                {/* Sandy Shores Desert East */}
                <div
                  className="absolute bg-orange-900/75 border-l border-orange-500/40 rounded-l-2xl flex flex-col items-center justify-center text-[11px] font-black text-orange-200"
                  style={{ left: '68%', top: '10%', width: '32%', height: '62%' }}
                >
                  <span>🌵 桑迪海岸紅岩沙漠</span>
                  <span className="text-[10px] text-amber-300 mt-0.5">🚁 崔佛沙漠機場 & 大風車陣</span>
                </div>
                {/* LSIA Airport South */}
                <div
                  className="absolute bg-slate-900/95 border-t-2 border-cyan-500/40 flex flex-col items-center justify-center text-[11px] font-black text-cyan-200"
                  style={{ left: '26%', top: '73%', width: '68%', height: '24%' }}
                >
                  <span>✈️ 洛聖都國際機場 (LSIA International Runway)</span>
                  <span className="text-[10px] text-zinc-400">波音巨型客機 · 噴射機跑道 · 飛車特技跳台</span>
                </div>

                {/* Plot All Landmarks on the Interactive Map */}
                {LANDMARKS.map((lm) => {
                  const leftPct = 50 + (lm.x / 460) * 100;
                  const topPct = 50 + (lm.z / 420) * 100;
                  return (
                    <button
                      key={lm.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        engineRef.current?.teleportTo(lm.x, lm.z, lm.name);
                      }}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-zinc-950/90 hover:bg-amber-400 hover:text-zinc-950 text-white border border-white/40 text-[10px] font-bold shadow-lg transition cursor-pointer whitespace-nowrap"
                    >
                      {lm.icon} {lm.name.split(' ')[0]}
                    </button>
                  );
                })}

                {/* Plot Stunt Ramps */}
                {STUNT_RAMPS.map((r) => {
                  const leftPct = 50 + (r.x / 460) * 100;
                  const topPct = 50 + (r.z / 420) * 100;
                  return (
                    <div
                      key={r.id}
                      title={r.name}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-pink-500/90 border border-white text-[9px] flex items-center justify-center text-white font-bold pointer-events-none"
                    >
                      ▲
                    </div>
                  );
                })}

                {/* Plot Current Player Position */}
                <div
                  style={{
                    left: `${50 + (activeCharState.x / 460) * 100}%`,
                    top: `${50 + (activeCharState.z / 420) * 100}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-400 border-2 border-zinc-950 shadow-[0_0_12px_#4ade80] pointer-events-none animate-ping"
                />
              </div>
            </div>

            {/* Right: 6 Region Fast-Travel Cards */}
            <div className="lg:col-span-5 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
                  🛰️ 一鍵衛星空降地標 (Fast Travel)
                </div>
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {LANDMARKS.map((lm) => (
                    <button
                      key={lm.id}
                      onClick={() => engineRef.current?.teleportTo(lm.x, lm.z, lm.name)}
                      className="w-full p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-amber-400/60 flex items-center justify-between text-left transition cursor-pointer group"
                    >
                      <div>
                        <div className="text-xs font-bold text-white group-hover:text-amber-300 flex items-center gap-1.5">
                          <span>{lm.icon}</span>
                          <span>{lm.name}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{lm.description}</div>
                      </div>
                      <Navigation className="w-4 h-4 text-sky-400 shrink-0 ml-2 group-hover:translate-x-0.5 transition" />
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => state.setWorldMapOpen(false)}
                className="w-full mt-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-white cursor-pointer"
              >
                關閉衛星地圖返回遊戲 [M / Esc]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === RADIAL 8-SLOT WEAPON WHEEL MODAL (Hold Tab or Click) === */}
      {state.weaponWheelOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-950/75 backdrop-blur-sm flex items-center justify-center"
          onClick={() => state.updateHUD({ weaponWheelOpen: false })}
        >
          <div
            className="relative w-[480px] h-[480px] rounded-full border-2 border-zinc-700/80 bg-zinc-900/90 shadow-2xl flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {WEAPON_WHEEL_ORDER.map((wId, idx) => {
              const spec = WEAPONS[wId];
              const ammo = state.weapons[wId];
              const isSelected = activeCharState.weapon === wId;
              const angle = (idx / 8) * Math.PI * 2 - Math.PI / 2;
              const radius = 168;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;

              return (
                <button
                  key={wId}
                  onMouseEnter={() => engineRef.current?.selectWeapon(wId)}
                  onClick={() => {
                    engineRef.current?.selectWeapon(wId);
                    state.updateHUD({ weaponWheelOpen: false });
                  }}
                  style={{
                    transform: `translate(${x}px, ${y}px)`,
                  }}
                  className={`absolute w-28 h-24 rounded-2xl border-2 p-2 flex flex-col items-center justify-center text-center transition cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800 border-amber-400 scale-110 shadow-[0_0_25px_rgba(251,191,36,0.45)]'
                      : 'bg-zinc-950/90 border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  <span className="text-[10px] font-mono text-zinc-400">SLOT {idx + 1}</span>
                  <span className="text-xs font-extrabold text-white mt-0.5 leading-tight">
                    {spec.name}
                  </span>
                  <span className="text-[11px] font-mono mt-1" style={{ color: spec.color }}>
                    {wId === 'unarmed' ? '∞' : `${ammo.inMag} / ${ammo.reserve}`}
                  </span>
                </button>
              );
            })}

            <div className="w-48 h-48 rounded-full bg-zinc-950 border border-zinc-700 p-4 flex flex-col items-center justify-center text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                {activeWeaponSpec.category}
              </div>
              <div className="text-base font-black text-white mt-0.5">{activeWeaponSpec.name}</div>
              <div className="w-full space-y-1.5 mt-2.5 text-[10px] text-zinc-300">
                <div className="flex items-center justify-between">
                  <span>單發傷害</span>
                  <div className="w-20 h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-red-400"
                      style={{ width: `${Math.min(100, activeWeaponSpec.damage / 1.5)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>連發射速</span>
                  <div className="w-20 h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-sky-400"
                      style={{ width: `${Math.min(100, activeWeaponSpec.fireRate * 5)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>有效射程</span>
                  <div className="w-20 h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${Math.min(100, activeWeaponSpec.range / 2.4)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 mt-2">點擊任一武器或放開 [Tab]</div>
            </div>
          </div>
        </div>
      )}

      {/* === AMMU-NATION & LOS SANTOS CUSTOMS SHOP MODAL === */}
      {state.shopModalOpen && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {state.shopModalOpen === 'ammu' ? (
              <>
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-5 h-5 text-red-400" />
                    <h3 className="text-lg font-black text-white">武裝國度軍火店 (Ammu-Nation)</h3>
                  </div>
                  <span className="font-mono text-emerald-400 font-bold">
                    ${state.cash.toLocaleString()}
                  </span>
                </div>
                <div className="space-y-3 my-4">
                  <button
                    onClick={() => engineRef.current?.buyAmmuNationItem('ammo')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-white">補滿全 8 種武器彈匣與備彈</div>
                      <div className="text-xs text-zinc-400">
                        手槍、衝鋒槍、霰彈、步槍、狙擊、RPG 與加特林全滿
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$1,200</span>
                  </button>
                  <button
                    onClick={() => engineRef.current?.buyAmmuNationItem('armor')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-white">重型複合防彈衣 + 急救包</div>
                      <div className="text-xs text-zinc-400">
                        立即恢復 100% 生命值與 100% 藍色防彈護甲
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$800</span>
                  </button>
                  <button
                    onClick={() => engineRef.current?.buyAmmuNationItem('heavy')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-amber-300">重裝毀滅軍火套組 (RPG + 火神機槍)</div>
                      <div className="text-xs text-zinc-400">
                        直接切換至 RPG 火箭筒並補滿重型火器彈藥
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$3,500</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-black text-white">洛聖都改車王 (LS Customs)</h3>
                  </div>
                  <span className="font-mono text-emerald-400 font-bold">
                    ${state.cash.toLocaleString()}
                  </span>
                </div>
                <div className="space-y-3 my-4">
                  <button
                    onClick={() => engineRef.current?.useLSCustoms('clear_wanted')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-amber-300">
                        更換偽造車牌 · 立即消除所有通緝星等
                      </div>
                      <div className="text-xs text-zinc-400">
                        撤離全數 LSPD 警車、特警與空中武裝直升機
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$1,500</span>
                  </button>
                  <button
                    onClick={() => engineRef.current?.useLSCustoms('repair')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-white">板金引擎全面修復與防彈強化</div>
                      <div className="text-xs text-zinc-400">
                        完全修復當前座駕耐久度並消除引擎黑煙
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$600</span>
                  </button>
                  <button
                    onClick={() => engineRef.current?.useLSCustoms('respray')}
                    className="w-full p-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-bold text-purple-300">隨機賽博金屬霓虹烤漆</div>
                      <div className="text-xs text-zinc-400">為座駕換上高反光金屬車漆</div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">$500</span>
                  </button>
                </div>
              </>
            )}
            <button
              onClick={() => state.setShopModalOpen(null)}
              className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-white cursor-pointer"
            >
              關閉返回洛聖都街頭 [Esc]
            </button>
          </div>
        </div>
      )}

      {/* === FULLSCREEN GTA V BANNERS (WASTED / MISSION PASSED / HEIST START) === */}
      {state.banner.type && (
        <div className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="w-full bg-zinc-950/90 border-y-2 border-zinc-700 py-8 px-6 text-center shadow-2xl">
            <h2
              className={`text-5xl md:text-6xl font-black tracking-wider uppercase ${
                state.banner.type === 'wasted'
                  ? 'text-red-500 drop-shadow-[0_0_25px_rgba(239,68,68,0.8)]'
                  : 'text-amber-400 drop-shadow-[0_0_25px_rgba(251,191,36,0.8)]'
              }`}
            >
              {state.banner.title}
            </h2>
            <p className="text-base md:text-lg text-zinc-200 font-semibold mt-2">
              {state.banner.subtitle}
            </p>
          </div>
        </div>
      )}

      {/* === START MENU / PAUSE OVERLAY === */}
      {(!state.started || state.paused) && (
        <div className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[2px] flex items-center justify-center p-6">
          <div className="max-w-3xl w-full bg-zinc-950/90 border border-zinc-700/80 rounded-3xl p-8 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold mb-2">
                  <span>SAN ANDREAS MULTI-BIOME 3D ISLAND OPEN WORLD</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                  洛聖都行動 · <span className="text-amber-400">Los Santos Lite</span>
                </h1>
                <p className="text-sm text-zinc-300 mt-1">
                  威斯普奇陽光沙灘摩天輪 × 好麥塢山頂天文台 × 桑迪紅岩沙漠風車陣 × 洛聖都國際機場 × 可駕駛禿鷹武裝直升機
                </p>
              </div>
              <button
                onClick={() => {
                  state.setStarted(true);
                  state.setPaused(false);
                }}
                className="px-7 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-base shadow-[0_0_30px_rgba(251,191,36,0.45)] transition flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>{state.started ? '繼續行動' : '立即進入聖安地列斯'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-6">
              {(['michael', 'franklin', 'trevor'] as CharacterId[]).map((cid, idx) => {
                const p = PROTAGONISTS[cid];
                const isSelected = state.activeChar === cid;
                return (
                  <div
                    key={cid}
                    onClick={() => engineRef.current?.switchCharacter(cid)}
                    className={`p-4 rounded-2xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-800/95 border-amber-400 shadow-lg'
                        : 'bg-zinc-900/75 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="text-xs font-black font-mono px-2 py-0.5 rounded text-zinc-950"
                        style={{ backgroundColor: p.color }}
                      >
                        按鍵 [{idx + 1}]
                      </span>
                      <span className="text-xs text-zinc-400 font-semibold">{p.title}</span>
                    </div>
                    <div className="text-base font-extrabold text-white">{p.name}</div>
                    <div className="text-xs font-bold text-amber-300 mt-2">
                      ⚡ [Q] {p.specialName}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {p.specialDesc}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4">
              <div>
                <span className="font-mono font-bold text-amber-400">[M / 點擊雷達]</span>
                <div className="text-zinc-300 mt-0.5">全島衛星大地圖 & 空降傳送</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[E / Space / Shift]</span>
                <div className="text-zinc-300 mt-0.5">駕駛跑車或【禿鷹武裝直升機】升空</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[左鍵 / 右鍵 / Tab]</span>
                <div className="text-zinc-300 mt-0.5">射擊火箭 / 精準開鏡 / 武器輪盤</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[1 / 2 / 3 / Q]</span>
                <div className="text-zinc-300 mt-0.5">三主角高空切換 / 專屬特殊能力</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
