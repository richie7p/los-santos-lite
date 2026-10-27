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
} from 'lucide-react';
import { LosSantosEngine } from './game/engine';
import { useGameStore } from './game/store';
import {
  MISSION_ORDER,
  MISSIONS,
  PROTAGONISTS,
  WEAPON_WHEEL_ORDER,
  WEAPONS,
  roadCoord,
} from './game/data';
import { CharacterId } from './game/types';
import { sound } from './game/audio';

const SHORT_MISSION_LABELS: Record<string, string> = {
  street_warmup: '1️⃣ 第一章：極速試駕',
  simeon_repo: '2️⃣ 第二章：豪車劫持',
  pier_arms: '3️⃣ 第三章：碼頭軍火',
  pacific_heist: '4️⃣ 第四章：銀行大劫案',
  federal_lockdown: '5️⃣ 終章：五星決戰',
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

  // Draw GTA V Rectangular Minimap Radar (5x5 City Grid)
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Dark radar background
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(0, 0, w, h);

    // Wanted flashing police overlay on radar
    if (state.wantedStars > 0) {
      const flashBlue = Math.floor(Date.now() / 260) % 2 === 0;
      ctx.fillStyle = state.wantedSearching
        ? 'rgba(250,204,21,0.14)'
        : flashBlue
          ? 'rgba(59,130,246,0.18)'
          : 'rgba(239,68,68,0.18)';
      ctx.fillRect(0, 0, w, h);
    }

    const px = activeCharState.x;
    const pz = activeCharState.z;
    const scale = 0.72; // world units to radar pixels

    ctx.save();
    ctx.translate(w / 2, h / 2);

    // Draw 6x6 road grid lines relative to player
    const roads = [0, 1, 2, 3, 4, 5].map((i) => roadCoord(i));
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6.5;
    for (const r of roads) {
      const rx = (r - px) * scale;
      ctx.beginPath();
      ctx.moveTo(rx, -220);
      ctx.lineTo(rx, 220);
      ctx.stroke();

      const rz = (r - pz) * scale;
      ctx.beginPath();
      ctx.moveTo(-220, rz);
      ctx.lineTo(220, rz);
      ctx.stroke();
    }

    // Draw GPS yellow route line if mission target exists
    const missionBlip = state.blips.find((b) => b.type === 'mission');
    if (missionBlip) {
      const mx = (missionBlip.x - px) * scale;
      const mz = (missionBlip.z - pz) * scale;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(mx, mz);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Radar Blips
    for (const b of state.blips) {
      const bx = Math.max(-w / 2 + 8, Math.min(w / 2 - 8, (b.x - px) * scale));
      const bz = Math.max(-h / 2 + 8, Math.min(h / 2 - 8, (b.z - pz) * scale));

      ctx.fillStyle = b.color;
      ctx.beginPath();
      const radius =
        b.type === 'mission'
          ? 6.2
          : b.type === 'cash_truck'
            ? 5.8
            : b.type === 'heli'
              ? 5.5
              : 4.2;
      ctx.arc(bx, bz, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (b.label) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Inter, sans-serif';
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
    ctx.arc(0, 0, 36, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();

    // White player triangle arrow
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
            LOS SANTOS SATELLITE UPLINK · LOCKING TARGET:{' '}
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
      {state.started && !state.paused && !state.weaponWheelOpen && !state.charWheelOpen && !isSniperScoped && (
        <div className="pointer-events-none fixed inset-0 z-15 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            {/* Center dot */}
            <div
              className={`w-1.5 h-1.5 rounded-full transition-transform ${
                state.aiming ? 'bg-red-400 scale-125' : 'bg-white/95'
              }`}
            />
            {/* 4 Dynamic Expanding Crosshair Ticks */}
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
            {/* Outer subtle ring */}
            <div
              className={`absolute border rounded-full transition-all duration-75 ${
                state.aiming ? 'border-red-400/60' : 'border-white/35'
              }`}
              style={{
                width: `${reticleGap * 2.1}px`,
                height: `${reticleGap * 2.1}px`,
              }}
            />
            {/* Hitmarker X */}
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

      {/* === COMBAT & EVENT POPUP FEED (Headshots, Cash Truck Heists, Special Abilities) === */}
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

      {/* === TOP-LEFT: 5-Chapter Heist Campaign Dispatch & Quick Sandbox Bar === */}
      {state.started && (
        <div className="fixed top-4 left-4 z-20 flex flex-col gap-2 max-w-md">
          {/* Active Mission Objective Card */}
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
                <span>📱 萊斯特五章主線劫案行動 (點擊任一章節開打)</span>
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

          {/* Quick Sandbox Cheats / Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 bg-zinc-950/80 border border-zinc-800/80 px-2.5 py-1.5 rounded-xl backdrop-blur-md text-[11px]">
            <button
              onClick={() => engineRef.current?.triggerInstantAction('spawn_supercar')}
              className="px-2 py-1 rounded bg-sky-500/15 hover:bg-sky-500/30 border border-sky-500/30 text-sky-300 font-medium cursor-pointer flex items-center gap-1"
            >
              <Car className="w-3.5 h-3.5" /> 空投超跑
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('max_arsenal')}
              className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-medium cursor-pointer flex items-center gap-1"
            >
              <Flame className="w-3.5 h-3.5" /> 滿彈藥護甲
            </button>
            <button
              onClick={() => engineRef.current?.triggerInstantAction('trigger_5star')}
              className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 text-red-300 font-medium cursor-pointer"
            >
              ⭐⭐⭐⭐⭐ 五星通緝
            </button>
            {state.wantedStars > 0 && (
              <button
                onClick={() => engineRef.current?.clearWantedLevel()}
                className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 font-medium cursor-pointer"
              >
                ✨ 消除通緝
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
          {/* Wanted 5-Star Row */}
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

          {/* GTA Green Cash Display */}
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

          {/* Active Weapon & Ammo Box */}
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

          {/* Special Ability Trigger Pill */}
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
      {state.started && !state.shopModalOpen && (state.interactPrompt || state.talkPrompt) && (
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

      {/* === BOTTOM-LEFT: GTA V Rectangular Radar + Health / Armor / Special Bars === */}
      {state.started && (
        <div className="fixed bottom-4 left-4 z-20 flex flex-col w-[252px] bg-zinc-950/95 border-2 border-zinc-800 rounded-lg overflow-hidden shadow-2xl">
          <div className="relative w-full h-[152px]">
            <canvas ref={radarCanvasRef} width={252} height={152} className="w-full h-full block" />
            <div className="absolute top-1.5 left-2 text-[10px] font-semibold text-zinc-300 bg-zinc-950/80 px-1.5 py-0.5 rounded">
              {state.district.split(' ')[0]}
            </div>
            <div className="absolute top-1.5 right-2 text-[9px] font-mono text-emerald-400 bg-zinc-950/80 px-1.5 py-0.5 rounded">
              $ 運鈔車巡邏中
            </div>
            <div className="absolute bottom-1.5 right-2 text-[10px] font-mono text-zinc-400 bg-zinc-950/80 px-1.5 py-0.5 rounded">
              擊殺 {state.kills}
            </div>
          </div>

          {/* Iconic GTA V 3-Bar Strip (50% Green HP | 25% Blue Armor | 25% Yellow Special) */}
          <div className="flex w-full h-2.5 bg-zinc-900 border-t border-zinc-800 p-0.5 gap-0.5">
            {/* Green Health Bar */}
            <div className="w-1/2 h-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  activeCharState.hp < 30 ? 'bg-red-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.hp))}%` }}
              />
            </div>
            {/* Blue Armor Bar */}
            <div className="w-1/4 h-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.armor))}%` }}
              />
            </div>
            {/* Yellow Special Ability Bar */}
            <div className="w-1/4 h-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, activeCharState.special))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* === BOTTOM-CENTER: Vehicle Speedometer HUD (when driving) === */}
      {state.started && state.inVehicle && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-950/90 border border-zinc-800 px-5 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">
              駕駛載具 · 左鍵支援車窗衝鋒槍掃射
            </div>
            <div className="text-sm font-bold text-white">{state.vehicleName}</div>
            <div className="w-36 h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full ${state.vehicleHpPercent < 40 ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${state.vehicleHpPercent}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black font-mono text-white leading-none">
              {state.vehicleSpeedKmh}
            </div>
            <div className="text-[10px] font-mono text-zinc-400">KM/H · [Space] 手煞甩尾 · [E] 下車</div>
          </div>
        </div>
      )}

      {/* === BOTTOM-RIGHT: GTA V 3-Protagonist Satellite Switch Panel === */}
      {state.started && (
        <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          <div className="text-[10px] font-mono text-zinc-400 bg-zinc-950/80 px-2.5 py-0.5 rounded border border-zinc-800">
            按 [1 / 2 / 3] 或點擊頭像啟動【GTA V 衛星高空切換】
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
            {/* 8 Weapon Slots arranged in a circle */}
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

            {/* Center Weapon Stats Hub */}
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

      {/* === START MENU / PAUSE OVERLAY (Semi-transparent over live orbiting 3D city!) === */}
      {(!state.started || state.paused) && (
        <div className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[2px] flex items-center justify-center p-6">
          <div className="max-w-3xl w-full bg-zinc-950/90 border border-zinc-700/80 rounded-3xl p-8 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold mb-2">
                  <span>GRAND THEFT ACTION SANDBOX · PHOTOREALISTIC 3D EDITION</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                  洛聖都行動 · <span className="text-amber-400">Los Santos Lite</span>
                </h1>
                <p className="text-sm text-zinc-300 mt-1">
                  擬真紋理 5×5 開放世界 × 三主角衛星切換 × 五章連續大劫案戰役 × 裝甲運鈔車攔截 × 五星特警與武裝直升機
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
                <span>{state.started ? '繼續行動' : '立即進入洛聖都'}</span>
              </button>
            </div>

            {/* 3 Protagonists Preview Cards */}
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

            {/* Controls Quick Reference Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4">
              <div>
                <span className="font-mono font-bold text-amber-400">[W A S D / Shift]</span>
                <div className="text-zinc-300 mt-0.5">慣性移動 / 衝刺 / 駕駛載具</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[左鍵 / 右鍵]</span>
                <div className="text-zinc-300 mt-0.5">後座力開火 / 精準開鏡 & 狙擊鏡</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[Tab / 滾輪]</span>
                <div className="text-zinc-300 mt-0.5">慢動作八格武器輪盤</div>
              </div>
              <div>
                <span className="font-mono font-bold text-amber-400">[E / F / Space]</span>
                <div className="text-zinc-300 mt-0.5">搶車進店 / 市民對話 / 載具甩尾</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

