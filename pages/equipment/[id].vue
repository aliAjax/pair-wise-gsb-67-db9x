<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
import type { AcceptanceItem, InspectionStatus, ReplicaSource } from '../../types/domain'
import { effectiveRevision, latestRevision } from '../../utils/acceptance'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const node = computed(() => store.equipment.find((item) => item.id === route.params.id))
const siblings = computed(() => store.equipment.filter((value) => value.parentId === node.value?.parentId || value.id === node.value?.id))

const recordVisible = ref(false)
const recordSource = ref<ReplicaSource>('node')
const activeItem = ref<AcceptanceItem | null>(null)
const form = reactive({ status: '待检查' as InspectionStatus, measured: '', evidence: '', condition: '', author: recordSource.value === 'node' ? '现场验收员韩磊' : '中心核算岗孙倩' })

const certVisible = ref(false)
const activeCertId = ref('')
const certForm = reactive({ issuer: '', expiresAt: '2027-12-31', verified: true, note: '', by: '现场验收员韩磊' })

const statusOptions: InspectionStatus[] = ['待检查', '合格', '不合格', '待复验']

function fmt(time: string | null | undefined) {
  return time ? time.replace('T', ' ').slice(0, 16) : '—'
}

/** 测试条件跟随每端实测：优先显示参与判定版本，其次任一已有记录 */
function conditionOf(item: AcceptanceItem) {
  return effectiveRevision(item)?.condition ?? item.center?.condition ?? item.node?.condition ?? '—'
}

function openRecord(item: AcceptanceItem, source: ReplicaSource) {
  activeItem.value = item
  recordSource.value = source
  const rev = source === 'center' ? item.center : item.node
  Object.assign(form, {
    status: rev?.status ?? '待检查',
    measured: rev?.measured ?? '',
    evidence: rev?.evidence ?? '',
    condition: rev?.condition ?? '',
    author: source === 'node' ? '现场验收员韩磊' : '中心核算岗孙倩'
  })
  recordVisible.value = true
}

function saveRecord() {
  if (!node.value || !activeItem.value) return
  const result = store.recordItemRevision(node.value.id, activeItem.value.id, recordSource.value, { ...form })
  if (!result.ok) { toast.add({ severity: 'error', summary: result.message, life: 2500 }); return }
  toast.add({
    severity: result.conflict ? 'warn' : 'success', life: 3500,
    summary: result.conflict ? '两端记录并列保留，待负责人选定' : `${recordSource.value === 'node' ? '本机' : '中心'}实测已保存`
  })
  recordVisible.value = false
}

function choose(item: AcceptanceItem, source: ReplicaSource) {
  if (!node.value) return
  const result = store.resolveItem(node.value.id, item.id, source)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? `已选定${source === 'center' ? '中心' : '设备节点'}实测参与判定` : result.message, life: 3000 })
}

function merge() {
  const result = store.reconnectMerge()
  toast.add({
    severity: result.conflicts.length ? 'warn' : 'success', life: 4000,
    summary: `回连合并完成：${result.synced}项已按时间合并`,
    detail: result.conflicts.length ? `两端并改待选定：${result.conflicts.join('、')}` : '无冲突'
  })
}

function openCert(certId: string) {
  const cert = node.value?.certificates.find((item) => item.id === certId)
  if (!cert) return
  const current = latestRevision(cert)
  activeCertId.value = certId
  Object.assign(certForm, { issuer: current.issuer, expiresAt: current.expiresAt, verified: current.verified, note: '', by: '现场验收员韩磊' })
  certVisible.value = true
}

function saveCert() {
  if (!node.value) return
  const result = store.replaceCertificate(node.value.id, activeCertId.value, { ...certForm })
  if (!result.ok) { toast.add({ severity: 'error', summary: result.message, life: 2500 }); return }
  toast.add({ severity: 'warn', summary: '证书已换版', detail: '关联缺陷与有效签署快照已标记失效，待重新核对', life: 4000 })
  certVisible.value = false
}

function toggleVerify(itemId: string, verified: boolean) {
  if (!node.value) return
  store.setCertificateVerified(node.value.id, itemId, verified)
  toast.add({ severity: verified ? 'success' : 'warn', summary: verified ? '证书核验通过' : '证书已退回待核验', life: 2200 })
}
</script>

