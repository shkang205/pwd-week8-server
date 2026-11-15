// 실제 Supabase 프로젝트·실제 계정으로 RLS 권한을 검증합니다.
// 사용법: .env에 아래 값을 넣고 `npm run test:rls`
//   API_URL(기본 http://localhost:3000), SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//   RLS_MEMBER_A_EMAIL / RLS_MEMBER_A_PASSWORD   (일반 회원 A — 등록자)
//   RLS_MEMBER_B_EMAIL / RLS_MEMBER_B_PASSWORD   (일반 회원 B — 타인)
//   RLS_ADMIN_EMAIL    / RLS_ADMIN_PASSWORD      (관리자)
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const api = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_PUBLISHABLE_KEY!;

async function login(prefix: string) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`${prefix}_EMAIL / ${prefix}_PASSWORD를 .env에 설정하세요.`);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`${email} 로그인 실패: ${error?.message}`);
  return { client, token: data.session.access_token, email };
}
async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${detail}`);
}

async function main() {
  const a = await login("RLS_MEMBER_A");
  const b = await login("RLS_MEMBER_B");
  const admin = await login("RLS_ADMIN");

  const list = await call("GET", "/api/restaurants");
  check("비회원 목록 조회", list.status === 200, `HTTP ${list.status}`);

  const anonCreate = await call("POST", "/api/restaurants", undefined, { name: "x", category: "한식", location: "x" });
  check("비회원 등록 차단", anonCreate.status === 401, `HTTP ${anonCreate.status}`);

  const created = await call("POST", "/api/restaurants", a.token, {
    name: "RLS 검증용 맛집", category: "한식", location: "아주대 정문",
  });
  check("회원 A 등록", created.status === 201, `HTTP ${created.status}`);
  const id = created.body?.data?.id;
  if (!id) throw new Error("생성 실패로 이후 검사를 중단합니다.");

  const ownUpdate = await call("PUT", `/api/restaurants/${id}`, a.token, { description: "A 본인 수정" });
  check("회원 A 본인 수정 허용", ownUpdate.status === 200, `HTTP ${ownUpdate.status}`);

  const otherUpdate = await call("PUT", `/api/restaurants/${id}`, b.token, { description: "B 수정 시도" });
  check("회원 B 수정 차단 (Express 경유)", otherUpdate.status === 403, `HTTP ${otherUpdate.status} ${otherUpdate.body?.message ?? ""}`);

  // Express를 거치지 않고 Supabase에 직접 요청해도 RLS가 막는지 확인
  const direct = await b.client.from("restaurants").update({ description: "B 직접 수정 시도" }).eq("id", id).select();
  check("회원 B 수정 차단 (Supabase 직접)", !direct.error && (direct.data?.length ?? 0) === 0, `변경된 행 ${direct.data?.length ?? 0}개 ${direct.error?.message ?? ""}`);

  const otherDelete = await call("DELETE", `/api/restaurants/${id}`, b.token);
  check("회원 B 삭제 차단", otherDelete.status === 403, `HTTP ${otherDelete.status}`);

  const adminUpdate = await call("PUT", `/api/restaurants/${id}`, admin.token, { description: "관리자 수정" });
  check("관리자 수정 허용", adminUpdate.status === 200, `HTTP ${adminUpdate.status}`);

  const adminDelete = await call("DELETE", `/api/restaurants/${id}`, admin.token);
  check("관리자 삭제 허용", adminDelete.status === 204, `HTTP ${adminDelete.status}`);

  console.log(failed ? `\n${failed}개 실패` : "\n모든 권한 검증 통과");
  process.exit(failed ? 1 : 0);
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
