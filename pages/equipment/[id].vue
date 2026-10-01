<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import { SIDE_LABEL, effectiveRevision, mergeRevisions, mergeStatus } from '../../services/chain'
import type { AcceptanceItem, Certificate, InspectionStatus, Side } from '../../types/domain'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const node = computed(() => store.equipment.find((item) => item.id === route.params.id))
const siblings = computed(() => {
  const current = node.value
  if (!current) return []
  return store.equipment.filter((value) => value.parentId === current.parentId || value.id === current.id)
})
const visible = ref(false)
const certVisible = ref(false)
const targetItemId = ref('')
const editable = reactive({ side: 'node' as Side, status: '合格' as InspectionStatus, measured: '', evidence: '', conditionNote: '', recorder: '', recordedAt: nowLocal() })
const certPatch = reactive({ name: '', issuer: '', expiresAt: '' })
const targetCertId = ref('')

function nowLocal() {
  return new Date().toISOString().slice(0, 16)
}

function statusFor(item: AcceptanceItem) {
  const status = mergeStatus(item)
  if (status === 'conflict') return { label: '双端冲突·待选定', severity: 'danger' as const }
  if (status === 'resolved') return { label: `已裁定·${SIDE_LABEL[item.winningSide as Side]}`, severity: 'success' as const }
  if (status === 'empty') return { label: '无记录', severity: 'secondary' as const }
  const revision = effectiveRevision(item)
  const severity = revision?.status === '合格' ? 'success' : revision?.status === '不合格' ? 'danger' : 'warn'
  return { label: `单端·${revision?.status ?? '待检查'}`, severity: severity as 'success' | 'danger' | 'warn' }
}

function openItem(item: AcceptanceItem) {
  targetItemId.value = item.id
  Object.assign(editable, { side: store.activeSide, status: '合格', measured: '', evidence: '', conditionNote: '', recorder: '', recordedAt: nowLocal() })
  visible.value = true
}

function save() {
  if (!node.value) return
  const result = store.appendRevision(node.value.id, targetItemId.value, {
    side: editable.side,
    status: editable.status,
    measured: editable.measured,
    evidence: editable.evidence,
    recordedAt: new Date(editable.recordedAt).toISOString(),
    recorder: editable.recorder || (editable.side === 'node' ? '现场验收员冯哲' : '中心值班员')
  })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
  if (result.ok) visible.value = false
}

function decide(item: AcceptanceItem, side: Side) {
  if (!node.value) return
  const result = store.decideItem(node.value.id, item.id, side)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}

function openCert(cert: Certificate) {
  targetCertId.value = cert.id
  Object.assign(certPatch, { name: cert.name, issuer: cert.issuer, expiresAt: cert.expiresAt })
  certVisible.value = true
}

function submitCert() {
  if (!node.value) return
  const result = store.replaceCert(node.value.id, targetCertId.value, { ...certPatch })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3500 })
  if (result.ok) certVisible.value = false
}

function verify(cert: Certificate) {
  if (!node.value) return
  const result = store.verifyCert(node.value.id, cert.id)
  toast.add({ severity: result.ok ? 'success' : 'warn', summary: result.message, life: 2500 })
}
</script>

