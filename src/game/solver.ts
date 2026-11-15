/**
 * 独棋 —— 回溯求解器
 *
 * 状态 = 盘面（每格 0 或棋子类型）。搜索「吃子序列」：
 *   - 每层枚举全部合法吃子；
 *   - 剩余 1 枚即成功；
 *   - 记忆化：同一盘面（棋子位置+类型）的结果缓存，避免重复搜索；
 *   - 剪枝：无子可吃、以及「既不能动也不会被吃」的孤立棋子（永远无法消掉）直接判死；
 *   - MRV 排序：可吃子最少的棋子先尝试，快速暴露死路；
 *   - 预算：节点数与墙钟时间双重上限，超时返回 timedOut。
 *
 * 该模块是纯 TS（不依赖 DOM），scripts/check.mjs 直接用 node 导入运行。
 */

import { applyCapture, boardKey, countPieces, legalMoves, undoCapture } from './rules.ts'
import type { CaptureStep } from './types.ts'

export interface SolveBudget {
  /** 搜索节点上限（默认 1_500_000） */
  maxNodes?: number
  /** 墙钟毫秒上限（默认 6000） */
  maxMillis?: number
}

export interface SolveOutcome {
  solved: boolean
  /** 最多返回 limit 条解（limit=1 时最多一条） */
  solutions: CaptureStep[][]
  nodes: number
  timedOut: boolean
  /** 是否完整搜完（未超预算） */
  exhaustive: boolean
}

const DEFAULT_MAX_NODES = 1_500_000
const DEFAULT_MAX_MILLIS = 6000

interface Budget {
  maxNodes: number
  maxMillis: number
  deadline: number
  nodes: number
  timedOut: boolean
}

function makeBudget(opts: SolveBudget = {}): Budget {
  const maxNodes = Math.max(1, opts.maxNodes ?? DEFAULT_MAX_NODES)
  const maxMillis = Math.max(1, opts.maxMillis ?? DEFAULT_MAX_MILLIS)
  return {
    maxNodes,
    maxMillis,
    deadline: Date.now() + maxMillis,
    nodes: 0,
    timedOut: false,
  }
}

/** 每 1024 个节点检查一次时间，避免 Date.now() 太频繁 */
function overBudget(b: Budget): boolean {
  if (b.timedOut) return true
  if (b.nodes > b.maxNodes) {
    b.timedOut = true
    return true
  }
  if ((b.nodes & 1023) === 0 && Date.now() > b.deadline) {
    b.timedOut = true
    return true
  }
  return false
}

/**
 * 一个求解上下文：缓存「死局」与「解的数量」。
 * 同一个上下文可以连续问很多次（逻辑回放的可解性判定就用它）。
 */
export class CaptureSolver {
  readonly width: number
  readonly height: number
  private dead = new Set<string>()
  private countCache = new Map<string, number>()
  private solutionCache = new Map<string, CaptureStep[] | null>()

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /** 棋盘编码 */
  private key(board: ArrayLike<number>): string {
    return boardKey(board)
  }

  /** MRV 排序后的合法吃子 */
  private orderedMoves(board: number[]): CaptureStep[] {
    const moves = legalMoves(board, this.width, this.height)
    if (moves.length <= 1) return moves
    const byOrigin = new Map<number, CaptureStep[]>()
    for (const m of moves) {
      const list = byOrigin.get(m.origin)
      if (list) list.push(m)
      else byOrigin.set(m.origin, [m])
    }
    const groups = [...byOrigin.entries()]
    groups.sort((a, b) => a[1].length - b[1].length || a[0] - b[0])
    const out: CaptureStep[] = []
    for (const [, list] of groups) for (const m of list) out.push(m)
    return out
  }

  /**
   * 死路剪枝：当前盘面已经没有任何合法吃子（且还剩多枚棋子）→ 必败。
   *
   * 注意：不能把「当前没有参与任何吃子」的棋子当成孤立棋子剪掉 ——
   * 它可能被其它棋子挡住、等前面的棋子被吃掉后才轮到它，属于合法局面。
   */
  private isDeadEnd(moves: CaptureStep[]): boolean {
    return moves.length === 0
  }

