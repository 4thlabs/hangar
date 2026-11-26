import { Component, type ReactNode } from "react";
import type { WidgetLook } from "#modules/widgets/widget-appearance.ts";
import { WidgetError } from "./widget-states.tsx";

type WidgetBoundaryProps = {
  look: WidgetLook;
  children: ReactNode;
};

type WidgetBoundaryState = {
  hasFailed: boolean;
};

/**
 * One card's own error state: a card that throws as it renders, on data its service gave in a shape it does not
 * expect, shows its error, and the rest of the dashboard stands. React logs the error.
 */
export class WidgetBoundary extends Component<WidgetBoundaryProps, WidgetBoundaryState> {
  override state: WidgetBoundaryState = { hasFailed: false };

  static getDerivedStateFromError(): WidgetBoundaryState {
    return { hasFailed: true };
  }

  override render() {
    if (this.state.hasFailed) {
      return <WidgetError look={this.props.look} reason="The card could not show what its service answered." />;
    }

    return this.props.children;
  }
}
