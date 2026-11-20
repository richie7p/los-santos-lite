import { useEffect, useRef, useState } from 'react';
import { WEAPONS, WEAPON_ORDER } from '../game/data';
import type { Game } from '../game/Game';
import { useHud } from '../game/state';
import { isTouchDevice } from '../game/core/input';

const TOUCH = isTouchDevice();

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hp = useHud((s) => s.hp);
  const armor = useHud((s) => s.armor);
  const focus = useHud((s) => s.focus);
  const focusActive = useHud((s) => s.focusActive);
  const district = useHud((s) => s.district);
  useEffect(() => {
    game.setMapCanvases(ref.current, game.map?.big ?? null);
    return () => game.setMapCanvases(null, game.map?.big ?? null);
  }, [game]);
  return (
    <div className={`absolute select-none ${TOUCH ? 'left-3 bottom-3 w-[150px]' : 'left-4 bottom-4 w-[232px] sm:w-[260px]'}`}>
      <div className="mb-1.5 text-[13px] font-bold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{district}</div>
      <div className="relative overflow-hidden rounded-xl border border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <canvas ref={ref} width={260} height={170} className="block w-full h-auto" />
      </div>
      <div className="mt-1.5 grid grid-cols-[2fr_1fr_1fr] gap-1">
        <Bar value={hp} color={hp < 30 ? '#ef4444' : '#4ade80'} />
        <Bar value={armor} color="#60a5fa" />
        <Bar value={focus} color={focusActive ? '#fde047' : '#eab308'} pulse={focusActive} />
      </div>
    </div>
  );
}