  /** 尝试找一条解（找到即返回） */
  findSolution(board: ArrayLike<number>, opts: SolveBudget = {}): {
    solution: CaptureStep[] | null
    nodes: number
    timedOut: boolean
    exhaustive: boolean
  } {
    const work = Array.from(board, (v) => v | 0)
    const budget = makeBudget(opts)
    const path: CaptureStep[] = []
    const dead = this.dead
    const cache = this.solutionCache

    const dfs = (): boolean => {
      budget.nodes++
      if (overBudget(budget)) return false
      const pieces = countPieces(work)
      if (pieces === 1) return true
      const key = this.key(work)
      if (dead.has(key)) return false
      const cached = cache.get(key)
      if (cached) {
        for (const step of cached) path.push(step)
        return true
      }
      const moves = this.orderedMoves(work)
      if (this.isDeadEnd(moves)) {
        dead.add(key)
        return false
      }
      const before = path.length
      for (const step of moves) {
        path.push(step)
        applyCapture(work, step)
        if (dfs()) return true
        undoCapture(work, step)
        path.length = before
        if (budget.timedOut) return false
      }
      if (!budget.timedOut) dead.add(key)
      return false
    }

    const found = dfs()
    if (found) {
      // 缓存从当前盘面出发的一条解（可能是中途拼出来的，直接存完整路径）
      cache.set(this.key(board), path.slice())
      return {
        solution: path.slice(),
        nodes: budget.nodes,
        timedOut: false,
        exhaustive: false,
      }
    }
    return {
      solution: null,
      nodes: budget.nodes,
      timedOut: budget.timedOut,
      exhaustive: !budget.timedOut,
    }
  }

  /** 当前盘面是否可解（共享死局缓存，适合回放时反复询问） */
  solvable(board: ArrayLike<number>, opts: SolveBudget = {}): boolean {
    return this.probe(board, opts) === 'yes'
  }

  /**
   * 三态可解性判定：
   *   'yes' 有解；'no' 确定无解；'unknown' 预算内没搜完。
   * 逻辑回放需要区分「唯一可行」和「预算不够」，因此单独提供。
   */
  probe(board: ArrayLike<number>, opts: SolveBudget = {}): 'yes' | 'no' | 'unknown' {
    if (countPieces(board) <= 1) return 'yes'
    const key = this.key(board)
    if (this.dead.has(key)) return 'no'
    if (this.solutionCache.has(key)) return 'yes'
    const result = this.findSolution(board, opts)
    if (result.solution) return 'yes'
    return result.timedOut ? 'unknown' : 'no'
  }

  /**
   * 统计解的数量（最多 limit 条，limit=2 用于唯一性判定）。
   * 返回 exhaustive=false 表示预算内没数完，结果不可作为唯一性证据。
   */
  countSolutions(
    board: ArrayLike<number>,
    limit = 2,
    opts: SolveBudget = {},
  ): SolveOutcome {
    const cap = Math.max(1, Math.min(2, limit))
    const work = Array.from(board, (v) => v | 0)
    const budget = makeBudget(opts)
    const cache = this.countCache
    const found: CaptureStep[][] = []
    const path: CaptureStep[] = []

    const dfs = (): number => {
      budget.nodes++
      if (overBudget(budget)) return 0
      if (found.length >= cap) return 0
      const pieces = countPieces(work)
      if (pieces === 1) {
        found.push(path.slice())
        return 1
      }
      const key = this.key(work)
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const moves = this.orderedMoves(work)
      if (this.isDeadEnd(moves)) {
        cache.set(key, 0)
        return 0
      }
      let total = 0
      const before = path.length
      for (const step of moves) {
        path.push(step)
        applyCapture(work, step)
        total += dfs()
        undoCapture(work, step)
        path.length = before
        if (found.length >= cap) break
        if (budget.timedOut) break
      }
      if (!budget.timedOut) cache.set(key, Math.min(total, cap))
      return total
    }

    dfs()
    return {
      solved: found.length > 0,
      solutions: found,
      nodes: budget.nodes,
      timedOut: budget.timedOut,
      exhaustive: !budget.timedOut && found.length < cap,
    }
  }
}

/** 便捷函数：统计解的数量（最多 limit 条） */
export function countSolutions(
  board: ArrayLike<number>,
  width: number,
  height: number,
  limit = 2,
  opts: SolveBudget = {},
): SolveOutcome {
  return new CaptureSolver(width, height).countSolutions(board, limit, opts)
}

/** 便捷函数：找一条解 */
export function findSolution(
  board: ArrayLike<number>,
  width: number,
  height: number,
  opts: SolveBudget = {},
): CaptureStep[] | null {
  return new CaptureSolver(width, height).findSolution(board, opts).solution
}
