"use client";

/**
 * projnow/app/contents/project_document/page.tsx
 *
 * ✅ 이번 수정: 드래그&드롭 순서 조정 추가
 * - 카테고리: 같은 parentId 아래 형제 카테고리들끼리 드래그로 order 재정렬 + Firestore 저장
 * - 파일: 같은 nodeId(카테고리) 아래 파일들끼리 드래그로 order 재정렬 + Firestore 저장
 *
 * ✅ 기존 기능 유지
 * - 카테고리명 인라인 수정/저장
 * - 파일 등록/수정은 메뉴관리처럼 모달에서 메타 저장 + 업로드
 * - select 다크/라이트 가독성 유지
 *
 * ⚠️ Firebase env 필요:
 * NEXT_PUBLIC_FIREBASE_API_KEY
 * NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 * NEXT_PUBLIC_FIREBASE_APP_ID
 */

import React, { useEffect, useMemo, useState } from "react";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  limit,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type FirebaseStorage,
} from "firebase/storage";

/** ✅ DnD Kit */
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** -----------------------------
 * Firebase init (이 파일에서 1회)
 * ------------------------------ */
function getFirebaseClient(): { app: FirebaseApp; auth: Auth; db: Firestore; storage: FirebaseStorage } {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };

  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[ProjectDocument] Missing Firebase env:", missing);
  }

  const app = getApps().length ? getApp() : initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  return { app, auth, db, storage };
}

/** -----------------------------
 * Types
 * ------------------------------ */
type NodeType = "project" | "category";

