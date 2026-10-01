export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'
/** 数据来源：中心记录 / 设备节点本机记录 */
export type ReplicaSource = 'center' | 'node'
export type SnapshotState = '有效' | '已失效'

/** 验收项在某一端（中心或设备节点）的实测记录版本 */
export interface ItemRevision {
  source: ReplicaSource
  status: InspectionStatus
  measured: string
  evidence: string
  condition: string
  /** 实测记录时间，回连合并按该时间并列比对 */
  recordedAt: string
  /** 该端的版本号，每端独立递增 */
  version: number
  author: string
}

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  /** 中心记录；断网期间未回写则为 null */
  center: ItemRevision | null
  /** 设备节点本机记录 */
  node: ItemRevision | null
  /** 最近一次回连合并时间，用于判定两端是否都在合并后改动 */
  mergedAt: string | null
  /** 两端记录是否在合并后均发生改动（冲突），冲突时并列保留、不参与完整性判定 */
  conflict: boolean
  /** 负责人选定的实测来源；未选定或冲突未解时为 null */
  resolvedSource: ReplicaSource | null
  resolvedBy: string
  resolvedAt: string
}

export interface CertificateRevision {
  version: number
  issuer: string
  expiresAt: string
  verified: boolean
  note: string
  changedAt: string
  changedBy: string
}

export interface Certificate {
  id: string
  name: string
  /** 换版历史，按版本升序；最后一项为当前有效版本 */
  history: CertificateRevision[]
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收'
  items: AcceptanceItem[]
  certificates: Certificate[]
}

export interface PartyReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
}

export interface Retest {
  round: number
  passed: boolean
  result: string
  tester: string
  testedAt: string
}

export interface AcceptanceDefect {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  status: DefectStatus
  owner: string
  dueDate: string
  replies: PartyReply[]
  retests: Retest[]
  decisionNote: string
  version: number
  /** 证书换版或复测结论变化后置为 true，签署与完整性判定均要求重新核对 */
  stale: boolean
  staleReason: string
  staleSince: string
  recheckNote: string
  recheckedBy: string
  recheckedAt: string
}

export interface Plant {
  id: string
  name: string
  gridPoint: string
  capacity: string
  commissioningDate: string
  status: '验收中' | '待复核' | '已签署'
  version: number
}

/** 完整性判定快照（签署时逐项冻结） */
export interface CompletenessSnapshot {
  total: number
  passed: number
  failed: number
  conflicts: number
  openDefects: number
  staleDefects: number
  unverifiedCertificates: number
  expiredCertificates: number
  allowed: boolean
  blocking: string[]
}

export interface SignSnapshot {
  id: string
  /** 签署对应的电站业务版本，从最后完整快照恢复时不产生新版本 */
  signVersion: number
  /** 幂等键：同一签署动作重复提交只返回同一快照，不生成第二版 */
  idempotencyKey: string
  state: SnapshotState
  invalidatedReason: string
  invalidatedAt: string
  signedBy: string
  signedAt: string
  contentHash: string
  completeness: CompletenessSnapshot
  payload: {
    plant: Plant
    equipment: EquipmentNode[]
    defects: AcceptanceDefect[]
    audit: AuditEntry[]
  }
}

/** 审计条目以 prevHash/hash 串成可校验的复核链 */
export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 关联实体类型，便于沿链追溯 设备节点/验收项/证书/缺陷/签署 */
  refType: 'plant' | 'equipment' | 'item' | 'certificate' | 'defect' | 'sign'
  refId: string
  prevHash: string
  hash: string
}
