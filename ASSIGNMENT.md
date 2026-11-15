# 8주차 과제 — 인증·권한·RLS 구현 정리

## 구현 내용

| 요구사항 | 구현 위치 |
| --- | --- |
| 이메일 회원가입·로그인·로그아웃 | 클라이언트 `LoginPage`/`RegisterPage` + Supabase Auth (기존 실습 코드) |
| 구글·네이버 로그인 | 클라이언트 `SocialLoginButtons` + Supabase Auth (Google, `custom:naver` OIDC) |
| 로그인 방식과 무관한 동일 권한 | 모든 방식이 같은 `auth.users` UUID → 같은 `profiles.user_type`으로 판단 |
| 비회원 목록 조회 | `GET /api/restaurants` (인증 없음), RLS `restaurants_select_all` |
| 회원 음식점 등록 | `POST /api/restaurants` (로그인만 필요), RLS `restaurants_insert_member` |
| 본인 등록 음식점만 수정·삭제 | `PUT/DELETE /api/restaurants/:id`, RLS `..._owner_or_admin` |
| 관리자 전체 수정·삭제 | RLS 정책의 `foodmap_is_admin()` |
| RLS 권한 SQL | `supabase/rls.sql` |
| RLS 검증 | `supabase/rls-verify.sql`(SQL Editor), `npm run test:rls`(실계정), `npm test`(PGlite) |

### 권한 판단 구조
- `restaurants.created_by` 열에 등록자 UUID를 저장합니다. 값은 요청 본문이 아니라 DB 트리거가 `auth.uid()`로 채우며, 수정으로 바꿀 수 없습니다.
- Express는 맛집 **쓰기 요청을 사용자의 액세스 토큰 + Publishable key**로 Supabase에 전달합니다(`getUserSupabase`). 그래서 등록자·관리자 판단을 Express가 아니라 **PostgreSQL RLS**가 합니다.
- RLS가 0행으로 막으면 서버가 행 존재 여부를 확인해 `403`(권한 없음) 또는 `404`(없음)를 반환합니다.
- 클라이언트 상세 화면의 **권한 테스트** 버튼으로, 화면 버튼 노출과 관계없이 실제 수정 요청을 보내 허용/차단을 확인할 수 있습니다.

## 실행 순서

1. Supabase SQL Editor에서 `schema.sql` → `seed.sql` → **`rls.sql`** 순서로 실행합니다. (`schema.sql`을 다시 실행했다면 `rls.sql`도 다시 실행)
2. `rls-verify.sql`을 실행하고 결과 표의 `pass`가 모두 `true`인지 확인합니다. (이 결과 화면을 캡처해 두면 제출 증빙으로 쓸 수 있습니다)
3. 서버 `.env`(그리고 Render 환경변수)에 **`SUPABASE_PUBLISHABLE_KEY`** 를 꼭 넣습니다. 이 값이 없으면 맛집 등록·수정·삭제가 실패합니다.
4. 선택: `.env`에 테스트 계정 3개(회원 A, 회원 B, 관리자)를 넣고 서버를 켠 뒤 `npm run test:rls`를 실행합니다.
