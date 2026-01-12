"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 목표(이번 수정)
 * - 메뉴관리에서 adminOnly=true로 설정한 "동적 기능 메뉴"가
 *   관리자 로그인 시 정상적으로 활성화되도록 수정
 *
 * ✅ 원인
 * - layout.tsx에서 <ContentsMenuLinks /> 호출 시 isAdmin props를 넘기지 않아
 *   기존 코드의 isAdmin=Boolean(props?.isAdmin)가 항상 false가 됨
 *
 * ✅ 해결
 * - props.isAdmin이 주어지면 그것을 사용
 * - props가 없으면 Firebase Auth + Firestore(users/{uid}.role)로 내부에서 isAdmin 계산
 *
 * ✅ 기존 유지
 * - 최상위 카테고리(parentId === null)는 비활성화 대상 아님(항상 활성)
 * - 최상위 제외 하위 카테고리(parentId !== null) 중,
 *   하위에 메뉴가 "아예 없는" 카테고리(children 0개)는 비활성 표시 + 무반응
 * - 비활성화는 기능 메뉴(hasPage=true)에는 그대로 적용(isActive/adminOnly)
 * - 좌측: 카테고리 트리, 우측(옆) 패널: 오버된 카테고리의 직계 기능 메뉴 표시
 * - 메뉴 오버 패널이 메인 영역(표)에 가려지는 문제 방지(z-index 유지)
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string;
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
  parentId: string | null;
  hasPage: boolean;
  slug: string;
  path: string;
};

const COL = "menus";

