import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { useHud } from '../game/state';

const STICK_R = 56;
const LOOK_GAIN = 1.35;
/** The dashed "drag here to move" ghost is only shown until the player has used the stick once. */
let stickLearned = false;

/** On-screen controls for phones and tablets: floating joystick, drag-to-look and action buttons. */
export function TouchControls({ game }: { game: Game }) {
  const inp = game.input;
  const inVehicle = useHud((s) => s.inVehicle);
  const weapon = useHud((s) => s.weapon);
  const prompt = useHud((s) => s.prompt);
  const flying = useHud((s) => s.altitude !== null);
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [aim, setAim] = useState(false);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  useEffect(
    () => () => {
      inp.vMoveX = 0;
      inp.vMoveY = 0;
      inp.setFire(false);
      inp.setAim(false);
      inp.setKey('ShiftLeft', false);
    },
    [inp],
  );

  const onZoneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const left = e.clientX < window.innerWidth * 0.45;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (left && stickId.current === null) {
      stickId.current = e.pointerId;
      stickLearned = true;
      setStick({ ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    } else if (lookId.current === null) {
      lookId.current = e.pointerId;
      last.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onZoneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stickId.current && stick) {
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        dx = (dx / d) * STICK_R;
        dy = (dy / d) * STICK_R;
      }
      const nx = dx / STICK_R;
      const ny = dy / STICK_R;
      // small dead zone
      inp.vMoveX = Math.abs(nx) < 0.12 ? 0 : nx;
      inp.vMoveY = Math.abs(ny) < 0.12 ? 0 : -ny;
      inp.setKey('ShiftLeft', d >= STICK_R * 0.98 && !inVehicle);
      setStick({ ...stick, x: dx, y: dy });
    } else if (e.pointerId === lookId.current) {
      inp.addLook((e.clientX - last.current.x) * LOOK_GAIN, (e.clientY - last.current.y) * LOOK_GAIN);
      last.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onZoneUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stickId.current) {
      stickId.current = null;
      inp.vMoveX = 0;
      inp.vMoveY = 0;
      inp.setKey('ShiftLeft', false);
      setStick(null);
    }
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  // fire button doubles as a look pad while held
  const fireLast = useRef({ x: 0, y: 0 });
  const fire = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      fireLast.current = { x: e.clientX, y: e.clientY };
      inp.setFire(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!inp.lmb) return;
      inp.addLook((e.clientX - fireLast.current.x) * LOOK_GAIN, (e.clientY - fireLast.current.y) * LOOK_GAIN);
      fireLast.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: () => inp.setFire(false),
    onPointerCancel: () => inp.setFire(false),
  };

  const hold = (code: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      inp.setKey(code, true);
    },
    onPointerUp: () => inp.setKey(code, false),
    onPointerCancel: () => inp.setKey(code, false),
    onPointerLeave: () => inp.setKey(code, false),
  });
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      fn();
    },
  });
  const press = (code: string) => () => {
    inp.setKey(code, true);
    setTimeout(() => inp.setKey(code, false), 60);
  };

  const canShoot = !inVehicle || weapon === 'pistol' || weapon === 'smg' || weapon === 'grenade';

  return (
    <div className="absolute inset-0 z-10 touch-none select-none" onPointerDown={onZoneDown} onPointerMove={onZoneMove} onPointerUp={onZoneUp} onPointerCancel={onZoneUp}>
      {/* joystick */}
      {stick ? (
        <div className="pointer-events-none absolute" style={{ left: stick.ox - STICK_R, top: stick.oy - STICK_R }}>
          <div className="rounded-full border-2 border-white/30 bg-black/25" style={{ width: STICK_R * 2, height: STICK_R * 2 }} />
          <div
            className="absolute rounded-full bg-white/70 shadow-lg"
            style={{ width: 48, height: 48, left: STICK_R - 24 + stick.x, top: STICK_R - 24 + stick.y }}
          />
        </div>
      ) : stickLearned ? null : (
        <div className="pointer-events-none absolute bottom-[34%] left-[10%] text-center text-[11px] font-semibold text-white/45">
          <div className="mx-auto mb-1 h-16 w-16 rounded-full border-2 border-dashed border-white/25" />
          左側拖曳移動
        </div>
      )}

      {/* top buttons */}
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-2">
        <SmallBtn label="暫停" {...tap(() => game.setPhase('paused'))} />
        <SmallBtn label="地圖" {...tap(() => game.setPhase('map'))} />
        {inVehicle && <SmallBtn label="電台" {...tap(press('KeyB'))} />}
      </div>

      {/* action cluster */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Btn label="專注" sub="Q" small {...tap(press('KeyQ'))} />
          <Btn label="換彈" sub="R" small {...tap(press('KeyR'))} />
          <Btn label="武器" sub="切換" small {...tap(() => game.cycleWeapon(1))} />
          {prompt && <Btn label="互動" sub="E" small accent {...tap(press('KeyE'))} />}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <Btn label={inVehicle ? '下車' : '上車'} sub="F" {...tap(press('KeyF'))} />
            {canShoot && (
              <Btn
                label="瞄準"
                sub={aim ? '開' : '關'}
                active={aim}
                {...tap(() => {
                  const next = !aim;
                  setAim(next);
                  inp.setAim(next);
                })}
              />
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            {flying && <Btn label="下降" sub="" {...hold('ShiftLeft')} />}
            <Btn label={flying ? '上升' : inVehicle ? '手煞車' : '跳躍'} sub="" {...hold('Space')} />
            {canShoot ? (
              <button
                {...fire}
                className="h-[86px] w-[86px] rounded-full border-2 border-red-300/70 bg-red-500/55 text-base font-black text-white shadow-[0_6px_20px_rgba(0,0,0,0.4)] active:bg-red-500/80"
              >
                射擊
              </button>
            ) : (
              <Btn label="喇叭" sub="H" {...tap(press('KeyH'))} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type BtnProps = React.HTMLAttributes<HTMLButtonElement> & { label: string; sub?: string; small?: boolean; active?: boolean; accent?: boolean };
function Btn({ label, sub, small, active, accent, ...rest }: BtnProps) {
  const size = small ? 'h-12 w-12 text-[11px]' : 'h-[60px] w-[60px] text-[13px]';
  const color = active ? 'bg-amber-400/85 text-black border-amber-200' : accent ? 'bg-emerald-500/70 text-white border-emerald-200/70' : 'bg-black/45 text-white border-white/25';
  return (
    <button {...rest} className={`${size} ${color} flex flex-col items-center justify-center rounded-full border font-black leading-tight backdrop-blur-sm active:scale-95`}>
      <span>{label}</span>
      {sub ? <span className="text-[9px] font-bold opacity-60">{sub}</span> : null}
    </button>
  );
}
function SmallBtn({ label, ...rest }: React.HTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} className="rounded-full border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm active:bg-black/70">
      {label}
    </button>
  );
}

/** Ask the player to rotate a phone held upright. */
export function RotateHint() {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!portrait) return null;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-[#0b0f17]/95 p-8 text-center">
      <div className="text-5xl">⟳</div>
      <div className="text-lg font-bold text-white">請將手機橫向持握</div>
      <div className="text-sm text-white/60">橫向畫面才能完整顯示遊戲與觸控按鈕</div>
    </div>
  );
}
