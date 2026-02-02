"use client";

/**
 * Project Document Page
 *
 * ✅ 이번 수정 핵심
 * 1) select 박스 다크모드 가독성 해결:
 *    - select/option에 bg/text를 명시하여 라이트/다크 모두 정상 표시
 *
 * 2) 파일 등록 방식 변경(메뉴관리처럼):
 *    - 파일 항목을 먼저 생성(메타 row 생성)
 *    - 파일명/버전은 상시 편집 + "저장" 버튼으로 Firestore 업데이트
 *    - 파일 업로드는 "파일 등록" 버튼 클릭 → 팝업(모달)에서 파일 선택/드롭 → 업로드
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

  /** 사용자가 입력/수정하는 메타 */
  displayName: string;
  version: string;

  /** 업로드 후 채워지는 값 */
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
  | "CATEGORY_DELETE"
  | "FILE_META_CREATE"
  | "FILE_META_UPDATE"
  | "FILE_UPLOAD"
  | "FILE_DELETE"
  | "MOD_CREATE"
  | "MOD_DELETE"
  | "SCAFFOLD_REPAIR";

export default function ProjectDocumentPage() {
  const { auth, db, storage } = useMemo(() => getFirebaseClient(), []);

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

  // 상단 셀렉트용: 내가 만든 프로젝트 목록
  const [myProjects, setMyProjects] = useState<ProjectDoc[]>([]);
  // 현재 선택된 프로젝트
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 선택된 프로젝트 기준 데이터
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mods, setMods] = useState<ModDoc[]>([]);

  // 카테고리 생성 입력값
  const [newCategoryNameByParent, setNewCategoryNameByParent] = useState<Record<string, string>>({});

  /** -----------------------------
   * 파일 메타(인라인 편집) state
   * - DB 저장된 파일항목을 화면에서 수정하고 저장하기 위한 임시 입력값
   * ------------------------------ */
  type FileEditState = {
    displayName: string;
    version: string;
  };
  const [fileEdits, setFileEdits] = useState<Record<string, FileEditState>>({});

  /** -----------------------------
   * 파일 업로드 팝업(모달) state
   * ------------------------------ */
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTargetFileId, setUploadTargetFileId] = useState<string | null>(null);
  const [uploadTargetNodeId, setUploadTargetNodeId] = useState<string | null>(null);
  const [uploadFileObj, setUploadFileObj] = useState<File | null>(null);

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
        setFileEdits({});

        // 모달 상태 초기화
        setUploadModalOpen(false);
        setUploadTargetFileId(null);
        setUploadTargetNodeId(null);
        setUploadFileObj(null);

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
    setFileEdits({});

    // 모달 상태 초기화
    setUploadModalOpen(false);
    setUploadTargetFileId(null);
    setUploadTargetNodeId(null);
    setUploadFileObj(null);

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
      // 보기 편하게 정렬(표시명 → 버전)
      map[k].sort((a, b) => (a.displayName + a.version).localeCompare(b.displayName + b.version));
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
   * 노드가 없는 프로젝트 자동 복구 생성(루트만)
   * ------------------------------ */
  async function ensureProjectScaffold(projectId: string, projectNameForRoot: string) {
    if (!uid) return;

    // local에서 root가 이미 있으면 패스
    const hasRootLocal = nodes.some((n) => n.projectId === projectId && n.type === "project");
    if (hasRootLocal) return;

    // DB에서도 확인
    const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
    const nSnap = await getDocs(nodesQ);
    if (nSnap.size > 0) return;

    // root node만 생성 (카테고리 자동 생성 없음)
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
      // project
      const pSnap = await getDoc(doc(db, "project_documents", projectId));
      const pDoc = pSnap.exists() ? ({ id: pSnap.id, ...(pSnap.data() as any) } as ProjectDoc) : null;
      setProject(pDoc);

      // nodes
      const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
      const nSnap = await getDocs(nodesQ);
      const nListRaw = nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
      const nList = [...nListRaw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setNodes(nList);

      // files
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      const fileList = fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[];
      setFiles(fileList);

      // mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      setMods(mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[]);

      // ✅ 파일 인라인 편집값 초기화(불러온 파일 기준)
      setFileEdits((prev) => {
        const next = { ...prev };
        for (const f of fileList) {
          // 이미 편집 중인 값이 있으면 유지, 없으면 DB값으로 세팅
          if (!next[f.id]) {
            next[f.id] = {
              displayName: f.displayName ?? "",
              version: f.version ?? "",
            };
          }
        }
        // 삭제된 파일은 edit state에서도 제거(안정성)
        for (const k of Object.keys(next)) {
          if (!fileList.some((f) => f.id === k)) delete next[k];
        }
        return next;
      });

      // root 없으면 자동복구 후 다시 로드
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
   * 프로젝트 생성 (카테고리 자동 생성 없음)
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
      // 프로젝트 문서 생성
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 루트 노드 생성
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

      // 셀렉트 즉시 반영 + 자동 선택
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
   * 카테고리 생성/삭제
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
      const siblings = nodes.filter((n) => n.parentId === parentId);
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
   * 파일 항목(메타 row) 추가/저장/삭제
   * - "파일 등록"은 모달에서 수행
   * ------------------------------ */
  async function handleAddFileMeta(nodeId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    try {
      // 파일 메타만 먼저 생성(업로드는 나중에)
      const fileRef = await addDoc(collection(db, "project_document_files"), {
        projectId: activeProjectId,
        nodeId,
        displayName: "",
        version: "",
        originalName: "",
        storagePath: "",
        downloadUrl: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(activeProjectId, "FILE_META_CREATE", { fileId: fileRef.id, nodeId });

      // 편집 상태 초기값 세팅
      setFileEdits((prev) => ({
        ...prev,
        [fileRef.id]: { displayName: "", version: "" },
      }));

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveFileMeta(fileId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const edit = fileEdits[fileId];
    if (!edit) return;

    // 파일명은 필수로 강제(원하시면 버전도 필수 가능)
    const dn = (edit.displayName ?? "").trim();
    if (!dn) {
      alert("파일명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, "project_document_files", fileId), {
        displayName: dn,
        version: (edit.version ?? "").trim(),
      });

      await writeAudit(activeProjectId, "FILE_META_UPDATE", { fileId, displayName: dn, version: (edit.version ?? "").trim() });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const showTarget = files.find((f) => f.id === fileId);
    if (!showTarget) return;

    const linkedMods = (modsByFile[fileId] ?? []).length;
    if (linkedMods > 0) {
      alert("이 파일에 연결된 Modification List 문서가 있습니다. 먼저 문서를 삭제해 주세요.");
      return;
    }

    if (!confirm("파일 항목을 삭제하시겠습니까? (업로드된 파일이 있으면 스토리지에서도 삭제됩니다)")) return;

    setLoading(true);
    try {
      // 업로드된 파일이 있으면 스토리지도 삭제
      if (showTarget.storagePath) {
        try {
          await deleteObject(ref(storage, showTarget.storagePath));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[ProjectDocument] storage delete failed (ignore):", e);
        }
      }

      await deleteDoc(doc(db, "project_document_files", fileId));
      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });

      // 편집 상태도 제거
      setFileEdits((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 파일 업로드 모달 open/close
   * ------------------------------ */
  function openUploadModal(fileId: string, nodeId: string) {
    setUploadTargetFileId(fileId);
    setUploadTargetNodeId(nodeId);
    setUploadFileObj(null);
    setUploadModalOpen(true);
  }

  function closeUploadModal() {
    setUploadModalOpen(false);
    setUploadTargetFileId(null);
    setUploadTargetNodeId(null);
    setUploadFileObj(null);
  }

  function handleModalDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    setUploadFileObj(file);
  }

  /** -----------------------------
   * 실제 파일 업로드(모달에서 수행)
   * ------------------------------ */
  async function handleUploadInModal() {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }
    if (!uploadTargetFileId || !uploadTargetNodeId) return;

    const targetFile = files.find((f) => f.id === uploadTargetFileId);
    if (!targetFile) {
      alert("업로드 대상 파일 항목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }

    // ✅ 파일명(메타)이 먼저 저장되어 있어야 한다: 메뉴관리 방식
    const edit = fileEdits[uploadTargetFileId];
    const dn = (edit?.displayName ?? targetFile.displayName ?? "").trim();
    if (!dn) {
      alert("먼저 파일명을 입력하고 '저장'을 눌러 주세요.");
      return;
    }

    if (!uploadFileObj) {
      alert("업로드할 파일을 선택하거나 드래그하여 추가해 주세요.");
      return;
    }

    setLoading(true);
    try {
      // 기존 업로드가 있으면 교체 업로드 가능하도록 기존 파일 삭제 시도(실패해도 진행)
      if (targetFile.storagePath) {
        try {
          await deleteObject(ref(storage, targetFile.storagePath));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[ProjectDocument] old storage delete failed (ignore):", e);
        }
      }

      // storage path: fileId 기준으로 보관
      const storagePath = `project_documents/${activeProjectId}/files/${uploadTargetFileId}/${uploadFileObj.name}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, uploadFileObj);
      const downloadUrl = await getDownloadURL(storageRef);

      // 업로드 정보 Firestore 업데이트
      await updateDoc(doc(db, "project_document_files", uploadTargetFileId), {
        originalName: uploadFileObj.name,
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "FILE_UPLOAD", {
        fileId: uploadTargetFileId,
        nodeId: uploadTargetNodeId,
        originalName: uploadFileObj.name,
        storagePath,
      });

      closeUploadModal();
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

      // markdown 기본 템플릿 생성
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
   * UI - recursive render
   * ------------------------------ */
  function renderNode(node: TreeNode, depth: number) {
    const childNodes = nodesByParent[node.id] ?? [];
    const nodeFiles = filesByNode[node.id] ?? [];
    const indent = Math.min(depth * 16, 64);

    return (
      <div key={node.id} className="border rounded-md p-3 mb-3 bg-white/50 dark:bg-black/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            <span className="text-sm font-semibold">
              {node.type === "project" ? "📌 Project" : "📁 Category"}: {node.name}
            </span>

            {node.type === "category" && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border"
                onClick={() => handleDeleteCategory(node.id)}
                disabled={loading}
                title="하위/파일이 없을 때만 삭제 가능"
              >
                삭제
              </button>
            )}
          </div>

          {/* ✅ 카테고리 생성 UI는 project/ category 모두에 동일하게 제공(하위 생성 가능) */}
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

              {/* ✅ 메뉴관리처럼: 파일 항목 row를 먼저 생성 */}
              <button
                type="button"
                className="px-3 py-1 rounded border text-sm"
                onClick={() => handleAddFileMeta(node.id)}
                disabled={loading}
                title="파일 항목(메타)을 먼저 만들고, 파일 업로드는 팝업에서 진행합니다."
              >
                + 파일 항목 추가
              </button>
            </div>

            {nodeFiles.length === 0 ? (
              <div className="text-sm opacity-70">등록된 파일 항목이 없습니다. 우측의 “+ 파일 항목 추가”로 생성해 주세요.</div>
            ) : (
              <div className="space-y-2">
                {nodeFiles.map((f) => {
                  const edit = fileEdits[f.id] ?? { displayName: f.displayName ?? "", version: f.version ?? "" };
                  const linkedMods = modsByFile[f.id] ?? [];

                  return (
                    <div key={f.id} className="border rounded p-3 bg-white dark:bg-black/30">
                      {/* 상단: 메타 편집(파일명/버전) + 저장 */}
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                        {/* 파일명 - 3/6 */}
                        <div className="flex flex-col gap-1 md:col-span-3">
                          <label className="text-xs opacity-70">파일명(표시명)</label>
                          <input
                            className="border rounded px-2 py-2 text-sm bg-transparent"
                            placeholder="예: CRF Specification"
                            value={edit.displayName}
                            onChange={(e) =>
                              setFileEdits((prev) => ({
                                ...prev,
                                [f.id]: { ...prev[f.id], displayName: e.target.value },
                              }))
                            }
                            disabled={loading}
                          />
                        </div>

                        {/* 버전 - 1/6 */}
                        <div className="flex flex-col gap-1 md:col-span-1">
                          <label className="text-xs opacity-70">버전</label>
                          <input
                            className="border rounded px-2 py-2 text-sm bg-transparent"
                            placeholder="v1.0"
                            value={edit.version}
                            onChange={(e) =>
                              setFileEdits((prev) => ({
                                ...prev,
                                [f.id]: { ...prev[f.id], version: e.target.value },
                              }))
                            }
                            disabled={loading}
                          />
                        </div>

                        {/* 저장/삭제 - 2/6 */}
                        <div className="flex gap-2 md:col-span-2">
                          <button type="button" className="px-3 py-2 rounded border text-sm" onClick={() => handleSaveFileMeta(f.id)} disabled={loading}>
                            저장
                          </button>
                          <button type="button" className="px-3 py-2 rounded border text-sm" onClick={() => handleDeleteFile(f.id)} disabled={loading}>
                            삭제
                          </button>
                        </div>
                      </div>

                      {/* 업로드/다운로드 영역 */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs opacity-70">
                          {f.originalName ? (
                            <>
                              원본: <span className="opacity-90">{f.originalName}</span>
                            </>
                          ) : (
                            "업로드된 파일 없음"
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {f.downloadUrl ? (
                            <a className="px-3 py-1 rounded border text-sm" href={f.downloadUrl} target="_blank" rel="noreferrer">
                              다운로드
                            </a>
                          ) : null}

                          {/* ✅ 파일 등록(업로드)은 팝업에서 */}
                          <button
                            type="button"
                            className="px-3 py-1 rounded border text-sm"
                            onClick={() => openUploadModal(f.id, f.nodeId)}
                            disabled={loading}
                            title="팝업에서 파일을 선택/드래그하여 업로드합니다."
                          >
                            파일 등록
                          </button>

                          <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => handleCreateMod(f)} disabled={loading}>
                            + Modification List 생성
                          </button>
                        </div>
                      </div>

                      {/* Modification List 리스트 */}
                      <div className="mt-3">
                        <div className="text-xs font-semibold opacity-80 mb-1">Modification List</div>
                        {linkedMods.length === 0 ? (
                          <div className="text-xs opacity-70">생성된 문서가 없습니다.</div>
                        ) : (
                          <div className="space-y-1">
                            {linkedMods.map((m) => (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span>📄 {m.id}.md</span>
                                  {m.downloadUrl ? (
                                    <a href={m.downloadUrl} target="_blank" rel="noreferrer" className="underline">
                                      다운로드
                                    </a>
                                  ) : null}
                                </div>
                                <button type="button" className="px-2 py-1 rounded border" onClick={() => handleDeleteMod(m.id)} disabled={loading}>
                                  문서 삭제
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 자식 노드 렌더 */}
        {childNodes.length > 0 && <div className="mt-3 space-y-3">{childNodes.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  }

  /** -----------------------------
   * Render
   * ------------------------------ */
  return (
    <main className="p-6">
      {/* 제목 */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold">Project Document</h1>
        <div className="text-xs opacity-70">{uid ? `로그인: ${userEmail ?? uid}` : "비로그인"}</div>
      </div>

      {/* 상단: 프로젝트 선택/생성 */}
      <section className="border rounded-md p-4 mb-6 bg-white/50 dark:bg-black/20">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">내 프로젝트</div>

            {/* ✅ 다크/라이트 모두 가독성 확보: bg/text 명시 + option도 명시 */}
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
              <button type="button" className="px-4 py-2 rounded border" onClick={handleCreateProject} disabled={loading}>
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

      {/* 본문 */}
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

      {/* ✅ 파일 업로드 팝업(모달) */}
      {uploadModalOpen ? (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          {/* 배경 */}
          <div className="absolute inset-0 bg-black/60" onClick={closeUploadModal} />

          {/* 본체 */}
          <div className="relative w-[92vw] max-w-xl border rounded-lg bg-white text-black dark:bg-slate-950 dark:text-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">파일 등록</div>
              <button type="button" className="px-2 py-1 rounded border text-sm" onClick={closeUploadModal} disabled={loading}>
                닫기
              </button>
            </div>

            <div className="text-xs opacity-70 mb-3">
              파일은 여기에서 업로드됩니다. (파일명/버전은 인라인에서 입력 후 저장하세요)
            </div>

            {/* 드래그&드롭 박스 + 파일 선택 */}
            <div
              className="border rounded p-3 text-sm bg-transparent"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleModalDrop}
              title="여기에 파일을 드래그&드롭하거나, 아래 버튼으로 선택하세요."
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate">{uploadFileObj ? `선택됨: ${uploadFileObj.name}` : "여기로 드래그&드롭"}</div>

                <label htmlFor="modal_file_input" className="px-2 py-1 rounded border text-xs cursor-pointer whitespace-nowrap">
                  파일 선택
                </label>
                <input
                  id="modal_file_input"
                  type="file"
                  className="hidden"
                  onChange={(e) => setUploadFileObj(e.target.files?.[0] ?? null)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="text-xs opacity-70 mt-2">{uploadFileObj ? "선택된 파일 있음" : "선택된 파일 없음"}</div>

            <div className="flex gap-2 mt-4">
              <button type="button" className="px-4 py-2 rounded border text-sm" onClick={handleUploadInModal} disabled={loading}>
                업로드
              </button>
              <button type="button" className="px-4 py-2 rounded border text-sm" onClick={closeUploadModal} disabled={loading}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
