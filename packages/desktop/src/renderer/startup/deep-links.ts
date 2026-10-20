import type { ElectronAPI } from "../api-types"

const deepLinkEvent = "ktether:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__KTETHER__ ??= {}
  window.__KTETHER__.deepLinks = [...(window.__KTETHER__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
