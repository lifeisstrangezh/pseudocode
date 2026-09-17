import router from './index'
import type { RouteLocationNormalized, NavigationGuardNext } from 'vue-router'

router.beforeEach(
  async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
    // TODO
    next()
  }
)

export default router
