<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))
const phaseLabel = computed(() => ({ idle: '空闲', writing: '写入中', failed: '写入失败·可恢复', done: '已完成' }[store.signState.phase]))

function notify(result: { ok: boolean; duplicate?: boolean; recoverable?: boolean; message: string }) {
  const severity = result.ok ? 'success' : result.duplicate ? 'info' : result.recoverable ? 'warn' : 'error'
  toast.add({ severity, summary: result.message, life: 4200 })
}
const sign = () => notify(store.signOff())
const retry = () => notify(store.retryFailedSigning())
const recover = () => notify(store.recoverFromSnapshot())
const exportPackage = () => {
  const record = store.signState.record
  const snapshot = store.signState.snapshots.find((item) => item.id === record?.snapshotId) ?? store.lastSnapshot
  const payload = {
    plant: store.plant, preflight: store.preflight,
    signRecord: record, signedSnapshot: snapshot,
    snapshotChecks: snapshot?.checks,
    equipment: store.equipment, defects: store.defects, audit: store.audit
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `光伏并网验收交付包-V${record?.plantVersion ?? store.plant.version}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div class="sign-chain-panel">
      <div class="sign-chain-head">
        <div>
          <span>可恢复签署链</span>
          <h2>并网复核完整性与签署锁定</h2>
          <p>先冻结完整快照再写入；写入失败可按原请求重试或从快照恢复，重复提交不生成第二个签署版本。</p>
        </div>
        <div class="sign-state">
          <Tag :value="phaseLabel" :severity="store.signState.phase === 'failed' ? 'danger' : store.signState.phase === 'done' ? 'success' : 'warn'" />
          <label class="fail-switch"><ToggleSwitch v-model="store.signState.failNextWrite" @update:model-value="(v: boolean) => store.setFailNextWrite(v)" /><small>故障注入：下一次签署写入失败</small></label>
        </div>
      </div>

      <div class="preflight-grid">
        <div class="preflight-checks">
          <strong>{{ store.preflight.allowed ? '完整性校验全部满足' : `${store.preflight.blocking.length} 项阻断` }}</strong>
          <p v-for="item in store.preflight.blocking" :key="item" class="blocking"><i class="pi pi-ban"></i>{{ item }}</p>
          <p v-for="item in store.preflight.warnings" :key="item" class="warning-line"><i class="pi pi-exclamation-triangle"></i>{{ item }}</p>
          <p v-if="store.preflight.allowed" class="ok-line"><i class="pi pi-check-circle"></i>双端冲突已裁定、验收项齐全、证书有效、缺陷闭环快照全部有效</p>
        </div>
        <div class="sign-actions">
          <Button label="签署并锁定版本" :disabled="!store.preflight.allowed" @click="sign" />
          <Button label="失败后按原请求重试" severity="warning" outlined :disabled="store.signState.phase !== 'failed'" @click="retry" />
          <Button label="从最后完整快照恢复" severity="secondary" outlined :disabled="!store.lastSnapshot" @click="recover" />
          <Button label="导出交付包" severity="secondary" outlined @click="exportPackage" />
        </div>
      </div>

      <div class="sign-record" v-if="store.signState.record">
        <div>
          <Tag :value="store.signState.record.stale ? '已失效·待重签' : '有效锁定'" :severity="store.signState.record.stale ? 'danger' : 'success'" />
          <strong>交付版本 V{{ store.signState.record.plantVersion }}</strong>
          <small>{{ store.signState.record.signedAt.replace('T', ' ').slice(0, 19) }} · {{ store.signState.record.signedBy }} · 幂等令牌 {{ store.signState.record.token }}</small>
        </div>
        <ul v-if="store.signState.record.stale" class="stale-reasons">
          <li v-for="reason in store.signState.record.staleReasons" :key="reason">{{ reason }} —— 重新核对后重签才升版，重复提交不会另起版本</li>
        </ul>
      </div>

      <DataTable :value="[...store.signState.snapshots].reverse()" dataKey="id" size="small" class="snapshot-table">
        <Column field="id" header="完整快照" />
        <Column header="目标版本"><template #body="{ data }">V{{ data.plantVersion }}（冻结点 V{{ data.basePlantVersion }}）</template></Column>
        <Column field="capturedAt" header="冻结时间"><template #body="{ data }">{{ data.capturedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
        <Column header="指纹 / 审计锚点"><template #body="{ data }"><code>{{ data.fingerprint }}</code><small>锚定审计#{{ data.auditHead.seq }} {{ data.auditHead.hash.slice(0, 8) }}</small></template></Column>
        <Column header="状态">
          <template #body="{ data }">
            <Tag v-if="store.signState.pendingSnapshotId === data.id && store.signState.phase === 'failed'" value="写入失败·恢复锚点" severity="danger" />
            <Tag v-else-if="data.superseded" value="已被上游变化取代" severity="warn" />
            <Tag v-else-if="store.signState.record?.snapshotId === data.id" value="已锁定" severity="success" />
            <Tag v-else value="完整快照" severity="info" />
          </template>
        </Column>
      </DataTable>
    </div>

    <div class="section-head">
      <div><h2>验收审计（哈希链）</h2>
        <p v-if="!store.auditIntegrity">
          <Tag value="审计链完整" severity="success" /> 共 {{ store.audit.length }} 条，每条锚定前序哈希，快照指纹锚定链头。
        </p>
        <p v-else><Tag value="审计链断裂" severity="danger" /> 第 {{ store.auditIntegrity.seq }} 条哈希不匹配，期望 {{ store.auditIntegrity.expected }}，实际 {{ store.auditIntegrity.actual }}</p>
      </div>
      <InputText v-model="keyword" placeholder="搜索实体、动作或操作人" />
    </div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间" style="width:150px"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="entityId" header="实体" style="width:130px" />
      <Column field="action" header="动作" style="width:170px"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" style="width:120px" />
      <Column field="detail" header="说明" />
      <Column header="链" style="width:110px"><template #body="{ data }"><small>#{{ data.seq }} {{ data.hash.slice(0, 8) }}</small></template></Column>
    </DataTable>
  </section>
</template>
