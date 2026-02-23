// ====================================================
// 🌿 PlantiaWorld Service Worker
// ====================================================

const CACHE_NAME = 'plantiaworld-v1';
const STATIC_CACHE = 'plantiaworld-static-v1';

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
  '/support.html',
  '/privacy.html',
  '/terms.html',
  '/manifest.json'
];

// ====================================================
// 설치 이벤트 - 핵심 파일 캐싱
// ====================================================
self.addEventListener('install', (event) => {
  console.log('[SW] 설치 중...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] 핵심 파일 캐싱 완료');
      return cache.addAll(CORE_PAGES).catch(err => {
        console.warn('[SW] 일부 파일 캐싱 실패 (무시됨):', err);
      });
    })
  );
  self.skipWaiting();
});

// ====================================================
// 활성화 이벤트 - 오래된 캐시 정리
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
// 네트워크 요청 처리 - Network First 전략
// Firebase 요청: 항상 네트워크 우선
// 정적 파일: 캐시 우선 (오프라인 대응)
// ====================================================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Firebase, 외부 CDN은 그냥 네트워크로
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('cloudflare') ||
    url.hostname.includes('tailwindcss')
  ) {
    return;
  }

  // HTML 파일: Network First (최신 내용 우선, 실패시 캐시)
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const cloned = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            return cached || caches.match('/index.html');
          });
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
// 푸시 알림 수신 처리
// ====================================================
self.addEventListener('push', (event) => {
  let data = { title: '🌿 플랜티아월드', body: '새로운 알림이 있어요!' };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.warn('[SW] 알림 데이터 파싱 실패');
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/index.html' },
    actions: [
      { action: 'open', title: '확인하기' },
      { action: 'close', title: '닫기' }
    ]
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

  const targetUrl = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
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