export default function ContentsMenuLinks(props?: { isAdmin?: boolean }) {
  // ✅ props가 오면 우선 사용, 없으면 내부에서 계산
  const propIsAdmin = typeof props?.isAdmin === "boolean" ? props?.isAdmin : null;

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  // ✅ 내부 계산 관리자 여부(기본 false)
  const [isAdminState, setIsAdminState] = useState(false);

  // ✅ 최종 isAdmin
  const isAdmin = propIsAdmin ?? isAdminState;

  const [menus, setMenus] = useState<MenuDoc[]>([]);

  // ✅ 카테고리 트리 펼침 상태
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ 옆 패널: 오버된 카테고리
  const [hoverCategoryId, setHoverCategoryId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // ✅ 관리자 판별(Props 미제공일 때만 동작)
  useEffect(() => {
    // props로 이미 관리자를 받는다면 내부 판별 불필요
    if (propIsAdmin !== null) return;

    if (!auth || !db) {
      setIsAdminState(false);
      return;
    }

    // ✅ 로그인 상태 변경 감지 → users/{uid}.role 확인
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setIsAdminState(false);
          return;
        }

        const snap = await getDoc(doc(db, "users", user.uid));
        const role = String((snap.exists() ? (snap.data() as any)?.role : "") ?? "")
          .trim()
          .toLowerCase();

        setIsAdminState(role === "admin");
      } catch {
        setIsAdminState(false);
      }
    });

    return () => unsub();
  }, [auth, db, propIsAdmin]);

  // ✅ 동적 메뉴 로딩
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, COL), orderBy("order", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: MenuDoc[] = snap.docs.map((d) => {
          const v = d.data() as any;

          const hasPage = Boolean(v.hasPage ?? false);
          const slug = String(v.slug ?? "");
          const path = String(v.path ?? "");

          const parentIdRaw = v.parentId ?? null;
          const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

          return {
            id: d.id,
            name: String(v.name ?? ""),
            group: String(v.group ?? ""),
            order: Number(v.order ?? 0),
            isActive: Boolean(v.isActive ?? true),
            adminOnly: Boolean(v.adminOnly ?? false),
            parentId,
            hasPage,
            slug: hasPage ? slug : "",
            path: hasPage ? path : "",
          };
        });

        setMenus(rows);

        // ✅ 최초 1회만: 최상위 카테고리 기본 펼침
        setExpanded((prev) => {
          if (Object.keys(prev).length > 0) return prev;

          const next: Record<string, boolean> = {};
          rows
            .filter((m) => !m.hasPage)
            .forEach((m) => {
              if (m.parentId === null) next[m.id] = true;
            });

          return next;
        });
      },
      () => {
        // 구독 실패 시 앱 중단 방지
      }
    );

    return () => unsub();
  }, [db]);

  const isCategory = (m: MenuDoc) => !m.hasPage;

  /** ✅ 기능 메뉴(페이지)의 사용 가능 여부 (비활성화는 기능에만 적용) */
  const canUseLeafPage = (m: MenuDoc) => {
    if (!m.hasPage) return true;
    if (!m.isActive) return false;
    if (m.adminOnly && !isAdmin) return false;
    return true;
  };

  /** ✅ parentId -> children */
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MenuDoc[]>();
    menus.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    map.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    return map;
  }, [menus]);

  /** ✅ "하위에 메뉴가 없는 카테고리" 판정 (children 0개) */
  const isEmptyCategory = (categoryId: string) => {
    const kids = childrenByParent.get(categoryId) ?? [];
    return kids.length === 0;
  };

  /** ✅ 카테고리 하위 카테고리 수 */
  const categoryChildrenCount = (categoryId: string) => {
    const kids = childrenByParent.get(categoryId) ?? [];
    return kids.filter(isCategory).length;
  };

  /** ✅ 옆 패널: 오버된 카테고리의 직계 기능 메뉴(hasPage=true) */
  const hoverLeafPages = useMemo(() => {
    if (!hoverCategoryId) return [];
    const kids = childrenByParent.get(hoverCategoryId) ?? [];
    return kids.filter((m) => m.hasPage && !!m.path);
  }, [childrenByParent, hoverCategoryId]);

  const computeTop = (el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !el) return 0;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return eRect.top - cRect.top;
  };

  const openHoverPanel = (categoryId: string, el: HTMLElement | null) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setHoverCategoryId(categoryId);
    setPanelTop(computeTop(el));
  };

  const scheduleCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverCategoryId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  const cancelCloseHoverPanel = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));
  };

  const renderCategoryTree = (parentId: string | null, depth: number) => {
    const kids = (childrenByParent.get(parentId) ?? []).filter(isCategory);
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((cat) => {
          const padLeft = 12 + depth * 12;

          const hasChildCategories = categoryChildrenCount(cat.id) > 0;
          const isOpen = expanded[cat.id] ?? false;

          const isTopLevel = cat.parentId === null;
          const empty = isEmptyCategory(cat.id);
          const categoryDisabled = !isTopLevel && empty;

          // ✅ 다크/라이트 모드 비의존(사이드바 자체 기준 색상 고정)
          const baseClass =
            "w-full flex items-center justify-between px-3 py-2 rounded text-sm text-slate-100";
          const activeClass = "hover:bg-white/10 cursor-pointer";
          const disabledClass = "opacity-50 cursor-not-allowed pointer-events-none select-none";

          return (
            <div key={cat.id}>
              <button
                type="button"
                className={`${baseClass} ${categoryDisabled ? disabledClass : activeClass}`}
                style={{ paddingLeft: padLeft }}
                title={categoryDisabled ? "하위 메뉴가 없어 사용할 수 없습니다." : "카테고리"}
                onMouseEnter={
                  categoryDisabled
                    ? undefined
                    : (e) => openHoverPanel(cat.id, e.currentTarget as unknown as HTMLElement)
                }
                onMouseLeave={categoryDisabled ? undefined : scheduleCloseHoverPanel}
                onClick={() => {
                  if (categoryDisabled) return;
                  if (hasChildCategories) toggleExpand(cat.id);
                }}
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-xs opacity-70">
                  {categoryDisabled ? "" : hasChildCategories ? (isOpen ? "▾" : "▸") : ""}
                </span>
              </button>

              {!categoryDisabled && hasChildCategories && isOpen ? (
                <div className="mt-1">{renderCategoryTree(cat.id, depth + 1)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    // ✅ z-index 유지: 메인(표)보다 위에 떠야 함
    <div ref={containerRef} className="relative z-[600]">
      {/* ✅ 좌측: 카테고리 트리 */}
      {renderCategoryTree(null, 0)}

      {/* ✅ 우측(옆) 패널: 기능 메뉴 */}
      {hoverCategoryId && hoverLeafPages.length > 0 ? (
        <div
          // ✅ 다크/라이트 비의존: 패널도 사이드바 톤에 맞춰 고정(어두운 배경 + 밝은 글씨)
          className="absolute left-full ml-2 w-56 rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-lg z-[700]"
          style={{ top: panelTop }}
          onMouseEnter={cancelCloseHoverPanel}
          onMouseLeave={scheduleCloseHoverPanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafPages.map((p) => {
              const usable = canUseLeafPage(p);

              if (!usable) {
                return (
                  <div
                    key={p.id}
                    className="block rounded px-3 py-2 text-sm opacity-50 cursor-not-allowed pointer-events-none select-none"
                    title="사용할 수 없는 메뉴입니다."
                  >
                    {p.name}
                  </div>
                );
              }

              return (
                <Link
                  key={p.id}
                  href={p.path}
                  className="block rounded px-3 py-2 text-sm hover:bg-white/10"
                  title={p.path}
                >
                  {p.name}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
