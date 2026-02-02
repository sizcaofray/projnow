"use client";

/**
 * app/contents/project_document/page.tsx
 *
 * ✅ 이번 수정 핵심
 * 1) "같은 카테고리 2번 렌더" 현상 제거
 *    - 카테고리(노드)는 각 레벨에서 1번만 렌더링하도록 재귀 구조 정리
 *
 * 2) 누락된 핵심 로직 복구(현재 화면에서 "프로젝트 노드를 불러오지 못했습니다" 뜨는 원인)
 *    - loadProjectAll / ensureProjectScaffold / CRUD / 파일 업로드/삭제 / 순서 저장 구현 포함
 *
 * ✅ 기존 UI/마크업 최대 유지
 * - 상단 프로젝트 선택/생성 섹션 유지
 * - 카테고리 인라인 편집/저장/삭제 유지
 * - 파일 등록/수정 모달 유지
 * - DnD로 카테고리/파일 order 저장 유지
 *
 * ⚠️ 사용 컬렉션(Firestore)
 * - project_documents
 * - project_document_nodes
 * - project_document_files
 * - project_document_mods
 * - project_document_audit
 *
 * ⚠️ Storage 경로
 * - project_documents/{projectId}/files/{fileId}/{filename}
 * - project_documents/{projectId}/mods/{fileId}/{modId}.md
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
  orderBy,
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

      <span className="text-sm font-semibold">📁</span>

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
                <button
                  type="button"
                  className="px-2 py-1 rounded border"
                  onClick={() => props.onDeleteMod(m.id)}
                  disabled={props.loading}
                >
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

    // ✅ 이미 루트 노드가 있으면 종료
    const qy = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId), where("type", "==", "project"), limit(1));
    const snap = await getDocs(qy);
    if (!snap.empty) return;

    // ✅ 루트 노드 생성
    await addDoc(collection(db, "project_document_nodes"), {
      projectId,
      type: "project",
      parentId: null,
      name: projectNameForRoot || "PROJECT",
      order: 1,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });

    await writeAudit(projectId, "SCAFFOLD_REPAIR", {
      message: "root project node was missing -> created automatically",
    });
  }

  /** -----------------------------
   * 프로젝트 전체 로드
   * ------------------------------ */
  async function loadProjectAll(projectId: string) {
    setLoading(true);
    try {
      // 1) 프로젝트 문서
      const pRef = doc(db, "project_documents", projectId);
      const pSnap = await getDoc(pRef);
      const pData = pSnap.exists() ? ({ id: pSnap.id, ...(pSnap.data() as any) } as ProjectDoc) : null;
      setProject(pData);

      // 2) 노드
      const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId), limit(2000));
      const nodesSnap = await getDocs(nodesQ);
      const nodeList = nodesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];

      // 루트가 없으면 자동 생성 후 재로드
      const hasRoot = nodeList.some((n) => n.type === "project");
      if (!hasRoot) {
        await ensureProjectScaffold(projectId, pData?.name ?? "PROJECT");
        const nodesSnap2 = await getDocs(nodesQ);
        const nodeList2 = nodesSnap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
        setNodes(nodeList2);

        // 편집값 초기화
        setNodeNameEdits((prev) => {
          const next = { ...prev };
          for (const n of nodeList2) {
            if (n.type === "category" && next[n.id] === undefined) next[n.id] = n.name ?? "";
          }
          return next;
        });
      } else {
        setNodes(nodeList);

        // 편집값 초기화
        setNodeNameEdits((prev) => {
          const next = { ...prev };
          for (const n of nodeList) {
            if (n.type === "category" && next[n.id] === undefined) next[n.id] = n.name ?? "";
          }
          return next;
        });
      }

      // 3) 파일
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId), limit(4000));
      const filesSnap = await getDocs(filesQ);
      const fileList = filesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[];
      setFiles(fileList);

      // 4) mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId), limit(4000));
      const modsSnap = await getDocs(modsQ);
      const modList = modsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[];
      setMods(modList);
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
    if (!uid) return;
    const name = projectName.trim();
    if (!name) return;

    setLoading(true);
    try {
      const p = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(p.id, "PROJECT_CREATE", { name });

      // ✅ 루트 노드 생성
      await addDoc(collection(db, "project_document_nodes"), {
        projectId: p.id,
        type: "project",
        parentId: null,
        name,
        order: 1,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      setProjectName("");
      setActiveProjectId(p.id);

      // 목록 갱신
      await loadMyProjectsAndAutoSelect(uid);
      await loadProjectAll(p.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] create project failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 카테고리 생성/수정/삭제
   * ------------------------------ */
  async function handleAddCategory(parentId: string) {
    if (!uid || !activeProjectId) return;
    const name = (newCategoryNameByParent[parentId] ?? "").trim();
    if (!name) return;

    setLoading(true);
    try {
      // ✅ 같은 parent의 max order 계산
      const siblings = (nodesByParent[parentId] ?? []).filter((n) => n.type === "category");
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order ?? 0), 0);

      const created = await addDoc(collection(db, "project_document_nodes"), {
        projectId: activeProjectId,
        type: "category",
        parentId,
        name,
        order: maxOrder + 1,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(activeProjectId, "CATEGORY_CREATE", { parentId, nodeId: created.id, name });

      setNewCategoryNameByParent((prev) => ({ ...prev, [parentId]: "" }));
      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] add category failed:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCategoryName(nodeId: string) {
    if (!uid || !activeProjectId) return;
    const name = (nodeNameEdits[nodeId] ?? "").trim();
    if (!name) return;

    setLoading(true);
    try {
      await updateDoc(doc(db, "project_document_nodes", nodeId), {
        name,
      });

      await writeAudit(activeProjectId, "CATEGORY_UPDATE", { nodeId, name });

      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] save category failed:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCategory(nodeId: string) {
    if (!uid || !activeProjectId) return;

    // ✅ 하위 카테고리 / 파일 존재 시 삭제 금지
    const hasChild = (nodesByParent[nodeId] ?? []).some((n) => n.type === "category");
    const hasFiles = (filesByNode[nodeId] ?? []).length > 0;

    if (hasChild || hasFiles) {
      alert("하위 카테고리 또는 파일이 존재하면 삭제할 수 없습니다.");
      return;
    }

    setLoading(true);
    try {
      await deleteDoc(doc(db, "project_document_nodes", nodeId));
      await writeAudit(activeProjectId, "CATEGORY_DELETE", { nodeId });
      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] delete category failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 파일 모달/업로드/삭제
   * ------------------------------ */
  function closeFileModal() {
    setFileModalOpen(false);
    setFileModalMode("create");
    setFileModalNodeId(null);
    setFileModalFileId(null);
    setFileModalDisplayName("");
    setFileModalVersion("");
    setFileModalFileObj(null);
  }

  function openFileModalCreate(nodeId: string) {
    setFileModalOpen(true);
    setFileModalMode("create");
    setFileModalNodeId(nodeId);
    setFileModalFileId(null);
    setFileModalDisplayName("");
    setFileModalVersion("");
    setFileModalFileObj(null);
  }

  function openFileModalEdit(f: FileItem) {
    setFileModalOpen(true);
    setFileModalMode("edit");
    setFileModalNodeId(f.nodeId);
    setFileModalFileId(f.id);
    setFileModalDisplayName(f.displayName ?? "");
    setFileModalVersion(f.version ?? "");
    setFileModalFileObj(null);
  }

  async function saveFileMetaFromModal() {
    if (!uid || !activeProjectId) return;
    if (!fileModalNodeId) return;

    const displayName = fileModalDisplayName.trim();
    const version = fileModalVersion.trim();

    setLoading(true);
    try {
      if (fileModalMode === "create") {
        // ✅ nodeId 아래 파일들의 max order
        const nodeFiles = filesByNode[fileModalNodeId] ?? [];
        const maxOrder = nodeFiles.reduce((m, f) => Math.max(m, f.order ?? 0), 0);

        const created = await addDoc(collection(db, "project_document_files"), {
          projectId: activeProjectId,
          nodeId: fileModalNodeId,
          displayName,
          version,
          order: maxOrder + 1,
          originalName: "",
          storagePath: "",
          downloadUrl: "",
          createdBy: uid,
          createdByEmail: userEmail ?? null,
          createdAt: serverTimestamp(),
        });

        await writeAudit(activeProjectId, "FILE_META_CREATE", {
          fileId: created.id,
          nodeId: fileModalNodeId,
          displayName,
          version,
        });

        // ✅ 생성된 fileId를 모달 상태에 보관(업로드 시 사용)
        setFileModalFileId(created.id);
      } else {
        if (!fileModalFileId) return;
        await updateDoc(doc(db, "project_document_files", fileModalFileId), {
          displayName,
          version,
        });

        await writeAudit(activeProjectId, "FILE_META_UPDATE", {
          fileId: fileModalFileId,
          displayName,
          version,
        });
      }

      await loadProjectAll(activeProjectId);
      alert("저장 완료");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] saveFileMetaFromModal failed:", e);
      alert("저장 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadFileFromModal() {
    if (!uid || !activeProjectId) return;
    if (!fileModalNodeId) return;
    if (!fileModalFileId) {
      alert("먼저 ‘저장’을 눌러 파일 메타를 생성해 주세요.");
      return;
    }
    if (!fileModalFileObj) {
      alert("업로드할 파일을 선택해 주세요.");
      return;
    }

    setLoading(true);
    try {
      // 기존 파일 정보 로드(기존 storagePath가 있으면 삭제 시도)
      const fileRef = doc(db, "project_document_files", fileModalFileId);
      const fileSnap = await getDoc(fileRef);
      const prev = fileSnap.exists() ? (fileSnap.data() as any) : null;

      const storagePath = `project_documents/${activeProjectId}/files/${fileModalFileId}/${fileModalFileObj.name}`;
      const storageRef = ref(storage, storagePath);

      // ✅ 업로드
      await uploadBytes(storageRef, fileModalFileObj);
      const downloadUrl = await getDownloadURL(storageRef);

      // ✅ 이전 storagePath 정리(가능한 경우만)
      if (prev?.storagePath && typeof prev.storagePath === "string" && prev.storagePath !== storagePath) {
        try {
          await deleteObject(ref(storage, prev.storagePath));
        } catch {
          // 삭제 실패는 치명적이지 않음(권한/존재 이슈 등)
        }
      }

      // ✅ Firestore 갱신
      await updateDoc(fileRef, {
        originalName: fileModalFileObj.name,
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "FILE_UPLOAD", {
        fileId: fileModalFileId,
        nodeId: fileModalNodeId,
        storagePath,
      });

      await loadProjectAll(activeProjectId);
      alert("업로드 완료");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] uploadFileFromModal failed:", e);
      alert("업로드 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  function handleFileModalDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setFileModalFileObj(f);
  }

  async function handleDeleteFile(fileId: string) {
    if (!uid || !activeProjectId) return;

    if (!confirm("파일을 삭제하시겠습니까? (하위 Modification List도 함께 삭제됩니다)")) return;

    setLoading(true);
    try {
      // 1) 파일 문서 로드
      const fRef = doc(db, "project_document_files", fileId);
      const fSnap = await getDoc(fRef);
      const fData = fSnap.exists() ? (fSnap.data() as any) : null;

      // 2) 관련 mods 삭제(스토리지 포함)
      const relatedMods = mods.filter((m) => m.fileId === fileId);
      for (const m of relatedMods) {
        if (m.storagePath) {
          try {
            await deleteObject(ref(storage, m.storagePath));
          } catch {}
        }
        await deleteDoc(doc(db, "project_document_mods", m.id));
      }

      // 3) 파일 스토리지 삭제
      if (fData?.storagePath) {
        try {
          await deleteObject(ref(storage, fData.storagePath));
        } catch {}
      }

      // 4) 파일 문서 삭제
      await deleteDoc(fRef);

      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });

      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] delete file failed:", e);
      alert("삭제 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMod(f: FileItem) {
    if (!uid || !activeProjectId) return;

    setLoading(true);
    try {
      // ✅ mod 문서 생성
      const created = await addDoc(collection(db, "project_document_mods"), {
        projectId: activeProjectId,
        fileId: f.id,
        storagePath: "",
        downloadUrl: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // ✅ md 파일 업로드(기본 템플릿)
      const content = `# Modification List\n\n- fileId: ${f.id}\n- createdAt: ${new Date().toISOString()}\n`;
      const blob = new Blob([content], { type: "text/markdown" });
      const storagePath = `project_documents/${activeProjectId}/mods/${f.id}/${created.id}.md`;
      const sRef = ref(storage, storagePath);

      await uploadBytes(sRef, blob);
      const downloadUrl = await getDownloadURL(sRef);

      await updateDoc(doc(db, "project_document_mods", created.id), {
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "MOD_CREATE", { fileId: f.id, modId: created.id, storagePath });

      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] create mod failed:", e);
      alert("생성 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMod(modId: string) {
    if (!uid || !activeProjectId) return;

    if (!confirm("문서를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      const mRef = doc(db, "project_document_mods", modId);
      const mSnap = await getDoc(mRef);
      const mData = mSnap.exists() ? (mSnap.data() as any) : null;

      if (mData?.storagePath) {
        try {
          await deleteObject(ref(storage, mData.storagePath));
        } catch {}
      }

      await deleteDoc(mRef);
      await writeAudit(activeProjectId, "MOD_DELETE", { modId });

      await loadProjectAll(activeProjectId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] delete mod failed:", e);
      alert("삭제 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * ✅ order 저장 (카테고리/파일)
   * ------------------------------ */
  async function persistCategoryOrder(parentId: string, orderedNodeIds: string[]) {
    if (!activeProjectId) return;
    const batch = writeBatch(db);

    orderedNodeIds.forEach((id, idx) => {
      batch.update(doc(db, "project_document_nodes", id), { order: idx + 1 });
    });

    await batch.commit();
    await writeAudit(activeProjectId, "CATEGORY_REORDER", { parentId, orderedNodeIds });
  }

  async function persistFileOrder(nodeId: string, orderedFileIds: string[]) {
    if (!activeProjectId) return;
    const batch = writeBatch(db);

    orderedFileIds.forEach((id, idx) => {
      batch.update(doc(db, "project_document_files", id), { order: idx + 1 });
    });

    await batch.commit();
    await writeAudit(activeProjectId, "FILE_REORDER", { nodeId, orderedFileIds });
  }

  /** -----------------------------
   * ✅ DnD 핸들러 - 카테고리(같은 parent) 전용
   * ------------------------------ */
  async function onDragEndCategory(parentId: string, siblings: TreeNode[], event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeNodeId = activeId.replace("node:", "");
    const overNodeId = overId.replace("node:", "");

    const oldIndex = siblings.findIndex((n) => n.id === activeNodeId);
    const newIndex = siblings.findIndex((n) => n.id === overNodeId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(siblings, oldIndex, newIndex);
    const reorderedIds = reordered.map((n) => n.id);

    // ✅ UI 즉시 반영
    setNodes((prev) => {
      const targetIds = new Set(reorderedIds);
      const rest = prev.filter((n) => !targetIds.has(n.id));
      const updated = reordered.map((n, idx) => ({ ...n, order: idx + 1 }));
      return [...rest, ...updated];
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
      const targetIds = new Set(reorderedIds);
      const rest = prev.filter((f) => !targetIds.has(f.id));
      const updated = reordered.map((f, idx) => ({ ...f, order: idx + 1 }));
      return [...rest, ...updated];
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
   * ✅ 중복 렌더 제거된 재귀 렌더
   * - 각 카테고리는 각 레벨에서 "1번만" 렌더
   * ------------------------------ */
  function renderChildrenCategories(parentId: string, depth: number) {
    const children = (nodesByParent[parentId] ?? []).filter((n) => n.type === "category");
    if (children.length === 0) return null;

    const dndIds = children.map((c) => `node:${c.id}`);

    return (
      <div className="mt-3 space-y-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void onDragEndCategory(parentId, children, e)}
        >
          <SortableContext items={dndIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {children.map((c) => renderCategoryNode(c, depth))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  function renderCategoryNode(node: TreeNode, depth: number) {
    const indent = Math.min(depth * 16, 64);

    const nodeFiles = filesByNode[node.id] ?? [];
    const fileDndIds = nodeFiles.map((f) => `file:${f.id}`);

    return (
      <div key={node.id} className="border rounded-md p-3 bg-white/40 dark:bg-black/15">
        {/* ✅ 카테고리 헤더(한 번만 표시) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            <SortableCategoryRow
              dndId={`node:${node.id}`}
              node={node}
              loading={loading}
              nameValue={nodeNameEdits[node.id] ?? node.name ?? ""}
              onNameChange={(v) => setNodeNameEdits((prev) => ({ ...prev, [node.id]: v }))}
              onSave={() => void handleSaveCategoryName(node.id)}
              onDelete={() => void handleDeleteCategory(node.id)}
            />
          </div>

          {/* ✅ 하위 카테고리 생성 */}
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
              placeholder="하위 카테고리명"
              value={newCategoryNameByParent[node.id] ?? ""}
              onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [node.id]: e.target.value }))}
              disabled={loading}
            />
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm"
              onClick={() => void handleAddCategory(node.id)}
              disabled={loading}
            >
              + 카테고리 생성
            </button>
          </div>
        </div>

        {/* ✅ 파일 관리 */}
        <div className="mt-4" style={{ paddingLeft: indent }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">📎 파일 관리</div>

            <button
              type="button"
              className="px-3 py-1 rounded border text-sm"
              onClick={() => openFileModalCreate(node.id)}
              disabled={loading}
            >
              + 파일 등록
            </button>
          </div>

          {nodeFiles.length === 0 ? (
            <div className="text-sm opacity-70">등록된 파일이 없습니다. 우측의 “+ 파일 등록”으로 추가해 주세요.</div>
          ) : (
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

        {/* ✅ 자식 카테고리 재귀 렌더 */}
        <div className="mt-3">{renderChildrenCategories(node.id, depth + 1)}</div>
      </div>
    );
  }

  /** -----------------------------
   * Render
   * ------------------------------ */
  const root = useMemo(() => {
    if (!activeProjectId) return null;
    return nodes.find((n) => n.type === "project" && n.projectId === activeProjectId) ?? null;
  }, [nodes, activeProjectId]);

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

          {!root ? (
            <div className="text-sm opacity-70">
              프로젝트 노드를 불러오지 못했습니다. (노드가 없으면 자동 복구 생성됩니다)
            </div>
          ) : (
            <div className="border rounded-md p-3 mb-3 bg-white/50 dark:bg-black/20">
              {/* ✅ 프로젝트 헤더 */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">📌 {root.name}</span>
                </div>

                {/* ✅ 루트 하위 카테고리 생성 */}
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
                    placeholder="하위 카테고리명"
                    value={newCategoryNameByParent[root.id] ?? ""}
                    onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [root.id]: e.target.value }))}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="px-3 py-1 rounded border text-sm"
                    onClick={() => void handleAddCategory(root.id)}
                    disabled={loading}
                  >
                    + 카테고리 생성
                  </button>
                </div>
              </div>

              {/* ✅ 프로젝트 루트의 자식 카테고리 */}
              <div className="mt-3">{renderChildrenCategories(root.id, 1)}</div>
            </div>
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

            <div className="text-xs opacity-60 mt-3">
              * 업로드 전에 “저장”을 먼저 눌러 파일 메타(문서)를 생성해 주세요.
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
