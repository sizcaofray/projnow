// app/contents/_components/AdminOnlyLinks.tsx
// ✅ admin 사용자에게만 Menu Setting / User Management / SDTM DB Manage 링크를 노출하는 전용 컴포넌트
// ✅ 수정사항
// - dark:hover:* 제거 → 브라우저/OS 모드에 의해 색이 바뀌지 않게 고정
// - 사이드바(어두운 배경) 기준으로 hover를 "항상 동일한 오버레이"로 적용

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";

export default function AdminOnlyLinks() {
  // ✅ admin 여부
  const [isAdmin, setIsAdmin] = useState(false);
  // ✅ 로딩 중에는 메뉴를 숨겨서 깜빡임 최소화
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();

    // ✅ 로그인 상태 변경 감지
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoading(true);

      try {
        if (!user) {
          // ✅ 비로그인: 관리자 메뉴 숨김
          setIsAdmin(false);
          return;
        }

        // ✅ users/{uid}.role 확인
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = String((snap.exists() ? (snap.data() as any)?.role : "") ?? "")
          .trim()
          .toLowerCase();

        setIsAdmin(role === "admin");
      } catch {
        // ✅ 에러 시에도 안전하게 숨김 처리
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // ✅ 로딩 중 또는 admin 아니면 렌더하지 않음
  if (loading || !isAdmin) return null;

  // ✅ 사이드바는 어두운 배경이므로 hover는 항상 "밝은 오버레이"로 고정 (모드 비의존)
  const linkClass =
    "block px-3 py-2 rounded text-inherit hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20";

  return (
    <>
      {/* ✅ Menu Setting */}
      <Link href="/contents/menu" className={linkClass}>
        Menu Setting
      </Link>

      {/* ✅ User Management */}
      <Link href="/contents/user" className={linkClass}>
        User Management
      </Link>

      {/* ✅ SDTM DB Manage */}
      <Link href="/contents/admin/sdtm" className={linkClass}>
        SDTM DB Manage
      </Link>
    </>
  );
}
