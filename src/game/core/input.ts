/** Keyboard + mouse input with pointer lock. Keys are KeyboardEvent.code values. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  locked = false;
  /** When false, game keys are ignored (menus open). */
  enabled = true;
  /** Touch device: no pointer lock, input comes from on-screen controls. */
  readonly touch: boolean;
  /** Analog stick from the touch joystick (-1..1). */
  vMoveX = 0;
  vMoveY = 0;
  /** selfReleased: the game released the lock itself (menu/shop), not the user pressing Esc. */
  onLockChange?: (locked: boolean, selfReleased: boolean) => void;
  private releasing = false;

  constructor(private el: HTMLElement) {
    this.touch = isTouchDevice();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
    el.addEventListener('contextmenu', this.prevent);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.el.removeEventListener('contextmenu', this.prevent);
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  requestLock() {
    if (this.touch) return;
    if (document.pointerLockElement !== this.el) {
      try {
        const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore – e.g. headless or iframe without permission */
      }
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.el) {
      this.releasing = true;
      document.exitPointerLock();
    }
  }

  isDown(code: string) {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string) {
    return this.enabled && this.pressed.has(code);
  }
  /** Pressed this frame, even while game input is disabled (menus). */
  rawPressed(code: string) {
    return this.pressed.has(code);
  }
  wasReleased(code: string) {
    return this.released.has(code);
  }
  axis(neg: string, pos: string) {
    let v = (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
    if (this.enabled) {
      if (neg === 'KeyA' && pos === 'KeyD') v += this.vMoveX;
      else if (neg === 'KeyS' && pos === 'KeyW') v += this.vMoveY;
    }
    return Math.max(-1, Math.min(1, v));
  }

  /** Camera look from a touch drag (in mouse-pixel units). */
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Virtual mouse buttons for touch controls. */
  setFire(on: boolean) {
    if (on && !this.lmb) this.lmbPressed = true;
    this.lmb = on;
  }
  setAim(on: boolean) {
    this.rmb = on;
  }

  // ------------------------------------------------------------ gamepad
  /** True once a gamepad has been used (hides mouse-lock prompts). */
  gamepadActive = false;
  /** Set by the game each frame: triggers drive the car instead of shooting. */
  vehicleMode = false;
  private padPrev: boolean[] = [];
  private padKeys = new Set<string>();

  /**
   * Standard-mapping gamepad (Xbox / PlayStation layout):
   * L-stick move/steer, R-stick look, RT fire (accelerate in cars), LT aim (brake/reverse in cars),
   * A jump/handbrake, B interact, X reload, Y enter/exit, LB/RB weapons, D-pad up focus / down radio,
   * L3 sprint, R3 camera, View map, Menu pause.
   */
  pollGamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected && p.mapping === 'standard');
    if (!gp) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(gp.axes[0] ?? 0);
    const ly = dz(gp.axes[1] ?? 0);
    const rx = dz(gp.axes[2] ?? 0);
    const ry = dz(gp.axes[3] ?? 0);
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;
    const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0 || gp.buttons.some((b) => b.pressed);
    if (any) this.gamepadActive = true;
    if (!this.gamepadActive) return;
    // sticks
    this.vMoveX = lx;
    this.vMoveY = -ly;
    if (rx || ry) this.addLook(rx * Math.abs(rx) * 14, ry * Math.abs(ry) * 10);
    // triggers
    const rt = val(7);
    const lt = val(6);
    if (this.vehicleMode) {
      this.vMoveY = Math.max(-1, Math.min(1, rt - lt - ly * (rt || lt ? 0 : 1)));
      this.setFire(false);
      this.setAim(false);
    } else {
      this.setFire(rt > 0.4);
      this.setAim(lt > 0.4);
    }
    // buttons -> keys (edge-triggered so pressed/released work)
    const map: [number, string][] = [
      [0, 'Space'],
      [1, 'KeyE'],
      [2, 'KeyR'],
      [3, 'KeyF'],
      [10, 'ShiftLeft'],
      [11, 'KeyV'],
      [8, 'KeyM'],
      [9, 'Escape'],
      [12, 'KeyQ'],
      [13, 'KeyB'],
      [14, 'KeyH'],
    ];
    for (const [i, code] of map) {
      const now = btn(i);
      if (now !== !!this.padPrev[i]) this.debugSet(code, now);
      this.padPrev[i] = now;
    }
    // shoulder buttons cycle weapons
    for (const [i, dir] of [
      [4, -1],
      [5, 1],
    ] as [number, number][]) {
      const now = btn(i);
      if (now && !this.padPrev[i]) this.wheel += dir;
      this.padPrev[i] = now;
    }
    void this.padKeys;
  }

  /** Simulate a key from an on-screen button. */
  setKey(code: string, on: boolean) {
    this.debugSet(code, on);
  }

  /** Call at end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
  }

  private prevent = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
    this.released.add(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    if (e.button === 0) {
      this.lmb = true;
      this.lmbPressed = true;
    }
    if (e.button === 2) this.rmb = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY);
  };
  private onBlur = () => {
    this.down.clear();
    this.lmb = false;
    this.rmb = false;
  };
  private onLock = () => {
    this.locked = document.pointerLockElement === this.el;
    if (!this.locked) {
      this.lmb = false;
      this.rmb = false;
    }
    const self = !this.locked && this.releasing;
    if (!this.locked) this.releasing = false;
    this.onLockChange?.(this.locked, self);
  };

  /** Simulate keys for automated tests. */
  debugSet(code: string, on: boolean) {
    if (on) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints ?? 0) > 1 && !window.matchMedia?.('(pointer: fine)').matches;
}
