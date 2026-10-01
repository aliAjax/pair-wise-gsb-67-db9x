// 临时端到端逻辑校验：node --import tsx 运行，不进 git
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { useAcceptanceStore } from '../stores/acceptance'
import { effectiveRevision, verifyAuditChain } from '../utils/acceptance'

const memory = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k)
  }
})

const pinia = createPinia()
const app = createApp({})
app.use(pinia)
setActivePinia(pinia)

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!cond) failures++
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const store = useAcceptanceStore()

// 1. 种子：IT-T2 两端并改冲突
const t2 = store.equipment.find((n) => n.id === 'EQ-TR1')!.items.find((i) => i.id === 'IT-T2')!
check('种子冲突项 IT-T2 标记为两端并改', t2.conflict === true)
check('冲突项未选定前不参与完整性判定（有效实测为空）', effectiveRevision(t2) === null)
check('初始完整性不通过且包含冲突阻断', !store.preflight.allowed && store.preflight.blocking.some((b) => b.includes('两端记录均已改动')))

// 2. 负责人选定节点实测后参与判定
const resolved = store.resolveItem('EQ-TR1', 'IT-T2', 'node')
check('选定设备节点实测成功', resolved.ok)
check('选定后冲突解除且参与判定', !t2.conflict && t2.resolvedSource === 'node')

// 3. 选定后被选定一侧再改 -> 选定作废
await sleep(2)
store.recordItemRevision('EQ-TR1', 'IT-T2', 'node', { status: '合格', measured: '再次复测8/8档', evidence: 'x.pdf', condition: '空载', author: '韩磊' })
check('选定侧再产生新实测后选定作废（须重选）', t2.resolvedSource === null && !t2.conflict)
store.resolveItem('EQ-TR1', 'IT-T2', 'node')

// 4. 回连合并：仅一端改不冲突，两端都改才冲突
store.resolveItem('EQ-TR1', 'IT-T2', 'node')
store.reconnectMerge()
check('干净合并后无冲突', t2.conflict === false)
await sleep(2)
store.recordItemRevision('EQ-TR1', 'IT-T2', 'node', { status: '合格', measured: '节点单侧再测', evidence: 'n.pdf', condition: '空载', author: '韩磊' })
check('仅设备节点一端改不构成两端并改', t2.conflict === false)
check('单端新实测也使原选定作废、须重选', t2.resolvedSource === null)
store.resolveItem('EQ-TR1', 'IT-T2', 'node')
store.reconnectMerge()
await sleep(2)
store.recordItemRevision('EQ-TR1', 'IT-T2', 'node', { status: '合格', measured: '节点断网复测', evidence: 'n.pdf', condition: '空载', author: '韩磊' })
await sleep(2)
store.recordItemRevision('EQ-TR1', 'IT-T2', 'center', { status: '不合格', measured: '中心同步后改判', evidence: 'c.pdf', condition: '空载', author: '孙倩' })
check('合并后两端都改 -> 并列冲突', t2.conflict === true && effectiveRevision(t2) === null)
store.resolveItem('EQ-TR1', 'IT-T2', 'node')
check('负责人选定后冲突解除', t2.conflict === false && t2.resolvedSource === 'node')
check('全部操作后审计哈希链完整', verifyAuditChain(store.audit))

// 5. 证书换版 -> 同设备缺陷失效 + 签署快照失效
const certRes = store.replaceCertificate('EQ-INV11', 'C-I1', { issuer: '中国电科院', expiresAt: '2029-06-30', verified: true, note: '第三次换版', by: '韩磊' })
check('证书换版成功', certRes.ok)
const d02 = store.defects.find((d) => d.id === 'AD-260929-02')!
check('换版后同设备缺陷标记待重新核对', d02.stale === true)
const blocked = store.decideDefect('AD-260929-02', '已关闭', 'x')
check('失效期间禁止验收决定', !blocked.ok)
const rechecked = store.recheckDefect('AD-260929-02', '已核对V3证书，结论维持关闭')
check('重新核对通过', rechecked.ok && !d02.stale)