function Bar({ value, color, pulse }: { value: number; color: string; pulse?: boolean }) {
  return (
    <div className="h-2 rounded-full bg-black/60 overflow-hidden border border-white/10">
      <div className={`h-full transition-[width] duration-200 ${pulse ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

function TopRight() {
  const cash = useHud((s) => s.cash);
  const delta = useHud((s) => s.cashDelta);
  const heat = useHud((s) => s.heat);
  const searching = useHud((s) => s.heatSearching);
  const clock = useHud((s) => s.clock);
  return (
    <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5 select-none">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} viewBox="0 0 24 24" className={`w-6 h-6 ${i <= heat ? (searching ? 'animate-pulse' : '') : 'opacity-25'}`}>
            <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" fill={i <= heat ? (searching ? '#93c5fd' : '#f8fafc') : 'none'} stroke="#f8fafc" strokeWidth="1.6" />
          </svg>
        ))}
      </div>
      <div className="font-display text-[34px] leading-none font-bold text-emerald-300 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] tabular-nums">{fmt(cash)}</div>
      {delta !== 0 && (
        <div className={`font-display text-xl font-bold tabular-nums drop-shadow ${delta > 0 ? 'text-emerald-200' : 'text-red-300'}`}>
          {delta > 0 ? '+' : '-'}
          {fmt(Math.abs(delta))}
        </div>
      )}
      <div className="font-display text-lg text-white/85 tabular-nums drop-shadow">{clock}</div>
    </div>
  );
}

function WeaponPanel() {
  const weapon = useHud((s) => s.weapon);
  const mag = useHud((s) => s.mag);
  const reserve = useHud((s) => s.reserve);
  const reloading = useHud((s) => s.reloading);
  const spec = WEAPONS[weapon];
  return (
    <div className={`absolute select-none ${TOUCH ? 'left-1/2 top-12 -translate-x-1/2 scale-[0.8] origin-top text-center' : 'right-4 top-[150px] text-right'}`}>
      <div className="inline-flex items-center gap-3 rounded-xl bg-black/45 backdrop-blur-sm border border-white/10 px-4 py-2">
        <div>
          <div className="text-[11px] tracking-widest text-white/50">WEAPON</div>
          <div className="text-[15px] font-bold text-white">{spec.name}</div>
        </div>
        {weapon !== 'fist' && (
          <div className="pl-3 border-l border-white/15">
            {reloading ? (
              <div className="font-display text-lg text-amber-300 animate-pulse">裝填中</div>
            ) : (
              <div className="font-display tabular-nums">
                <span className={`text-2xl font-bold ${mag === 0 ? 'text-red-400' : 'text-white'}`}>{mag}</span>
                <span className="text-white/50 text-base"> / {reserve}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Objective() {
  const title = useHud((s) => s.missionTitle);
  const obj = useHud((s) => s.objective);
  const timer = useHud((s) => s.timer);
  if (!obj && timer === null) return null;
  return (
    <div className="absolute left-4 top-4 max-w-[min(420px,60vw)] select-none">
      <div className="rounded-xl bg-black/50 backdrop-blur-sm border-l-4 border-amber-400 px-4 py-2.5 shadow-lg">
        {title && <div className="text-[11px] font-bold tracking-[0.2em] text-amber-300">{title}</div>}
        {obj && <div className="text-[15px] font-bold text-white leading-snug">{obj}</div>}
        {timer !== null && <div className="font-display text-2xl font-bold text-amber-200 tabular-nums">{timer.toFixed(1)}s</div>}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useHud((s) => s.toasts);
  const obj = useHud((s) => s.objective);
  const colors: Record<string, string> = {
    info: 'border-white/30',
    good: 'border-emerald-400',
    bad: 'border-red-400',
    money: 'border-emerald-300',
    heat: 'border-sky-400',
  };
  return (
    <div className={`absolute left-4 ${obj ? 'top-[110px]' : 'top-4'} flex flex-col gap-1.5 select-none pointer-events-none`}>
      {toasts.map((t) => (
        <div key={t.id} className={`toast-in rounded-lg bg-black/60 backdrop-blur-sm border-l-4 ${colors[t.kind]} px-3 py-1.5 text-sm font-semibold text-white shadow`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Subtitle() {
  const sub = useHud((s) => s.subtitle);
  const prompt = useHud((s) => s.prompt);
  return (
    <div className={`absolute left-1/2 -translate-x-1/2 ${TOUCH ? 'bottom-[150px] w-[min(520px,60vw)]' : 'bottom-[86px] w-[min(760px,92vw)]'} flex flex-col items-center gap-2 select-none pointer-events-none`}>
      {sub && <div className="text-center text-[17px] font-bold text-white leading-relaxed [text-shadow:0_2px_4px_#000,0_0_12px_rgba(0,0,0,0.8)]">{sub}</div>}
      {prompt && (
        <div className="rounded-lg bg-black/65 border border-white/15 px-3 py-1.5 text-[14px] font-semibold text-white">
          {prompt.split(/(\[[^\]]+\])/).map((part, i) =>
            part.startsWith('[') ? (
              <kbd key={i} className="mx-0.5 rounded bg-amber-400 px-1.5 py-0.5 text-[12px] font-black text-black">
                {part.slice(1, -1)}
              </kbd>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function BigMessage() {
  const big = useHud((s) => s.big);
  if (!big) return null;
  return (
    <div key={big.id} className={`big-in absolute inset-x-0 ${TOUCH ? 'top-[22%] scale-75 origin-top' : 'top-[24%]'} flex flex-col items-center select-none pointer-events-none`}>
      <div className="font-display text-[clamp(36px,6vw,72px)] font-black tracking-wide [text-shadow:0_4px_18px_rgba(0,0,0,0.85)]" style={{ color: big.color ?? '#fff' }}>
        {big.title}
      </div>
      {big.sub && <div className="mt-1 rounded bg-black/55 px-4 py-1 text-[15px] font-semibold text-white">{big.sub}</div>}
    </div>
  );
}

function StuntText() {
  const t = useHud((s) => s.stuntText);
  if (!t) return null;
  return (
    <div key={t} className="big-in absolute inset-0 flex items-center justify-center select-none pointer-events-none">
      <div className="font-display text-[120px] font-black text-amber-300 [text-shadow:0_6px_24px_rgba(0,0,0,0.8)]">{t}</div>
    </div>
  );
}

function Crosshair() {
  const spread = useHud((s) => s.spread);
  const aiming = useHud((s) => s.aiming);
  const scoped = useHud((s) => s.scoped);
  const weapon = useHud((s) => s.weapon);
  const inVehicle = useHud((s) => s.inVehicle);
  const hit = useHud((s) => s.hit);
  const kill = useHud((s) => s.kill);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(id);
  }, []);
  const showHit = now - hit < 160;
  const showKill = now - kill < 420;
  if (scoped)
    return (
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, transparent 0, transparent 34vmin, rgba(0,0,0,0.96) 34.4vmin)' }} />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-black/80" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-black/80" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
        {(showHit || showKill) && <HitX kill={showKill} />}
      </div>
    );
  if (inVehicle && !aiming) return null;
  const gap = 4 + spread * 5;
  const show = aiming || weapon !== 'fist';
  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none">
      {show && (
        <div className={`transition-opacity ${aiming ? 'opacity-100' : 'opacity-60'}`}>
          <div className="absolute h-[2px] w-2.5 bg-white shadow-[0_0_2px_#000]" style={{ left: gap, top: -1 }} />
          <div className="absolute h-[2px] w-2.5 bg-white shadow-[0_0_2px_#000]" style={{ left: -gap - 10, top: -1 }} />
          <div className="absolute w-[2px] h-2.5 bg-white shadow-[0_0_2px_#000]" style={{ top: gap, left: -1 }} />
          <div className="absolute w-[2px] h-2.5 bg-white shadow-[0_0_2px_#000]" style={{ top: -gap - 10, left: -1 }} />
        </div>
      )}
      <div className="absolute -left-[2px] -top-[2px] h-1 w-1 rounded-full bg-white shadow-[0_0_2px_#000]" />
      {(showHit || showKill) && <HitX kill={showKill} />}
    </div>
  );
}

function HitX({ kill }: { kill: boolean }) {
  const c = kill ? '#ef4444' : '#ffffff';
  return (
    <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width="34" height="34" viewBox="0 0 34 34">
      <g stroke={c} strokeWidth="2.5" strokeLinecap="round">
        <line x1="5" y1="5" x2="12" y2="12" />
        <line x1="29" y1="5" x2="22" y2="12" />
        <line x1="5" y1="29" x2="12" y2="22" />
        <line x1="29" y1="29" x2="22" y2="22" />
      </g>
    </svg>
  );
}

function Speedo() {
  const inVehicle = useHud((s) => s.inVehicle);
  const speed = useHud((s) => s.speedKmh);
  const name = useHud((s) => s.vehicleName);
  const vhp = useHud((s) => s.vehicleHp);
  const radio = useHud((s) => s.radio);
  const alt = useHud((s) => s.altitude);
  if (!inVehicle) return null;
  return (
    <div className={`absolute select-none ${TOUCH ? 'left-1/2 -translate-x-1/2 bottom-2 text-center scale-75 origin-bottom' : 'right-4 bottom-4 text-right'}`}>
      <div className="text-[12px] text-white/70 font-semibold">{radio}</div>
      <div className="font-display text-[56px] leading-none font-bold text-white tabular-nums [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
        {speed}
        <span className="text-xl text-white/60 ml-1">km/h</span>
      </div>
      {alt !== null && <div className="font-display text-2xl font-bold text-sky-200 tabular-nums">高度 {alt} m</div>}
      <div className="text-sm font-bold text-white/90">{name}</div>
      <div className="mt-1 ml-auto h-1.5 w-40 rounded-full bg-black/60 overflow-hidden">
        <div className="h-full" style={{ width: `${vhp * 100}%`, background: vhp < 0.3 ? '#ef4444' : vhp < 0.6 ? '#f59e0b' : '#a3e635' }} />
      </div>
    </div>
  );
}

function FocusHint() {
  const active = useHud((s) => s.focusActive);
  if (!active) return null;
  return <div className="absolute left-1/2 -translate-x-1/2 top-4 rounded-full bg-amber-400/90 px-4 py-1 text-sm font-black tracking-widest text-black select-none">腎上腺素 FOCUS</div>;
}

function Fps() {
  const show = useHud((s) => s.settings.showFps);
  const fps = useHud((s) => s.fps);
  if (!show) return null;
  return <div className="absolute left-1/2 -translate-x-1/2 bottom-1 font-mono text-[11px] text-white/70">{fps} FPS</div>;
}

export function WeaponWheel() {
  const open = useHud((s) => s.wheelOpen);
  const sel = useHud((s) => s.wheelSel);
  const owned = useHud((s) => s.owned);
  const cur = useHud((s) => s.weapon);
  if (!open) return null;
  const R = 150;
  return (
    <div className="absolute inset-0 flex items-center justify-center select-none pointer-events-none">
      <div className="relative" style={{ width: R * 2 + 120, height: R * 2 + 120 }}>
        <div className="absolute inset-[60px] rounded-full bg-black/55 backdrop-blur-md border border-white/10" />
        {WEAPON_ORDER.map((w, i) => {
          const a = (i / 8) * Math.PI * 2;
          const x = Math.sin(a) * R;
          const y = -Math.cos(a) * R;
          const has = owned.includes(w);
          const active = sel === w;
          return (
            <div
              key={w}
              className={`absolute w-[104px] -ml-[52px] -mt-[30px] rounded-xl border px-2 py-2 text-center transition-all ${
                active ? 'scale-110 border-amber-300 bg-amber-400/90 text-black' : cur === w ? 'border-white/60 bg-white/15 text-white' : 'border-white/10 bg-black/60 text-white'
              } ${has ? '' : 'opacity-30'}`}
              style={{ left: '50%', top: '50%', transform: `translate(${x}px, ${y}px) ${active ? 'scale(1.1)' : ''}` }}
            >
              <div className="text-[10px] font-bold opacity-70">{i + 1}</div>
              <div className="text-[13px] font-black leading-tight">{WEAPONS[w].short}</div>
            </div>
          );
        })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="text-xs text-white/60">武器輪盤</div>
          <div className="text-base font-black text-white">{sel ? WEAPONS[sel].name : WEAPONS[cur].name}</div>
        </div>
      </div>
    </div>
  );
}

export function HUD({ game }: { game: Game }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <Crosshair />
      <Minimap game={game} />
      <TopRight />
      <WeaponPanel />
      <Objective />
      <Toasts />
      <Subtitle />
      <BigMessage />
      <StuntText />
      <Speedo />
      <FocusHint />
      <WeaponWheel />
      <Fps />
    </div>
  );
}
