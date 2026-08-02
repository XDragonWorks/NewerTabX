import { getIconSvg, IconName } from '../utils/icons';

export class UIButton extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['variant', 'icon', 'disabled', 'icon-only'];
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    const variant = this.getAttribute('variant') || 'standard';
    const icon = this.getAttribute('icon');
    const disabled = this.hasAttribute('disabled');
    const hasTextSlot = Array.from(this.childNodes).some(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').trim() !== '';
      }
      return node.nodeType === Node.ELEMENT_NODE;
    });
    const isIconOnly = this.hasAttribute('icon-only') || (Boolean(icon) && !hasTextSlot);

    const iconSvg = icon ? `<span class="icon-wrapper">${getIconSvg(icon as IconName)}</span>` : '';

    this.shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          vertical-align: middle;
        }
        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          height: 100%;
          min-height: 38px;
          box-sizing: border-box;
          margin: 0;
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-family: inherit;
          font-weight: 500;
          cursor: pointer;
          outline: none;
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          color: var(--color-text-primary);
          backdrop-filter: blur(var(--blur-card));
          transition: background-color var(--duration-normal) var(--ease-fluent-standard),
                      border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-standard);
        }

        button.icon-only {
          padding: 0;
          width: 38px;
          height: 38px;
          min-width: 38px;
          aspect-ratio: 1 / 1;
        }

        /* Hover 规则：仅高光与描边/阴影变化，取消任何 transform: scale */
        button:hover:not(:disabled) {
          background: var(--color-surface-acrylic);
          border-color: var(--color-card-border-hover);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        button:active:not(:disabled) {
          transform: scale(0.97);
        }

        button.primary {
          background: var(--color-accent-primary);
          color: #ffffff;
          border-color: transparent;
        }

        button.primary:hover:not(:disabled) {
          background: var(--color-accent-hover);
          box-shadow: 0 0 14px var(--color-accent-glow);
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .icon-wrapper {
          display: inline-flex;
          width: 16px;
          height: 16px;
        }
        .icon-wrapper svg {
          width: 100%;
          height: 100%;
          stroke: currentColor;
        }
      </style>
      <button class="${variant} ${isIconOnly ? 'icon-only' : ''}" ${disabled ? 'disabled' : ''}>
        ${iconSvg}
        <slot></slot>
      </button>
    `;
  }
}

if (!customElements.get('ui-button')) {
  customElements.define('ui-button', UIButton);
}
