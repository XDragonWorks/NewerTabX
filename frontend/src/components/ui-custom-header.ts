import { getIconSvg } from '../utils/icons';
import { escapeHtml } from '../utils/html';
import {
  DEFAULT_HEADER_CONFIG,
  DEFAULT_HEADER_SCRIPT,
  HeaderConfig,
  buildApiUrl,
  getApiHeaders,
  getBootstrapConfig,
} from '../services/config-service';
import { createCardSDK } from '../sdk/card-sdk';

const SEARCH_ENGINE_URLS: Record<string, string> = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

const SUGGEST_ENGINE_URLS: Record<string, string> = {
  bing: 'https://api.bing.com/osjson.aspx?query=',
  google: 'https://suggestqueries.google.com/complete/search?client=chrome&q=',
  baidu: 'https://suggestion.baidu.com/su?action=opensearch&wd=',
  duckduckgo: 'https://duckduckgo.com/ac/?type=list&q=',
};

const SEARCH_ENGINE_NAMES: Record<string, string> = {
  bing: 'Bing',
  google: 'Google',
  baidu: '百度',
  duckduckgo: 'DuckDuckGo',
};

function highlightMatch(text: string, query: string): string {
  const trimmed = query.trim();
  if (trimmed === '') {
    return escapeHtml(text);
  }
  const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);
  return parts
    .map(part => {
      if (part.toLowerCase() === trimmed.toLowerCase()) {
        return `<strong style="font-weight: 700; color: var(--color-accent-primary);">${escapeHtml(part)}</strong>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

export class UICustomHeader extends HTMLElement {
  private shadow: ShadowRoot;
  private timer: number | null = null;
  private headerConfig: HeaderConfig = { ...DEFAULT_HEADER_CONFIG };
  private scriptCleanup: (() => void) | null = null;

  private activeDropdownPanel: HTMLDivElement | null = null;
  private onEngineOutsideClick: ((event: MouseEvent) => void) | null = null;
  private activeSuggestPanel: HTMLDivElement | null = null;
  private selectedSuggestIndex = -1;
  private suggestItems: string[] = [];
  private suggestDebounceTimer: number | null = null;
  private onSuggestOutsideClick: ((event: MouseEvent) => void) | null = null;
  private suggestCache = new Map<string, string[]>();
  private isSelectingSuggest = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes(): string[] {
    return ['edit-mode'];
  }

  connectedCallback(): void {
    this.render();
  }

  disconnectedCallback(): void {
    this.cleanupCurrentHeaderScript();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  public setHeaderConfig(config: HeaderConfig): void {
    this.headerConfig = { ...config };
    this.render();
  }

  private cleanupDropdownMenu(immediate = false): void {
    if (this.onEngineOutsideClick !== null) {
      document.removeEventListener('click', this.onEngineOutsideClick);
      this.onEngineOutsideClick = null;
    }
    const trigger = this.shadow.querySelector('#header-engine-trigger');
    if (trigger !== null) {
      trigger.classList.remove('active');
    }

    const panelToClose = this.activeDropdownPanel;
    this.activeDropdownPanel = null;

    if (panelToClose !== null && panelToClose.parentNode !== null) {
      if (immediate) {
        panelToClose.parentNode.removeChild(panelToClose);
      } else {
        panelToClose.style.opacity = '0';
        panelToClose.style.transform = 'translateY(-6px) scale(0.98)';
        panelToClose.style.pointerEvents = 'none';
        setTimeout(() => {
          if (panelToClose.parentNode !== null) {
            panelToClose.parentNode.removeChild(panelToClose);
          }
        }, 150);
      }
    }
  }

  private cleanupSuggestMenu(immediate = false): void {
    if (this.suggestDebounceTimer !== null) {
      window.clearTimeout(this.suggestDebounceTimer);
      this.suggestDebounceTimer = null;
    }
    if (this.onSuggestOutsideClick !== null) {
      document.removeEventListener('click', this.onSuggestOutsideClick);
      this.onSuggestOutsideClick = null;
    }

    const panelToClose = this.activeSuggestPanel;
    this.activeSuggestPanel = null;
    this.selectedSuggestIndex = -1;
    this.suggestItems = [];

    if (panelToClose !== null && panelToClose.parentNode !== null) {
      if (immediate) {
        panelToClose.parentNode.removeChild(panelToClose);
      } else {
        panelToClose.style.opacity = '0';
        panelToClose.style.transform = 'translateY(-6px) scale(0.98)';
        panelToClose.style.pointerEvents = 'none';
        setTimeout(() => {
          if (panelToClose.parentNode !== null) {
            panelToClose.parentNode.removeChild(panelToClose);
          }
        }, 150);
      }
    }
  }

  private cleanupCurrentHeaderScript(): void {
    this.cleanupDropdownMenu(true);
    this.cleanupSuggestMenu(true);

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.scriptCleanup !== null) {
      const cleanup = this.scriptCleanup;
      this.scriptCleanup = null;
      try {
        cleanup();
      } catch (error) {
        console.warn('[UICustomHeader] Error in script cleanup function:', error);
      }
    }
  }

  private startClock(): void {
    const timeElem = this.shadow.querySelector('#clock-time');
    const dateElem = this.shadow.querySelector('#clock-date');
    const greetingElem = this.shadow.querySelector('#clock-greeting');

    const updateTime = () => {
      if (timeElem && dateElem && greetingElem) {
        const now = new Date();
        timeElem.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });

        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateElem.textContent = now.toLocaleDateString('zh-CN', options);

        const hour = now.getHours();
        let greeting = '你好，准备好开启新的一天了吗';
        if (hour >= 5 && hour < 12) greeting = '早上好，愿你拥有高效充实的一天';
        else if (hour >= 12 && hour < 18) greeting = '下午好，保持专注与优雅';
        else if (hour >= 18 && hour < 23) greeting = '晚上好，享受宁静的时光';
        else greeting = '夜深了，注意休息';

        greetingElem.textContent = greeting;
      }
    };

    updateTime();
    this.timer = window.setInterval(updateTime, 1000);
  }

  private bindSearchEvents(): void {
    const input = this.shadow.querySelector('#header-search-input') as HTMLInputElement | null;
    const btn = this.shadow.querySelector('#header-search-btn');
    const trigger = this.shadow.querySelector('#header-engine-trigger') as HTMLElement | null;
    const nameElem = this.shadow.querySelector('#engine-current-name') as HTMLElement | null;

    let currentEngine = (this.headerConfig.searchEngine && SEARCH_ENGINE_URLS[this.headerConfig.searchEngine] !== undefined)
      ? this.headerConfig.searchEngine
      : 'bing';

    if (nameElem !== null) {
      nameElem.textContent = SEARCH_ENGINE_NAMES[currentEngine] || 'Bing';
    }

    if (trigger !== null) {
      trigger.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (this.activeDropdownPanel !== null) {
          this.cleanupDropdownMenu();
          return;
        }

        this.cleanupSuggestMenu();
        trigger.classList.add('active');
        const rect = trigger.getBoundingClientRect();

        const panel = document.createElement('div');
        panel.className = 'header-engine-teleport-menu';
        panel.style.cssText = `
          position: fixed;
          top: ${rect.bottom + 16}px;
          left: ${rect.left - 16}px;
          min-width: 120px;
          background: var(--color-surface-acrylic);
          backdrop-filter: blur(var(--blur-acrylic));
          -webkit-backdrop-filter: blur(var(--blur-acrylic));
          border: 1px solid var(--color-card-border);
          border-radius: var(--radius-sm);
          box-shadow: var(--shadow-fluent-modal);
          z-index: 99999;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          opacity: 0;
          transform: translateY(-6px) scale(0.98);
          transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                      transform var(--duration-fast) var(--ease-fluent-standard);
        `;

        Object.entries(SEARCH_ENGINE_NAMES).forEach(([key, name]) => {
          const item = document.createElement('div');
          const isSelected = key === currentEngine;
          item.style.cssText = `
            padding: 7px 12px;
            font-size: 13.5px;
            font-weight: ${isSelected ? '600' : '400'};
            color: ${isSelected ? 'var(--color-accent-primary)' : 'var(--color-text-primary)'};
            background: ${isSelected ? 'color-mix(in srgb, var(--color-accent-primary) 12%, transparent)' : 'transparent'};
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background-color var(--duration-fast) var(--ease-fluent-standard);
          `;
          item.textContent = name;

          item.addEventListener('mouseenter', () => {
            if (key !== currentEngine) {
              item.style.background = 'color-mix(in srgb, var(--color-accent-primary) 8%, transparent)';
            }
          });
          item.addEventListener('mouseleave', () => {
            if (key !== currentEngine) {
              item.style.background = 'transparent';
            }
          });

          item.addEventListener('click', (ev: MouseEvent) => {
            ev.stopPropagation();
            const targetEngine = key as 'bing' | 'google' | 'baidu' | 'duckduckgo';
            currentEngine = targetEngine;
            this.headerConfig.searchEngine = targetEngine;
            if (nameElem !== null) {
              nameElem.textContent = name;
            }
            this.cleanupDropdownMenu();
          });

          panel.appendChild(item);
        });

        document.body.appendChild(panel);
        this.activeDropdownPanel = panel;

        requestAnimationFrame(() => {
          if (this.activeDropdownPanel !== null) {
            this.activeDropdownPanel.style.opacity = '1';
            this.activeDropdownPanel.style.transform = 'translateY(0) scale(1)';
          }
        });

        this.onEngineOutsideClick = (event: MouseEvent) => {
          if (
            this.activeDropdownPanel !== null &&
            !this.activeDropdownPanel.contains(event.target as Node) &&
            !trigger.contains(event.target as Node)
          ) {
            this.cleanupDropdownMenu();
          }
        };
        setTimeout(() => {
          if (this.onEngineOutsideClick !== null) {
            document.addEventListener('click', this.onEngineOutsideClick);
          }
        }, 0);
      });
    }

    const performSearch = () => {
      if (input === null) return;
      const query = input.value.trim();
      if (query === '') return;

      const baseUrl = SEARCH_ENGINE_URLS[currentEngine] || SEARCH_ENGINE_URLS['bing'];
      const targetUrl = `${baseUrl}${encodeURIComponent(query)}`;

      const openTarget = this.headerConfig.openTarget || '_blank';
      const sdk = window.cardSDK || createCardSDK('header-search');
      sdk.navigate(targetUrl, openTarget);
    };

    const searchBar = this.shadow.querySelector('.header-search-bar') as HTMLElement | null;

    const handleSelectSuggest = (itemText: string) => {
      if (input === null) return;
      this.isSelectingSuggest = true;
      input.value = itemText;
      this.cleanupSuggestMenu();
      const action = this.headerConfig.suggestAction;
      if (action === 'fill') {
        input.focus();
      } else {
        performSearch();
      }
      setTimeout(() => {
        this.isSelectingSuggest = false;
      }, 150);
    };

    if (input !== null && searchBar !== null) {
      const currentInput = input;
      const currentBar = searchBar;

      const triggerSuggestFetch = (delay = 250) => {
        if (this.isSelectingSuggest || this.headerConfig.enableSuggest === false) {
          this.cleanupSuggestMenu();
          return;
        }

        if (this.suggestDebounceTimer !== null) {
          window.clearTimeout(this.suggestDebounceTimer);
        }

        const query = currentInput.value.trim();
        if (query === '') {
          this.cleanupSuggestMenu();
          return;
        }

        this.suggestDebounceTimer = window.setTimeout(() => {
          if (this.isSelectingSuggest) return;
          void this.fetchSearchSuggestions(currentEngine, query).then(suggestions => {
            if (!this.isSelectingSuggest && currentInput.value.trim() === query && query !== '') {
              this.renderSuggestMenu(suggestions, query, currentBar, handleSelectSuggest);
            }
          });
        }, delay);
      };

      currentInput.addEventListener('input', () => {
        this.cleanupDropdownMenu();
        if (!this.isSelectingSuggest) {
          triggerSuggestFetch(250);
        }
      });
      currentInput.addEventListener('focus', () => {
        this.cleanupDropdownMenu();
        if (!this.isSelectingSuggest && this.activeSuggestPanel === null) {
          triggerSuggestFetch(0);
        }
      });
      currentInput.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.cleanupDropdownMenu();
        if (!this.isSelectingSuggest && this.activeSuggestPanel === null) {
          triggerSuggestFetch(0);
        }
      });

      input.addEventListener('keydown', (event: KeyboardEvent) => {
        this.cleanupDropdownMenu();
        if (this.activeSuggestPanel !== null && this.suggestItems.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            const nextIndex = (this.selectedSuggestIndex + 1) % this.suggestItems.length;
            this.updateSuggestHighlight(this.activeSuggestPanel, nextIndex);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            const prevIndex = this.selectedSuggestIndex <= 0
              ? this.suggestItems.length - 1
              : this.selectedSuggestIndex - 1;
            this.updateSuggestHighlight(this.activeSuggestPanel, prevIndex);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            this.cleanupSuggestMenu();
            return;
          }
          if (event.key === 'Enter') {
            if (this.selectedSuggestIndex >= 0 && this.selectedSuggestIndex < this.suggestItems.length) {
              event.preventDefault();
              handleSelectSuggest(this.suggestItems[this.selectedSuggestIndex]);
              return;
            }
          }
        }

        if (event.key === 'Enter') {
          this.cleanupSuggestMenu();
          performSearch();
        }
      });
    }

    if (btn !== null) {
      btn.addEventListener('click', () => {
        this.cleanupSuggestMenu();
        performSearch();
      });
    }
  }

  private fetchJsonp(url: string, callbackParam = 'cb'): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callbackName = `__jsonp_cb_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const delimiter = url.includes('?') ? '&' : '?';
      script.src = `${url}${delimiter}${callbackParam}=${callbackName}`;

      const cleanup = () => {
        if (script.parentNode !== null) {
          script.parentNode.removeChild(script);
        }
        delete window[callbackName];
      };

      window[callbackName] = (data: unknown) => {
        cleanup();
        resolve(data);
      };

      script.onerror = (err) => {
        cleanup();
        reject(err);
      };

      document.body.appendChild(script);
    });
  }

  private async fetchSearchSuggestions(engine: string, query: string): Promise<string[]> {
    const trimmed = query.trim();
    if (trimmed === '') return [];

    const cacheKey = `${engine}:${trimmed}`;
    const cachedResult = this.suggestCache.get(cacheKey);
    if (cachedResult !== undefined) {
      return cachedResult;
    }

    const suggestBaseUrl = SUGGEST_ENGINE_URLS[engine] || SUGGEST_ENGINE_URLS['bing'];
    const targetUrl = `${suggestBaseUrl}${encodeURIComponent(trimmed)}`;

    let items: string[] = [];

    try {
      const bootstrap = getBootstrapConfig();
      const proxyUrl = buildApiUrl('proxy', bootstrap);
      const headers = getApiHeaders({ 'Content-Type': 'application/json' }, bootstrap);

      let data: unknown;
      try {
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: targetUrl, method: 'GET' }),
        });
        if (response.ok) {
          data = await response.json();
        } else {
          console.warn(`[UICustomHeader] Suggest proxy returned HTTP ${response.status}`);
        }
      } catch (proxyErr) {
        console.warn('[UICustomHeader] Suggest proxy fetch failed, attempting direct fetch or JSONP:', proxyErr);
      }

      if (data === undefined) {
        try {
          const directResponse = await fetch(targetUrl);
          if (directResponse.ok) {
            data = await directResponse.json();
          }
        } catch (directErr) {
          console.warn('[UICustomHeader] Direct suggest fetch failed (CORS), trying JSONP fallback:', directErr);
          if (engine === 'baidu') {
            const jsonpUrl = `https://suggestion.baidu.com/su?wd=${encodeURIComponent(trimmed)}`;
            const rawData = await this.fetchJsonp(jsonpUrl, 'cb') as { s?: string[] };
            if (rawData && Array.isArray(rawData.s)) {
              items = rawData.s;
            }
          } else if (engine === 'google') {
            const jsonpUrl = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(trimmed)}`;
            data = await this.fetchJsonp(jsonpUrl, 'jsonp');
          } else if (engine === 'bing') {
            const jsonpUrl = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(trimmed)}`;
            data = await this.fetchJsonp(jsonpUrl, 'cb');
          }
        }
      }

      if (items.length === 0 && Array.isArray(data) && Array.isArray(data[1])) {
        const rawItems = data[1] as unknown[];
        items = rawItems.filter((item): item is string => typeof item === 'string');
      }

      if (items.length > 0) {
        this.suggestCache.set(cacheKey, items);
        if (this.suggestCache.size > 100) {
          const firstKey = this.suggestCache.keys().next().value;
          if (typeof firstKey === 'string') {
            this.suggestCache.delete(firstKey);
          }
        }
      }

      return items;
    } catch (error) {
      console.warn('[UICustomHeader] Failed to fetch search suggestions:', error);
      return [];
    }
  }

  private updateSuggestHighlight(panel: HTMLDivElement, newIndex: number): void {
    this.selectedSuggestIndex = newIndex;
    const rows = panel.querySelectorAll<HTMLDivElement>('.suggest-item-row');
    rows.forEach((row, idx) => {
      if (idx === newIndex) {
        row.style.background = 'color-mix(in srgb, var(--color-accent-primary) 12%, transparent)';
        row.style.color = 'var(--color-accent-primary)';
        row.scrollIntoView({ block: 'nearest' });
      } else {
        row.style.background = 'transparent';
        row.style.color = 'var(--color-text-primary)';
      }
    });
  }

  private renderSuggestMenu(
    items: string[],
    query: string,
    searchBar: HTMLElement,
    onSelect: (item: string) => void,
  ): void {
    this.cleanupSuggestMenu();
    if (items.length === 0) return;

    this.suggestItems = items;
    this.selectedSuggestIndex = -1;

    const barRect = searchBar.getBoundingClientRect();
    const panel = document.createElement('div');
    panel.className = 'header-suggest-teleport-menu';
    panel.style.cssText = `
      position: fixed;
      top: ${barRect.bottom + 6}px;
      left: ${barRect.left}px;
      width: ${barRect.width}px;
      background: var(--color-surface-acrylic);
      backdrop-filter: blur(var(--blur-acrylic));
      -webkit-backdrop-filter: blur(var(--blur-acrylic));
      border: 1px solid var(--color-card-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-fluent-modal);
      z-index: 99999;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 280px;
      overflow-y: auto;
      box-sizing: border-box;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                  transform var(--duration-fast) var(--ease-fluent-standard);
    `;

    items.forEach((itemText, index) => {
      const row = document.createElement('div');
      row.className = 'suggest-item-row';
      row.dataset.index = String(index);
      row.style.cssText = `
        padding: 8px 12px;
        font-size: 14px;
        color: var(--color-text-primary);
        border-radius: var(--radius-sm, 4px);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background-color var(--duration-fast) var(--ease-fluent-standard);
      `;

      row.innerHTML = `
        <span style="width: 14px; height: 14px; display: inline-flex; color: var(--color-text-secondary); flex-shrink: 0;">${getIconSvg('search')}</span>
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${highlightMatch(itemText, query)}</span>
      `;

      row.addEventListener('mouseenter', () => {
        this.updateSuggestHighlight(panel, index);
      });

      row.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        onSelect(itemText);
      });

      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    this.activeSuggestPanel = panel;

    requestAnimationFrame(() => {
      if (this.activeSuggestPanel) {
        this.activeSuggestPanel.style.opacity = '1';
        this.activeSuggestPanel.style.transform = 'translateY(0)';
      }
    });

    this.onSuggestOutsideClick = (event: MouseEvent) => {
      if (
        this.activeSuggestPanel &&
        !this.activeSuggestPanel.contains(event.target as Node) &&
        !searchBar.contains(event.target as Node)
      ) {
        this.cleanupSuggestMenu();
      }
    };
    setTimeout(() => {
      if (this.onSuggestOutsideClick !== null) {
        document.addEventListener('click', this.onSuggestOutsideClick);
      }
    }, 0);
  }

  private executeCustomScript(container: HTMLElement): void {
    this.scriptCleanup = null;

    try {
      const code = this.headerConfig.scriptCode && this.headerConfig.scriptCode.trim() !== ''
        ? this.headerConfig.scriptCode
        : DEFAULT_HEADER_SCRIPT;

      const isAsync = /\bawait\b/.test(code);
      let runner: (container: HTMLElement, utils: unknown) => unknown;
      if (isAsync) {
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor as new (...args: string[]) => (...runnerArgs: unknown[]) => unknown;
        runner = new AsyncFunction('container', 'utils', `"use strict";\n${code}\n//# sourceURL=custom-header-script.js`);
      } else {
        runner = new Function('container', 'utils', `"use strict";\n${code}\n//# sourceURL=custom-header-script.js`) as (container: HTMLElement, utils: unknown) => unknown;
      }

      const utils = { getIconSvg };
      const rawResult = runner(container, utils);

      if (typeof rawResult === 'function') {
        const fnStr = rawResult.toString();
        const isRenderFactory = fnStr.includes('container') || fnStr.includes('innerHTML') || fnStr.includes('querySelector') || rawResult.length > 0;
        
        if (isRenderFactory) {
          try {
            const innerCleanup = (rawResult as (c: HTMLElement, u: unknown) => unknown)(container, utils);
            if (typeof innerCleanup === 'function' && innerCleanup !== rawResult) {
              this.scriptCleanup = () => {
                try {
                  (innerCleanup as (c?: HTMLElement, u?: unknown) => unknown)(container, utils);
                } catch (cleanupErr) {
                  console.warn('[UICustomHeader] Header script cleanup failed:', cleanupErr);
                }
              };
            }
          } catch (innerErr) {
            console.warn('[UICustomHeader] Header inner script render function failed:', innerErr);
          }
        } else {
          const targetCleanup = rawResult;
          this.scriptCleanup = () => {
            try {
              (targetCleanup as (c?: HTMLElement, u?: unknown) => unknown)(container, utils);
            } catch (cleanupErr) {
              console.warn('[UICustomHeader] Header top-level script cleanup failed:', cleanupErr);
            }
          };
        }
      } else if (rawResult instanceof Promise) {
        rawResult.then((asyncCleanup) => {
          if (typeof asyncCleanup === 'function') {
            this.scriptCleanup = () => {
              try {
                (asyncCleanup as (c?: HTMLElement, u?: unknown) => unknown)(container, utils);
              } catch (cleanupErr) {
                console.warn('[UICustomHeader] Header async script cleanup failed:', cleanupErr);
              }
            };
          }
        }).catch(error => {
          console.warn('[UICustomHeader] Header async script failed:', error);
          container.innerHTML = `<div class="script-error">Header 异步脚本报错: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
        });
      }
    } catch (error) {
      console.warn('[UICustomHeader] Header script execution failed:', error);
      container.innerHTML = `<div class="script-error">Header 脚本编译或执行出错: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    }
  }

  private render(): void {
    this.cleanupCurrentHeaderScript();

    const isEditMode = this.getAttribute('edit-mode') === 'true';
    const preset = this.headerConfig.preset || 'clock';

    const now = new Date();
    const initialTimeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    const initialDateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    let greetingStr = '你好，准备好开启新的一天了吗';
    const hour = now.getHours();
    if (hour >= 5 && hour < 12) greetingStr = '早上好，愿你拥有高效充实的一天';
    else if (hour >= 12 && hour < 18) greetingStr = '下午好，保持专注与优雅';
    else if (hour >= 18 && hour < 23) greetingStr = '晚上好，享受宁静的时光';
    else greetingStr = '夜深了，注意休息';

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          margin-bottom: 24px;
        }

        .header-box {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          padding: 8px 0px;
          padding-bottom: 20px;
          box-sizing: border-box;
          gap: 20px;
        }

        .header-main-wrapper {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .clock-search-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          width: 100%;
          text-align: center;
          transform: translateX(14px);
        }

        .left-info {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .clock-time {
          font-size: 60px;
          font-weight: 700;
          letter-spacing: -1.5px;
          color: var(--color-text-primary);
          line-height: 1;
          text-shadow: var(--shadow-fluent-card);
        }

        .clock-sub {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          font-size: 15px;
          font-weight: 600;
          color: var(--color-text-primary);
          text-shadow: var(--shadow-fluent-card);
          margin-top: 4px;
        }

        .clock-search-container .clock-sub {
          justify-content: center;
        }

        /* 搜索框居中大号组件 - 严格遵循 tokens.css */
        .header-search-wrapper {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
        }

        .header-search-bar {
          display: flex;
          align-items: center;
          background: var(--color-card-bg);
          backdrop-filter: blur(var(--blur-card));
          -webkit-backdrop-filter: blur(var(--blur-card));
          border: 1px solid var(--color-card-border);
          border-radius: var(--radius-md);
          padding: 5px 6px 5px 12px;
          gap: 10px;
          width: 100%;
          max-width: 580px;
          height: 48px;
          box-sizing: border-box;
          box-shadow: var(--shadow-fluent-card);
          transition: border-color var(--duration-fast) var(--ease-fluent-standard),
                      box-shadow var(--duration-fast) var(--ease-fluent-standard);
        }

        .header-search-bar:hover {
          border-color: var(--color-card-border-hover);
        }

        .header-search-bar:focus-within {
          border-color: var(--color-accent-primary);
        }

        .engine-dropdown-trigger {
          display: inline-flex;
          justify-content: space-between;
          align-items: center;
          min-width: 64px;
          gap: 4px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--color-text-primary);
          font-size: 14px;
          font-weight: 600;
          user-select: none;
          flex-shrink: 0;
          transition: color var(--duration-fast) var(--ease-fluent-standard),
                      background-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .engine-dropdown-trigger:hover {
          color: var(--color-accent-primary);
          background: rgba(255, 255, 255, 0.08);
        }

        .engine-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 12px;
          height: 12px;
          color: var(--color-text-secondary);
          transition: transform var(--duration-fast) var(--ease-fluent-standard);
        }

        .engine-arrow svg {
          width: 100%;
          height: 100%;
        }

        .engine-dropdown-trigger.active .engine-arrow {
          transform: rotate(180deg);
        }

        .search-input {
          flex: 1;
          min-width: 120px;
          background: transparent;
          border: none;
          outline: none;
          color: var(--color-text-primary);
          font-size: 15px;
          font-family: inherit;
          padding: 6px 4px;
        }

        .search-input::placeholder {
          color: var(--color-text-secondary);
          opacity: 0.8;
        }

        .action-btns {
          display: flex;
          align-items: flex-end;
          align-self: flex-end;
        }

        .script-error {
          color: #ff4d4f;
          background: rgba(255, 77, 79, 0.1);
          border: 1px dashed #ff4d4f;
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          font-size: 13px;
        }

        @media (max-width: 768px) {
          .clock-time {
            font-size: 42px;
          }
          .header-search-bar {
            max-width: 100%;
            height: 44px;
          }
        }
      </style>

      <div class="header-box">
        <div class="header-main-wrapper" id="header-content">
          ${this.renderHeaderPresetHtml(preset, initialTimeStr, initialDateStr, greetingStr)}
        </div>

        <div class="action-btns">
          <ui-button
            id="btn-header-action"
            variant="${isEditMode ? 'primary' : 'standard'}"
            icon="${isEditMode ? 'check' : 'settings'}"
            title="${isEditMode ? '完成并退出编辑' : '打开偏好设置'}"
            icon-only
          ></ui-button>
        </div>
      </div>
    `;

    // 绑定事件与逻辑
    if (preset === 'clock' || preset === 'clock_search') {
      this.startClock();
    }

    if (preset === 'search' || preset === 'clock_search') {
      this.bindSearchEvents();
    }

    if (preset === 'script') {
      const container = this.shadow.querySelector('#header-content') as HTMLElement | null;
      if (container !== null) {
        this.executeCustomScript(container);
      }
    }

    this.shadow.querySelector('#btn-header-action')?.addEventListener('click', () => {
      if (isEditMode) {
        this.dispatchEvent(new CustomEvent('exit-edit-mode', { bubbles: true, composed: true }));
      } else {
        this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true }));
      }
    });
  }

  private renderHeaderPresetHtml(preset: HeaderConfig['preset'], initialTimeStr: string, initialDateStr: string, greetingStr: string): string {
    const renderClock = `
      <div class="left-info">
        <div class="clock-time" id="clock-time">${initialTimeStr}</div>
        <div class="clock-sub">
          <span id="clock-date">${initialDateStr}</span>
          <span>·</span>
          <span id="clock-greeting">${escapeHtml(greetingStr)}</span>
        </div>
      </div>
    `;

    const renderSearchBar = `
      <div class="header-search-wrapper">
        <div class="header-search-bar">
          <div class="engine-dropdown-trigger" id="header-engine-trigger" title="切换搜索引擎">
            <span id="engine-current-name">Bing</span>
            <span class="engine-arrow">${getIconSvg('chevron')}</span>
          </div>
          <input class="search-input" id="header-search-input" type="text" placeholder="搜索网页或输入 URL..." />
          <ui-button id="header-search-btn" variant="primary" icon="search" title="点击搜索"></ui-button>
        </div>
      </div>
    `;

    if (preset === 'clock') {
      return renderClock;
    } else if (preset === 'search') {
      return renderSearchBar;
    } else if (preset === 'clock_search') {
      return `
        <div class="clock-search-container">
          ${renderClock}
          ${renderSearchBar}
        </div>
      `;
    } else if (preset === 'script') {
      return `<!-- Script Content Container -->`;
    }
    return '';
  }
}

if (!customElements.get('ui-custom-header')) {
  customElements.define('ui-custom-header', UICustomHeader);
}
