import { getIconSvg } from '../utils/icons';

export class UICheckbox extends HTMLElement {
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
    return ['checked', 'disabled', 'label'];
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
    const box = this.shadow.querySelector('.checkbox-box');
    if (box) {
      if (this.isChecked) {
        box.classList.add('checked');
      } else {
        box.classList.remove('checked');
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
        .checkbox-container {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          user-select: none;
          opacity: ${disabled ? '0.5' : '1'};
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .checkbox-box {
          width: 18px;
          height: 18px;
          box-sizing: border-box;
          border-radius: 4px;
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          flex-shrink: 0;
          transition: background-color var(--duration-normal) var(--ease-fluent-standard),
                      border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard);
        }

        .checkbox-container:hover:not(.disabled) .checkbox-box {
          border-color: var(--color-accent-primary);
        }

        .checkbox-box.checked {
          background: var(--color-accent-primary);
          border-color: var(--color-accent-primary);
        }

        /* 修复 Icon 绝对正中心居中，无任何偏下偏移 */
        .icon {
          width: 12px;
          height: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: scale(0.5);
          transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-standard);
        }

        .checkbox-box.checked .icon {
          opacity: 1;
          transform: scale(1);
        }

        .icon svg {
          width: 100%;
          height: 100%;
          stroke: currentColor;
          stroke-width: 3.5;
        }
      </style>
      <label class="checkbox-container ${disabled ? 'disabled' : ''}">
        <div class="checkbox-box ${this.isChecked ? 'checked' : ''}">
          <span class="icon">${getIconSvg('check')}</span>
        </div>
        ${label ? '<span class="checkbox-label"></span>' : ''}
        <slot></slot>
      </label>
    `;

    const labelElement = this.shadow.querySelector('.checkbox-label');
    if (labelElement !== null) labelElement.textContent = label;

    const container = this.shadow.querySelector('.checkbox-container');
    if (container && !disabled) {
      container.addEventListener('click', () => {
        this.checked = !this.checked;
        this.dispatchEvent(new CustomEvent('change', { detail: { checked: this.checked } }));
      });
    }
  }
}

if (!customElements.get('ui-checkbox')) {
  customElements.define('ui-checkbox', UICheckbox);
}
