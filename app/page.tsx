"use client";

// app/page.tsx
// - 첫 랜딩 페이지(업무 프로세스 지원툴 소개 + 로그인 UI)
// - Google 로그인 성공 시 /convert로 이동
// - Firebase 설정은 환경변수(NEXT_PUBLIC_*) 기반 (실서비스 운영에 적합)

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Firebase (프로젝트에 firebase 패키지가 설치되어 있어야 합니다)
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User,
} from "firebase/auth";

// ✅ Firebase 초기화 유틸 (중복 초기화 방지)
function getFirebaseAuth() {
  // 환경변수 기반 구성 (Vercel Environment Variables에도 동일하게 등록)
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, // 🔑
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  // 필수값 누락 시 런타임에서 사용자에게 안내하기 위한 방어
  const requiredKeys = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.appId,
  ];
  const isMissing = requiredKeys.some((v) => !v);

  if (isMissing) {
    // initializeApp을 호출하지 않고, 에러를 던져 UI에서 처리
    throw new Error(
      "Firebase 환경변수가 누락되었습니다. NEXT_PUBLIC_FIREBASE_* 값을 설정해주세요."
    );
  }

  // 이미 초기화된 앱이 있으면 재사용
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

  return getAuth(app);
}

export default function HomePage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null); // 로그인 유저
  const [loading, setLoading] = useState(true); // 초기 인증 상태 확인 로딩
  const [errorMsg, setErrorMsg] = useState<string>(""); // 에러 메시지

  // auth는 memo로 한 번만 생성 (렌더마다 재생성 방지)
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Firebase 초기화 오류가 발생했습니다.");
      return null;
    }
  }, []);

  // ✅ 로그인 상태 구독 (페이지 새로고침해도 로그인 유지)
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      // 로그인 되어 있으면 /convert로 이동 (첫 화면에서 곧바로 업무 화면 진입)
      if (u) {
        router.replace("/convert");
      }
    });

    return () => unsub();
  }, [auth, router]);

  // ✅ 구글 로그인
  const handleGoogleLogin = async () => {
    try {
      setErrorMsg("");

      if (!auth) {
        setErrorMsg("Firebase 인증이 준비되지 않았습니다. 환경변수를 확인해주세요.");
        return;
      }

      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);

      // onAuthStateChanged에서 /convert 이동 처리
    } catch (e: any) {
      // 팝업 차단/취소 등도 여기로 들어옵니다.
      setErrorMsg(e?.message ?? "로그인 중 오류가 발생했습니다.");
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        {/* 상단 헤더 */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gray-900 dark:bg-white" />
            <div>
              <div className="text-lg font-bold">Datalign</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                업무 프로세스 지원툴
              </div>
            </div>
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-300">
            {loading ? "상태 확인 중..." : user ? "로그인됨" : "로그인 필요"}
          </div>
        </div>

        {/* 본문 2컬럼 */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* 좌측: 소개/가치 */}
          <section className="rounded-2xl border border-gray-200 p-8 dark:border-gray-700">
            <h1 className="text-2xl font-bold leading-snug">
              데이터 업무를 더 빠르고 안전하게,
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                프로세스 중심으로 정렬하는 워크스페이스
              </span>
            </h1>

            <p className="mt-4 text-gray-700 dark:text-gray-200">
              Datalign은 데이터 변환, 정합성 확인, 문서화 등 반복되는 업무를
              한 곳에서 처리할 수 있도록 돕는 업무 프로세스 지원툴입니다.
            </p>

            <ul className="mt-6 space-y-3 text-gray-700 dark:text-gray-200">
              <li className="flex gap-2">
                <span className="mt-1">•</span>
                <span>데이터 변환/정렬/검증 작업을 빠르게 수행</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1">•</span>
                <span>작업 실수를 줄이고 결과 공유를 쉽게</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1">•</span>
                <span>로그인 기반으로 사용자 워크스페이스 운영</span>
              </li>
            </ul>

            <div className="mt-8 rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <div className="font-semibold">권장 워크플로우</div>
              <div className="mt-1">
                로그인 → 파일 업로드 → 변환/검증 → 결과 다운로드
              </div>
            </div>
          </section>

          {/* 우측: 로그인 카드 */}
          <section className="rounded-2xl border border-gray-200 p-8 dark:border-gray-700">
            <h2 className="text-xl font-bold">로그인</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Google 계정으로 로그인 후 업무 화면으로 이동합니다.
            </p>

            {errorMsg ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {errorMsg}
              </div>
            ) : null}

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-gray-900"
                disabled={loading}
              >
                Google로 로그인
              </button>

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                팝업이 차단되면 브라우저 팝업 허용 후 다시 시도해주세요.
              </div>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-6 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
              <div className="font-semibold">접속 안내</div>
              <div className="mt-1">
                로그인 후 자동으로 <span className="font-semibold">/convert</span>로
                이동합니다.
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
