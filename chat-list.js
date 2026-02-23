// ============================================
// chat-list.js  –  PlantiaWorld 채팅 목록
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    onSnapshot,
    doc,
    getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    getAuth,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// ============================================
// Firebase 초기화
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyAW_z3hoI9SZ1-hoxKVYBKs7rbdo8n6wdc",
    authDomain: "plantiaworld.firebaseapp.com",
    projectId: "plantiaworld",
    storageBucket: "plantiaworld.firebasestorage.app",
    messagingSenderId: "18112813073",
    appId: "1:18112813073:web:7247046c038a3831db79b0",
    measurementId: "G-8XSSM279KY",
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ============================================
// 전역
// ============================================
let currentUser = null;
let unsubSeller = null;
let unsubBuyer  = null;

// 판매자/구매자 채팅 각각 캐시 (index.html과 동일한 방식)
let sellerChats = [];
let buyerChats  = [];

// 검색용 전체 목록 캐시
let allChats = [];

// ============================================
// 인증 감지
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log('✅ 로그인:', user.uid);
        loadChatList(user.uid);
        setupSearch();
    } else {
        console.log('❌ 로그인 필요');
        window.location.href = 'login.html';
    }
});

// ============================================
// 채팅 목록 로드 (index.html과 동일: sellerId + buyerId 두 쿼리)
// ============================================
function loadChatList(uid) {
    const chatsRef = collection(db, 'chats');

    // --- 판매자로 참여한 채팅 ---
    const qSeller = query(chatsRef, where('sellerId', '==', uid));
    unsubSeller = onSnapshot(qSeller, async (snap) => {
        sellerChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await mergeAndRender(uid);
    }, (err) => {
        console.error('❌ 판매자 채팅 구독 오류:', err);
    });

    // --- 구매자로 참여한 채팅 ---
    const qBuyer = query(chatsRef, where('buyerId', '==', uid));
    unsubBuyer = onSnapshot(qBuyer, async (snap) => {
        buyerChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await mergeAndRender(uid);
    }, (err) => {
        console.error('❌ 구매자 채팅 구독 오류:', err);
    });
}

// ============================================
// 두 목록 합산 → 렌더링
// ============================================
async function mergeAndRender(uid) {
    // 스켈레톤 숨기기
    document.getElementById('loadingState').style.display = 'none';

    // 중복 제거
    const seen = new Set();
    const merged = [...sellerChats, ...buyerChats].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });

    if (merged.length === 0) {
        showEmpty();
        return;
    }

    // 최신 메시지 순 정렬
    merged.sort((a, b) => {
        const aT = a.lastMessageTime?.seconds || a.updatedAt?.seconds || 0;
        const bT = b.lastMessageTime?.seconds || b.updatedAt?.seconds || 0;
        return bT - aT;
    });

    // 상대방 정보 병렬 fetch
    const items = await Promise.all(merged.map(chat => buildChatItem(chat, uid)));
    allChats = items.filter(Boolean);

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('chatCount').textContent = `${allChats.length}개`;

    renderList(allChats);
}

// ============================================
// 채팅방 아이템 데이터 조립
// ============================================
async function buildChatItem(chatData, uid) {
    try {
        const chatId = chatData.id;

        // 상대방 uid
        const otherUid = chatData.sellerId === uid ? chatData.buyerId : chatData.sellerId;

        // 상대방 정보 fetch
        let otherName  = '알 수 없는 사용자';
        let otherPhoto = getDefaultAvatar();

        if (otherUid) {
            try {
                const userSnap = await getDoc(doc(db, 'users', otherUid));
                if (userSnap.exists()) {
                    const u = userSnap.data();
                    otherName  = u.displayName || u.username || u.nickname || u.email || otherName;
                    otherPhoto = u.profileImage || u.photoURL || otherPhoto;
                }
            } catch (_) {}
        }

        // 상품 정보 (chatData에 이미 있으면 재사용, 없으면 fetch)
        let productTitle = chatData.productTitle || '';
        let productThumb = chatData.productImage || '';

        if (!productTitle && chatData.productId) {
            try {
                const pSnap = await getDoc(doc(db, 'products', chatData.productId));
                if (pSnap.exists()) {
                    const p = pSnap.data();
                    productTitle = p.title      || '';
                    productThumb = p.images?.[0] || '';
                }
            } catch (_) {}
        }

        // 읽지 않은 메시지 수
        const unread = chatData.unreadCount?.[uid] || 0;

        // 시간
        const lastTime    = chatData.lastMessageTime || chatData.updatedAt || null;
        const updatedAtMs = lastTime?.toMillis?.() || (lastTime?.seconds ? lastTime.seconds * 1000 : 0);

        return {
            chatId,
            otherName,
            otherPhoto,
            productTitle,
            productThumb,
            lastMessage: chatData.lastMessage || '',
            updatedAtMs,
            lastTimeStr: formatTime(lastTime),
            unread,
        };
    } catch (e) {
        console.error('❌ buildChatItem 실패:', e);
        return null;
    }
}

