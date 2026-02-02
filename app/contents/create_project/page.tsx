"use client";

// app/contents/create_project/page.tsx
// ✅ Project 생성/수정/삭제 + 참여자 초대(이메일) + 참여자 표시(email(name))
// ✅ UI 수정사항 반영:
// 1) 버튼 글씨 가로(세로쓰기 방지)  2) 줄바꿈 최소화(한 줄 레이아웃)  3) 참여자 표기: email(name)

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  members?: string[]; // 초대된 참여자 uid 목록 (owner는 포함하지 않음)
  createdAt?: any;
  updatedAt?: any;
};

type MemberProfile = {
  uid: string;
  email: string;
  name: string;
};

function pad6(n: number) {
  const s = String(n);
  return s.length >= 6 ? s : "0".repeat(6 - s.length) + s;
}

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

  // 초대 입력(프로젝트별)
  const [inviteEmailByProject, setInviteEmailByProject] = useState<Record<string, string>>({});
  const [inviteLoadingByProject, setInviteLoadingByProject] = useState<Record<string, boolean>>({});

  // 참여자 프로필 캐시(uid -> profile)
  const [memberProfileByUid, setMemberProfileByUid] = useState<Record<string, MemberProfile>>({});

  // 로그인 상태
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
      setUserEmail(normalizeEmail(u.email ?? ""));
    });

    return () => unsub();
  }, []);

  // 프로젝트 목록(생성자 기준)
  useEffect(() => {
    if (!userUid) return;

    setLoading(true);

    const q = query(collection(db, "projects"), where("ownerUid", "==", userUid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ProjectDoc);

        // createdAt 최신순(없으면 0)
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

  // projects 바뀔 때: members uid들의 users 프로필을 가져와 캐시 채움
  useEffect(() => {
    const uids = new Set<string>();
    projects.forEach((p) => (p.members ?? []).forEach((uid) => uid && uids.add(uid)));

    const needFetch = Array.from(uids).filter((uid) => !memberProfileByUid[uid]);
    if (needFetch.length === 0) return;

    let cancelled = false;

    (async () => {
      const updates: Record<string, MemberProfile> = {};

      await Promise.all(
        needFetch.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            if (!snap.exists()) return;

            const data = snap.data() as any;
            const email = normalizeEmail(data?.email ?? "");
            const name = safeTrim(data?.name) || fallbackNameFromEmail(email);

            updates[uid] = { uid, email, name };
          } catch {
            // 무시(권한/네트워크 등)
          }
        })
      );

      if (cancelled) return;

      if (Object.keys(updates).length > 0) {
        setMemberProfileByUid((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const canCreate = useMemo(() => {
    return !!userUid && !!userEmail && newName.trim().length > 0;
  }, [userUid, userEmail, newName]);

  // 프로젝트 생성 (PRJ_000001 자동)
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
          members: [], // ✅ owner는 members에 추가하지 않음
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setNewName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 생성 중 오류가 발생했습니다.");
    }
  };

  // 프로젝트명 저장
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

  // 프로젝트 삭제(confirm)
  const removeProject = async (uid: string) => {
    const ok = window.confirm(`정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.\n\n대상: ${uid}`);
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "projects", uid));
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 삭제 중 오류가 발생했습니다.");
    }
  };

  // 참여자 초대: 이메일 -> users 조회 -> members에 UID 추가 (owner는 추가 안 함)
  const inviteMemberByEmail = async (projectUid: string) => {
    if (!userUid) return;

    const raw = inviteEmailByProject[projectUid] ?? "";
    const email = normalizeEmail(raw);

    if (!email) {
      alert("초대할 이메일을 입력해주세요.");
      return;
    }

    setInviteLoadingByProject((prev) => ({ ...prev, [projectUid]: true }));

    try {
      const uq = query(collection(db, "users"), where("email", "==", email), limit(1));
      const usnap = await getDocs(uq);

      if (usnap.empty) {
        alert("해당 이메일의 사용자를 찾을 수 없습니다.");
        return;
      }

      const userDocSnap = usnap.docs[0];
      const invitedUid = userDocSnap.id;

      // ✅ 생성 관리자(owner)는 members에 추가하지 않음
      if (invitedUid === userUid) {
        alert("생성 관리자(본인)는 참여자로 추가하지 않습니다.");
        return;
      }

      await updateDoc(doc(db, "projects", projectUid), {
        members: arrayUnion(invitedUid),
        updatedAt: serverTimestamp(),
      });

      // 캐시에 즉시 반영(표시 지연 방지)
      const data = userDocSnap.data() as any;
      const invitedEmail = normalizeEmail(data?.email ?? email);
      const invitedName = safeTrim(data?.name) || fallbackNameFromEmail(invitedEmail);

      setMemberProfileByUid((prev) => ({
        ...prev,
        [invitedUid]: { uid: invitedUid, email: invitedEmail, name: invitedName },
      }));

      setInviteEmailByProject((prev) => ({ ...prev, [projectUid]: "" }));
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
      </div>

      {/* 생성 영역 */}
      <section className="border rounded-md p-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold whitespace-nowrap">새 Project</div>
          <input
            className="border rounded px-3 py-2 flex-1 min-w-[220px]"
            placeholder="Project 명"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="border rounded px-4 py-2 whitespace-nowrap"
            onClick={createProject}
            disabled={!canCreate}
            title={!canCreate ? "프로젝트명을 입력해주세요." : "생성"}
          >
            생성
          </button>
        </div>
      </section>

      {/* 목록 */}
      <section className="border rounded-md p-4">
        <div className="font-semibold mb-3">내 Project 목록</div>

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

              const memberUids = p.members ?? [];
              const memberText = memberUids
                .map((uid) => {
                  const mp = memberProfileByUid[uid];
                  if (!mp) return uid;
                  // ✅ 요구사항: 이메일(사용자이름)
                  return `${mp.email}(${mp.name})`;
                })
                .join(", ");

              return (
                <div key={p.uid} className="border rounded-md p-3">
                  {/* ✅ 줄바꿈 최소화: 좌측 "ID : NAME" + 우측 초대 + 우측끝 편집 버튼 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 좌측: PRJ_000001 : KIND */}
                    <div className="flex items-center gap-2 flex-1 min-w-[260px]">
                      <div className="text-sm font-semibold whitespace-nowrap">{p.uid}</div>
                      <div className="text-sm opacity-70 whitespace-nowrap">:</div>

                      {!isEditing ? (
                        <div className="text-sm font-semibold truncate">{p.name}</div>
                      ) : (
                        <input
                          className="border rounded px-3 py-2 text-sm w-full min-w-[200px]"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          placeholder="Project 명"
                        />
                      )}
                    </div>

                    {/* 우측: 참여자 추가(같은 줄) */}
                    <div className="flex items-center gap-2">
                      <input
                        className="border rounded px-3 py-2 text-sm w-[260px] max-w-[60vw]"
                        placeholder="참여자 이메일"
                        value={inviteEmail}
                        onChange={(e) =>
                          setInviteEmailByProject((prev) => ({ ...prev, [p.uid]: e.target.value }))
                        }
                      />
                      <button
                        className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                        onClick={() => inviteMemberByEmail(p.uid)}
                        disabled={inviteLoading}
                        title="참여자 추가"
                      >
                        {inviteLoading ? "처리중" : "추가"}
                      </button>
                    </div>

                    {/* 우측 끝: 수정/삭제(가로 버튼) */}
                    <div className="flex items-center gap-2">
                      {!isEditing ? (
                        <>
                          <button
                            className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                            onClick={() => {
                              setEditingUid(p.uid);
                              setEditingName(p.name);
                            }}
                            title="프로젝트명 수정"
                          >
                            수정
                          </button>
                          <button
                            className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                            onClick={() => removeProject(p.uid)}
                            title="프로젝트 삭제"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                            onClick={() => saveName(p.uid)}
                            title="저장"
                          >
                            저장
                          </button>
                          <button
                            className="border rounded px-3 py-2 text-sm whitespace-nowrap"
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

                  {/* 참여자 표시: email(name) */}
                  <div className="mt-2 text-xs opacity-80">
                    <span className="font-semibold">참여자:</span>{" "}
                    {memberUids.length === 0 ? "없음" : memberText}
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
