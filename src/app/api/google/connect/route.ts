import type { NextRequest } from "next/server";
import { startConnect } from "@/lib/calendar/oauth";

export const GET = (request: NextRequest) => startConnect(request, "google");
