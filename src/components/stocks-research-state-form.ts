import type {
  StocksResearchState,
  StocksResearchStateInput,
} from "../lib/stocks-research-state.ts";

export type ResearchStateForm = Omit<StocksResearchStateInput, "ticker">;

export type ResearchStatePanelState = {
  ticker: string;
  updatedAt: string | null;
  form: ResearchStateForm;
  saving: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  activeSaveId: number | null;
  nextSaveId: number;
};

export type ResearchStateSaveOperation = {
  id: number;
  input: StocksResearchStateInput;
};

function formFromState(state: StocksResearchState): ResearchStateForm {
  return {
    status: state.status,
    conviction: state.conviction,
    entryZone: state.entryZone,
    invalidation: state.invalidation,
    nextCatalyst: state.nextCatalyst,
    thesis: state.thesis,
  };
}

export function createResearchStatePanelState(
  researchState: StocksResearchState,
): ResearchStatePanelState {
  return {
    ticker: researchState.ticker,
    updatedAt: researchState.updatedAt,
    form: formFromState(researchState),
    saving: false,
    saveStatus: "idle",
    saveError: null,
    activeSaveId: null,
    nextSaveId: 1,
  };
}

export function updateResearchStateForm(
  state: ResearchStatePanelState,
  patch: Partial<ResearchStateForm>,
): ResearchStatePanelState {
  return { ...state, form: { ...state.form, ...patch } };
}

export function syncResearchStatePanelState(
  state: ResearchStatePanelState,
  researchState: StocksResearchState,
): ResearchStatePanelState {
  const tickerChanged = state.ticker !== researchState.ticker;
  const updatedAtChanged = state.updatedAt !== researchState.updatedAt;
  if (!tickerChanged && !updatedAtChanged) return state;

  return {
    ...state,
    ticker: researchState.ticker,
    updatedAt: researchState.updatedAt,
    form: formFromState(researchState),
    saving: tickerChanged ? false : state.saving,
    saveStatus: tickerChanged || !state.saving ? "idle" : "saving",
    saveError: null,
    activeSaveId: tickerChanged ? null : state.activeSaveId,
  };
}

export function beginResearchStateSave(
  state: ResearchStatePanelState,
  loading: boolean,
): { state: ResearchStatePanelState; operation: ResearchStateSaveOperation | null } {
  if (loading || state.saving) return { state, operation: null };

  const operation = {
    id: state.nextSaveId,
    input: { ticker: state.ticker, ...state.form },
  };
  return {
    operation,
    state: {
      ...state,
      saving: true,
      saveStatus: "saving",
      saveError: null,
      activeSaveId: operation.id,
      nextSaveId: operation.id + 1,
    },
  };
}

export function finishResearchStateSave(
  state: ResearchStatePanelState,
  saveId: number,
  result: { ok: true } | { ok: false; error: string },
): ResearchStatePanelState {
  if (state.activeSaveId !== saveId) return state;

  if (result.ok) {
    return {
      ...state,
      saving: false,
      saveStatus: "saved",
      saveError: null,
      activeSaveId: null,
    };
  }

  return {
    ...state,
    saving: false,
    saveStatus: "error",
    saveError: result.error,
    activeSaveId: null,
  };
}

export function getResearchStatePanelMode({
  researchState,
  loading,
  hasSaveHandler,
}: {
  researchState: StocksResearchState | null;
  loading: boolean;
  hasSaveHandler: boolean;
}): "editor" | "loading" | "unavailable" {
  if (researchState && hasSaveHandler) return "editor";
  return loading ? "loading" : "unavailable";
}
