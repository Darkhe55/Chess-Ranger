/**
 * 独棋 —— SVG 渲染与命中
 *
 * 视觉要点：
 *   - 国际象棋棋盘（深浅格 + 边线 + 文件/行号）；
 *   - 棋子用国际象棋 Unicode 字形 + 浅色描边，深浅格上都清晰；
 *   - 选中棋子高亮，可吃目标显示圆点/圈；
 *   - 键盘光标用虚线框；非法尝试用红色虚线 + ×；
 *   - 落子/吃子有轨迹 + 涟漪特效。
 */

import type { BoardMetrics, GameState, Move, Puzzle, ValidationResult } from '../core/types'
import { cellAtPoint, cellCenter, squareMetrics } from '../core/board.ts'
import { selectedTargets } from './interaction.ts'
import { captureMetaOf } from './state.ts'
import {
  asChessPuzzle,
  asChessState,
  isPiece,
  pieceGlyph,
  type ChessState,
} from './types.ts'

const NS = 'http://www.w3.org/2000/svg'

/** 棋盘度量：最大边越长，格子越小；留白用于文件/行号 */
export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const maxSide = Math.max(puzzle.width, puzzle.height)
  const cell = Math.max(40, Math.min(84, Math.floor(500 / Math.max(4, maxSide))))
  return squareMetrics(puzzle.width, puzzle.height, {
    cell,
    pad: 10,
    padLeft: Math.max(20, Math.round(cell * 0.42)),
    padTop: Math.max(12, Math.round(cell * 0.22)),
    padRight: Math.max(12, Math.round(cell * 0.2)),
    padBottom: Math.max(20, Math.round(cell * 0.46)),
    targetKind: 'cell',
  })
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function cellRect(m: BoardMetrics, index: number): { x: number; y: number; cx: number; cy: number } {
  const cell = m.cellW ?? m.cell
  const c = cellCenter(m, index)
  return { x: c.x - cell / 2, y: c.y - cell / 2, cx: c.x, cy: c.y }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
): string {
  const p = asChessPuzzle(puzzle)
  const s = asChessState(state)
  const m = metricsFor(puzzle)
  const w = p.width
  const h = p.height
  const cell = m.cellW ?? m.cell
  const ox = m.originX ?? m.pad
  const oy = m.originY ?? m.pad
  const boardW = w * cell
  const boardH = h * cell
  const targets = new Set(selectedTargets(s))
  const r = result as unknown as { solved?: boolean }

  const out: string[] = []
  out.push(
    `<svg class="board-svg chess-board${r.solved ? ' is-solved' : ''}" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="${NS}" role="img" aria-label="独棋棋盘 ${w}×${h}">`,
  )

  // 棋盘底板
  const pad = Math.max(4, Math.round(cell * 0.08))
  out.push(
    `<rect class="board-frame" x="${ox - pad}" y="${oy - pad}" width="${boardW + pad * 2}" height="${boardH + pad * 2}" rx="${cell * 0.1}" />`,
  )

  // 格子
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = ox + x * cell
      const sy = oy + y * cell
      const cls = (x + y) % 2 === 1 ? 'sq sq-dark' : 'sq sq-light'
      out.push(`<rect class="${cls}" x="${sx}" y="${sy}" width="${cell}" height="${cell}" />`)
    }
  }

  // 文件 / 行号
  for (let x = 0; x < w; x++) {
    out.push(
      `<text class="coord coord-file" x="${ox + x * cell + cell / 2}" y="${oy + boardH + cell * 0.32}">${'abcdefghij'[x] ?? ''}</text>`,
    )
  }
  for (let y = 0; y < h; y++) {
    out.push(
      `<text class="coord coord-rank" x="${ox - cell * 0.3}" y="${oy + y * cell + cell * 0.62}">${h - y}</text>`,
    )
  }

  // 上一步：起点与落点
  if (s.lastMove) {
    for (const [idx, cls] of [
      [s.lastMove.origin, 'last-from'],
      [s.lastMove.target, 'last-to'],
    ] as const) {
      const g = cellRect(m, idx)
      out.push(
        `<rect class="${cls}" x="${g.x}" y="${g.y}" width="${cell}" height="${cell}" />`,
      )
    }
  }

  // 可吃目标高亮
  for (const t of targets) {
    const g = cellRect(m, t)
    const occupied = isPiece(s.board[t])
    if (occupied) {
      out.push(
        `<circle class="target-ring" cx="${g.cx}" cy="${g.cy}" r="${cell * 0.38}" />` +
          `<circle class="target-ring-inner" cx="${g.cx}" cy="${g.cy}" r="${cell * 0.24}" />`,
      )
    } else {
      out.push(`<circle class="target-dot" cx="${g.cx}" cy="${g.cy}" r="${cell * 0.1}" />`)
    }
  }

  // 选中棋子底圈
  if (s.selected >= 0) {
    const g = cellRect(m, s.selected)
    out.push(
      `<circle class="select-glow" cx="${g.cx}" cy="${g.cy}" r="${cell * 0.4}" />` +
        `<rect class="select-box" x="${g.x + 2}" y="${g.y + 2}" width="${cell - 4}" height="${cell - 4}" rx="${cell * 0.12}" />`,
    )
  }

  // 非法尝试：起点→目标虚线 + 目标 ×
  if (s.invalid) {
    const a = cellCenter(m, s.invalid.origin)
    const b = cellCenter(m, s.invalid.target)
    out.push(
      `<line class="invalid-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`,
    )
    const g = cellRect(m, s.invalid.target)
    const d = cell * 0.2
    out.push(
      `<line class="invalid-x" x1="${g.cx - d}" y1="${g.cy - d}" x2="${g.cx + d}" y2="${g.cy + d}" />` +
        `<line class="invalid-x" x1="${g.cx + d}" y1="${g.cy - d}" x2="${g.cx - d}" y2="${g.cy + d}" />`,
    )
  }

  // 键盘光标
  if (s.cursor >= 0) {
    const g = cellRect(m, s.cursor)
    out.push(
      `<rect class="kbd-cursor" x="${g.x + 3}" y="${g.y + 3}" width="${cell - 6}" height="${cell - 6}" rx="${cell * 0.1}" />`,
    )
  }

  // 棋子
  for (let i = 0; i < s.board.length; i++) {
    const piece = s.board[i] | 0
    if (!isPiece(piece)) continue
    const g = cellRect(m, i)
    const classes = ['piece']
    if (i === s.selected) classes.push('is-selected')
    if (targets.has(i)) classes.push('is-target')
    out.push(
      `<g class="${classes.join(' ')}" data-index="${i}" data-piece="${piece}">` +
        `<text class="piece-glyph" x="${g.cx}" y="${g.cy}" font-size="${Math.round(cell * 0.72)}">${esc(pieceGlyph(piece))}</text>` +
        `</g>`,
    )
  }

  // 命中层（透明，放在最上层）
  for (let i = 0; i < s.board.length; i++) {
    const g = cellRect(m, i)
    out.push(
      `<rect class="cell-hit" data-index="${i}" x="${g.x}" y="${g.y}" width="${cell}" height="${cell}" fill="transparent" pointer-events="all" />`,
    )
  }

  out.push('</svg>')
  return out.join('')
}

