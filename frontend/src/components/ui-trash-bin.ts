import { getIconSvg } from '../utils/icons';

export class UITrashBin extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['visible'];
  }

  attributeChangedCallback() {
    this.render();
  }

  public show() {
    this.setAttribute('visible', 'true');
  }

  public hide() {
    this.removeAttribute('visible');
  }

  private render() {
    const isVisible = this.hasAttribute('visible');

    // 彻底摒弃容器剪裁与圆弧轮廓！采用纯自然径向渐变，边缘 100% 衰减至 rgba(..., 0) 零透明度
    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 0;
          left: 0;
          width: 120px;
          height: 120px;
          z-index: 9999;
          pointer-events: ${isVisible ? 'auto' : 'none'};
          opacity: ${isVisible ? '1' : '0'};
          transition: opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        .trash-zone {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: radial-gradient(circle at 0% 0%,
            rgba(232, 17, 35, 0.55) 0%,
            rgba(232, 17, 35, 0.22) 35%,
            rgba(232, 17, 35, 0.05) 65%,
            rgba(232, 17, 35, 0) 100%);
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          padding: 24px 0 0 24px;
          box-sizing: border-box;
          opacity: 0.85;
          transform-origin: 0px 0px;
          transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-standard);
        }

        .trash-zone.drag-over {
          opacity: 1;
          transform: scale(1.3);
        }

        .trash-icon {
          width: 28px;
          height: 28px;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 2px 10px rgba(0, 0, 0, 0.4));
          transition: transform var(--duration-fast) var(--ease-fluent-spring);
        }

        .trash-icon svg {
          width: 100%;
          height: 100%;
          stroke: currentColor;
          stroke-width: 2.2;
        }
      </style>

      <div class="trash-zone" id="trash-target">
        <span class="trash-icon">${getIconSvg('trash')}</span>
      </div>
    `;

    const trashTarget = this.shadow.querySelector('#trash-target');
    if (trashTarget) {
      trashTarget.addEventListener('dragover', (e: Event) => {
        e.preventDefault();
        trashTarget.classList.add('drag-over');
      });

      trashTarget.addEventListener('dragleave', () => {
        trashTarget.classList.remove('drag-over');
      });

      trashTarget.addEventListener('drop', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        trashTarget.classList.remove('drag-over');

        const dragEvt = e as DragEvent;
        let cardId: string | undefined = undefined;

        if (dragEvt.dataTransfer) {
          cardId = dragEvt.dataTransfer.getData('application/x-card-id');
          if (!cardId) cardId = dragEvt.dataTransfer.getData('text/plain');
        }

        if (cardId) {
          this.dispatchEvent(new CustomEvent('card-delete-drop', {
            detail: { cardId },
            bubbles: true,
            composed: true,
          }));
        }
        this.hide();
      });
    }
  }
}

if (!customElements.get('ui-trash-bin')) {
  customElements.define('ui-trash-bin', UITrashBin);
}
