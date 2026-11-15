/**
 * 独棋 —— 浏览器端验证（Playwright + Edge）
 *
 * 用法：先开开发服务器（npm run dev / npm start），再 `node scripts/verify-game.mjs`。
 * 端口读 package.json 的 puzzle.port（5218）；可用 EDGE_PATH 覆盖浏览器路径。
 *
 * 覆盖：
 *   1. 内置题：数量、参考解合法、逻辑回放计划可生成；
 *   2. 鼠标：点选棋子 → 点目标吃子；非法走法提示；撤销 / 重做；
 *   3. 键盘：方向键移动光标、回车选中 / 吃子、Esc 取消；
 *   4. 提示一步 / 显示解 / 逻辑解题回放；
 *   5. 自定义题板：放置棋子 → 载入 → 求解 → 保存到题库 → 编辑 → 两步删除。
 */

import fs from 'node:fs'
import { chromium } from 'playwright-core'
import { PORT } from './_port.mjs'

const executablePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT_DIR = 'output/playwright'
fs.mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`)
})

let failures = 0
function check(cond, label, detail = '') {
  if (cond) console.log(`PASS  ${label}`)
  else {
    failures++
    console.error(`FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** 读出棋盘格中心在页面上的点击坐标（考虑 viewBox / CSS 缩放） */
async function cellPoint(index) {
  const info = await page.evaluate((idx) => {
    const g = window.__game
    const s = g.getSession()
    const m = g.adapter.metricsFor(s.puzzle)
    const svg = document.querySelector('svg.board-svg')
    const rect = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    const cell = m.cellW ?? m.cell
    const cellX = (m.originX ?? m.pad) + (idx % s.puzzle.width) * cell + cell / 2
    const cellY = (m.originY ?? m.pad) + Math.floor(idx / s.puzzle.width) * cell + cell / 2
    return {
      x: rect.x + ((cellX - vb.x) / vb.width) * rect.width,
      y: rect.y + ((cellY - vb.y) / vb.height) * rect.height,
    }
  }, index)
  return info
}

async function clickCell(index) {
  const pt = await cellPoint(index)
  await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(70)
}

async function state() {
  return page.evaluate(() => {
    const s = window.__game.getSession()
    return {
      pieces: s.state.board.filter(Boolean).length,
      history: s.state.history.length,
      selected: s.state.selected,
      cursor: s.state.cursor,
      w: s.puzzle.width,
      status: document.querySelector('#status')?.textContent ?? '',
    }
  })
}

async function firstMove() {
  return page.evaluate(() => {
    const g = window.__game
    const s = g.getSession()
    const move = g.adapter.firstHintMove(s.state, null)
    if (!move || !move.meta) return null
    return { origin: move.meta.origin, target: move.meta.target }
  })
}

async function moveCursorTo(target) {
  const w = await page.evaluate(() => window.__game.getSession().puzzle.width)
  for (let guard = 0; guard < 80; guard++) {
    const cur = (await state()).cursor
    if (cur === target) return
    if (cur < 0) {
      await page.keyboard.press('ArrowRight')
    } else {
      const cx = cur % w
      const cy = Math.floor(cur / w)
      const tx = target % w
      const ty = Math.floor(target / w)
      if (cx < tx) await page.keyboard.press('ArrowRight')
      else if (cx > tx) await page.keyboard.press('ArrowLeft')
      else if (cy < ty) await page.keyboard.press('ArrowDown')
      else await page.keyboard.press('ArrowUp')
    }
    await page.waitForTimeout(18)
  }
  throw new Error(`键盘光标无法移动到 ${target}`)
}

async function selectBuiltin(index) {
  await page.evaluate((i) => {
    const g = window.__game
    g.selectPuzzle(g.adapter.builtinPuzzles[i])
  }, index)
  await page.waitForTimeout(90)
}

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('svg.board-svg', { timeout: 20000 })
await page.waitForTimeout(200)
await page.screenshot({ path: `${OUT_DIR}/01-builtin.png`, fullPage: true })

/* —— 1. 题库 / 参考解 / 逻辑计划 —— */
const bank = await page.evaluate(() => {
  const a = window.__game.adapter
  return a.builtinPuzzles.map((p) => {
    const sol = a.getReferenceSolution(p.id)
    const result = sol ? a.validate(sol, p) : null
    const plan = a.planLogicSolve(p, a.createEmptyState(p))
    return {
      id: p.id,
      name: p.name,
      solved: !!result?.solved,
      pieces: (p.layout || []).filter(Boolean).length,
      frames: plan.frames.length,
      saturated: plan.saturated,
    }
  })
})
check(bank.length >= 6, `内置题至少 6 道（实际 ${bank.length} 道）`)
for (const b of bank) {
  check(b.solved, `参考解通过校验：${b.id} ${b.name}`)
  check(b.frames === b.pieces - 1, `逻辑回放帧数 = 吃子步数：${b.id}（${b.frames} 帧）`)
}

