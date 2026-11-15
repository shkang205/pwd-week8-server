-- =====================================================================
-- RLS 권한 검증 스크립트 (Supabase SQL Editor에서 rls.sql 다음에 실행)
-- 임시 사용자 3명(회원 A, 회원 B, 관리자)을 만들고, 실제 API 요청과 같은 방식으로
-- role=authenticated + JWT sub(=auth.uid())를 설정해 음식점 수정·삭제를 시도합니다.
-- 끝나면 임시 사용자·음식점을 지우고 결과 표만 남깁니다. 모든 pass가 true여야 합니다.
-- =====================================================================
drop table if exists pg_temp.rls_result;
create temp table rls_result(step int, actor text, action text, expected text, actual text, pass boolean);

do $$
declare
  member_a uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
  admin_u  uuid := gen_random_uuid();
  rid bigint;
  n int;
  owner uuid;
  ok boolean;
begin
  -- 임시 계정 생성 (가입 트리거가 profiles를 user로 만듭니다)
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (member_a, 'rls-a@example.test', '{"name":"회원A"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
         (member_b, 'rls-b@example.test', '{"name":"회원B"}', '{"provider":"google"}', 'authenticated', 'authenticated'),
         (admin_u,  'rls-admin@example.test', '{"name":"관리자"}', '{"provider":"custom:naver"}', 'authenticated', 'authenticated');
  update public.profiles set user_type = 'admin' where id = admin_u;

  -- 1. 비회원 조회
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  select count(*) into n from public.restaurants;
  perform set_config('role', 'none', true);
  insert into rls_result values (1, '비회원', '음식점 목록 조회', '허용', n || '건 조회', true);

  -- 2. 비회원 등록 시도
  perform set_config('role', 'anon', true);
  begin
    insert into public.restaurants(name, category, location) values ('비회원 맛집', '한식', '정문');
    ok := false;
  exception when others then ok := true;
  end;
  perform set_config('role', 'none', true);
  insert into rls_result values (2, '비회원', '음식점 등록', '차단', case when ok then '차단' else '허용' end, ok);

  -- 3. 회원 A 등록 (created_by를 다른 사람으로 위조해도 본인으로 저장)
  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.restaurants(name, category, location) values ('RLS 테스트 맛집', '한식', '아주대 정문')
    returning id, created_by into rid, owner;
  perform set_config('role', 'none', true);
  insert into rls_result values (3, '회원 A', '음식점 등록', '허용·등록자=A', case when owner = member_a then '허용·등록자=A' else '등록자 불일치' end, owner = member_a);

  -- 4. 회원 A 본인 음식점 수정
  perform set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.restaurants set description = 'A가 수정' where id = rid;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  insert into rls_result values (4, '회원 A(등록자)', '본인 음식점 수정', '허용', case when n = 1 then '허용' else '차단' end, n = 1);

  -- 5. 회원 B가 A의 음식점 수정 → RLS가 0행으로 차단
  perform set_config('request.jwt.claims', json_build_object('sub', member_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.restaurants set description = 'B가 몰래 수정' where id = rid;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  insert into rls_result values (5, '회원 B(타인)', 'A의 음식점 수정', '차단', case when n = 0 then '차단' else '허용' end, n = 0);

  -- 6. 회원 B가 A의 음식점 삭제 → 차단
  perform set_config('role', 'authenticated', true);
  delete from public.restaurants where id = rid;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  insert into rls_result values (6, '회원 B(타인)', 'A의 음식점 삭제', '차단', case when n = 0 then '차단' else '허용' end, n = 0);

  -- 7. 관리자가 A의 음식점 수정 → 허용 (등록자는 A로 유지)
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.restaurants set description = '관리자가 수정' where id = rid;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  select created_by into owner from public.restaurants where id = rid;
  insert into rls_result values (7, '관리자', 'A의 음식점 수정', '허용', case when n = 1 then '허용' else '차단' end, n = 1 and owner = member_a);

  -- 8. 관리자가 A의 음식점 삭제 → 허용
  perform set_config('role', 'authenticated', true);
  delete from public.restaurants where id = rid;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  insert into rls_result values (8, '관리자', 'A의 음식점 삭제', '허용', case when n = 1 then '허용' else '차단' end, n = 1);

  -- 정리
  perform set_config('request.jwt.claims', '', true);
  delete from public.restaurants where id = rid;
  delete from auth.users where id in (member_a, member_b, admin_u);
end $$;

select * from rls_result order by step;
