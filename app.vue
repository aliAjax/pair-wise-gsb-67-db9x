<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import { useAcceptanceStore } from './stores/acceptance'
import { SIDE_LABEL } from './services/chain'

const route = useRoute()
const store = useAcceptanceStore()
const title = computed(() => route.path.startsWith('/equipment') ? '设备树与验收项' : route.path.startsWith('/defects') ? '缺陷闭环处置' : route.path.startsWith('/audit') ? '签署与审计' : '并网验收总览')
const signingFailed = computed(() => store.signState.phase === 'failed')
const signingStale = computed(() => store.signState.record?.stale)
onMounted(() => store.hydrate())
</script>

<template>
  <div class="app-shell">
    <aside>
      <div class="brand"><b>光</b><div><strong>并网验收工作台</strong><small>设备、测试、证书与缺陷闭环</small></div></div>
      <div class="link-band" :class="store.online ? 'online' : 'offline'">
        <div><span class="dot"></span><strong>{{ store.online ? '在线·中心已连接' : '断网·离线复测中' }}</strong></div>
        <Button size="small" :label="store.online ? '模拟断网' : '回连并合并'" :severity="store.online ? 'secondary' : 'warn'" @click="store.setOnline(!store.online)" />
      </div>
      <nav>
        <NuxtLink to="/"><span>验收总览</span><small>{{ store.stats.total }}项</small></NuxtLink>
        <NuxtLink to="/equipment"><span>设备与测试</span><small>{{ store.stats.conflicts }}冲突</small></NuxtLink>
        <NuxtLink to="/defects"><span>缺陷闭环</span><small>{{ store.stats.staleDefects }}失效</small></NuxtLink>
        <NuxtLink to="/audit"><span>签署与审计</span><small>{{ signingFailed ? '写入失败' : signingStale ? '签署失效' : `V${store.plant.version}` }}</small></NuxtLink>
      </nav>
      <div class="aside-state">
        <span>当前录入端</span>
        <div class="side-switch">
          <button :class="{ active: store.activeSide === 'node' }" @click="store.setActiveSide('node')">设备节点</button>
          <button :class="{ active: store.activeSide === 'center' }" @click="store.setActiveSide('center')">中心记录</button>
        </div>
        <small>录入实测将标记为「{{ SIDE_LABEL[store.activeSide] }}」并带本机时间</small>
        <span style="margin-top:8px">并网前完整性检查</span>
        <strong :class="{ alert: !store.preflight.allowed }">{{ store.preflight.allowed ? '允许申请复核' : `${store.preflight.blocking.length}项阻断` }}</strong>
        <small>{{ store.plant.name }}</small>
      </div>
    </aside>
    <main>
      <header class="top">
        <div><span>电站工程中心 / 验收与交付</span><h1>{{ title }}</h1></div>
        <div class="top-user"><small>验收负责人</small><strong>陆川</strong></div>
      </header>
      <NuxtPage />
    </main>
    <Toast position="top-right" />
  </div>
</template>
