export class UIInput extends HTMLElement {
  private shadow: ShadowRoot;
  private inputElement: HTMLInputElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['placeholder', 'type', 'value', 'disabled'];
  }

  attributeChangedCallback(name: string, _oldVal: string, newVal: string) {
    if (this.inputElement !== null) {
      if (name === 'value') {
        this.inputElement.value = newVal;
      } else if (name === 'placeholder') {
        this.inputElement.placeholder = newVal;
      } else if (name === 'type') {
        this.inputElement.type = this.normalizeType(newVal);
      } else if (name === 'disabled') {
        this.inputElement.disabled = this.hasAttribute('disabled');
      }
    } else {
      this.render();
    }
  }

  get value(): string {
    if (this.inputElement !== null) {
      return this.inputElement.value;
    }
    return this.getAttribute('value') || '';
  }

  set value(val: string) {
    this.setAttribute('value', val);
    if (this.inputElement !== null) {
      this.inputElement.value = val;
    }
  }

  private normalizeType(type: string | null): string {
    const supported = new Set([
      'text',
      'password',
      'url',
      'search',
      'email',
      'number',
      'color',
      'date',
      'time',
      'datetime-local',
    ]);
    return type !== null && supported.has(type) ? type : 'text';
  }

  private render() {
    const placeholder = this.getAttribute('placeholder') || '';
    const type = this.normalizeType(this.getAttribute('type'));
    const value = this.getAttribute('value') || '';
    const disabled = this.hasAttribute('disabled');

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        input {
          width: 100%;
          height: 38px;
          padding: 8px 12px;
          box-sizing: border-box;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-family: inherit;
          outline: none;
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          color: var(--color-text-primary);
          color-scheme: inherit;
          backdrop-filter: blur(var(--blur-card));
          transition: border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard);
        }

        input::-ms-reveal {
          cursor: pointer;
        }

        :host-context([data-theme="dark"]) input::-ms-reveal {
          filter: invert(1) brightness(1.4);
        }

        input:hover:not(:disabled) {
          border-color: var(--color-card-border-hover);
        }

        input:focus {
          border-color: var(--color-accent-primary);
          box-shadow: 0 0 0 2px var(--color-accent-glow);
        }

        input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      </style>
      <input />
    `;

    this.inputElement = this.shadow.querySelector('input');
    if (this.inputElement !== null) {
      this.inputElement.type = type;
      this.inputElement.placeholder = placeholder;
      this.inputElement.value = value;
      this.inputElement.disabled = disabled;
      this.inputElement.addEventListener('input', (e) => {
        e.stopPropagation();
        const target = e.target as HTMLInputElement;
        this.dispatchEvent(new CustomEvent('input', { detail: { value: target.value }, bubbles: true, composed: true }));
        this.dispatchEvent(new CustomEvent('change', { detail: { value: target.value }, bubbles: true, composed: true }));
      });
    }
  }
}

if (!customElements.get('ui-input')) {
  customElements.define('ui-input', UIInput);
}
