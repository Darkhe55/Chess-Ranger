/**
 * 独棋 —— 规则内核（纯函数，不依赖 DOM / 模板核心运行时）
 *
 * 只放「怎么走、能不能吃、怎么吃」这类硬规则，
 * 求解器、交互、校验、渲染都复用这里，保证行为一致。
 */

import {
  BISHOP,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  isPiece,
  type CaptureStep,
} from './types.ts'

/** 盘面下标 → {x,y} */
export function xyOf(index: number, width: number): { x: number; y: number } {
  return { x: index % width, y: Math.floor(index / width) }
}

/** {x,y} → 盘面下标；越界返回 -1 */
export function indexOf(x: number, y: number, width: number, height: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return -1
  return y * width + x
}

export function onBoard(index: number, width: number, height: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < width * height
}

export function countPieces(board: ArrayLike<number>): number {
  let n = 0
  for (let i = 0; i < board.length; i++) if (isPiece(board[i])) n++
  return n
}

/** 棋盘指纹（求解器记忆化用；宽度包含在求解器实例里） */
export function boardKey(board: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < board.length; i++) out += String(board[i] | 0)
  return out
}

/* ────────────────────────── 走法几何 ────────────────────────── */

const KNIGHT_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
]

const KING_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

/** 象/车/后：沿方向逐格前进，返回可落点列表（不含自身） */
function rayTargets(
  board: ArrayLike<number>,
  width: number,
  height: number,
  origin: number,
  dirs: ReadonlyArray<readonly [number, number]>,
  slide: boolean,
): number[] {
  const { x, y } = xyOf(origin, width)
  const out: number[] = []
  for (const [dx, dy] of dirs) {
    let cx = x + dx
    let cy = y + dy
    while (cx >= 0 && cy >= 0 && cx < width && cy < height) {
      const idx = cy * width + cx
      if (isPiece(board[idx])) {
        // 只有目标格有棋子时才是「可吃」；被挡住后不能再往后
        out.push(idx)
        break
      }
      out.push(idx)
      if (!slide) break
      cx += dx
      cy += dy
    }
  }
  return out
}

/** 马/王的固定步长落点 */
function stepTargets(
  width: number,
  height: number,
  origin: number,
  deltas: ReadonlyArray<readonly [number, number]>,
): number[] {
  const { x, y } = xyOf(origin, width)
  const out: number[] = []
  for (const [dx, dy] of deltas) {
    const idx = indexOf(x + dx, y + dy, width, height)
    if (idx >= 0) out.push(idx)
  }
  return out
}

/**
 * 枚举某枚棋子所有「几何上可吃」的目标格（目标格必须已有棋子）。
 * 空走不算合法走法，因此这里直接过滤掉空格。
 */
export function legalTargets(
  board: ArrayLike<number>,
  width: number,
  height: number,
  origin: number,
): number[] {
  if (!onBoard(origin, width, height)) return []
  const piece = board[origin] | 0
  if (!isPiece(piece)) return []

  let candidates: number[] = []
  switch (piece) {
    case PAWN: {
      // 统一白方：兵向「上」（y-1）斜吃一格
      const { x, y } = xyOf(origin, width)
      const candidatesXY: Array<[number, number]> = [
        [x - 1, y - 1],
        [x + 1, y - 1],
      ]
      for (const [cx, cy] of candidatesXY) {
        const idx = indexOf(cx, cy, width, height)
        if (idx >= 0) candidates.push(idx)
      }
      break
    }
    case KNIGHT:
      candidates = stepTargets(width, height, origin, KNIGHT_DELTAS)
      break
    case KING:
      candidates = stepTargets(width, height, origin, KING_DELTAS)
      break
    case BISHOP:
      candidates = rayTargets(
        board,
        width,
        height,
        origin,
        [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        true,
      )
      break
    case ROOK:
      candidates = rayTargets(
        board,
        width,
        height,
        origin,
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        true,
      )
      break
    case QUEEN:
      candidates = rayTargets(
        board,
        width,
        height,
        origin,
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        true,
      )
      break
    default:
      candidates = []
  }

  const out: number[] = []
  for (const idx of candidates) {
    if (idx === origin) continue
    if (isPiece(board[idx])) out.push(idx)
  }
  return out
}

/** origin 的棋子能否吃掉 target 上的棋子（含路径被挡检查） */
export function canCapture(
  board: ArrayLike<number>,
  width: number,
  height: number,
  origin: number,
  target: number,
): boolean {
  if (origin === target) return false
  if (!onBoard(origin, width, height) || !onBoard(target, width, height)) return false
  const piece = board[origin] | 0
  if (!isPiece(piece) || !isPiece(board[target])) return false
  return legalTargets(board, width, height, origin).includes(target)
}

/** 判定一步吃子是否合法（返回原因便于状态栏提示） */
export function checkCapture(
  board: ArrayLike<number>,
  width: number,
  height: number,
  origin: number,
  target: number,
): { ok: boolean; reason: string } {
  if (!onBoard(origin, width, height) || !onBoard(target, width, height)) {
    return { ok: false, reason: '落点超出棋盘' }
  }
  if (origin === target) return { ok: false, reason: '不能吃自己' }
  const piece = board[origin] | 0
  if (!isPiece(piece)) return { ok: false, reason: '起点没有棋子' }
  if (!isPiece(board[target])) return { ok: false, reason: '不能走到空格：每一步都必须吃子' }
  if (!canCapture(board, width, height, origin, target)) {
    return { ok: false, reason: `${pieceNameOf(piece)}吃不到这个目标（走法或路径被挡）` }
  }
  return { ok: true, reason: '' }
}

function pieceNameOf(piece: number): string {
  const names = ['', '兵', '马', '象', '车', '后', '王']
  return names[piece] ?? '棋'
}

/** 枚举当前盘面全部合法吃子 */
export function legalMoves(
  board: ArrayLike<number>,
  width: number,
  height: number,
): CaptureStep[] {
  const out: CaptureStep[] = []
  const total = width * height
  for (let origin = 0; origin < total; origin++) {
    const piece = board[origin] | 0
    if (!isPiece(piece)) continue
    for (const target of legalTargets(board, width, height, origin)) {
      out.push({ origin, target, piece, captured: board[target] | 0 })
    }
  }
  return out
}

/** 原地执行一步吃子（调用方保证合法） */
export function applyCapture(board: number[], step: CaptureStep): void {
  board[step.target] = step.piece
  board[step.origin] = 0
}

/** 原地撤销一步吃子 */
export function undoCapture(board: number[], step: CaptureStep): void {
  board[step.origin] = step.piece
  board[step.target] = step.captured
}

/** 吃子后攻击方所在格 */
export function captureTargetOf(step: CaptureStep): number {
  return step.target
}

/**
 * 一步棋的「棋力」：这个棋子还有几种吃法。
 * 求解器用 MRV（最少走法优先）排序，快速暴露死路。
 */
export function mobilityOf(
  board: ArrayLike<number>,
  width: number,
  height: number,
  origin: number,
): number {
  return legalTargets(board, width, height, origin).length
}
