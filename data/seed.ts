import type { AcceptanceDefect, AuditEntry, EquipmentNode, ItemRevision, Plant } from '../types/domain'
import { hashAudit } from '../utils/acceptance'

export const seedPlant: Plant = {
  id: 'PV-2609-NW', name: '西北沙岭一期 120MW光伏电站', gridPoint: '沙岭110kV升压站', capacity: '120 MWp', commissioningDate: '2026-10-08', status: '验收中', version: 7
}

function rev(source: ItemRevision['source'], values: Omit<ItemRevision, 'source'>): ItemRevision {
  return { source, ...values }
}

export const seedEquipment: EquipmentNode[] = [
  {
    id: 'EQ-GRID', parentId: null, name: '110kV并网点', type: '并网点', code: 'GRID-110', status: '验收中',
    items: [
      {
        id: 'IT-G1', standard: '保护定值与调度单一致', method: '逐项比对定值单与装置报文', mergedAt: '2026-09-29T18:00:00', conflict: false, resolvedSource: 'center', resolvedBy: '陆川', resolvedAt: '2026-09-29T18:05:00',
        center: rev('center', { status: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', condition: '并网点开关合位，通信正常', recordedAt: '2026-09-29T17:40:00', version: 2, author: '陆川' }),
        node: rev('node', { status: '合格', measured: '17/18项一致', evidence: '本机定值核对记录.pdf', condition: '并网点开关合位，通信正常', recordedAt: '2026-09-28T15:20:00', version: 1, author: '现场验收员韩磊' })
      },
      {
        id: 'IT-G2', standard: '故障录波可正确触发', method: '模拟保护启动', mergedAt: null, conflict: false, resolvedSource: null, resolvedBy: '', resolvedAt: '',
        center: null,
        node: rev('node', { status: '待复验', measured: '触发成功，时标偏差28ms', evidence: '录波触发截图.png', condition: '录波装置已对时', recordedAt: '2026-09-30T10:12:00', version: 2, author: '现场验收员韩磊' })
      }
    ],
    certificates: [
      {
        id: 'C-G1', name: '继电保护装置检验报告',
        history: [{ version: 1, issuer: '省电科院', expiresAt: '2027-09-20', verified: true, note: '初版检验报告', changedAt: '2026-09-26T09:00:00', changedBy: '陆川' }]
      }
    ]
  },
  {
    id: 'EQ-TR1', parentId: 'EQ-GRID', name: '1号主变压器', type: '变压器', code: 'TR-01', status: '验收中',
    items: [
      {
        id: 'IT-T1', standard: '绝缘电阻不低于出厂值70%', method: '2500V绝缘电阻表测量', mergedAt: null, conflict: false, resolvedSource: null, resolvedBy: '', resolvedAt: '',
        center: null,
        node: rev('node', { status: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', condition: '绕组温度25±5℃，湿度低于80%', recordedAt: '2026-09-27T11:00:00', version: 1, author: '现场验收员韩磊' })
      },
      {
        id: 'IT-T2', standard: '有载调压档位与监控一致', method: '远方/就地逐档操作',
        // 回连后中心与设备节点都改了同一项：并列保留，等待负责人选定，选定前不参与完整性判定
        mergedAt: '2026-09-30T09:00:00', conflict: true, resolvedSource: null, resolvedBy: '', resolvedAt: '',
        center: rev('center', { status: '不合格', measured: '第7档监控显示第8档（中心复算）', evidence: '档位差异照片.jpg', condition: '变压器空载', recordedAt: '2026-09-30T11:20:00', version: 3, author: '中心核算岗孙倩' }),
        node: rev('node', { status: '合格', measured: '更换变送器后8/8档一致', evidence: '档位复测记录.pdf', condition: '变压器空载', recordedAt: '2026-09-30T10:40:00', version: 3, author: '现场验收员韩磊' })
      }
    ],
    certificates: [
      {
        id: 'C-T1', name: '主变出厂试验报告',
        history: [{ version: 1, issuer: '特变电工', expiresAt: '2031-04-10', verified: true, note: '出厂随机文件', changedAt: '2026-09-25T10:00:00', changedBy: '陆川' }]
      }
    ]
  },
  {
    id: 'EQ-AR1', parentId: 'EQ-TR1', name: '1号方阵', type: '方阵', code: 'ARRAY-01', status: '待验收',
    items: [
      {
        id: 'IT-A1', standard: '接地连续性符合设计', method: '微欧计抽测30处', mergedAt: null, conflict: false, resolvedSource: null, resolvedBy: '', resolvedAt: '',
        center: null,
        node: rev('node', { status: '待检查', measured: '', evidence: '', condition: '汇流箱断电', recordedAt: '2026-09-26T08:30:00', version: 1, author: '现场验收员韩磊' })
      }
    ],
    certificates: []
  },
  {
    id: 'EQ-INV11', parentId: 'EQ-AR1', name: '1-1号逆变器', type: '逆变器', code: 'INV-1-1', status: '验收中',
    items: [
      {
        id: 'IT-I1', standard: '通信点表与SCADA一致', method: '逐点置数核对', mergedAt: '2026-09-29T18:00:00', conflict: false, resolvedSource: 'center', resolvedBy: '陆川', resolvedAt: '2026-09-29T18:06:00',
        center: rev('center', { status: '合格', measured: '126/126点一致', evidence: '点表核对记录.xlsx', condition: '调度数据网连通', recordedAt: '2026-09-29T16:00:00', version: 3, author: '中心核算岗孙倩' }),
        node: rev('node', { status: '合格', measured: '126/126点一致', evidence: '本机点表核对记录.xlsx', condition: '调度数据网连通', recordedAt: '2026-09-28T14:00:00', version: 2, author: '现场验收员韩磊' })
      },
      {
        id: 'IT-I2', standard: '额定功率下转换效率不低于98.5%', method: '功率分析仪连续测量30分钟', mergedAt: '2026-09-30T09:00:00', conflict: false, resolvedSource: 'node', resolvedBy: '陆川', resolvedAt: '2026-09-30T09:20:00',
        center: rev('center', { status: '合格', measured: '复测98.62%（厂家曲线核算）', evidence: '固件版本记录与复测曲线.zip', condition: '辐照度≥700W/m²，功率稳定', recordedAt: '2026-09-30T08:40:00', version: 3, author: '中心核算岗孙倩' }),
        node: rev('node', { status: '合格', measured: '98.62%', evidence: '现场效率复测曲线.csv', condition: '辐照度≥700W/m²，功率稳定', recordedAt: '2026-09-29T16:40:00', version: 3, author: '现场验收员韩磊' })
      }
    ],
    certificates: [
      {
        id: 'C-I1', name: '逆变器低电压穿越证书',
        history: [
          { version: 1, issuer: '中国电科院', expiresAt: '2027-06-30', verified: true, note: '旧版LVRT证书（已换版）', changedAt: '2026-09-26T09:30:00', changedBy: '陆川' },
          { version: 2, issuer: '中国电科院', expiresAt: '2028-06-30', verified: true, note: '固件升级后的换版证书', changedAt: '2026-09-29T15:00:00', changedBy: '现场验收员韩磊' }
        ]
      }
    ]
  },
  {
    id: 'EQ-CB111', parentId: 'EQ-INV11', name: '1-1-1汇流箱', type: '汇流箱', code: 'CB-1-1-1', status: '待验收',
    items: [
      {
        id: 'IT-C1', standard: '组串极性及开路电压正常', method: '逐路测量并核对设计', mergedAt: null, conflict: false, resolvedSource: null, resolvedBy: '', resolvedAt: '',
        center: null,
        node: rev('node', { status: '待检查', measured: '', evidence: '', condition: '辐照度300-800W/m²', recordedAt: '2026-09-26T09:00:00', version: 1, author: '现场验收员韩磊' })
      }
    ],
    certificates: []
  }
]

export const seedDefects: AcceptanceDefect[] = [
  {
    id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', status: '整改中', owner: '设备厂家', dueDate: '2026-09-30', version: 4, decisionNote: '',
    replies: [{ party: '设备厂家', owner: '王新', content: '档位变送器输出线性偏差，已更换并重新校准。', evidence: '更换记录与校准报告.pdf', repliedAt: '2026-09-29T14:20:00' }],
    retests: [],
    stale: false, staleReason: '', staleSince: '', recheckNote: '', recheckedBy: '', recheckedAt: ''
  },
  {
    // 证书换版且复测结论由不通过变为通过：缺陷置为待重新核对
    id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', status: '已关闭', owner: '设备厂家', dueDate: '2026-10-02', version: 3, decisionNote: '第2轮复测达标，关闭缺陷',
    replies: [
      { party: '运维单位', owner: '罗宇', content: '复测条件满足，建议联合见证。', evidence: '测试条件确认单.pdf', repliedAt: '2026-09-29T16:30:00' },
      { party: '设备厂家', owner: '赵晶', content: '已更新控制固件，在相同测试条件下复测效率98.62%。', evidence: '固件版本记录与复测曲线.zip', repliedAt: '2026-09-29T16:05:00' }
    ],
    retests: [
      { round: 2, passed: true, result: '效率98.62%，达到98.5%保证值', tester: '联合验收组', testedAt: '2026-09-30T08:50:00' },
      { round: 1, passed: false, result: '效率98.27%，未达到98.5%', tester: '联合验收组', testedAt: '2026-09-28T17:10:00' }
    ],
    stale: true,
    staleReason: '关联证书 C-I1 已换版至 V2；第2轮复测结论由"不通过"变为"通过"，需重新核对',
    staleSince: '2026-09-30T08:50:00',
    recheckNote: '', recheckedBy: '', recheckedAt: ''
  }
]

const rawAudit: Array<Omit<AuditEntry, 'prevHash' | 'hash'>> = [
  { id: 'A-1', entityId: 'PV-2609-NW', action: '创建验收计划', operator: '陆川', detail: '建立5类设备树与18项验收要求', createdAt: '2026-09-25T08:30:00', refType: 'plant', refId: 'PV-2609-NW' },
  { id: 'A-2', entityId: 'AD-260929-01', action: '分派缺陷', operator: '陆川', detail: '重大缺陷分派设备厂家，限期24小时', createdAt: '2026-09-29T09:10:00', refType: 'defect', refId: 'AD-260929-01' },
  { id: 'A-3', entityId: 'AD-260929-02', action: '提交复验', operator: '罗宇', detail: '第1轮复测效率未达标', createdAt: '2026-09-28T17:10:00', refType: 'defect', refId: 'AD-260929-02' },
  { id: 'A-4', entityId: 'C-I1', action: '证书换版', operator: '现场验收员韩磊', detail: '低电压穿越证书换版 V1→V2，关联缺陷与签署快照标记失效', createdAt: '2026-09-29T15:00:00', refType: 'certificate', refId: 'C-I1' },
  { id: 'A-5', entityId: 'AD-260929-02', action: '联合复验结论变化', operator: '联合验收组', detail: '第2轮复测98.62%达标，结论由不通过变为通过，缺陷待重新核对', createdAt: '2026-09-30T08:50:00', refType: 'defect', refId: 'AD-260929-02' },
  { id: 'A-6', entityId: 'IT-T2', action: '回连合并冲突', operator: '系统', detail: '中心与设备节点在合并后均修改 IT-T2，并列保留双方实测，待负责人选定', createdAt: '2026-09-30T11:20:00', refType: 'item', refId: 'IT-T2' }
]

/** 审计最新在前：按时间从创世条目起逐环串联，再以 unshift 排列为最新在前 */
export const seedAudit: AuditEntry[] = (() => {
  const chain: AuditEntry[] = []
  let prevHash = ''
  for (const raw of rawAudit) {
    const entry = { ...raw, prevHash }
    chain.unshift({ ...entry, hash: hashAudit(entry) })
    prevHash = chain[0].hash
  }
  return chain
})()
