import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { useHud, type Quality } from '../game/state';

const CONTROLS: [string, string][] = [
  ['W A S D', '移動 / 駕駛'],
  ['滑鼠', '視角'],
  ['左鍵', '射擊 / 揮拳'],
  ['右鍵', '瞄準（車上可持手槍、衝鋒槍射擊）'],
  ['Shift', '衝刺'],
  ['空白鍵', '跳躍 / 手煞車甩尾'],
  ['F', '上車 / 下車 / 劫車'],
  ['E', '互動（商店、任務、賽車）'],
  ['R', '換彈'],
  ['Tab（按住）', '武器輪盤（慢動作）'],
  ['1 – 8 / 滾輪', '快速切換武器'],
  ['Q', '腎上腺素專注（子彈時間）'],
  ['M', '地圖（點擊設定導航點）'],
  ['V', '切換鏡頭距離'],
  ['H', '喇叭 / 警笛'],
  ['B', '切換電台'],
  ['Esc', '暫停'],
];

const TOUCH_CONTROLS: [string, string][] = [
  ['左半邊拖曳', '移動（推到底奔跑）／駕駛'],
  ['右半邊拖曳', '轉動視角'],
  ['射擊', '開火（按住時可拖曳瞄準）'],
  ['瞄準', '切換瞄準模式'],
  ['跳躍／手煞車', '跳躍；開車時甩尾'],
  ['上車／下車', '上下車、劫車'],
  ['互動', '商店、任務、賽車（靠近時出現）'],
  ['武器／換彈', '切換武器、裝填彈藥'],
  ['專注', '腎上腺素子彈時間'],
  ['上方按鈕', '暫停、地圖、電台'],
];

