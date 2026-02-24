// ============================================
// firebase-messaging-sw.js
// PlantiaWorld – FCM 백그라운드 메시지 처리
// ⚠️ 이 파일은 반드시 루트(/)에 위치해야 합니다
// ============================================

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAW_z3hoI9SZ1-hoxKVYBKs7rbdo8n6wdc",
    authDomain: "plantiaworld.firebaseapp.com",
    projectId: "plantiaworld",
    storageBucket: "plantiaworld.firebasestorage.app",
    messagingSenderId: "18112813073",
    appId: "1:18112813073:web:7247046c038a3831db79b0",
    measurementId: "G-8XSSM279KY",
});

const messaging = firebase.messaging();

// ============================================
// 백그라운드 메시지 처리
// (앱이 닫혀있거나 백그라운드일 때 FCM 서버가 발송한 알림)
// ============================================
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM SW] 백그라운드 메시지 수신:', payload);

    const title = payload.notification?.title || '🌿 플랜티아월드';
    const body  = payload.notification?.body  || '새로운 메시지가 있습니다.';
    const chatId  = payload.data?.chatId || '';
    const clickUrl = chatId ? `/chat-room.html?id=${chatId}` : '/chat-list.html';

    const options = {
        body,
        icon:  '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        data: { url: clickUrl },
        actions: [
            { action: 'open',  title: '채팅 열기' },
            { action: 'close', title: '닫기' },
        ],
        tag: `chat-${chatId || 'new'}`,   // 같은 채팅방 알림은 덮어씀
        renotify: true,
    };

    return self.registration.showNotification(title, options);
});

// ============================================
// 알림 클릭 처리
// ============================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'close') return;

    const targetUrl = event.notification.data?.url || '/chat-list.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // 이미 열려있는 탭이 있으면 해당 탭으로 이동
            for (const client of clientList) {
                if ('navigate' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            // 없으면 새 탭 열기
            return clients.openWindow(targetUrl);
        })
    );
});
