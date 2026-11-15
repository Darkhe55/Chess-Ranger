/**
 * 独棋题库生成器
 *
 * 思路：从「只剩 1 枚棋子」的终局开始反向拆解（uncapture）：
 *   - 当前盘面某枚棋子 P 在 cur；
 *   - 反向选一个空点 prev，让 P 从 cur 退回 prev；
 *   - 同时把一个任意类型棋子 Q 放到 cur（表示 P 刚才吃掉的是 Q）；
 *   - 反复 N-1 次，就得到一道「至少有一条解」的题面，反向步骤倒过来就是参考解。
 *
 * 生成后用求解器做唯一性审计（countSolutions 上限 2 条、带节点/时间预算），
 * 只保留「有解且唯一」的题，最后写入 src/game/puzzles-data.ts。
 *
 * 用法：node scripts/gen-puzzles.mjs
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { canCapture, countPieces } from '../src/game/rules.ts'
import { CaptureSolver } from '../src/game/solver.ts'
import { PIECE_TYPES, decodeSteps, encodeLayout } from '../src/game/types.ts'

/* ── 固定随机种子，保证可复现 ── */

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = mulberry32(20261115)
const randInt = (n) => Math.floor(rnd() * n)
const pick = (arr) => arr[randInt(arr.length)]

// 棋子出现权重：兵少一点、后/王也少一点，避免题目过于单调
const PIECE_POOL = [
  ...PIECE_TYPES,
  ...PIECE_TYPES,
  ...PIECE_TYPES,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  6,
]

/* ── 反向生成 ── */

/**
 * 尝试生成一道 w×h、共 pieces 枚棋子的题。
 * 成功返回 { layout, steps }（steps 为正向解的 origin/target 序列）。
 */
function buildOne(w, h, pieces) {
  const total = w * h
  const board = new Array(total).fill(0)
  const survivor = randInt(total)
  board[survivor] = pick(PIECE_POOL)
  const steps = []

  const occupied = () => {
    const out = []
    for (let i = 0; i < total; i++) if (board[i]) out.push(i)
    return out
  }

  for (let placed = 1; placed < pieces; placed++) {
    let done = false
    const current = occupied()
    for (let attempt = 0; attempt < 400 && !done; attempt++) {
      const cur = pick(current)
      const piece = board[cur]
      if (!piece) continue
      const prev = randInt(total)
      if (board[prev]) continue
      if (prev === cur) continue
      // prev 能否吃掉 cur？（把 P 放到 prev 上再判断，路径上不能有其它棋子）
      const trial = board.slice()
      trial[prev] = piece
      if (!canCapture(trial, w, h, prev, cur)) continue
      // 反向：P 退到 prev，cur 放一枚被吃的棋子 Q（类型任意）
      board[prev] = piece
      board[cur] = pick(PIECE_POOL)
      steps.unshift({ origin: prev, target: cur })
      done = true
    }
    if (!done) return null
  }

  return { layout: board, steps }
}

/* ── 正演校验 ── */

function replay(layout, w, h, steps) {
  const board = layout.slice()
  for (let i = 0; i < steps.length; i++) {
    const { origin, target } = steps[i]
    if (!board[origin] || !board[target]) return { ok: false, reason: `第 ${i + 1} 步吃空格` }
    if (!canCapture(board, w, h, origin, target)) {
      return { ok: false, reason: `第 ${i + 1} 步不是合法吃子` }
    }
    board[target] = board[origin]
    board[origin] = 0
  }
  if (countPieces(board) !== 1) return { ok: false, reason: '没有吃到只剩 1 枚' }
  return { ok: true, board }
}

/* ── 唯一性审计 ── */

function isUnique(layout, w, h, knownSteps) {
  const solver = new CaptureSolver(w, h)
  const out = solver.countSolutions(layout, 2, { maxNodes: 1_200_000, maxMillis: 8000 })
  if (out.timedOut) return { unique: false, reason: 'timeout', nodes: out.nodes }
  if (out.solutions.length !== 1) {
    return { unique: false, reason: `解不唯一（${out.solutions.length} 条）`, nodes: out.nodes }
  }
  // 求解器找到的解应该和生成时的解等价（至少步数一致）
  if (out.solutions[0].length !== knownSteps.length) {
    return { unique: false, reason: '解长度异常', nodes: out.nodes }
  }
  const steps = out.solutions[0].map((s) => ({ origin: s.origin, target: s.target }))
  const r = replay(layout, w, h, steps)
  if (!r.ok) return { unique: false, reason: `求解器解非法：${r.reason}`, nodes: out.nodes }
  return { unique: true, steps, nodes: out.nodes }
}

