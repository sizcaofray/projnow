// lib/auth/useAuth.ts
// - Firebase Auth 로그인 상태를 구독하는 훅
// - 리다이렉트 없이 상태만 제공 (A안: 조건부 렌더링에 사용)

"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

type UseAuthResult = {
  user: User | null;
  loading: boolean;
  errorMsg: string;
};

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null); // 로그인 유저
  const [loading, setLoading] = useState<boolean>(true); // 초기 확인 로딩
  const [errorMsg, setErrorMsg] = useState<string>(""); // 오류 메시지

  // auth 인스턴스는 memo로 1회 생성 시도
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Firebase Auth 초기화 오류가 발생했습니다.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    // 로그인 상태 구독
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      setLoading(false);
    });

    return () => unsub();
  }, [auth]);

  return { user, loading, errorMsg };
}
