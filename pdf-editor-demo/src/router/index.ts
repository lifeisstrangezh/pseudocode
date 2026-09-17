import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { basePath } from '@/language'

// 定义路由规则
const routes = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/home',
    name: 'Home',
    meta: {
      title: '首页',
      requireAuth: false
    },
    component: () => import('@/views/home/Home.vue')
  },
  {
    path: '/:type',
    name: 'DynamicContainer',
    meta: {
      title: '转换分发容器',
      requireAuth: false
    },
    component: () => import('@/views/convert/DynamicContainer.vue')
  },
  {
    path: '/share/view/:id',
    name: 'ShareView',
    meta: {
      title: '分享预览页',
      requireAuth: false
    },
    component: () => import('@/views/view/View.vue')
  },
  {
    path: '/view/:id',
    name: 'View',
    meta: {
      title: '文件预览页',
      requireAuth: false
    },
    component: () => import('@/views/view/View.vue')
  },
  {
    path: '/tasklist',
    name: 'Task',
    meta: {
      title: '任务中心页',
      requireAuth: false
    },
    component: () => import('@/views/task/Task.vue')
  },
  {
    path: '/404',
    name: '404',
    meta: {
      title: '404',
      requireAuth: false
    },
    component: () => import('@/views/notFind/404.vue')
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(basePath),
  routes: routes as RouteRecordRaw[]
})

export default router
