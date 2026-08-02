import { getIconSvg } from '../utils/icons';
import { getPerformanceConfig } from '../utils/performance';

let lastClickPos: { x: number; y: number } = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let modalStackSequence = 0;

window.addEventListener('click', (e: MouseEvent) => {
  lastClickPos = { x: e.clientX, y: e.clientY };
}, true);

export class UIModal extends HTMLElement {
  private shadow: ShadowRoot;
  private isOpen: boolean = false;
  private isClosing: boolean = false;
  private stackBase: number = 2000;
  private sourceAnimationEnabled: boolean = true;
  private lastSourceRect: { left: number; top: number; width: number; height: number } | null = null;
  private lastSourceElement: HTMLElement | null = null;
  private originalSourceStyle: {
    transition: string;
    transform: string;
    transformOrigin: string;
    opacity: string;
    willChange: string;
    zIndex: string;
    position: string;
  } | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['open', 'title', 'width'];
  }

  attributeChangedCallback(name: string) {
    if (name === 'open') {
      const shouldOpen = this.hasAttribute('open');
      if (shouldOpen && !this.isOpen && !this.isClosing) {
        this.open();
      } else if (!shouldOpen && this.isOpen && !this.isClosing) {
        this.close();
      }
    }
  }

  public open(source?: HTMLElement | MouseEvent, options?: { sourceAnimation?: boolean }) {
    if (this.isClosing) return;
    this.isOpen = true;
    this.sourceAnimationEnabled = options?.sourceAnimation !== false;

    if (!this.hasAttribute('open')) {
      this.setAttribute('open', '');
    }

    const overlay = this.shadow.querySelector('.modal-overlay') as HTMLDivElement | null;
    const container = this.shadow.querySelector('.modal-container') as HTMLDivElement | null;
    const panel = this.shadow.querySelector('.modal-panel') as HTMLDivElement | null;

    if (!overlay || !container || !panel) return;

    // 叠层弹窗：每次打开分配递增的 z-index 基线，保证后开的 modal 的
    // backdrop 能压住先开的 modal 面板
    this.stackBase = 2000 + (modalStackSequence++) * 10;
    overlay.style.zIndex = String(this.stackBase);
    container.style.zIndex = String(this.stackBase + 1);

    // 打开时解除穿透拦截，恢复正常的交互与 pointer-events
    overlay.style.pointerEvents = 'auto';
    container.style.pointerEvents = 'auto';
    panel.style.pointerEvents = 'auto';

    overlay.classList.add('visible');
    container.classList.add('visible');
    panel.classList.add('visible');

    if (source instanceof HTMLElement) {
      this.lastSourceElement = source;
      const rect = source.getBoundingClientRect();
      this.lastSourceRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    } else {
      this.lastSourceElement = null;
      if (source instanceof MouseEvent) {
        this.lastSourceRect = { left: source.clientX, top: source.clientY, width: 4, height: 4 };
      } else {
        this.lastSourceRect = { left: lastClickPos.x, top: lastClickPos.y, width: 4, height: 4 };
      }
    }

    const perfConfig = getPerformanceConfig();
    const enableFLIP = perfConfig.enableFlipModal && perfConfig.preset !== 'low';
    const enableFlipSource = enableFLIP && this.sourceAnimationEnabled && perfConfig.enableFlipSourceAnimation && this.lastSourceElement !== null && this.lastSourceElement.isConnected;

    if (enableFLIP && this.lastSourceRect) {
      this.playOpenFLIP(panel, this.lastSourceRect, enableFlipSource);
    } else {
      const durationStr = enableFlipSource ? 'var(--duration-slow)' : 'var(--duration-normal)';
      overlay.style.transition = `opacity ${durationStr} var(--ease-fluent-standard)`;
      overlay.style.opacity = '1';
      container.style.transition = `opacity ${durationStr} var(--ease-fluent-standard)`;
      container.style.opacity = '1';

      panel.style.transition = 'none';
      panel.style.opacity = '0';
      panel.style.transform = 'scale(0.95)';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.transition = `transform ${durationStr} var(--ease-fluent-standard), opacity ${durationStr} var(--ease-fluent-standard)`;
          panel.style.opacity = '1';
          panel.style.transform = 'scale(1)';
        });
      });
    }
  }

  public close() {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;

    const overlay = this.shadow.querySelector('.modal-overlay') as HTMLDivElement | null;
    const container = this.shadow.querySelector('.modal-container') as HTMLDivElement | null;
    const panel = this.shadow.querySelector('.modal-panel') as HTMLDivElement | null;

    if (!overlay || !panel) {
      this.finishClose();
      return;
    }

    // 关键非阻塞 UX 优化：关闭时刻的第 0ms 瞬间，立即允许 pointer-events 穿透！
    // 退场 FLIP 仅作为视觉反馈放映，用户无需等待任何毫秒即可零延迟点击后续元素！
    overlay.style.pointerEvents = 'none';
    if (container) container.style.pointerEvents = 'none';
    panel.style.pointerEvents = 'none';

    const perfConfig = getPerformanceConfig();
    const enableFLIP = perfConfig.enableFlipModal && perfConfig.preset !== 'low';
    const enableFlipSource = enableFLIP && this.sourceAnimationEnabled && perfConfig.enableFlipSourceAnimation && this.lastSourceElement !== null && this.lastSourceElement.isConnected;

    overlay.style.transition = 'opacity var(--duration-slow) var(--ease-fluent-standard)';
    overlay.style.opacity = '0';
    if (container) {
      container.style.transition = 'opacity var(--duration-slow) var(--ease-fluent-standard)';
      container.style.opacity = '0';
    }

    if (enableFLIP && this.lastSourceRect) {
      this.playCloseFLIP(panel, this.lastSourceRect, enableFlipSource, () => {
        this.finishClose();
      });
    } else {
      panel.style.transition = 'transform var(--duration-slow) var(--ease-fluent-standard), opacity var(--duration-slow) var(--ease-fluent-standard)';
      panel.style.opacity = '0';
      panel.style.transform = 'scale(0.95)';
      setTimeout(() => {
        this.finishClose();
      }, 450);
    }
  }

  private finishClose() {
    this.isOpen = false;
    this.isClosing = false;
    this.removeAttribute('open');

    this.restoreSourceOriginalStyle();

    const overlay = this.shadow.querySelector('.modal-overlay') as HTMLDivElement | null;
    const container = this.shadow.querySelector('.modal-container') as HTMLDivElement | null;
    const panel = this.shadow.querySelector('.modal-panel') as HTMLDivElement | null;

    if (overlay) {
      overlay.classList.remove('visible');
      overlay.style.opacity = '';
      overlay.style.transition = '';
      overlay.style.pointerEvents = '';
      overlay.style.zIndex = '';
    }
    if (container) {
      container.classList.remove('visible');
      container.style.opacity = '';
      container.style.transition = '';
      container.style.pointerEvents = '';
      container.style.zIndex = '';
    }
    if (panel) {
      panel.classList.remove('visible');
      panel.style.opacity = '';
      panel.style.transform = '';
      panel.style.transition = '';
      panel.style.pointerEvents = '';
    }
  }

  private restoreSourceOriginalStyle() {
    if (this.lastSourceElement !== null && this.originalSourceStyle !== null) {
      try {
        this.lastSourceElement.style.transition = this.originalSourceStyle.transition;
        this.lastSourceElement.style.transform = this.originalSourceStyle.transform;
        this.lastSourceElement.style.transformOrigin = this.originalSourceStyle.transformOrigin;
        this.lastSourceElement.style.opacity = this.originalSourceStyle.opacity;
        this.lastSourceElement.style.willChange = this.originalSourceStyle.willChange;
        this.lastSourceElement.style.zIndex = this.originalSourceStyle.zIndex;
        this.lastSourceElement.style.position = this.originalSourceStyle.position;
      } catch (err) {
        console.warn('[UIModal] Failed to restore source element style:', err);
      }
    }
    this.originalSourceStyle = null;
    this.lastSourceElement = null;
  }

  private playOpenFLIP(
    panel: HTMLDivElement,
    sourceRect: { left: number; top: number; width: number; height: number },
    enableFlipSource: boolean
  ) {
    const durationStr = enableFlipSource ? 'var(--duration-slow)' : 'var(--duration-normal)';
    const transitionCSS = `transform ${durationStr} var(--ease-fluent-standard), opacity ${durationStr} var(--ease-fluent-standard)`;

    const overlay = this.shadow.querySelector('.modal-overlay') as HTMLDivElement | null;
    const container = this.shadow.querySelector('.modal-container') as HTMLDivElement | null;
    if (overlay !== null) {
      overlay.style.transition = `opacity ${durationStr} var(--ease-fluent-standard)`;
      overlay.style.opacity = '1';
    }
    if (container !== null) {
      container.style.transition = `opacity ${durationStr} var(--ease-fluent-standard)`;
      container.style.opacity = '1';
    }

    panel.style.transition = 'none';
    panel.style.transform = 'none';
    const targetRect = panel.getBoundingClientRect();

    const scaleX = Math.max(0.08, sourceRect.width / targetRect.width);
    const scaleY = Math.max(0.08, sourceRect.height / targetRect.height);

    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    const translateX = sourceCenterX - targetCenterX;
    const translateY = sourceCenterY - targetCenterY;

    panel.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
    panel.style.opacity = enableFlipSource ? '0' : '0.5';

    if (enableFlipSource && this.lastSourceElement !== null && this.lastSourceElement.isConnected) {
      const sourceEl = this.lastSourceElement;
      if (this.originalSourceStyle === null) {
        this.originalSourceStyle = {
          transition: sourceEl.style.transition,
          transform: sourceEl.style.transform,
          transformOrigin: sourceEl.style.transformOrigin,
          opacity: sourceEl.style.opacity,
          willChange: sourceEl.style.willChange,
          zIndex: sourceEl.style.zIndex,
          position: sourceEl.style.position,
        };
      }

      const computedPos = window.getComputedStyle(sourceEl).position;
      if (computedPos === 'static') {
        sourceEl.style.position = 'relative';
      }
      sourceEl.style.zIndex = String(this.stackBase);

      const scaleXSource = sourceRect.width !== 0 ? targetRect.width / sourceRect.width : 1;
      const scaleYSource = sourceRect.height !== 0 ? targetRect.height / sourceRect.height : 1;
      const translateXSource = targetCenterX - sourceCenterX;
      const translateYSource = targetCenterY - sourceCenterY;

      sourceEl.style.transition = 'none';
      sourceEl.style.transformOrigin = 'center center';
      sourceEl.style.willChange = 'transform, opacity';
      sourceEl.style.transform = 'translate(0px, 0px) scale(1, 1)';
      sourceEl.style.opacity = '1';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.transition = transitionCSS;
          panel.style.transform = 'translate(0, 0) scale(1, 1)';
          panel.style.opacity = '1';

          sourceEl.style.transition = `transform ${durationStr} var(--ease-fluent-standard), opacity ${durationStr} ease-in`;
          sourceEl.style.transform = `translate(${translateXSource}px, ${translateYSource}px) scale(${scaleXSource}, ${scaleYSource})`;
          sourceEl.style.opacity = '0';
        });
      });
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.transition = transitionCSS;
          panel.style.transform = 'translate(0, 0) scale(1, 1)';
          panel.style.opacity = '1';
        });
      });
    }
  }

  private playCloseFLIP(
    panel: HTMLDivElement,
    sourceRect: { left: number; top: number; width: number; height: number },
    enableFlipSource: boolean,
    onComplete: () => void
  ) {
    const targetRect = panel.getBoundingClientRect();

    const scaleX = Math.max(0.08, sourceRect.width / targetRect.width);
    const scaleY = Math.max(0.08, sourceRect.height / targetRect.height);

    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    const translateX = sourceCenterX - targetCenterX;
    const translateY = sourceCenterY - targetCenterY;

    const transitionCSS = 'transform var(--duration-slow) var(--ease-fluent-standard), opacity var(--duration-slow) var(--ease-fluent-standard)';

    panel.style.transition = transitionCSS;
    panel.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
    panel.style.opacity = '0';

    if (enableFlipSource && this.lastSourceElement !== null && this.lastSourceElement.isConnected && this.originalSourceStyle !== null) {
      const sourceEl = this.lastSourceElement;
      const targetOpacity = this.originalSourceStyle.opacity;

      const scaleXSource = sourceRect.width !== 0 ? targetRect.width / sourceRect.width : 1;
      const scaleYSource = sourceRect.height !== 0 ? targetRect.height / sourceRect.height : 1;
      const translateXSource = targetCenterX - sourceCenterX;
      const translateYSource = targetCenterY - sourceCenterY;

      const computedPos = window.getComputedStyle(sourceEl).position;
      if (computedPos === 'static') {
        sourceEl.style.position = 'relative';
      }
      sourceEl.style.zIndex = String(this.stackBase);

      sourceEl.style.transition = 'none';
      sourceEl.style.transformOrigin = 'center center';
      sourceEl.style.willChange = 'transform, opacity';
      sourceEl.style.transform = `translate(${translateXSource}px, ${translateYSource}px) scale(${scaleXSource}, ${scaleYSource})`;
      sourceEl.style.opacity = '0';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sourceEl.style.transition = 'transform var(--duration-slow) var(--ease-fluent-standard), opacity var(--duration-fast) ease-out';
          sourceEl.style.transform = 'translate(0px, 0px) scale(1, 1)';
          sourceEl.style.opacity = targetOpacity;
        });
      });
    }

    setTimeout(() => {
      onComplete();
    }, 450);
  }

  private render() {
    const title = this.getAttribute('title') || '提示';
    // 读取后立即移除 title 属性，否则浏览器会把宿主的 title 当作原生 tooltip，
    // 鼠标悬停在弹窗任意位置都会弹出提示
    if (this.hasAttribute('title')) this.removeAttribute('title');
    const requestedWidth = this.getAttribute('width') || '520px';
    const width = requestedWidth.length <= 64
      && !/[;{}]/.test(requestedWidth)
      && CSS.supports('width', requestedWidth)
      ? requestedWidth
      : '520px';

    this.shadow.innerHTML = `
      <style>
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: var(--color-overlay-bg);
          -webkit-backdrop-filter: blur(var(--blur-overlay));
          backdrop-filter: blur(var(--blur-overlay));
          z-index: 2000;
          opacity: 0;
          pointer-events: none;
          display: none;
          transition: opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        .modal-overlay.visible {
          opacity: 1;
          pointer-events: auto;
          display: block;
        }

        .modal-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          z-index: 2001;
          display: none;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        .modal-container.visible {
          opacity: 1;
          pointer-events: auto;
          display: flex;
        }

        .modal-panel {
          position: relative;
          width: ${width};
          max-width: 92vw;
          max-height: 88vh;
          box-sizing: border-box;
          border-radius: var(--radius-lg);
          background: var(--color-surface-acrylic);
          -webkit-backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          border: 1px solid var(--color-card-border);
          box-shadow: var(--shadow-fluent-modal);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          opacity: 0;
          transform: scale(0.96);
          pointer-events: none;
        }

        .modal-panel.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .modal-header {
          padding: 18px 24px;
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

        .modal-body {
          flex: 1;
          padding: 20px 24px 8px 24px;
          overflow-y: auto;
          font-size: 14px;
          line-height: 1.6;
          color: var(--color-text-primary);
        }

        .modal-footer {
          padding: 16px 24px 20px 24px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
        }

        ::slotted([slot="footer"]) {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          width: 100%;
        }
      </style>

      <div class="modal-overlay ${this.isOpen ? 'visible' : ''}"></div>
      <div class="modal-container ${this.isOpen ? 'visible' : ''}">
        <div class="modal-panel ${this.isOpen ? 'visible' : ''}">
          <div class="modal-header">
            <span class="modal-title"></span>
            <button class="close-btn" aria-label="Close">${getIconSvg('x')}</button>
          </div>
          <div class="modal-body">
            <slot></slot>
          </div>
          <div class="modal-footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    `;

    const overlay = this.shadow.querySelector('.modal-overlay');
    const container = this.shadow.querySelector('.modal-container');
    const closeBtn = this.shadow.querySelector('.close-btn');
    const titleElement = this.shadow.querySelector('.modal-title');
    if (titleElement !== null) titleElement.textContent = title;

    const footer = this.shadow.querySelector('.modal-footer') as HTMLDivElement | null;
    if (footer !== null && this.querySelector('[slot="footer"]') === null) {
        const body = this.shadow.querySelector('.modal-body') as HTMLDivElement;
        footer.style.display = 'none';
        body.style.paddingBottom = "20px";
    }

    let isBackdropMouseDown = false;
    const handleMouseDown = (e: Event) => {
      isBackdropMouseDown = (e.target === container || e.target === overlay);
    };
    const handleClick = (e: Event) => {
      if ((e.target === container || e.target === overlay) && isBackdropMouseDown) this.close();
      isBackdropMouseDown = false;
    };

    if (container) {
      container.addEventListener('mousedown', handleMouseDown);
      container.addEventListener('click', handleClick);
    }
    if (overlay) {
      overlay.addEventListener('mousedown', handleMouseDown);
      overlay.addEventListener('click', handleClick);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
  }
}

if (!customElements.get('ui-modal')) {
  customElements.define('ui-modal', UIModal);
}
