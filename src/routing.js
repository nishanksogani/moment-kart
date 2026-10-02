export function currentRoute() {
  // Preserve links shared before the move from hash routes to real paths.
  if (window.location.hash.startsWith('#/')) {
    window.history.replaceState(null, '', window.location.hash.slice(1));
  }
  return window.location.pathname.replace(/\/$/, '') || '/';
}

export function go(path) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function interceptLink(event) {
  const link = event.target.closest?.('a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.hash || !/^\/(?:$|shop$|product\/|cart$|checkout$|orders$|profile$|auth$|admin\/|shipping$|returns$|privacy$|terms$)/.test(url.pathname)) return;
  event.preventDefault();
  go(url.pathname + url.search);
}