function Button({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-xl px-5 py-3 short:py-2 text-left text-[16px] short:text-[14px] font-bold transition-all active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed ${
        primary ? 'bg-amber-400 text-black hover:bg-amber-300 shadow-[0_6px_24px_rgba(251,191,36,0.35)]' : 'bg-white/8 text-white hover:bg-white/15 border border-white/10'
      }`}
    >
      {children}
    </button>
  );
}

const TIPS = [
  '到老韓修車廠烤漆，可以清除 3 星以下的通緝。',
  '被追捕時先躲出警方視線，再離開雷達上的藍色搜索圈。',
  '1～2 星時若手無武器，警察會上前逮捕你。',
  '地圖上的錄音帶散落全島，收集齊全有額外獎勵。',
  '特技跳台在地圖上以 ⤴ 標示，飛越成功會獲得獎金。',
  '機場與醫院頂樓停著直升機，可以飛遍整座島。',
  '雨天路面濕滑，過彎記得提早減速。',
  '夜晚的城市燈火通明，試著開上北嶺俯瞰整座索拉港。',
];

export function LoadingScreen() {
  const text = useHud((s) => s.loadingText);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#172033_0%,#0b0f17_70%)] px-6">
      <Logo />
      <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-[loadbar_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
      </div>
      <div className="mt-3 text-sm text-white/60">{text}</div>
      <div className="absolute bottom-[max(18px,env(safe-area-inset-bottom))] max-w-[min(560px,90vw)] text-center text-[13px] text-white/50">
        <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-bold tracking-widest text-amber-300">提示</span>
        {tip}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="text-center select-none">
      <div className="font-display text-[clamp(48px,9vw,104px)] font-black leading-[0.9] tracking-tight text-white [text-shadow:0_6px_30px_rgba(0,0,0,0.6)]">
        索拉港<span className="text-amber-400">街頭</span>
      </div>
      <div className="mt-2 font-display text-[clamp(14px,2vw,22px)] font-bold tracking-[0.5em] text-white/70">PORT SOLARA STREETS</div>
    </div>
  );
}

export function TitleScreen({ game }: { game: Game }) {
  const hasSave = useHud((s) => s.hasSave);
  const [showControls, setShowControls] = useState(false);
  const touch = game.input.touch;
  return (
    <div className="title-in absolute inset-0 z-40 select-none">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      <div className="relative flex h-full flex-col justify-center pl-[max(6vw,env(safe-area-inset-left))] pr-6">
        <div className="w-[min(440px,64vw)]">
          <div className="logo-in font-display text-[clamp(40px,min(8vw,15vh),98px)] font-black leading-[0.88] tracking-tight text-white [text-shadow:0_6px_30px_rgba(0,0,0,0.6)]">
            索拉港
            <br />
            <span className="text-amber-400">街頭</span>
          </div>
          <div className="logo-sub mt-[1.2vh] font-display text-[clamp(11px,2.4vh,18px)] font-bold tracking-[0.42em] text-white/70">PORT SOLARA STREETS</div>
          <p className={`menu-in mt-[1.8vh] text-[15px] leading-relaxed text-white/75 short:hidden`}>
            開放世界犯罪動作沙盒。飆車、槍戰、甩掉警方的追捕，從街頭小子一路幹到索拉港的傳奇。
          </p>
          <div className={`menu-in mt-[3.2vh] flex flex-col gap-[1.3vh] short:w-[min(300px,52vw)]`}>
            {hasSave && (
              <Button primary onClick={() => game.start(true)}>
                繼續遊戲
              </Button>
            )}
            <Button primary={!hasSave} onClick={() => game.start(false)}>
              開始新遊戲
            </Button>
            <Button onClick={() => setShowControls(true)}>操作說明</Button>
          </div>
          <div className={`menu-in mt-[2.4vh] text-xs text-white/45 short:text-[10px]`}>
            {touch ? '觸控操作：左半邊拖曳移動、右半邊拖曳轉視角，右下角按鈕射擊與互動。' : '建議使用滑鼠與鍵盤遊玩。點擊遊戲畫面以鎖定滑鼠。'}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-[max(10px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] text-right font-display text-[11px] tracking-widest text-white/40">
        原創作品 · THREE.JS 即時渲染
      </div>
      {showControls && <ControlsModal touch={touch} onClose={() => setShowControls(false)} />}
    </div>
  );
}

function ControlsModal({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[92vh] w-[min(520px,94vw)] flex-col rounded-2xl border border-white/10 bg-[#0e131c]/95 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-display text-2xl font-black text-white">操作說明</div>
          <div className="text-xs text-white/45">{touch ? '觸控' : '鍵盤＋滑鼠'}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ControlsList touch={touch} />
        </div>
        <div className="mt-4">
          <Button onClick={onClose}>關閉</Button>
        </div>
      </div>
    </div>
  );
}

function ControlsList({ touch }: { touch?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-black/50 border border-white/10 p-4 text-sm">
      {(touch ? TOUCH_CONTROLS : CONTROLS).map(([k, v]) => (
        <div key={k} className="contents">
          <kbd className="justify-self-start rounded bg-white/10 px-2 py-0.5 font-mono text-[12px] text-amber-200">{k}</kbd>
          <span className="text-white/85">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function PauseMenu({ game }: { game: Game }) {
  const [tab, setTab] = useState<'main' | 'settings' | 'controls' | 'stats'>('main');
  const settings = useHud((s) => s.settings);
  const stats = useHud((s) => s.stats);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && tab !== 'main') setTab('main');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`max-h-[94vh] w-[min(520px,92vw)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e131c]/95 p-6 short:p-4 shadow-2xl`}>
        <div className={`mb-4 short:mb-2 flex items-baseline justify-between`}>
          <div className="font-display text-3xl font-black text-white">已暫停</div>
          <div className="text-sm text-white/50">完成度 {stats.completion}%</div>
        </div>
        {tab === 'main' && (
          <div className={`grid grid-cols-1 gap-2.5 short:grid-cols-2 short:gap-2`}>
            <Button primary onClick={() => game.resume()}>
              繼續遊戲
            </Button>
            <Button onClick={() => setTab('stats')}>遊戲進度</Button>
            <Button onClick={() => setTab('settings')}>設定</Button>
            <Button onClick={() => setTab('controls')}>操作說明</Button>
            <Button
              onClick={() => {
                game.save();
                game.toast('進度已儲存', 'good');
              }}
            >
              快速存檔
            </Button>
          </div>
        )}
        {tab === 'settings' && (
          <div className={`flex flex-col gap-4 short:gap-2.5 text-white`}>
            <Row label="畫質">
              <div className="flex gap-1.5">
                {(['low', 'medium', 'high'] as Quality[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => game.updateSettings({ quality: q })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold ${settings.quality === q ? 'bg-amber-400 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    {q === 'low' ? '低' : q === 'medium' ? '中' : '高'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={`${game.input.touch ? '視角靈敏度' : '滑鼠靈敏度'} ${settings.sensitivity.toFixed(2)}`}>
              <input type="range" min={0.3} max={2.5} step={0.05} value={settings.sensitivity} onChange={(e) => game.updateSettings({ sensitivity: Number(e.target.value) })} className="w-44 max-w-[40vw] accent-amber-400" />
            </Row>
            <Row label={`視野 FOV ${settings.fov}°`}>
              <input type="range" min={55} max={90} step={1} value={settings.fov} onChange={(e) => game.updateSettings({ fov: Number(e.target.value) })} className="w-44 accent-amber-400" />
            </Row>
            <Row label={`音量 ${Math.round(settings.volume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => game.updateSettings({ volume: Number(e.target.value) })} className="w-44 accent-amber-400" />
            </Row>
            <Row label="反轉 Y 軸">
              <Toggle on={settings.invertY} onChange={(v) => game.updateSettings({ invertY: v })} />
            </Row>
            <Row label="自動調整畫質（卡頓時降低解析度）">
              <Toggle on={settings.autoQuality} onChange={(v) => game.updateSettings({ autoQuality: v })} />
            </Row>
            <Row label="顯示 FPS">
              <Toggle on={settings.showFps} onChange={(v) => game.updateSettings({ showFps: v })} />
            </Row>
            <Button onClick={() => setTab('main')}>返回</Button>
          </div>
        )}
        {tab === 'controls' && (
          <div>
            <ControlsList touch={game.input.touch} />
            <div className="mt-4">
              <Button onClick={() => setTab('main')}>返回</Button>
            </div>
          </div>
        )}
        {tab === 'stats' && (
          <div className="flex flex-col gap-2 text-white">
            <Stat label="主線任務" v={`${stats.missions} / ${stats.totalMissions}`} />
            <Stat label="隱藏錄音帶" v={`${stats.tapes} / ${stats.totalTapes}`} />
            <Stat label="特技跳躍" v={`${stats.stunts} / ${stats.totalStunts}`} />
            <Stat label="完成的賽事" v={`${stats.races} / ${stats.totalRaces}`} />
            <Stat label="擊倒人數" v={`${stats.kills}`} />
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-amber-400" style={{ width: `${stats.completion}%` }} />
            </div>
            <div className="mt-3">
              <Button onClick={() => setTab('main')}>返回</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[15px] font-semibold text-white/85">{label}</span>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`h-7 w-12 rounded-full p-1 transition-colors ${on ? 'bg-amber-400' : 'bg-white/15'}`}>
      <div className={`h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}
function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between rounded-lg bg-white/5 px-3 py-2">
      <span className="text-white/75">{label}</span>
      <span className="font-display text-lg font-bold">{v}</span>
    </div>
  );
}

export function MapScreen({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  // active touch points for pinch-zoom
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const [legend, setLegend] = useState<{ icon: string; color: string; label: string }[]>([]);
  useEffect(() => {
    const c = ref.current;
    const w = wrap.current;
    if (!c || !w) return;
    const fit = () => {
      const r = w.getBoundingClientRect();
      c.width = Math.round(r.width);
      c.height = Math.round(r.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    game.setMapCanvases(game.map.mini, c);
    game.map.openBig();
    const seen = new Map<string, { icon: string; color: string; label: string }>();
    for (const b of game.map.blipList()) if (b.label && !seen.has(b.icon + b.label.split(' ')[0])) seen.set(b.icon + b.label.split(' ')[0], { icon: b.icon, color: b.color, label: b.label });
    setLegend([...seen.values()].slice(0, 18));
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyM' || e.code === 'Escape') game.resume();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      game.setMapCanvases(game.map.mini, null);
    };
  }, [game]);
  return (
    <div className="absolute inset-0 z-40 flex bg-black/80">
      <div ref={wrap} className="relative flex-1">
        <canvas
          ref={ref}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onWheel={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            game.map.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
          }}
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.current.size === 2) {
              const [a, b] = [...pts.current.values()];
              pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
              if (drag.current) drag.current.moved = 999; // a pinch never sets a waypoint
            } else drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
          }}
          onPointerMove={(e) => {
            if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            if (pinch.current && pts.current.size >= 2) {
              const [a, b] = [...pts.current.values()];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              game.map.panBy(mx - pinch.current.mx, my - pinch.current.my);
              if (pinch.current.d > 10 && d > 10) game.map.zoomBy(d / pinch.current.d, mx - r.left, my - r.top);
              pinch.current = { d, mx, my };
              return;
            }
            const d = drag.current;
            if (!d) return;
            game.map.panBy(e.clientX - d.x, e.clientY - d.y);
            d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
            d.x = e.clientX;
            d.y = e.clientY;
          }}
          onPointerUp={(e) => {
            pts.current.delete(e.pointerId);
            if (pts.current.size < 2) pinch.current = null;
            const d = drag.current;
            if (pts.current.size > 0) return;
            drag.current = null;
            if (d && d.moved < 8) {
              const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
              game.setWaypoint(e.clientX - r.left, e.clientY - r.top);
            }
          }}
          onPointerCancel={(e) => {
            pts.current.delete(e.pointerId);
            pinch.current = null;
            drag.current = null;
          }}
        />
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          <button className="h-10 w-10 rounded-full bg-black/60 text-xl font-black text-white" onClick={() => game.map.zoomBy(1.4)}>
            +
          </button>
          <button className="h-10 w-10 rounded-full bg-black/60 text-xl font-black text-white" onClick={() => game.map.zoomBy(1 / 1.4)}>
            −
          </button>
          <button className="h-10 w-10 rounded-full bg-black/60 text-xs font-black text-white" onClick={() => game.map.openBig()}>
            我
          </button>
        </div>
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-black/60 px-4 py-2 text-white">
          <div className="font-display text-2xl font-black">索拉港地圖</div>
          <div className="text-xs text-white/60">
            {game.input.touch ? '雙指縮放、拖曳移動、點一下設定導航點' : '滾輪縮放、拖曳移動、點擊設定導航點　·　按 M 或 Esc 返回'}
          </div>
        </div>
        <button
          className="absolute right-[max(16px,env(safe-area-inset-right))] top-4 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/65 px-4 py-2 text-sm font-black text-white backdrop-blur-sm active:scale-95 md:hidden"
          onClick={() => game.resume()}
        >
          ✕ 返回遊戲
        </button>
      </div>
      <div className="hidden w-64 overflow-y-auto border-l border-white/10 bg-[#0e131c]/95 p-4 md:block">
        <div className="mb-3 text-sm font-bold tracking-widest text-white/60">圖例</div>
        <div className="flex flex-col gap-2">
          {legend.map((l) => (
            <div key={l.icon + l.label} className="flex items-center gap-2 text-sm text-white/85">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black" style={{ borderColor: l.color, color: l.color }}>
                {l.icon}
              </span>
              {l.label}
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Button onClick={() => game.resume()}>返回遊戲</Button>
        </div>
      </div>
    </div>
  );
}

export function ShopPanel({ game }: { game: Game }) {
  const shop = useHud((s) => s.shop);
  const cash = useHud((s) => s.cash);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyE') game.closeShop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  if (!shop) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-end bg-gradient-to-l from-black/80 to-transparent">
      <div className={`mr-[max(4vw,env(safe-area-inset-right))] flex max-h-[94vh] w-[min(460px,92vw)] flex-col rounded-2xl border border-white/10 bg-[#0e131c]/95 p-5 short:p-3 shadow-2xl`}>
        <div className="flex items-baseline justify-between">
          <div className="font-display text-2xl font-black text-white">{shop.title}</div>
          <div className="font-display text-xl font-bold text-emerald-300">${cash.toLocaleString()}</div>
        </div>
        <div className={`mt-4 short:mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1`}>
          {shop.items.map((it) => (
            <button
              key={it.id}
              disabled={it.disabled}
              onClick={() => game.buy(it.id)}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-left transition-colors hover:bg-white/12 disabled:opacity-40"
            >
              <div>
                <div className="text-[15px] font-bold text-white">{it.name}</div>
                <div className="text-xs text-white/55">{it.desc}</div>
              </div>
              <div className={`font-display text-lg font-bold ${it.price > cash ? 'text-red-400' : 'text-emerald-300'}`}>{it.price > 0 ? `$${it.price.toLocaleString()}` : '免費'}</div>
            </button>
          ))}
        </div>
        <div className={`mt-4 short:mt-2`}>
          <Button onClick={() => game.closeShop()}>{game.input.touch ? '離開' : '離開（Esc）'}</Button>
        </div>
      </div>
    </div>
  );
}

export function DeathScreen() {
  const reason = useHud((s) => s.deathReason);
  const title = useHud((s) => s.deathTitle);
  const busted = title === '被捕';
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
      <div className={`big-in font-display text-[clamp(48px,9vw,110px)] font-black tracking-wider ${busted ? 'text-sky-400' : 'text-red-500'} [text-shadow:0_6px_30px_rgba(0,0,0,0.9)]`}>{title}</div>
      <div className="mt-2 rounded bg-black/60 px-4 py-1 text-white/85">{reason} · {busted ? '正在押送到警察局…' : '正在送往最近的醫院…'}</div>
    </div>
  );
}

export function ClickToPlay({ game }: { game: Game }) {
  return (
    <div className="absolute inset-0 z-20 cursor-pointer" onClick={() => game.resume()}>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-sm text-white">點擊畫面以繼續</div>
    </div>
  );
}
