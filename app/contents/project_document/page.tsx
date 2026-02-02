"use client";

/**
 * projnow/app/contents/project_document/page.tsx
 * - 프로젝트 문서 게시판(트리) + 파일 업로드 + 버전 + Modification List + 감사로그
 * - 디자인 변경 최소화: 기본적인 Tailwind만 사용(프로젝트 스타일에 맞게 class만 조정 가능)
 *
 * 전제:
 * - Firebase Client SDK 초기화가 이미 되어 있어야 합니다.
 * - 아래 import 경로는 예시입니다. 프로젝트에서 사용 중인 경로로 맞춰주세요.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// ✅ 프로젝트에서 실제 사용하는 firebase export로 바꿔주세요.
import { db, auth, storage } from "@/lib/firebaseClient"; // ← 경로/이름은 프로젝트에 맞게 수정

type NodeType = "project" | "category";

type ProjectDoc = {
  id: string;
  name: string;
  createdAt?: any;
  createdBy?: string;
};

type TreeNode = {
  id: string;
  projectId: string;
  type: NodeType; // project|category
  parentId: string | null; // project 루트면 null
  name: string;
  order: number; // 같은 부모 내 정렬
  createdAt?: any;
  createdBy?: string;
};

type FileItem = {
  id: string;
  projectId: string;
  nodeId: string; // 어느 카테고리에 속하는지
  displayName: string; // 사용자가 입력한 파일명(표시명)
  version: string; // 사용자가 입력한 버전(분리 입력)
  originalName: string; // 실제 업로드 파일명
  storagePath: string; // Storage 경로
  downloadUrl?: string; // 필요 시
  createdAt?: any;
  createdBy?: string;
};

type ModDoc = {
  id: string;
  projectId: string;
  fileId: string;
  storagePath: string;
  downloadUrl?: string;
  createdAt?: any;
  createdBy?: string;
};

type AuditAction =
  | "PROJECT_CREATE"
  | "CATEGORY_CREATE"
  | "CATEGORY_DELETE"
  | "FILE_UPLOAD"
  | "FILE_DELETE"
  | "MOD_CREATE"
  | "MOD_DELETE";

export default function ProjectDocumentPage() {
  // -----------------------------
  // Auth state
  // -----------------------------
  const [uid, setUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // -----------------------------
  // UI state
  // -----------------------------
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 트리/파일/문서 데이터
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mods, setMods] = useState<ModDoc[]>([]);

  // 카테고리 생성 입력 상태(노드별)
  const [newCategoryNameByParent, setNewCategoryNameByParent] = useState<Record<string, string>>({});

  // 파일 등록 폼 상태(카테고리별로 여러 폼)
  // - "폼"은 로컬 UI 상태이며, 업로드 완료 시 Firestore에 file 문서가 생성됩니다.
  type UploadForm = {
    formId: string; // 로컬 식별자
    displayName: string;
    version: string;
    fileObj: File | null;
    // 중복 파일명 경고 노출 여부
    duplicateNameWarn: boolean;
  };
  const [uploadFormsByNode, setUploadFormsByNode] = useState<Record<string, UploadForm[]>>({});

  // -----------------------------
  // Effects
  // -----------------------------
  useEffect(() => {
    // Firebase Auth 로그인 상태 구독
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setUid(null);
        setUserEmail(null);
        return;
      }
      setUid(user.uid);
      setUserEmail(user.email ?? null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // 프로젝트 선택(또는 생성) 후 데이터 로딩
    if (!activeProjectId) return;
    void loadProjectAll(activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // -----------------------------
  // Helpers
  // -----------------------------
  const rootNodeId = useMemo(() => {
    // "project_documents"와 "project_document_nodes"를 분리했기 때문에
    // projectId 자체가 루트 노드가 아닙니다. 루트 노드는 type="project" 노드입니다.
    const root = nodes.find((n) => n.type === "project" && n.projectId === activeProjectId);
    return root?.id ?? null;
  }, [nodes, activeProjectId]);

  const nodesByParent = useMemo(() => {
    // parentId -> children nodes 정렬 맵
    const map: Record<string, TreeNode[]> = {};
    for (const n of nodes) {
      const key = n.parentId ?? "__ROOT__";
      if (!map[key]) map[key] = [];
      map[key].push(n);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [nodes]);

  const filesByNode = useMemo(() => {
    // nodeId -> files
    const map: Record<string, FileItem[]> = {};
    for (const f of files) {
      if (!map[f.nodeId]) map[f.nodeId] = [];
      map[f.nodeId].push(f);
    }
    // 정렬(생성일 기준 정렬하고 싶으면 여기를 수정)
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.displayName + a.version).localeCompare(b.displayName + b.version));
    }
    return map;
  }, [files]);

  const modsByFile = useMemo(() => {
    // fileId -> mods
    const map: Record<string, ModDoc[]> = {};
    for (const m of mods) {
      if (!map[m.fileId]) map[m.fileId] = [];
      map[m.fileId].push(m);
    }
    return map;
  }, [mods]);

  function makeLocalId(prefix: string) {
    // 로컬에서 폼 식별자로 쓸 간단 id
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function writeAudit(projectId: string, action: AuditAction, payload: Record<string, any>) {
    // ✅ 문서 생성/삭제/업로드 등 이력 테이블 기록
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

  // -----------------------------
  // Loaders
  // -----------------------------
  async function loadProjectAll(projectId: string) {
    setLoading(true);
    try {
      // 1) project meta
      const pSnap = await getDoc(doc(db, "project_documents", projectId));
      if (pSnap.exists()) {
        setProject({ id: pSnap.id, ...(pSnap.data() as any) });
      } else {
        setProject(null);
      }

      // 2) nodes
      const nodesQ = query(
        collection(db, "project_document_nodes"),
        where("projectId", "==", projectId),
        orderBy("order", "asc")
      );
      const nSnap = await getDocs(nodesQ);
      const nList: TreeNode[] = nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setNodes(nList);

      // 3) files
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      const fList: FileItem[] = fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setFiles(fList);

      // 4) mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      const mList: ModDoc[] = mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMods(mList);

      // 5) 업로드 폼 초기화(필요하면 유지)
      // - 기존 폼 상태를 강제로 날리지 않기 위해 기본은 유지합니다.
      // - 원하는 UX에 따라 여기서 setUploadFormsByNode({})로 초기화할 수 있습니다.
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // Project create/save
  // -----------------------------
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
      // 1) 프로젝트 문서 생성
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2) 프로젝트 루트 노드 생성(type="project")
      await addDoc(collection(db, "project_document_nodes"), {
        projectId: projectRef.id,
        type: "project",
        parentId: null,
        name,
        order: 0,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 3) 감사 로그
      await writeAudit(projectRef.id, "PROJECT_CREATE", { name });

      // 4) 활성 프로젝트로 전환
      setActiveProjectId(projectRef.id);
      setProjectName("");
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // Category create/delete
  // -----------------------------
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
      // 같은 parentId의 마지막 order+1
      const siblings = nodes.filter((n) => n.parentId === parentId);
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 1;

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

      // 입력값 초기화 + 리로드
      setNewCategoryNameByParent((prev) => ({ ...prev, [parentId]: "" }));
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCategory(nodeId: string) {
    // ✅ 주의: 카테고리 삭제 시 하위 카테고리/파일도 함께 처리해야 합니다.
    // 여기서는 "하위가 있는 경우 삭제 불가"로 안전하게 막습니다. (원하시면 cascade 삭제로 변경)
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

    setLoading(true);
    try {
      await deleteDoc(doc(db, "project_document_nodes", nodeId));
      await writeAudit(activeProjectId, "CATEGORY_DELETE", { nodeId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // Upload form add/remove
  // -----------------------------
  function addUploadForm(nodeId: string) {
    // ✅ (5) 파일 추가 등록 시 폼을 추가 생성
    const newForm: UploadForm = {
      formId: makeLocalId("form"),
      displayName: "",
      version: "",
      fileObj: null,
      duplicateNameWarn: false,
    };
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      const arr = next[nodeId] ? [...next[nodeId]] : [];
      arr.push(newForm);
      next[nodeId] = arr;
      return next;
    });
  }

  function removeUploadForm(nodeId: string, formId: string) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      next[nodeId] = (next[nodeId] ?? []).filter((f) => f.formId !== formId);
      return next;
    });
  }

  function updateUploadForm(nodeId: string, formId: string, patch: Partial<UploadForm>) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      const arr = next[nodeId] ? [...next[nodeId]] : [];
      next[nodeId] = arr.map((f) => (f.formId === formId ? { ...f, ...patch } : f));
      return next;
    });
  }

  // -----------------------------
  // Duplicate name check
  // -----------------------------
  function checkDuplicateName(nodeId: string, displayName: string): boolean {
    // ✅ (6) 동일 파일명이 등록될 경우 버전 작성 가이드 알림
    // - "같은 카테고리(nodeId)" 기준으로 중복 체크(원하시면 프로젝트 전체로 확대 가능)
    const dn = displayName.trim().toLowerCase();
    if (!dn) return false;
    return (filesByNode[nodeId] ?? []).some((f) => f.displayName.trim().toLowerCase() === dn);
  }

  // -----------------------------
  // File upload
  // -----------------------------
  async function handleUpload(nodeId: string, form: UploadForm) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const displayName = form.displayName.trim();
    const version = form.version.trim();
    const fileObj = form.fileObj;

    if (!displayName) {
      alert("파일명을 입력해 주세요.");
      return;
    }
    if (!fileObj) {
      alert("업로드할 파일을 선택하거나 드래그하여 추가해 주세요.");
      return;
    }

    // 동일 파일명 중복 안내(버전 입력 유도)
    const isDup = checkDuplicateName(nodeId, displayName);
    if (isDup && !version) {
      alert("동일한 파일명이 이미 존재합니다. 버전을 입력해 주세요. (예: v1.1, v2)");
      updateUploadForm(nodeId, form.formId, { duplicateNameWarn: true });
      return;
    }

    setLoading(true);
    try {
      // 1) Firestore file doc 먼저 생성(문서 ID 확보)
      const fileRef = await addDoc(collection(db, "project_document_files"), {
        projectId: activeProjectId,
        nodeId,
        displayName,
        version: version || "", // 버전은 분리 입력
        originalName: fileObj.name,
        storagePath: "", // 업로드 후 업데이트
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 2) Storage 업로드
      const storagePath = `project_documents/${activeProjectId}/files/${fileRef.id}/${fileObj.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, fileObj);

      // 3) 다운로드 URL 획득(바로 버튼에 사용)
      const downloadUrl = await getDownloadURL(storageRef);

      // 4) Firestore 업데이트
      await updateDoc(doc(db, "project_document_files", fileRef.id), {
        storagePath,
        downloadUrl,
      });

      // 5) 감사 로그
      await writeAudit(activeProjectId, "FILE_UPLOAD", {
        fileId: fileRef.id,
        nodeId,
        displayName,
        version: version || "",
        originalName: fileObj.name,
      });

      // 6) 업로드 완료 후 폼 초기화(원하시면 폼 유지도 가능)
      updateUploadForm(nodeId, form.formId, {
        fileObj: null,
        duplicateNameWarn: false,
      });

      // 7) 데이터 갱신
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFile(fileId: string) {
    // ✅ 파일 삭제(스토리지 파일 + Firestore 문서) + 로그
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const target = files.find((f) => f.id === fileId);
    if (!target) return;

    // 파일에 연결된 mod 문서가 있으면 먼저 처리하도록 안전하게 막습니다.
    const linkedMods = (modsByFile[fileId] ?? []).length;
    if (linkedMods > 0) {
      alert("이 파일에 연결된 Modification List 문서가 있습니다. 먼저 문서를 삭제해 주세요.");
      return;
    }

    if (!confirm("파일을 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      // 1) Storage 삭제
      if (target.storagePath) {
        await deleteObject(ref(storage, target.storagePath));
      }
      // 2) Firestore 삭제
      await deleteDoc(doc(db, "project_document_files", fileId));

      // 3) 로그
      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // Drag & Drop handlers
  // -----------------------------
  function handleDrop(nodeId: string, formId: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    updateUploadForm(nodeId, formId, { fileObj: file });
  }

  // -----------------------------
  // Modification List create/delete
  // -----------------------------
  async function handleCreateMod(file: FileItem) {
    // ✅ (7) 파일명이 동일하고 버전이 다른 파일 업로드 케이스에서,
    // 각 파일등록 폼(=file item)마다 Modification List 문서 생성 버튼 제공
    // - 여기서는 "간단한 Markdown 문서"를 생성해 Storage에 저장합니다.
    // - 향후 docx 생성(서버)로 확장 가능합니다.
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    try {
      // 1) mod Firestore doc 먼저 생성
      const modRef = await addDoc(collection(db, "project_document_mods"), {
        projectId: activeProjectId,
        fileId: file.id,
        storagePath: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 2) 문서 내용 생성(초기 템플릿)
      const content = [
        `# Modification List`,
        ``,
        `- ProjectId: ${activeProjectId}`,
        `- File: ${file.displayName}`,
        `- Version: ${file.version || "(none)"}`,
        `- Original: ${file.originalName}`,
        `- CreatedAt: ${new Date().toISOString()}`,
        ``,
        `## Changes`,
        `- (예) 항목 추가: ...`,
        `- (예) 항목 수정: ...`,
        `- (예) 항목 삭제: ...`,
        ``,
      ].join("\n");

      // 3) Storage 업로드
      const storagePath = `project_documents/${activeProjectId}/mods/${file.id}/${modRef.id}.md`;
      const storageRef = ref(storage, storagePath);
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      await uploadBytes(storageRef, blob);

      // 4) URL
      const downloadUrl = await getDownloadURL(storageRef);

      // 5) Firestore 업데이트
      await updateDoc(doc(db, "project_document_mods", modRef.id), {
        storagePath,
        downloadUrl,
      });

      // 6) 로그
      await writeAudit(activeProjectId, "MOD_CREATE", {
        modId: modRef.id,
        fileId: file.id,
        storagePath,
      });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMod(modId: string) {
    // ✅ (8) 생성된 문서 삭제 가능 + (9) 로그
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const target = mods.find((m) => m.id === modId);
    if (!target) return;

    if (!confirm("Modification List 문서를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      // 1) Storage 삭제
      if (target.storagePath) {
        await deleteObject(ref(storage, target.storagePath));
      }
      // 2) Firestore 삭제
      await deleteDoc(doc(db, "project_document_mods", modId));

      // 3) 로그
      await writeAudit(activeProjectId, "MOD_DELETE", { modId, fileId: target.fileId });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // UI Render helpers
  // -----------------------------
  function renderNode(node: TreeNode, depth: number) {
    const childNodes = nodesByParent[node.id] ?? [];
    const nodeFiles = filesByNode[node.id] ?? [];
    const uploadForms = uploadFormsByNode[node.id] ?? [];

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
                title="하위 항목이 없는 경우에만 삭제됩니다."
                disabled={loading}
              >
                삭제
              </button>
            )}
          </div>

          {/* 하위 카테고리 생성 */}
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
              placeholder="하위 카테고리명"
              value={newCategoryNameByParent[node.id] ?? ""}
              onChange={(e) =>
                setNewCategoryNameByParent((prev) => ({ ...prev, [node.id]: e.target.value }))
              }
              disabled={loading}
            />
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm"
              onClick={() => handleAddCategory(node.id)}
              disabled={loading}
            >
              + 카테고리 생성
            </button>
          </div>
        </div>

        {/* (4)(5)(6) 파일 등록 폼 섹션: category 하단에 파일 등록 폼 생성 */}
        {node.type === "category" && (
          <div className="mt-4" style={{ paddingLeft: indent }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">📎 파일 등록</div>
              <button
                type="button"
                className="px-3 py-1 rounded border text-sm"
                onClick={() => addUploadForm(node.id)}
                disabled={loading}
              >
                + 파일 등록폼 추가
              </button>
            </div>

            {/* 업로드 폼 리스트 */}
            <div className="space-y-3">
              {uploadForms.map((form) => {
                const isDup = checkDuplicateName(node.id, form.displayName);

                return (
                  <div key={form.formId} className="border rounded p-3 bg-white dark:bg-black/30">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm font-semibold">등록 폼</div>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border"
                        onClick={() => removeUploadForm(node.id, form.formId)}
                        disabled={loading}
                      >
                        폼 제거
                      </button>
                    </div>

                    {/* (6) 파일명 / 버전 분리 입력 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">파일명(표시명)</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="예: CRF Specification"
                          value={form.displayName}
                          onChange={(e) =>
                            updateUploadForm(node.id, form.formId, {
                              displayName: e.target.value,
                              duplicateNameWarn: false,
                            })
                          }
                          disabled={loading}
                        />
                        {(isDup || form.duplicateNameWarn) && (
                          <div className="text-xs text-red-600">
                            동일한 파일명이 이미 등록되어 있습니다. 버전을 입력해 주세요.
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">버전</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="예: v1.0 / v2"
                          value={form.version}
                          onChange={(e) => updateUploadForm(node.id, form.formId, { version: e.target.value })}
                          disabled={loading}
                        />
                      </div>

                      {/* 파일 선택/드롭 */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">파일</label>
                        <div
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDrop(node.id, form.formId, e)}
                          title="여기에 파일을 드래그&드롭하거나 아래에서 선택하세요."
                        >
                          {form.fileObj ? `선택됨: ${form.fileObj.name}` : "여기로 드래그&드롭"}
                        </div>
                        <input
                          type="file"
                          className="text-sm"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            updateUploadForm(node.id, form.formId, { fileObj: f });
                          }}
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        className="px-3 py-2 rounded border text-sm"
                        onClick={() => handleUpload(node.id, form)}
                        disabled={loading}
                      >
                        업로드
                      </button>
                    </div>
                  </div>
                );
              })}

              {uploadForms.length === 0 && (
                <div className="text-sm opacity-70">파일 등록폼을 추가해 주세요.</div>
              )}
            </div>

            {/* 업로드된 파일 목록 */}
            <div className="mt-4">
              <div className="text-sm font-medium mb-2">📄 등록된 파일</div>
              {nodeFiles.length === 0 ? (
                <div className="text-sm opacity-70">등록된 파일이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {nodeFiles.map((f) => {
                    const linkedMods = modsByFile[f.id] ?? [];
                    return (
                      <div key={f.id} className="border rounded p-3 bg-white dark:bg-black/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-semibold">
                              {f.displayName}{" "}
                              {f.version ? <span className="text-xs opacity-70">({f.version})</span> : null}
                            </div>
                            <div className="text-xs opacity-70">원본 파일: {f.originalName}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {f.downloadUrl && (
                              <a
                                className="px-3 py-1 rounded border text-sm"
                                href={f.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                다운로드
                              </a>
                            )}

                            {/* (7) Modification List 생성 버튼 */}
                            <button
                              type="button"
                              className="px-3 py-1 rounded border text-sm"
                              onClick={() => handleCreateMod(f)}
                              disabled={loading}
                              title="이 파일 버전에 대한 변경사항 문서를 생성합니다."
                            >
                              + Modification List 생성
                            </button>

                            <button
                              type="button"
                              className="px-3 py-1 rounded border text-sm"
                              onClick={() => handleDeleteFile(f.id)}
                              disabled={loading}
                            >
                              파일 삭제
                            </button>
                          </div>
                        </div>

                        {/* 생성된 mod 문서 목록 + 삭제 */}
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
                                    {m.downloadUrl && (
                                      <a href={m.downloadUrl} target="_blank" rel="noreferrer" className="underline">
                                        다운로드
                                      </a>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="px-2 py-1 rounded border"
                                    onClick={() => handleDeleteMod(m.id)}
                                    disabled={loading}
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
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 하위 카테고리 렌더 */}
        {childNodes.length > 0 && (
          <div className="mt-3 space-y-3">
            {childNodes.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <main className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold">Project Document</h1>
        <div className="text-xs opacity-70">{uid ? `로그인: ${userEmail ?? uid}` : "비로그인"}</div>
      </div>

      {/* (1) Project 명 입력하여 저장 */}
      <section className="border rounded-md p-4 mb-6 bg-white/50 dark:bg-black/20">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-3 justify-between">
          <div className="flex-1">
            <div className="text-sm font-semibold mb-2">프로젝트 생성</div>
            <input
              className="border rounded px-3 py-2 w-full md:w-[420px] bg-transparent"
              placeholder="Project 명 입력"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={loading}
            />
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded border"
            onClick={handleCreateProject}
            disabled={loading}
          >
            저장
          </button>
        </div>

        {/* 활성 프로젝트 표시 */}
        <div className="mt-3 text-sm">
          <span className="font-semibold">현재 프로젝트: </span>
          <span className="opacity-80">
            {activeProjectId ? `${project?.name ?? "(로드중)"} (${activeProjectId})` : "없음"}
          </span>
        </div>

        {/* 개발 단계에서는 프로젝트 선택 기능이 필요할 수 있습니다.
            실제 운영에서는 "프로젝트 목록 페이지"에서 projectId를 선택하게 하는 것이 보통입니다. */}
      </section>

      {/* 트리 영역 */}
      {!activeProjectId ? (
        <div className="text-sm opacity-70">프로젝트를 생성하면 카테고리/파일 등록이 가능합니다.</div>
      ) : (
        <section>
          {loading && <div className="text-sm opacity-70 mb-3">처리 중...</div>}
          {!rootNodeId ? (
            <div className="text-sm opacity-70">프로젝트 루트 노드를 찾을 수 없습니다.</div>
          ) : (
            <>
              {/* 루트부터 렌더 */}
              {nodes
                .filter((n) => n.id === rootNodeId)
                .map((root) => renderNode(root, 0))}
            </>
          )}
        </section>
      )}
    </main>
  );
}
