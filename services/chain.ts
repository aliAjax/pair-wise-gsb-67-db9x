import type {
  AcceptanceDefect, AcceptanceItem, AuditEntry, Certificate, EquipmentNode, InspectionStatus,
  ItemRevision, MergeStatus, Plant, Side, SignSnapshot, SnapshotChecks
} from '../types/domain'

/** FNV-1a 32位哈希：审计链与快照指纹用，断链/篡改可被检出 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function digest(value: unknown): string {
  return fnv1a(canonicalize(value))
}

/** 对象键排序后的稳定序列化，保证同内容同指纹 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
}

export const SIDE_LABEL: Record<Side, string> = { node: '设备节点', center: '中心记录' }

export function auditEntry(prev: AuditEntry | null, fields: Omit<AuditEntry, 'seq' | 'prevHash' | 'hash'>): AuditEntry {
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.hash : 'GENESIS'
  const entry = { seq, prevHash, ...fields } as AuditEntry
  entry.hash = fnv1a(`${seq}|${prevHash}|${fields.id}|${fields.entityId}|${fields.action}|${fields.operator}|${fields.detail}|${fields.createdAt}`)
  return entry
}

/** 从 genesis 逐条重算哈希链（存储为新到旧，校验前按序号升序），返回第一个断链点（全部通过返回 null） */
export function verifyAuditChain(list: AuditEntry[]): { seq: number; expected: string; actual: string } | null {
  const ordered = [...list].sort((a, b) => a.seq - b.seq)
  let prev: AuditEntry | null = null
  for (const entry of ordered) {
    const expectedSeq = prev ? prev.seq + 1 : 1
    const expectedPrev = prev ? prev.hash : 'GENESIS'
    const expectedHash = fnv1a(`${entry.seq}|${entry.prevHash}|${entry.id}|${entry.entityId}|${entry.action}|${entry.operator}|${entry.detail}|${entry.createdAt}`)
    if (entry.seq !== expectedSeq || entry.prevHash !== expectedPrev || entry.hash !== expectedHash) {
      return { seq: entry.seq, expected: expectedHash, actual: entry.hash }
    }
    prev = entry
  }
  return null
}

/** 两端记录按实测时间并列（时间相同节点端在前），不做任何覆盖 */
export function mergeRevisions(item: Pick<AcceptanceItem, 'revisions'>): ItemRevision[] {
  return [...item.revisions].sort((a, b) =>
    a.recordedAt === b.recordedAt ? (a.side === b.side ? 0 : a.side === 'node' ? -1 : 1) : a.recordedAt.localeCompare(b.recordedAt)
  )
}

export function latestBySide(item: Pick<AcceptanceItem, 'revisions'>): Record<Side, ItemRevision | undefined> {
  const bySide = (side: Side) => mergeRevisions(item).filter((revision) => revision.side === side).at(-1)
  return { node: bySide('node'), center: bySide('center') }
}

export function mergeStatus(item: AcceptanceItem): MergeStatus {
  const { node, center } = latestBySide(item)
  if (!node && !center) return 'empty'
  if (!node || !center) return 'sole'
  if (item.winningSide && (item.winningSide === 'node' || item.winningSide === 'center')) return 'resolved'
  return 'conflict'
}

export function effectiveRevision(item: AcceptanceItem): ItemRevision | null {
  const { node, center } = latestBySide(item)
  if (item.winningSide) {
    return item.winningSide === 'node' ? node ?? center ?? null : center ?? node ?? null
  }
  // 单端记录直接生效；两端并列待裁定时不参与完整性判定
  return node ?? center ?? null
}

export function effectiveStatus(item: AcceptanceItem): InspectionStatus | null {
  return effectiveRevision(item)?.status ?? null
}

/** 裁定后又有任一端补测（比裁定时间更新），裁定失效回到冲突 */
export function decisionStale(item: AcceptanceItem): boolean {
  if (!item.winningSide || !item.decidedAt) return false
  const latest = mergeRevisions(item).at(-1)
  return !!latest && latest.recordedAt > item.decidedAt
}

export function replaceCertificate(certificate: Certificate, patch: Partial<Pick<Certificate, 'name' | 'issuer' | 'expiresAt'>>, at: string): Certificate {
  return { ...certificate, ...patch, version: certificate.version + 1, verified: false, replacedAt: at }
}

/** 证书换版后，引用旧版本的缺陷快照失效待核对 */
export function invalidateDefectsByCert(defects: AcceptanceDefect[], cert: Certificate): number {
  let count = 0
  for (const defect of defects) {
    const refs = defect.certRefs.filter((ref) => ref.certId === cert.id)
    const changed = refs.filter((ref) => ref.version !== cert.version)
    if (changed.length) {
      defect.valid = false
      for (const ref of changed) {
        const reason = `证书《${ref.certName}》换版V${cert.version}，绑定V${ref.version}失效，待重新核对`
        if (!defect.invalidReasons.includes(reason)) defect.invalidReasons.unshift(reason)
      }
      count++
    }
  }
  return count
}

export function checksumSnapshot(equipment: EquipmentNode[], defects: AcceptanceDefect[], auditHead: { seq: number; hash: string }): string {
  const checks = buildChecks(equipment, defects)
  return fnv1a(`${canonicalize(checks)}|${auditHead.seq}|${auditHead.hash}`)
}

