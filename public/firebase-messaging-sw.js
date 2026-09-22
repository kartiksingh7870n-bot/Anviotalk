importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU",
  authDomain: "anvio-talk.firebaseapp.com",
  projectId: "anvio-talk",
  storageBucket: "anvio-talk.firebasestorage.app",
  messagingSenderId: "1059844371114",
  appId: "1:1059844371114:web:0ab0d9be1f9327274216d3"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message received:', payload);
  const title = payload.notification?.title || payload.data?.title || 'AnvioTalk Message';
  const options = {
    body: payload.notification?.body || payload.data?.body || 'New interaction on AnvioTalk',
    icon: payload.notification?.icon || payload.data?.icon || 'https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png',
    badge: 'https://res.cloudinary.com/dpvpnwhm4/image/upload/v1785045725/Anvio_Talk_logo_ofe2a0.png',
    data: payload.data || {}
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payloadData = event.notification.data || {};

  let targetUrl = '/';
  if (payloadData.chatId || payloadData.groupId) {
    targetUrl = `/group/${encodeURIComponent(payloadData.chatId || payloadData.groupId)}`;
  } else if (payloadData.profileId) {
    targetUrl = `/profile/${encodeURIComponent(payloadData.profileId)}`;
  } else if (payloadData.url) {
    targetUrl = payloadData.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          client.postMessage({
            type: 'NAVIGATE_DEEPLINK',
            url: targetUrl,
            data: payloadData
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
