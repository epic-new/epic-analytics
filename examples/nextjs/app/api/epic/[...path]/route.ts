import { createEpicRoute } from "@epicnew/analytics/next";
import { cookies } from "next/headers";

export const { GET, POST } = createEpicRoute({
  // A stand-in session: replace with your own (`auth()`, `getSession()`…).
  async currentUserId() {
    const cookieStore = await cookies();
    return cookieStore.get("demo_user")?.value;
  },
});
