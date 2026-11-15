/**
 * ════════════════════════════════════════════════════════════════════
 *  独棋（Chess Ranger / Solo Chess）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：棋子按国际象棋标准走法移动；每一步都必须吃子（可以吃王）；
 *       目标是把盘面吃到只剩一个棋子。
 *
 * 状态：board 每格 0=空 / 1=兵 2=马 3=象 4=车 5=后 6=王（统一白方）。
 * 交互：clickAt / keyAt 走「选中棋子 → 点目标吃子」的选择式流程。
 */

import './chess.css'
import { playDrop } from '../core/audio'
import type {
  CustomSupport,
  GameAdapter,
  GameState,
  HitTarget,
  InteractionResult,
  Move,
  Puzzle,
  SolveResult,
} from '../core/types'
import { handleClick, handleKey } from './interaction'
import { planLogicSolve } from './logic'
import {
  builtinPuzzles,
  getReferenceSolution as getBuiltinReference,
  replayPuzzleSolution,
} from './puzzles'
import { countPieces } from './rules'
import { flashCapture, hitTest, metricsFor, renderBoard } from './render'
import { CaptureSolver } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  invertMove,
  makeCaptureMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import {
  asChessPuzzle,
  asChessState,
  decodeLayout,
  encodeLayout,
  isPiece,
  pieceGlyph,
  type ChessPuzzle,
} from './types'
import { statusBits, validate } from './validate'

/* ── 1. 元信息 ── */

const meta = {
  title: '独棋',
  documentTitle: '独棋（Chess Ranger）',
  tagline: 'Chess Ranger —— 每步必须吃子，最后只剩一枚棋子',
  footerNote:
    '规则：按国际象棋标准走法移动棋子，每一步都必须吃掉另一枚棋子（允许吃王）；把盘面吃到只剩一个棋子即通关。兵向「上」斜吃一格、不升变；没有将军/王车易位等限制。',
  storageKeyPrefix: 'chess-ranger',
  customIdPrefix: 'chess-custom-',
  customMinW: 3,
  customMinH: 3,
  customMaxW: 10,
  customMaxH: 8,
  targetKind: 'cell' as const,
  interactionHint: '<kbd>左键</kbd> 选中棋子 → 点高亮目标吃子 · <kbd>右键</kbd> 取消选中',
}

/* ── 2. 题库 ── */

const builtin = builtinPuzzles

function getReferenceSolution(id: string): GameState | null {
  return getBuiltinReference(id)
}

/* ── 3. 求解 / 提示 ── */

function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = asChessPuzzle(puzzle)
  const width = p.width
  const height = p.height
  if (!Array.isArray(p.layout) || p.layout.length !== width * height) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  // 内置题自带参考解：直接重放（做题库审计时同一套逻辑）
  if (Array.isArray(p.solution) && p.solution.length > 0) {
    const solved = replayPuzzleSolution(p)
    if (solved) return { solved: true, solution: solved, nodes: 0, timedOut: false }
  }
  const out = new CaptureSolver(width, height).findSolution(p.layout, {
    maxNodes,
    maxMillis: 6000,
  })
  if (!out.solution) {
    return { solved: false, solution: null, nodes: out.nodes, timedOut: out.timedOut }
  }
  const state = createEmptyState(p)
  for (const step of out.solution) applyMove(state, makeCaptureMove(step))
  return { solved: true, solution: state, nodes: out.nodes, timedOut: false }
}

function firstHintMove(state: GameState, _solution: GameState | null): Move | null {
  const s = asChessState(state)
  if (countPieces(s.board) <= 1) return null
  const out = new CaptureSolver(s.width, s.height).findSolution(s.board, {
    maxNodes: 500_000,
    maxMillis: 2000,
  })
  if (!out.solution || out.solution.length === 0) return null
  return makeCaptureMove(out.solution[0]!)
}

/* ── 4. 自定义题板 ── */

const VALUE_CYCLE: Array<number | null> = [null, 1, 2, 3, 4, 5, 6]

function customLayout(p: Puzzle): number[] | null {
  const cp = p as ChessPuzzle
  if (!Array.isArray(cp.layout) || cp.layout.length !== p.width * p.height) return null
  return cp.layout.map((v) => (isPiece(v) ? v : 0))
}

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: VALUE_CYCLE,
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 6) return digit
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : pieceGlyph(v)),
  cellClass: (v) => (v == null ? '' : `piece-${v}`),
  hint:
    '点击格子循环：空 → 兵 → 马 → 象 → 车 → 后 → 王；键盘 1–6 直接放子、0/退格清空、方向键移动、右键清空格。至少放 2 枚棋子才可能吃成 1 枚。',
  toGrid: (p) => {
    const layout = customLayout(p)
    if (!layout) return null
    return {
      width: p.width,
      height: p.height,
      grid: layout.map((v) => (isPiece(v) ? v : null)),
    }
  },
  makePuzzle: (w, h, grid, existingId) => {
    const layout = new Array<number>(w * h).fill(0)
    for (let i = 0; i < layout.length; i++) {
      const v = grid[i]
      layout[i] = isPiece(v) ? v : 0
    }
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      layout,
    }
  },
  encodePuzzle: (p) => ({ board: encodeLayout(customLayout(p) ?? []) }),
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width | 0
    const h = record.height | 0
    if (w < meta.customMinW || h < meta.customMinH || w > meta.customMaxW || h > meta.customMaxH) {
      return null
    }
    const layout = decodeLayout(record.board, w * h)
    if (!layout) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      layout,
    }
  },
}

/* ── 5. 音效 / 特效 ── */

function playForMove(_move: Move, streak: number): void {
  // 独棋每一步都是吃子，用「水滴」表现撞击
  playDrop(streak)
}

/* ── 6. 组装 ── */

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles: builtin,
  getReferenceSolution,

  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,

  validate,
  statusBits,

  metricsFor,
  renderBoard,
  hitTest,

  planLogicSolve,
  solvePuzzle,
  firstHintMove,

  custom,
  playForMove,
  flashForMove: flashCapture,

  // 选择式交互：点击 / 键盘
  clickAt(state: GameState, target: HitTarget, button: 0 | 2): InteractionResult {
    return handleClick(asChessState(state), target, button)
  },
  keyAt(state: GameState, key: string): InteractionResult | null {
    return handleKey(asChessState(state), key)
  },
}
