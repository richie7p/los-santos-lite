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

function Button({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-xl px-5 py-3 text-left text-[16px] font-bold transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
        primary ? 'bg-amber-400 text-black hover:bg-amber-300 shadow-[0_6px_24px_rgba(251,191,36,0.35)]' : 'bg-white/8 text-white hover:bg-white/15 border border-white/10'
      }`}
    >
      {children}
    </button>
  );
}

export function LoadingScreen() {
  const text = useHud((s) => s.loadingText);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0f17]">
      <Logo />
      <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-[loadbar_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
      </div>
      <div className="mt-3 text-sm text-white/60">{text}</div>
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
  return (
    <div className="absolute inset-0 z-40 flex items-center bg-gradient-to-r from-black/85 via-black/45 to-transparent">
      <div className="ml-[6vw] w-[min(440px,88vw)]">
        <div className="text-left">
          <div className="font-display text-[clamp(52px,8vw,96px)] font-black leading-[0.9] tracking-tight text-white [text-shadow:0_6px_30px_rgba(0,0,0,0.6)]">
            索拉港
            <br />
            <span className="text-amber-400">街頭</span>
          </div>
          <div className="mt-2 font-display text-lg font-bold tracking-[0.4em] text-white/70">PORT SOLARA STREETS</div>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">
            開放世界犯罪動作沙盒。飆車、槍戰、甩掉警方的追捕，從街頭小子一路幹到索拉港的傳奇。
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-3">
          {hasSave && (
            <Button primary onClick={() => game.start(true)}>
              繼續遊戲
            </Button>
          )}
          <Button primary={!hasSave} onClick={() => game.start(false)}>
            開始新遊戲
          </Button>
          <Button onClick={() => setShowControls((v) => !v)}>{showControls ? '收起操作說明' : '操作說明'}</Button>
        </div>
        {showControls && <ControlsList />}
        <div className="mt-6 text-xs text-white/40">
          {game.input.touch ? '觸控操作：左半邊拖曳移動、右半邊拖曳轉視角，右下角按鈕射擊與互動。建議橫向持握。' : '建議使用滑鼠與鍵盤遊玩。點擊遊戲畫面以鎖定滑鼠。'}
        </div>
      </div>
    </div>
  );
}

function ControlsList() {
  return (
    <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-black/50 border border-white/10 p-4 text-sm">
      {CONTROLS.map(([k, v]) => (
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
      <div className="w-[min(520px,92vw)] rounded-2xl border border-white/10 bg-[#0e131c]/95 p-6 shadow-2xl">
        <div className="mb-4 flex items-baseline justify-between">
          <div className="font-display text-3xl font-black text-white">已暫停</div>
          <div className="text-sm text-white/50">完成度 {stats.completion}%</div>
        </div>
        {tab === 'main' && (
          <div className="flex flex-col gap-2.5">
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
          <div className="flex flex-col gap-4 text-white">
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
            <Row label={`滑鼠靈敏度 ${settings.sensitivity.toFixed(2)}`}>
              <input type="range" min={0.3} max={2.5} step={0.05} value={settings.sensitivity} onChange={(e) => game.updateSettings({ sensitivity: Number(e.target.value) })} className="w-44 accent-amber-400" />
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
            <ControlsList />
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
            drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            game.map.panBy(e.clientX - d.x, e.clientY - d.y);
            d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
            d.x = e.clientX;
            d.y = e.clientY;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && d.moved < 6) {
              const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
              game.setWaypoint(e.clientX - r.left, e.clientY - r.top);
            }
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
        <div className="absolute left-4 top-4 rounded-xl bg-black/60 px-4 py-2 text-white">
          <div className="font-display text-2xl font-black">索拉港地圖</div>
          <div className="text-xs text-white/60">滾輪縮放、拖曳移動、點擊設定導航點　·　按 M 或 Esc 返回</div>
        </div>
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
      <div className="mr-[4vw] w-[min(460px,92vw)] rounded-2xl border border-white/10 bg-[#0e131c]/95 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <div className="font-display text-2xl font-black text-white">{shop.title}</div>
          <div className="font-display text-xl font-bold text-emerald-300">${cash.toLocaleString()}</div>
        </div>
        <div className="mt-4 flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
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
        <div className="mt-4">
          <Button onClick={() => game.closeShop()}>離開（Esc）</Button>
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
