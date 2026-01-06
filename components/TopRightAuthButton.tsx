"use client";

// components/TopRightAuthButton.tsx
// ✅ 요구사항 반영
// 1) 상단 구독 버튼은 "전역 설정"으로 보이기/숨기기, 활성/비활성 제어
// 2) 로그인되어야만 구독 버튼 "클릭 가능"
// 3) 다크/라이트 모드에서 자연스럽게 보이도록 스타일 보정 (dark: 대응)

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/firebase";

type UiConfig = {
  headerSubscribeVisible: boolean; // 구독 버튼 보이기/숨기기
  headerSubscribeEnabled: boolean; // 구독 버튼 활성/비활성(단, 로그인되어야 클릭 가능)
};

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

        // 필드가 없으면 기본값 유지
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
        // 읽기 실패 시에도 기본값(보이기+활성)로 유지
        setUi({ headerSubscribeVisible: true, headerSubscribeEnabled: true });
      }
    );

    return () => unsub();
  }, []);

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

  const errorMsg = initError || actionError;

  // ✅ 보이기/숨기기
  const showSubscribe = ui.headerSubscribeVisible;

  // ✅ 클릭 가능 조건: "전역 enabled" + "로그인"
  const canClickSubscribe = ui.headerSubscribeEnabled && !!user;

  return (
    <div className="flex items-center gap-3">
      {/* ✅ 구독 버튼 (전역 설정) */}
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

      {/* ✅ 상태 텍스트 */}
      <div className="hidden text-sm text-gray-600 dark:text-gray-300 sm:block">
        {loading ? "..." : user ? user.email ?? "Signed in" : "Guest"}
      </div>

      {/* ✅ 로그인/로그아웃 버튼 */}
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

      {/* ✅ 에러 표시 */}
      {errorMsg ? (
        <span className="hidden max-w-[260px] truncate text-xs text-red-600 dark:text-red-300 md:inline">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
