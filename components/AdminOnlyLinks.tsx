// app/contents/_components/AdminOnlyLinks.tsx
// ✅ admin 사용자에게만 Menu Setting / User Management 링크를 노출하는 전용 컴포넌트
// - Server Component(layout)에서는 Firebase Auth 상태를 직접 못 읽기 때문에 Client Component로 분리
// - users/{uid}.role === "admin" 인 경우에만 링크 노출

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

    // 로그인 상태 변경 감지
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoading(true);

      try {
        if (!user) {
          // 비로그인: 관리자 메뉴 숨김
          setIsAdmin(false);
          return;
        }

        // users/{uid}.role 확인
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = String((snap.exists() ? (snap.data() as any)?.role : "") ?? "")
          .trim()
          .toLowerCase();

        setIsAdmin(role === "admin");
      } catch {
        // 에러 시에도 안전하게 숨김 처리
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // 로딩 중 또는 admin 아니면 렌더하지 않음
  if (loading || !isAdmin) return null;

  return (
    <>
      {/* Menu Setting */}
      <Link
        href="/contents/menu"
        className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Menu Setting
      </Link>

      {/* User Management */}
      <Link
        href="/contents/user"
        className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        User Management
      </Link>
    </>
  );
}
