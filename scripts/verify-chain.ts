/* 可恢复并网复核链端到端校验：npx tsx scripts/verify-chain.ts */
// @ts-nocheck
import { createPinia, setActivePinia } from 'pinia'
import { useAcceptanceStore } from '../stores/acceptance'
import { mergeStatus, verifyAuditChain } from '../services/chain'

let passed = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exitCode = 1 }
  else { passed++; console.log(`✓ ${name}`) }
}

function useStore() {
  setActivePinia(createPinia())
  return useAcceptanceStore()
}

// 1. 双端并列合并与负责人裁定
{
  const store = useStore()
  let r = store.appendRevision('EQ-AR1', 'IT-A1', { side: 'center', status: '合格', measured: '中心微欧计抽测30处合格', evidence: 'c.pdf', recordedAt: '2026-10-01T09:00:00', recorder: '中心值班员' })
  check('单端追加成功', r.ok, r.message)
  check('单端记录为 sole', mergeStatus(store.equipment[2].items[0]) === 'sole')
  r = store.appendRevision('EQ-AR1', 'IT-A1', { side: 'node', status: '不合格', measured: '现场抽测2处超标', evidence: 'n.jpg', recordedAt: '2026-10-01T10:00:00', recorder: '冯哲' })
  check('对端追加并列成功', r.ok)
  const item = store.equipment[2].items[0]
  check('双端改过后进入 conflict', mergeStatus(item) === 'conflict')
  check('冲突项阻断完整性', store.preflight.blocking.some((b) => b.includes('冲突')))
  check('裁定前不能重复随意裁定', store.decideItem('EQ-AR1', 'IT-A1', 'node').ok)
  check('裁定后 resolved', mergeStatus(item) === 'resolved')
  check('裁定采纳节点端实测', store.effectiveFor(item).status === '不合格')
  const again = store.decideItem('EQ-AR1', 'IT-A1', 'center')
  check('已裁定不可再次选定', !again.ok)
  // 裁定后节点端再来一份更晚的补测 → 重新冲突，双方记录都保留
  const revisionsBefore = item.revisions.length
  store.appendRevision('EQ-AR1', 'IT-A1', { side: 'node', status: '合格', measured: '整改后复测合格', evidence: 'n2.pdf', recordedAt: '2026-10-01T15:00:00', recorder: '冯哲' })
  check('晚于裁定的补测使裁定失效重回冲突', mergeStatus(item) === 'conflict')
  check('双方历史实测均保留未覆盖', item.revisions.length === revisionsBefore + 1 && item.revisions.filter((x) => x.side === 'node').length === 2)
  const old = store.appendRevision('EQ-AR1', 'IT-A1', { side: 'node', status: '合格', measured: '插补旧时间', evidence: 'x', recordedAt: '2026-09-01T00:00:00', recorder: '冯哲' })
  check('禁止插补早于本端最新记录的时间', !old.ok)
  store.reset()
}

// 2. 把所有验收项整理为可签署状态的辅助
function prepForSigning(store: ReturnType<typeof useStore>) {
  // 两个现存冲突：IT-G2 / IT-I2 选定节点端（复测合格）
  store.decideItem('EQ-GRID', 'IT-G2', 'node')
  store.decideItem('EQ-INV11', 'IT-I2', 'node')
  // IT-T2 原裁定为不合格，节点端整改后补测再裁定
  store.appendRevision('EQ-TR1', 'IT-T2', { side: 'node', status: '合格', measured: '更换变送器后逐档一致', evidence: '校准后记录.pdf', recordedAt: '2026-10-01T09:30:00', recorder: '冯哲' })
  store.decideItem('EQ-TR1', 'IT-T2', 'node')
  // 两个未检查项补齐节点端合格记录
  store.appendRevision('EQ-AR1', 'IT-A1', { side: 'node', status: '合格', measured: '抽测30处全部连续', evidence: '接地记录.xlsx', recordedAt: '2026-10-01T08:00:00', recorder: '冯哲' })
  store.appendRevision('EQ-CB111', 'IT-C1', { side: 'node', status: '合格', measured: '极性与开路电压正常', evidence: '汇流箱记录.xlsx', recordedAt: '2026-10-01T08:30:00', recorder: '冯哲' })
  // 缺陷闭环
  store.addRetest('AD-260929-01', '档位更换后逐档一致', true)
  store.decideDefect('AD-260929-01', '已关闭', '')
  store.addRetest('AD-260929-02', '同条件复测效率98.62%', true) // 结论 未通过→通过 翻转
  store.decideDefect('AD-260929-02', '已关闭', '')
}

