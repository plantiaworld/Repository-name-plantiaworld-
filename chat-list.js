// ============================================
// chat-list.js  –  PlantiaWorld 채팅 목록
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
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

let allChats = [];

// ============================================
// 인증 감지
// ============================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log('✅ 로그인 확인:', user.uid);
        await loadChatList(user.uid);
        setupSearch();
    } else {
        console.log('❌ 로그인 필요');
        window.location.href = 'login.html';
    }
});

// ============================================
// 채팅 목록 로드 (getDocs 방식 - 간단하고 확실)
// ============================================
async function loadChatList(uid) {
    try {
        const chatsRef = collection(db, 'chats');

        // 판매자 채팅 가져오기
        const sellerSnap = await getDocs(query(chatsRef, where('sellerId', '==', uid)));
        console.log('📦 판매자 채팅 수:', sellerSnap.size);

        // 구매자 채팅 가져오기
        const buyerSnap  = await getDocs(query(chatsRef, where('buyerId',  '==', uid)));
        console.log('📦 구매자 채팅 수:', buyerSnap.size);

        // 중복 제거 합산 + 나간 채팅방 제외
        const seen   = new Set();
        const merged = [];
        [...sellerSnap.docs, ...buyerSnap.docs].forEach(d => {
            if (!seen.has(d.id)) {
                seen.add(d.id);
                const data = d.data();
                // leftBy 배열에 내 uid가 있으면 제외 (채팅방 나가기)
                const leftBy = data.leftBy || [];
                if (!leftBy.includes(uid)) {
                    merged.push({ id: d.id, ...data });
                }
            }
        });

        console.log('📋 총 채팅 수 (중복제거):', merged.length);

        // 스켈레톤 숨기기
        document.getElementById('loadingState').style.display = 'none';

        if (merged.length === 0) {
            showEmpty();
            return;
        }

        // 최신순 정렬
        merged.sort((a, b) => {
            const aT = a.lastMessageTime?.seconds || a.updatedAt?.seconds || 0;
            const bT = b.lastMessageTime?.seconds || b.updatedAt?.seconds || 0;
            return bT - aT;
        });

        // 상대방 정보 fetch 후 렌더링
        const items = await Promise.all(merged.map(chat => buildChatItem(chat, uid)));
        allChats = items.filter(Boolean);

        document.getElementById('chatCount').textContent = `${allChats.length}개`;
        document.getElementById('emptyState').classList.add('hidden');
        renderList(allChats);

    } catch (err) {
        console.error('❌ 채팅 목록 로드 실패:', err);
        document.getElementById('loadingState').style.display = 'none';
        showError(err.message);
    }
}

// ============================================
// 채팅방 아이템 데이터 조립
// ============================================
async function buildChatItem(chatData, uid) {
    try {
        const chatId = chatData.id;

        // 상대방 uid
        const otherUid = chatData.sellerId === uid ? chatData.buyerId : chatData.sellerId;

        // 상대방 정보
        let otherName  = '상대방';
        let otherPhoto = getDefaultAvatar();

        if (otherUid) {
            try {
                const uSnap = await getDoc(doc(db, 'users', otherUid));
                if (uSnap.exists()) {
                    const u = uSnap.data();
                    otherName  = u.displayName || u.username || u.nickname || u.email || otherName;
                    otherPhoto = u.profileImage || u.photoURL || otherPhoto;
                }
            } catch (e) {
                console.warn('⚠️ 사용자 정보 fetch 실패:', e);
            }
        }

        // 상품 정보
        let productTitle = chatData.productTitle || '';
        let productThumb = chatData.productImage  || '';

        if (!productTitle && chatData.productId) {
            try {
                const pSnap = await getDoc(doc(db, 'products', chatData.productId));
                if (pSnap.exists()) {
                    const p    = pSnap.data();
                    productTitle = p.title       || '';
                    productThumb = p.images?.[0]  || '';
                }
            } catch (e) {
                console.warn('⚠️ 상품 정보 fetch 실패:', e);
            }
        }

        const unread   = chatData.unreadCount?.[uid] || 0;
        const lastTime = chatData.lastMessageTime || chatData.updatedAt || null;

        return {
            chatId,
            otherName,
            otherPhoto,
            productTitle,
            productThumb,
            lastMessage: chatData.lastMessage || '',
            lastTimeStr: formatTime(lastTime),
            unread,
        };
    } catch (e) {
        console.error('❌ buildChatItem 실패:', e);
        return null;
    }
}

// ============================================
// 렌더링
// ============================================
function renderList(items) {
    const container = document.getElementById('chatList');

    // 기존 카드 제거 (loadingState 제외)
    Array.from(container.children).forEach(child => {
        if (child.id !== 'loadingState') child.remove();
    });

    if (!items || items.length === 0) {
        showEmpty();
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'chat-item flex items-center gap-3 px-4 py-4 cursor-pointer border-b border-gray-100';
        div.setAttribute('data-search-key', `${item.otherName} ${item.productTitle}`.toLowerCase());

        div.innerHTML = `
            <div class="relative flex-shrink-0">
                <img src="${escapeHtml(item.otherPhoto)}"
                     class="w-14 h-14 rounded-full object-cover border border-gray-100"
                     onerror="this.src='${getDefaultAvatar()}'"
                     alt="프로필">
                ${item.productThumb ? `
                <img src="${escapeHtml(item.productThumb)}"
                     class="absolute -bottom-1 -right-1 w-6 h-6 rounded-md object-cover border-2 border-white"
                     onerror="this.style.display='none'"
                     alt="상품">` : ''}
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
                    <p class="text-xs text-gray-500 truncate">
                        ${item.lastMessage ? escapeHtml(item.lastMessage) : '<em class="text-gray-400">메시지 없음</em>'}
                    </p>
                    ${item.unread > 0 ? `<span class="unread-badge">${item.unread > 99 ? '99+' : item.unread}</span>` : ''}
                </div>
            </div>
        `;

        div.addEventListener('click', () => {
            window.location.href = `chat-room.html?id=${item.chatId}`;
        });

        container.appendChild(div);
    });
}

// ============================================
// 검색
// ============================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => {
        const keyword = input.value.trim().toLowerCase();
        renderList(!keyword ? allChats : allChats.filter(item =>
            `${item.otherName} ${item.productTitle}`.toLowerCase().includes(keyword)
        ));
    });
}

// ============================================
// 유틸
// ============================================
function showEmpty(msg) {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('chatCount').textContent = '';
    if (msg) {
        const p = document.querySelector('#emptyState p');
        if (p) p.textContent = msg;
    }
}

function showError(msg) {
    const container = document.getElementById('chatList');
    const div = document.createElement('div');
    div.className = 'p-8 text-center text-red-500';
    div.innerHTML = `
        <i class="fas fa-exclamation-triangle text-4xl mb-3 block"></i>
        <p class="font-bold mb-1">불러오기 실패</p>
        <p class="text-xs text-gray-400">${escapeHtml(msg)}</p>
        <button onclick="location.reload()" class="mt-4 bg-green-600 text-white px-4 py-2 rounded-xl text-sm">
            다시 시도
        </button>
    `;
    container.appendChild(div);
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    try {
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
    } catch { return ''; }
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
