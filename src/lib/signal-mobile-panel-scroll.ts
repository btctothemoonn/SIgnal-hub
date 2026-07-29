export type SignalMobilePanel = "feed" | "summary";

export type SignalMobilePanelScrollState = {
  activePanel: SignalMobilePanel;
  programmaticTarget: SignalMobilePanel | null;
};

type SignalMobilePanelScrollEvent =
  | {
      type: "programmatic-start";
      target: SignalMobilePanel;
    }
  | {
      type: "scroll";
      scrollLeft: number;
      clientWidth: number;
    }
  | {
      type: "user-interrupt";
    };

const SIGNAL_MOBILE_PANEL_INDEX: Record<SignalMobilePanel, number> = {
  feed: 0,
  summary: 1,
};

const PROGRAMMATIC_SCROLL_ARRIVAL_TOLERANCE_PX = 1;

export function reduceSignalMobilePanelScroll(
  state: SignalMobilePanelScrollState,
  event: SignalMobilePanelScrollEvent,
): SignalMobilePanelScrollState {
  if (event.type === "programmatic-start") {
    return {
      activePanel: event.target,
      programmaticTarget: event.target,
    };
  }

  if (event.type === "user-interrupt") {
    return {
      ...state,
      programmaticTarget: null,
    };
  }

  if (
    !Number.isFinite(event.scrollLeft) ||
    !Number.isFinite(event.clientWidth) ||
    event.clientWidth <= 0
  ) {
    return state;
  }

  if (state.programmaticTarget) {
    const targetScrollLeft =
      event.clientWidth *
      SIGNAL_MOBILE_PANEL_INDEX[state.programmaticTarget];
    const hasArrived =
      Math.abs(event.scrollLeft - targetScrollLeft) <=
      PROGRAMMATIC_SCROLL_ARRIVAL_TOLERANCE_PX;

    return {
      activePanel: state.programmaticTarget,
      programmaticTarget: hasArrived ? null : state.programmaticTarget,
    };
  }

  return {
    activePanel:
      event.scrollLeft >= event.clientWidth * 0.5 ? "summary" : "feed",
    programmaticTarget: null,
  };
}
