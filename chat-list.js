// ============================================
// chat-list.js  –  PlantiaWorld 채팅 목록
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    orderBy,
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

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

// ============================================
// 전역
// ============================================
let currentUser = null;
let unsubscribeChats = null;

// 채팅 데이터 캐시 (검색용)
let allChats = [];

// ============================================
// 인증 감지 → 채팅 목록 로드
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log('✅ 로그인:', user.uid);
        loadChatList();
        setupSearch();
    } else {
        console.log('❌ 로그인 필요');
        window.location.href = 'login.html';
    }
});

// ============================================
// 채팅 목록 실시간 수신
// ============================================
function loadChatList() {
    // participants 배열에 현재 uid가 포함된 채팅방 쿼리
    const chatsRef = collection(db, 'chats');
    const q = query(
        chatsRef,
        where('participants', 'array-contains', currentUser.uid),
        orderBy('updatedAt', 'desc')
    );

    unsubscribeChats = onSnapshot(q, async (snapshot) => {
        // 스켈레톤 숨기기
        document.getElementById('loadingState').style.display = 'none';

        if (snapshot.empty) {
            showEmpty();
            return;
        }

        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('chatCount').textContent = `${snapshot.docs.length}개`;

        // 각 채팅방 정보 병렬 fetch
        const chatItems = await Promise.all(
            snapshot.docs.map(chatDoc => buildChatItem(chatDoc))
        );

        // 캐시 저장 (검색용)
        allChats = chatItems.filter(Boolean);

        // 렌더링
        renderList(allChats);

    }, (error) => {
        console.error('❌ 채팅 목록 수신 실패:', error);
        document.getElementById('loadingState').style.display = 'none';

        // participants 필드가 없는 구형 데이터 → fallback 쿼리
        if (error.code === 'failed-precondition' || error.code === 'invalid-argument') {
            loadChatListFallback();
        } else {
            showEmpty('채팅 목록을 불러오는 데 실패했습니다.');
        }
    });
}

// ============================================
// Fallback: 구형 buyerId/sellerId 방식
// ============================================
async function loadChatListFallback() {
    console.log('⚠️ fallback 쿼리 사용 (buyerId/sellerId)');
    const chatsRef = collection(db, 'chats');

    // 구매자로 참여한 채팅
    const buyerQ   = query(chatsRef, where('buyerId',  '==', currentUser.uid), orderBy('updatedAt', 'desc'));
    // 판매자로 참여한 채팅
    const sellerQ  = query(chatsRef, where('sellerId', '==', currentUser.uid), orderBy('updatedAt', 'desc'));

    let merged = {};

    const handle = async (snapshot) => {
        await Promise.all(snapshot.docs.map(async (chatDoc) => {
            if (!merged[chatDoc.id]) {
                const item = await buildChatItem(chatDoc);
                if (item) merged[chatDoc.id] = item;
            }
        }));
        // updatedAt 내림차순 정렬
        allChats = Object.values(merged).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        if (allChats.length === 0) {
            showEmpty();
        } else {
            document.getElementById('emptyState').classList.add('hidden');
            document.getElementById('chatCount').textContent = `${allChats.length}개`;
            renderList(allChats);
        }
    };

    onSnapshot(buyerQ,  handle, console.error);
    onSnapshot(sellerQ, handle, console.error);
}

// ============================================
// 채팅방 아이템 데이터 조립
// ============================================
async function buildChatItem(chatDoc) {
    try {
        const chatData = chatDoc.data();
        const chatId   = chatDoc.id;

        // 상대방 uid 계산
        const participants = chatData.participants ||
            [chatData.buyerId, chatData.sellerId].filter(Boolean);
        const otherUid = participants.find(id => id !== currentUser.uid);

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
            } catch (_) { /* 조용히 fallback */ }
        }

        // 상품 정보 fetch
        let productTitle = '';
        let productThumb = '';

        if (chatData.productId) {
            try {
                const pSnap = await getDoc(doc(db, 'products', chatData.productId));
                if (pSnap.exists()) {
                    const p = pSnap.data();
                    productTitle = p.title || '';
                    productThumb = p.images?.[0] || '';
                }
            } catch (_) { /* 조용히 fallback */ }
        }

        // 읽지 않은 메시지 수
        const unread = chatData.unreadCount?.[currentUser.uid] || 0;

        // 마지막 메시지 시간
        const lastTime   = chatData.lastMessageTime || chatData.updatedAt || null;
        const updatedAtMs = lastTime?.toMillis?.() || 0;

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

    // 스켈레톤/기존 아이템 제거 (loadingState 제외하고 나머지 제거)
    Array.from(container.children).forEach(child => {
        if (child.id !== 'loadingState') child.remove();
    });

    if (items.length === 0) {
        showEmpty();
        return;
    }

    items.forEach(item => {
        const el = createChatElement(item);
        container.appendChild(el);
    });
}

// ============================================
// 채팅 카드 엘리먼트 생성
// ============================================
function createChatElement(item) {
    const div = document.createElement('div');
    div.className = 'chat-item flex items-center gap-3 px-4 py-4 cursor-pointer';
    div.setAttribute('data-chat-id',   item.chatId);
    div.setAttribute('data-search-key', `${item.otherName} ${item.productTitle}`.toLowerCase());

    div.innerHTML = `
        <!-- 상대방 프로필 사진 -->
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

        <!-- 텍스트 영역 -->
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
                <p class="text-xs text-gray-500 truncate">${escapeHtml(item.lastMessage) || '<em class="text-gray-400">메시지 없음</em>'}</p>
                ${item.unread > 0 ? `
                <span class="unread-badge">${item.unread > 99 ? '99+' : item.unread}</span>` : ''}
            </div>
        </div>
    `;

    // 클릭 → 채팅방으로 이동
    div.addEventListener('click', () => {
        window.location.href = `chat-room.html?id=${item.chatId}`;
    });

    return div;
}

// ============================================
// 검색 기능
// ============================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => {
        const keyword = input.value.trim().toLowerCase();
        if (!keyword) {
            renderList(allChats);
            return;
        }
        const filtered = allChats.filter(item =>
            `${item.otherName} ${item.productTitle}`.toLowerCase().includes(keyword)
        );
        renderList(filtered);
    });
}

// ============================================
// 유틸
// ============================================
function showEmpty(msg) {
    const emptyEl = document.getElementById('emptyState');
    emptyEl.classList.remove('hidden');
    if (msg) {
        emptyEl.querySelector('p').textContent = msg;
    }
    document.getElementById('chatCount').textContent = '';
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now  = new Date();
    const diffMs  = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH   = Math.floor(diffMs / 3600000);
    const diffD   = Math.floor(diffMs / 86400000);

    if (diffMin < 1)  return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffH   < 24) return `${diffH}시간 전`;
    if (diffD   < 7)  return `${diffD}일 전`;

    // 7일 이상: 날짜 표시
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
    if (unsubscribeChats) unsubscribeChats();
});
