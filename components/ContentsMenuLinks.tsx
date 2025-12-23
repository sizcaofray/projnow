"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 역할
 * - Firestore "menus" 컬렉션을 onSnapshot으로 실시간 구독
 * - isActive=true 만 노출
 * - adminOnly=true 는 관리자만 노출
 * - hasPage=false(카테고리)면 링크 없이 접기/펼치기 버튼으로 표시
 * - hasPage=true(기능)면 path로 Link 이동
 *
 * ✅ 가정(현재 메뉴 관리 페이지 설계와 동일)
 * - menus 문서 필드: name, parentId, order, isActive, adminOnly, hasPage, path
 * - 관리자 판정: users/{uid}.role === "admin"
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
  hasPage: boolean;
  path: string;
};

export default function ContentsMenuLinks() {
  const { user } = useAuth();

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ 관리자 여부 확인(users/{uid}.role)
  useEffect(() => {
    const run = async () => {
      if (!db || !user) {
        setIsAdmin(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? (snap.data() as any)?.role : null;
        setIsAdmin(role === "admin");
      } catch {
        setIsAdmin(false);
      }
    };

    run();
  }, [db, user]);

  // ✅ menus 실시간 구독
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, "menus"), orderBy("order", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: MenuDoc[] = snap.docs.map((d) => {
          const v = d.data() as any;

          const parentIdRaw = v.parentId ?? null;
          const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

          return {
            id: d.id,
            name: String(v.name ?? ""),
            parentId,
            order: Number(v.order ?? 0),
            isActive: Boolean(v.isActive ?? true),
            adminOnly: Boolean(v.adminOnly ?? false),
            hasPage: Boolean(v.hasPage ?? false),
            path: String(v.path ?? ""),
          };
        });

        setMenus(rows);

        // ✅ 초기 1회만: 최상위는 기본 펼침
        setExpanded((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const next: Record<string, boolean> = {};
          rows.forEach((m) => {
            if (m.parentId === null) next[m.id] = true;
          });
          return next;
        });
      },
      () => {
        // ✅ 구독 실패해도 사이드바가 앱을 죽이지 않도록 무시 처리
      }
    );

    return () => unsub();
  }, [db]);

  // ✅ 노출 필터(활성 + adminOnly 처리)
  const visibleMenus = useMemo(() => {
    return menus
      .filter((m) => m.isActive)
      .filter((m) => (m.adminOnly ? isAdmin : true));
  }, [menus, isAdmin]);

  // ✅ 트리 구성(parentId -> children)
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MenuDoc[]>();

    visibleMenus.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });

    map.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    return map;
  }, [visibleMenus]);

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));

  const renderNode = (parentId: string | null, depth: number) => {
    const kids = childrenByParent.get(parentId) ?? [];
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((m) => {
          const hasChildren = (childrenByParent.get(m.id) ?? []).length > 0;
          const isOpen = expanded[m.id] ?? false;

          // ✅ 들여쓰기(기존 디자인 크게 변경하지 않게 padding만 조절)
          const padLeft = 12 + depth * 12;

          // ✅ 카테고리(페이지 없음): 버튼(펼침/접힘)
          if (!m.hasPage) {
            return (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ paddingLeft: padLeft }}
                  title="카테고리"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="text-xs opacity-70">
                    {hasChildren ? (isOpen ? "▾" : "▸") : ""}
                  </span>
                </button>

                {hasChildren && isOpen ? (
                  <div className="mt-1">{renderNode(m.id, depth + 1)}</div>
                ) : null}
              </div>
            );
          }

          // ✅ 기능(페이지 있음): Link
          return (
            <div key={m.id}>
              <Link
                href={m.path || "#"}
                className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ paddingLeft: padLeft }}
                title={m.path}
              >
                {m.name}
              </Link>

              {/* ✅ (옵션) 기능 메뉴 아래에도 하위가 있을 수 있으면 펼침 표시 가능
                  - 현재는 사이드바 UX를 단순화하려고 자동으로 하위 렌더는 "펼쳐진 경우"만 표시
               */}
              {hasChildren && isOpen ? (
                <div className="mt-1">{renderNode(m.id, depth + 1)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return <>{renderNode(null, 0)}</>;
}
