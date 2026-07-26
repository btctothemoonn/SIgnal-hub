import { NextResponse } from "next/server.js";
import {
  getStocksResearchState,
  getStocksResearchStates,
  saveStocksResearchState,
  StocksResearchStateValidationError,
  type StocksResearchStateInput,
} from "../../../lib/stocks-research-state.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(status: number, code: "VALIDATION_ERROR" | "INTERNAL_ERROR", message: string) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

function researchStateInput(value: unknown): StocksResearchStateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StocksResearchStateValidationError("Request body must be an object.");
  }
  return value as StocksResearchStateInput;
}

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker");
  try {
    if (ticker !== null) {
      return NextResponse.json(
        { state: getStocksResearchState(ticker) },
        { headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        states: getStocksResearchStates(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof StocksResearchStateValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    return errorResponse(500, "INTERNAL_ERROR", "Unable to load research state.");
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  try {
    const state = saveStocksResearchState({ input: researchStateInput(body) });
    return NextResponse.json(
      { ok: true, state },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof StocksResearchStateValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    return errorResponse(500, "INTERNAL_ERROR", "Unable to save research state.");
  }
}
