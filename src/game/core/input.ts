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
  onLockChange?: (locked: boolean) => void;

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
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string) {
    return this.enabled && this.pressed.has(code);
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
    this.onLockChange?.(this.locked);
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
