"use client";

// components/TopRightAuthButton.tsx
// - 모든 페이지 공통: 우측 상단 로그인/로그아웃 버튼
// - ✅ 추가: 로그인 유저의 users/{uid}.subscribeButtonEnabled 값을 읽어
//   "구독" 버튼을 표시/숨김 처리합니다.
// - 비로그인 상태에서도 로그인 가능, 강제 리다이렉트 없음

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/firebase";

export default function TopRightAuthButton() {
  const { user, loading, initError } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // ✅ 구독 버튼 표시 여부(기본 true)
  const [subscribeBtnEnabled, setSubscribeBtnEnabled] = useState<boolean>(true);

  // ✅ Auth 싱글톤 참조
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  // ✅ 로그인 유저의 subscribeButtonEnabled를 실시간 반영
  useEffect(() => {
    // 비로그인은 유저 문서가 없으므로 구독 버튼을 숨기는 편이 안전합니다.
    // (원하시면 여기서 true로 바꿔 “게스트도 구독 보기”로 변경 가능합니다.)
    if (!user) {
      setSubscribeBtnEnabled(false);
      return;
    }

    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.exists() ? snap.data() : null) as any;
        const enabled =
          typeof data?.subscribeButtonEnabled === "boolean"
            ? data.subscribeButtonEnabled
            : true; // 필드가 없으면 기본 true
        setSubscribeBtnEnabled(enabled);
      },
      () => {
        // 읽기 실패 시에는 “기본 노출”보다는 안전하게 숨김 처리
        setSubscribeBtnEnabled(false);
      }
    );

    return () => unsub();
  }, [user]);

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
      await signInWithPopup(auth, provider);
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

  // 초기화 에러(환경변수 누락 등) 또는 액션 에러 메시지
  const errorMsg = initError || actionError;

  return (
    <div className="flex items-center gap-3">
      {/* ✅ 구독 버튼 (유저별 활성화 true일 때만 표시) */}
      {user && subscribeBtnEnabled ? (
        <Link
          href="/contents/subscribe"
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-100 dark:hover:bg-gray-800"
          title="구독"
        >
          구독
        </Link>
      ) : null}

      {/* ✅ 상태 텍스트 */}
      <div className="hidden text-sm text-gray-600 dark:text-gray-300 sm:block">
        {loading ? "..." : user ? user.email ?? "Signed in" : "Guest"}
      </div>

      {/* ✅ 로그인/로그아웃 버튼 */}
      {user ? (
        <button
          onClick={handleLogout}
          disabled={loading || authBusy}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Logout"}
        </button>
      ) : (
        <button
          onClick={handleLogin}
          disabled={loading || authBusy}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {authBusy ? "..." : "Google Login"}
        </button>
      )}

      {/* ✅ 에러는 헤더를 망치지 않게 아주 작게 표시 */}
      {errorMsg ? (
        <span className="hidden max-w-[260px] truncate text-xs text-red-600 dark:text-red-300 md:inline">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
