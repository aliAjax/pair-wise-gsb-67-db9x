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
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive({ result: '', passed: true, note: '' })
const rows = computed(() => store.defects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status}`.includes(store.keyword)))
function open(defect: AcceptanceDefect) { selected.value = defect }
function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2500 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value) return
  const result = store.addRetest(selected.value.id, retest.result, retest.passed)
  toast.add({ severity: result.ok ? (result.message.includes('翻转') ? 'warn' : 'success') : 'error', summary: result.message, life: 3200 })
  retestVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function recheck() {
  if (!selected.value) return
  const result = store.recheckDefect(selected.value.id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3500 })
}
const certOf = (certId: string) => store.equipment.flatMap((node) => node.certificates.map((cert) => ({ node, cert }))).find((item) => item.cert.id === certId)
</script>

<template>
  <section class="page">
    <div class="section-head">
      <div><h2>缺陷闭环处置</h2><p>证书换版或复测结论一变，缺陷闭环快照随即失效，须重新核对通过才允许并网签署。</p></div>
      <InputText v-model="store.keyword" placeholder="搜索缺陷、责任方或状态" />
    </div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" style="width:130px" />
      <Column field="title" header="缺陷" />
      <Column field="equipmentId" header="设备" style="width:100px" />
      <Column header="严重度" style="width:80px"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" style="width:100px" />
      <Column field="dueDate" header="截止" style="width:100px" />
      <Column header="状态" style="width:110px"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" /></template></Column>
      <Column header="闭环快照" style="width:130px">
        <template #body="{ data }">
          <Tag v-if="!['已关闭', '带条件通过'].includes(data.status)" value="未闭环" severity="secondary" />
          <Tag v-else-if="data.valid" value="快照有效" severity="success" />
          <Tag v-else value="失效待核对" severity="danger" />
        </template>
      </Column>
      <Column header="版本" style="width:60px"><template #body="{ data }">V{{ data.version }}</template></Column>
    </DataTable>

    <div v-if="selected" class="detail-panel">
      <div class="detail-title">
        <div><span>{{ selected.id }} · {{ selected.equipmentId }}</span><h3>{{ selected.title }}</h3></div>
        <div>
          <Button label="多方回复" outlined @click="replyVisible = true" />
          <Button label="联合复测" @click="retestVisible = true" />
          <Button v-if="!selected.valid && ['已关闭', '带条件通过'].includes(selected.status)" label="重新核对" severity="warning" @click="recheck" />
        </div>
      </div>

      <div v-if="!selected.valid" class="invalid-band">
        <strong>闭环快照已失效，待重新核对：</strong>
        <ul><li v-for="reason in selected.invalidReasons" :key="reason">{{ reason }}</li></ul>
      </div>

      <div class="snapshot-grid">
        <div>
          <span>绑定证书版本快照</span>
          <article v-for="ref in selected.certRefs" :key="ref.certId" class="cert-ref">
            <Tag v-if="certOf(ref.certId)?.cert.version === ref.version && certOf(ref.certId)?.cert.verified" value="版本一致" severity="success" />
            <Tag v-else value="版本漂移/待核" severity="danger" />
            <strong>{{ ref.certName }}</strong>
            <small>快照绑定 V{{ ref.version }} · 当前 V{{ certOf(ref.certId)?.cert.version ?? '—' }} · {{ certOf(ref.certId)?.cert.verified ? '已核验' : '待核验' }}</small>
          </article>
        </div>
        <div>
          <span>复测结论链</span>
          <article v-for="round in [...selected.retests].reverse()" :key="round.round" class="retest-ref">
            <Tag :value="round.passed ? '通过' : '未通过'" :severity="round.passed ? 'success' : 'danger'" />
            <strong>第{{ round.round }}轮 · {{ round.testedAt.replace('T', ' ').slice(0, 16) }}</strong>
            <small>{{ round.result }} · {{ round.tester }}</small>
          </article>
          <p v-if="!selected.retests.length" class="empty-hint">尚无复测轮次</p>
        </div>
      </div>

      <div class="reply-list">
        <article v-for="item in selected.replies" :key="item.repliedAt"><Tag :value="item.party" /><strong>{{ item.owner }}</strong><p>{{ item.content }}</p><span>{{ item.evidence }} · {{ item.repliedAt.replace('T', ' ').slice(0, 16) }}</span></article>
      </div>
      <div class="decision-band">
        <Textarea v-model="retest.note" rows="2" placeholder="验收决定说明，带条件接受时必须填写限制条件" />
        <Button label="通过并关闭（冻结证书版本）" @click="decide('已关闭')" />
        <Button label="带条件接受" severity="secondary" outlined @click="decide('带条件通过')" />
        <Button label="退回整改" severity="danger" outlined @click="decide('整改中')" />
      </div>
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
    <Dialog v-model:visible="retestVisible" header="登记联合复测（结论翻转将使闭环快照失效）" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label class="span2">复测结果<Textarea v-model="retest.result" rows="4" /></label><label>结论<Select v-model="retest.passed" :options="[{ label: '通过', value: true }, { label: '不通过', value: false }]" optionLabel="label" optionValue="value" /></label></div>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复测轮次" @click="submitRetest" /></template>
    </Dialog>
  </section>
</template>
