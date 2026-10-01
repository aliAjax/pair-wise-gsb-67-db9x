<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { AcceptanceDefect, PartyReply } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selected = ref<AcceptanceDefect | null>(null)
const replyVisible = ref(false)
const retestVisible = ref(false)
const recheckVisible = ref(false)
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive({ result: '', passed: true, note: '' })
const recheck = reactive({ note: '' })
const rows = computed(() => store.defects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status} ${item.staleReason}`.includes(store.keyword)))

function open(defect: AcceptanceDefect) { selected.value = defect }
function fmt(time: string) { return time ? time.replace('T', ' ').slice(0, 16) : '—' }
function equipmentName(id: string) { return store.equipment.find((item) => item.id === id)?.code ?? id }

function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2500 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value) return
  const result = store.addRetest(selected.value.id, retest.result, retest.passed)
  if (!result.ok) { toast.add({ severity: 'error', summary: result.message, life: 2500 }); return }
  toast.add({
    severity: result.conclusionChanged ? 'warn' : retest.passed ? 'success' : 'warn', life: 4200,
    summary: result.conclusionChanged ? '复测结论变化，缺陷与签署快照已失效' : retest.passed ? '复验通过，缺陷已关闭' : '复验未通过，返回整改',
    detail: result.conclusionChanged ? '请负责人按最新结论重新核对' : undefined
  })
  retestVisible.value = false
}
function submitRecheck() {
  if (!selected.value) return
  const result = store.recheckDefect(selected.value.id, recheck.note)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
  if (result.ok) recheckVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
</script>

<template>
  <section class="page">
    <div class="section-head"><div><h2>缺陷闭环处置</h2><p>证书换版或复测结论变化时，相关缺陷立即失效并须重新核对；建设、厂家、运维多方说明，负责人决定闭环。</p></div><InputText v-model="store.keyword" placeholder="搜索缺陷、责任方、状态或失效原因" /></div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" />
      <Column field="title" header="缺陷" />
      <Column header="设备"><template #body="{ data }">{{ equipmentName(data.equipmentId) }}</template></Column>
      <Column field="severity" header="严重度"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" />
      <Column field="dueDate" header="截止" />
      <Column header="失效/状态">
        <template #body="{ data }">
          <Tag v-if="data.stale" value="待重新核对" severity="danger" icon="pi pi-lock" />
          <Tag v-else :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" />
        </template>
      </Column>
      <Column header="版本"><template #body="{ data }">V{{ data.version }}</template></Column>
    </DataTable>
    <div v-if="selected" class="detail-panel">
      <div class="detail-title">
        <div><span>{{ selected.id }} · {{ equipmentName(selected.equipmentId) }} · 关联验收项 {{ selected.itemId }}</span><h3>{{ selected.title }}</h3></div>
        <div>
          <Button label="多方回复" outlined @click="replyVisible = true" />
          <Button label="联合复验" @click="retestVisible = true" />
          <Button v-if="selected.stale" label="重新核对" severity="warning" @click="recheckVisible = true" />
        </div>
      </div>

      <div v-if="selected.stale" class="stale-band">
        <Tag value="已失效·待重新核对" severity="danger" icon="pi pi-exclamation-triangle" />
        <div><strong>自 {{ fmt(selected.staleSince) }} 起，该缺陷的核对结论失效</strong><p v-for="(reason, index) in selected.staleReason.split('；')" :key="index">{{ reason }}</p></div>
      </div>
      <div v-else-if="selected.recheckedAt" class="recheck-band">
        <Tag value="已重新核对" severity="success" />
        <span>{{ selected.recheckedBy }} · {{ fmt(selected.recheckedAt) }} · {{ selected.recheckNote }}</span>
      </div>

      <div class="retest-list">
        <h4>联合复测轮次</h4>
        <div v-for="rt in selected.retests" :key="rt.round" class="retest-row">
          <Tag :value="`第${rt.round}轮`" severity="secondary" />
          <Tag :value="rt.passed ? '通过' : '不通过'" :severity="rt.passed ? 'success' : 'danger'" />
          <span>{{ rt.result }}</span><small>{{ rt.tester }} · {{ fmt(rt.testedAt) }}</small>
        </div>
        <p v-if="!selected.retests.length">尚无复测记录。</p>
      </div>

      <div class="reply-list"><article v-for="item in selected.replies" :key="`${item.party}-${item.repliedAt}`"><Tag :value="item.party" /><strong>{{ item.owner }}</strong><p>{{ item.content }}</p><span>{{ item.evidence }} · {{ fmt(item.repliedAt) }}</span></article></div>
      <div class="decision-band">
        <Textarea v-model="retest.note" rows="2" placeholder="验收决定说明，带条件接受时必须填写限制条件" />
        <Button label="通过并关闭" :disabled="selected.stale" @click="decide('已关闭')" />
        <Button label="带条件接受" severity="secondary" outlined :disabled="selected.stale" @click="decide('带条件通过')" />
        <Button label="退回整改" severity="danger" outlined :disabled="selected.stale" @click="decide('整改中')" />
      </div>
      <p v-if="selected.stale" class="decision-hint">失效期间禁止作验收决定，请先按换版证书与最新复测结论完成重新核对。</p>
    </div>

    <Dialog v-model:visible="replyVisible" header="提交多方处理说明" modal :style="{ width: '580px' }">
      <div class="edit-grid">
        <label>责任方<Select v-model="reply.party" :options="['建设单位', '设备厂家', '运维单位']" /></label>
        <label>回复人<InputText v-model="reply.owner" /></label>
        <label class="span2">处理说明<Textarea v-model="reply.content" rows="4" /></label>
        <label class="span2">证据附件<InputText v-model="reply.evidence" placeholder="整改记录或报告名称" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="replyVisible = false" /><Button label="提交并进入复验" @click="submitReply" /></template>
    </Dialog>
    <Dialog v-model:visible="retestVisible" header="登记联合复验" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label class="span2">复验结果<Textarea v-model="retest.result" rows="4" /></label><label>结论<Select v-model="retest.passed" :options="[{ label: '通过', value: true }, { label: '不通过', value: false }]" /></label></div>
      <p class="dialog-hint">结论相对上一轮（通过↔不通过）一旦变化，缺陷与有效签署快照立即失效。</p>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复验轮次" @click="submitRetest" /></template>
    </Dialog>
    <Dialog v-model:visible="recheckVisible" header="按最新证书与复测结论重新核对" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label class="span2">核对意见<Textarea v-model="recheck.note" rows="4" placeholder="说明已核对换版证书/最新复测结论及核对结果" /></label></div>
      <template #footer><Button label="取消" text severity="secondary" @click="recheckVisible = false" /><Button label="确认重新核对" severity="warning" @click="submitRecheck" /></template>
    </Dialog>
  </section>
</template>
