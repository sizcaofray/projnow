"use client";

// app/contents/shell.tsx
// - ProjNow 앱 쉘: Sidebar + Topbar(로그인 버튼) + main 영역
// - Sidebar: 고정 메뉴 + Firestore(system_menus) 동적 메뉴
// - adminOnly 메뉴는 관리자만 클릭 가능(비관리자는 비활성)
// - 로그인/비로그인 상태에서 모두 사용 가능, 리다이렉트 없음

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  getIdTokenResult,
} from "firebase/auth";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string;
  path: string;
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
};

const MENU_COL = "system_menus";

export default function ContentsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, initError } = useAuth();

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [err, setErr] = useState("");

  // ✅ 관리자 권한 확인(커스텀 클레임 admin === true)
  useEffect(() => {
    const run = async () => {
      if (!user || !auth) {
        setIsAdmin(false);
        return;
      }
      try {
        const token = await getIdTokenResult(user, true);
        setIsAdmin(token?.claims?.admin === true);
      } catch {
        setIsAdmin(false);
      }
    };
    run();
  }, [user, auth]);

  // ✅ 동적 메뉴 로딩
  useEffect(() => {
    const load = async () => {
      setErr("");
      if (loading) return;
      if (initError) {
        setErr(String(initError));
        return;
      }
      if (!db) {
        setErr("Firestore 초기화에 실패했습니다. Firebase 환경변수를 확인해주세요.");
        return;
      }

      try {
        const q = query(collection(db, MENU_COL), orderBy("order", "asc"));
        const snap = await getDocs(q);

        const rows: MenuDoc[] = snap.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              name: String(v.name ?? ""),
              path: String(v.path ?? ""),
              group: String(v.group ?? ""),
              order: Number(v.order ?? 0),
              isActive: Boolean(v.isActive ?? true),
              adminOnly: Boolean(v.adminOnly ?? false),
            };
          })
          .filter((m) => m.isActive);

        setMenus(rows);
      } catch (e: any) {
        setErr(e?.message ?? "메뉴 로드 실패");
      }
    };

    load();
  }, [db, loading, initError]);

  // ✅ 고정 메뉴(서비스 메인 기능들)
  const staticMenus = useMemo(() => {
    return [
      { name: "Home", path: "/contents", adminOnly: false },
      { name: "Workspace", path: "/workspace", adminOnly: false },
      // 필요 시 고정 기능 메뉴를 여기에 계속 추가
      // { name: "Convert", path: "/convert", adminOnly: false },
      // { name: "Compare", path: "/compare", adminOnly: false },

      // 메뉴관리: 관리자만
      { name: "Menu Manage", path: "/contents/menu", adminOnly: true },
    ];
  }, []);

  // ✅ 동적 메뉴 중 고정 메뉴와 경로가 겹치면 Sidebar에서 중복 표시 방지
  const dynamicMenus = useMemo(() => {
    const staticPathSet = new Set(staticMenus.map((m) => m.path));
    return menus.filter((m) => !staticPathSet.has(m.path));
  }, [menus, staticMenus]);

  // ✅ 로그인/로그아웃
  const onClickLogin = async () => {
    setErr("");
    if (!auth) return setErr("Firebase Auth 초기화 실패");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setErr(e?.code ?? e?.message ?? "로그인 실패");
    }
  };

  const onClickLogout = async () => {
    setErr("");
    if (!auth) return setErr("Firebase Auth 초기화 실패");
    try {
      await signOut(auth);
    } catch (e: any) {
      setErr(e?.code ?? e?.message ?? "로그아웃 실패");
    }
  };

  const NavItem = ({
    name,
    path,
    adminOnly,
  }: {
    name: string;
    path: string;
    adminOnly: boolean;
  }) => {
    const active = pathname === path;
    const locked = adminOnly && !isAdmin;

    if (locked) {
      return (
        <div
          className={`rounded-lg px-3 py-2 text-sm opacity-60 ${
            active ? "border" : ""
          }`}
          title="관리자 전용 메뉴입니다."
        >
          <div className="flex items-center justify-between">
            <span>{name}</span>
            <span>🔒</span>
          </div>
        </div>
      );
    }

    return (
      <Link
        href={path}
        className={`block rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900 ${
          active ? "border bg-gray-50 dark:bg-gray-900" : ""
        }`}
      >
        {name}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Topbar */}
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur dark:bg-black/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">ProjNow</span>
            <span className="text-xs text-gray-500">Workflow support tools</span>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden text-xs text-gray-600 dark:text-gray-300 md:inline">
                  {user.email ?? ""}
                </span>
                <button
                  onClick={onClickLogout}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={onClickLogin}
                className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white hover:opacity-90 dark:bg-white dark:text-gray-900"
              >
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-0 px-4 md:grid-cols-[260px_1fr]">
        {/* Sidebar */}
        <aside className="border-r py-4 pr-4 md:min-h-[calc(100vh-57px)]">
          <div className="mb-2 text-xs font-semibold text-gray-500">STATIC</div>
          <div className="space-y-1">
            {staticMenus.map((m) => (
              <NavItem key={m.path} name={m.name} path={m.path} adminOnly={m.adminOnly} />
            ))}
          </div>

          <div className="mt-6 mb-2 text-xs font-semibold text-gray-500">DYNAMIC</div>
          <div className="space-y-1">
            {dynamicMenus.length === 0 ? (
              <div className="rounded-lg border p-3 text-xs text-gray-600 dark:text-gray-300">
                등록된 동적 메뉴가 없습니다.
              </div>
            ) : (
              dynamicMenus.map((m) => (
                <NavItem key={m.id} name={m.name} path={m.path} adminOnly={m.adminOnly} />
              ))
            )}
          </div>

          {err && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {err}
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="py-6">{children}</main>
      </div>
    </div>
  );
}
