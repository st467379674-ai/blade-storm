export class Input {
  constructor() {
    this.enabled = false;
    this.keys = new Set();
    this.dashQueued = false;
    this.joystick = { active: false, pointerId: null, x: 0, z: 0 };
    this.touchActive = false;
    this.joystickEl = document.getElementById('joystick');
    this.knobEl = document.getElementById('joystick-knob');
    this.dashBtn = document.getElementById('dash-btn');
    this.touchControls = document.getElementById('touch-controls');
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (event) => {
      const code = event.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code) && this.enabled) {
        event.preventDefault();
      }
      if (!this.enabled) return;
      if (code === 'Space') {
        if (!event.repeat) this.dashQueued = true;
        return;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        this.keys.add(code);
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.resetJoystick();
    });

    if (!this.joystickEl || !this.knobEl) return;
    const onDown = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.joystick.active = true;
      this.joystick.pointerId = event.pointerId;
      this.joystickEl.setPointerCapture?.(event.pointerId);
      this.updateJoystick(event);
    };
    const onMove = (event) => {
      if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) return;
      event.preventDefault();
      this.updateJoystick(event);
    };
    const onUp = (event) => {
      if (event.pointerId !== this.joystick.pointerId) return;
      this.resetJoystick();
    };
    this.joystickEl.addEventListener('pointerdown', onDown);
    this.joystickEl.addEventListener('pointermove', onMove);
    this.joystickEl.addEventListener('pointerup', onUp);
    this.joystickEl.addEventListener('pointercancel', onUp);
    this.joystickEl.addEventListener('lostpointercapture', onUp);

    this.dashBtn?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.enabled) return;
      this.dashQueued = true;
      this.dashBtn.classList.add('pressed');
      setTimeout(() => this.dashBtn?.classList.remove('pressed'), 110);
    });
  }

  updateJoystick(event) {
    const rect = this.joystickEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const max = rect.width * 0.33;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.joystick.x = dx / max;
    this.joystick.z = dy / max;
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  resetJoystick() {
    this.joystick.active = false;
    this.joystick.pointerId = null;
    this.joystick.x = 0;
    this.joystick.z = 0;
    if (this.knobEl) this.knobEl.style.transform = 'translate(0px, 0px)';
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.resetJoystick();
    }
  }

  setTouchActive(active) {
    this.touchActive = active && this.coarse;
    this.touchControls?.classList.toggle('active', this.touchActive);
    this.touchControls?.setAttribute('aria-hidden', String(!this.touchActive));
  }

  getAxes() {
    if (!this.enabled) return { x: 0, z: 0 };
    if (this.coarse && this.joystick.active) {
      const len = Math.hypot(this.joystick.x, this.joystick.z);
      if (len < 0.12) return { x: 0, z: 0 };
      return { x: this.joystick.x, z: this.joystick.z };
    }
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  consumeDash() {
    if (!this.dashQueued) return false;
    this.dashQueued = false;
    return true;
  }
}
