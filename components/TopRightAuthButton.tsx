"use client";

// components/TopRightAuthButton.tsx
// ✅ [ADD] Google 로그인 성공 시 users/{uid}에 name/email 저장(merge)
// - 기존 UI/기능은 유지하고, DB 저장 로직만 추가합니다.
// - displayName이 없으면 email 앞부분을 name으로 대체합니다.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/firebase";

type UiConfig = {
  headerSubscribeVisible: boolean; // 구독 버튼 보이기/숨기기
  headerSubscribeEnabled: boolean; // 구독 버튼 활성/비활성(단, 로그인되어야 클릭 가능)
};

// ✅ 이메일 정규화(초대 기능 where(email==)에도 유리)
function normalizeEmail(v: string) {
  return (v ?? "").trim().toLowerCase();
}

// ✅ displayName이 없을 때 대체 이름
function fallbackNameFromEmail(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export default function TopRightAuthButton() {
  const { user, loading, initError } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // ✅ 전역 UI 설정(기본값: 보이기+활성)
  const [ui, setUi] = useState<UiConfig>({
    headerSubscribeVisible: true,
    headerSubscribeEnabled: true,
  });

  // ✅ Auth 싱글톤 참조
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  // ✅ 전역 설정 문서 구독 (appConfig/ui)
  useEffect(() => {
    const ref = doc(db, "appConfig", "ui");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.exists() ? snap.data() : null) as any;

        const visible =
          typeof data?.headerSubscribeVisible === "boolean"
            ? data.headerSubscribeVisible
            : true;

        const enabled =
          typeof data?.headerSubscribeEnabled === "boolean"
            ? data.headerSubscribeEnabled
            : true;

        setUi({
          headerSubscribeVisible: visible,
          headerSubscribeEnabled: enabled,
        });
      },
      () => {
        setUi({ headerSubscribeVisible: true, headerSubscribeEnabled: true });
      }
    );

    return () => unsub();
  }, []);

  // ✅ [ADD] users/{uid} 업서트(merge)
  const upsertUserProfile = async (uid: string, emailRaw: string, displayNameRaw: string | null) => {
    const email = normalizeEmail(emailRaw);
    const name = (displayNameRaw ?? "").trim() || fallbackNameFromEmail(email);

    const userRef = doc(db, "users", uid);

    // createdAt은 최초 1회만 기록하기 위해 존재 여부 확인
    const snap = await getDoc(userRef);

    const payload: any = {
      email,
      name,
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      payload.createdAt = serverTimestamp();
    }

    // role, isSubscribed 등 기존 필드 보존
    await setDoc(userRef, payload, { merge: true });
  };

  /** Google 로그인 */
  const handleLogin = async () => {
    try {
      setActionError("");
      if (!auth) {
        setActionError("Firebase Auth 초기화에 실패했습니다. 환경변수를 확인해주세요.");
        return;
      }

      setAuthBusy(true);
      const provider = new GoogleAuthProvider();

      // ✅ 로그인
      const cred = await signInWithPopup(auth, provider);

      // ✅ [ADD] 로그인 성공 직후 name/email 저장
      const u = cred.user;
      if (u?.uid) {
        await upsertUserProfile(u.uid, u.email ?? "", u.displayName ?? null);
      }
    } catch (e: any) {
      setActionError(e?.message ?? "로그인 중 오류가 발생했습니다.");
    } finally {
      setAuthBusy(false);
    }
  };

  /** 로그아웃 */
  const handleLogout = async () => {
    try {
      setActionError("");
      if (!auth) return;

      setAuthBusy(true);
      await signOut(auth);
    } catch (e: any) {
      setActionError(e?.message ?? "로그아웃 중 오류가 발생했습니다.");
    } finally {
      setAuthBusy(false);
    }
  };

  const errorMsg = initError || actionError;

  const showSubscribe = ui.headerSubscribeVisible;
  const canClickSubscribe = ui.headerSubscribeEnabled && !!user;

  return (
    <div className="flex items-center gap-3">
      {showSubscribe ? (
        canClickSubscribe ? (
          <Link
            href="/contents/subscribe"
            className="rounded-xl border px-4 py-2 text-sm
                       border-gray-300 bg-white text-gray-900 hover:bg-gray-50
                       dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            title="구독"
          >
            구독
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="rounded-xl border px-4 py-2 text-sm opacity-50 cursor-not-allowed
                       border-gray-300 bg-white text-gray-900
                       dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            title={!user ? "로그인 후 이용 가능합니다." : "현재 비활성화 상태입니다."}
          >
            구독
          </button>
        )
      ) : null}

      <div className="hidden text-sm text-gray-600 dark:text-gray-300 sm:block">
        {loading ? "..." : user ? user.email ?? "Signed in" : "Guest"}
      </div>

      {user ? (
        <button
          onClick={handleLogout}
          disabled={loading || authBusy}
          className="rounded-xl px-4 py-2 text-sm disabled:opacity-60
                     bg-gray-900 text-white dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Logout"}
        </button>
      ) : (
        <button
          onClick={handleLogin}
          disabled={loading || authBusy}
          className="rounded-xl px-4 py-2 text-sm disabled:opacity-60
                     bg-gray-900 text-white dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Google Login"}
        </button>
      )}

      {errorMsg ? (
        <span className="hidden max-w-[260px] truncate text-xs text-red-600 dark:text-red-300 md:inline">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