// 6. 复测结论翻转 -> 缺陷失效
const d01 = store.defects.find((d) => d.id === 'AD-260929-01')!
const r1 = store.addRetest('AD-260929-01', '首次复测通过', true)
check('首次复测（无历史）不判翻转', r1.ok && r1.conclusionChanged === false)
const r2 = store.addRetest('AD-260929-01', '二次复测不通过', false)
check('复测结论通过->不通过触发失效', r2.conclusionChanged === true && d01.stale === true)
const r3 = store.addRetest('AD-260929-01', '三次复测恢复通过', true)
check('复测结论不通过->通过再次触发失效', r3.conclusionChanged === true && d01.stale === true)
store.recheckDefect('AD-260929-01', '已按最新复测核对')
// 补齐缺陷关闭前置：有合格复测
const decide01 = store.decideDefect('AD-260929-01', '已关闭', '复测达标关闭')
check('重核后可关闭缺陷', decide01.ok && d01.status === '已关闭')

// 7. 待检查/未核证书项补齐到可签署
for (const node of store.equipment) {
  for (const item of node.items) {
    if (!item.center) {
      store.recordItemRevision(node.id, item.id, 'center', { status: '合格', measured: '中心补录合格', evidence: 'c.pdf', condition: '常温', author: '孙倩' })
    }
    const cur = item.center!.status
    if (cur !== '合格') {
      store.recordItemRevision(node.id, item.id, 'center', { status: '合格', measured: '中心确认合格', evidence: 'c.pdf', condition: '常温', author: '孙倩' })
    }
    if (!item.resolvedSource) store.resolveItem(node.id, item.id, 'center')
  }
}
check('所有缺陷重核后无 stale', store.defects.every((d) => !d.stale))
check('补齐后完整性通过', store.preflight.allowed, store.preflight.blocking.join('；'))

// 8. 幂等签署
const key = 'submit-test-0001'
const s1 = store.signOff(key)
check('首次签署成功并生成有效快照', s1.ok && !(s1 as any).duplicated && s1.snapshot!.state === '有效')
const version1 = s1.snapshot!.signVersion
const s2 = store.signOff(key)
check('同一幂等键重复提交返回同一快照、无第二版', s2.ok && (s2 as any).duplicated === true && s2.snapshot!.id === s1.snapshot!.id)
check('有效签署版本仍为 V' + version1, store.validSnapshot?.signVersion === version1 && store.snapshots.filter((s) => s.state === '有效').length === 1)
check('签署后电站状态=已签署 V' + version1, store.plant.status === '已签署' && store.plant.version === version1)
check('WAL 已清理', memory.has('gsb67:pending-sign:v2') === false)

// 9. 换版使有效快照失效
store.replaceCertificate('EQ-GRID', 'C-G1', { issuer: '省电科院', expiresAt: '2030-01-01', verified: true, note: '保护报告换版', by: '韩磊' })
check('换版后有效签署快照转失效', s1.snapshot!.state === '已失效' && store.validSnapshot === null)
check('快照失效后电站回到待复核', store.plant.status === '待复核')
const dGrid = store.defects.filter((d) => d.equipmentId === 'EQ-GRID')
const d02Again = store.defects.find((d) => d.id === 'AD-260929-02')!
check('证书换版仅失效同设备节点缺陷（逆变器缺陷不被并网点证书牵连）', dGrid.length === 0 && !d02Again.stale)

// 10. 写入失败 -> WAL 留存 -> 恢复
// C-G1 换版后无缺陷变 stale（并网点无缺陷），数据仍完整，可发起新签署
check('换版后当前数据仍满足完整性', store.preflight.allowed, store.preflight.blocking.join('；'))

const sf = store.signOff('submit-test-fail', true)
check('模拟写入失败返回 pendingRecovery', !sf.ok && (sf as any).pendingRecovery === true)
check('WAL 留存最后完整快照', memory.has('gsb67:pending-sign:v2'))
// 破坏主数据（模拟主数据写入了一半）
memory.set('gsb67:grid-acceptance:v2', '{corrupt')
const recovered = store.recoverSign()
check('从最后完整快照恢复成功', recovered.ok)
check('恢复后电站版本为失败那次签署版本', store.plant.status === '已签署' && store.plant.version === sf.snapshot!.signVersion)
check('恢复后 WAL 已清理', !memory.has('gsb67:pending-sign:v2'))
check('恢复后内容指纹一致（快照未被篡改）', sf.snapshot!.contentHash === recovered.snapshot!.contentHash)

// 11. 恢复后重复提交同一失败键不产生第二版
const sf2 = store.signOff('submit-test-fail')
check('失败键恢复后重复提交复用同一快照', sf2.ok && (sf2 as any).duplicated === true && sf2.snapshot!.id === sf.snapshot!.id)

// 12. 全流程审计哈希链可校验
check('审计哈希链最终完整', verifyAuditChain(store.audit))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
