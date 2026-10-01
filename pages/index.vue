<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import { useAcceptanceStore } from '../stores/acceptance'
import { loadEquipmentSnapshot } from '../services/api'
import { effectiveRevision, mergeStatus } from '../services/chain'

const store = useAcceptanceStore()
const { isFetching } = useQuery({ queryKey: ['equipment-snapshot'], queryFn: () => loadEquipmentSnapshot(store.equipment), staleTime: 60000 })
const passedCount = (items: any[]) => items.filter((item) => effectiveRevision(item)?.status === '合格').length
const conflictCount = (items: any[]) => items.filter((item) => mergeStatus(item) === 'conflict').length
const rows = computed(() => store.equipment.filter((node) => {
  const items = node.items.map((item) => `${item.id} ${item.standard} ${effectiveRevision(item)?.status ?? ''}`).join(' ')
  return !store.keyword || `${node.id} ${node.name} ${node.code} ${node.type} ${items}`.includes(store.keyword)
}))
const navigate = (id: string) => navigateTo(`/equipment/${id}`)
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article><span>验收项</span><strong>{{ store.stats.total }}</strong><small>双端记录按时间并列</small></article>
      <article><span>已合格（有效记录）</span><strong>{{ store.stats.passed }}</strong><small>冲突项裁定后才计入</small></article>
      <article><span>双端冲突待裁定</span><strong :class="{ danger: store.stats.conflicts }">{{ store.stats.conflicts }}</strong><small>阻断完整性判定</small></article>
      <article><span>未闭环 / 失效快照</span><strong>{{ store.stats.openDefects }} / {{ store.stats.staleDefects }}</strong><small>证书换版或复测翻转联动</small></article>
    </div>
    <div class="toolbar">
      <InputText v-model="store.keyword" placeholder="搜索设备、编号、验收项或状态" />
      <span>{{ isFetching ? '正在同步' : store.online ? '在线·中心已连接' : '断网·设备节点离线记录中，回连后按时间合并' }}</span>
      <Button label="恢复演示数据" severity="secondary" outlined @click="store.reset" />
    </div>
    <DataTable :value="rows" dataKey="id" size="small" stripedRows>
      <Column field="id" header="设备节点" />
      <Column field="name" header="名称" />
      <Column field="type" header="类型" />
      <Column field="code" header="编码" />
      <Column header="验收项">
        <template #body="{ data }">{{ passedCount(data.items) }} / {{ data.items.length }} 合格 · {{ conflictCount(data.items) }} 冲突</template>
      </Column>
      <Column header="证书">
        <template #body="{ data }">{{ data.certificates.length }}份 · {{ data.certificates.filter((item: any) => !item.verified).length }}份待核</template>
      </Column>
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已验收' ? 'success' : data.status === '验收中' ? 'warn' : 'secondary'" /></template></Column>
      <Column header=""><template #body="{ data }"><Button label="打开" text @click="navigate(data.id)" /></template></Column>
    </DataTable>
  </section>
</template>
