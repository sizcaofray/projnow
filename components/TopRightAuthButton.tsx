"use client";

// components/TopRightAuthButton.tsx
// ✅ Google 로그인 성공 시 users/{uid}에 name/email 저장(merge)
// ✅ 단, "기존 유저"의 name이 이미 있으면 덮어쓰지 않음
// ✅ name이 비어있을 때만 displayName(or email prefix)로 채움
// ✅ email도 비어있을 때만 채움 (기존 값 유지)

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/firebase";

type UiConfig = {
  headerSubscribeVisible: boolean;
  headerSubscribeEnabled: boolean;
};

function normalizeEmail(v: string) {
  return (v ?? "").trim().toLowerCase();
}

function fallbackNameFromEmail(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

function safeTrim(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

export default function TopRightAuthButton() {
  const { user, loading, initError } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [ui, setUi] = useState<UiConfig>({
    headerSubscribeVisible: true,
    headerSubscribeEnabled: true,
  });

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

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

  /**
   * ✅ [핵심] 기존 유저의 name이 비어있을 때만 채움
   * - name: 기존 값이 있으면 유지 (덮어쓰기 금지)
   * - email: 기존 값이 있으면 유지
   * - updatedAt: 항상 갱신
   * - createdAt: 문서가 없을 때만 설정
   */
  const upsertUserProfileIfEmpty = async (
    uid: string,
    emailRaw: string,
    displayNameRaw: string | null
  ) => {
    const emailFromAuth = normalizeEmail(emailRaw);
    const nameFromAuth =
      safeTrim(displayNameRaw) || fallbackNameFromEmail(emailFromAuth);

    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    // 기본 payload (공통)
    const payload: any = {
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      // ✅ 신규 유저: name/email 모두 저장
      payload.email = emailFromAuth;
      payload.name = nameFromAuth;
      payload.createdAt = serverTimestamp();

      await setDoc(userRef, payload, { merge: true });
      return;
    }

    // ✅ 기존 유저: 비어있을 때만 채움
    const data = snap.data() as any;
    const existingName = safeTrim(data?.name);
    const existingEmail = normalizeEmail(data?.email ?? "");

    if (!existingName) {
      payload.name = nameFromAuth;
    }
    if (!existingEmail && emailFromAuth) {
      payload.email = emailFromAuth;
    }

    // name/email 둘 다 이미 있으면 updatedAt만 갱신됩니다.
    await setDoc(userRef, payload, { merge: true });
  };

  const handleLogin = async () => {
    try {
      setActionError("");
      if (!auth) {
        setActionError("Firebase Auth 초기화에 실패했습니다. 환경변수를 확인해주세요.");
        return;
      }

      setAuthBusy(true);
      const provider = new GoogleAuthProvider();

      const cred = await signInWithPopup(auth, provider);

      // ✅ 로그인 성공 직후: 기존 유저라도 name 비어있으면 채움
      const u = cred.user;
      if (u?.uid) {
        await upsertUserProfileIfEmpty(u.uid, u.email ?? "", u.displayName ?? null);
      }
    } catch (e: any) {
      setActionError(e?.message ?? "로그인 중 오류가 발생했습니다.");
    } finally {
      setAuthBusy(false);
    }
  };

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
