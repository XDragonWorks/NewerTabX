export class UIRadioGroup extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    const slot = this.shadow.querySelector('slot');
    if (slot !== null) {
      slot.addEventListener('slotchange', () => {
        this.syncGroupState();
      });
    }
    requestAnimationFrame(() => {
      this.syncGroupState();
    });
  }

  static get observedAttributes() {
    return ['value'];
  }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    if (name === 'value' && oldVal !== newVal) {
      this.syncGroupState();
    }
  }

  get value(): string {
    return this.getAttribute('value') || '';
  }

  set value(val: string) {
    this.setAttribute('value', val);
    this.syncGroupState();
  }

  private getRadios(): UIRadio[] {
    return Array.from(this.querySelectorAll('ui-radio')) as UIRadio[];
  }

  private syncGroupState() {
    let currentValue = this.value;
    const radios = this.getRadios();
    
    if (!currentValue && radios.length > 0) {
      currentValue = radios[0].value;
      this.setAttribute('value', currentValue);
    }

    for (const radio of radios) {
      if (radio.value === currentValue) {
        radio.setAttribute('checked', '');
      } else {
        radio.removeAttribute('checked');
      }
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          gap: 16px;
          flex-wrap: wrap;
        }
      </style>
      <slot></slot>
    `;

    this.addEventListener('radio-click', (e: Event) => {
      const customEvt = e as CustomEvent<{ value: string; node: UIRadio }>;
      if (customEvt.detail && customEvt.detail.value) {
        const selectedVal = customEvt.detail.value;
        this.value = selectedVal;
        this.dispatchEvent(new CustomEvent('change', { detail: { value: selectedVal }, bubbles: true }));
      }
    });
  }
}

export class UIRadio extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.addEventListener('click', (e: MouseEvent) => {
      if (this.hasAttribute('disabled')) return;
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent('radio-click', {
        detail: { value: this.value, node: this },
        bubbles: true,
        composed: true
      }));
    });
  }

  static get observedAttributes() {
    return ['value', 'label', 'disabled'];
  }

  attributeChangedCallback() {
    this.render();
  }

  get checked(): boolean {
    return this.hasAttribute('checked');
  }

  set checked(val: boolean) {
    if (val) {
      this.setAttribute('checked', '');
    } else {
      this.removeAttribute('checked');
    }
  }

  get value(): string {
    return this.getAttribute('value') || '';
  }

  private render() {
    const label = this.getAttribute('label') || '';
    const disabled = this.hasAttribute('disabled');

    // 移除 box-shadow 微光，并统一步调引用全局动画变量 (var(--ease-fluent-spring) 与 var(--duration-fast))
    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
        }
        .radio-container {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          user-select: none;
          opacity: ${disabled ? '0.5' : '1'};
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .radio-box {
          width: 18px;
          height: 18px;
          box-sizing: border-box;
          border-radius: 50%;
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: border-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .radio-container:hover:not(.disabled) .radio-box {
          border-color: var(--color-accent-primary);
        }

        :host([checked]) .radio-box {
          border-color: var(--color-accent-primary) !important;
        }

        .radio-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--color-accent-primary);
          opacity: 0;
          transform: scale(0);
          transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-spring);
        }

        :host([checked]) .radio-dot {
          opacity: 1 !important;
          transform: scale(1) !important;
        }
      </style>

      <label class="radio-container ${disabled ? 'disabled' : ''}">
        <div class="radio-box">
          <div class="radio-dot"></div>
        </div>
        ${label ? '<span class="radio-label"></span>' : ''}
        <slot></slot>
      </label>
    `;
    const labelElement = this.shadow.querySelector('.radio-label');
    if (labelElement !== null) labelElement.textContent = label;
  }
}

if (!customElements.get('ui-radio-group')) {
  customElements.define('ui-radio-group', UIRadioGroup);
}
if (!customElements.get('ui-radio')) {
  customElements.define('ui-radio', UIRadio);
}