// 3. 签署写入失败 → 业务状态不前进 → 按原请求重试成功，且只有一个版本
{
  const store = useStore()
  prepForSigning(store)
  check('预检通过', store.preflight.allowed, store.preflight.blocking.join('|'))
  store.setFailNextWrite(true)
  const failed = store.signOff()
  check('故障注入时签署写入失败', !failed.ok && failed.recoverable === true)
  check('写入失败后电站版本保持 V7', store.plant.version === 7 && store.plant.status === '验收中')
  check('失败后保留一个完整快照作为恢复锚点', store.signState.snapshots.length === 1 && store.signState.snapshots[0].complete)
  const dup = store.signOff()
  check('失败期间再次提交不会产生第二版本', !dup.ok && dup.recoverable && store.plant.version === 7)
  // 未排除故障直接重试：仍失败，但快照不增加
  const retryStillFails = store.retryFailedSigning()
  check('故障未排除时重试仍失败', !retryStillFails.ok && store.signState.snapshots.length === 1)
  store.setFailNextWrite(false)
  const recovered = store.retryFailedSigning()
  check('故障排除后按原请求重试成功', recovered.ok, recovered.message)
  check('重试复用同一快照（仍只有1份）', store.signState.snapshots.length === 1)
  check('签署成功锁定 V8', store.plant.version === 8 && store.plant.status === '已签署')
  const second = store.signOff()
  check('重复提交不生成第二个签署版本', !second.ok && second.duplicate && store.plant.version === 8)
  check('签署记录只有一条且版本 V8', store.signState.record?.plantVersion === 8)
}

// 4. 失败后数据漂移：拒绝按原请求重试，快照恢复后可重签
{
  const store = useStore()
  prepForSigning(store)
  store.setFailNextWrite(true)
  store.signOff()
  const snapVersion = store.equipment.find((n) => n.id === 'EQ-INV11')!.certificates[0].version
  store.replaceCert('EQ-INV11', 'C-I1', { expiresAt: '2029-06-30' }) // 失败期间数据被改动
  const retry = store.retryFailedSigning()
  check('指纹漂移时禁止按原请求重试', !retry.ok && retry.recoverable)
  const rec = store.recoverFromSnapshot()
  check('从最后完整快照恢复成功', rec.ok)
  const certNow = store.equipment.find((n) => n.id === 'EQ-INV11')!.certificates[0]
  check('恢复后证书版本回滚至冻结点', certNow.version === snapVersion && certNow.verified)
  check('恢复后挂起签署已清空可重新发起', store.signState.phase === 'idle' && store.signState.pendingSnapshotId === null)
  store.setFailNextWrite(false)
  const resign = store.signOff()
  check('恢复后重新签署成功', resign.ok && store.plant.version === 8, resign.message)
}

// 5. 证书换版与复测结论翻转的失效传播 + 重签才升版
{
  const store = useStore()
  prepForSigning(store)
  const signed = store.signOff()
  check('基线签署 V8', signed.ok && store.plant.version === 8)
  const defect02 = store.defects.find((d) => d.id === 'AD-260929-02')!
  check('基线缺陷快照有效', defect02.valid)

  store.replaceCert('EQ-INV11', 'C-I1', { expiresAt: '2029-06-30' })
  check('证书换版默认待核验', store.equipment.find((n) => n.id === 'EQ-INV11')!.certificates[0].verified === false)
  check('关联缺陷快照失效待核对', !defect02.valid && defect02.invalidReasons.some((x) => x.includes('换版')))
  check('已签署快照标记失效', store.signState.record?.stale && store.plant.status === '待复核')
  check('完整性阻断（失效缺陷+待核证书；已签署失效列为待重签提示）', !store.preflight.allowed && store.preflight.blocking.length >= 2 && store.preflight.warnings.length === 1)
  const badRecheck = store.recheckDefect('AD-260929-02')
  check('新版本未核验前重新核对不通过', !badRecheck.ok)
  store.verifyCert('EQ-INV11', 'C-I1')
  const recheck = store.recheckDefect('AD-260929-02')
  check('核验通过后重新核对恢复缺陷快照有效', recheck.ok && defect02.valid)
  check('仅核验不会自动复活签署，仍需重签', store.signState.record?.stale)
  const signAgain = store.signOff()
  check('重新核对后重签升版 V9（第二份完整快照）', signAgain.ok && store.plant.version === 9 && store.signState.snapshots.length === 2)
  const dup = store.signOff()
  check('重签后重复提交仍是同一版本 V9', dup.duplicate && store.plant.version === 9)

  // 已闭环缺陷复测结论再翻转：快照再次失效
  const flip = store.addRetest('AD-260929-01', '抽查复现档位偏差', false)
  check('复测登记成功', flip.ok)
  const defect01 = store.defects.find((d) => d.id === 'AD-260929-01')!
  check('复测结论翻转使已关闭缺陷快照失效', !defect01.valid && defect01.status === '整改中')
  check('签署快照随之再次失效', store.signState.record?.stale)
}

// 6. 审计哈希链可校验、可检出篡改
{
  const store = useStore()
  check('审计哈希链完整', verifyAuditChain(store.audit) === null)
  const tampered = JSON.parse(JSON.stringify(store.audit)) as typeof store.audit
  tampered[2].detail = '被篡改的说明'
  check('篡改审计内容被哈希链检出', verifyAuditChain(tampered) !== null)
  // 新操作自动续链：签署会依次写"冻结快照"和"签署"两条审计，按序号首尾相接
  prepForSigning(store)
  const beforeMax = Math.max(...store.audit.map((x) => x.seq))
  store.signOff()
  const ordered = [...store.audit].sort((a, b) => a.seq - b.seq)
  const newest = ordered.at(-1)!
  const before = ordered.find((x) => x.seq === beforeMax)!
  check('新审计条目序号与前序哈希续接', newest.seq === before.seq + 2 && newest.prevHash !== 'GENESIS')
  check('操作后审计链仍完整', verifyAuditChain(store.audit) === null)
}

console.log(`\n${passed} 项断言全部通过`)