<template>
  <section v-if="node" class="page">
    <div class="section-head">
      <div><span>{{ node.id }} · {{ node.code }} · 最近回连合并 {{ fmt(store.lastMergeAt) }}</span><h2>{{ node.name }}</h2><p>{{ node.type }} · 双端实测并列保留，负责人选定后才参与完整性判定</p></div>
      <div class="head-actions"><Tag :value="node.status" :severity="node.status === '已验收' ? 'success' : 'warn'" /><Button label="断网复测后回连·按时间合并" icon="pi pi-refresh" @click="merge" /></div>
    </div>
    <div class="equipment-path"><span v-for="item in siblings" :key="item.id" :class="{ active: item.id === node.id }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span></div>

    <div v-for="item in node.items" :key="item.id" class="item-card" :class="{ conflict: item.conflict, unresolved: !item.conflict && !effectiveRevision(item) }">
      <div class="item-head">
        <div><span>{{ item.id }}</span><strong>{{ item.standard }}</strong><small>{{ item.method }} · 测试条件 {{ conditionOf(item) }}</small></div>
        <Tag v-if="item.conflict" value="两端并改·待选定" severity="danger" icon="pi pi-exclamation-triangle" />
        <Tag v-else-if="!effectiveRevision(item)" value="未选定·暂不参与判定" severity="warn" />
        <Tag v-else :value="`以${effectiveRevision(item)!.source === 'center' ? '中心' : '设备节点'} V${effectiveRevision(item)!.version} 参与判定`" severity="success" />
      </div>
      <div class="rev-grid">
        <div class="rev" :class="{ chosen: item.resolvedSource === 'center' }">
          <header><Tag value="中心记录" severity="info" /><small v-if="!item.center">尚无记录</small></header>
          <template v-if="item.center">
            <strong>{{ item.center.measured || '无实测数据' }}</strong>
            <Tag :value="item.center.status" :severity="item.center.status === '合格' ? 'success' : item.center.status === '不合格' ? 'danger' : 'warn'" />
            <p>{{ item.center.evidence || '—' }}</p>
            <span>{{ item.center.author }} · V{{ item.center.version }} · {{ fmt(item.center.recordedAt) }}</span>
            <div class="rev-actions"><Button label="中心更新" text size="small" @click="openRecord(item, 'center')" /><Button label="选定此记录" size="small" :disabled="item.resolvedSource === 'center'" @click="choose(item, 'center')" /></div>
          </template>
          <Button v-else label="补录中心记录" text size="small" @click="openRecord(item, 'center')" />
        </div>
        <div class="rev" :class="{ chosen: item.resolvedSource === 'node' }">
          <header><Tag value="设备节点本机" severity="contrast" /><small v-if="!item.node">尚无记录</small></header>
          <template v-if="item.node">
            <strong>{{ item.node.measured || '无实测数据' }}</strong>
            <Tag :value="item.node.status" :severity="item.node.status === '合格' ? 'success' : item.node.status === '不合格' ? 'danger' : 'warn'" />
            <p>{{ item.node.evidence || '—' }}</p>
            <span>{{ item.node.author }} · V{{ item.node.version }} · {{ fmt(item.node.recordedAt) }}</span>
            <div class="rev-actions"><Button label="本机复测" text size="small" @click="openRecord(item, 'node')" /><Button label="选定此记录" size="small" :disabled="item.resolvedSource === 'node'" @click="choose(item, 'node')" /></div>
          </template>
          <Button v-else label="补录本机记录" text size="small" @click="openRecord(item, 'node')" />
        </div>
      </div>
      <p v-if="item.resolvedBy" class="resolve-line">选定人 {{ item.resolvedBy }} · {{ fmt(item.resolvedAt) }}；双方原始实测与时间并列留存，不覆盖</p>
    </div>

    <div class="certificate-panel">
      <h3>证书与测试附件 · 换版历史</h3>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-block">
        <div class="certificate-current">
          <Tag :value="latestRevision(certificate).verified ? '已核验' : '待核验'" :severity="latestRevision(certificate).verified ? 'success' : 'danger'" />
          <strong>{{ certificate.name }}</strong>
          <span>{{ latestRevision(certificate).issuer }} · 有效期至 {{ latestRevision(certificate).expiresAt }}</span>
          <small>当前 V{{ latestRevision(certificate).version }}（共{{ certificate.history.length }}版）· {{ latestRevision(certificate).changedBy }} {{ fmt(latestRevision(certificate).changedAt) }}</small>
          <Button label="换版登记" text size="small" @click="openCert(certificate.id)" />
          <Button :label="latestRevision(certificate).verified ? '退回待核验' : '核验通过'" text size="small" :severity="latestRevision(certificate).verified ? 'warning' : 'success'" @click="toggleVerify(certificate.id, !latestRevision(certificate).verified)" />
        </div>
        <ol class="cert-history">
          <li v-for="rev in [...certificate.history].reverse()" :key="rev.version">
            <Tag :value="`V${rev.version}`" severity="secondary" />
            <span>{{ rev.issuer }} · 有效期至 {{ rev.expiresAt }} · {{ rev.verified ? '已核验' : '待核验' }}</span>
            <small>{{ rev.note }} · {{ fmt(rev.changedAt) }} · {{ rev.changedBy }}</small>
          </li>
        </ol>
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
    </div>

    <Dialog v-model:visible="recordVisible" :header="`${recordSource === 'node' ? '设备节点本机复测' : '中心记录更新'} · ${activeItem?.id ?? ''}`" modal :style="{ width: '620px' }">
      <div class="edit-grid">
        <label>状态<Select v-model="form.status" :options="statusOptions" /></label>
        <label>记录人<InputText v-model="form.author" /></label>
        <label>实测结果<InputText v-model="form.measured" /></label>
        <label>测试证据<InputText v-model="form.evidence" /></label>
        <label class="span2">测试条件<Textarea v-model="form.condition" rows="2" /></label>
      </div>
      <p class="dialog-hint">两端记录按实测时间并列保存；若回连合并后两端都已改动，将形成冲突，须由负责人选定后才参与完整性判定。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="recordVisible = false" /><Button label="保存本端 V+1" @click="saveRecord" /></template>
    </Dialog>

    <Dialog v-model:visible="certVisible" header="证书换版登记" modal :style="{ width: '580px' }">
      <div class="edit-grid">
        <label>签发机构<InputText v-model="certForm.issuer" /></label>
        <label>有效期至<InputText v-model="certForm.expiresAt" type="date" /></label>
        <label>核验结论<Select v-model="certForm.verified" :options="[{ label: '已核验', value: true }, { label: '待核验', value: false }]" /></label>
        <label>登记人<InputText v-model="certForm.by" /></label>
        <label class="span2">换版说明<Textarea v-model="certForm.note" rows="3" placeholder="例如：固件升级后换发新证" /></label>
      </div>
      <p class="dialog-hint">换版一经登记，同设备节点下的缺陷与当前有效签署快照立即失效，须重新核对后方可签署。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="certVisible = false" /><Button label="登记换版 V+1" severity="warning" @click="saveCert" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
