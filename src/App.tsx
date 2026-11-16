import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import { useHud } from './game/state';
import { HUD } from './ui/HUD';
import { RotateHint, TouchControls } from './ui/TouchControls';
import { ClickToPlay, DeathScreen, LoadingScreen, MapScreen, PauseMenu, ShopPanel, TitleScreen } from './ui/Menus';

declare global {
  interface Window {
    __solara?: ReturnType<Game['debug']>;
  }
}

export default function App() {
  const mount = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const phase = useHud((s) => s.phase);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let g: Game | null = null;
    let cancelled = false;
    // let the loading screen paint before the heavy world build
    const t = window.setTimeout(() => {
      if (cancelled) return;
      try {
        g = new Game(el);
        g.init();
        window.__solara = g.debug();
        setGame(g);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      g?.dispose();
      delete window.__solara;
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0f17] text-white">
      <div ref={mount} className="absolute inset-0" />
      {game && (phase === 'playing' || phase === 'dead' || phase === 'paused' || phase === 'shop') && <HUD game={game} />}
      {game && phase === 'title' && <TitleScreen game={game} />}
      {game && phase === 'paused' && <PauseMenu game={game} />}
      {game && phase === 'map' && <MapScreen game={game} />}
      {game && phase === 'shop' && <ShopPanel game={game} />}
      {game && phase === 'dead' && <DeathScreen />}
      {game && phase === 'playing' && !game.input.touch && <ClickCatcher game={game} />}
      {game && phase === 'playing' && game.input.touch && <TouchControls game={game} />}
      {game && game.input.touch && <RotateHint />}
      {(!game || phase === 'loading') && !error && <LoadingScreen />}
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black p-8 text-center">
          <div>
            <div className="text-2xl font-bold text-red-400">無法啟動遊戲</div>
            <div className="mt-2 text-white/70">此瀏覽器可能不支援 WebGL。（{error}）</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** When playing without pointer lock (e.g. after alt-tab), clicking re-captures the mouse. */
function ClickCatcher({ game }: { game: Game }) {
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    const on = () => setLocked(document.pointerLockElement != null);
    document.addEventListener('pointerlockchange', on);
    on();
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  if (locked) return null;
  return <ClickToPlay game={game} />;
}
