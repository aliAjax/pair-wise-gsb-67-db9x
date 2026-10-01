import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant, seedSignState } from '../data/seed'
import type {
  AcceptanceDefect, AcceptanceItem, ActionResult, AuditEntry, Certificate, EquipmentNode,
  ItemRevision, PartyReply, Side, SignState
} from '../types/domain'
import {
  auditEntry, buildChecks, checksumSnapshot, digest, effectiveRevision, evaluatePreflight,
  latestBySide, mergeRevisions, mergeStatus, invalidateDefectsByCert, replaceCertificate,
  signingStaleReasons, verifyAuditChain
} from '../services/chain'

const STORAGE_KEY = 'gsb67:grid-acceptance:v2'
let idSeed = 30

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>([...structuredClone(seedAudit)].sort((a, b) => b.seq - a.seq))
  const signState = ref<SignState>(structuredClone(seedSignState))
  const online = ref(true)
  const activeSide = ref<Side>('node')
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  const allItems = computed(() => equipment.value.flatMap((node) => node.items.map((item) => ({ node, item }))))
  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const lastSnapshot = computed(() => signState.value.snapshots.at(-1) ?? null)

  const conflictItems = computed(() => allItems.value.filter(({ item }) => mergeStatus(item) === 'conflict').map(({ item }) => item))

  const stats = computed(() => {
    let passed = 0, failed = 0, unchecked = 0
    for (const { item } of allItems.value) {
      const status = effectiveRevision(item)?.status
      if (status === '合格') passed++
      else if (status === '不合格' || status === '待复验') failed++
      else unchecked++
    }
    return {
      total: allItems.value.length,
      passed, failed, unchecked,
      conflicts: conflictItems.value.length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length,
      staleDefects: defects.value.filter((item) => ['已关闭', '带条件通过'].includes(item.status) && !item.valid).length
    }
  })

  const preflight = computed(() => evaluatePreflight(plant.value, equipment.value, defects.value, signState.value.record))
  const auditIntegrity = computed(() => verifyAuditChain(audit.value))

  function findItem(equipmentId: string, itemId: string) {
    return equipment.value.find((node) => node.id === equipmentId)?.items.find((item) => item.id === itemId)
  }

  function findCertificate(equipmentId: string, certId: string) {
    return equipment.value.find((node) => node.id === equipmentId)?.certificates.find((cert) => cert.id === certId)
  }

  function log(entityId: string, action: string, operator: string, detail: string) {
    const entry = auditEntry(audit.value[0] ?? null, {
      id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString()
    })
    audit.value.unshift(entry)
    return entry
  }

  /** 签署后的上游变化（证书换版/复测结论翻转）使已签署快照失效 */
  function refreshSigningStaleness() {
    const record = signState.value.record
    const snapshot = signState.value.snapshots.find((item) => item.id === record?.snapshotId)
    if (!record || record.stale || !snapshot) return
    const reasons = signingStaleReasons(snapshot, equipment.value, defects.value)
    if (reasons.length) {
      record.stale = true
      record.staleReasons = reasons
      snapshot.superseded = true
      if (plant.value.status === '已签署') plant.value.status = '待复核'
      log(plant.value.id, '签署快照失效', '系统', reasons.join('；') + '，待重新核对后重新签署')
    }
  }

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        plant.value = stored.plant
        equipment.value = stored.equipment
        defects.value = stored.defects
        audit.value = [...stored.audit].sort((a: AuditEntry, b: AuditEntry) => b.seq - a.seq)
        signState.value = stored.signState ?? structuredClone(seedSignState)
        online.value = stored.online ?? true
      }
    } catch {
      // 存储损坏时保留内置演示数据
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      plant: plant.value, equipment: equipment.value, defects: defects.value,
      audit: audit.value, signState: signState.value, online: online.value
    }))
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = [...structuredClone(seedAudit)].sort((a, b) => b.seq - a.seq)
    signState.value = structuredClone(seedSignState)
    online.value = true
    activeSide.value = 'node'
    persist()
  }

  /**
   * 追加一端实测记录：双端记录按时间并列保留，绝不互相覆盖。
   * 同一端再次提交只在该端产生新版本；若负责人已裁定而后到记录更新，裁定失效回到冲突。
   */
  function appendRevision(equipmentId: string, itemId: string, input: Omit<ItemRevision, 'sideVersion'> & { side?: Side }): ActionResult {
    const item = findItem(equipmentId, itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    const side: Side = input.side ?? activeSide.value
    if (!input.measured?.trim()) return { ok: false, message: '实测结果不能为空' }
    if (!input.recordedAt) return { ok: false, message: '实测时间不能为空' }
    const previous = latestBySide(item)[side]
    if (previous && input.recordedAt < previous.recordedAt) {
      return { ok: false, message: `实测时间早于该端已有记录（${previous.recordedAt.replace('T', ' ').slice(0, 16)}），按时间合并不能插补旧记录` }
    }
    item.revisions.push({
      side, status: input.status, measured: input.measured, evidence: input.evidence,
      recordedAt: input.recordedAt, recorder: input.recorder, sideVersion: (previous?.sideVersion ?? 0) + 1
    })
    item.revisions = mergeRevisions(item)
    item.version += 1
    if (item.winningSide && item.decidedAt && input.recordedAt > item.decidedAt) {
      item.winningSide = null
      item.decidedBy = ''
      item.decidedAt = null
      log(itemId, '裁定失效回到冲突', '系统', `${side === 'node' ? '设备节点' : '中心记录'}后到实测晚于裁定时间，需重新选定`)
    }
    const both = latestBySide(item)
    const action = both.node && both.center ? '双端记录按时间合并' : `${side === 'node' ? '设备节点' : '中心记录'}提交实测`
    log(itemId, action, input.recorder, `${input.status}｜${input.measured}｜${input.recordedAt.replace('T', ' ').slice(0, 16)}${online.value ? '' : '（断网期间离线记录）'}`)
    persist()
    return { ok: true, message: '实测已按时间并入复核链' }
  }

  /** 负责人在并列的双方实测中选定一份，选定后才参与完整性判定 */
  function decideItem(equipmentId: string, itemId: string, side: Side, by = '验收负责人陆川'): ActionResult {
    const item = findItem(equipmentId, itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    const revision = latestBySide(item)[side]
    if (!revision) return { ok: false, message: `${side === 'node' ? '设备节点' : '中心记录'}端没有实测记录，无法选定` }
    if (mergeStatus(item) !== 'conflict') return { ok: false, message: '仅在双端记录冲突时需要负责人选定' }
    item.winningSide = side
    item.decidedBy = by
    item.decidedAt = new Date().toISOString()
    item.version += 1
    log(itemId, '负责人裁定采纳', by, `采纳${side === 'node' ? '设备节点' : '中心记录'}实测：${revision.status}｜${revision.measured}`)
    persist()
    return { ok: true, message: `已选定${side === 'node' ? '设备节点' : '中心记录'}实测参与完整性判定` }
  }

  /** 证书换版：新版本默认待核验，并使绑定旧版本的缺陷快照与签署快照失效 */
  function replaceCert(equipmentId: string, certId: string, patch: Partial<Pick<Certificate, 'name' | 'issuer' | 'expiresAt'>>): ActionResult {
    const cert = findCertificate(equipmentId, certId)
    if (!cert) return { ok: false, message: '证书不存在' }
    const oldVersion = cert.version
    Object.assign(cert, replaceCertificate(cert, patch, new Date().toISOString()))
    const hit = invalidateDefectsByCert(defects.value, cert)
    log(certId, '证书换版', '验收负责人陆川', `V${oldVersion}→V${cert.version}，待重新核验；${hit}项缺陷快照联动失效`)
    refreshSigningStaleness()
    persist()
    return { ok: true, message: `证书已换版至V${cert.version}，待核验；关联缺陷与签署快照已失效` }
  }

  function verifyCert(equipmentId: string, certId: string, by = '验收负责人陆川'): ActionResult {
    const cert = findCertificate(equipmentId, certId)
    if (!cert) return { ok: false, message: '证书不存在' }
    if (cert.verified) return { ok: false, duplicate: true, message: '该版本证书已核验，重复核验不产生新版本' }
    cert.verified = true
    log(certId, '核验证书', by, `确认V${cert.version}《${cert.name}》核验通过`)
    persist()
    return { ok: true, message: `证书V${cert.version}已核验` }
  }

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    log(id, '分派缺陷', '验收负责人陆川', `责任方调整为${owner}`)
    persist()
    return { ok: true, message: '缺陷已分派' }
  }

  function addReply(id: string, reply: PartyReply): ActionResult {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    log(id, `${reply.party}提交处理说明`, reply.owner, reply.content)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  /** 登记复测轮次；复测结论相对上一轮一翻转，已闭环快照立即失效待重新核对 */
  function addRetest(id: string, result: string, passed: boolean): ActionResult {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!result.trim()) return { ok: false, message: '复测结果不能为空' }
    const round = defect.retests.reduce((max, item) => Math.max(max, item.round), 0) + 1
    defect.retests.unshift({ round, passed, result, tester: '联合验收组', testedAt: new Date().toISOString() })
    defect.status = passed ? '已关闭' : '整改中'
    defect.version += 1
    if (defect.retestConclusion !== null && defect.retestConclusion !== passed) {
      defect.valid = false
      const reason = `第${round}轮复测结论翻转为${passed ? '通过' : '未通过'}，原闭环快照失效，待重新核对`
      if (!defect.invalidReasons.includes(reason)) defect.invalidReasons.unshift(reason)
      log(id, '复测结论翻转', '联合验收组', reason)
    }
    defect.retestConclusion = passed
    log(id, '执行联合复验', '联合验收组', `第${round}轮：${passed ? '通过' : '未通过'}｜${result}`)
    refreshSigningStaleness()
    persist()
    return { ok: true, message: passed ? '复验通过，缺陷已关闭' : '复验未通过，返回整改' }
  }

  /** 验收决定：关闭/带条件接受时冻结当前证书版本到缺陷快照 */
  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string): ActionResult {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格复验记录，不能关闭' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    defect.status = status
    defect.decisionNote = note
    defect.version += 1
    if (status === '已关闭' || status === '带条件通过') {
      const node = equipment.value.find((item) => item.id === defect.equipmentId)
      defect.certRefs = (node?.certificates ?? []).map((cert) => ({
        certId: cert.id, certName: cert.name, version: cert.version, verified: cert.verified,
        expiresAt: cert.expiresAt, boundAt: new Date().toISOString()
      }))
      defect.valid = true
      defect.invalidReasons = []
      defect.checkedAt = new Date().toISOString()
      defect.checkedBy = '验收负责人陆川'
      log(id, `验收决定：${status}`, '验收负责人陆川', `${note || '完成整改闭环'}；已重新绑定${defect.certRefs.length}份证书版本快照`)
    } else {
      log(id, '验收决定：退回整改', '验收负责人陆川', note)
    }
    refreshSigningStaleness()
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  /** 失效缺陷重新核对：新版本证书已核验且未失效、结论未再翻转，核对通过即重新绑定快照 */
  function recheckDefect(id: string, by = '验收负责人陆川'): ActionResult {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.valid) return { ok: false, duplicate: true, message: '缺陷快照有效，无需重新核对' }
    const allCerts = equipment.value.flatMap((node) => node.certificates)
    const problems: string[] = []
    for (const ref of defect.certRefs) {
      const cert = allCerts.find((item) => item.id === ref.certId)
      if (!cert) problems.push(`证书《${ref.certName}》已不存在`)
      else {
        if (!cert.verified) problems.push(`《${cert.name}》V${cert.version}尚未核验`)
        if (cert.expiresAt < plant.value.commissioningDate) problems.push(`《${cert.name}》在并网日前失效`)
      }
    }
    if (!['已关闭', '带条件通过'].includes(defect.status)) problems.push('缺陷尚未闭环，不能核对闭环快照')
    if (problems.length) return { ok: false, message: `重新核对未通过：${problems.join('；')}` }
    // 核对通过：快照重新绑定到当前已核验的证书版本
    defect.certRefs = defect.certRefs.map((ref) => {
      const cert = allCerts.find((item) => item.id === ref.certId)!
      return { ...ref, version: cert.version, verified: cert.verified, expiresAt: cert.expiresAt, boundAt: new Date().toISOString() }
    })
    defect.valid = true
    defect.invalidReasons = []
    defect.checkedAt = new Date().toISOString()
    defect.checkedBy = by
    log(id, '缺陷快照重新核对', by, '新版本证书已核验、复测结论一致，快照重新绑定并恢复有效')
    persist()
    return { ok: true, message: '重新核对通过，缺陷快照已重新绑定并恢复有效' }
  }

  function auditHead() {
    const head = audit.value[0]
    return head ? { seq: head.seq, hash: head.hash } : { seq: 0, hash: 'GENESIS' }
  }

  /**
   * 签署：先冻结并落盘"完整快照"，再执行最终写入。
   * 完整性不通过、已签署、写入挂起/失败时均不产生新的签署版本。
   */
  function signOff(): ActionResult {
    if (signState.value.phase === 'writing') {
      return { ok: false, duplicate: true, message: '同一签署请求正在写入，重复提交不会生成第二个签署版本' }
    }
    if (signState.value.phase === 'failed') {
      return { ok: false, recoverable: true, snapshotId: signState.value.pendingSnapshotId ?? undefined, message: '上一笔签署写入失败：请按原请求重试，或从最后完整快照恢复' }
    }
    if (signState.value.record && !signState.value.record.stale) {
      return { ok: false, duplicate: true, snapshotId: signState.value.record.snapshotId, message: `交付版本V${signState.value.record.plantVersion}已签署锁定，重复提交不生成新版本` }
    }
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }

    const basePlantVersion = plant.value.version
    const basePlantStatus = plant.value.status
    const head = log(plant.value.id, '冻结签署完整快照', '验收负责人陆川', `验收项${equipment.value.reduce((n, node) => n + node.items.length, 0)}项、证书${equipment.value.reduce((n, node) => n + node.certificates.length, 0)}份、缺陷${defects.value.length}项`)
    const snapshotId = `SNAP-${Date.now()}-${idSeed++}`
    const token = `REQ-${Date.now()}-${idSeed++}`
    const snapshot = {
      id: snapshotId,
      capturedAt: new Date().toISOString(),
      capturedBy: '验收负责人陆川',
      plantVersion: basePlantVersion + 1,
      basePlantVersion,
      basePlantStatus,
      fingerprint: checksumSnapshot(equipment.value, defects.value, { seq: head.seq, hash: head.hash }),
      auditHead: { seq: head.seq, hash: head.hash },
      complete: true,
      superseded: false,
      checks: buildChecks(equipment.value, defects.value),
      state: JSON.parse(JSON.stringify({ plant: plant.value, equipment: equipment.value, defects: defects.value }))
    }
    signState.value.snapshots.push(snapshot)
    signState.value.pendingSnapshotId = snapshotId
    signState.value.pendingToken = token
    signState.value.phase = 'writing'
    persist() // 完整快照先行落盘——恢复的锚点

    return commitSigning(token)
  }

  /** 写入失败后按原请求重试：指纹未漂移才允许复用同一快照，绝不另起新版本 */
  function retryFailedSigning(): ActionResult {
    if (signState.value.phase !== 'failed' || !signState.value.pendingToken || !signState.value.pendingSnapshotId) {
      return { ok: false, message: '没有失败待重试的签署' }
    }
    const snapshot = signState.value.snapshots.find((item) => item.id === signState.value.pendingSnapshotId)
    if (!snapshot) return { ok: false, recoverable: true, message: '完整快照缺失，请从最后完整快照恢复' }
    const currentFingerprint = checksumSnapshot(equipment.value, defects.value, snapshot.auditHead)
    if (currentFingerprint !== snapshot.fingerprint) {
      return { ok: false, recoverable: true, snapshotId: snapshot.id, message: '失败后数据已变化，不能按原请求重试，请先从最后完整快照恢复' }
    }
    return commitSigning(signState.value.pendingToken)
  }

  function commitSigning(token: string): ActionResult {
    const snapshot = signState.value.snapshots.find((item) => item.id === signState.value.pendingSnapshotId)
    if (!snapshot || signState.value.pendingToken !== token) {
      return { ok: false, recoverable: true, message: '签署上下文丢失，请从最后完整快照恢复' }
    }
    // 模拟签署页最终写入（故障注入时失败：业务状态不前进，仅留下可恢复锚点）
    if (signState.value.failNextWrite) {
      signState.value.phase = 'failed'
      log(plant.value.id, '签署写入失败', '系统', `完整快照${snapshot.id}已落盘，业务状态保持V${snapshot.basePlantVersion}，待重试或恢复`)
      persist()
      return { ok: false, recoverable: true, snapshotId: snapshot.id, message: '签署写入失败：业务数据未改动，可按原请求重试或从最后完整快照恢复' }
    }
    plant.value.status = '已签署'
    plant.value.version = snapshot.plantVersion
    equipment.value.forEach((node) => { node.status = '已验收' })
    signState.value.record = {
      token,
      snapshotId: snapshot.id,
      plantVersion: snapshot.plantVersion,
      fingerprint: snapshot.fingerprint,
      signedAt: new Date().toISOString(),
      signedBy: '验收负责人陆川',
      stale: false,
      staleReasons: []
    }
    signState.value.phase = 'done'
    signState.value.pendingSnapshotId = null
    signState.value.pendingToken = null
    log(plant.value.id, '签署交付版本', '验收负责人陆川', `请求${token}锁定V${snapshot.plantVersion}并生成交付包（幂等令牌仅产生一个版本）`)
    persist()
    return { ok: true, snapshotId: snapshot.id, message: `签署完成，交付版本V${snapshot.plantVersion}已锁定` }
  }

  /** 从最后完整快照恢复：回滚冻结点业务状态，挂起请求作废，快照保留备查 */
  function recoverFromSnapshot(): ActionResult {
    const pendingId = signState.value.pendingSnapshotId
    const snapshot = signState.value.snapshots.find((item) => item.id === pendingId) ?? lastSnapshot.value
    if (!snapshot) return { ok: false, message: '没有可恢复的完整快照' }
    plant.value = JSON.parse(JSON.stringify(snapshot.state.plant))
    equipment.value = JSON.parse(JSON.stringify(snapshot.state.equipment))
    defects.value = JSON.parse(JSON.stringify(snapshot.state.defects))
    signState.value.phase = 'idle'
    signState.value.pendingSnapshotId = null
    signState.value.pendingToken = null
    log(plant.value.id, '从完整快照恢复', '系统', `已按快照${snapshot.id}回滚至V${snapshot.basePlantVersion}，可重新发起签署`)
    persist()
    return { ok: true, snapshotId: snapshot.id, message: `已从最后完整快照${snapshot.id}恢复，可重新签署` }
  }

  function setOnline(value: boolean) { online.value = value; persist() }
  function setActiveSide(side: Side) { activeSide.value = side; persist() }
  function setFailNextWrite(value: boolean) { signState.value.failNextWrite = value; persist() }

  return {
    plant, equipment, defects, audit, signState, online, activeSide, selectedEquipmentId, keyword, hydrated,
    selectedEquipment, lastSnapshot, conflictItems, stats, preflight, auditIntegrity,
    hydrate, persist, reset, log,
    appendRevision, decideItem, replaceCert, verifyCert,
    assignDefect, addReply, addRetest, decideDefect, recheckDefect,
    signOff, retryFailedSigning, recoverFromSnapshot, setOnline, setActiveSide, setFailNextWrite,
    mergeStatusFor: mergeStatus, effectiveFor: effectiveRevision, digest
  }
})
