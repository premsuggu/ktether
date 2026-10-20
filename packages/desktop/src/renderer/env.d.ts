import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly KTETHER_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __KTETHER__?: {
      deepLinks?: string[]
    }
  }
}
