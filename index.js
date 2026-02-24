// ============================================
// functions/index.js  –  PlantiaWorld 알림 함수
// Firebase Cloud Functions V2 + FCM V1 API
// ============================================

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp }     = require("firebase-admin/app");
const { getMessaging }      = require("firebase-admin/messaging");
const { getFirestore }      = require("firebase-admin/firestore");

initializeApp();

const db        = getFirestore();
const messaging = getMessaging();

// ============================================
// 새 채팅 메시지 발생 시 상대방에게 FCM 푸시 알림 전송
// 트리거: chats/{chatId}/messages/{messageId} 문서 생성
// ============================================
exports.sendChatNotification = onDocumentCreated(
    "chats/{chatId}/messages/{messageId}",
    async (event) => {
        const messageData = event.data.data();
        const chatId      = event.params.chatId;

        // 시스템 메시지(거래 상태 변경 등)는 알림 전송 안 함
        if (messageData.type === "system") {
            console.log("시스템 메시지 → 알림 스킵");
            return null;
        }

        // 삭제된 메시지도 스킵
        if (messageData.deleted === true) return null;

        const senderId = messageData.senderId;
        if (!senderId) return null;

        // ── 1. 채팅방 정보 조회 ─────────────────────
        const chatSnap = await db.collection("chats").doc(chatId).get();
        if (!chatSnap.exists) {
            console.error("채팅방 없음:", chatId);
            return null;
        }
        const chatData = chatSnap.data();

        // ── 2. 수신자 uid 결정 ────────────────────────
        const recipientUid =
            senderId === chatData.sellerId ? chatData.buyerId : chatData.sellerId;

        if (!recipientUid) {
            console.log("수신자 uid 없음");
            return null;
        }

        // ── 3. 발신자 이름 조회 ───────────────────────
        let senderName = messageData.senderName || "PlantiaWorld";
        try {
            const senderSnap = await db.collection("users").doc(senderId).get();
            if (senderSnap.exists) {
                const s = senderSnap.data();
                senderName =
                    s.displayName || s.username || s.nickname || senderName;
            }
        } catch (e) {
            console.warn("발신자 정보 조회 실패:", e.message);
        }

        // ── 4. 수신자 FCM 토큰 조회 ──────────────────
        const recipientSnap = await db
            .collection("users")
            .doc(recipientUid)
            .get();

        if (!recipientSnap.exists) {
            console.log("수신자 정보 없음:", recipientUid);
            return null;
        }

        const recipientData = recipientSnap.data();

        // 알림 설정이 꺼져 있으면 스킵
        if (recipientData.notificationEnabled === false) {
            console.log("수신자 알림 꺼짐:", recipientUid);
            return null;
        }

        const tokens = recipientData.fcmTokens || [];
        const validTokens = tokens.filter(Boolean);

        if (validTokens.length === 0) {
            console.log("수신자 FCM 토큰 없음:", recipientUid);
            return null;
        }

        // ── 5. 알림 내용 구성 ─────────────────────────
        const notifBody =
            messageData.imageUrl
                ? "📷 사진을 보냈습니다."
                : messageData.text || "새 메시지가 있습니다.";

        const productTitle = chatData.productTitle || "";
        const notifTitle   = productTitle
            ? `${senderName} · ${productTitle}`
            : senderName;

        const clickUrl = `https://plantiaworld.web.app/chat-room.html?id=${chatId}`;

        // ── 6. FCM 멀티캐스트 발송 ─────────────────────
        const multicastMessage = {
            tokens: validTokens,
            notification: {
                title: notifTitle,
                body:  notifBody,
            },
            webpush: {
                notification: {
                    icon:  "https://plantiaworld.web.app/icons/icon-192x192.png",
                    badge: "https://plantiaworld.web.app/icons/icon-192x192.png",
                    tag:   `chat-${chatId}`,     // 같은 방 알림 덮어쓰기
                    renotify: true,
                    vibrate: [200, 100, 200],
                    requireInteraction: false,
                    actions: [
                        { action: "open",  title: "채팅 열기" },
                        { action: "close", title: "닫기" },
                    ],
                },
                fcmOptions: {
                    link: clickUrl,
                },
            },
            data: {
                chatId,
                url: clickUrl,
            },
        };

        try {
            const response = await messaging.sendEachForMulticast(multicastMessage);
            console.log(
                `✅ 알림 발송 완료: 성공 ${response.successCount} / 실패 ${response.failureCount}`
            );

            // ── 7. 만료된 토큰 정리 ───────────────────
            const expiredTokens = [];
            response.responses.forEach((resp, idx) => {
                if (
                    !resp.success &&
                    (resp.error?.code ===
                        "messaging/registration-token-not-registered" ||
                        resp.error?.code === "messaging/invalid-registration-token")
                ) {
                    expiredTokens.push(validTokens[idx]);
                }
            });

            if (expiredTokens.length > 0) {
                const remainTokens = (recipientData.fcmTokens || []).filter(
                    (t) => !expiredTokens.includes(t)
                );
                await db
                    .collection("users")
                    .doc(recipientUid)
                    .update({ fcmTokens: remainTokens });
                console.log("🗑️ 만료 토큰 정리:", expiredTokens.length, "개");
            }

            return response;
        } catch (error) {
            console.error("❌ FCM 발송 실패:", error);
            return null;
        }
    }
);
