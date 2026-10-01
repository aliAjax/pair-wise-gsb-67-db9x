<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import InputSwitch from 'primevue/inputswitch'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const idempotencyKey = ref(`submit-${new Date().toISOString().slice(0, 10)}-01`)
const simulateFailure = ref(false)
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.refId}`.includes(keyword.value)))

function newKey() {
  idempotencyKey.value = `submit-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`
}

function sign() {
  const result = store.signOff(idempotencyKey.value, simulateFailure.value)
  if (result.ok) {
    toast.add({
      severity: 'success', summary: (result as any).duplicated ? '重复提交已拦截' : '签署完成',
      detail: result.message, life: 4000
    })
  } else {
    toast.add({
      severity: (result as any).pendingRecovery ? 'warn' : 'error',
      summary: (result as any).pendingRecovery ? '签署写入失败' : '完整性校验未通过',
      detail: result.message, life: 4500
    })
  }
}

function recover() {
  const result = store.recoverSign()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '已从最后完整快照恢复' : '恢复中止', detail: result.message, life: 4500 })
}

function fmt(time: string) { return time ? time.replace('T', ' ').slice(0, 16) : '—' }
function shortHash(value: string) { return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—' }

function exportPackage() {
  const snapshot = store.validSnapshot
  const payload = snapshot
    ? { source: '签署快照', snapshotId: snapshot.id, version: snapshot.signVersion, contentHash: snapshot.contentHash, ...snapshot.payload }
    : { source: '当前工作数据', plant: store.plant, equipment: store.equipment, defects: store.defects, audit: store.audit, preflight: store.preflight }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = snapshot ? `光伏并网验收交付包-V${snapshot.signVersion}.json` : '光伏并网验收交付包-工作数据.json'
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div v-if="store.recoveryNotice" class="recovery-banner">
      <Tag value="已恢复" severity="success" icon="pi pi-shield" />
      <span>{{ store.recoveryNotice }}</span>
      <Button label="知道了" text size="small" @click="store.dismissRecoveryNotice()" />
    </div>

    <div class="preflight-panel">
      <div>
        <span>并网前完整性校验（仅统计已选定实测版本的验收项）</span>
        <strong>{{ store.preflight.allowed ? '全部条件满足，可发起签署' : `${store.preflight.blocking.length} 项阻断` }}</strong>
        <p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p>
        <small>合格 {{ store.preflight.passed }}/{{ store.preflight.total }} · 不合格或待复验 {{ store.preflight.failed }} · 双端冲突 {{ store.preflight.conflicts }} · 待重核缺陷 {{ store.preflight.staleDefects }} · 证书待核 {{ store.preflight.unverifiedCertificates }} · 证书失效 {{ store.preflight.expiredCertificates }}</small>
      </div>
      <div class="sign-controls">
        <Button label="导出交付包" outlined @click="exportPackage" />
        <Button label="签署并锁定版本" :disabled="!store.preflight.allowed" @click="sign" />
      </div>
    </div>

    <div class="sign-config">
      <label>签署幂等键<InputText v-model="idempotencyKey" /></label>
      <Button label="换一个提交" text size="small" @click="newKey" />
      <label class="switch"><InputSwitch v-model="simulateFailure" /><span>模拟签署主数据写入失败（用于演练快照恢复）</span></label>
      <Button v-if="store.pendingRecovery" label="从最后完整快照恢复" severity="warn" icon="pi pi-undo" @click="recover" />
    </div>

    <div class="section-head">
      <div>
        <h2>签署快照与恢复链</h2>
        <p>同一幂等键或已存在有效版本时重复提交不产生第二版；任一时刻至多一份有效签署。证书换版/复测结论变化后有效快照转失效。</p>
      </div>
      <Tag :value="store.chainValid ? '审计哈希链校验通过' : '审计哈希链异常'" :severity="store.chainValid ? 'success' : 'danger'" :icon="store.chainValid ? 'pi pi-check-circle' : 'pi pi-times-circle'" />
    </div>
    <DataTable :value="store.snapshots" dataKey="id" size="small" class="snapshot-table">
      <Column field="id" header="快照" />
      <Column header="签署版本"><template #body="{ data }">V{{ data.signVersion }}</template></Column>
      <Column header="幂等键"><template #body="{ data }"><code>{{ data.idempotencyKey }}</code></template></Column>
      <Column header="状态">
        <template #body="{ data }"><Tag :value="data.state" :severity="data.state === '有效' ? 'success' : 'danger'" /></template>
      </Column>
      <Column header="完整性"><template #body="{ data }"><span :class="data.completeness.allowed ? 'pass-text' : 'fail-text'">{{ data.completeness.allowed ? '全部通过' : `${data.completeness.blocking.length}项阻断` }}</span></template></Column>
      <Column header="内容指纹"><template #body="{ data }"><code>{{ shortHash(data.contentHash) }}</code></template></Column>
      <Column header="签署时间"><template #body="{ data }">{{ fmt(data.signedAt) }}</template></Column>
      <Column header="失效原因/时间">
        <template #body="{ data }"><span v-if="data.invalidatedReason">{{ data.invalidatedReason }} · {{ fmt(data.invalidatedAt) }}</span><small v-else>—</small></template>
      </Column>
    </DataTable>

    <div class="section-head" style="margin-top:22px"><div><h2>验收审计 · 复核链</h2><p>每条审计含 prevHash 与本环哈希，设备节点、验收项、证书、缺陷与签署沿链可追溯。</p></div><InputText v-model="keyword" placeholder="搜索实体、动作或操作人" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ fmt(data.createdAt) }}</template></Column>
      <Column header="实体"><template #body="{ data }"><Tag :value="data.refType" severity="secondary" /><small> {{ data.entityId }}</small></template></Column>
      <Column field="action" header="动作" />
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
      <Column header="链哈希"><template #body="{ data }"><code>{{ shortHash(data.hash) }} ← {{ shortHash(data.prevHash) }}</code></template></Column>
    </DataTable>
  </section>
</template>