/* —— 2. 鼠标：选中 → 吃子 —— */
await selectBuiltin(0)
await page.click('#btn-clear')
await page.waitForTimeout(100)
const s0 = await state()
const m1 = await firstMove()
check(!!m1, 'firstHintMove 给出第一步吃子')
await clickCell(m1.origin)
const selected = await state()
check(selected.selected === m1.origin, '鼠标点击选中棋子')
await page.screenshot({ path: `${OUT_DIR}/02-mouse-select.png`, fullPage: true })
await clickCell(m1.target)
const afterMouse = await state()
check(afterMouse.pieces === s0.pieces - 1, '鼠标点击目标完成吃子')
check(afterMouse.history === 1, '吃子写入历史（可撤销）')
check(afterMouse.status.includes('吃子成功'), '吃子后有状态栏反馈')
await page.screenshot({ path: `${OUT_DIR}/03-mouse-captured.png`, fullPage: true })

/* —— 撤销 / 重做 —— */
await page.click('#btn-undo')
await page.waitForTimeout(80)
check((await state()).pieces === s0.pieces, '撤销恢复盘面')
await page.click('#btn-redo')
await page.waitForTimeout(80)
check((await state()).pieces === s0.pieces - 1, '重做再次吃子')

/* —— 非法走法提示 —— */
await page.click('#btn-clear')
await page.waitForTimeout(100)
const illegal = await page.evaluate(() => {
  const s = window.__game.getSession()
  const piece = s.state.board.findIndex((v) => v > 0)
  const empty = s.state.board.findIndex((v) => v === 0)
  return { piece, empty }
})
await clickCell(illegal.piece)
await clickCell(illegal.empty)
const illegalState = await state()
check(illegalState.status.includes('非法走法'), '点空格给出非法走法提示')
await page.screenshot({ path: `${OUT_DIR}/04-illegal.png`, fullPage: true })

/* —— 3. 键盘：方向键 + 回车 —— */
await page.click('#btn-clear')
await page.waitForTimeout(100)
await page.keyboard.press('Escape')
const m2 = await firstMove()
check(!!m2, '键盘测试：拿到第一步吃子')
await moveCursorTo(m2.origin)
await page.keyboard.press('Enter')
const kSel = await state()
check(kSel.selected === m2.origin, '方向键移动光标 + 回车选中棋子')
await moveCursorTo(m2.target)
await page.keyboard.press('Enter')
const kAfter = await state()
check(kAfter.pieces === s0.pieces - 1, '回车在目标格完成吃子')
check(kAfter.status.includes('吃子成功'), '键盘吃子有状态栏反馈')
await page.screenshot({ path: `${OUT_DIR}/05-keyboard.png`, fullPage: true })
await page.keyboard.press('Escape')
check((await state()).selected === -1, 'Esc 取消选中')

/* —— 4. 提示一步 / 显示解 / 逻辑回放 —— */
await page.click('#btn-clear')
await page.waitForTimeout(80)
await page.click('#btn-hint')
await page.waitForTimeout(120)
check((await state()).history === 1, '提示一步自动走一步合法吃子')
await page.click('#btn-clear')
await page.waitForTimeout(80)
await page.click('#btn-solve')
await page.waitForTimeout(200)
const solved = await page.evaluate(() => {
  const s = window.__game.getSession()
  return window.__game.adapter.validate(s.state, s.puzzle).solved
})
check(solved, '显示解得到只剩一枚棋子的终局')
await page.screenshot({ path: `${OUT_DIR}/06-solved.png`, fullPage: true })

await selectBuiltin(0)
await page.click('#btn-clear')
await page.waitForTimeout(100)
await page.click('#btn-logic')
await page.waitForFunction(
  () => {
    const btn = document.querySelector('#btn-logic')
    return btn && !btn.disabled && btn.textContent === '逻辑解题'
  },
  { timeout: 180000 },
)
await page.waitForTimeout(300)
const logic = await page.evaluate(() => {
  const s = window.__game.getSession()
  const result = window.__game.adapter.validate(s.state, s.puzzle)
  return {
    solved: result.solved,
    history: s.state.history.length,
    status: document.querySelector('#status')?.textContent ?? '',
  }
})
check(logic.solved, '逻辑解题回放完成后盘面只剩一枚棋子')
check(logic.history >= 1, '逻辑解题回放实际执行了吃子步（非空回放）')
check(logic.status.includes('逻辑解题完成'), '逻辑回放结束有完成提示', logic.status)
await page.screenshot({ path: `${OUT_DIR}/07-logic-playback.png`, fullPage: true })