<template>
  <section v-if="node" class="page">
    <div class="section-head">
      <div><span>{{ node.id }} · {{ node.code }}</span><h2>{{ node.name }}</h2><p>{{ node.type }} · 当前状态 {{ node.status }}</p></div>
      <Tag :value="node.status" :severity="node.status === '已验收' ? 'success' : 'warn'" />
    </div>
    <div class="equipment-path">
      <span v-for="item in siblings" :key="item.id" :class="{ active: item.id === node.id }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span>
    </div>
    <p class="chain-hint"><i class="pi pi-sitemap"></i> 设备节点与中心记录回连后按实测时间并列合并；双端都改过的验收项需负责人选定后才计入并网完整性。当前录入端：
      <b>{{ SIDE_LABEL[store.activeSide] }}</b>（顶部栏可切换；断网时现场用设备节点端离线记录）
    </p>
    <DataTable :value="node.items" dataKey="id" size="small">
      <Column field="id" header="编号" style="width:90px" />
      <Column field="standard" header="验收标准" style="min-width:150px" />
      <Column header="双端实测（按时间并列）" style="min-width:380px">
        <template #body="{ data }">
          <div class="revision-stack">
            <article v-for="revision in mergeRevisions(data)" :key="`${revision.side}-${revision.sideVersion}`"
              :class="['revision', revision.side, { chosen: data.winningSide === revision.side && mergeStatus(data) === 'resolved' }]">
              <Tag :value="SIDE_LABEL[revision.side]" :severity="revision.side === 'node' ? 'info' : 'secondary'" />
              <strong>{{ revision.status }}｜{{ revision.measured }}</strong>
              <span>{{ revision.evidence }}</span>
              <small>{{ revision.recordedAt.replace('T', ' ').slice(0, 16) }} · {{ revision.recorder }} · 端V{{ revision.sideVersion }}</small>
            </article>
            <p v-if="!mergeRevisions(data).length" class="empty-hint">暂无任何一端的实测记录</p>
          </div>
        </template>
      </Column>
      <Column header="合并状态" style="width:150px">
        <template #body="{ data }"><Tag :value="statusFor(data).label" :severity="statusFor(data).severity" /></template>
      </Column>
      <Column header="负责人选定" style="width:210px">
        <template #body="{ data }">
          <div class="decide-cell" v-if="mergeStatus(data) === 'conflict'">
            <Button size="small" label="选节点端" severity="info" outlined @click="decide(data, 'node')" />
            <Button size="small" label="选中心端" severity="secondary" outlined @click="decide(data, 'center')" />
          </div>
          <small v-else-if="data.decidedBy">{{ data.decidedBy }}<br />{{ data.decidedAt?.replace('T', ' ').slice(0, 16) }}</small>
          <small v-else class="empty-hint">—</small>
        </template>
      </Column>
      <Column header="" style="width:120px"><template #body="{ data }"><Button size="small" label="录入实测" @click="openItem(data)" /></template></Column>
    </DataTable>

    <div class="certificate-panel">
      <h3>证书与测试附件</h3>
      <p class="chain-hint">证书换版会使新版本默认待核验，并联动失效引用旧版本的缺陷快照与已签署快照。</p>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-item cert-grid">
        <Tag :value="certificate.verified ? '已核验' : '换版待核'" :severity="certificate.verified ? 'success' : 'danger'" />
        <strong>{{ certificate.name }}</strong><span>{{ certificate.issuer }}</span><span>有效期至 {{ certificate.expiresAt }}</span>
        <small>V{{ certificate.version }}</small>
        <span class="cert-actions"><Button size="small" label="换版" severity="secondary" outlined @click="openCert(certificate)" /><Button size="small" label="核验" :disabled="certificate.verified" @click="verify(certificate)" /></span>
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
    </div>

    <Dialog v-model:visible="visible" header="追加实测记录（按时间并入，不覆盖对端）" modal :style="{ width: '640px' }">
      <div class="edit-grid">
        <label>来源端<Select v-model="editable.side" :options="[{ label: '设备节点（现场/离线）', value: 'node' }, { label: '中心记录', value: 'center' }]" optionLabel="label" optionValue="value" /></label>
        <label>实测时间<InputText v-model="editable.recordedAt" type="datetime-local" /></label>
        <label>结论<Select v-model="editable.status" :options="['待检查', '合格', '不合格', '待复验']" /></label>
        <label>记录人<InputText v-model="editable.recorder" placeholder="默认：现场验收员冯哲 / 中心值班员" /></label>
        <label class="span2">实测结果<InputText v-model="editable.measured" placeholder="如：高压对地 12.8GΩ" /></label>
        <label class="span2">测试证据<InputText v-model="editable.evidence" placeholder="原始记录文件名" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="visible = false" /><Button label="并列并入复核链" @click="save" /></template>
    </Dialog>

    <Dialog v-model:visible="certVisible" header="证书换版（新版本默认待核验）" modal :style="{ width: '520px' }">
      <div class="edit-grid">
        <label class="span2">证书名称<InputText v-model="certPatch.name" /></label>
        <label>签发机构<InputText v-model="certPatch.issuer" /></label>
        <label>有效期至<InputText v-model="certPatch.expiresAt" type="date" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="certVisible = false" /><Button label="换版并联动失效" @click="submitCert" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
