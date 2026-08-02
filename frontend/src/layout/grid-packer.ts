export interface CardLayoutItem {
  id: string;
  title: string;
  w: number; // 占用网格宽度跨度 (1 ~ cols)
  h: number; // 占用网格高度跨度 (1 ~ 4)
  order?: number;
  type?: string;
  [key: string]: unknown;
}

export interface PlacedCardLayout extends CardLayoutItem {
  colStart: number;
  colSpan: number;
  rowStart: number;
  rowSpan: number;
}

/**
 * 2D Bin Packing 响应式密铺算法引擎
 * 根据当前列数与卡片尺寸，无缝计算最优紧凑落点
 */
export function packGrid(cards: CardLayoutItem[], maxCols: number): PlacedCardLayout[] {
  if (maxCols <= 0) {
    throw new Error(`Invalid maxCols parameter: ${maxCols}`);
  }

  const gridMap: boolean[][] = [];

  function isSpaceAvailable(startRow: number, startCol: number, w: number, h: number): boolean {
    if (startCol + w > maxCols) return false;

    for (let r = startRow; r < startRow + h; r++) {
      if (!gridMap[r]) gridMap[r] = [];
      for (let c = startCol; c < startCol + w; c++) {
        if (gridMap[r][c]) {
          return false;
        }
      }
    }
    return true;
  }

  function markSpaceOccupied(startRow: number, startCol: number, w: number, h: number) {
    for (let r = startRow; r < startRow + h; r++) {
      if (!gridMap[r]) gridMap[r] = [];
      for (let c = startCol; c < startCol + w; c++) {
        gridMap[r][c] = true;
      }
    }
  }

  const placedCards: PlacedCardLayout[] = [];

  // 按 order 权重或原始数组顺序处理
  const sortedCards = [...cards].sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const card of sortedCards) {
    // 列宽不能超过最大列数
    const effectiveW = Math.min(card.w, maxCols);
    const effectiveH = Math.max(1, card.h);

    let placed = false;
    let r = 0;

    while (!placed) {
      if (!gridMap[r]) gridMap[r] = [];

      for (let c = 0; c <= maxCols - effectiveW; c++) {
        if (isSpaceAvailable(r, c, effectiveW, effectiveH)) {
          markSpaceOccupied(r, c, effectiveW, effectiveH);
          placedCards.push({
            ...card,
            colStart: c + 1,
            colSpan: effectiveW,
            rowStart: r + 1,
            rowSpan: effectiveH,
          });
          placed = true;
          break;
        }
      }
      r++;
    }
  }

  return placedCards;
}