// ============================================
// 목록 렌더링
// ============================================
function renderList(items) {
    const container = document.getElementById('chatList');

    // 기존 카드 제거 (loadingState 제외)
    Array.from(container.children).forEach(child => {
        if (child.id !== 'loadingState') child.remove();
    });

    if (items.length === 0) {
        showEmpty();
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    items.forEach(item => {
        container.appendChild(createChatElement(item));
    });
}

// ============================================
// 채팅 카드 엘리먼트 생성
// ============================================
function createChatElement(item) {
    const div = document.createElement('div');
    div.className = 'chat-item flex items-center gap-3 px-4 py-4 cursor-pointer';
    div.setAttribute('data-search-key', `${item.otherName} ${item.productTitle}`.toLowerCase());

    div.innerHTML = `
        <div class="relative flex-shrink-0">
            <img
                src="${escapeHtml(item.otherPhoto)}"
                class="w-14 h-14 rounded-full object-cover border border-gray-100"
                onerror="this.src='${getDefaultAvatar()}'"
                alt="프로필"
            >
            ${item.productThumb ? `
            <img
                src="${escapeHtml(item.productThumb)}"
                class="absolute -bottom-1 -right-1 w-6 h-6 rounded-md object-cover border-2 border-white"
                onerror="this.style.display='none'"
                alt="상품"
            >` : ''}
        </div>

        <div class="flex-1 min-w-0">
            <div class="flex items-baseline justify-between mb-0.5">
                <span class="font-bold text-gray-800 text-sm truncate">${escapeHtml(item.otherName)}</span>
                <span class="text-[11px] text-gray-400 ml-2 flex-shrink-0">${escapeHtml(item.lastTimeStr)}</span>
            </div>
            ${item.productTitle ? `
            <p class="text-[11px] text-green-600 font-medium truncate mb-0.5">
                <i class="fas fa-leaf mr-1"></i>${escapeHtml(item.productTitle)}
            </p>` : ''}
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-gray-500 truncate">${item.lastMessage ? escapeHtml(item.lastMessage) : '<em class="text-gray-400">메시지 없음</em>'}</p>
                ${item.unread > 0 ? `
                <span class="unread-badge">${item.unread > 99 ? '99+' : item.unread}</span>` : ''}
            </div>
        </div>
    `;

    div.addEventListener('click', () => {
        window.location.href = `chat-room.html?id=${item.chatId}`;
    });

    return div;
}

// ============================================
// 검색
// ============================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => {
        const keyword = input.value.trim().toLowerCase();
        if (!keyword) {
            renderList(allChats);
            return;
        }
        renderList(allChats.filter(item =>
            `${item.otherName} ${item.productTitle}`.toLowerCase().includes(keyword)
        ));
    });
}

// ============================================
// 유틸
// ============================================
function showEmpty(msg) {
    const el = document.getElementById('emptyState');
    el.classList.remove('hidden');
    if (msg) el.querySelector('p').textContent = msg;
    document.getElementById('chatCount').textContent = '';
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
    const now   = new Date();
    const diffMs  = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH   = Math.floor(diffMs / 3600000);
    const diffD   = Math.floor(diffMs / 86400000);

    if (diffMin < 1)  return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffH   < 24) return `${diffH}시간 전`;
    if (diffD   < 7)  return `${diffD}일 전`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getDefaultAvatar() {
    return "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2256%22%20height%3D%2256%22%20viewBox%3D%220%200%2056%2056%22%3E%3Ccircle%20cx%3D%2228%22%20cy%3D%2228%22%20r%3D%2228%22%20fill%3D%22%2310b981%22%2F%3E%3Ccircle%20cx%3D%2228%22%20cy%3D%2221%22%20r%3D%2211%22%20fill%3D%22white%22%2F%3E%3Cellipse%20cx%3D%2228%22%20cy%3D%2249%22%20rx%3D%2217%22%20ry%3D%2211%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E";
}

// 페이지 언로드 시 구독 해제
window.addEventListener('beforeunload', () => {
    if (unsubSeller) unsubSeller();
    if (unsubBuyer)  unsubBuyer();
});