/* ── 出题规格 ── */

const SPECS = [
  { id: 'ranger-01', name: '四子小试', w: 4, h: 4, pieces: 4, difficulty: 'easy', series: '4×4 入门' },
  { id: 'ranger-02', name: '双象奇袭', w: 4, h: 4, pieces: 5, difficulty: 'easy', series: '4×4 入门' },
  { id: 'ranger-03', name: '马踏连营', w: 5, h: 5, pieces: 5, difficulty: 'easy', series: '5×5 进阶' },
  { id: 'ranger-04', name: '车行直道', w: 5, h: 5, pieces: 6, difficulty: 'medium', series: '5×5 进阶' },
  { id: 'ranger-05', name: '后王协奏', w: 6, h: 6, pieces: 6, difficulty: 'medium', series: '6×6 挑战' },
  { id: 'ranger-06', name: '斜线突进', w: 6, h: 6, pieces: 7, difficulty: 'medium', series: '6×6 挑战' },
  { id: 'ranger-07', name: '七子迷阵', w: 7, h: 7, pieces: 7, difficulty: 'hard', series: '7×7 专家' },
  { id: 'ranger-08', name: '八子终局', w: 8, h: 8, pieces: 8, difficulty: 'hard', series: '8×8 专家' },
]

const puzzles = []

for (const spec of SPECS) {
  let found = null
  let attempts = 0
  while (!found && attempts < 20000) {
    attempts++
    const made = buildOne(spec.w, spec.h, spec.pieces)
    if (!made) continue
    if (!replay(made.layout, spec.w, spec.h, made.steps).ok) continue
    const audit = isUnique(made.layout, spec.w, spec.h, made.steps)
    if (!audit.unique) continue
    found = { layout: made.layout, steps: audit.steps, nodes: audit.nodes, attempts }
  }
  if (!found) {
    console.error(`[gen] 生成失败：${spec.id}（${attempts} 次尝试）`)
    process.exitCode = 1
    break
  }
  const board = encodeLayout(found.layout)
  const solution = found.steps.map((s) => `${s.origin}-${s.target}`).join(';')
  if (decodeSteps(solution) === null) {
    console.error(`[gen] solution 编码异常：${spec.id}`)
    process.exitCode = 1
    break
  }
  puzzles.push({ ...spec, board, solution })
  console.log(
    `[gen] ${spec.id} ${spec.w}×${spec.h} ${spec.pieces} 枚 · 唯一解 · 搜索 ${found.nodes} 节点 · 尝试 ${attempts} 次`,
  )
}

if (process.exitCode) {
  console.error('[gen] 有题目生成失败，未写入文件。')
} else {
  const lines = []
  lines.push('/* 自动生成，勿手改。运行 npm run gen 重新生成。 */')
  lines.push('')
  lines.push('export interface RawPuzzle {')
  lines.push('  id: string')
  lines.push('  name: string')
  lines.push('  width: number')
  lines.push('  height: number')
  lines.push("  difficulty: 'easy' | 'medium' | 'hard' | 'custom'")
  lines.push('  series: string')
  lines.push('  /** 题面编码串：每格 1 个字符，0=空 1=兵 2=马 3=象 4=车 5=后 6=王 */')
  lines.push('  board: string')
  lines.push('  /** 参考解编码串：origin-target;origin-target（0 基索引） */')
  lines.push('  solution: string')
  lines.push('}')
  lines.push('')
  lines.push('export const RAW_PUZZLES: RawPuzzle[] = [')
  for (const p of puzzles) {
    lines.push(
      `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, width: ${p.w}, height: ${p.h}, difficulty: '${p.difficulty}', series: ${JSON.stringify(p.series)}, board: ${JSON.stringify(p.board)}, solution: ${JSON.stringify(p.solution)} },`,
    )
  }
  lines.push(']')
  lines.push('')
  const file = path.resolve('src/game/puzzles-data.ts')
  writeFileSync(file, lines.join('\n'), 'utf8')
  console.log(`[gen] 已写入 ${file}（${puzzles.length} 题）`)
}
