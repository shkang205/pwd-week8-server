import { Router } from "express";
import { isAuthenticated } from "../middleware/auth.middleware";
import * as controller from "../controllers/restaurants.controller";
const router = Router();
// 비회원도 조회할 수 있습니다.
router.get("/", controller.list);
router.get("/popular", controller.popular);
router.get("/mine", isAuthenticated, controller.mine);
router.get("/:id", controller.get);
// [과제: 권한별 기능] 로그인한 회원은 등록, 등록자 본인·관리자는 수정·삭제할 수 있습니다.
// 등록자/관리자 판단은 Supabase RLS 정책(supabase/rls.sql)이 사용자 토큰(auth.uid())으로 수행합니다.
router.post("/", isAuthenticated, controller.create);
router.put("/:id", isAuthenticated, controller.update);
router.delete("/:id", isAuthenticated, controller.remove);
export default router;
