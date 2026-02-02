"use client";

// app/contents/create_project/page.tsx
// Project(최상위 단위) 생성/수정/삭제 + 참여자 초대(이메일 기반)
// ✅ FIX: Transaction read-before-write 준수
// ✅ ADD: 이메일로 users 조회 → 프로젝트 members에 UID 추가
// ⚠️ 규칙: 생성 관리자(owner)는 members에 추가하지 않음

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase/firebase";

type ProjectDoc = {
  uid: string; // PRJ_000001
  name: string;
  ownerUid: string;
  ownerEmail: string;
  members?: string[]; // ✅ 초대된 참여자 uid 목록 (owner는 포함하지 않음)
  createdAt?: any;
  updatedAt?: any;
};

type UserDoc = {
  uid?: string; // (선택) 문서에 uid 저장하는 경우
  email?: string; // ✅ 초대 검색용 (필수 권장)
  role?: string;
  isSubscribed?: boolean;
};

function pad6(n: number) {
  const s = String(n);
  return s.length >= 6 ? s : "0".repeat(6 - s.length) + s;
}

// 이메일 간단 정규화
function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}

export default function CreateProjectPage() {
  const [userUid, setUserUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // 생성 입력
  const [newName, setNewName] = useState("");

  // 인라인 편집 상태
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  // ✅ 초대 입력(프로젝트별로 따로 입력값 유지)
  const [inviteEmailByProject, setInviteEmailByProject] = useState<Record<string, string>>({});
  const [inviteLoadingByProject, setInviteLoadingByProject] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUserUid(null);
        setUserEmail(null);
        setProjects([]);
        setLoading(false);
        return;
      }
      setUserUid(u.uid);
      setUserEmail(u.email ?? "");
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userUid) return;

    setLoading(true);

    const q = query(collection(db, "projects"), where("ownerUid", "==", userUid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ProjectDoc);

        rows.sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return bt - at;
        });

        setProjects(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [userUid]);

  const canCreate = useMemo(() => {
    return !!userUid && !!userEmail && newName.trim().length > 0;
  }, [userUid, userEmail, newName]);

  // 1) 프로젝트 생성
  const createProject = async () => {
    if (!canCreate) return;

    const name = newName.trim();

    try {
      await runTransaction(db, async (tx) => {
        const counterRef = doc(db, "counters", "projects");

        // ✅ READ 먼저
        const counterSnap = await tx.get(counterRef);
        const last = counterSnap.exists() ? Number(counterSnap.data().last ?? 0) : 0;
        const next = last + 1;

        const uid = `PRJ_${pad6(next)}`;
        const projectRef = doc(db, "projects", uid);

        // ✅ READ(존재 확인)도 write 전에
        const existing = await tx.get(projectRef);
        if (existing.exists()) {
          throw new Error("이미 존재하는 프로젝트 UID입니다. 다시 시도해주세요.");
        }

        // ✅ WRITE
        tx.set(counterRef, { last: next }, { merge: true });

        tx.set(projectRef, {
          uid,
          name,
          ownerUid: userUid,
          ownerEmail: userEmail,
          // ✅ owner는 members에 추가하지 않음
          members: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setNewName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 생성 중 오류가 발생했습니다.");
    }
  };

  // 2) 프로젝트명 수정
  const saveName = async (uid: string) => {
    const name = editingName.trim();
    if (!name) {
      alert("프로젝트명을 입력해주세요.");
      return;
    }

    try {
      await updateDoc(doc(db, "projects", uid), {
        name,
        updatedAt: serverTimestamp(),
      });

      setEditingUid(null);
      setEditingName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트명 수정 중 오류가 발생했습니다.");
    }
  };

  // 2) 프로젝트 삭제(confirm)
  const removeProject = async (uid: string) => {
    const ok = window.confirm(
      `정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.\n\n대상: ${uid}`
    );
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "projects", uid));
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 삭제 중 오류가 발생했습니다.");
    }
  };

  // ✅ 3) 참여자 초대(이메일 → users에서 찾고 → members에 UID 추가)
  const inviteMemberByEmail = async (projectUid: string) => {
    if (!userUid) return;

    const raw = inviteEmailByProject[projectUid] ?? "";
    const email = normalizeEmail(raw);

    if (!email) {
      alert("초대할 이메일을 입력해주세요.");
      return;
    }

    // 로딩 표시
    setInviteLoadingByProject((prev) => ({ ...prev, [projectUid]: true }));

    try {
      // 1) users 컬렉션에서 email로 사용자 찾기
      // ⚠️ users 문서에 email 필드가 있어야 합니다.
      const uq = query(collection(db, "users"), where("email", "==", email), limit(1));
      const usnap = await getDocs(uq);

      if (usnap.empty) {
        alert("해당 이메일의 사용자를 찾을 수 없습니다.");
        return;
      }

      const userDocSnap = usnap.docs[0];
      const invitedUid = userDocSnap.id; // ✅ users/{uid} 구조를 기준으로 UID는 doc.id

      // 2) 생성 관리자(owner) 본인은 추가하지 않음
      if (invitedUid === userUid) {
        alert("생성 관리자(본인)는 참여자로 추가하지 않습니다.");
        return;
      }

      // 3) 프로젝트 문서에 members arrayUnion로 UID 추가(중복 방지)
      await updateDoc(doc(db, "projects", projectUid), {
        members: arrayUnion(invitedUid),
        updatedAt: serverTimestamp(),
      });

      // 입력값 초기화
      setInviteEmailByProject((prev) => ({ ...prev, [projectUid]: "" }));
      alert("참여자가 추가되었습니다.");
    } catch (e: any) {
      alert(e?.message ?? "참여자 초대 중 오류가 발생했습니다.");
    } finally {
      setInviteLoadingByProject((prev) => ({ ...prev, [projectUid]: false }));
    }
  };

  if (!userUid) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold mb-2">Project 생성/관리</h1>
        <p className="text-sm opacity-80">로그인 후 이용 가능합니다.</p>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Project 생성/관리</h1>
        <p className="text-sm opacity-80">프로젝트는 이후 모든 하위 메뉴를 묶는 최상위 단위입니다.</p>
      </div>

      {/* 생성 영역 */}
      <section className="border rounded-md p-4 mb-6">
        <h2 className="font-semibold mb-3">새 Project 생성</h2>

        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Project 명을 입력하세요"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="border rounded px-4 py-2"
            onClick={createProject}
            disabled={!canCreate}
            title={!canCreate ? "프로젝트명을 입력해주세요." : "생성"}
          >
            생성
          </button>
        </div>

        <p className="text-xs opacity-70 mt-2">
          생성 시 UID는 <code>PRJ_000001</code> 형태로 자동 부여됩니다.
        </p>
      </section>

      {/* 목록 */}
      <section className="border rounded-md p-4">
        <h2 className="font-semibold mb-3">내 Project 목록</h2>

        {loading ? (
          <p className="text-sm opacity-80">불러오는 중...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm opacity-80">생성된 프로젝트가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const isEditing = editingUid === p.uid;
              const inviteEmail = inviteEmailByProject[p.uid] ?? "";
              const inviteLoading = inviteLoadingByProject[p.uid] ?? false;

              return (
                <div key={p.uid} className="border rounded-md p-3 flex flex-col gap-3">
                  {/* 상단: 정보 + 수정/삭제 */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm w-full">
                      <div className="font-semibold">{p.uid}</div>

                      {!isEditing ? (
                        <div className="opacity-90">{p.name}</div>
                      ) : (
                        <input
                          className="border rounded px-3 py-2 w-full mt-2"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          placeholder="새 Project 명"
                        />
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {!isEditing ? (
                        <>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => {
                              setEditingUid(p.uid);
                              setEditingName(p.name);
                            }}
                            title="프로젝트명 수정"
                          >
                            수정
                          </button>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => removeProject(p.uid)}
                            title="프로젝트 삭제"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => saveName(p.uid)}
                            title="저장"
                          >
                            저장
                          </button>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => {
                              setEditingUid(null);
                              setEditingName("");
                            }}
                            title="취소"
                          >
                            취소
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-xs opacity-70">Owner: {p.ownerEmail}</div>

                  {/* ✅ 참여자 초대 영역 */}
                  <div className="border rounded-md p-3">
                    <div className="text-sm font-semibold mb-2">참여자 초대</div>

                    <div className="flex gap-2 items-center">
                      <input
                        className="border rounded px-3 py-2 w-full"
                        placeholder="초대할 사용자 이메일을 입력하세요"
                        value={inviteEmail}
                        onChange={(e) =>
                          setInviteEmailByProject((prev) => ({
                            ...prev,
                            [p.uid]: e.target.value,
                          }))
                        }
                      />
                      <button
                        className="border rounded px-4 py-2"
                        onClick={() => inviteMemberByEmail(p.uid)}
                        disabled={inviteLoading}
                        title="이메일로 사용자 추가"
                      >
                        {inviteLoading ? "처리중" : "추가"}
                      </button>
                    </div>

                    <div className="text-xs opacity-70 mt-2">
                      * 해당 이메일의 사용자가 존재할 때만 추가됩니다. (생성 관리자 본인은 추가하지 않음)
                    </div>

                    <div className="text-xs opacity-70 mt-2">
                      참여자 수: {(p.members ?? []).length}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
