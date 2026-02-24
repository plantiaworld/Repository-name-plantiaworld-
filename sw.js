// ====================================================
// 🌿 PlantiaWorld Service Worker  v2
// ====================================================

const CACHE_NAME   = 'plantiaworld-v2';
const STATIC_CACHE = 'plantiaworld-static-v2';

// 오프라인에서도 보여줄 핵심 페이지들
const CORE_PAGES = [
    '/',
    '/index.html',
    '/login.html',
    '/my-page.html',
    '/add-product.html',
    '/product-detail.html',
    '/edit-product.html',
    '/chat-room.html',
    '/chat-list.html',
    '/manifest.json',
];

// ====================================================
// 설치 이벤트
// ====================================================
self.addEventListener('install', (event) => {
    console.log('[SW] 설치 중...');
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(CORE_PAGES).catch(err => {
                console.warn('[SW] 일부 파일 캐싱 실패 (무시됨):', err);
            });
        })
    );
    self.skipWaiting();
});

// ====================================================
// 활성화 이벤트 – 오래된 캐시 정리
// ====================================================
self.addEventListener('activate', (event) => {
    console.log('[SW] 활성화 중...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE)
                    .map(name => {
                        console.log('[SW] 오래된 캐시 삭제:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    self.clients.claim();
});

// ====================================================
// 네트워크 요청 처리
// ====================================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Firebase / 외부 CDN은 네트워크로 직접 처리
    if (
        url.hostname.includes('firebase') ||
        url.hostname.includes('firestore') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('gstatic') ||
        url.hostname.includes('cloudflare') ||
        url.hostname.includes('tailwindcss') ||
        url.hostname.includes('fcm.google')
    ) {
        return;
    }

    // HTML 파일: Network First
    if (event.request.mode === 'navigate' ||
        event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const cloned = response.clone();
                    caches.open(STATIC_CACHE).then(cache => cache.put(event.request, cloned));
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request)
                        .then(cached => cached || caches.match('/index.html'));
                })
        );
        return;
    }

    // 기타 정적 파일: Cache First
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const cloned = response.clone();
                    caches.open(STATIC_CACHE).then(cache => cache.put(event.request, cloned));
                }
                return response;
            });
        })
    );
});

// ====================================================
// 푸시 알림 수신 (FCM이 아닌 순수 Web Push 방식 폴백)
// firebase-messaging-sw.js 가 처리하지 못한 경우 대비
// ====================================================
self.addEventListener('push', (event) => {
    let data = { title: '🌿 플랜티아월드', body: '새로운 채팅 메시지가 있습니다!', chatId: '' };

    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch (e) {
        console.warn('[SW] 알림 데이터 파싱 실패');
    }

    const clickUrl = data.chatId ? `/chat-room.html?id=${data.chatId}` : '/chat-list.html';

    const options = {
        body:    data.body,
        icon:    '/icons/icon-192x192.png',
        badge:   '/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        data:    { url: clickUrl },
        tag:     `chat-${data.chatId || 'new'}`,
        renotify: true,
        actions: [
            { action: 'open',  title: '채팅 열기' },
            { action: 'close', title: '닫기' },
        ],
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ====================================================
// 알림 클릭 처리
// ====================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'close') return;

    const targetUrl = event.notification.data?.url || '/chat-list.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('navigate' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// ====================================================
// 메시지 이벤트 – 앱에서 SW로 제어 신호 수신
// ====================================================
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