export function buildChecks(equipment: EquipmentNode[], defects: AcceptanceDefect[]): SnapshotChecks {
  const items: SnapshotChecks['items'] = []
  const certificates: SnapshotChecks['certificates'] = []
  for (const node of equipment) {
    for (const item of node.items) {
      const revision = effectiveRevision(item)
      items.push({
        id: item.id, equipmentId: node.id,
        status: revision?.status ?? '待检查',
        measured: revision?.measured ?? '', evidence: revision?.evidence ?? '',
        side: revision?.side ?? 'node', sideVersion: revision?.sideVersion ?? 0,
        recordedAt: revision?.recordedAt ?? ''
      })
    }
    for (const certificate of node.certificates) {
      certificates.push({ id: certificate.id, equipmentId: node.id, version: certificate.version, verified: certificate.verified, expiresAt: certificate.expiresAt })
    }
  }
  return {
    items, certificates,
    defects: defects.map((defect) => ({
      id: defect.id, version: defect.version, status: defect.status, valid: defect.valid,
      retestConclusion: defect.retestConclusion,
      certRefs: defect.certRefs.map((ref) => ({ certId: ref.certId, version: ref.version }))
    }))
  }
}

export interface PreflightResult {
  allowed: boolean
  blocking: string[]
  /** 不阻断重签，但提示已签署版本已被上游变化作废、需要重签 */
  warnings: string[]
  conflicts: AcceptanceItem[]
  staleDefects: AcceptanceDefect[]
  invalidCerts: Certificate[]
  expiredCerts: Certificate[]
}

export function evaluatePreflight(plant: Plant, equipment: EquipmentNode[], defects: AcceptanceDefect[], signRecord: { stale: boolean } | null): PreflightResult {
  const blocking: string[] = []
  const conflicts: AcceptanceItem[] = []
  let hasUnchecked = false
  let hasFailed = false
  for (const node of equipment) {
    for (const item of node.items) {
      if (mergeStatus(item) === 'conflict' || decisionStale(item)) conflicts.push(item)
      const status = effectiveStatus(item)
      if (status === '待检查' || status === null) hasUnchecked = true
      if (status === '不合格' || status === '待复验') hasFailed = true
    }
  }
  if (conflicts.length) blocking.push(`存在${conflicts.length}项设备节点与中心双端冲突，待负责人裁定`)
  if (hasUnchecked) blocking.push('仍有验收项未检查')
  if (hasFailed) blocking.push('存在不合格或待复验项')

  const open = defects.filter((item) => !['已关闭', '带条件通过'].includes(item.status))
  if (open.length) blocking.push('存在未闭环缺陷')
  const staleDefects = defects.filter((item) => ['已关闭', '带条件通过'].includes(item.status) && !item.valid)
  if (staleDefects.length) blocking.push(`存在${staleDefects.length}项缺陷快照因证书换版或复测结论变化失效，待重新核对`)

  const allCerts = equipment.flatMap((node) => node.certificates.map((cert) => ({ cert, node })))
  const invalidCerts = allCerts.filter(({ cert }) => !cert.verified).map(({ cert }) => cert)
  if (invalidCerts.length) blocking.push('存在未核验/换版待核证书')
  const expiredCerts = allCerts.filter(({ cert }) => cert.expiresAt < plant.commissioningDate).map(({ cert }) => cert)
  if (expiredCerts.length) blocking.push('证书在并网日期前失效')

  const warnings: string[] = []
  if (signRecord?.stale) warnings.push('已签署版本已失效：上游证书或复测结论变化，核对通过后请重新签署')

  return { allowed: blocking.length === 0, blocking, warnings, conflicts, staleDefects, invalidCerts, expiredCerts }
}

/** 签署记录与当前数据对不上时判定失效（换版/复测结论一变） */
export function signingStaleReasons(snapshot: SignSnapshot, equipment: EquipmentNode[], defects: AcceptanceDefect[]): string[] {
  const reasons: string[] = []
  const current = checksumSnapshot(equipment, defects, snapshot.auditHead)
  if (current !== snapshot.fingerprint) {
    const now = buildChecks(equipment, defects)
    for (const currentCert of now.certificates) {
      const snapCert = snapshot.checks.certificates.find((item) => item.id === currentCert.id)
      if (snapCert && (snapCert.version !== currentCert.version || snapCert.verified !== currentCert.verified)) {
        reasons.push(`证书 ${currentCert.id} 由V${snapCert.version}换版/核验状态变化为V${currentCert.version}`)
      }
    }
    for (const currentDefect of now.defects) {
      const snapDefect = snapshot.checks.defects.find((item) => item.id === currentDefect.id)
      if (snapDefect && snapDefect.retestConclusion !== currentDefect.retestConclusion) {
        reasons.push(`缺陷 ${currentDefect.id} 复测结论由${snapDefect.retestConclusion ? '通过' : '未通过'}变为${currentDefect.retestConclusion ? '通过' : '未通过'}`)
      }
      if (snapDefect && snapDefect.valid !== currentDefect.valid) {
        reasons.push(`缺陷 ${currentDefect.id} 闭环快照失效待重新核对`)
      }
    }
    if (!reasons.length) reasons.push('签署后验收数据发生变化')
  }
  return reasons
}