/** 点命中单元格 */
export function hitTest(
  m: BoardMetrics,
  _puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const index = cellAtPoint(m, x, y)
  return index === null ? null : { index }
}

/**
 * 吃子特效：从起点到落点的一道轨迹 + 落点涟漪。
 * 棋盘在落子后已重绘，所以这里只叠加临时元素，动画结束后移除。
 */
export function flashCapture(
  svg: SVGSVGElement,
  move: Move,
  streak: number,
  m: BoardMetrics,
): void {
  const meta = captureMetaOf(move)
  if (!meta) return
  const from = cellCenter(m, meta.origin)
  const to = cellCenter(m, meta.target)
  const cell = m.cellW ?? m.cell
  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'capture-fx')

  const trail = document.createElementNS(NS, 'line')
  trail.setAttribute('class', 'capture-trail')
  trail.setAttribute('x1', String(from.x))
  trail.setAttribute('y1', String(from.y))
  trail.setAttribute('x2', String(to.x))
  trail.setAttribute('y2', String(to.y))
  group.appendChild(trail)

  const ring = document.createElementNS(NS, 'circle')
  ring.setAttribute('class', 'capture-ring')
  ring.setAttribute('cx', String(to.x))
  ring.setAttribute('cy', String(to.y))
  ring.setAttribute('r', String(cell * 0.16))
  group.appendChild(ring)

  svg.appendChild(group)
  const dur = Math.max(320, 560 / Math.max(1, Math.sqrt(streak)))

  try {
    trail.animate(
      [
        { opacity: 0.95, strokeWidth: '5' },
        { opacity: 0.6, strokeWidth: '3' },
        { opacity: 0, strokeWidth: '1' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.2,0.7,0.3,1)', fill: 'forwards' },
    )
    ring.animate(
      [
        { r: cell * 0.14, opacity: 0.95, strokeWidth: '4' },
        { r: cell * 0.42, opacity: 0.5, strokeWidth: '2' },
        { r: cell * 0.7, opacity: 0, strokeWidth: '1' },
      ],
      { duration: dur + 80, easing: 'cubic-bezier(0.2,0.7,0.3,1)', fill: 'forwards' },
    )
  } catch {
    /* 旧浏览器忽略动画 */
  }
  setTimeout(() => group.remove(), dur + 160)
}

/** 供状态栏/说明使用：当前选中棋子的目标坐标 */
export function describeState(s: ChessState): string {
  return `选中 ${s.selected}，光标 ${s.cursor}`
}
