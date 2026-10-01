import type { AcceptanceDefect, AuditEntry, EquipmentNode, Plant, SignState } from '../types/domain'
import { auditEntry } from '../services/chain'

export const seedPlant: Plant = {
  id: 'PV-2609-NW', name: '西北沙岭一期 120MW光伏电站', gridPoint: '沙岭110kV升压站', capacity: '120 MWp', commissioningDate: '2026-10-08', status: '验收中', version: 7
}

export const seedEquipment: EquipmentNode[] = [
  {
    id: 'EQ-GRID', parentId: null, name: '110kV并网点', type: '并网点', code: 'GRID-110', status: '验收中',
    items: [
      {
        id: 'IT-G1', standard: '保护定值与调度单一致', method: '逐项比对定值单与装置报文', condition: '并网点开关合位，通信正常', version: 2, winningSide: 'node', decidedBy: '陆川', decidedAt: '2026-09-27T10:00:00',
        revisions: [
          { side: 'node', status: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', recordedAt: '2026-09-26T15:40:00', recorder: '现场验收员冯哲', sideVersion: 1 },
          { side: 'center', status: '合格', measured: '调度侧核对18项一致', evidence: '中心定值单回传.pdf', recordedAt: '2026-09-27T09:10:00', recorder: '中心值班员', sideVersion: 1 }
        ]
      },
      {
        id: 'IT-G2', standard: '故障录波可正确触发', method: '模拟保护启动', condition: '录波装置已对时', version: 3, winningSide: null, decidedBy: '', decidedAt: null,
        revisions: [
          { side: 'center', status: '待复验', measured: '触发成功，时标偏差28ms', evidence: '录波触发截图.png', recordedAt: '2026-09-27T16:20:00', recorder: '中心值班员', sideVersion: 1 },
          // 断网复测：设备节点本地新增，回连后与中心记录并列，待负责人选定
          { side: 'node', status: '合格', measured: '重新触发成功，时标偏差9ms', evidence: '断网复测录波截图.png', recordedAt: '2026-09-30T08:45:00', recorder: '现场验收员冯哲', sideVersion: 1 }
        ]
      }
    ],
    certificates: [{ id: 'C-G1', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2027-09-20', version: 1, verified: true, replacedAt: null }]
  },
  {
    id: 'EQ-TR1', parentId: 'EQ-GRID', name: '1号主变压器', type: '变压器', code: 'TR-01', status: '验收中',
    items: [
      {
        id: 'IT-T1', standard: '绝缘电阻不低于出厂值70%', method: '2500V绝缘电阻表测量', condition: '绕组温度25±5℃，湿度低于80%', version: 1, winningSide: null, decidedBy: '', decidedAt: null,
        revisions: [{ side: 'node', status: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', recordedAt: '2026-09-26T11:00:00', recorder: '现场验收员冯哲', sideVersion: 1 }]
      },
      {
        id: 'IT-T2', standard: '有载调压档位与监控一致', method: '远方/就地逐档操作', condition: '变压器空载', version: 3, winningSide: 'node', decidedBy: '陆川', decidedAt: '2026-09-28T10:00:00',
        revisions: [
          { side: 'center', status: '合格', measured: '远程核对档位显示一致', evidence: '中心SCADA截图.png', recordedAt: '2026-09-27T14:00:00', recorder: '中心值班员', sideVersion: 1 },
          { side: 'node', status: '不合格', measured: '第7档监控显示第8档', evidence: '档位差异照片.jpg', recordedAt: '2026-09-28T09:30:00', recorder: '现场验收员冯哲', sideVersion: 1 }
        ]
      }
    ],
    certificates: [{ id: 'C-T1', name: '主变出厂试验报告', issuer: '特变电工', expiresAt: '2031-04-10', version: 1, verified: true, replacedAt: null }]
  },
  {
    id: 'EQ-AR1', parentId: 'EQ-TR1', name: '1号方阵', type: '方阵', code: 'ARRAY-01', status: '待验收',
    items: [{ id: 'IT-A1', standard: '接地连续性符合设计', method: '微欧计抽测30处', condition: '汇流箱断电', version: 1, winningSide: null, decidedBy: '', decidedAt: null, revisions: [] }], certificates: []
  },
  {
    id: 'EQ-INV11', parentId: 'EQ-AR1', name: '1-1号逆变器', type: '逆变器', code: 'INV-1-1', status: '验收中',
    items: [
      {
        id: 'IT-I1', standard: '通信点表与SCADA一致', method: '逐点置数核对', condition: '调度数据网连通', version: 3, winningSide: 'node', decidedBy: '陆川', decidedAt: '2026-09-27T15:00:00',
        revisions: [
          { side: 'center', status: '合格', measured: '126/126点一致', evidence: '中心点表核对记录.xlsx', recordedAt: '2026-09-26T10:00:00', recorder: '中心值班员', sideVersion: 1 },
          { side: 'node', status: '合格', measured: '现场逐点置数126/126一致', evidence: '点表核对记录.xlsx', recordedAt: '2026-09-27T14:30:00', recorder: '现场验收员冯哲', sideVersion: 1 }
        ]
      },
      {
        id: 'IT-I2', standard: '额定功率下转换效率不低于98.5%', method: '功率分析仪连续测量30分钟', condition: '辐照度≥700W/m²，功率稳定', version: 3, winningSide: null, decidedBy: '', decidedAt: null,
        revisions: [
          { side: 'center', status: '待复验', measured: '98.3%', evidence: '效率测试曲线.csv', recordedAt: '2026-09-28T17:10:00', recorder: '中心值班员', sideVersion: 1 },
          // 厂家固件更新后现场断网复测，回连合并：两端结论不一致，待裁定
          { side: 'node', status: '合格', measured: '同条件复测98.62%', evidence: '断网复测效率曲线.csv', recordedAt: '2026-09-30T13:20:00', recorder: '现场验收员冯哲', sideVersion: 1 }
        ]
      }
    ],
    certificates: [{ id: 'C-I1', name: '逆变器低电压穿越证书', issuer: '中国电科院', expiresAt: '2028-06-30', version: 2, verified: true, replacedAt: null }]
  },
  {
    id: 'EQ-CB111', parentId: 'EQ-INV11', name: '1-1-1汇流箱', type: '汇流箱', code: 'CB-1-1-1', status: '待验收',
    items: [{ id: 'IT-C1', standard: '组串极性及开路电压正常', method: '逐路测量并核对设计', condition: '辐照度300-800W/m²', version: 1, winningSide: null, decidedBy: '', decidedAt: null, revisions: [] }], certificates: []
  }
]

export const seedDefects: AcceptanceDefect[] = [
  {
    id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', status: '整改中', owner: '设备厂家', dueDate: '2026-09-30', version: 4, decisionNote: '',
    replies: [{ party: '设备厂家', owner: '王新', content: '档位变送器输出线性偏差，已更换并重新校准。', evidence: '更换记录与校准报告.pdf', repliedAt: '2026-09-29T14:20:00' }],
    retests: [], retestConclusion: null,
    certRefs: [{ certId: 'C-T1', certName: '主变出厂试验报告', version: 1, verified: true, expiresAt: '2031-04-10', boundAt: '2026-09-28T10:05:00' }],
    valid: true, invalidReasons: [], checkedAt: null, checkedBy: ''
  },
  {
    id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', status: '待联合复验', owner: '设备厂家', dueDate: '2026-10-02', version: 3, decisionNote: '',
    replies: [{ party: '设备厂家', owner: '赵晶', content: '已更新控制固件，在相同测试条件下复测效率98.62%。', evidence: '固件版本记录与复测曲线.zip', repliedAt: '2026-09-29T16:05:00' }, { party: '运维单位', owner: '罗宇', content: '复测条件满足，建议联合见证。', evidence: '测试条件确认单.pdf', repliedAt: '2026-09-29T16:30:00' }],
    retests: [{ round: 1, passed: false, result: '效率98.27%，未达到98.5%', tester: '联合验收组', testedAt: '2026-09-28T17:10:00' }],
    retestConclusion: false,
    certRefs: [{ certId: 'C-I1', certName: '逆变器低电压穿越证书', version: 2, verified: true, expiresAt: '2028-06-30', boundAt: '2026-09-29T09:00:00' }],
    valid: true, invalidReasons: [], checkedAt: null, checkedBy: ''
  }
]

const rawAudit: Array<Omit<AuditEntry, 'seq' | 'prevHash' | 'hash'>> = [
  { id: 'A-1', entityId: 'PV-2609-NW', action: '创建验收计划', operator: '陆川', detail: '建立5类设备树与18项验收要求', createdAt: '2026-09-25T08:30:00' },
  { id: 'A-2', entityId: 'AD-260929-01', action: '分派缺陷', operator: '陆川', detail: '重大缺陷分派设备厂家，限期24小时', createdAt: '2026-09-29T09:10:00' },
  { id: 'A-3', entityId: 'AD-260929-02', action: '提交复验', operator: '罗宇', detail: '第1轮复测效率未达标', createdAt: '2026-09-28T17:10:00' },
  { id: 'A-4', entityId: 'IT-G2', action: '回连按时间合并', operator: '系统', detail: '设备节点断网复测记录与中心记录并列，等待负责人裁定', createdAt: '2026-09-30T09:00:00' },
  { id: 'A-5', entityId: 'IT-I2', action: '回连按时间合并', operator: '系统', detail: '现场98.62%与中心98.3%并列，等待负责人裁定', createdAt: '2026-09-30T13:40:00' }
]

export const seedAudit: AuditEntry[] = rawAudit.reduce<AuditEntry[]>((chain, fields) => {
  chain.push(auditEntry(chain.at(-1) ?? null, fields))
  return chain
}, [])

export const seedSignState: SignState = {
  phase: 'idle', snapshots: [], record: null, pendingSnapshotId: null, pendingToken: null, failNextWrite: false
}
