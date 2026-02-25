// ============================================
// notifications.js  –  PlantiaWorld 알림 유틸 (V1 방식)
// ============================================
// ✅ FCM V1 API 대응 버전
//    - 서버 키(레거시) 불필요
//    - VAPID 키 1개만 필요
//    - 실제 알림 발송은 Cloud Functions(functions/index.js)가 처리
//    - 이 파일은 "브라우저에서 FCM 토큰 발급 + 포그라운드 수신" 만 담당
// ============================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    doc,
    updateDoc,
    arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const VAPID_KEY = 'BCzKbFzkoRHIX1qWuBOlZtTNDqm4DOnSW7OEiRfD2MnAcigf7HXHQkdZJpXpUnETP0t8azfP4UYwqEhqDM1pTDg';

const firebaseConfig = {
    apiKey: "AIzaSyAW_z3hoI9SZ1-hoxKVYBKs7rbdo8n6wdc",
    authDomain: "plantiaworld.firebaseapp.com",
    projectId: "plantiaworld",
    storageBucket: "plantiaworld.firebasestorage.app",
    messagingSenderId: "18112813073",
    appId: "1:18112813073:web:7247046c038a3831db79b0",
    measurementId: "G-8XSSM279KY",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

let messagingInstance = null;

// ============================================
// ✅ FIX: getMessaging을 동적 import로 처리
//    SW 없거나 HTTP 환경이면 조용히 null 반환
// ============================================
async function getMessagingInstance() {
    if (messagingInstance) return messagingInstance;

    if (!('serviceWorker' in navigator)) {
        console.warn('⚠️ Service Worker 미지원 - FCM 불가');
        return null;
    }

    const swRegs = await navigator.serviceWorker.getRegistrations();
    if (!swRegs || swRegs.length === 0) {
        console.warn('⚠️ Service Worker 미등록 - FCM 초기화 건너뜀');
        return null;
    }

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    if (!isSecure) {
        console.warn('⚠️ HTTPS 필요 - FCM 불가');
        return null;
    }

    try {
        const { getMessaging } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
        messagingInstance = getMessaging(app);
        return messagingInstance;
    } catch (e) {
        console.warn('⚠️ Firebase Messaging 로드 실패:', e.message);
        return null;
    }
}

export async function initNotifications(uid) {
    if (!('Notification' in window)) return null;
    if (VAPID_KEY === 'YOUR_VAPID_KEY_HERE') return null;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        const messaging = await getMessagingInstance();
        if (!messaging) return null;

        const { getToken } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (!token) return null;

        console.log('✅ FCM 토큰 발급 성공:', token.substring(0, 20) + '...');

        await updateDoc(doc(db, 'users', uid), {
            fcmTokens: arrayUnion(token),
            notificationEnabled: true,
        });

        console.log('✅ FCM 토큰 Firestore 저장 완료');
        return token;
    } catch (err) {
        console.error('❌ FCM 초기화 실패:', err);
        return null;
    }
}

export async function listenForegroundMessages(onReceive) {
    const messaging = await getMessagingInstance();
    if (!messaging) return;

    try {
        const { onMessage } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
        onMessage(messaging, (payload) => {
            console.log('📨 포그라운드 메시지 수신:', payload);
            onReceive && onReceive(payload);
        });
    } catch (e) {
        console.warn('⚠️ 포그라운드 메시지 리스너 등록 실패:', e.message);
    }
}

export function showInAppNotification({ title, body, chatId, avatarUrl }) {
    document.querySelectorAll('.plantia-notif-toast').forEach(n => n.remove());

    const toast = document.createElement('div');
    toast.className = 'plantia-notif-toast';
    toast.style.cssText = `
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        padding: 14px 18px; display: flex; align-items: center; gap: 12px;
        z-index: 99999; max-width: 360px; width: calc(100vw - 32px);
        cursor: pointer; border: 1px solid #e5e7eb;
        animation: notifSlideIn 0.3s ease;
    `;

    const safeAvatarUrl = avatarUrl ? escapeStr(avatarUrl) : '';
    const avatar = safeAvatarUrl
        ? `<img src="${safeAvatarUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
        : `<div style="width:40px;height:40px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-size:18px;">🌿</span></div>`;

    toast.innerHTML = `
        <style>@keyframes notifSlideIn {
            from { transform:translateX(-50%) translateY(-20px); opacity:0; }
            to   { transform:translateX(-50%) translateY(0); opacity:1; }
        }</style>
        ${avatar}
        <div style="flex:1;min-width:0;">
            <p style="font-size:13px;font-weight:700;color:#111827;margin:0 0 2px;">${escapeStr(title)}</p>
            <p style="font-size:12px;color:#6b7280;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeStr(body)}</p>
        </div>
        <button onclick="this.parentElement.remove()"
                style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;flex-shrink:0;">×</button>
    `;

    if (chatId) {
        toast.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                window.location.href = `chat-room.html?id=${chatId}`;
            }
        });
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function escapeStr(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