type ProjectDoc = {
  id: string;
  name: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type TreeNode = {
  id: string;
  projectId: string;
  type: NodeType;
  parentId: string | null;
  name: string;
  order: number;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type FileItem = {
  id: string;
  projectId: string;
  nodeId: string;

  displayName: string;
  version: string;

  /** ✅ 파일 순서(드래그 정렬) */
  order?: number;

  originalName: string;
  storagePath: string;
  downloadUrl?: string;

  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type ModDoc = {
  id: string;
  projectId: string;
  fileId: string;
  storagePath: string;
  downloadUrl?: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type AuditAction =
  | "PROJECT_CREATE"
  | "CATEGORY_CREATE"
  | "CATEGORY_UPDATE"
  | "CATEGORY_REORDER"
  | "CATEGORY_DELETE"
  | "FILE_META_CREATE"
  | "FILE_META_UPDATE"
  | "FILE_REORDER"
  | "FILE_UPLOAD"
  | "FILE_DELETE"
  | "MOD_CREATE"
  | "MOD_DELETE"
  | "SCAFFOLD_REPAIR";

/** -----------------------------
 * Sortable Row Components
 * - 드래그 핸들 포함
 * - 충돌 방지 위해 id는 prefix 사용
 * ------------------------------ */
function SortableCategoryRow(props: {
  dndId: string; // "node:xxx"
  node: TreeNode;
  loading: boolean;
  nameValue: string;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.dndId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      {/* ✅ 드래그 핸들 (여기 잡고 이동) */}
      <button
        type="button"
        className="px-2 py-1 rounded border text-xs cursor-grab active:cursor-grabbing"
        title="드래그로 순서 변경"
        disabled={props.loading}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>

      <span className="text-sm font-semibold">📁</span>

      {/* ✅ 카테고리명 수정 */}
      <input
        className="border rounded px-2 py-1 text-sm bg-transparent w-[260px]"
        value={props.nameValue}
        onChange={(e) => props.onNameChange(e.target.value)}
        disabled={props.loading}
        title="카테고리명 수정"
      />

      <button type="button" className="text-xs px-2 py-1 rounded border" onClick={props.onSave} disabled={props.loading}>
        저장
      </button>

      <button
        type="button"
        className="text-xs px-2 py-1 rounded border"
        onClick={props.onDelete}
        disabled={props.loading}
        title="하위/파일이 없을 때만 삭제 가능"
      >
        삭제
      </button>
    </div>
  );
}

function SortableFileRow(props: {
  dndId: string; // "file:xxx"
  file: FileItem;
  loading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCreateMod: () => void;
  mods: ModDoc[];
  onDeleteMod: (modId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.dndId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="border rounded p-3 bg-white dark:bg-black/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          {/* ✅ 드래그 핸들 */}
          <button
            type="button"
            className="px-2 py-1 rounded border text-xs cursor-grab active:cursor-grabbing"
            title="드래그로 순서 변경"
            disabled={props.loading}
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>

          <div className="text-sm">
            <div className="font-semibold">
              {props.file.displayName || "(파일명 미입력)"}{" "}
              {props.file.version ? <span className="text-xs opacity-70">({props.file.version})</span> : null}
            </div>
            <div className="text-xs opacity-70">
              {props.file.originalName ? `원본: ${props.file.originalName}` : "업로드된 파일 없음"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {props.file.downloadUrl ? (
            <a className="px-3 py-1 rounded border text-sm" href={props.file.downloadUrl} target="_blank" rel="noreferrer">
              다운로드
            </a>
          ) : null}

          <button type="button" className="px-3 py-1 rounded border text-sm" onClick={props.onEdit} disabled={props.loading}>
            수정
          </button>

          <button type="button" className="px-3 py-1 rounded border text-sm" onClick={props.onCreateMod} disabled={props.loading}>
            + Modification List 생성
          </button>

          <button type="button" className="px-3 py-1 rounded border text-sm" onClick={props.onDelete} disabled={props.loading}>
            삭제
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs font-semibold opacity-80 mb-1">Modification List</div>
        {props.mods.length === 0 ? (
          <div className="text-xs opacity-70">생성된 문서가 없습니다.</div>
        ) : (
          <div className="space-y-1">
            {props.mods.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span>📄 {m.id}.md</span>
                  {m.downloadUrl ? (
                    <a href={m.downloadUrl} target="_blank" rel="noreferrer" className="underline">
                      다운로드
                    </a>
                  ) : null}
                </div>
                <button type="button" className="px-2 py-1 rounded border" onClick={() => props.onDeleteMod(m.id)} disabled={props.loading}>
                  문서 삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectDocumentPage() {
  const { auth, db, storage } = useMemo(() => getFirebaseClient(), []);

  /** -----------------------------
   * DnD sensors
   * - 클릭으로 버튼이 눌리지 않도록 약간의 이동 후 드래그 시작(거리 6px)
   * ------------------------------ */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  /** -----------------------------
   * Auth state
   * ------------------------------ */
  const [uid, setUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /** -----------------------------
   * UI/데이터 state
   * ------------------------------ */
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");

  const [myProjects, setMyProjects] = useState<ProjectDoc[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mods, setMods] = useState<ModDoc[]>([]);

  // 카테고리 생성 입력값
  const [newCategoryNameByParent, setNewCategoryNameByParent] = useState<Record<string, string>>({});

  // 카테고리명 편집값
  const [nodeNameEdits, setNodeNameEdits] = useState<Record<string, string>>({});

  /** -----------------------------
   * 파일 등록/수정 팝업(모달)
   * ------------------------------ */
  type FileModalMode = "create" | "edit";
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalMode, setFileModalMode] = useState<FileModalMode>("create");
  const [fileModalNodeId, setFileModalNodeId] = useState<string | null>(null);
  const [fileModalFileId, setFileModalFileId] = useState<string | null>(null);

  const [fileModalDisplayName, setFileModalDisplayName] = useState("");
  const [fileModalVersion, setFileModalVersion] = useState("");
  const [fileModalFileObj, setFileModalFileObj] = useState<File | null>(null);

  /** -----------------------------
   * Effects
   * ------------------------------ */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setUid(null);
        setUserEmail(null);

        setMyProjects([]);
        setActiveProjectId(null);

        setProject(null);
        setNodes([]);
        setFiles([]);
        setMods([]);
        setNewCategoryNameByParent({});
        setNodeNameEdits({});

        closeFileModal();

        return;
      }

      setUid(user.uid);
      setUserEmail(user.email ?? null);
    });

    return () => unsub();
  }, [auth]);

  useEffect(() => {
    if (!uid) return;
    void loadMyProjectsAndAutoSelect(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!activeProjectId) return;

    setProject(null);
    setNodes([]);
    setFiles([]);
    setMods([]);
    setNewCategoryNameByParent({});
    setNodeNameEdits({});

    closeFileModal();

    void loadProjectAll(activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  /** -----------------------------
   * Memo maps
   * ------------------------------ */
  const rootNodeId = useMemo(() => {
    const root = nodes.find((n) => n.type === "project" && n.projectId === activeProjectId);
    return root?.id ?? null;
  }, [nodes, activeProjectId]);

  const nodesByParent = useMemo(() => {
    const map: Record<string, TreeNode[]> = {};
    for (const n of nodes) {
      const key = n.parentId ?? "__ROOT__";
      if (!map[key]) map[key] = [];
      map[key].push(n);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return map;
  }, [nodes]);

  const filesByNode = useMemo(() => {
    const map: Record<string, FileItem[]> = {};
    for (const f of files) {
      if (!map[f.nodeId]) map[f.nodeId] = [];
      map[f.nodeId].push(f);
    }
    for (const k of Object.keys(map)) {
      // ✅ order 우선 정렬 (없으면 0으로 취급)
      map[k].sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.displayName + a.version).localeCompare(b.displayName + b.version));
    }
    return map;
  }, [files]);

  const modsByFile = useMemo(() => {
    const map: Record<string, ModDoc[]> = {};
    for (const m of mods) {
      if (!map[m.fileId]) map[m.fileId] = [];
      map[m.fileId].push(m);
    }
    return map;
  }, [mods]);

  /** -----------------------------
   * Helpers
   * ------------------------------ */
  function tsToMillis(ts: any): number {
    try {
      if (!ts) return 0;
      if (typeof ts.toMillis === "function") return ts.toMillis();
      return 0;
    } catch {
      return 0;
    }
  }

  async function writeAudit(projectId: string, action: AuditAction, payload: Record<string, any>) {
    if (!uid) return;
    await addDoc(collection(db, "project_document_audit"), {
      projectId,
      action,
      payload,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });
  }

  /** -----------------------------
   * 프로젝트 목록 로드
   * ------------------------------ */
  async function loadMyProjectsAndAutoSelect(myUid: string) {
    setLoading(true);
    try {
      const qy = query(collection(db, "project_documents"), where("createdBy", "==", myUid), limit(100));
      const snap = await getDocs(qy);
      const listRaw = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ProjectDoc[];

      const list = [...listRaw].sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt));
      setMyProjects(list);

      if (!activeProjectId && list.length > 0) setActiveProjectId(list[0].id);
      if (activeProjectId && list.length > 0 && !list.some((p) => p.id === activeProjectId)) setActiveProjectId(list[0].id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] loadMyProjects failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 노드가 없는 프로젝트 자동 복구(루트만)
   * ------------------------------ */
  async function ensureProjectScaffold(projectId: string, projectNameForRoot: string) {
    if (!uid) return;

    const hasRootLocal = nodes.some((n) => n.projectId === projectId && n.type === "project");
    if (hasRootLocal) return;

    const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
    const nSnap = await getDocs(nodesQ);
    if (nSnap.size > 0) return;

    const rootRef = await addDoc(collection(db, "project_document_nodes"), {
      projectId,
      type: "project",
      parentId: null,
      name: projectNameForRoot || "Project",
      order: 0,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });

    await writeAudit(projectId, "SCAFFOLD_REPAIR", {
      rootNodeId: rootRef.id,
      note: "root-only (no default category)",
    });
  }

  /** -----------------------------
   * 선택된 프로젝트 하위 데이터 로드
   * ------------------------------ */
  async function loadProjectAll(projectId: string) {
    setLoading(true);
    try {
      const pSnap = await getDoc(doc(db, "project_documents", projectId));
      const pDoc = pSnap.exists() ? ({ id: pSnap.id, ...(pSnap.data() as any) } as ProjectDoc) : null;
      setProject(pDoc);

      const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
      const nSnap = await getDocs(nodesQ);
      const nListRaw = nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
      const nList = [...nListRaw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setNodes(nList);

      // ✅ 카테고리명 edit state 초기화
      setNodeNameEdits((prev) => {
        const next = { ...prev };
        for (const n of nList) {
          if (n.type === "category" && next[n.id] == null) next[n.id] = n.name ?? "";
        }
        for (const k of Object.keys(next)) {
          if (!nList.some((n) => n.id === k)) delete next[k];
        }
        return next;
      });

      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      const fileList = fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[];
      setFiles(fileList);

      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      setMods(mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[]);

      const hasRoot = nList.some((n) => n.type === "project");
      if (!hasRoot) {
        await ensureProjectScaffold(projectId, pDoc?.name ?? "Project");

        const nSnap2 = await getDocs(nodesQ);
        const nList2Raw = nSnap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
        const nList2 = [...nList2Raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setNodes(nList2);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] loadProjectAll failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 프로젝트 생성
   * ------------------------------ */
  async function handleCreateProject() {
    if (!uid) {
      alert("로그인이 필요합니다.");
      return;
    }
    const name = projectName.trim();
    if (!name) {
      alert("Project 명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const rootRef = await addDoc(collection(db, "project_document_nodes"), {
        projectId: projectRef.id,
        type: "project",
        parentId: null,
        name,
        order: 0,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(projectRef.id, "PROJECT_CREATE", { name, rootNodeId: rootRef.id });

      const newProject: ProjectDoc = {
        id: projectRef.id,
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: null,
      };
      setMyProjects((prev) => [newProject, ...prev]);
      setActiveProjectId(projectRef.id);

      setProjectName("");

      await loadProjectAll(projectRef.id);
      await loadMyProjectsAndAutoSelect(uid);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] handleCreateProject failed:", e);
      alert("프로젝트 생성 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 카테고리 생성/삭제/수정
   * ------------------------------ */
  async function handleAddCategory(parentId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }
    const name = (newCategoryNameByParent[parentId] ?? "").trim();
    if (!name) {
      alert("카테고리명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const siblings = nodes.filter((n) => n.parentId === parentId && n.type === "category");
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.order ?? 0)) + 1 : 1;

      const nodeRef = await addDoc(collection(db, "project_document_nodes"), {
        projectId: activeProjectId,
        type: "category",
        parentId,
        name,
        order: nextOrder,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(activeProjectId, "CATEGORY_CREATE", { nodeId: nodeRef.id, parentId, name });

      setNewCategoryNameByParent((prev) => ({ ...prev, [parentId]: "" }));
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCategoryName(nodeId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const name = (nodeNameEdits[nodeId] ?? "").trim();
    if (!name) {
      alert("카테고리명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, "project_document_nodes", nodeId), { name });
      await writeAudit(activeProjectId, "CATEGORY_UPDATE", { nodeId, name });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCategory(nodeId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const hasChild = nodes.some((n) => n.parentId === nodeId);
    const hasFiles = files.some((f) => f.nodeId === nodeId);
    if (hasChild || hasFiles) {
      alert("하위 카테고리 또는 파일이 존재하여 삭제할 수 없습니다.\n(먼저 하위 항목을 정리해 주세요.)");
      return;
    }

    if (!confirm("카테고리를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, "project_document_nodes", nodeId));
      await writeAudit(activeProjectId, "CATEGORY_DELETE", { nodeId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * ✅ 카테고리 드래그 정렬 저장
   * - 같은 parentId의 형제 카테고리들 order 재부여
   * ------------------------------ */
  async function persistCategoryOrder(parentId: string, orderedNodeIds: string[]) {
    if (!uid || !activeProjectId) return;

    const batch = writeBatch(db);
    orderedNodeIds.forEach((nodeId, idx) => {
      // ✅ order는 1부터(루트는 0 유지)
      batch.update(doc(db, "project_document_nodes", nodeId), { order: idx + 1 });
    });

    await batch.commit();
    await writeAudit(activeProjectId, "CATEGORY_REORDER", { parentId, orderedNodeIds });
  }

  /** -----------------------------
   * ✅ 파일 드래그 정렬 저장
   * - 같은 nodeId의 파일들 order 재부여
   * ------------------------------ */
  async function persistFileOrder(nodeId: string, orderedFileIds: string[]) {
    if (!uid || !activeProjectId) return;

    const batch = writeBatch(db);
    orderedFileIds.forEach((fileId, idx) => {
      batch.update(doc(db, "project_document_files", fileId), { order: idx + 1 });
    });

    await batch.commit();
    await writeAudit(activeProjectId, "FILE_REORDER", { nodeId, orderedFileIds });
  }

  /** -----------------------------
   * 파일 모달 open/close
   * ------------------------------ */
  function openFileModalCreate(nodeId: string) {
    setFileModalMode("create");
    setFileModalNodeId(nodeId);
    setFileModalFileId(null);

    setFileModalDisplayName("");
    setFileModalVersion("");
    setFileModalFileObj(null);

    setFileModalOpen(true);
  }

  function openFileModalEdit(file: FileItem) {
    setFileModalMode("edit");
    setFileModalNodeId(file.nodeId);
    setFileModalFileId(file.id);

    setFileModalDisplayName(file.displayName ?? "");
    setFileModalVersion(file.version ?? "");
    setFileModalFileObj(null);

    setFileModalOpen(true);
  }

  function closeFileModal() {
    setFileModalOpen(false);
    setFileModalMode("create");
    setFileModalNodeId(null);
    setFileModalFileId(null);
    setFileModalDisplayName("");
    setFileModalVersion("");
    setFileModalFileObj(null);
  }

  function handleFileModalDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    setFileModalFileObj(file);
  }

  /** -----------------------------
   * 파일 메타 저장(모달)
   * - create 모드: 새 문서 생성 + order 자동부여
   * - edit 모드: 메타 업데이트
   * ------------------------------ */
  async function saveFileMetaFromModal(): Promise<string | null> {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return null;
    }
    if (!fileModalNodeId) return null;

    const dn = fileModalDisplayName.trim();
    const ver = fileModalVersion.trim();

    if (!dn) {
      alert("파일명을 입력해 주세요.");
      return null;
    }

    setLoading(true);
    try {
      // create 모드: 문서 생성
      if (fileModalMode === "create" || !fileModalFileId) {
        // ✅ 같은 카테고리 내 max order+1
        const existing = files.filter((f) => f.nodeId === fileModalNodeId);
        const nextOrder = existing.length ? Math.max(...existing.map((f) => f.order ?? 0)) + 1 : 1;

        const fileRef = await addDoc(collection(db, "project_document_files"), {
          projectId: activeProjectId,
          nodeId: fileModalNodeId,
          displayName: dn,
          version: ver,
          order: nextOrder,
          originalName: "",
          storagePath: "",
          downloadUrl: "",
          createdBy: uid,
          createdByEmail: userEmail ?? null,
          createdAt: serverTimestamp(),
        });

        await writeAudit(activeProjectId, "FILE_META_CREATE", {
          fileId: fileRef.id,
          nodeId: fileModalNodeId,
          displayName: dn,
          version: ver,
          order: nextOrder,
        });

        setFileModalMode("edit");
        setFileModalFileId(fileRef.id);

        await loadProjectAll(activeProjectId);
        return fileRef.id;
      }

      // edit 모드: 업데이트
      await updateDoc(doc(db, "project_document_files", fileModalFileId), {
        displayName: dn,
        version: ver,
      });

      await writeAudit(activeProjectId, "FILE_META_UPDATE", {
        fileId: fileModalFileId,
        displayName: dn,
        version: ver,
      });

      await loadProjectAll(activeProjectId);
      return fileModalFileId;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] saveFileMetaFromModal failed:", e);
      alert("저장 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 파일 업로드(모달)
   * - 업로드 전 메타 저장을 먼저 강제
   * ------------------------------ */
  async function uploadFileFromModal() {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }
    if (!fileModalNodeId) return;

    if (!fileModalFileObj) {
      alert("업로드할 파일을 선택하거나 드래그&드롭 해주세요.");
      return;
    }

    const fileId = await saveFileMetaFromModal();
    if (!fileId) return;

    setLoading(true);
    try {
      const current = files.find((f) => f.id === fileId);

      // 기존 업로드가 있으면 교체(기존 스토리지 삭제 시도)
      if (current?.storagePath) {
        try {
          await deleteObject(ref(storage, current.storagePath));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[ProjectDocument] old storage delete failed (ignore):", e);
        }
      }

      const storagePath = `project_documents/${activeProjectId}/files/${fileId}/${fileModalFileObj.name}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, fileModalFileObj);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, "project_document_files", fileId), {
        originalName: fileModalFileObj.name,
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "FILE_UPLOAD", {
        fileId,
        nodeId: fileModalNodeId,
        originalName: fileModalFileObj.name,
        storagePath,
      });

      await loadProjectAll(activeProjectId);
      closeFileModal();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] uploadFileFromModal failed:", e);
      alert("업로드 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 파일 삭제
   * ------------------------------ */
  async function handleDeleteFile(fileId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const target = files.find((f) => f.id === fileId);
    if (!target) return;

    const linkedMods = (modsByFile[fileId] ?? []).length;
    if (linkedMods > 0) {
      alert("이 파일에 연결된 Modification List 문서가 있습니다. 먼저 문서를 삭제해 주세요.");
      return;
    }

    if (!confirm("파일을 삭제하시겠습니까? (업로드된 파일이 있으면 스토리지에서도 삭제됩니다)")) return;

    setLoading(true);
    try {
      if (target.storagePath) {
        try {
          await deleteObject(ref(storage, target.storagePath));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[ProjectDocument] storage delete failed (ignore):", e);
        }
      }

      await deleteDoc(doc(db, "project_document_files", fileId));
      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * Modification List 생성/삭제
   * ------------------------------ */
  async function handleCreateMod(file: FileItem) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    try {
      const modRef = await addDoc(collection(db, "project_document_mods"), {
        projectId: activeProjectId,
        fileId: file.id,
        storagePath: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      const content = [
        `# Modification List`,
        ``,
        `- ProjectId: ${activeProjectId}`,
        `- File: ${file.displayName}`,
        `- Version: ${file.version || "(none)"}`,
        `- Original: ${file.originalName || "(not uploaded yet)"}`,
        `- CreatedAt: ${new Date().toISOString()}`,
        ``,
        `## Changes`,
        `- (예) 항목 추가: ...`,
        `- (예) 항목 수정: ...`,
        `- (예) 항목 삭제: ...`,
        ``,
      ].join("\n");

      const storagePath = `project_documents/${activeProjectId}/mods/${file.id}/${modRef.id}.md`;
      const storageRef = ref(storage, storagePath);
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      await uploadBytes(storageRef, blob);

      const downloadUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, "project_document_mods", modRef.id), {
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "MOD_CREATE", { modId: modRef.id, fileId: file.id, storagePath });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMod(modId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const target = mods.find((m) => m.id === modId);
    if (!target) return;

    if (!confirm("Modification List 문서를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      if (target.storagePath) {
        await deleteObject(ref(storage, target.storagePath));
      }
      await deleteDoc(doc(db, "project_document_mods", modId));
      await writeAudit(activeProjectId, "MOD_DELETE", { modId, fileId: target.fileId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * ✅ DnD 핸들러 - 카테고리(형제) 전용
   * - 이 함수는 같은 parentId 컨테이너에서만 호출(컨테이너별 DndContext 사용)
   * ------------------------------ */
  async function onDragEndCategory(parentId: string, childCategoryNodes: TreeNode[], event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    // id는 "node:xxx" 형태
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // 실제 nodeId만 추출
    const activeNodeId = activeId.replace("node:", "");
    const overNodeId = overId.replace("node:", "");

    const oldIndex = childCategoryNodes.findIndex((n) => n.id === activeNodeId);
    const newIndex = childCategoryNodes.findIndex((n) => n.id === overNodeId);
    if (oldIndex < 0 || newIndex < 0) return;

    // ✅ UI 즉시 반영: nodes 상태를 재정렬
    const reordered = arrayMove(childCategoryNodes, oldIndex, newIndex);
    const reorderedIds = reordered.map((n) => n.id);

    setNodes((prev) => {
      // 기존 nodes에서 해당 parentId의 category 형제만 바꿔치기
      const others = prev.filter((n) => !(n.parentId === parentId && n.type === "category"));
      const targetSiblings = reordered.map((n, idx) => ({ ...n, order: idx + 1 }));
      return [...others, ...targetSiblings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });

    // ✅ DB 저장
    try {
      setLoading(true);
      await persistCategoryOrder(parentId, reorderedIds);
      await loadProjectAll(activeProjectId!);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * ✅ DnD 핸들러 - 파일(같은 카테고리) 전용
   * ------------------------------ */
  async function onDragEndFile(nodeId: string, nodeFiles: FileItem[], event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    // id는 "file:xxx" 형태
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeFileId = activeId.replace("file:", "");
    const overFileId = overId.replace("file:", "");

    const oldIndex = nodeFiles.findIndex((f) => f.id === activeFileId);
    const newIndex = nodeFiles.findIndex((f) => f.id === overFileId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(nodeFiles, oldIndex, newIndex);
    const reorderedIds = reordered.map((f) => f.id);

    // ✅ UI 즉시 반영
    setFiles((prev) => {
      const others = prev.filter((f) => f.nodeId !== nodeId);
      const target = reordered.map((f, idx) => ({ ...f, order: idx + 1 }));
      return [...others, ...target];
    });

    // ✅ DB 저장
    try {
      setLoading(true);
      await persistFileOrder(nodeId, reorderedIds);
      await loadProjectAll(activeProjectId!);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * UI - recursive render
   * - 컨테이너(형제 리스트)마다 DndContext를 분리해
   *   "형제끼리만" 드래그 되도록 안정적으로 구성
   * ------------------------------ */
  function renderNode(node: TreeNode, depth: number) {
    const childNodes = nodesByParent[node.id] ?? [];
    const childCategories = childNodes.filter((n) => n.type === "category"); // project 아래는 카테고리만
    const nodeFiles = filesByNode[node.id] ?? [];
    const indent = Math.min(depth * 16, 64);

    // ✅ DnD ids
    const categoryDndIds = childCategories.map((n) => `node:${n.id}`);
    const fileDndIds = nodeFiles.map((f) => `file:${f.id}`);

    return (
      <div key={node.id} className="border rounded-md p-3 mb-3 bg-white/50 dark:bg-black/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            {node.type === "project" ? (
              <span className="text-sm font-semibold">📌 {node.name}</span>
            ) : (
              // ✅ 카테고리(현재 노드 자체)는 기존처럼 인라인 수정 제공 (드래그는 "형제 리스트"에서만)
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">📁</span>
                <input
                  className="border rounded px-2 py-1 text-sm bg-transparent w-[260px]"
                  value={nodeNameEdits[node.id] ?? node.name ?? ""}
                  onChange={(e) => setNodeNameEdits((prev) => ({ ...prev, [node.id]: e.target.value }))}
                  disabled={loading}
                  title="카테고리명 수정"
                />
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border"
                  onClick={() => handleSaveCategoryName(node.id)}
                  disabled={loading}
                >
                  저장
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border"
                  onClick={() => handleDeleteCategory(node.id)}
                  disabled={loading}
                  title="하위/파일이 없을 때만 삭제 가능"
                >
                  삭제
                </button>
              </div>
            )}
          </div>

          {/* 하위 카테고리 생성 */}
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
              placeholder="하위 카테고리명"
              value={newCategoryNameByParent[node.id] ?? ""}
              onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [node.id]: e.target.value }))}
              disabled={loading}
            />
            <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => handleAddCategory(node.id)} disabled={loading}>
              + 카테고리 생성
            </button>
          </div>
        </div>

        {/* ✅ 카테고리 노드에만 파일 관리 표시 */}
        {node.type === "category" && (
          <div className="mt-4" style={{ paddingLeft: indent }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">📎 파일 관리</div>

              <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => openFileModalCreate(node.id)} disabled={loading}>
                + 파일 등록
              </button>
            </div>

            {nodeFiles.length === 0 ? (
              <div className="text-sm opacity-70">등록된 파일이 없습니다. 우측의 “+ 파일 등록”으로 추가해 주세요.</div>
            ) : (
              /**
               * ✅ 파일 DnD 컨테이너(같은 카테고리 내에서만 정렬)
               */
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => void onDragEndFile(node.id, nodeFiles, e)}
              >
                <SortableContext items={fileDndIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {nodeFiles.map((f) => (
                      <SortableFileRow
                        key={f.id}
                        dndId={`file:${f.id}`}
                        file={f}
                        loading={loading}
                        onEdit={() => openFileModalEdit(f)}
                        onDelete={() => void handleDeleteFile(f.id)}
                        onCreateMod={() => void handleCreateMod(f)}
                        mods={modsByFile[f.id] ?? []}
                        onDeleteMod={(modId) => void handleDeleteMod(modId)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}

        {/* ✅ 자식 카테고리 리스트: 여기서 "형제끼리" DnD 정렬 */}
        {childCategories.length > 0 && (
          <div className="mt-3 space-y-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => void onDragEndCategory(node.id, childCategories, e)}
            >
              <SortableContext items={categoryDndIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {childCategories.map((c) => (
                    <div key={c.id} className="border rounded-md p-3 bg-white/40 dark:bg-black/15">
                      {/* ✅ 형제 리스트에서만 드래그 핸들 노출 */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2" style={{ paddingLeft: Math.min((depth + 1) * 16, 64) }}>
                          <SortableCategoryRow
                            dndId={`node:${c.id}`}
                            node={c}
                            loading={loading}
                            nameValue={nodeNameEdits[c.id] ?? c.name ?? ""}
                            onNameChange={(v) => setNodeNameEdits((prev) => ({ ...prev, [c.id]: v }))}
                            onSave={() => void handleSaveCategoryName(c.id)}
                            onDelete={() => void handleDeleteCategory(c.id)}
                          />
                        </div>

                        {/* 하위 카테고리 생성 */}
                        <div className="flex items-center gap-2">
                          <input
                            className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
                            placeholder="하위 카테고리명"
                            value={newCategoryNameByParent[c.id] ?? ""}
                            onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            disabled={loading}
                          />
                          <button
                            type="button"
                            className="px-3 py-1 rounded border text-sm"
                            onClick={() => void handleAddCategory(c.id)}
                            disabled={loading}
                          >
                            + 카테고리 생성
                          </button>
                        </div>
                      </div>

                      {/* ✅ 재귀 렌더(하위 트리) */}
                      <div className="mt-3">{renderNode(c, depth + 1)}</div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>
    );
  }

  /** -----------------------------
   * Render
   * ------------------------------ */
  return (
    <main className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold">Project Document</h1>
        <div className="text-xs opacity-70">{uid ? `로그인: ${userEmail ?? uid}` : "비로그인"}</div>
      </div>

      {/* 상단: 프로젝트 선택/생성 */}
      <section className="border rounded-md p-4 mb-6 bg-white/50 dark:bg-black/20">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">내 프로젝트</div>

            {/* ✅ 다크/라이트 모두 가독성 확보 */}
            <select
              className="border rounded px-3 py-2 w-full md:w-[420px] bg-white text-black dark:bg-slate-900 dark:text-white"
              value={activeProjectId ?? ""}
              onChange={(e) => setActiveProjectId(e.target.value || null)}
              disabled={loading || !uid}
            >
              <option className="bg-white text-black dark:bg-slate-900 dark:text-white" value="">
                (프로젝트 선택)
              </option>
              {myProjects.map((p) => (
                <option key={p.id} value={p.id} className="bg-white text-black dark:bg-slate-900 dark:text-white">
                  {p.name} ({p.id})
                </option>
              ))}
            </select>

            <div className="text-xs opacity-70">저장 시 목록에 즉시 반영됩니다.</div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">프로젝트 생성</div>
            <div className="flex gap-2">
              <input
                className="border rounded px-3 py-2 w-full md:w-[320px] bg-transparent"
                placeholder="Project 명 입력"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={loading}
              />
              <button type="button" className="px-4 py-2 rounded border" onClick={() => void handleCreateProject()} disabled={loading}>
                저장
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm">
          <span className="font-semibold">현재 프로젝트: </span>
          <span className="opacity-80">{activeProjectId ? `${project?.name ?? "(로드중)"} (${activeProjectId})` : "없음"}</span>
        </div>
      </section>

      {!activeProjectId ? (
        <div className="text-sm opacity-70">프로젝트를 선택(또는 생성)하면 하위 문서 트리가 표시됩니다.</div>
      ) : (
        <section>
          {loading && <div className="text-sm opacity-70 mb-3">처리 중...</div>}
          {!rootNodeId ? (
            <div className="text-sm opacity-70">프로젝트 노드를 불러오지 못했습니다. (노드가 없으면 자동 복구 생성됩니다)</div>
          ) : (
            nodes.filter((n) => n.id === rootNodeId).map((root) => renderNode(root, 0))
          )}
        </section>
      )}

      {/* ✅ 파일 등록/수정 팝업(모달) */}
      {fileModalOpen ? (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeFileModal} />

          <div className="relative w-[92vw] max-w-xl border rounded-lg bg-white text-black dark:bg-slate-950 dark:text-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">{fileModalMode === "create" ? "파일 등록" : "파일 수정"}</div>
              <button type="button" className="px-2 py-1 rounded border text-sm" onClick={closeFileModal} disabled={loading}>
                닫기
              </button>
            </div>

            {/* 파일명/버전 */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
              <div className="md:col-span-4 flex flex-col gap-1">
                <label className="text-xs opacity-70">파일명</label>
                <input
                  className="border rounded px-2 py-2 text-sm bg-transparent"
                  value={fileModalDisplayName}
                  onChange={(e) => setFileModalDisplayName(e.target.value)}
                  disabled={loading}
                  placeholder="예: CRF Specification"
                />
              </div>
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-xs opacity-70">버전</label>
                <input
                  className="border rounded px-2 py-2 text-sm bg-transparent"
                  value={fileModalVersion}
                  onChange={(e) => setFileModalVersion(e.target.value)}
                  disabled={loading}
                  placeholder="v1.0"
                />
              </div>
            </div>

            {/* 파일 선택/드롭 */}
            <div className="mt-4">
              <label className="text-xs opacity-70">파일</label>
              <div
                className="border rounded p-3 text-sm bg-transparent mt-1"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileModalDrop}
                title="여기에 파일을 드래그&드롭하거나, 아래 버튼으로 선택하세요."
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">{fileModalFileObj ? `선택됨: ${fileModalFileObj.name}` : "여기로 드래그&드롭"}</div>

                  <label htmlFor="file_modal_input" className="px-2 py-1 rounded border text-xs cursor-pointer whitespace-nowrap">
                    파일 선택
                  </label>
                  <input
                    id="file_modal_input"
                    type="file"
                    className="hidden"
                    onChange={(e) => setFileModalFileObj(e.target.files?.[0] ?? null)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="text-xs opacity-70 mt-1">{fileModalFileObj ? "선택된 파일 있음" : "선택된 파일 없음"}</div>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2 mt-4">
              <button type="button" className="px-4 py-2 rounded border text-sm" onClick={() => void saveFileMetaFromModal()} disabled={loading}>
                저장
              </button>
              <button type="button" className="px-4 py-2 rounded border text-sm" onClick={() => void uploadFileFromModal()} disabled={loading}>
                업로드
              </button>
              <button type="button" className="px-4 py-2 rounded border text-sm" onClick={closeFileModal} disabled={loading}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
