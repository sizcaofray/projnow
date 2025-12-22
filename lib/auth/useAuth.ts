// lib/auth/useAuth.ts
// - Firebase onAuthStateChanged 구독으로 전역 사용자 상태 제공
// - 어떤 페이지에서도 동일한 방식으로 로그인/로그아웃 UI 구성 가능
// - 강제 리다이렉트/차단 로직 없음 (요구사항 준수)

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

export type UseAuthResult = {
  user: User | null;
  loading: boolean;
  initError: string;
};

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string>("");

  // ✅ Auth 인스턴스는 싱글톤으로 한 번만 생성/참조
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch (e: any) {
      // 환경변수 누락 등 초기화 실패
      setInitError(e?.message ?? "Firebase Auth 초기화 오류");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    // ✅ 로그인 상태 변화 구독
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => unsub();
  }, [auth]);

  return { user, loading, initError };
}
