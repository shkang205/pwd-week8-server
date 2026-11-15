-- =====================================================================
-- Ajou FoodMap 과제 — 음식점 등록자·역할 기반 권한 (RLS)
-- 실행 순서: schema.sql → seed.sql → rls.sql  (Supabase SQL Editor에서 전체 실행)
--   * 비회원(anon)        : 음식점 조회
--   * 회원(authenticated) : 음식점 등록, 자신이 등록한 음식점만 수정·삭제
--   * 관리자(profiles.user_type='admin') : 모든 음식점 수정·삭제
-- 구글·네이버·이메일 어느 방식으로 로그인해도 auth.uid()는 같은 auth.users UUID이고,
-- 역할은 같은 UUID의 profiles 행에서 읽으므로 동일한 권한이 적용됩니다.
-- 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

-- 1) 등록자 열: 누가 등록했는지 auth 사용자 UUID로 기록합니다.
alter table public.restaurants
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
create index if not exists foodmap_restaurants_created_by on public.restaurants(created_by);

-- 2) 등록 시 created_by를 클라이언트 값이 아니라 토큰의 사용자(auth.uid())로 강제합니다.
--    관리자 승인 RPC(service_role, auth.uid() 없음)는 원래 값을 유지합니다.
create or replace function public.foodmap_set_restaurant_owner() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  elsif tg_op = 'UPDATE' then
    -- 등록자는 수정으로 바꿀 수 없습니다(관리자 포함, 서버 키 제외).
    if auth.uid() is not null then new.created_by := old.created_by; end if;
  end if;
  return new;
end $$;
drop trigger if exists foodmap_restaurants_owner on public.restaurants;
create trigger foodmap_restaurants_owner before insert or update on public.restaurants
  for each row execute function public.foodmap_set_restaurant_owner();

-- 3) 역할 판별 함수: profiles를 RLS 없이 읽도록 security definer로 작성합니다.
create or replace function public.foodmap_is_active_member() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_active);
$$;
create or replace function public.foodmap_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_active and user_type = 'admin');
$$;
revoke all on function public.foodmap_is_active_member(), public.foodmap_is_admin(), public.foodmap_set_restaurant_owner() from public, anon;
grant execute on function public.foodmap_is_active_member(), public.foodmap_is_admin() to authenticated, service_role;

-- 4) 테이블 권한: RLS 정책이 행 단위로 다시 거릅니다.
alter table public.restaurants enable row level security;
-- Supabase 기본 권한(ALL)을 먼저 회수하고 필요한 권한만 다시 부여합니다.
revoke all on table public.restaurants from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on table public.restaurants to anon, authenticated;
grant insert (name, category, location, price_range, rating, description, recommended_menu, image)
  on table public.restaurants to authenticated;
grant update (name, category, location, price_range, rating, description, recommended_menu, image)
  on table public.restaurants to authenticated;
grant delete on table public.restaurants to authenticated;
grant usage, select on sequence public.restaurants_id_seq to authenticated;

-- 5) RLS 정책
drop policy if exists "restaurants_select_all" on public.restaurants;
drop policy if exists "restaurants_insert_member" on public.restaurants;
drop policy if exists "restaurants_update_owner_or_admin" on public.restaurants;
drop policy if exists "restaurants_delete_owner_or_admin" on public.restaurants;

-- 비회원 포함 누구나 조회
create policy "restaurants_select_all" on public.restaurants
  for select to anon, authenticated using (true);

-- 활성 회원만 등록, 등록자는 본인
create policy "restaurants_insert_member" on public.restaurants
  for insert to authenticated
  with check (public.foodmap_is_active_member() and created_by = auth.uid());

-- 본인이 등록한 행 또는 관리자만 수정
create policy "restaurants_update_owner_or_admin" on public.restaurants
  for update to authenticated
  using (public.foodmap_is_active_member() and (created_by = auth.uid() or public.foodmap_is_admin()))
  with check (public.foodmap_is_active_member() and (created_by = auth.uid() or public.foodmap_is_admin()));

-- 본인이 등록한 행 또는 관리자만 삭제
create policy "restaurants_delete_owner_or_admin" on public.restaurants
  for delete to authenticated
  using (public.foodmap_is_active_member() and (created_by = auth.uid() or public.foodmap_is_admin()));

notify pgrst, 'reload schema';
commit;
