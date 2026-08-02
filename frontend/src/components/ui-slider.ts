export class UISlider extends HTMLElement {
  private shadow: ShadowRoot;
  private inputElement: HTMLInputElement | null = null;
  private fillTrack: HTMLDivElement | null = null;
  private customThumb: HTMLDivElement | null = null;
  private isDragging: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['min', 'max', 'step', 'value', 'label', 'unit', 'disabled'];
  }

  attributeChangedCallback(name: string, _oldVal: string, newVal: string) {
    if (this.inputElement !== null && name === 'value') {
      this.inputElement.value = newVal;
      this.updateProgress(false);
    } else {
      this.render();
    }
  }

  get value(): number {
    if (this.inputElement !== null) {
      return parseFloat(this.inputElement.value);
    }
    const valAttr = this.getAttribute('value');
    return parseFloat(valAttr !== null ? valAttr : '0');
  }

  set value(val: number) {
    this.setAttribute('value', val.toString());
    if (this.inputElement !== null) {
      this.inputElement.value = val.toString();
      this.updateProgress(false);
    }
  }

  private updateProgress(isInteractive: boolean = true) {
    if (this.inputElement === null) return;
    const minAttr = this.getAttribute('min');
    const maxAttr = this.getAttribute('max');
    const unitAttr = this.getAttribute('unit');

    const min = minAttr !== null ? parseFloat(minAttr) : 0;
    const max = maxAttr !== null ? parseFloat(maxAttr) : 100;
    const current = parseFloat(this.inputElement.value);
    const percent = Math.max(0, Math.min(100, ((current - min) / (max - min)) * 100));

    if (this.fillTrack !== null && this.customThumb !== null) {
      if (isInteractive && this.isDragging) {
        this.fillTrack.style.transition = 'none';
        this.customThumb.style.transition = 'transform var(--duration-fast) var(--ease-fluent-standard), background-color var(--duration-fast), border-color var(--duration-fast)';
      } else {
        this.fillTrack.style.transition = 'width var(--duration-normal) var(--ease-fluent-standard)';
        this.customThumb.style.transition = 'left var(--duration-normal) var(--ease-fluent-standard), transform var(--duration-fast) var(--ease-fluent-standard), background-color var(--duration-fast), border-color var(--duration-fast)';
      }

      this.fillTrack.style.width = `${percent}%`;
      this.customThumb.style.left = `calc(12px + (100% - 24px) * ${percent / 100})`;
    }

    const valDisplay = this.shadow.querySelector('.val-display');
    if (valDisplay !== null) {
      valDisplay.textContent = unitAttr !== null ? `${current}${unitAttr}` : `${current}`;
    }
  }

  private render() {
    const minAttr = this.getAttribute('min');
    const maxAttr = this.getAttribute('max');
    const stepAttr = this.getAttribute('step');
    const valueAttr = this.getAttribute('value');
    const labelAttr = this.getAttribute('label');
    const unitAttr = this.getAttribute('unit');
    const disabled = this.hasAttribute('disabled');

    const minStr = minAttr !== null ? minAttr : '0';
    const maxStr = maxAttr !== null ? maxAttr : '100';
    const stepStr = stepAttr !== null ? stepAttr : '1';
    const valueStr = valueAttr !== null ? valueAttr : '50';
    const unitStr = unitAttr !== null ? unitAttr : '';

    const minNum = parseFloat(minStr);
    const maxNum = parseFloat(maxStr);
    const valNum = parseFloat(valueStr);
    const initialPercent = Math.max(0, Math.min(100, ((valNum - minNum) / (maxNum - minNum)) * 100));

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }
        .slider-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
        }
        .slider-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          color: var(--color-text-secondary);
        }
        .val-display {
          font-weight: 600;
          color: var(--color-text-primary);
          margin-left: auto;
        }

        .track-container {
          position: relative;
          width: 100%;
          height: 24px;
          display: flex;
          align-items: center;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          box-sizing: border-box;
          padding: 0 12px;
        }

        .track-bg {
          position: absolute;
          left: 12px;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          height: 6px;
          border-radius: 3px;
          background: var(--color-card-border);
          overflow: hidden;
          pointer-events: none;
        }

        .track-fill {
          height: 100%;
          width: ${initialPercent}%;
          background: var(--color-accent-primary);
          border-radius: 3px;
        }

        .custom-thumb-node {
          position: absolute;
          top: 50%;
          left: calc(12px + (100% - 24px) * ${initialPercent / 100});
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--color-accent-primary);
          border: 2px solid var(--color-bg-base);
          box-shadow: var(--shadow-fluent-card);
          pointer-events: none;
          box-sizing: border-box;
          z-index: 3;
          transition: transform var(--duration-fast) var(--ease-fluent-standard),
                      background-color var(--duration-fast) var(--ease-fluent-standard),
                      border-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .custom-thumb-node.hover {
          transform: translate(-50%, -50%) scale(1.15);
          background: var(--color-accent-hover);
          box-shadow: var(--shadow-fluent-modal);
        }

        input[type="range"] {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          opacity: 0;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          z-index: 4;
        }
      </style>
      <div class="slider-wrapper">
        ${labelAttr !== null && labelAttr !== '' ? `
          <div class="slider-header">
            <span>${labelAttr}</span>
            <span class="val-display">${valueStr}${unitStr}</span>
          </div>
        ` : ''}
        <div class="track-container ${disabled ? 'disabled' : ''}">
          <div class="track-bg">
            <div class="track-fill"></div>
          </div>
          <div class="custom-thumb-node"></div>
          <input type="range" min="${minStr}" max="${maxStr}" step="${stepStr}" value="${valueStr}" ${disabled ? 'disabled' : ''} />
        </div>
      </div>
    `;

    this.inputElement = this.shadow.querySelector('input');
    this.fillTrack = this.shadow.querySelector('.track-fill');
    this.customThumb = this.shadow.querySelector('.custom-thumb-node');
    const container = this.shadow.querySelector('.track-container');

    if (this.inputElement !== null && container !== null && this.customThumb !== null) {
      this.inputElement.addEventListener('mousedown', () => {
        this.isDragging = true;
      });
      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.updateProgress(false);
        }
      });

      container.addEventListener('mousemove', (e: Event) => {
        const mouseEvt = e as MouseEvent;
        if (this.customThumb === null) return;
        const thumbRect = this.customThumb.getBoundingClientRect();
        const thumbCenterX = thumbRect.left + thumbRect.width / 2;
        const thumbCenterY = thumbRect.top + thumbRect.height / 2;
        const dist = Math.hypot(mouseEvt.clientX - thumbCenterX, mouseEvt.clientY - thumbCenterY);

        if (dist <= 14 || this.isDragging) {
          this.customThumb.classList.add('hover');
        } else {
          this.customThumb.classList.remove('hover');
        }
      });

      container.addEventListener('mouseleave', () => {
        if (!this.isDragging && this.customThumb !== null) {
          this.customThumb.classList.remove('hover');
        }
      });

      this.inputElement.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        this.setAttribute('value', target.value);
        this.updateProgress(true);
        this.dispatchEvent(new CustomEvent('change', { detail: { value: parseFloat(target.value) } }));
      });
    }
  }
}

if (!customElements.get('ui-slider')) {
  customElements.define('ui-slider', UISlider);
}
