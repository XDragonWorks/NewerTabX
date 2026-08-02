import { getIconSvg } from '../utils/icons';

export class UIDrawer extends HTMLElement {
  private shadow: ShadowRoot;
  private isOpen: boolean = false;
  private titleText: string = '设置';

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.captureTitleAttribute();
    this.render();
  }

  static get observedAttributes() {
    return ['open', 'title', 'width', 'placement'];
  }

  attributeChangedCallback(name: string, _oldVal: string, _newVal: string) {
    if (name === 'open') {
      this.isOpen = this.hasAttribute('open');
      this.updateOpenState();
    } else if (name === 'title') {
      this.captureTitleAttribute();
    } else {
      this.render();
    }
  }

  // title 属性会触发浏览器原生 tooltip 遮挡内容,读取后立即从 DOM 移除
  private captureTitleAttribute() {
    const title = this.getAttribute('title');
    if (title !== null) {
      this.titleText = title;
      this.removeAttribute('title');
    } else {
      this.render();
    }
  }

  public open() {
    this.setAttribute('open', '');
  }

  public close() {
    this.removeAttribute('open');
  }

  private updateOpenState() {
    const overlay = this.shadow.querySelector('.drawer-overlay') as HTMLElement | null;
    const panel = this.shadow.querySelector('.drawer-panel') as HTMLElement | null;
    if (overlay === null || panel === null) return;

    if (this.isOpen) {
      // 先移除所有状态
      overlay.classList.remove('visible');
      panel.classList.remove('visible');

      // 强制 reflow 清除旧 transition
      void overlay.offsetWidth;
      void panel.offsetWidth;

      // 再添加 visible 类
      overlay.classList.add('visible');
      panel.classList.add('visible');

      // 强制 reflow 触发 transition
      void overlay.offsetWidth;
      void panel.offsetWidth;
    } else {
      overlay.classList.remove('visible');
      panel.classList.remove('visible');
    }
  }

  private render() {
    const title = this.titleText;
    const requestedWidth = this.getAttribute('width') || '420px';
    const width = requestedWidth.length <= 64
      && !/[;{}]/.test(requestedWidth)
      && CSS.supports('width', requestedWidth)
      ? requestedWidth
      : '420px';
    const placement = (this.getAttribute('placement') || 'right').toLowerCase();
    const isLeft = placement === 'left';

    this.shadow.innerHTML = `
      <style>
        .drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: var(--color-overlay-bg);
          -webkit-backdrop-filter: blur(var(--blur-overlay));
          backdrop-filter: blur(var(--blur-overlay));
          z-index: 1000;
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        .drawer-overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .drawer-panel {
          position: fixed;
          top: 0;
          ${isLeft ? 'left: 0; right: auto;' : 'right: 0; left: auto;'}
          width: ${width};
          max-width: 90vw;
          height: 100vh;
          box-sizing: border-box;
          background: var(--color-surface-acrylic);
          -webkit-backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          ${isLeft 
            ? 'border-right: 1px solid var(--color-card-border);' 
            : 'border-left: 1px solid var(--color-card-border);'}
          box-shadow: var(--shadow-fluent-modal);
          z-index: 1001;
          display: flex;
          flex-direction: column;

          /* 靠外边的两个角圆角，贴着屏幕边缘的内侧为直角 */
          ${isLeft 
            ? 'border-top-right-radius: var(--radius-lg); border-bottom-right-radius: var(--radius-lg); border-top-left-radius: 0; border-bottom-left-radius: 0;'
            : 'border-top-left-radius: var(--radius-lg); border-bottom-left-radius: var(--radius-lg); border-top-right-radius: 0; border-bottom-right-radius: 0;'
          }

          transform: ${isLeft ? 'translateX(-100%)' : 'translateX(100%)'};
          transition: transform var(--duration-slow) var(--ease-fluent-standard);
        }

        .drawer-panel.visible {
          transform: translateX(0);
        }

        .drawer-header {
          padding: 18px 22px;
          padding-bottom: 0px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          /* border-bottom: 1px solid var(--color-card-border); */
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .close-btn {
          cursor: pointer;
          border: none;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm);
          color: var(--color-text-secondary);
          transition: background-color var(--duration-fast) var(--ease-fluent-standard),
                      color var(--duration-fast) var(--ease-fluent-standard);
        }

        .close-btn:hover {
          background: rgba(0, 0, 0, 0.08);
          color: var(--color-text-primary);
        }

        .close-btn svg {
          width: 18px;
          height: 18px;
          stroke: currentColor;
        }

        .drawer-body {
          flex: 1;
          padding: 22px;
          overflow-y: auto;
        }
      </style>

      <div class="drawer-overlay ${this.isOpen ? 'visible' : ''}"></div>
      <div class="drawer-panel ${this.isOpen ? 'visible' : ''}">
        <div class="drawer-header">
          <span class="drawer-title"></span>
          <button class="close-btn" aria-label="Close">${getIconSvg('x')}</button>
        </div>
        <div class="drawer-body">
          <slot></slot>
        </div>
      </div>
    `;

    const overlay = this.shadow.querySelector('.drawer-overlay');
    const closeBtn = this.shadow.querySelector('.close-btn');
    const titleElement = this.shadow.querySelector('.drawer-title');
    if (titleElement !== null) titleElement.textContent = title;

    const handleCloseClick = () => {
      const cancelEvt = new CustomEvent('attempt-close', { cancelable: true, bubbles: true, composed: true });
      const notPrevented = this.dispatchEvent(cancelEvt);
      if (notPrevented) {
        this.close();
      }
    };

    let isOverlayMouseDown = false;
    if (overlay) {
      overlay.addEventListener('mousedown', (e) => {
        isOverlayMouseDown = (e.target === overlay);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && isOverlayMouseDown) {
          handleCloseClick();
        }
        isOverlayMouseDown = false;
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', handleCloseClick);
    }
  }
}

if (!customElements.get('ui-drawer')) {
  customElements.define('ui-drawer', UIDrawer);
}
