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
 * ✅ 추가 요구사항 반영
 * - "이전 단계(부모) 메뉴"에 마우스오버 시,
 *   오버된 메뉴 옆(오른쪽)에 "기능이 있는 메뉴(hasPage=true)"만 표시하는 패널을 노출
 * - 패널로 마우스 이동해도 유지되도록 close 타이머 처리
 *
 * ✅ 가정(현재 메뉴 관리 페이지 설계와 동일)
 * - menus 문서 필드: name, parentId, order, isActive, adminOnly, hasPage, path
 * - 관리자 판정: users/{uid}.role === "admin"
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

  /**
   * ✅ Hover 패널 제어 상태
   * - hoverParentId: 현재 마우스오버된 "부모 메뉴" ID
   * - panelTop: 패널이 붙을 Y 위치(사이드바 컨테이너 기준)
   */
  const [hoverParentId, setHoverParentId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState<number>(0);

  // ✅ 깜빡임 방지용 타이머
  const closeTimerRef = useRef<number | null>(null);

  // ✅ 패널 위치 계산을 위한 컨테이너 ref
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  /**
   * ✅ hover 패널 열기
   * - 부모 메뉴 DOM의 위치를 기준으로 패널 top을 계산합니다.
   */
  const openHoverPanel = (menuId: string, el: HTMLElement | null) => {
    // ✅ 닫기 타이머가 걸려있으면 취소
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setHoverParentId(menuId);

    // ✅ 패널 top 위치 계산(컨테이너 기준)
    const container = containerRef.current;
    if (container && el) {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      // 컨테이너 상단 대비 현재 메뉴 row의 top
      setPanelTop(eRect.top - cRect.top);
    } else {
      setPanelTop(0);
    }
  };

  /**
   * ✅ hover 패널 닫기 예약(딜레이로 깜빡임 방지)
   */
  const scheduleCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverParentId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  /**
   * ✅ hover된 부모의 "직계 자식" 중 기능 메뉴(hasPage=true)만 추출
   */
  const hoverLeafChildren = useMemo(() => {
    if (!hoverParentId) return [];
    const kids = childrenByParent.get(hoverParentId) ?? [];
    return kids.filter((m) => m.hasPage && !!m.path);
  }, [childrenByParent, hoverParentId]);

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

          /**
           * ✅ 카테고리(페이지 없음): 버튼(펼침/접힘)
           * + 추가: 마우스오버 시 오른쪽 패널 오픈
           */
          if (!m.hasPage) {
            return (
              <div
                key={m.id}
                onMouseEnter={(e) => openHoverPanel(m.id, e.currentTarget as unknown as HTMLElement)}
                onMouseLeave={scheduleCloseHoverPanel}
              >
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

          /**
           * ✅ 기능(페이지 있음): Link
           * + (선택) 기능 메뉴도 하위가 있다면 hover 패널을 띄울 수 있도록 동일 처리
           *   - 원치 않으면 아래 onMouseEnter/Leave를 제거하시면 됩니다.
           */
          return (
            <div
              key={m.id}
              onMouseEnter={(e) => {
                // 기능 메뉴인데 자식이 있다면(다음 단계가 있다면) 패널로 보여줄 가치가 있어 오픈
                if (hasChildren) openHoverPanel(m.id, e.currentTarget as unknown as HTMLElement);
              }}
              onMouseLeave={scheduleCloseHoverPanel}
            >
              <Link
                href={m.path || "#"}
                className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ paddingLeft: padLeft }}
                title={m.path}
              >
                {m.name}
              </Link>

              {/* ✅ 기존 옵션 유지: 기능 메뉴 아래에도 하위가 있을 수 있으면 펼침 표시 가능 */}
              {hasChildren && isOpen ? (
                <div className="mt-1">{renderNode(m.id, depth + 1)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    /**
     * ✅ "옆 패널"을 absolute로 붙이기 위해 컨테이너를 relative로 잡습니다.
     * - 기존 렌더 구조를 해치지 않기 위해 wrapper만 추가합니다.
     */
    <div ref={containerRef} className="relative">
      {renderNode(null, 0)}

      {/* ✅ hover 옆 패널: 기능 메뉴가 있을 때만 표시 */}
      {hoverParentId && hoverLeafChildren.length > 0 ? (
        <div
          className="absolute left-full ml-2 w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          style={{ top: panelTop }}
          onMouseEnter={() => {
            // ✅ 패널 위로 마우스가 올라오면 닫기 예약 취소
            if (closeTimerRef.current) {
              window.clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
          }}
          onMouseLeave={scheduleCloseHoverPanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafChildren.map((c) => (
              <Link
                key={c.id}
                href={c.path || "#"}
                className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                title={c.path}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
