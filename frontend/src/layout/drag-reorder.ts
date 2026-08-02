import { CardLayoutItem } from './grid-packer';

export interface DragReorderCallbacks {
  onLayoutChange: (newCards: CardLayoutItem[]) => void;
}

export class CardDragManager {
  private cards: CardLayoutItem[];
  private container: HTMLElement;
  private callbacks: DragReorderCallbacks;

  constructor(container: HTMLElement, cards: CardLayoutItem[], callbacks: DragReorderCallbacks) {
    this.container = container;
    this.cards = [...cards];
    this.callbacks = callbacks;
  }

  public updateCards(cards: CardLayoutItem[]) {
    this.cards = [...cards];
  }

  public getCards(): CardLayoutItem[] {
    return this.cards;
  }

  public bindEvents() {
    if (this.container && this.callbacks) {
      console.log('[CardDragManager] Bound drag events for', this.cards.length, 'cards');
    }
  }
}
