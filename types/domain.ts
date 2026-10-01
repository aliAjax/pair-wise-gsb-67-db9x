export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'
/** 数据来源端：现场设备节点（断网可离线复测）或中心记录 */
export type Side = 'node' | 'center'
/** 验收项合并状态：仅一端记录 / 两端冲突待裁定 / 负责人已裁定 */
export type MergeStatus = 'empty' | 'sole' | 'conflict' | 'resolved'

export interface ItemRevision {
  side: Side
  status: InspectionStatus
  measured: string
  evidence: string
  /** 实测时间（ISO），回连后按该时间并列合并 */
  recordedAt: string
  recorder: string
  /** 该端自己的版本号，每次该端追加记录 +1 */
  sideVersion: number
}

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  /** 两端实测记录按时间并列保留，永不互相覆盖 */
  revisions: ItemRevision[]
  /** 负责人裁定采纳的一端；裁定后任一端再补测则清空回到冲突 */
  winningSide: Side | null
  decidedBy: string
  decidedAt: string | null
  version: number
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  /** 换版后新版本默认待核验，核验前关联缺陷与签署快照均视为失效待核对 */
  verified: boolean
  replacedAt: string | null
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

export interface DefectCertRef {
  certId: string
  certName: string
  /** 缺陷快照绑定时的证书版本，证书换版后与此不一致即失效 */
  version: number
  verified: boolean
  expiresAt: string
  boundAt: string
}

export interface RetestRound {
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
  retests: RetestRound[]
  decisionNote: string
  version: number
  /** 缺陷闭环快照绑定的证书版本 */
  certRefs: DefectCertRef[]
  /** 最近一轮复测结论（null=尚无复测），结论翻转即触发失效 */
  retestConclusion: boolean | null
  /** 快照是否仍有效；证书换版或复测结论一变即置 false，待重新核对 */
  valid: boolean
  invalidReasons: string[]
  checkedAt: string | null
  checkedBy: string
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

export interface AuditEntry {
  id: string
  seq: number
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  prevHash: string
  hash: string
}

/** 签署前冻结的完整快照；写入失败后凭它恢复，重复提交复用它 */
export interface SignSnapshot {
  id: string
  capturedAt: string
  capturedBy: string
  /** 签署成功后的电站版本 V(n+1) */
  plantVersion: number
  /** 回滚锚点：签署前版本与状态 */
  basePlantVersion: number
  basePlantStatus: Plant['status']
  fingerprint: string
  auditHead: { seq: number; hash: string }
  complete: boolean
  superseded: boolean
  checks: SnapshotChecks
  /** 冻结点完整业务状态，写入失败后据此回滚恢复 */
  state: {
    plant: Plant
    equipment: EquipmentNode[]
    defects: AcceptanceDefect[]
  }
}

export interface SnapshotChecks {
  items: Array<{ id: string; equipmentId: string; status: InspectionStatus; measured: string; evidence: string; side: Side; sideVersion: number; recordedAt: string }>
  certificates: Array<{ id: string; equipmentId: string; version: number; verified: boolean; expiresAt: string }>
  defects: Array<{ id: string; version: number; status: DefectStatus; valid: boolean; retestConclusion: boolean | null; certRefs: Array<{ certId: string; version: number }> }>
}

export interface SignRecord {
  /** 幂等令牌：同一次签署的重复提交/失败重试共用 */
  token: string
  snapshotId: string
  plantVersion: number
  fingerprint: string
  signedAt: string
  signedBy: string
  /** 签署后上游数据变化（证书换版/复测结论翻转），快照失效待重新核对 */
  stale: boolean
  staleReasons: string[]
}

export type SignPhase = 'idle' | 'writing' | 'failed' | 'done'

export interface SignState {
  phase: SignPhase
  /** 已落盘的完整快照链，最新在末尾 */
  snapshots: SignSnapshot[]
  record: SignRecord | null
  /** 写入中断时挂起的快照与令牌，恢复/重试的锚点 */
  pendingSnapshotId: string | null
  pendingToken: string | null
  failNextWrite: boolean
}

export interface ActionResult {
  ok: boolean
  message: string
  duplicate?: boolean
  recoverable?: boolean
  snapshotId?: string
}
