export class UIToggle extends HTMLElement {
  private shadow: ShadowRoot;
  private isChecked: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.isChecked = this.hasAttribute('checked');
    this.render();
  }

  static get observedAttributes() {
    return ['checked', 'label', 'disabled'];
  }

  attributeChangedCallback(name: string) {
    if (name === 'checked') {
      this.isChecked = this.hasAttribute('checked');
      this.updateState();
    } else {
      this.render();
    }
  }

  get checked(): boolean {
    return this.isChecked;
  }

  set checked(val: boolean) {
    if (val) {
      this.setAttribute('checked', '');
    } else {
      this.removeAttribute('checked');
    }
    this.isChecked = val;
    this.updateState();
  }

  private updateState() {
    const track = this.shadow.querySelector('.toggle-track');
    const thumb = this.shadow.querySelector('.toggle-thumb');
    if (track && thumb) {
      if (this.isChecked) {
        track.classList.add('checked');
        thumb.classList.add('checked');
      } else {
        track.classList.remove('checked');
        thumb.classList.remove('checked');
      }
    }
  }

  private render() {
    const label = this.getAttribute('label') || '';
    const disabled = this.hasAttribute('disabled');

    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
        }
        .toggle-container {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          user-select: none;
          opacity: ${disabled ? '0.5' : '1'};
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .toggle-track {
          position: relative;
          width: 44px;
          height: 22px;
          box-sizing: border-box;
          border-radius: 11px;
          border: 1px solid var(--color-card-border);
          background: rgba(0, 0, 0, 0.14);
          transition: background-color var(--duration-normal) var(--ease-fluent-standard),
                      border-color var(--duration-normal) var(--ease-fluent-standard);
        }

        :host-context([data-theme="dark"]) .toggle-track {
          background: rgba(255, 255, 255, 0.18);
          border-color: rgba(255, 255, 255, 0.3);
        }

        .toggle-track.checked {
          background: var(--color-accent-primary) !important;
          border-color: var(--color-accent-primary) !important;
        }

        /* 纯粹使用 left 控制圆球位移，绝不使用 transform: translateX 产生与 hover 覆盖冲突！ */
        .toggle-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
          transition: left var(--duration-normal) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-standard),
                      background-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .toggle-thumb.checked {
          left: 24px;
        }

        .toggle-container:hover:not(.disabled) .toggle-thumb {
          transform: scale(1.1);
        }
      </style>
      <label class="toggle-container ${disabled ? 'disabled' : ''}">
        <div class="toggle-track ${this.isChecked ? 'checked' : ''}">
          <div class="toggle-thumb ${this.isChecked ? 'checked' : ''}"></div>
        </div>
        ${label ? '<span class="toggle-label"></span>' : ''}
        <slot></slot>
      </label>
    `;

    const labelElement = this.shadow.querySelector('.toggle-label');
    if (labelElement !== null) labelElement.textContent = label;

    const container = this.shadow.querySelector('.toggle-container');
    if (container && !disabled) {
      container.addEventListener('click', () => {
        this.checked = !this.checked;
        this.dispatchEvent(new CustomEvent('change', { detail: { checked: this.checked } }));
      });
    }
  }
}

if (!customElements.get('ui-toggle')) {
  customElements.define('ui-toggle', UIToggle);
}