/* —— 5. 自定义题板 —— */
await page.click('#btn-custom')
await page.waitForTimeout(100)
await page.fill('#custom-w', '4')
await page.fill('#custom-h', '4')
await page.click('#custom-regen')
await page.waitForTimeout(100)
const clickCustom = async (i, times) => {
  for (let k = 0; k < times; k++) {
    await page.locator('.custom-cell').nth(i).click()
    await page.waitForTimeout(30)
  }
}
// 参考布局：12=车，8/4/0=兵（车沿 a 列向上连吃三兵，唯一解）
await clickCustom(12, 4)
await clickCustom(8, 1)
await clickCustom(4, 1)
await clickCustom(0, 1)
const placed = await page.evaluate(
  () => [...document.querySelectorAll('.custom-cell')].filter((b) => b.textContent.trim()).length,
)
check(placed === 4, '自定义题板放置 4 枚棋子（车 + 3 兵）')
await page.screenshot({ path: `${OUT_DIR}/08-custom-editor.png`, fullPage: true })

await page.click('#custom-apply')
await page.waitForTimeout(150)
const customSession = await page.evaluate(() => {
  const s = window.__game.getSession()
  return {
    w: s.puzzle.width,
    h: s.puzzle.height,
    pieces: s.state.board.filter(Boolean).length,
    id: s.puzzle.id,
    board: s.state.board,
  }
})
check(customSession.w === 4 && customSession.h === 4, '自定义题板载入 4×4')
check(customSession.pieces === 4, '自定义题板载入 4 枚棋子')

await page.click('#custom-solve')
await page.waitForTimeout(250)
const customSolved = await page.evaluate(() => {
  const s = window.__game.getSession()
  const r = window.__game.adapter.validate(s.state, s.puzzle)
  return { solved: r.solved, pieces: r.pieces, msg: document.querySelector('.custom-msg')?.textContent ?? '' }
})
check(customSolved.solved && customSolved.pieces === 1, '自定义题板求解成功（只剩 1 枚）')
await page.screenshot({ path: `${OUT_DIR}/09-custom-solved.png`, fullPage: true })

await page.click('#custom-save')
await page.waitForTimeout(120)
await page.click('#custom-close')
await page.waitForTimeout(150)
const customRow = page.locator('.puzzle-row', { hasText: '自定义' }).first()
check((await customRow.count()) > 0, '自定义题已保存进题库列表')
await page.screenshot({ path: `${OUT_DIR}/10-library.png`, fullPage: true })

// 编辑
await customRow.locator('[data-edit]').click()
await page.waitForTimeout(150)
const editState = await page.evaluate(() => {
  const panel = document.getElementById('custom-editor')
  const cells = [...document.querySelectorAll('.custom-cell')]
  return {
    open: !!panel && !panel.hidden,
    filled: cells.filter((b) => b.textContent.trim()).length,
    glyphs: cells.map((b) => b.textContent.trim()),
  }
})
check(editState.open && editState.filled === 4, '编辑自定义题：题面正确回填（4 枚棋子）')
await page.screenshot({ path: `${OUT_DIR}/11-custom-edit.png`, fullPage: true })
await page.click('#custom-close')
await page.waitForTimeout(100)

// 两步确认删除
const row = page.locator('.puzzle-row', { hasText: '自定义' }).first()
await row.locator('[data-del]').click()
await page.waitForTimeout(120)
const confirmBtn = page.locator('.puzzle-row', { hasText: '自定义' }).first().locator('.puzzle-act.confirm')
check((await confirmBtn.count()) === 1, '删除需要二次确认')
await confirmBtn.click()
await page.waitForTimeout(200)
const gone = await page.locator('.puzzle-row', { hasText: '自定义' }).count()
check(gone === 0, '两次确认后自定义题已从题库删除')
await page.screenshot({ path: `${OUT_DIR}/12-after-delete.png`, fullPage: true })

/* —— 汇总 —— */
const title = await page.title()
check(title.includes('独棋'), `页面标题包含「独棋」（${title}）`)
check(pageErrors.length === 0, '无页面脚本错误', pageErrors.join(' | '))
if (pageErrors.length) console.error(pageErrors)

console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}；截图目录 ${OUT_DIR}/`)
await browser.close()
if (failures > 0 || pageErrors.length > 0) process.exitCode = 1
