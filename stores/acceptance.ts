import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant } from '../data/seed'
import type {
  AcceptanceDefect,
  AcceptanceItem,
  AuditEntry,
  Certificate,
  CertificateRevision,
  EquipmentNode,
  InspectionStatus,
  ItemRevision,
  PartyReply,
  Plant,
  ReplicaSource,
  SignSnapshot
} from '../types/domain'
import { buildCompleteness, effectiveRevision, hashAudit, latestRevision, snapshotPayloadHash, verifyAuditChain } from '../utils/acceptance'

const STORAGE_KEY = 'gsb67:grid-acceptance:v2'
const WAL_KEY = 'gsb67:pending-sign:v2'
const SIGNER = '验收负责人陆川'
let idSeed = 30

/** 深拷贝纯数据；不能对 Vue 响应式代理使用 structuredClone（会抛 DataCloneError） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type LogFields = Pick<AuditEntry, 'entityId' | 'action' | 'operator' | 'detail' | 'refType' | 'refId'>

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const snapshots = ref<SignSnapshot[]>([])
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)
  const recoveryNotice = ref('')
  const lastMergeAt = ref<string | null>(null)

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const chainValid = computed(() => verifyAuditChain(audit.value))
  const validSnapshot = computed(() => snapshots.value.find((item) => item.state === '有效') ?? null)
  const pendingRecovery = computed(() => validSnapshot.value === null && readWal() !== null)

  const stats = computed(() => {
    const entries = equipment.value.flatMap((node) => node.items.map((item) => ({ node, item })))
    return {
      total: entries.length,
      passed: entries.filter(({ item }) => effectiveRevision(item)?.status === '合格').length,
      failed: entries.filter(({ item }) => ['不合格', '待复验'].includes(effectiveRevision(item)?.status ?? '')).length,
      conflicts: entries.filter(({ item }) => item.conflict).length,
      unresolved: entries.filter(({ item }) => !item.conflict && !effectiveRevision(item)).length,
      staleDefects: defects.value.filter((item) => item.stale).length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length
    }
  })

  const preflight = computed(() => buildCompleteness(plant.value, equipment.value, defects.value))

  // ---------- 持久化与恢复 ----------

  function hasStorage() {
  return typeof globalThis !== 'undefined' && Boolean((globalThis as { localStorage?: Storage }).localStorage)
}

function persistMain() {
    if (!hasStorage()) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      plant: plant.value, equipment: equipment.value, defects: defects.value, audit: audit.value, snapshots: snapshots.value
    }))
  }

  /** 预写签署WAL：最后完整快照先落盘，再提交主数据，主数据写入失败可据此恢复 */
  function persistWal(snapshot: SignSnapshot) {
    if (!hasStorage()) return
    localStorage.setItem(WAL_KEY, JSON.stringify(snapshot))
  }

  function clearWal() {
    if (hasStorage()) localStorage.removeItem(WAL_KEY)
  }

  function readWal(): SignSnapshot | null {
    if (!hasStorage()) return null
    const raw = localStorage.getItem(WAL_KEY)
    return raw ? JSON.parse(raw) as SignSnapshot : null
  }

  function hydrate() {
    if (!hasStorage() || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        plant.value = stored.plant
        equipment.value = stored.equipment
        defects.value = stored.defects
        audit.value = stored.audit
        snapshots.value = stored.snapshots ?? []
      }
    } catch {
      // 主数据损坏时保留种子数据，签署恢复仍可从WAL进行
    }
    const wal = readWal()
    if (wal) {
      const result = recoverSign('系统')
      if (result.ok) recoveryNotice.value = `检测到未完成的签署写入，已从最后完整快照 ${result.snapshot!.id} 恢复`
    }
    hydrated.value = true
  }

  function appendLog(fields: LogFields): AuditEntry {
    const prevHash = audit.value[0]?.hash ?? ''
    const base = {
      id: `AUD-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${idSeed++}`,
      createdAt: new Date().toISOString(),
      prevHash,
      ...fields
    }
    const entry: AuditEntry = { ...base, hash: hashAudit(base) }
    audit.value.unshift(entry)
    return entry
  }

  // ---------- 设备节点 / 验收项：断网复测、回连合并、负责人选定 ----------

  function findItem(equipmentId: string, itemId: string) {
    const node = equipment.value.find((value) => value.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    return { node, item }
  }

  /** 按合并基准重算冲突：两端实测时间都晚于最近合并点即为两端并改 */
  function recomputeConflict(item: AcceptanceItem) {
    const bothChanged = Boolean(
      item.mergedAt && item.center && item.node &&
      item.center.recordedAt > item.mergedAt && item.node.recordedAt > item.mergedAt
    )
    if (bothChanged && !item.conflict) {
      item.conflict = true
      // 出现新的两端并改，原选定作废，选定后才重新参与完整性判定
      item.resolvedSource = null
      item.resolvedBy = ''
      item.resolvedAt = ''
    } else if (!bothChanged) {
      item.conflict = false
      // 选定基准之后任一端又产生新实测，原选定作废，须由负责人重新选定
      if (item.resolvedAt && ((item.center?.recordedAt ?? '') > item.resolvedAt || (item.node?.recordedAt ?? '') > item.resolvedAt)) {
        item.resolvedSource = null
        item.resolvedBy = ''
        item.resolvedAt = ''
      }
    }
  }

  /** 设备节点或中心录入实测；每端版本独立递增，双方实测并列保留 */
  function recordItemRevision(
    equipmentId: string,
    itemId: string,
    source: ReplicaSource,
    patch: { status: InspectionStatus; measured: string; evidence: string; condition: string; author: string }
  ) {
    const { item } = findItem(equipmentId, itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    const current: ItemRevision | null = source === 'center' ? item.center : item.node
    const revision: ItemRevision = {
      source,
      status: patch.status,
      measured: patch.measured,
      evidence: patch.evidence,
      condition: patch.condition,
      recordedAt: new Date().toISOString(),
      version: (current?.version ?? 0) + 1,
      author: patch.author
    }
    if (source === 'center') item.center = revision
    else item.node = revision
    recomputeConflict(item)
    appendLog({
      entityId: itemId, action: source === 'node' ? '设备节点复测录入' : '中心记录更新', operator: patch.author,
      detail: `${source === 'node' ? '本机' : '中心'} V${revision.version}：${patch.status} / ${patch.measured || '无实测'}${item.conflict ? '；两端并改形成冲突，待负责人选定' : ''}`,
      refType: 'item', refId: itemId
    })
    invalidateSnapshots(`验收项 ${itemId} ${source === 'node' ? '设备节点复测' : '中心记录'}更新`, patch.author)
    persistMain()
    return { ok: true as const, conflict: item.conflict }
  }

  /** 负责人在两端实测中选定一份，选定后该验收项才参与完整性判定 */
  function resolveItem(equipmentId: string, itemId: string, source: ReplicaSource, operator = SIGNER) {
    const { item } = findItem(equipmentId, itemId)
    if (!item) return { ok: false, message: '验收项不存在' }
    if (source === 'center' && !item.center) return { ok: false, message: '中心尚无实测记录可选' }
    if (source === 'node' && !item.node) return { ok: false, message: '设备节点尚无实测记录可选' }
    item.resolvedSource = source
    item.resolvedBy = operator
    item.resolvedAt = new Date().toISOString()
    item.mergedAt = new Date().toISOString()
    item.conflict = false
    appendLog({
      entityId: itemId, action: '负责人选定实测版本', operator,
      detail: `选定${source === 'center' ? '中心' : '设备节点本机'} V${(source === 'center' ? item.center : item.node)!.version} 实测，双方记录并列留存`,
      refType: 'item', refId: itemId
    })
    persistMain()
    return { ok: true as const }
  }

  /** 回连时按时间合并：非两端并改项推进合并基准；并改项保持冲突并列，等待负责人选定 */
  function reconnectMerge(operator = '现场验收员韩磊') {
    const now = new Date().toISOString()
    const conflicts: string[] = []
    const synced: string[] = []
    equipment.value.forEach((node) => node.items.forEach((item) => {
      recomputeConflict(item)
      if (item.conflict) {
        conflicts.push(`${node.code}/${item.id}`)
      } else {
        item.mergedAt = now
        synced.push(`${node.code}/${item.id}`)
      }
    }))
    lastMergeAt.value = now
    appendLog({
      entityId: plant.value.id, action: '断网复测回连合并', operator,
      detail: `按实测时间合并 ${synced.length} 项；${conflicts.length ? `两端并改 ${conflicts.join('、')} 并列保留待选定` : '无两端并改冲突'}`,
      refType: 'plant', refId: plant.value.id
    })
    persistMain()
    return { ok: true as const, conflicts, synced: synced.length, mergedAt: now }
  }

  // ---------- 证书：换版联动缺陷与签署快照失效 ----------

  function findCertificate(equipmentId: string, certificateId: string) {
    const node = equipment.value.find((value) => value.id === equipmentId)
    const certificate = node?.certificates.find((value) => value.id === certificateId)
    return { node, certificate }
  }

  function replaceCertificate(
    equipmentId: string,
    certificateId: string,
    patch: { issuer: string; expiresAt: string; verified: boolean; note: string; by: string }
  ) {
    const { node, certificate } = findCertificate(equipmentId, certificateId)
    if (!node || !certificate) return { ok: false, message: '证书不存在' }
    const previous = latestRevision(certificate)
    const revision: CertificateRevision = {
      version: previous.version + 1,
      issuer: patch.issuer,
      expiresAt: patch.expiresAt,
      verified: patch.verified,
      note: patch.note,
      changedAt: new Date().toISOString(),
      changedBy: patch.by
    }
    certificate.history.push(revision)
    const linked = defects.value.filter((defect) => defect.equipmentId === node.id)
    linked.forEach((defect) => markStale(defect, `关联证书 ${certificate.name} 换版 V${previous.version}→V${revision.version}，原核对结论失效`))
    appendLog({
      entityId: certificateId, action: '证书换版登记', operator: patch.by,
      detail: `${certificate.name} V${previous.version}→V${revision.version}（${patch.verified ? '已核验' : '待核验'}，有效期至${patch.expiresAt}）；${linked.length}项关联缺陷与有效签署快照随即失效`,
      refType: 'certificate', refId: certificateId
    })
    invalidateSnapshots(`证书 ${certificate.name} 换版至 V${revision.version}`, patch.by)
    persistMain()
    return { ok: true as const }
  }

  function setCertificateVerified(equipmentId: string, certificateId: string, verified: boolean, by = SIGNER) {
    const { certificate } = findCertificate(equipmentId, certificateId)
    if (!certificate) return
    const current = latestRevision(certificate)
    current.verified = verified
    appendLog({
      entityId: certificateId, action: verified ? '证书核验通过' : '证书核验退回', operator: by,
      detail: `${certificate.name} V${current.version} 标记为${verified ? '已核验' : '待核验'}`,
      refType: 'certificate', refId: certificateId
    })
    persistMain()
  }

  // ---------- 缺陷：处理、复测结论变化、重新核对、负责人决定 ----------

  function markStale(defect: AcceptanceDefect, reason: string) {
    const now = new Date().toISOString()
    const reasons = defect.staleReason ? defect.staleReason.split('；') : []
    reasons.unshift(reason)
    defect.stale = true
    defect.staleReason = Array.from(new Set(reasons)).slice(0, 4).join('；')
    if (!defect.staleSince) defect.staleSince = now
  }

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    appendLog({ entityId: id, action: '分派缺陷', operator: SIGNER, detail: `责任方调整为${owner}`, refType: 'defect', refId: id })
    persistMain()
  }

  function addReply(id: string, reply: PartyReply) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    appendLog({ entityId: id, action: `${reply.party}提交处理说明`, operator: reply.owner, detail: reply.content, refType: 'defect', refId: id })
    invalidateSnapshots(`缺陷 ${id} 处理状态更新`, reply.owner)
    persistMain()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  /** 登记复测轮次；复测结论（通过/不通过）一变，缺陷与签署快照立即失效，待重新核对 */
  function addRetest(id: string, result: string, passed: boolean) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !result.trim()) return { ok: false, message: '复验结果不能为空' }
    const round = (defect.retests[0]?.round ?? 0) + 1
    const previous = defect.retests[0] ?? null
    const conclusionChanged = previous ? previous.passed !== passed : false
    defect.retests.unshift({ round, passed, result, tester: '联合验收组', testedAt: new Date().toISOString() })
    defect.status = passed ? '已关闭' : '整改中'
    defect.version += 1
    if (conclusionChanged) {
      markStale(defect, `第${round}轮复测结论由"${previous!.passed ? '通过' : '不通过'}"变为"${passed ? '通过' : '不通过'}"，原核对结论失效`)
      appendLog({
        entityId: id, action: '复测结论变化', operator: '联合验收组',
        detail: `第${round}轮复测${passed ? '通过' : '未通过'}，结论翻转；缺陷与有效签署快照随即失效，待重新核对`,
        refType: 'defect', refId: id
      })
      invalidateSnapshots(`缺陷 ${id} 第${round}轮复测结论变化`, '联合验收组')
    } else {
      appendLog({ entityId: id, action: '执行联合复验', operator: '联合验收组', detail: `第${round}轮复测${passed ? '通过' : '未通过'}：${result}`, refType: 'defect', refId: id })
      invalidateSnapshots(`缺陷 ${id} 复测轮次更新`, '联合验收组')
    }
    persistMain()
    return { ok: true as const, conclusionChanged }
  }

  /** 负责人按换版证书/最新复测结论重新核对缺陷，核对后缺陷才重新参与完整性判定 */
  function recheckDefect(id: string, note: string, operator = SIGNER) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!defect.stale) return { ok: false, message: '该缺陷没有待核对的失效标记' }
    if (!note.trim()) return { ok: false, message: '重新核对必须填写核对意见' }
    defect.stale = false
    defect.staleReason = ''
    defect.staleSince = ''
    defect.recheckNote = note
    defect.recheckedBy = operator
    defect.recheckedAt = new Date().toISOString()
    defect.version += 1
    appendLog({ entityId: id, action: '缺陷重新核对', operator, detail: note, refType: 'defect', refId: id })
    persistMain()
    return { ok: true, message: '已按最新证书与复测结论完成重新核对' }
  }

  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.stale) return { ok: false, message: '证书换版或复测结论已变化，请先重新核对再作决定' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格复验记录，不能关闭' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    defect.status = status
    defect.decisionNote = note
    defect.version += 1
    appendLog({ entityId: id, action: `验收决定：${status}`, operator: SIGNER, detail: note || '完成整改闭环', refType: 'defect', refId: id })
    invalidateSnapshots(`缺陷 ${id} 验收决定更新`, SIGNER)
    persistMain()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  // ---------- 签署快照：失效、幂等签署、写入恢复 ----------

  function invalidateSnapshots(reason: string, _operator: string) {
    const now = new Date().toISOString()
    snapshots.value.forEach((snapshot) => {
      if (snapshot.state === '有效') {
        snapshot.state = '已失效'
        snapshot.invalidatedReason = reason
        snapshot.invalidatedAt = now
      }
    })
    if (snapshots.value.some((snapshot) => snapshot.state === '已失效' && snapshot.invalidatedReason === reason) && plant.value.status === '已签署') {
      plant.value.status = '待复核'
    }
  }

  function buildSnapshot(idempotencyKey: string): SignSnapshot {
    const signVersion = plant.value.version + 1
    const signedPlant: Plant = { ...clone(plant.value), status: '已签署', version: signVersion }
    const signedEquipment = clone(equipment.value)
    signedEquipment.forEach((node) => { node.status = '已验收' })
    const signedDefects = clone(defects.value)
    const signEntry = appendLog({
      entityId: plant.value.id, action: '签署交付版本', operator: SIGNER,
      detail: `锁定V${signVersion} 并生成交付包（完整性全部通过）`, refType: 'sign', refId: plant.value.id
    })
    const signedAudit = clone(audit.value)
    const payload = { plant: signedPlant, equipment: signedEquipment, defects: signedDefects, audit: signedAudit }
    const completeness = buildCompleteness(signedPlant, signedEquipment, signedDefects)
    return {
      id: `SG-V${signVersion}-${signEntry.id.slice(-6)}`,
      signVersion,
      idempotencyKey,
      state: '有效',
      invalidatedReason: '',
      invalidatedAt: '',
      signedBy: SIGNER,
      signedAt: signEntry.createdAt,
      contentHash: snapshotPayloadHash({ plant: signedPlant, equipment: signedEquipment, defects: signedDefects }),
      completeness,
      payload
    }
  }

  /**
   * 签署：
   * - 同一幂等键重复提交只返回同一份快照；任意时刻至多一份有效签署版本；
   * - 完整快照先写WAL再提交主数据，主数据写入失败可从WAL恢复。
   */
  function signOff(idempotencyKey: string, simulateWriteFailure = false) {
    const existingForKey = snapshots.value.find((snapshot) => snapshot.idempotencyKey === idempotencyKey)
    if (existingForKey) {
      return existingForKey.state === '有效'
        ? { ok: true as const, duplicated: true, snapshot: existingForKey, message: '重复提交已拦截，沿用上一签署版本' }
        : { ok: false as const, message: '该提交对应的签署快照已失效，请重新核对后发起新签署' }
    }
    const liveValid = snapshots.value.find((snapshot) => snapshot.state === '有效')
    if (liveValid) {
      return { ok: true as const, duplicated: true, snapshot: liveValid, message: '已存在有效签署版本，重复提交不生成第二版' }
    }
    if (!preflight.value.allowed) return { ok: false as const, message: preflight.value.blocking.join('；') }

    const snapshot = buildSnapshot(idempotencyKey)
    snapshots.value.unshift(snapshot)
    Object.assign(plant.value, snapshot.payload.plant)
    equipment.value = snapshot.payload.equipment
    defects.value = snapshot.payload.defects
    audit.value = snapshot.payload.audit

    persistWal(snapshot)
    if (simulateWriteFailure) {
      appendLog({
        entityId: snapshot.id, action: '签署写入失败', operator: '系统',
        detail: '主数据写入未确认，最后完整快照已留存于恢复日志，等待恢复', refType: 'sign', refId: snapshot.id
      })
      return { ok: false as const, pendingRecovery: true as const, snapshot, message: '签署写入失败：可从最后完整快照恢复' }
    }
    try {
      persistMain()
      clearWal()
      return { ok: true as const, duplicated: false, snapshot, message: '签署完成，交付版本已锁定' }
    } catch (error) {
      return { ok: false as const, pendingRecovery: true as const, snapshot, message: `签署写入异常：${String(error)}，可从最后完整快照恢复` }
    }
  }

  /** 从WAL中的最后完整快照恢复；哈希不符则中止并保留现场 */
  function recoverSign(operator = SIGNER) {
    const snapshot = readWal()
    if (!snapshot) return { ok: false as const, message: '没有待恢复的签署写入' }
    const recomputed = snapshotPayloadHash({
      plant: snapshot.payload.plant,
      equipment: snapshot.payload.equipment,
      defects: snapshot.payload.defects
    })
    if (recomputed !== snapshot.contentHash) {
      appendLog({
        entityId: snapshot.id, action: '签署恢复中止', operator,
        detail: '最后完整快照指纹校验失败，数据可能损坏，未覆盖当前记录', refType: 'sign', refId: snapshot.id
      })
      persistMain()
      return { ok: false as const, message: '快照指纹校验失败，恢复中止' }
    }
    if (!snapshots.value.some((item) => item.id === snapshot.id)) snapshots.value.unshift(clone(snapshot))
    plant.value = clone(snapshot.payload.plant)
    equipment.value = clone(snapshot.payload.equipment)
    defects.value = clone(snapshot.payload.defects)
    audit.value = clone(snapshot.payload.audit)
    appendLog({
      entityId: snapshot.id, action: '签署写入恢复', operator,
      detail: `依据最后完整快照 ${snapshot.id}（V${snapshot.signVersion}）恢复全部记录`, refType: 'sign', refId: snapshot.id
    })
    persistMain()
    clearWal()
    recoveryNotice.value = `已从最后完整快照 ${snapshot.id} 恢复签署 V${snapshot.signVersion}`
    return { ok: true as const, snapshot, message: recoveryNotice.value }
  }

  function dismissRecoveryNotice() {
    recoveryNotice.value = ''
  }

  function reset() {
    plant.value = clone(seedPlant)
    equipment.value = clone(seedEquipment)
    defects.value = clone(seedDefects)
    audit.value = clone(seedAudit)
    snapshots.value = []
    lastMergeAt.value = null
    recoveryNotice.value = ''
    clearWal()
    persistMain()
  }

  return {
    plant, equipment, defects, audit, snapshots, selectedEquipmentId, keyword, hydrated, recoveryNotice, lastMergeAt,
    selectedEquipment, stats, preflight, chainValid, validSnapshot, pendingRecovery,
    hydrate, reset,
    recordItemRevision, resolveItem, reconnectMerge,
    replaceCertificate, setCertificateVerified,
    assignDefect, addReply, addRetest, recheckDefect, decideDefect,
    signOff, recoverSign, dismissRecoveryNotice
  }
})
