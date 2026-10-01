import type {
  AcceptanceDefect,
  AcceptanceItem,
  AuditEntry,
  Certificate,
  CompletenessSnapshot,
  EquipmentNode,
  ItemRevision,
  Plant,
  ReplicaSource
} from '../types/domain'

/** FNV-1a 64位哈希，输出16进制；SSR/浏览器均可同步运行，用于审计链与快照指纹 */
export function fnvHash(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** 稳定序列化：对象键排序后再哈希，避免键序影响指纹 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

export function hashAudit(entry: Omit<AuditEntry, 'hash'>): string {
  const { prevHash, hash: _hash, ...rest } = entry as AuditEntry
  return fnvHash(canonical({ ...rest, prevHash }))
}

/** 审计按最新在前存储：数组末尾为链头（创世条目），逐条向前校验 */
export function verifyAuditChain(entries: AuditEntry[]): boolean {
  let prevHash = ''
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.prevHash !== prevHash) return false
    if (hashAudit(entry) !== entry.hash) return false
    prevHash = entry.hash
  }
  return true
}

export function latestRevision(certificate: Certificate) {
  return certificate.history[certificate.history.length - 1]
}

export function revisionOf(item: AcceptanceItem, source: ReplicaSource): ItemRevision | null {
  return source === 'center' ? item.center : item.node
}

/**
 * 参与完整性判定的实测版本：
 * - 两端合并后均改动（冲突）时不参与，等待负责人选定；
 * - 负责人选定后以选定版本参与；
 * - 仅一端有记录时以该端参与。
 */
export function effectiveRevision(item: AcceptanceItem): ItemRevision | null {
  if (item.conflict || !item.resolvedSource) {
    if (!item.resolvedSource && !item.conflict) {
      const only = [item.center, item.node].filter((rev): rev is ItemRevision => Boolean(rev))
      return only.length === 1 ? only[0] : null
    }
    return null
  }
  return revisionOf(item, item.resolvedSource)
}

export function isConflict(item: AcceptanceItem): boolean {
  return Boolean(item.mergedAt && item.center && item.node && item.center.recordedAt > item.mergedAt! && item.node.recordedAt > item.mergedAt!)
}

export function buildCompleteness(plant: Plant, equipment: EquipmentNode[], defects: AcceptanceDefect[]): CompletenessSnapshot {
  const items = equipment.flatMap((node) => node.items.map((item) => ({ node, item })))
  const certificates = equipment.flatMap((node) => node.certificates.map((certificate) => ({ node, certificate })))
  let passed = 0
  let failed = 0
  let conflicts = 0
  const blocking: string[] = []

  for (const { node, item } of items) {
    if (isConflict(item)) {
      conflicts += 1
      continue
    }
    const rev = effectiveRevision(item)
    if (!rev) continue
    if (rev.status === '合格') passed += 1
    if (rev.status === '不合格' || rev.status === '待复验') failed += 1
    if (rev.status === '待检查') blocking.push(`验收项 ${node.code}/${item.id} 尚未检查`)
  }

  const unselected = items.filter(({ item }) => !isConflict(item) && !effectiveRevision(item)).length
  if (conflicts > 0) blocking.push(`有 ${conflicts} 项验收项两端记录均已改动，待负责人选定实测版本`)
  if (unselected > 0) blocking.push(`有 ${unselected} 项验收项尚未选定实测版本，选定后才参与完整性判定`)
  items.forEach(({ node, item }) => {
    const rev = effectiveRevision(item)
    if (rev && (rev.status === '不合格' || rev.status === '待复验')) blocking.push(`验收项 ${node.code}/${item.id} 状态为${rev.status}`)
  })

  const openDefects = defects.filter((defect) => !['已关闭', '带条件通过'].includes(defect.status)).length
  const staleDefects = defects.filter((defect) => defect.stale).length
  if (openDefects > 0) blocking.push(`有 ${openDefects} 项缺陷未闭环`)
  if (staleDefects > 0) blocking.push(`有 ${staleDefects} 项缺陷因证书换版或复测结论变化待重新核对`)

  const unverifiedCertificates = certificates.filter(({ certificate }) => !latestRevision(certificate).verified).length
  if (unverifiedCertificates > 0) blocking.push(`有 ${unverifiedCertificates} 份证书未通过核验`)
  const expired = certificates.filter(({ certificate }) => latestRevision(certificate).expiresAt < plant.commissioningDate)
  expired.forEach(({ node, certificate }) => blocking.push(`证书 ${node.code}/${certificate.name} 在并网日期前失效`))

  return {
    total: items.length,
    passed,
    failed,
    conflicts,
    openDefects,
    staleDefects,
    unverifiedCertificates,
    expiredCertificates: expired.length,
    allowed: blocking.length === 0,
    blocking
  }
}

export function snapshotPayloadHash(payload: { plant: Plant; equipment: EquipmentNode[]; defects: AcceptanceDefect[] }): string {
  return fnvHash(canonical(payload))
}
