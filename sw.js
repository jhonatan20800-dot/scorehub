self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(_) {}
  const title = data.title || 'ScoreHub';
  const body  = data.body  || 'Atualização de jogo';
  e.waitUntil(self.registration.showNotification(title, { body }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:'window' }).then(clients => {
    for (const c of clients) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  }));
});
