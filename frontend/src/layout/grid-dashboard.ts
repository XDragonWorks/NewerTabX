import { packGrid, CardLayoutItem } from './grid-packer';
import { areFlipAnimationsEnabled, refreshAllMicaElements } from '../utils/performance';
import type { UICardHost } from '../components/card-host';
import { escapeHtmlAttribute } from '../utils/html';

export class UIGridDashboard extends HTMLElement {
  private shadow: ShadowRoot;
  private cardsData: CardLayoutItem[] = [];
  private currentCols: number = 4;
  private resizeObserver: ResizeObserver | null = null;
  private draggedCardId: string | null = null;

  private isResizing: boolean = false;
  private resizeStartW: number = 1;
  private resizeStartH: number = 1;
  private resizeStartX: number = 0;
  private resizeStartY: number = 0;
  private resizeUnitWidth: number = 280;
  private resizeUnitHeight: number = 260;
  // Tracks the cell currently being resized so mouseup can clean up fixed styles
  private activeResizeCell: HTMLElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.initResizeObserver();
    this.render();
  }

  disconnectedCallback() {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
    }
  }

  static get observedAttributes() {
    return ['edit-mode'];
  }

  attributeChangedCallback() {
    this.render();
  }

  public setCards(cards: CardLayoutItem[]) {
    this.cardsData = cards.map(card => ({ ...card }));
    const createdHosts = this.syncCardHosts();
    this.render();
    createdHosts.forEach(({ item, host }) => this.dispatchCardAdded(item, host));
  }

  public getCards(): CardLayoutItem[] {
    return this.cardsData.map(card => ({ ...card }));
  }

  public addCard(item: CardLayoutItem): UICardHost {
    if (this.cardsData.some(card => card.id === item.id)) {
      throw new Error(`Card instance "${item.id}" already exists.`);
    }
    const normalizedItem = {
      ...item,
      order: typeof item.order === 'number' ? item.order : this.cardsData.length + 1,
    };
    this.cardsData.push(normalizedItem);
    const createdHosts = this.syncCardHosts();
    this.render();
    const created = createdHosts.find(entry => entry.item.id === normalizedItem.id);
    if (created === undefined) {
      throw new Error(`Card host for "${normalizedItem.id}" could not be created.`);
    }
    this.dispatchLayoutChange();
    this.dispatchCardAdded(normalizedItem, created.host);
    return created.host;
  }

  public removeCard(cardId: string) {
    this.cardsData = this.cardsData.filter(c => c.id !== cardId);
    Array.from(this.children).forEach(child => {
      if (child.getAttribute('data-card-id') === cardId) child.remove();
    });
    this.render();
    this.dispatchLayoutChange();
  }

  private syncCardHosts(): Array<{ item: CardLayoutItem; host: UICardHost }> {
    const desiredIds = new Set(this.cardsData.map(card => card.id));
    Array.from(this.children).forEach(child => {
      const childCardId = child.getAttribute('data-card-id');
      if (childCardId !== null && !desiredIds.has(childCardId)) child.remove();
    });

    const created: Array<{ item: CardLayoutItem; host: UICardHost }> = [];
    this.cardsData.forEach(item => {
      let host = Array.from(this.children).find(child => child.getAttribute('data-card-id') === item.id) as UICardHost | undefined;
      if (host === undefined) {
        host = document.createElement('ui-card-host') as UICardHost;
        host.setAttribute('card-id', item.id);
        host.setAttribute('data-card-id', item.id);
        host.setAttribute('card-type', typeof item.type === 'string' ? item.type : '');
        host.setAttribute('data-card-type', typeof item.type === 'string' ? item.type : '');
        host.setAttribute('slot', item.id);
        this.appendChild(host);
        created.push({ item, host });
      } else {
        host.setAttribute('card-id', item.id);
        host.setAttribute('data-card-type', typeof item.type === 'string' ? item.type : '');
        host.setAttribute('slot', item.id);
      }
    });
    return created;
  }

  private dispatchCardAdded(item: CardLayoutItem, host: UICardHost): void {
    this.dispatchEvent(new CustomEvent('card-instance-added', {
      detail: { item, host },
      bubbles: true,
      composed: true,
    }));
  }

  private initResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const rootStyle = getComputedStyle(document.documentElement);
        const minColWidth = Number.parseFloat(rootStyle.getPropertyValue('--card-min-width')) || 280;
        const gap = Number.parseFloat(rootStyle.getPropertyValue('--card-gap')) || 24;
        const computedCols = Math.max(1, Math.floor((width + gap) / (minColWidth + gap)));

        if (computedCols !== this.currentCols) {
          this.currentCols = computedCols;
          this.render();
        }
      }
    });
    this.resizeObserver.observe(this);
  }

  private lastDragOverTime: number = 0;

  private reorderWithFLIP(targetCardId: string) {
    if (!this.draggedCardId || this.draggedCardId === targetCardId) return;

    const now = Date.now();
    if (now - this.lastDragOverTime < 100) return;
    this.lastDragOverTime = now;

    const srcIndex = this.cardsData.findIndex(c => c.id === this.draggedCardId);
    const targetIndex = this.cardsData.findIndex(c => c.id === targetCardId);

    if (srcIndex === -1 || targetIndex === -1 || srcIndex === targetIndex) return;

    const animate = areFlipAnimationsEnabled();
    const firstRects = new Map<string, DOMRect>();
    if (animate) {
      this.shadow.querySelectorAll('.grid-cell').forEach(cell => {
        const id = cell.getAttribute('data-card-id');
        if (id) firstRects.set(id, cell.getBoundingClientRect());
      });
    }

    const [moved] = this.cardsData.splice(srcIndex, 1);
    this.cardsData.splice(targetIndex, 0, moved);
    this.cardsData.forEach((c, idx) => c.order = idx + 1);

    const placedCards = packGrid(this.cardsData, this.currentCols);
    const isSingleCol = this.currentCols === 1;

    placedCards.forEach(card => {
      const cell = this.findCell(card.id);
      if (cell) {
        cell.style.gridColumn = isSingleCol ? '1' : `${card.colStart} / span ${card.colSpan}`;
        cell.style.gridRow = `${card.rowStart} / span ${card.rowSpan}`;
      }
    });

    if (animate) placedCards.forEach(card => {
      if (card.id !== this.draggedCardId && firstRects.has(card.id)) {
        const cell = this.findCell(card.id);
        if (cell) {
          const first = firstRects.get(card.id)!;
          const last = cell.getBoundingClientRect();

          const deltaX = first.left - last.left;
          const deltaY = first.top - last.top;

          if (deltaX !== 0 || deltaY !== 0) {
            cell.style.transition = 'none';
            cell.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                cell.style.transition = 'transform var(--duration-normal) var(--ease-fluent-standard)';
                cell.style.transform = 'translate(0, 0)';
              });
            });
          }
        }
      }
    });

    this.dispatchLayoutChange();
  }

  public animateNewCardFromSource(cardId: string, sourceRect: { left: number; top: number; width: number; height: number }): void {
    if (!areFlipAnimationsEnabled()) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cell = this.findCell(cardId);
        if (cell === null) return;
        const targetRect = cell.getBoundingClientRect();
        if (targetRect.width === 0 || targetRect.height === 0) return;

        const scaleX = Math.max(0.08, sourceRect.width / targetRect.width);
        const scaleY = Math.max(0.08, sourceRect.height / targetRect.height);

        const sourceCenterX = sourceRect.left + sourceRect.width / 2;
        const sourceCenterY = sourceRect.top + sourceRect.height / 2;
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;

        const translateX = sourceCenterX - targetCenterX;
        const translateY = sourceCenterY - targetCenterY;

        cell.style.transition = 'none';
        cell.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        cell.style.opacity = '0.2';
        cell.style.zIndex = '100';

        void cell.offsetWidth;

        cell.style.transition = 'transform var(--duration-normal) var(--ease-fluent-standard), opacity var(--duration-normal) var(--ease-fluent-standard)';
        cell.style.transform = 'translate(0, 0) scale(1, 1)';
        cell.style.opacity = '1';

        setTimeout(() => {
          cell.style.transition = '';
          cell.style.transform = '';
          cell.style.opacity = '';
          cell.style.zIndex = '';
        }, 360);
      });
    });
  }

  private findCell(cardId: string): HTMLElement | null {
    return this.shadow.querySelector(`.grid-cell[data-card-id="${CSS.escape(cardId)}"]`) as HTMLElement | null;
  }

  // 派发布局更新事件，但绝对不强行保存！
  private dispatchLayoutChange() {
    this.dispatchEvent(new CustomEvent('cards-reorder', {
      detail: { cards: this.cardsData },
      bubbles: true,
      composed: true,
    }));
  }

  private render() {
    const isEditMode = this.getAttribute('edit-mode') === 'true';

    if (this.cardsData.length === 0) {
      this.shadow.innerHTML = `
        <style>
          :host { display: block; width: 100%; }
          .empty-tip {
            padding: 120px; text-align: center; color: var(--color-text-secondary);
          }
        </style>
        <div class="empty-tip">无卡片</div>
      `;
      return;
    }

    const placedCards = packGrid(this.cardsData, this.currentCols);
    const isSingleCol = this.currentCols === 1;

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(${this.currentCols}, minmax(0, 1fr));
          grid-auto-rows: var(--card-row-height);
          gap: var(--card-gap);
          width: 100%;
          box-sizing: border-box;
          justify-items: ${isSingleCol ? 'center' : 'stretch'};
          transition: grid-template-columns var(--duration-normal) var(--ease-fluent-standard);
        }

        .grid-cell {
          position: relative;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          ${isSingleCol ? 'max-width: 540px; margin: 0 auto;' : ''}
          background: transparent;
          border-radius: var(--radius-md);
          transition: transform var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard),
                      opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        ${isEditMode ? `
          .grid-cell {
            box-shadow: 0 0 0 1.5px var(--color-accent-primary), 0 8px 24px rgba(0, 120, 212, 0.15);
            cursor: grab;
          }
          .grid-cell:active {
            cursor: grabbing;
          }
        ` : ''}

        .grid-cell.dragging {
          opacity: 0.15;
          transform: scale(0.95);
        }

        /* 拖拽落点半透明预览框架 (FLIP Placeholder) */
        .grid-cell.drop-target-hover {
          outline: 2px dashed var(--color-accent-primary);
          outline-offset: -2px;
          background: rgba(0, 120, 212, 0.08);
          transform: scale(1.02);
        }

        /* 100% 透明无感物理 Response Edge */
        .invisible-edge-right {
          position: absolute;
          top: 8px; right: -6px; bottom: 8px; width: 12px;
          cursor: ew-resize; z-index: 30;
          display: ${isEditMode ? 'block' : 'none'};
        }

        .invisible-edge-bottom {
          position: absolute;
          left: 8px; bottom: -6px; right: 8px; height: 12px;
          cursor: ns-resize; z-index: 30;
          display: ${isEditMode ? 'block' : 'none'};
        }

        .invisible-corner-se {
          position: absolute;
          right: -8px; bottom: -8px; width: 16px; height: 16px;
          cursor: nwse-resize; z-index: 31;
          display: ${isEditMode ? 'block' : 'none'};
        }

        ::slotted(*) {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          pointer-events: ${isEditMode ? 'none' : 'auto'};
        }
      </style>

      <div class="dashboard-grid">
        ${placedCards.map(card => `
          <div class="grid-cell" 
               ${isEditMode ? 'draggable="true"' : ''} 
               data-card-id="${escapeHtmlAttribute(card.id)}"
               style="grid-column: ${isSingleCol ? '1' : `${card.colStart} / span ${card.colSpan}`}; grid-row: ${card.rowStart} / span ${card.rowSpan};">
            
            <slot name="${escapeHtmlAttribute(card.id)}"></slot>

            ${isEditMode ? `
              <div class="invisible-edge-right" data-handle="right" data-id="${escapeHtmlAttribute(card.id)}"></div>
              <div class="invisible-edge-bottom" data-handle="bottom" data-id="${escapeHtmlAttribute(card.id)}"></div>
              <div class="invisible-corner-se" data-handle="corner" data-id="${escapeHtmlAttribute(card.id)}"></div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;

    if (isEditMode) {
      this.bindCellDragAndResize();
    }
    requestAnimationFrame(() => refreshAllMicaElements());
  }

  private resizeCardWithFLIP(card: CardLayoutItem, newW: number, newH: number) {
    const animate = areFlipAnimationsEnabled();
    // --- Snapshot other cells BEFORE any DOM change ---
    const firstRects = new Map<string, DOMRect>();
    if (animate) {
      this.shadow.querySelectorAll('.grid-cell').forEach(cell => {
        const id = cell.getAttribute('data-card-id');
        if (id && id !== card.id) firstRects.set(id, cell.getBoundingClientRect());
      });
    }

    const resizedCell = this.findCell(card.id);

    // Commit the current in-flight visual size so the next animation starts from there.
    // This prevents stale transitionend listeners from clearing styles mid-flight.
    let fromWidth: number | null = null;
    let fromHeight: number | null = null;
    if (resizedCell && animate) {
      // getBoundingClientRect reflects the ACTUAL rendered size even during a transition
      const currentRect = resizedCell.getBoundingClientRect();
      fromWidth = currentRect.width;
      fromHeight = currentRect.height;
      // Cancel any ongoing transition so the browser snaps to the committed size
      resizedCell.style.transition = 'none';
      resizedCell.style.width = `${fromWidth}px`;
      resizedCell.style.height = `${fromHeight}px`;
      // Clear fixed size so the grid can compute the new natural dimensions
      resizedCell.style.width = '';
      resizedCell.style.height = '';
    }

    // --- UPDATE card dimensions ---
    card.w = newW;
    card.h = newH;

    // Re-pack and apply new grid positions (no full render)
    const placedCards = packGrid(this.cardsData, this.currentCols);
    const isSingleCol = this.currentCols === 1;

    placedCards.forEach(c => {
      const cell = this.findCell(c.id);
      if (cell) {
        cell.style.gridColumn = isSingleCol ? '1' : `${c.colStart} / span ${c.colSpan}`;
        cell.style.gridRow = `${c.rowStart} / span ${c.rowSpan}`;
      }
    });

    // --- Animate the resized card: true width/height transition so content reflows ---
    if (animate && resizedCell && fromWidth !== null && fromHeight !== null) {
      // Force reflow so browser computes the new natural size
      void resizedCell.offsetHeight;
      const toRect = resizedCell.getBoundingClientRect();
      const toWidth = toRect.width;
      const toHeight = toRect.height;

      if (Math.abs(fromWidth - toWidth) > 0.5 || Math.abs(fromHeight - toHeight) > 0.5) {
        // Pin to the committed "from" size
        resizedCell.style.transition = 'none';
        resizedCell.style.width = `${fromWidth}px`;
        resizedCell.style.height = `${fromHeight}px`;
        void resizedCell.offsetHeight;
        // Animate to the new natural target
        resizedCell.style.transition =
          'width var(--duration-normal) var(--ease-fluent-standard),' +
          'height var(--duration-normal) var(--ease-fluent-standard)';
        resizedCell.style.width = `${toWidth}px`;
        resizedCell.style.height = `${toHeight}px`;
        this.activeResizeCell = resizedCell;
      }
    }

    // --- FLIP: translate-only animation for displaced neighbours ---
    if (!animate) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        placedCards.forEach(c => {
          if (c.id === card.id) return;
          const cell = this.findCell(c.id);
          if (!cell || !firstRects.has(c.id)) return;

          const first = firstRects.get(c.id)!;
          const last = cell.getBoundingClientRect();
          const dx = first.left - last.left;
          const dy = first.top - last.top;
          if (dx === 0 && dy === 0) return;

          cell.style.transition = 'none';
          cell.style.transform = `translate(${dx}px, ${dy}px)`;
          void cell.offsetHeight;
          cell.style.transition = 'transform var(--duration-normal) var(--ease-fluent-standard)';
          cell.style.transform = '';
        });
      });
    });
  }

  private bindCellDragAndResize() {
    const cells = this.shadow.querySelectorAll('.grid-cell');

    cells.forEach(cell => {
      const cardId = cell.getAttribute('data-card-id');
      if (!cardId) return;

      cell.addEventListener('dragstart', (e: Event) => {
        if (this.isResizing) {
          e.preventDefault();
          return;
        }
        const dragEvt = e as DragEvent;
        this.draggedCardId = cardId;
        cell.classList.add('dragging');
        
        if (dragEvt.dataTransfer) {
          dragEvt.dataTransfer.effectAllowed = 'move';
          // 使用自定义 MIME 类型，拦截浏览器拖拽搜索文本的破坏动作
          dragEvt.dataTransfer.setData('application/x-card-id', cardId);
          dragEvt.dataTransfer.setData('text/plain', cardId);
        }

        this.dispatchEvent(new CustomEvent('card-drag-start', {
          detail: { cardId },
          bubbles: true,
          composed: true,
        }));
      });

      cell.addEventListener('dragend', () => {
        cell.classList.remove('dragging');
        cells.forEach(c => c.classList.remove('drop-target-hover'));
        this.draggedCardId = null;

        this.dispatchEvent(new CustomEvent('card-drag-end', {
          bubbles: true,
          composed: true,
        }));
      });

      cell.addEventListener('dragover', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.draggedCardId && this.draggedCardId !== cardId) {
          cell.classList.add('drop-target-hover');
          this.reorderWithFLIP(cardId);
        }
      });

      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drop-target-hover');
      });

      cell.addEventListener('drop', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        cell.classList.remove('drop-target-hover');
        this.dispatchLayoutChange();
      });
    });

    const handles = this.shadow.querySelectorAll('[data-handle]');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        
        const mouseEvt = e as MouseEvent;
        const id = handle.getAttribute('data-id');
        const handleType = handle.getAttribute('data-handle');
        const card = this.cardsData.find(c => c.id === id);

        if (!card) return;
        const resizeCell = this.findCell(card.id);
        if (resizeCell === null) return;

        this.isResizing = true;
        this.resizeStartW = card.w;
        this.resizeStartH = card.h;
        this.resizeStartX = mouseEvt.clientX;
        this.resizeStartY = mouseEvt.clientY;
        const cellRect = resizeCell.getBoundingClientRect();
        const rootStyle = getComputedStyle(document.documentElement);
        const gap = Number.parseFloat(rootStyle.getPropertyValue('--card-gap')) || 24;
        const rowHeight = Number.parseFloat(rootStyle.getPropertyValue('--card-row-height')) || 260;
        this.resizeUnitWidth = Math.max(1, (cellRect.width - gap * (card.w - 1)) / card.w + gap);
        this.resizeUnitHeight = rowHeight + gap;

        const onMouseMove = (moveEvt: MouseEvent) => {
          if (!this.isResizing || !card) return;

          const deltaX = moveEvt.clientX - this.resizeStartX;
          const deltaY = moveEvt.clientY - this.resizeStartY;

          const deltaWUnits = Math.round(deltaX / this.resizeUnitWidth);
          const deltaHUnits = Math.round(deltaY / this.resizeUnitHeight);

          let newW = card.w;
          let newH = card.h;

          if (handleType === 'right' || handleType === 'corner') {
            newW = Math.min(this.currentCols, Math.max(1, this.resizeStartW + deltaWUnits));
          }
          if (handleType === 'bottom' || handleType === 'corner') {
            newH = Math.max(1, this.resizeStartH + deltaHUnits);
          }

          if (card.w !== newW || card.h !== newH) {
            this.resizeCardWithFLIP(card, newW, newH);
          }
        };

        const onMouseUp = () => {
          if (this.isResizing) {
            this.isResizing = false;
            // Release the fixed width/height so the grid reclaims control
            if (this.activeResizeCell) {
              const cell = this.activeResizeCell;
              this.activeResizeCell = null;
              // Animate to natural (grid-controlled) size, then clear inline styles
              cell.style.transition =
                'width var(--duration-normal) var(--ease-fluent-standard),' +
                'height var(--duration-normal) var(--ease-fluent-standard)';
              cell.style.width = '';
              cell.style.height = '';
              // After settling, wipe the transition override too
              cell.addEventListener('transitionend', () => {
                cell.style.transition = '';
              }, { once: true });
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            this.dispatchLayoutChange();
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    });
  }
}

if (!customElements.get('ui-grid-dashboard')) {
  customElements.define('ui-grid-dashboard', UIGridDashboard);
}
