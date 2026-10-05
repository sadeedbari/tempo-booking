import type { NextRequest } from "next/server";
import { finishConnect } from "@/lib/calendar/oauth";

export const GET = (request: NextRequest) => finishConnect(request, "microsoft");
