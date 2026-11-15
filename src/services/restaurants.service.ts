import {
  getSupabase,
  getUserSupabase,
  throwDatabaseError,
} from "../config/supabase";
import Restaurant from "../models/restaurant.model";
import type {
  RestaurantInsert,
  RestaurantRow,
} from "../types/database.types";
import HttpError from "../utils/httpError";
import { menuField, numericId, objectBody, textField } from "../utils/input";

function restaurantInput(
  value: unknown,
  partial = false,
): Partial<RestaurantInsert> {
  const input = objectBody(value);
  const row: Partial<RestaurantInsert> = {};
  for (const field of ["name", "category", "location"] as const) {
    if (!partial || input[field] !== undefined)
      row[field] = textField(input[field], field, true, 300);
  }
  for (const [external, column] of [
    ["priceRange", "price_range"],
    ["description", "description"],
    ["image", "image"],
  ] as const) {
    if (input[external] !== undefined)
      row[column] = textField(input[external], external);
  }
  if (input.rating !== undefined) {
    if (
      !["string", "number"].includes(typeof input.rating) ||
      input.rating === ""
    )
      throw new HttpError(400, "평점은 0~5 사이의 숫자여야 합니다.");
    const rating = Number(input.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5)
      throw new HttpError(400, "평점은 0~5 사이의 숫자여야 합니다.");
    row.rating = rating;
  }
  if (input.recommendedMenu !== undefined)
    row.recommended_menu = menuField(input.recommendedMenu);
  if (partial && !Object.keys(row).length)
    throw new HttpError(400, "수정할 값을 입력하세요.");
  return row;
}
// 등록자 이름을 붙여 응답합니다. (profiles는 서버 키로만 읽습니다)
async function withCreators(rows: RestaurantRow[]) {
  const ids = [...new Set(rows.map((row) => row.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("id,name")
      .in("id", ids);
    if (error) throwDatabaseError(error);
    for (const profile of data ?? []) names.set(profile.id, profile.name);
  }
  return rows.map((row) =>
    Restaurant.fromDatabase(row, row.created_by ? names.get(row.created_by) : undefined),
  );
}
// RLS가 0행으로 막았는지, 실제로 없는 행인지 구분합니다.
async function notFoundOrForbidden(id: number): Promise<never> {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(404, "Restaurant not found");
  throw new HttpError(
    403,
    "본인이 등록한 음식점만 수정·삭제할 수 있습니다. (RLS 정책에 의해 차단)",
  );
}
export async function getMyRestaurants(userId: string) {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .eq("created_by", userId)
    .order("id");
  if (error) throwDatabaseError(error);
  return withCreators(data ?? []);
}
export async function getAllRestaurants() {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .order("id");
  if (error) throwDatabaseError(error);
  return withCreators(data ?? []);
}
export async function getRestaurantById(id: string) {
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .eq("id", numericId(id))
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(404, "Restaurant not found");
  return (await withCreators([data]))[0];
}
export async function getPopularRestaurants(limit: unknown = "5") {
  if (
    typeof limit !== "string" ||
    !/^\d+$/.test(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 50
  )
    throw new HttpError(400, "limit은 1~50 사이의 정수여야 합니다.");
  const { data, error } = await getSupabase()
    .from("restaurants")
    .select("*")
    .order("rating", { ascending: false })
    .order("id")
    .limit(Number(limit));
  if (error) throwDatabaseError(error);
  return withCreators(data ?? []);
}
// [과제: RLS] 쓰기 요청은 사용자 토큰으로 보내 DB의 RLS 정책이 허용 여부를 결정합니다.
// created_by는 DB 트리거가 auth.uid()로 채우므로 요청 본문 값은 사용하지 않습니다.
export async function createRestaurant(value: unknown, accessToken: string) {
  const row = restaurantInput(value) as RestaurantInsert;
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .insert(row)
    .select("*")
    .single();
  if (error) throwDatabaseError(error);
  return (await withCreators([data!]))[0];
}
export async function updateRestaurant(
  id: string,
  value: unknown,
  accessToken: string,
) {
  const restaurantId = numericId(id);
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .update(restaurantInput(value, true))
    .eq("id", restaurantId)
    .select("*")
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) return notFoundOrForbidden(restaurantId);
  return (await withCreators([data]))[0];
}
export async function deleteRestaurant(id: string, accessToken: string) {
  const restaurantId = numericId(id);
  const { data, error } = await getUserSupabase(accessToken)
    .from("restaurants")
    .delete()
    .eq("id", restaurantId)
    .select("id")
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) await notFoundOrForbidden(restaurantId);
}
